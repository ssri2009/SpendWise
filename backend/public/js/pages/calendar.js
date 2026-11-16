import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, option, monthLabel } from '/js/ui.js';
import { makeMoney } from '/js/money.js';
import { mountTabs, dateText, pill, approveDialog, kindIcon } from '/js/schedcommon.js';

const { user } = await ready;
if (!user) await new Promise(() => {});
mountTabs('/calendar');

const money = makeMoney(user.locale, user.currency);
const SHOW = 3;                       // chips per day before "+N more"
let data = null;
let month = new URLSearchParams(location.search).get('month') || '';
let picked = '';

const STATE_TEXT = { projected: 'upcoming', pending: 'waiting for approval', posted: 'paid / created', skipped: 'skipped', entered: 'entered' };

function chip(e) {
  const label = `${e.name} ${e.amountMinor < 0 ? '−' : '+'}${money.fmt(e.amountMinor)}`;
  return el('span', {
    className: `ev ${e.kind} ${e.state}${e.overdue ? ' overdue' : ''}`, textContent: label,
    title: `${label} · ${STATE_TEXT[e.state] || e.state}${e.overdue ? ' · overdue' : ''}`,
  });
}

function render() {
  const [y, m] = data.month.split('-').map(Number);
  month = data.month;
  $('cTitle').textContent = monthLabel(data.month, user.locale);
  $('cInc').textContent = money.fmt(data.totals.incomeMinor);
  $('cExp').textContent = money.fmt(data.totals.expenseMinor);
  $('cNet').textContent = money.net(data.totals.netMinor);
  $('cNet').className = data.totals.netMinor < 0 ? 'amt-exp' : '';

  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const grid = $('cGrid');
  grid.textContent = '';
  for (let i = 0; i < 7; i++) {
    grid.append(el('div', { className: 'cal-dow', role: 'columnheader', textContent: new Date(2024, 0, 7 + i).toLocaleDateString(user.locale, { weekday: 'short' }) }));
  }
  const lead = new Date(y, m - 1, 1).getDay();
  for (let i = 0; i < lead; i++) grid.append(el('div', { className: 'cal-cell blank', ariaHidden: 'true' }));
  const last = new Date(y, m, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const date = `${data.month}-${String(d).padStart(2, '0')}`;
    const day = byDate.get(date);
    const cell = el('button', {
      type: 'button',
      className: 'cal-cell' + (date === data.today ? ' today' : '') + (date === picked ? ' picked' : '') + (day ? ' has' : ''),
      ariaLabel: `${dateText(date, user.locale)}${day ? `, ${day.events.length} item${day.events.length === 1 ? '' : 's'}` : ''}`,
    }, el('span', { className: 'cal-num', textContent: String(d) }));
    if (day) {
      const box = el('div', { className: 'cal-evs' });
      day.events.slice(0, SHOW).forEach((e) => box.append(chip(e)));
      if (day.events.length > SHOW) box.append(el('span', { className: 'cal-more', textContent: `+${day.events.length - SHOW} more` }));
      cell.append(box);
    }
    cell.onclick = () => { picked = date; render(); };
    grid.append(cell);
  }
  showDay();
}

function showDay() {
  const day = data.days.find((d) => d.date === picked);
  $('dayPanel').hidden = !picked;
  if (!picked) return;
  $('dayTitle').textContent = dateText(picked, user.locale);
  const list = $('dayList');
  list.textContent = '';
  if (!day) { list.append(el('p', { className: 'empty', textContent: 'Nothing scheduled on this day.' })); return; }
  for (const e of day.events) {
    const actions = [];
    if (e.state === 'pending') {
      const b = el('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: e.amountMinor < 0 ? 'Pay…' : 'Receive…' });
      b.onclick = () => approveDialog({ item: { occurrenceId: e.occurrenceId, name: e.name, dueDate: e.date, amountMinor: e.amountMinor }, money, today: data.today,
        onDone: async () => { toast('✔ Transaction created'); await load(); } });
      actions.push(b);
    }
    list.append(el('div', { className: 'row-item' + (e.state === 'skipped' ? ' dim' : '') },
      el('div', { className: 't-ico', textContent: e.categoryIcon || kindIcon(e.amountMinor) }),
      el('div', { className: 'grow' }, el('b', { textContent: e.name }),
        pill(STATE_TEXT[e.state] || e.state, e.state === 'pending' ? 'warn' : e.state === 'posted' ? 'good' : ''), e.overdue ? pill('overdue', 'warn') : '',
        el('br'), el('small', { textContent: [e.payee, e.accountName, e.categoryName].filter(Boolean).join(' • ') })),
      el('b', { className: e.amountMinor < 0 ? 'amt-exp' : 'amt-inc', textContent: (e.amountMinor < 0 ? '−' : '+') + money.fmt(e.amountMinor) }),
      el('div', { className: 'actions' }, ...actions)));
  }
}

async function load() {
  try {
    const q = new URLSearchParams();
    if (month) q.set('month', month);
    if ($('cAccount').value) q.set('account', $('cAccount').value);
    data = await api('/api/calendar?' + q);
    render();
  } catch (err) { toast(err.message); }
}

$('cPrev').onclick = () => { month = data.prevMonth || month; picked = ''; load(); };
$('cNext').onclick = () => { month = data.nextMonth || month; picked = ''; load(); };
$('cToday').onclick = () => { month = ''; picked = ''; load(); };
$('cAccount').addEventListener('change', load);

try {
  const { accounts } = await api('/api/accounts');
  $('cAccount').append(option('', 'All accounts', true));
  for (const a of accounts) $('cAccount').append(option(a.id, a.name));
} catch (err) { toast(err.message); }
await load();
