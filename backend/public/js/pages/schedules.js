import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, openModal, confirmModal } from '/js/ui.js';
import { makeMoney } from '/js/money.js';
import { buildScheduleFields } from '/js/schedform.js';
import { mountTabs, dateText, relative, kindIcon, pill, approveDialog, payNextDialog } from '/js/schedcommon.js';

const { user } = await ready;
if (!user) await new Promise(() => {}); // layout.js is already redirecting to /login
mountTabs('/schedules');

const money = makeMoney(user.locale, user.currency);
let groups = [];
let accounts = [];
let payees = [];
let today = '';

const signed = (minor) => (minor < 0 ? '−' : '+') + money.fmt(minor);

/* ---------- approval queue ---------- */

async function loadQueue() {
  const { occurrences, today: t } = await api('/api/schedule-occurrences?status=pending');
  today = t;
  const list = $('queueList');
  list.textContent = '';
  $('queuePanel').hidden = occurrences.length === 0;
  $('queueHint').textContent = occurrences.length ? `${occurrences.length} waiting` : '';
  for (const o of occurrences) {
    const approve = el('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: o.amountMinor < 0 ? 'Pay…' : 'Receive…' });
    const skip = el('button', { type: 'button', className: 'small-btn', textContent: 'Skip' });
    approve.onclick = () => approveDialog({
      item: { occurrenceId: o.id, name: o.scheduleName, dueDate: o.dueDate, amountMinor: o.amountMinor }, money, today,
      onDone: async () => { toast('✔ Transaction created'); await loadAll(); },
    });
    skip.onclick = () => confirmModal({
      title: 'Skip this one?', message: `${o.scheduleName} (${dateText(o.dueDate, user.locale)}) will be marked as skipped. No transaction is created.`,
      confirmLabel: 'Skip it', danger: false,
      onConfirm: async () => { await api(`/api/schedule-occurrences/${o.id}/skip`, { method: 'POST' }); toast('⏭ Skipped'); await loadAll(); },
    });
    list.append(el('div', { className: 'row-item' },
      el('div', { className: 't-ico', textContent: kindIcon(o.amountMinor) }),
      el('div', { className: 'grow' },
        el('b', { textContent: o.scheduleName }), o.overdue ? pill('overdue', 'warn') : pill('due ' + relative(o.dueDate, today)),
        el('br'), el('small', { textContent: `${dateText(o.dueDate, user.locale)} • ${o.accountName}${o.note ? ' • ' + o.note : ''}` })),
      el('b', { className: o.amountMinor < 0 ? 'amt-exp' : 'amt-inc', textContent: signed(o.amountMinor) }),
      el('div', { className: 'actions' }, approve, skip)));
  }
}

/* ---------- schedules ---------- */

async function loadSchedules() {
  $('sLoading').hidden = false;
  const data = await api('/api/schedules?status=' + encodeURIComponent($('sStatus').value));
  today = data.today;
  $('sLoading').hidden = true;
  const list = $('sList');
  list.textContent = '';
  $('sEmpty').hidden = data.schedules.length > 0;
  for (const s of data.schedules) list.append(rowNode(s));
}

function rowNode(s) {
  const bits = [
    s.frequencyLabel,
    s.status === 'finished' ? 'finished' : s.paused ? `paused (next ${dateText(s.nextDate || s.startDate, user.locale)})` : `next ${dateText(s.nextDate, user.locale)} (${relative(s.nextDate, today)})`,
    s.accountName,
    s.categoryName ? `${s.categoryIcon || ''} ${s.categoryName}`.trim() : 'Uncategorized',
  ];
  if (s.endDate) bits.push(`until ${dateText(s.endDate, user.locale)}`);
  if (s.frequency !== 'once' && s.kind === 'expense' && s.frequency !== 'monthly') bits.push(`≈ ${money.fmt(s.monthlyEquivalentMinor)}/month`);

  const name = el('div', { className: 'grow' },
    el('b', { textContent: s.name }),
    s.mode === 'auto' ? pill('auto') : pill('asks first'),
    s.paused ? pill('paused', 'warn') : '', s.status === 'finished' ? pill('finished') : '',
    s.accountClosed ? pill('account closed', 'warn') : '',
    s.pendingCount ? pill(`${s.pendingCount} waiting`, 'warn') : '',
    el('br'), el('small', { textContent: bits.join(' • ') }));

  const buttons = [];
  const mkBtn = (label, fn, cls = 'small-btn') => { const b = el('button', { type: 'button', className: cls, textContent: label }); b.onclick = fn; buttons.push(b); return b; };
  if (s.status === 'active') {
    mkBtn(s.kind === 'expense' ? 'Pay next' : 'Receive next', () => payNextDialog({
      item: { scheduleId: s.id, name: s.name, dueDate: s.nextDate, amountMinor: s.amountMinor }, today,
      onDone: async () => { toast('✔ Transaction created'); await loadAll(); },
    }));
    mkBtn('Skip next', () => confirmModal({
      title: 'Skip the next one?', message: `${s.name} on ${dateText(s.nextDate, user.locale)} will be skipped. The schedule carries on after that.`,
      confirmLabel: 'Skip it', danger: false,
      onConfirm: async () => { await api(`/api/schedules/${s.id}/skip-next`, { method: 'POST' }); toast('⏭ Skipped'); await loadAll(); },
    }));
  }
  mkBtn('Edit', () => editDialog(s));
  if (s.paused) mkBtn('Resume', () => resume(s));
  else if (s.status === 'active') mkBtn('Pause', async () => { try { await api(`/api/schedules/${s.id}/pause`, { method: 'POST' }); toast('⏸ Paused'); await loadAll(); } catch (e) { toast(e.message); } });
  mkBtn('Delete', () => confirmModal({
    title: 'Delete this schedule?',
    message: `“${s.name}” and its waiting items are removed. Transactions it already created stay in your list. This cannot be undone.`,
    onConfirm: async () => { await api(`/api/schedules/${s.id}`, { method: 'DELETE' }); toast('🗑 Deleted'); await loadAll(); },
  }), 'small-btn danger');

  return el('div', { className: 'row-item' + (s.paused || s.status === 'finished' ? ' dim' : '') },
    el('div', { className: 't-ico', textContent: kindIcon(s.amountMinor) }),
    name,
    el('b', { className: s.amountMinor < 0 ? 'amt-exp' : 'amt-inc', textContent: signed(s.amountMinor) }),
    el('div', { className: 'actions' }, ...buttons));
}

function resume(s) {
  const missed = s.nextDate && s.nextDate < today;
  const go = async (catchUp) => {
    const r = await api(`/api/schedules/${s.id}/resume`, { method: 'POST', body: { catchUp } });
    toast(r.skipped ? `▶ Resumed, ${r.skipped} missed date${r.skipped === 1 ? '' : 's'} skipped` : '▶ Resumed');
    await loadAll();
  };
  if (!missed) { go(false).catch((e) => toast(e.message)); return; }
  openModal({
    title: `Resume ${s.name}`,
    content: el('p', { className: 'modal-text', textContent: `Some dates passed while it was paused (the first was ${dateText(s.nextDate, user.locale)}). Skip them and carry on from the next date, or create them now?` }),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Create the missed ones', kind: 'ghost', onClick: () => go(true) },
      { label: 'Skip them', kind: 'primary', onClick: () => go(false) },
    ],
  });
}

/* ---------- add / edit ---------- */

function editDialog(s) {
  const f = buildScheduleFields({ groups, accounts, payees }, s);
  openModal({
    title: s ? 'Edit schedule' : 'New schedule', content: f.node,
    buttons: [{ label: 'Cancel', kind: 'ghost' }, { label: s ? 'Save' : 'Create', kind: 'primary', onClick: async () => {
      const body = f.read();
      if (s) {
        const r = await api(`/api/schedules/${s.id}`, { method: 'PATCH', body });
        toast(r.generated.posted ? `✔ Saved, ${r.generated.posted} transaction${r.generated.posted === 1 ? '' : 's'} created` : '✔ Saved');
      } else {
        const r = await api('/api/schedules', { method: 'POST', body });
        const g = r.generated;
        const parts = [g.posted && `${g.posted} transaction${g.posted === 1 ? '' : 's'} created`, g.pending && `${g.pending} waiting for approval`].filter(Boolean);
        toast(parts.length ? `✔ Schedule created, ${parts.join(', ')}` : '✔ Schedule created');
      }
      await loadAll();
    } }],
  });
}

async function loadAll() {
  try { await Promise.all([loadQueue(), loadSchedules()]); } catch (err) { toast(err.message); }
}

$('sStatus').addEventListener('change', () => loadAll());
$('sAdd').onclick = () => editDialog(null);

try {
  [{ groups }, { accounts }, { payees }] = await Promise.all([api('/api/categories'), api('/api/accounts'), api('/api/payees?limit=500')]);
} catch (err) { toast(err.message); }
await loadAll();
