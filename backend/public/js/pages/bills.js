import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, option, confirmModal } from '/js/ui.js';
import { makeMoney } from '/js/money.js';
import { mountTabs, dateText, relative, kindIcon, pill, approveDialog, payNextDialog } from '/js/schedcommon.js';

const { user } = await ready;
if (!user) await new Promise(() => {});
mountTabs('/bills');

const money = makeMoney(user.locale, user.currency);
let today = '';

function row(b, { actions = [], right, dim = false, extra = [] } = {}) {
  return el('div', { className: 'row-item' + (dim ? ' dim' : '') },
    el('div', { className: 't-ico', textContent: b.categoryIcon || kindIcon(b.amountMinor) }),
    el('div', { className: 'grow' }, el('b', { textContent: b.name }), ...extra,
      el('br'), el('small', { textContent: [b.payee, b.accountName, b.categoryName].filter(Boolean).join(' • ') })),
    el('div', { className: 'bill-when' }, ...right),
    el('b', { className: 'amt-exp', textContent: money.fmt(b.amountMinor) }),
    el('div', { className: 'actions' }, ...actions));
}

const when = (label, sub, cls = '') => [el('b', { className: cls, textContent: label }), el('br'), el('small', { textContent: sub })];

function payButton(b, seenSchedules) {
  // A waiting bill can always be paid. A future one can only be paid early if it is the schedule's NEXT one.
  const btn = el('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: 'Mark paid' });
  if (b.awaitingApproval) {
    btn.onclick = () => approveDialog({ item: { occurrenceId: b.occurrenceId, name: b.name, dueDate: b.dueDate, amountMinor: b.amountMinor }, money, today,
      onDone: async () => { toast('✔ Marked paid'); await load(); } });
    return btn;
  }
  if (seenSchedules.has(b.scheduleId)) return null;
  seenSchedules.add(b.scheduleId);
  btn.onclick = () => payNextDialog({ item: { scheduleId: b.scheduleId, name: b.name, dueDate: b.dueDate, amountMinor: b.amountMinor }, today,
    onDone: async () => { toast('✔ Marked paid'); await load(); } });
  return btn;
}

function skipButton(b, nextOk) {
  if (!b.awaitingApproval && !nextOk) return null;
  const btn = el('button', { type: 'button', className: 'small-btn', textContent: 'Skip' });
  btn.onclick = () => confirmModal({
    title: 'Skip this bill?', message: `${b.name} (${dateText(b.dueDate, user.locale)}) will be marked as skipped. No transaction is created.`, confirmLabel: 'Skip it', danger: false,
    onConfirm: async () => {
      await api(b.awaitingApproval ? `/api/schedule-occurrences/${b.occurrenceId}/skip` : `/api/schedules/${b.scheduleId}/skip-next`, { method: 'POST' });
      toast('⏭ Skipped'); await load();
    },
  });
  return btn;
}

async function load() {
  let d;
  try {
    const q = new URLSearchParams({ upcomingDays: $('bDays').value });
    if ($('bAccount').value) q.set('account', $('bAccount').value);
    d = await api('/api/bills?' + q);
  } catch (err) { toast(err.message); return; }
  today = d.asOf;
  const t = d.totals;
  $('tOver').textContent = money.fmt(t.overdueMinor);
  $('hOver').textContent = t.overdueCount ? `${t.overdueCount} bill${t.overdueCount === 1 ? '' : 's'} waiting` : 'Nothing overdue';
  $('tUp').textContent = money.fmt(t.upcomingMinor);
  $('hUp').textContent = `${t.upcomingCount} in the next ${d.upcomingDays} days`;
  $('tPaid').textContent = money.fmt(t.paidMinor);
  $('hPaid').textContent = `${t.paidCount} in the last ${d.paidDays} days`;
  $('tSub').textContent = money.fmt(t.subscriptionsMonthlyMinor) + '/mo';
  $('hSub').textContent = `${t.subscriptionCount} repeating, as a monthly cost`;

  $('overPanel').hidden = d.overdue.length === 0;
  $('overList').textContent = '';
  const seen = new Set();
  for (const b of d.overdue) {
    const pay = payButton(b, seen);
    const skip = skipButton(b, false);
    $('overList').append(row(b, {
      right: when(`${-b.daysFromToday} day${b.daysFromToday === -1 ? '' : 's'} overdue`, dateText(b.dueDate, user.locale), 'amt-exp'),
      actions: [pay, skip].filter(Boolean), extra: [pill('overdue', 'warn')],
    }));
  }

  $('upList').textContent = '';
  $('upEmpty').hidden = d.upcoming.length > 0;
  for (const b of d.upcoming) {
    const first = !seen.has(b.scheduleId) || b.awaitingApproval;
    const pay = payButton(b, seen);
    const skip = skipButton(b, first && !b.awaitingApproval);
    $('upList').append(row(b, {
      right: when(b.status === 'due' ? 'Due today' : relative(b.dueDate, today), dateText(b.dueDate, user.locale)),
      actions: [pay, skip].filter(Boolean),
      extra: b.status === 'due' ? [pill('due today', 'warn')] : b.mode === 'auto' ? [pill('auto')] : [],
    }));
  }

  $('paidList').textContent = '';
  $('paidEmpty').hidden = d.paid.length > 0;
  $('paidEmpty').textContent = `No paid bills in the last ${d.paidDays} days.`;
  for (const b of d.paid) {
    $('paidList').append(row(b, {
      right: when('Paid ' + dateText(b.paidDate, user.locale), b.dueDate === b.paidDate ? 'on its due date' : 'due ' + dateText(b.dueDate, user.locale)),
      extra: [pill('paid', 'good')],
      actions: b.transactionId ? [el('a', { className: 'small-btn', href: `/transactions?month=${b.paidDate.slice(0, 7)}`, textContent: 'View' })] : [],
    }));
  }

  $('skipPanel').hidden = d.skipped.length === 0;
  $('skipList').textContent = '';
  for (const b of d.skipped) {
    $('skipList').append(row(b, { dim: true, right: when('Skipped', dateText(b.dueDate, user.locale)) }));
  }
}

$('bDays').addEventListener('change', load);
$('bAccount').addEventListener('change', load);

try {
  const { accounts } = await api('/api/accounts');
  $('bAccount').append(option('', 'All accounts', true));
  for (const a of accounts) $('bAccount').append(option(a.id, a.name));
} catch (err) { toast(err.message); }
await load();
