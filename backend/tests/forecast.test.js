'use strict';
// Phase 6: forecasting, bills tracking, calendar and the budget impact of scheduled money. R(n) = n rupees (paise).
// Today is pinned to 2026-11-15 (a Sunday). Every expected number below was worked out by hand from the dates.
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, newUser, tx } = require('./helpers');

const R = (n) => n * 100;
const TODAY = '2026-11-15';

const boot = () => start({ TODAY });
const setToday = (s, d) => { s.server.clock.fixed = d; };
const mk = async (c, over = {}) => {
  const r = await c.post('/api/schedules', {
    accountId: c.accountId, payee: 'Netflix', categoryId: c.cat.Bills, amountMinor: -R(649),
    startDate: '2026-12-01', frequency: 'monthly', mode: 'approval', ...over,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.schedule;
};
const forecast = async (c, qs = '') => {
  const r = await c.get('/api/forecast' + qs);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.forecast;
};
const bills = async (c, qs = '') => (await c.get('/api/bills' + qs)).data;
const occs = async (c, status = 'pending') => (await c.get(`/api/schedule-occurrences?status=${status}`)).data.occurrences;
const give = (c, amount, over = {}) => tx(c, { amountMinor: amount, date: TODAY, payee: 'Opening', categoryId: c.cat.Salary, ...over });

/** The standard picture: R1,000 in hand; rent R300 monthly from Nov 20; salary R500 monthly from Nov 25; internet R10 weekly from Nov 16. */
async function scenario(c) {
  await give(c, R(1000));
  await mk(c, { payee: 'Landlord', name: 'Rent', amountMinor: -R(300), startDate: '2026-11-20' });
  await mk(c, { payee: 'Acme', name: 'Salary', amountMinor: R(500), categoryId: c.cat.Salary, startDate: '2026-11-25' });
  await mk(c, { payee: 'ISP', name: 'Internet', amountMinor: -R(10), startDate: '2026-11-16', frequency: 'weekly' });
}

/* --------------------------------- forecast numbers --------------------------------- */

test('forecast for 7, 30 and 90 days: current funds, upcoming income, upcoming expenses, estimated balance', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await scenario(c);
    const f = await forecast(c);                                 // default 30 days
    assert.equal(f.currentFundsMinor, R(1000));
    assert.equal(f.asOf, TODAY);
    assert.deepEqual(f.horizons.map((h) => h.days), [7, 30, 90]);

    const [d7, d30, d90] = f.horizons;
    // 7 days (to Nov 22): rent Nov 20 (300) + internet Nov 16 (10)
    assert.deepEqual([d7.endDate, d7.upcomingIncomeMinor, d7.upcomingExpensesMinor, d7.estimatedBalanceMinor], ['2026-11-22', 0, R(310), R(690)]);
    // 30 days (to Dec 15): rent Nov 20; salary Nov 25; internet Nov 16, 23, 30, Dec 7, 14 (5 x 10)
    assert.deepEqual([d30.endDate, d30.upcomingIncomeMinor, d30.upcomingExpensesMinor, d30.estimatedBalanceMinor], ['2026-12-15', R(500), R(350), R(1150)]);
    // 90 days (to Feb 13): rent x3 (900); salary x3 (1500); internet x13 (130)
    assert.deepEqual([d90.endDate, d90.upcomingIncomeMinor, d90.upcomingExpensesMinor, d90.estimatedBalanceMinor], ['2027-02-13', R(1500), R(1030), R(1470)]);
    for (const h of f.horizons) assert.equal(h.currentFundsMinor, R(1000));

    // the selected horizon is the same numbers, plus its events and day-by-day balance
    assert.equal(f.days, 30);
    assert.equal(f.estimatedBalanceMinor, R(1150));
    assert.equal(f.upcomingIncomeMinor, R(500));
    assert.equal(f.events.length, 1 + 1 + 5);
    assert.equal(f.timeline.length, 31);
    assert.deepEqual(f.timeline[0], { date: TODAY, balanceMinor: R(1000), incomeMinor: 0, expenseMinor: 0 });
    assert.equal(f.timeline[30].balanceMinor, R(1150));
    assert.equal(f.timeline.find((t) => t.date === '2026-11-20').balanceMinor, R(1000) - R(10) - R(300), 'rent day');
    assert.equal(f.timeline.find((t) => t.date === '2026-11-25').incomeMinor, R(500));
    // each event says what it is
    const rent = f.events.find((e) => e.name === 'Rent');
    assert.deepEqual([rent.date, rent.amountMinor, rent.kind, rent.state, rent.categoryName], ['2026-11-20', -R(300), 'expense', 'projected', 'Bills']);
    assert.equal(f.events.find((e) => e.name === 'Salary').kind, 'income');

    const week = await forecast(c, '?days=7');
    assert.equal(week.estimatedBalanceMinor, R(690));
    assert.equal(week.timeline.length, 8);
    assert.deepEqual([week.lowestBalanceMinor, week.lowestDate, week.firstNegativeDate], [R(690), '2026-11-20', null]);
  } finally { await s.close(); }
});

test('forecast warns when the balance is going to go below zero', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await give(c, R(100));
    await mk(c, { payee: 'Rent', amountMinor: -R(300), startDate: '2026-11-20' });
    const f = await forecast(c, '?days=30');
    assert.equal(f.estimatedBalanceMinor, -R(200));
    assert.equal(f.firstNegativeDate, '2026-11-20');
    assert.deepEqual([f.lowestBalanceMinor, f.lowestDate], [-R(200), '2026-11-20']);
  } finally { await s.close(); }
});

test('paused and finished schedules are not in the forecast', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await give(c, R(1000));
    const rent = await mk(c, { payee: 'Rent', amountMinor: -R(300), startDate: '2026-11-20' });
    const gym = await mk(c, { payee: 'Gym', amountMinor: -R(50), startDate: '2026-11-18' });
    assert.equal((await forecast(c, '?days=7')).upcomingExpensesMinor, R(350));
    await c.post(`/api/schedules/${gym.id}/pause`, {});
    assert.equal((await forecast(c, '?days=7')).upcomingExpensesMinor, R(300));
    await c.post(`/api/schedules/${rent.id}/skip-next`, {});         // rent's Nov 20 skipped: the next is Dec 20
    assert.equal((await forecast(c, '?days=7')).upcomingExpensesMinor, 0);
    assert.equal((await forecast(c, '?days=90')).upcomingExpensesMinor, R(600), 'Dec 20 and Jan 20');
    await c.post(`/api/schedules/${gym.id}/resume`, {});
    assert.equal((await forecast(c, '?days=7')).upcomingExpensesMinor, R(50));
  } finally { await s.close(); }
});

test('a waiting bill counts in the forecast, and paying it never counts it twice', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await give(c, R(1000));
    await mk(c, { payee: 'Electricity', amountMinor: -R(200), startDate: '2026-11-10' });      // arrived 5 days ago, waiting
    const before = await forecast(c, '?days=7');
    assert.equal(before.currentFundsMinor, R(1000), 'it is not in your balance yet');
    assert.equal(before.upcomingExpensesMinor, R(200));
    assert.equal(before.estimatedBalanceMinor, R(800));
    const ev = before.events[0];
    assert.deepEqual([ev.state, ev.overdue, ev.date, ev.dueDate], ['pending', true, TODAY, '2026-11-10'], 'an overdue bill hits your balance as soon as you pay it');

    const o = (await occs(c))[0];
    await c.post(`/api/schedule-occurrences/${o.id}/approve`, { date: '2026-11-12' });
    const after = await forecast(c, '?days=7');
    assert.equal(after.currentFundsMinor, R(800), 'now it is in your balance...');
    assert.equal(after.upcomingExpensesMinor, 0, '...and no longer upcoming');
    assert.equal(after.estimatedBalanceMinor, R(800), 'so the estimate is unchanged: nothing was counted twice');
  } finally { await s.close(); }
});

test('the same goes for auto-posted schedules and for paying the next bill early', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await give(c, R(1000));
    const id = (await mk(c, { payee: 'Rent', amountMinor: -R(300), startDate: '2026-11-20', mode: 'auto' })).id;
    const before = (await forecast(c, '?days=7')).estimatedBalanceMinor;
    assert.equal(before, R(700));
    await c.post(`/api/schedules/${id}/post-next`, {});
    const after = await forecast(c, '?days=7');
    assert.deepEqual([after.currentFundsMinor, after.upcomingExpensesMinor, after.estimatedBalanceMinor], [R(700), 0, R(700)]);

    setToday(s, '2026-12-20');                                           // auto: Dec 20 is created by itself
    const later = await forecast(c, '?days=7');
    assert.equal(later.currentFundsMinor, R(400));
    assert.equal(later.estimatedBalanceMinor, R(400));
  } finally { await s.close(); }
});

test('transactions you already entered with a future date are upcoming money, not current funds', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await give(c, R(1000));
    await tx(c, { amountMinor: -R(100), date: '2026-11-18', payee: 'Dentist', categoryId: c.cat.Other });
    await tx(c, { amountMinor: R(40), date: '2026-12-30', payee: 'Refund', categoryId: c.cat.Other });      // beyond 30 days
    const f = await forecast(c, '?days=30');
    assert.equal(f.currentFundsMinor, R(1000));
    assert.equal(f.upcomingExpensesMinor, R(100));
    assert.equal(f.upcomingIncomeMinor, 0);
    assert.deepEqual(f.events.map((e) => [e.source, e.name]), [['ledger', 'Dentist']]);
    assert.equal((await forecast(c, '?days=90')).upcomingIncomeMinor, R(40));
  } finally { await s.close(); }
});

test('account filter: opening balances, events and the answer are limited to that account', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const sav = (await c.post('/api/accounts', { name: 'Savings', openingBalanceMinor: R(500) })).data.account;
    await give(c, R(1000));
    await mk(c, { payee: 'Rent', amountMinor: -R(300), startDate: '2026-11-20' });
    await mk(c, { payee: 'SIP', amountMinor: -R(100), startDate: '2026-11-21', accountId: sav.id });
    const all = await forecast(c, '?days=7');
    assert.deepEqual([all.currentFundsMinor, all.upcomingExpensesMinor], [R(1500), R(400)]);
    const one = await forecast(c, `?days=7&account=${sav.id}`);
    assert.deepEqual([one.currentFundsMinor, one.upcomingExpensesMinor, one.estimatedBalanceMinor, one.accountId], [R(500), R(100), R(400), sav.id]);
    const other = await newUser(s.base, 'b@example.com');
    assert.equal((await c.get(`/api/forecast?account=${other.accountId}`)).status, 404, "someone else's account");
    assert.equal((await c.get('/api/forecast?account=abc')).status, 400);
  } finally { await s.close(); }
});

test('the days parameter is validated', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    for (const bad of ['0', '366', 'abc', '-5', '1.5', '10000']) assert.equal((await c.get(`/api/forecast?days=${bad}`)).status, 400, bad);
    const one = await forecast(c, '?days=1');
    assert.equal(one.timeline.length, 2);
    assert.equal((await forecast(c, '?days=365')).timeline.length, 366);
    const empty = await forecast(c, '');
    assert.deepEqual([empty.currentFundsMinor, empty.upcomingIncomeMinor, empty.upcomingExpensesMinor, empty.estimatedBalanceMinor], [0, 0, 0, 0]);
  } finally { await s.close(); }
});

/* --------------------------------- budget impact --------------------------------- */

test('scheduled spending shows its category impact against what is available in the envelope', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await give(c, R(1000));
    await c.patch(`/api/budget/2026-11/categories/${c.cat.Bills}`, { assignedMinor: R(200) });
    await mk(c, { payee: 'Landlord', name: 'Rent', amountMinor: -R(300), startDate: '2026-11-20' });                      // Bills
    await mk(c, { payee: 'Zomato', name: 'Meal plan', amountMinor: -R(50), categoryId: c.cat.Food, startDate: '2026-11-22' });
    await mk(c, { payee: 'Tea', name: 'Tea stall', amountMinor: -R(20), categoryId: null, startDate: '2026-11-23' });      // uncategorized
    await mk(c, { payee: 'Acme', name: 'Salary', amountMinor: R(500), categoryId: c.cat.Salary, startDate: '2026-11-25' });  // income

    const impact = (await forecast(c, '?days=7')).categoryImpact;
    assert.deepEqual(impact.months.map((m) => m.month), ['2026-11']);
    const nov = impact.months[0];
    assert.equal(nov.toBudgetMinor, R(1000) - R(200));
    const bills = nov.categories.find((x) => x.name === 'Bills');
    assert.deepEqual([bills.assignedMinor, bills.availableMinor, bills.scheduledMinor, bills.projectedAvailableMinor, bills.overspent, bills.shortfallMinor],
      [R(200), R(200), -R(300), -R(100), true, R(100)], 'R200 in the envelope, R300 coming: short by R100');
    const food = nov.categories.find((x) => x.name === 'Food');
    assert.deepEqual([food.availableMinor, food.scheduledMinor, food.projectedAvailableMinor, food.overspent], [0, -R(50), -R(50), true]);
    assert.equal(nov.categories.length, 2, 'only categories with scheduled money are listed');
    assert.equal(nov.scheduledIncomeMinor, 0, 'the Nov 25 salary is outside a 7 day window');

    // 60 days: November AND December. December is chained from November by the budget engine itself.
    const wide = (await forecast(c, '?days=60')).categoryImpact;
    assert.deepEqual(wide.months.map((m) => m.month), ['2026-11', '2026-12']);
    const nov60 = wide.months[0];
    assert.equal(nov60.scheduledIncomeMinor, R(500));
    assert.equal(nov60.scheduledUncategorizedExpenseMinor, R(20), 'no category: comes straight out of To Budget');
    assert.equal(nov60.projectedToBudgetMinor, R(800) + R(500) - R(20));
    const dec = wide.months[1];
    const decBills = dec.categories.find((x) => x.name === 'Bills');
    assert.equal(decBills.availableMinor, R(200), 'as the ledger stands, November\'s unspent R200 carries into December');
    assert.equal(decBills.scheduledMinor, -R(300), 'rent Dec 20');
    assert.equal(decBills.projectedAvailableMinor, -R(300), 'but November\'s rent uses that R200 up, and overspending does not carry: December starts from zero');
    assert.equal(dec.toBudgetMinor, R(800));
    // To Budget in December: leftover 1280 + salary 500 - tea 20 - last month's overspending (Bills 100 + Food 50)
    assert.equal(dec.projectedToBudgetMinor, R(1280) + R(500) - R(20) - R(150));
    assert.equal(wide.overspentCategories, 4, 'Bills and Food, in both months');
    assert.deepEqual(wide.categories.map((x) => [x.name, x.scheduledMinor]), [['Bills', -R(600)], ['Food', -R(100)]]);
  } finally { await s.close(); }
});

test('envelope impact: money already in the ledger is not counted twice, and off-budget accounts are left out', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await give(c, R(1000));
    await c.patch(`/api/budget/2026-11/categories/${c.cat.Bills}`, { assignedMinor: R(200) });
    await mk(c, { payee: 'Landlord', name: 'Rent', amountMinor: -R(300), startDate: '2026-11-20' });
    await tx(c, { amountMinor: -R(10), date: '2026-11-18', payee: 'Water', categoryId: c.cat.Bills });   // already entered, future-dated
    const inv = (await c.post('/api/accounts', { name: 'Investments', offbudget: true, openingBalanceMinor: R(100) })).data.account;
    await mk(c, { payee: 'Broker', name: 'SIP', amountMinor: -R(999), accountId: inv.id, startDate: '2026-11-21' });

    const f = await forecast(c, '?days=7');
    const bills = f.categoryImpact.months[0].categories.find((x) => x.name === 'Bills');
    assert.equal(bills.availableMinor, R(190), 'the budget already counts the R10 water bill');
    assert.equal(bills.scheduledMinor, -R(300), 'only the schedule is added on top');
    assert.equal(bills.projectedAvailableMinor, -R(110));
    assert.equal(f.categoryImpact.offBudgetEvents, 1);
    assert.equal(f.categoryImpact.months[0].categories.length, 1, 'the off-budget SIP does not touch any envelope');
    // but it still moves your cash
    assert.equal(f.upcomingExpensesMinor, R(300) + R(10) + R(999));
  } finally { await s.close(); }
});

/* --------------------------------- bills --------------------------------- */

async function billsScenario(c) {
  await mk(c, { payee: 'Netflix', name: 'Netflix', amountMinor: -R(649), startDate: '2026-10-20', mode: 'auto' });         // paid Oct 20
  await mk(c, { payee: 'Landlord', name: 'Rent', amountMinor: -R(15000), startDate: '2026-11-01' });                      // waiting, overdue
  await mk(c, { payee: 'Power Co', name: 'Electricity', amountMinor: -R(1800), startDate: '2026-11-15' });                // due today
  await mk(c, { payee: 'ISP', name: 'Internet', amountMinor: -R(999), startDate: '2026-12-05' });                         // upcoming
  await mk(c, { payee: 'Acme', name: 'Salary', amountMinor: R(50000), categoryId: c.cat.Salary, startDate: '2026-11-25' }); // income: not a bill
  const gym = await mk(c, { payee: 'Gym', name: 'Gym', amountMinor: -R(500), startDate: '2026-11-20' });
  await c.post(`/api/schedules/${gym.id}/pause`, {});
}

test('bills: overdue, due today, upcoming and paid are sorted into the right sections', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await billsScenario(c);
    const b = await bills(c);
    assert.deepEqual(b.overdue.map((x) => [x.name, x.dueDate, x.amountMinor, x.status, x.awaitingApproval]), [['Rent', '2026-11-01', -R(15000), 'overdue', true]]);
    assert.equal(b.overdue[0].daysFromToday, -14);
    assert.deepEqual(b.upcoming.map((x) => [x.name, x.dueDate, x.status]), [
      ['Electricity', '2026-11-15', 'due'], ['Netflix', '2026-11-20', 'upcoming'], ['Rent', '2026-12-01', 'upcoming'],
      ['Internet', '2026-12-05', 'upcoming'], ['Electricity', '2026-12-15', 'upcoming'],
    ]);
    assert.deepEqual(b.paid.map((x) => [x.name, x.dueDate, x.paidDate, x.amountMinor]), [['Netflix', '2026-10-20', '2026-10-20', -R(649)]]);
    assert.ok(!JSON.stringify(b).includes('Salary'), 'income is not a bill');
    assert.ok(!b.upcoming.some((x) => x.name === 'Gym'), 'a paused bill is not coming up');
    assert.deepEqual([b.totals.overdueMinor, b.totals.overdueCount], [R(15000), 1]);
    assert.deepEqual([b.totals.upcomingMinor, b.totals.upcomingCount], [R(1800) + R(649) + R(15000) + R(999) + R(1800), 5]);
    assert.deepEqual([b.totals.paidMinor, b.totals.paidCount], [R(649), 1]);
    // subscriptions: every active repeating expense, as a monthly cost
    assert.equal(b.totals.subscriptionsMonthlyMinor, R(649) + R(15000) + R(1800) + R(999));
    assert.equal(b.totals.subscriptionCount, 4);
  } finally { await s.close(); }
});

test('bills: approving moves a bill from overdue to paid with the real amount and date; skipping moves it to skipped', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await billsScenario(c);
    const pending = await occs(c);
    const rent = pending.find((o) => o.scheduleName === 'Rent');
    const power = pending.find((o) => o.scheduleName === 'Electricity');
    await c.post(`/api/schedule-occurrences/${rent.id}/approve`, { date: '2026-11-03', amountMinor: -R(15500) });
    await c.post(`/api/schedule-occurrences/${power.id}/skip`, {});
    const b = await bills(c);
    assert.equal(b.overdue.length, 0);
    assert.equal(b.totals.overdueMinor, 0);
    assert.deepEqual(b.paid.map((x) => [x.name, x.paidDate, x.amountMinor]), [['Rent', '2026-11-03', -R(15500)], ['Netflix', '2026-10-20', -R(649)]]);
    assert.deepEqual(b.skipped.map((x) => [x.name, x.dueDate]), [['Electricity', '2026-11-15']]);
    assert.equal(b.totals.paidMinor, R(15500) + R(649));
    assert.ok(!b.upcoming.some((x) => x.dueDate === '2026-11-15'), 'the skipped one is not "due" any more');
  } finally { await s.close(); }
});

test('bills: auto-paid bills are paid the day they arrive, and the upcoming window and account filter work', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const sav = (await c.post('/api/accounts', { name: 'Savings' })).data.account;
    await mk(c, { payee: 'Netflix', name: 'Netflix', startDate: '2026-12-01', mode: 'auto' });
    await mk(c, { payee: 'Loan', name: 'EMI', amountMinor: -R(5000), startDate: '2026-12-10', accountId: sav.id });
    assert.equal((await bills(c)).upcoming.length, 2, 'Dec 1 and Dec 10 are inside 30 days');
    assert.equal((await bills(c, '?upcomingDays=10')).upcoming.length, 0);
    assert.equal((await bills(c, `?account=${sav.id}`)).upcoming.length, 1);
    setToday(s, '2026-12-01');
    const b = await bills(c);
    assert.deepEqual(b.paid.map((x) => x.name), ['Netflix']);
    assert.equal(b.overdue.length, 0, 'an auto bill is never overdue');
    assert.deepEqual(b.upcoming.map((x) => x.name), ['EMI'], 'Netflix\'s next one is Jan 1, outside the 30 day window');
    assert.deepEqual((await bills(c, '?upcomingDays=45')).upcoming.map((x) => x.name), ['EMI', 'Netflix', 'EMI'], 'Dec 10, Jan 1, Jan 10');
  } finally { await s.close(); }
});

test('bills: a bill whose transaction you later deleted is still listed as paid (at its original amount)', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await mk(c, { payee: 'Netflix', startDate: '2026-11-10', mode: 'auto' });
    const t = (await c.get('/api/transactions?month=all')).data.transactions[0];
    await c.del(`/api/transactions/${t.id}`);
    const b = await bills(c);
    assert.deepEqual(b.paid.map((x) => [x.amountMinor, x.paidDate, x.transactionId]), [[-R(649), '2026-11-10', null]]);
  } finally { await s.close(); }
});

/* --------------------------------- calendar --------------------------------- */

test('calendar: future bills, scheduled transactions, income and expense events, by day', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await billsScenario(c);                       // Netflix auto Oct 20 + Nov 20 (future), rent pending Nov 1, electricity today, salary Nov 25
    await mk(c, { payee: 'ISP2', name: 'Weekly thing', amountMinor: -R(10), startDate: '2026-11-30', frequency: 'weekly' });
    const cal = (await c.get('/api/calendar?month=2026-11')).data;
    assert.deepEqual([cal.month, cal.prevMonth, cal.nextMonth, cal.today], ['2026-11', '2026-10', '2026-12', TODAY]);
    const byDate = Object.fromEntries(cal.days.map((d) => [d.date, d.events.map((e) => `${e.name}:${e.state}:${e.kind}`)]));
    assert.deepEqual(byDate['2026-11-01'], ['Rent:pending:expense']);
    assert.deepEqual(byDate['2026-11-15'], ['Electricity:pending:expense']);
    assert.deepEqual(byDate['2026-11-20'], ['Netflix:projected:expense'], 'the paused Gym is not on it');
    assert.deepEqual(byDate['2026-11-25'], ['Salary:projected:income']);
    assert.deepEqual(byDate['2026-11-30'], ['Weekly thing:projected:expense']);
    assert.deepEqual(cal.days.map((d) => d.date), [...cal.days.map((d) => d.date)].sort(), 'days come in order');
    assert.equal(cal.days.length, 5);
    assert.equal(cal.totals.incomeMinor, R(50000));
    assert.equal(cal.totals.expenseMinor, R(15000) + R(1800) + R(649) + R(10));
    assert.equal(cal.totals.netMinor, cal.totals.incomeMinor - cal.totals.expenseMinor);
    const salary = cal.days.find((d) => d.date === '2026-11-25');
    assert.deepEqual([salary.incomeMinor, salary.expenseMinor], [R(50000), 0]);

    // October has the Netflix payment that was created on Oct 20
    const oct = (await c.get('/api/calendar?month=2026-10')).data;
    assert.deepEqual(oct.days.map((d) => d.events.map((e) => `${e.name}:${e.state}`)), [['Netflix:posted']]);
    assert.equal(oct.days[0].events[0].transactionId !== null, true);

    // a far-away month is projected from the repeat rules, and a skipped bill is shown but not counted
    const feb = (await c.get('/api/calendar?month=2027-02')).data;
    assert.deepEqual(feb.days.map((d) => d.date), ['2027-02-01', '2027-02-05', '2027-02-08', '2027-02-15', '2027-02-20', '2027-02-22', '2027-02-25']);
    const wk = feb.days.filter((d) => d.events.some((e) => e.name === 'Weekly thing')).map((d) => d.date);
    assert.deepEqual(wk, ['2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22'], 'weekly from Nov 30');
    const o = (await occs(c)).find((x) => x.scheduleName === 'Rent');
    await c.post(`/api/schedule-occurrences/${o.id}/skip`, {});
    const after = (await c.get('/api/calendar?month=2026-11')).data;
    assert.equal(after.days.find((d) => d.date === '2026-11-01').events[0].state, 'skipped');
    assert.equal(after.totals.expenseMinor, R(1800) + R(649) + R(10), 'skipped is not counted');
  } finally { await s.close(); }
});

test('calendar: defaults to this month, validates the month, and handles an empty month', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const now = (await c.get('/api/calendar')).data;
    assert.equal(now.month, '2026-11');
    assert.deepEqual(now.days, []);
    assert.deepEqual(now.totals, { incomeMinor: 0, expenseMinor: 0, netMinor: 0 });
    for (const bad of ['2026-13', '26-11', 'november', '1999-12']) assert.equal((await c.get(`/api/calendar?month=${bad}`)).status, 400, bad);
  } finally { await s.close(); }
});

test('all three views include approval-mode items the moment they arrive, without anyone calling run first', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await mk(c, { payee: 'Rent', amountMinor: -R(300), startDate: '2026-12-01' });
    setToday(s, '2026-12-03');
    assert.equal((await bills(c)).overdue.length, 1);
    setToday(s, '2026-12-04');
    assert.equal((await forecast(c, '?days=7')).events[0].state, 'pending');
    assert.equal((await c.get('/api/calendar?month=2026-12')).data.days[0].events[0].state, 'pending');
  } finally { await s.close(); }
});
