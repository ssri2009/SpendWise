'use strict';
// Read-only views built on schedules: the event list, the bills tracker, the calendar and the cash-flow forecast.
// Nothing here writes. Every query starts from user_id = ?, so a user can only ever see their own schedules and forecasts.
//
// An EVENT is one dated amount that has happened or is going to:
//   state "projected"  a future occurrence of an active schedule (not in your transactions yet)
//   state "pending"    it arrived, you chose "ask me first", and it waits for approval (not in your transactions yet)
//   state "posted"     a transaction was created for it            state "skipped"  you skipped it
//   source "ledger"    a transaction you already entered with a FUTURE date (only used by the forecast)
// Money in the forecast = events that are NOT in your transactions yet. Posted and skipped events are never counted
// (posted ones are already in your balance), so nothing is counted twice.

const { httpError } = require('./http');
const v = require('./validate');
const RC = require('./recurrence');
const B = require('./budget');

const DAY_CHOICES = [7, 30, 90];
const MAX_DAYS = 365;
const EVENT_CAP = 5000;            // events looked at per call (a safety net, e.g. 500 daily schedules)
const PER_SCHEDULE_CAP = 400;
const MAX_IMPACT_MONTHS = 14;

/* ------------------------------ lookups (one user's names) ------------------------------ */

function lookups(db, userId) {
  const accounts = new Map(db.prepare('SELECT id, name, offbudget, closed FROM accounts WHERE user_id = ?').all(userId)
    .map((a) => [Number(a.id), { name: a.name, offBudget: !!a.offbudget, closed: !!a.closed }]));
  const cats = new Map(db.prepare(
    `SELECT c.id, c.name, c.icon, g.name AS group_name, g.is_income FROM categories c JOIN category_groups g ON g.id = c.group_id
      WHERE c.user_id = ?`).all(userId).map((c) => [Number(c.id), { name: c.name, icon: c.icon, groupName: c.group_name, isIncome: !!c.is_income }]));
  const payees = new Map(db.prepare('SELECT id, name FROM payees WHERE user_id = ?').all(userId).map((p) => [Number(p.id), p.name]));
  return { accounts, cats, payees };
}

function makeEvent(L, s, { date, state, occurrenceId = null, amountMinor, transactionId = null, note = '' }, today) {
  const cat = s.category_id === null ? null : L.cats.get(Number(s.category_id));
  const acct = L.accounts.get(Number(s.account_id)) || { name: '', offBudget: false };
  return {
    key: `s${s.id}:${date}`,
    source: 'schedule',
    scheduleId: Number(s.id),
    occurrenceId,
    transactionId,
    date,
    name: s.name,
    payee: s.payee_id === null ? '' : (L.payees.get(Number(s.payee_id)) || ''),
    categoryId: s.category_id === null ? null : Number(s.category_id),
    categoryName: cat ? cat.name : null,
    categoryIcon: cat ? cat.icon : null,
    accountId: Number(s.account_id),
    accountName: acct.name,
    offBudget: acct.offBudget,
    amountMinor,
    kind: amountMinor < 0 ? 'expense' : 'income',
    state,
    overdue: state === 'pending' && today !== null && date < today,
    mode: s.mode,
    note,
  };
}

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

/**
 * Schedule events between two dates (inclusive).
 *   statuses: which STORED occurrences to include ('pending' | 'posted' | 'skipped')
 *   projected: also include future occurrences of active (not paused) schedules
 *   pendingAnyDate: include pending occurrences even when their due date is before `from` (they are still waiting)
 */
function scheduleEvents(db, userId, today, { from, to, statuses = ['pending', 'posted', 'skipped'], projected = true, pendingAnyDate = false, accountId = null }) {
  const L = lookups(db, userId);
  const events = [];
  let truncated = false;

  const schedules = new Map(db.prepare('SELECT * FROM schedules WHERE user_id = ?').all(userId).map((s) => [Number(s.id), s]));

  const stored = db.prepare(
    `SELECT o.id, o.schedule_id, o.due_date, o.status, o.amount_minor, o.transaction_id, o.note FROM schedule_occurrences o
      WHERE o.user_id = ? AND (o.due_date BETWEEN ? AND ? ${pendingAnyDate ? "OR o.status = 'pending'" : ''})
      ORDER BY o.due_date, o.id LIMIT ?`
  ).all(userId, from, to, EVENT_CAP);
  const have = new Set();
  for (const o of stored) {
    have.add(`${o.schedule_id}|${o.due_date}`);
    const s = schedules.get(Number(o.schedule_id));
    if (!s || !statuses.includes(o.status)) continue;
    if (accountId !== null && Number(s.account_id) !== accountId) continue;
    events.push(makeEvent(L, s, {
      date: o.due_date, state: o.status, occurrenceId: Number(o.id), amountMinor: Number(o.amount_minor),
      transactionId: o.transaction_id === null ? null : Number(o.transaction_id), note: o.note,
    }, today));
  }

  if (projected) {
    for (const s of schedules.values()) {
      if (s.paused || s.next_date === null) continue;
      if (accountId !== null && Number(s.account_id) !== accountId) continue;
      const rule = { frequency: s.frequency, n: Number(s.interval_n), unit: s.interval_unit };
      const hits = RC.occurrencesInRange(s.start_date, rule, s.end_date, Number(s.occ_index), from, to, PER_SCHEDULE_CAP);
      if (hits.length === PER_SCHEDULE_CAP) truncated = true;
      for (const h of hits) {
        if (have.has(`${s.id}|${h.date}`)) continue;     // that date already has its own occurrence
        if (events.length >= EVENT_CAP) { truncated = true; break; }
        events.push(makeEvent(L, s, { date: h.date, state: 'projected', amountMinor: Number(s.amount_minor) }, today));
      }
    }
  }
  events.sort(byDate);
  return { events, truncated, lookups: L };
}

/* ------------------------------ money now ------------------------------ */

function accountScope(db, userId, accountId) {
  if (accountId === null) return null;
  if (!db.prepare('SELECT 1 FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId)) throw httpError(404, 'Account not found.');
  return accountId;
}

/** What you hold on `today`: opening balances + every transaction dated today or earlier (future-dated ones are "upcoming"). */
function fundsOn(db, userId, today, accountId) {
  const a = accountId === null ? '' : ' AND id = ?';
  const t = accountId === null ? '' : ' AND account_id = ?';
  const extra = accountId === null ? [] : [accountId];
  const opening = db.prepare(`SELECT COALESCE(SUM(opening_balance_minor), 0) AS s FROM accounts WHERE user_id = ?${a}`).get(userId, ...extra).s;
  const moved = db.prepare(`SELECT COALESCE(SUM(amount_minor), 0) AS s FROM transactions WHERE user_id = ? AND date <= ?${t}`).get(userId, today, ...extra).s;
  return Number(opening) + Number(moved);
}

/* ------------------------------ forecast ------------------------------ */

function ledgerFuture(db, userId, L, today, to, accountId) {
  const rows = db.prepare(
    `SELECT t.id, t.account_id, t.date, t.amount_minor, t.payee_id, t.category_id, t.notes, t.is_split
       FROM transactions t WHERE t.user_id = ? AND t.date > ? AND t.date <= ? ${accountId === null ? '' : 'AND t.account_id = ?'}
      ORDER BY t.date, t.id LIMIT ?`
  ).all(userId, today, to, ...(accountId === null ? [] : [accountId]), EVENT_CAP);
  return rows.map((t) => {
    const cat = t.category_id === null ? null : L.cats.get(Number(t.category_id));
    const acct = L.accounts.get(Number(t.account_id)) || { name: '', offBudget: false };
    const payee = t.payee_id === null ? '' : (L.payees.get(Number(t.payee_id)) || '');
    const amountMinor = Number(t.amount_minor);
    return {
      key: `t${t.id}`, source: 'ledger', scheduleId: null, occurrenceId: null, transactionId: Number(t.id),
      date: t.date, name: payee || t.notes || 'Transaction', payee,
      categoryId: t.category_id === null ? null : Number(t.category_id), categoryName: t.is_split ? 'Split' : (cat ? cat.name : null),
      categoryIcon: cat ? cat.icon : null, accountId: Number(t.account_id), accountName: acct.name, offBudget: acct.offBudget,
      amountMinor, kind: amountMinor < 0 ? 'expense' : 'income', state: 'entered', overdue: false, mode: null, note: '',
    };
  });
}

function parseDays(raw) {
  if (raw === null || raw === undefined || raw === '') return 30;
  if (!/^\d{1,4}$/.test(String(raw))) throw v.bad('days must be a whole number from 1 to 365.');
  const n = Number(raw);
  if (n < 1 || n > MAX_DAYS) throw v.bad('days must be a whole number from 1 to 365.');
  return n;
}

/** Cash-flow forecast for 7 / 30 / 90 days (or any 1 to 365). */
function forecast(db, userId, today, { days = 30, accountId = null } = {}) {
  accountId = accountScope(db, userId, accountId);
  const horizon = Math.max(90, days);
  const end = RC.addDays(today, horizon);

  const sched = scheduleEvents(db, userId, today, { from: today, to: end, statuses: ['pending'], projected: true, pendingAnyDate: true, accountId });
  const ledger = ledgerFuture(db, userId, sched.lookups, today, end, accountId);
  const all = [...sched.events, ...ledger];
  for (const e of all) {
    e.dueDate = e.date;
    if (e.date < today) e.date = today;                     // still waiting: it will hit your balance when you approve it
  }
  all.sort(byDate);

  const current = fundsOn(db, userId, today, accountId);

  // Day-by-day balance for the whole horizon, then slice it for 7 / 30 / 90 / chosen.
  const perDay = new Map();
  for (const e of all) {
    const d = perDay.get(e.date) || { income: 0, expense: 0 };
    if (e.amountMinor > 0) d.income += e.amountMinor; else d.expense += -e.amountMinor;
    perDay.set(e.date, d);
  }
  const timeline = [];
  let bal = current;
  for (let i = 0; i <= horizon; i++) {
    const date = RC.addDays(today, i);
    const d = perDay.get(date) || { income: 0, expense: 0 };
    bal += d.income - d.expense;
    timeline.push({ date, balanceMinor: bal, incomeMinor: d.income, expenseMinor: d.expense });
  }

  const summarise = (n) => {
    const last = RC.addDays(today, n);
    const slice = timeline.filter((t) => t.date <= last);
    const income = slice.reduce((s, t) => s + t.incomeMinor, 0);
    const expense = slice.reduce((s, t) => s + t.expenseMinor, 0);
    let low = slice[0];
    for (const t of slice) if (t.balanceMinor < low.balanceMinor) low = t;
    const neg = slice.find((t) => t.balanceMinor < 0);
    return {
      days: n, endDate: last,
      currentFundsMinor: current, upcomingIncomeMinor: income, upcomingExpensesMinor: expense,
      estimatedBalanceMinor: current + income - expense,
      lowestBalanceMinor: low.balanceMinor, lowestDate: low.date,
      firstNegativeDate: neg ? neg.date : null,
    };
  };

  const chosen = summarise(days);
  const last = chosen.endDate;
  const events = all.filter((e) => e.date <= last);
  return {
    asOf: today,
    accountId,
    ...chosen,
    events,
    timeline: timeline.filter((t) => t.date <= last),
    horizons: DAY_CHOICES.map(summarise),
    categoryImpact: budgetImpact(db, userId, events.filter((e) => e.source === 'schedule')),
    truncated: sched.truncated,
  };
}

/* ------------------------------ budget impact ------------------------------ */

/**
 * What the SCHEDULED events (not transactions you already entered, those are in the budget already) do to the envelope
 * budget, month by month. Events in off-budget accounts never touch the budget, so they are left out here.
 *
 * It uses the budget engine itself: the scheduled events are added, as if they were transactions, to a COPY of the engine's
 * facts and the same month-by-month roll is run twice (without and with them). So carry-over, "roll over overspending" and the
 * overspending deducted from next month's To Budget all behave exactly as they will when the transactions really exist,
 * and an overspent November correctly shows up in December.
 */
function budgetImpact(db, userId, schedEvents) {
  const onBudget = schedEvents.filter((e) => !e.offBudget);
  const L = lookups(db, userId);
  const byMonth = new Map();
  for (const e of onBudget) {
    const m = e.dueDate.slice(0, 7);
    if (!B.isMonth(m)) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(e);
  }
  const months = [...byMonth.keys()].sort().slice(0, MAX_IMPACT_MONTHS);
  const offBudgetEvents = schedEvents.length - onBudget.length;
  if (!months.length) return { months: [], categories: [], offBudgetEvents, overspentCategories: 0 };

  const now = B.loadFacts(db, userId);                       // the ledger as it is today
  const later = {                                            // ...plus the scheduled money
    ...now,
    activity: new Map(now.activity), income: new Map(now.income),
    uncategorized: new Map(now.uncategorized), uncategorizedSpend: new Map(now.uncategorizedSpend),
  };
  const idx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  const add = (map, key, n) => map.set(key, (map.get(key) || 0) + n);
  const sums = new Map();                                    // month -> { income, uncategorized }
  for (const month of months) {
    sums.set(month, { income: 0, uncategorized: 0 });
    for (const e of byMonth.get(month)) {
      const cat = e.categoryId === null ? null : now.cats.get(e.categoryId);
      const sm = sums.get(month);
      if (!cat) {                                            // mirrors loadFacts: no category -> income if positive, else spent out of To Budget
        if (e.amountMinor > 0) { add(later.income, month, e.amountMinor); sm.income += e.amountMinor; }
        else { add(later.uncategorized, month, 1); add(later.uncategorizedSpend, month, -e.amountMinor); sm.uncategorized += -e.amountMinor; }
      } else if (cat.isIncome) {
        add(later.income, month, e.amountMinor); sm.income += e.amountMinor;
      } else {
        add(later.activity, `${month}|${cat.id}`, e.amountMinor);
      }
    }
  }
  later.firstIdx = Math.min(now.firstIdx === null ? Infinity : now.firstIdx, ...months.map(idx));
  later.lastIdx = Math.max(now.lastIdx === null ? -Infinity : now.lastIdx, ...months.map(idx));

  const totals = new Map();
  const out = months.map((month) => {
    const before = B.simulate(now, month).detail;
    const after = B.simulate(later, month).detail;
    const beforeRow = new Map(before.rows.map((r) => [r.cat.id, r]));
    const afterRow = new Map(after.rows.map((r) => [r.cat.id, r]));
    const perCat = new Map();
    for (const e of byMonth.get(month)) {
      const cat = e.categoryId === null ? null : now.cats.get(e.categoryId);
      if (!cat || cat.isIncome) continue;
      const p = perCat.get(cat.id) || { scheduled: 0, count: 0 };
      p.scheduled += e.amountMinor; p.count += 1;
      perCat.set(cat.id, p);
      const t = totals.get(cat.id) || { scheduledMinor: 0, count: 0 };
      t.scheduledMinor += e.amountMinor; t.count += 1;
      totals.set(cat.id, t);
    }
    const categories = [...perCat.entries()].map(([id, p]) => {
      const c = L.cats.get(id);
      const b = beforeRow.get(id);
      const a = afterRow.get(id);
      const projected = a ? a.available : 0;
      return {
        categoryId: id, name: c.name, icon: c.icon, groupName: c.groupName,
        scheduledMinor: p.scheduled, count: p.count,
        assignedMinor: b ? b.assigned : 0, availableMinor: b ? b.available : 0, projectedAvailableMinor: projected,
        overspent: projected < 0, shortfallMinor: projected < 0 ? -projected : 0,
      };
    }).sort((x, y) => x.scheduledMinor - y.scheduledMinor);
    const sm = sums.get(month);
    return {
      month,
      toBudgetMinor: before.toBudget,
      scheduledIncomeMinor: sm.income,
      scheduledUncategorizedExpenseMinor: sm.uncategorized,
      projectedToBudgetMinor: after.toBudget,
      categories,
    };
  });

  const categoryTotals = [...totals.entries()].map(([id, t]) => {
    const c = L.cats.get(id);
    return { categoryId: id, name: c.name, icon: c.icon, groupName: c.groupName, scheduledMinor: t.scheduledMinor, count: t.count };
  }).sort((a, b) => a.scheduledMinor - b.scheduledMinor);

  return {
    months: out,
    categories: categoryTotals,
    offBudgetEvents,
    overspentCategories: out.reduce((n, m) => n + m.categories.filter((c) => c.overspent).length, 0),
  };
}

/* ------------------------------ bills ------------------------------ */

/**
 * Bills = schedules that spend money. Overdue: arrived, waiting for you, due date passed. Due / upcoming: coming up.
 * Paid: a transaction was created for it. Auto-posted bills are paid the moment their date arrives.
 */
function bills(db, userId, today, { upcomingDays = 30, paidDays = 60, accountId = null } = {}) {
  accountId = accountScope(db, userId, accountId);
  const horizonEnd = RC.addDays(today, upcomingDays);
  const sched = scheduleEvents(db, userId, today, { from: today, to: horizonEnd, statuses: ['pending'], projected: true, pendingAnyDate: true, accountId });
  const expenses = sched.events.filter((e) => e.amountMinor < 0);

  const toBill = (e, status) => ({
    scheduleId: e.scheduleId, occurrenceId: e.occurrenceId, name: e.name, payee: e.payee, categoryName: e.categoryName, categoryIcon: e.categoryIcon,
    accountName: e.accountName, dueDate: e.date, amountMinor: e.amountMinor, status,
    awaitingApproval: e.state === 'pending', mode: e.mode,
    daysFromToday: RC.daysBetween(today, e.date),
    note: e.note,
  });
  const overdue = expenses.filter((e) => e.state === 'pending' && e.date < today).map((e) => toBill(e, 'overdue'));
  const upcoming = expenses.filter((e) => !(e.state === 'pending' && e.date < today))
    .map((e) => toBill(e, e.date === today ? 'due' : 'upcoming'));

  const since = RC.addDays(today, -paidDays);
  const accountSql = accountId === null ? '' : ' AND s.account_id = ?';
  const args = accountId === null ? [] : [accountId];
  const settled = (status) => db.prepare(
    `SELECT o.id, o.schedule_id, o.due_date, o.amount_minor, o.transaction_id, s.name, s.account_id, a.name AS account_name,
            p.name AS payee_name, c.name AS category_name, c.icon AS category_icon, t.date AS tx_date, t.amount_minor AS tx_amount
       FROM schedule_occurrences o
       JOIN schedules s ON s.id = o.schedule_id AND s.user_id = o.user_id
       JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id
       LEFT JOIN payees p ON p.id = s.payee_id AND p.user_id = s.user_id
       LEFT JOIN categories c ON c.id = s.category_id AND c.user_id = s.user_id
       LEFT JOIN transactions t ON t.id = o.transaction_id AND t.user_id = o.user_id
      WHERE o.user_id = ? AND o.status = ? AND o.amount_minor < 0 AND COALESCE(t.date, o.due_date) >= ?${accountSql}
      ORDER BY COALESCE(t.date, o.due_date) DESC, o.id DESC LIMIT 200`
  ).all(userId, status, since, ...args);

  const paid = settled('posted').map((r) => ({
    scheduleId: Number(r.schedule_id), occurrenceId: Number(r.id), name: r.name, payee: r.payee_name || '',
    categoryName: r.category_name || null, categoryIcon: r.category_icon || null, accountName: r.account_name,
    dueDate: r.due_date, paidDate: r.tx_date || r.due_date,
    amountMinor: r.tx_amount === null ? Number(r.amount_minor) : Number(r.tx_amount),
    transactionId: r.transaction_id === null ? null : Number(r.transaction_id), status: 'paid',
  }));
  const skipped = settled('skipped').map((r) => ({
    scheduleId: Number(r.schedule_id), occurrenceId: Number(r.id), name: r.name, dueDate: r.due_date,
    amountMinor: Number(r.amount_minor), accountName: r.account_name, status: 'skipped',
  }));

  const subs = db.prepare(
    `SELECT amount_minor, frequency, interval_n, interval_unit FROM schedules
      WHERE user_id = ? AND amount_minor < 0 AND paused = 0 AND next_date IS NOT NULL AND frequency != 'once'${accountId === null ? '' : ' AND account_id = ?'}`
  ).all(userId, ...args);
  const subscriptionsMonthly = subs.reduce((n, s) => n + RC.monthlyEquivalent(Number(s.amount_minor),
    { frequency: s.frequency, n: Number(s.interval_n), unit: s.interval_unit }), 0);

  const sum = (list) => list.reduce((n, b) => n - b.amountMinor, 0);
  return {
    asOf: today, upcomingDays, paidDays, accountId,
    overdue, upcoming, paid, skipped,
    totals: {
      overdueMinor: sum(overdue), overdueCount: overdue.length,
      upcomingMinor: sum(upcoming), upcomingCount: upcoming.length,
      paidMinor: sum(paid), paidCount: paid.length,
      subscriptionsMonthlyMinor: subscriptionsMonthly, subscriptionCount: subs.length,
    },
    truncated: sched.truncated,
  };
}

/* ------------------------------ calendar ------------------------------ */

function calendar(db, userId, today, month, { accountId = null } = {}) {
  B.needMonth(month);
  accountId = accountScope(db, userId, accountId);
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(RC.daysInMonth(y, m)).padStart(2, '0')}`;
  const sched = scheduleEvents(db, userId, today, { from, to, projected: true, accountId });
  const days = new Map();
  let income = 0;
  let expense = 0;
  for (const e of sched.events) {
    if (e.date < from || e.date > to) continue;
    if (!days.has(e.date)) days.set(e.date, []);
    days.get(e.date).push(e);
    if (e.state === 'skipped') continue;
    if (e.amountMinor > 0) income += e.amountMinor; else expense += -e.amountMinor;
  }
  return {
    month, today, from, to, accountId,
    prevMonth: B.addMonths(month, -1), nextMonth: B.addMonths(month, 1),
    days: [...days.entries()].map(([date, events]) => ({
      date, events,
      incomeMinor: events.filter((e) => e.state !== 'skipped' && e.amountMinor > 0).reduce((n, e) => n + e.amountMinor, 0),
      expenseMinor: events.filter((e) => e.state !== 'skipped' && e.amountMinor < 0).reduce((n, e) => n - e.amountMinor, 0),
    })),
    totals: { incomeMinor: income, expenseMinor: expense, netMinor: income - expense },
    truncated: sched.truncated,
  };
}

module.exports = { DAY_CHOICES, MAX_DAYS, parseDays, scheduleEvents, fundsOn, forecast, budgetImpact, bills, calendar };
