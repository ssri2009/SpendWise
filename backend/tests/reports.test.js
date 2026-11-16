'use strict';
// Phase 7: reports, analytics, net worth, cash flow and insights. R(n) = n rupees (paise).
// Today is pinned to 2026-11-15. Every expected number was worked out BY HAND from the ledger in seed() below,
// then cross-checked against a second route (totals against category/payee/account breakdowns, net worth against Total Funds).
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, newUser, tx, Client } = require('./helpers');
const R = require('../server/reports');
const B = require('../server/budget');

const M = (n) => n * 100;
const TODAY = '2026-11-15';
const boot = () => start({ TODAY });
const get = async (c, path) => {
  const r = await c.get(path);
  assert.equal(r.status, 200, `${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
const sumOf = (rows, k = 'amountMinor') => rows.reduce((n, r) => n + r[k], 0);

/**
 * The ledger every test starts from.
 *   Accounts: Cash (cash, 0) | Bank (checking, 10,000) | Savings (savings, 5,000) | Card (credit, 0) | Invest (investment, 20,000)
 *   Income by month : Jun-25 40,000 | Dec-25 40,000 | Sep 48,000 | Oct 50,000 + 100 interest | Nov 52,000 + 300 dividend
 *   Expenses        : Sep 2,500 | Oct 6,000 | Nov 12,100 (see below) | and a Netflix bill dated 20 Nov (the future)
 *   Nov expenses    : Food 2,700 (1,500 + 200 + 1,000 split part) | Shopping 5,500 (4,000 - 500 refund + 2,000 split part)
 *                     Bills 3,000 | uncategorised 900          = 12,100
 */
async function seed(s, email = 'a@example.com') {
  const c = await newUser(s.base, email);
  const acct = async (name, type, opening) => (await c.post('/api/accounts', { name, type, openingBalanceMinor: M(opening) })).data.account;
  c.cashId = c.accountId;
  c.bank = await acct('Bank', 'checking', 10000);
  c.savings = await acct('Savings', 'savings', 5000);
  c.card = await acct('Card', 'credit', 0);
  c.invest = await acct('Invest', 'investment', 20000);
  const put = async (accountId, date, amount, payee, categoryId) => {
    const r = await tx(c, { accountId, date, amountMinor: M(amount), payee, categoryId });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  };
  const { Salary, Food, Shopping, Bills } = c.cat;
  await put(c.bank.id, '2025-06-01', 40000, 'Acme', Salary);
  await put(c.bank.id, '2025-12-01', 40000, 'Acme', Salary);
  await put(c.bank.id, '2026-09-01', 48000, 'Acme', Salary);
  await put(c.bank.id, '2026-09-15', -2500, 'Pizza Hut', Food);
  await put(c.bank.id, '2026-10-01', 50000, 'Acme', Salary);
  await put(c.bank.id, '2026-10-03', -1000, 'Pizza Hut', Food);
  await put(c.card.id, '2026-10-05', -2000, 'Amazon', Shopping);
  await put(c.bank.id, '2026-10-10', -3000, 'Landlord', Bills);
  await put(c.savings.id, '2026-10-12', 100, 'Bank Interest', null);
  await put(c.bank.id, '2026-11-01', 52000, 'Acme', Salary);
  await put(c.bank.id, '2026-11-02', -1500, 'Pizza Hut', Food);
  await put(c.card.id, '2026-11-03', -4000, 'Amazon', Shopping);
  await put(c.bank.id, '2026-11-04', -3000, 'Landlord', Bills);
  await put(c.card.id, '2026-11-05', 500, 'Amazon', Shopping);                       // a refund
  await put(c.invest.id, '2026-11-07', 300, 'Zerodha', null);
  await put(c.cashId, '2026-11-08', -200, 'Chai Stall', Food);
  await put(c.bank.id, '2026-11-10', -900, 'Mystery', null);                          // no category
  const sp = await c.post('/api/transactions', {
    accountId: c.card.id, date: '2026-11-12', amountMinor: -M(3000), payee: 'Croma',
    splits: [{ categoryId: Shopping, amountMinor: -M(2000) }, { categoryId: Food, amountMinor: -M(1000) }],
  });
  assert.equal(sp.status, 201, JSON.stringify(sp.data));
  await put(c.bank.id, '2026-11-20', -700, 'Netflix', Bills);                         // future: never in "so far" numbers
  return c;
}
const withSeed = (fn) => async () => {
  const s = await boot();
  try { await fn(await seed(s), s); } finally { await s.close(); }
};
const byName = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

/* --------------------------------------------------------------------- pure helpers */

test('periods: every preset resolves to the right dates; the previous period lines up with calendar months', () => {
  const q = (o) => new URLSearchParams(o);
  const db = { prepare: () => ({ get: () => ({ d: '2025-06-01' }) }) };
  const p = (o) => { const r = R.resolvePeriod(db, 1, q(o), TODAY); return [r.from, r.to]; };
  assert.deepEqual(p({ range: 'this-month' }), ['2026-11-01', TODAY]);
  assert.deepEqual(p({ range: 'last-month' }), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(p({ range: 'last-3-months' }), ['2026-09-01', TODAY]);
  assert.deepEqual(p({ range: 'last-6-months' }), ['2026-06-01', TODAY]);
  assert.deepEqual(p({}), ['2025-12-01', TODAY], 'default = last 12 months, current month included');
  assert.deepEqual(p({ range: 'this-year' }), ['2026-01-01', TODAY]);
  assert.deepEqual(p({ range: 'last-year' }), ['2025-01-01', '2025-12-31']);
  assert.deepEqual(p({ range: 'all' }), ['2025-06-01', TODAY]);
  assert.deepEqual(p({ from: '2026-02-01', to: '2026-02-10' }), ['2026-02-01', '2026-02-10']);
  assert.deepEqual(p({ from: '2026-02-01' }), ['2026-02-01', TODAY]);
  assert.throws(() => p({ from: '2026-03-01', to: '2026-02-01' }), /not be after/);
  assert.throws(() => p({ range: 'forever' }), /range must be/);
  assert.throws(() => p({ from: '2026-02-30' }), /real date/);

  const prev = (a, b) => { const r = R.previousPeriod(a, b); return [r.from, r.to]; };
  assert.deepEqual(prev('2026-11-01', '2026-11-15'), ['2026-10-01', '2026-10-15'], 'month so far vs the same days last month');
  assert.deepEqual(prev('2026-10-01', '2026-10-31'), ['2026-09-01', '2026-09-30']);
  assert.deepEqual(prev('2026-03-01', '2026-03-31'), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(prev('2026-01-01', '2026-11-15'), ['2025-01-01', '2025-11-15'], 'year so far vs the same stretch last year');
  assert.deepEqual(prev('2025-01-01', '2025-12-31'), ['2024-01-01', '2024-12-31']);
  assert.deepEqual(prev('2026-01-01', '2026-03-31'), ['2025-10-01', '2025-12-31'], 'a quarter vs the quarter before');
  assert.deepEqual(prev('2026-11-10', '2026-11-15'), ['2026-11-04', '2026-11-09'], 'odd ranges: the same number of days directly before');
  assert.equal(R.shiftMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(R.shiftMonths('2026-01-31', 1), '2026-02-28');
});

test('buckets: months, quarters and years cover the period exactly, with no gaps and no overlaps', () => {
  const b = (f, t, g) => R.makeBuckets(f, t, g).map((x) => [x.key, x.from, x.to]);
  assert.deepEqual(b('2026-11-05', '2026-11-20', 'month'), [['2026-11', '2026-11-05', '2026-11-20']]);
  assert.deepEqual(b('2026-11-25', '2027-01-05', 'month'),
    [['2026-11', '2026-11-25', '2026-11-30'], ['2026-12', '2026-12-01', '2026-12-31'], ['2027-01', '2027-01-01', '2027-01-05']]);
  assert.deepEqual(b('2025-12-01', TODAY, 'quarter').map((x) => x[0]), ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
  assert.deepEqual(b('2025-12-01', TODAY, 'quarter')[0], ['2025-Q4', '2025-12-01', '2025-12-31'], 'the first quarter is clipped to the period');
  assert.deepEqual(b('2025-12-01', TODAY, 'year'), [['2025', '2025-12-01', '2025-12-31'], ['2026', '2026-01-01', TODAY]]);
  assert.equal(R.bucketKey('2026-05-31', 'quarter'), '2026-Q2');
  assert.equal(R.bucketKey('2026-10-01', 'quarter'), '2026-Q4');
  assert.throws(() => R.makeBuckets('1990-01-01', '2026-01-01', 'month'), /too many columns/);
  assert.equal(R.makeBuckets('1990-01-01', '2026-01-01', 'year').length, 37);
  assert.equal(R.pctChange(150, 100), 50);
  assert.equal(R.pctChange(50, 100), -50);
  assert.equal(R.pctChange(5, 0), null);
  assert.equal(R.minorText(123456), '1234.56');
  assert.equal(R.minorText(-5), '-0.05');
  assert.equal(R.minorText(0), '0.00');
});

/* --------------------------------------------------------------------- spending */

test('spending report: the figures are hand-checked, and category, payee, account and time all add up to the same total', withSeed(async (c) => {
  const r = await get(c, '/api/reports/spending?range=this-month');
  assert.deepEqual(r.period, { range: 'this-month', from: '2026-11-01', to: TODAY });
  assert.equal(r.totalMinor, M(12100));
  assert.deepEqual(r.byCategory.map((x) => [x.name, x.amountMinor]),
    [['Shopping', M(5500)], ['Bills', M(3000)], ['Food', M(2700)], ['Uncategorized', M(900)]],
    'the refund reduces Shopping; the split is shared out; the Netflix bill dated 20 Nov is not here yet');
  const pay = byName(r.byPayee);
  assert.equal(pay.Amazon.amountMinor, M(3500), 'refund netted against the purchase');
  assert.equal(pay.Croma.amountMinor, M(3000), 'both split parts');
  assert.equal(pay.Croma.count, 1, 'a split is still one transaction');
  assert.equal(pay.Landlord.amountMinor, M(3000));
  assert.equal(pay['Pizza Hut'].amountMinor, M(1500));
  assert.equal(pay.Mystery.amountMinor, M(900));
  assert.equal(pay['Chai Stall'].amountMinor, M(200));
  assert.deepEqual(byName(r.byAccount).Card.amountMinor, M(6500));
  assert.deepEqual(byName(r.byAccount).Bank.amountMinor, M(5400));
  assert.deepEqual(byName(r.byAccount).Cash.amountMinor, M(200));
  for (const k of ['byCategory', 'byPayee', 'byAccount', 'overTime']) assert.equal(sumOf(r[k]), r.totalMinor, `${k} adds up to the total`);
  assert.equal(r.overTime.length, 1);
  assert.equal(r.byCategory[0].sharePct, 45.5, '5,500 of 12,100');
  assert.equal(r.averagePerDayMinor, Math.round(M(12100) / 15));
  assert.equal(r.transactionCount, 7, 'the split counts once');
  assert.deepEqual(r.biggest.map((x) => x.amountMinor), [M(4000), M(3000), M(2000), M(1500), M(1000)]);

  // it agrees with the older Phase 5 report: that one counts the 500 refund as money received, this one nets it off Shopping
  const old = await get(c, '/api/reports/spending-by-category?from=2026-11-01&to=2026-11-15');
  assert.equal(old.totals.spentMinor - M(500), r.totalMinor);
  assert.equal(old.totals.receivedMinor - M(500), (await get(c, '/api/reports/income?range=this-month')).totalMinor);
}));

test('spending over time: monthly, quarterly and yearly grouping each add up to the same total', withSeed(async (c) => {
  const m = await get(c, '/api/reports/spending');                                  // default: last 12 months
  assert.equal(m.period.from, '2025-12-01');
  assert.equal(m.totalMinor, M(2500 + 6000 + 12100));
  assert.equal(m.overTime.length, 12);
  assert.deepEqual(m.overTime.filter((x) => x.amountMinor).map((x) => [x.key, x.amountMinor]),
    [['2026-09', M(2500)], ['2026-10', M(6000)], ['2026-11', M(12100)]]);
  assert.equal(m.highest.key, '2026-11');

  const q = await get(c, '/api/reports/spending?granularity=quarter');
  assert.deepEqual(q.overTime.map((x) => [x.key, x.amountMinor]),
    [['2025-Q4', 0], ['2026-Q1', 0], ['2026-Q2', 0], ['2026-Q3', M(2500)], ['2026-Q4', M(18100)]]);
  const y = await get(c, '/api/reports/spending?granularity=year');
  assert.deepEqual(y.overTime.map((x) => [x.key, x.amountMinor]), [['2025', 0], ['2026', M(20600)]]);
  for (const x of [m, q, y]) assert.equal(sumOf(x.overTime), x.totalMinor);
}));

test('filters: account, on/off budget and "leave out" change every number consistently', withSeed(async (c) => {
  const card = await get(c, `/api/reports/spending?range=this-month&account=${c.card.id}`);
  assert.equal(card.totalMinor, M(6500));
  assert.deepEqual(card.byAccount.map((x) => x.name), ['Card']);

  await c.patch(`/api/accounts/${c.card.id}`, { offbudget: true });
  assert.equal((await get(c, '/api/reports/spending?range=this-month&offbudget=yes')).totalMinor, M(6500));
  assert.equal((await get(c, '/api/reports/spending?range=this-month&offbudget=no')).totalMinor, M(12100 - 6500));
  assert.equal((await get(c, '/api/reports/spending?range=this-month&offbudget=all')).totalMinor, M(12100));

  const left = await get(c, `/api/reports/spending?range=this-month&exclude=${c.cat.Shopping},none`);
  assert.equal(left.totalMinor, M(12100 - 5500 - 900), 'Shopping and uncategorised left out');
  assert.deepEqual(left.byCategory.map((x) => x.name), ['Bills', 'Food']);
  const cf = await get(c, `/api/reports/cashflow?range=this-month&exclude=${c.cat.Shopping}`);
  assert.equal(cf.totals.expensesMinor, M(12100 - 5500), 'leaving a category out applies to cash flow too');

  for (const bad of ['account=99999', 'offbudget=maybe', 'exclude=abc', 'granularity=week', 'range=soon', 'from=2026-13-01', 'format=xml']) {
    const r = await c.get(`/api/reports/spending?${bad}`);
    assert.ok(r.status === 400 || r.status === 404, `${bad} -> ${r.status}`);
  }
  assert.equal((await c.get('/api/reports/spending?account=99999')).status, 404);
}));

/* --------------------------------------------------------------------- income */

test('income report: sources, trend, month by month and year by year', withSeed(async (c) => {
  const r = await get(c, '/api/reports/income');
  assert.equal(r.totalMinor, M(40000 + 48000 + 50100 + 52300));
  assert.deepEqual(r.sources.map((x) => [x.name, x.amountMinor]),
    [['Acme', M(190000)], ['Zerodha', M(300)], ['Bank Interest', M(100)]], 'a payee is a source');
  assert.equal(sumOf(r.sources), r.totalMinor);
  assert.equal(sumOf(r.byCategory), r.totalMinor, 'by category adds up too (Salary + the uncategorised 400)');
  assert.deepEqual(r.byCategory.map((x) => [x.name, x.amountMinor]), [['Salary', M(190000)], ['Uncategorized', M(400)]]);

  const nov = r.monthly.find((x) => x.key === '2026-11');
  const oct = r.monthly.find((x) => x.key === '2026-10');
  assert.equal(oct.incomeMinor, M(50100));
  assert.equal(nov.incomeMinor, M(52300));
  assert.equal(nov.changeMinor, M(2200));
  assert.equal(nov.changePct, 4.4, '52,300 vs 50,100');
  assert.equal(r.monthly[0].changePct, null, 'the first month has nothing to compare with');
  assert.equal(r.monthly.find((x) => x.key === '2026-02').changePct, null, 'a month after a zero month has no percentage');
  assert.equal(r.monthly.find((x) => x.key === '2026-01').changePct, -100, 'income that stops is -100%');
  assert.equal(r.monthly.length, 12);

  assert.deepEqual(r.yearly.map((x) => x.year), [2025, 2026]);
  const y25 = r.yearly[0], y26 = r.yearly[1];
  assert.equal(y25.incomeMinor, M(80000));
  assert.deepEqual([y25.changeMinor, y25.changePct], [null, null], 'nothing before the first year on the list');
  assert.equal(r.monthly.at(-1).partial, true, 'November is still in progress');
  assert.equal(r.monthly.at(-2).partial, false);
  assert.equal(y26.incomeMinor, M(150400));
  assert.equal(y26.partial, true);
  assert.equal(y26.changeMinor, M(70400));
  assert.equal(y26.changePct, 88);
  assert.equal(y26.previousSamePeriodMinor, M(40000), '1 Jan to 15 Nov 2025: only the June salary had arrived');
  assert.equal(y26.samePeriodChangePct, 276);
  assert.equal(r.trend.direction, 'up');
  assert.equal(r.highest.key, '2026-11');
  assert.equal(r.lowest.amountMinor, 0);
  assert.equal(sumOf(r.overTime), r.totalMinor);
}));

/* --------------------------------------------------------------------- cash flow */

test('cash flow: income, expenses, net, savings rate and savings-account growth for each period', withSeed(async (c) => {
  const r = await get(c, '/api/reports/cashflow?range=last-3-months');
  assert.deepEqual(r.periods.map((p) => [p.key, p.incomeMinor, p.expensesMinor, p.netMinor]), [
    ['2026-09', M(48000), M(2500), M(45500)],
    ['2026-10', M(50100), M(6000), M(44100)],
    ['2026-11', M(52300), M(12100), M(40200)],
  ]);
  assert.deepEqual(r.totals, {
    incomeMinor: M(150400), expensesMinor: M(20600), netMinor: M(129800), savedMinor: M(400),
    savingsRatePct: 86.3, averageNetPerPeriodMinor: Math.round(M(129800) / 3),
  });
  assert.equal(r.periods[0].savingsRatePct, 94.8, '45,500 of 48,000');
  assert.deepEqual(r.periods.map((p) => p.savedMinor), [0, M(100), M(300)], 'interest in Savings (Oct) and a dividend in Invest (Nov)');
  assert.equal(r.savingsAccounts, 2);
  assert.equal(r.best.key, '2026-09');
  assert.equal(r.worst.key, '2026-11');
  for (const p of r.periods) assert.equal(p.netMinor, p.incomeMinor - p.expensesMinor);

  // net cash flow is exactly the movement of the ledger: it equals the sum of every transaction in the period
  const ledger = (await get(c, `/api/transactions?from=${r.period.from}&to=${r.period.to}&limit=500`)).summary;
  assert.equal(r.totals.netMinor, ledger.incomeMinor - ledger.expenseMinor);

  const q = await get(c, '/api/reports/cashflow?range=last-3-months&granularity=quarter');
  assert.deepEqual(q.periods.map((p) => [p.key, p.netMinor]), [['2026-Q3', M(45500)], ['2026-Q4', M(84300)]]);
  assert.equal(q.totals.netMinor, r.totals.netMinor);
}));

/* --------------------------------------------------------------------- categories */

test('category report: this period against the one before, averages, shares, and drill-down', withSeed(async (c) => {
  const r = await get(c, '/api/reports/categories?range=this-month');
  assert.deepEqual(r.previous, { from: '2026-10-01', to: '2026-10-15' });
  assert.equal(r.expense.totalMinor, M(12100));
  assert.equal(r.expense.previousTotalMinor, M(6000));
  const e = byName(r.expense.rows);
  assert.deepEqual([e.Shopping.amountMinor, e.Shopping.previousMinor, e.Shopping.changeMinor, e.Shopping.changePct], [M(5500), M(2000), M(3500), 175]);
  assert.deepEqual([e.Food.amountMinor, e.Food.previousMinor, e.Food.changePct], [M(2700), M(1000), 170]);
  assert.deepEqual([e.Bills.changeMinor, e.Bills.changePct], [0, 0]);
  assert.equal(e.Uncategorized.changePct, null, 'nothing to compare with last month');
  assert.equal(e.Shopping.averagePerMonthMinor, M(5500), 'half a month still counts as a month for the average');
  assert.equal(sumOf(r.expense.rows), r.expense.totalMinor);
  assert.equal(r.income.totalMinor, M(52300));
  assert.equal(r.detail, null);

  // a category that only had spending last period still shows, at zero
  const last = await get(c, '/api/reports/categories?range=last-month');
  assert.deepEqual(last.previous, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(byName(last.expense.rows).Shopping.amountMinor, M(2000));
  assert.equal(byName(last.expense.rows).Food.previousMinor, M(2500));
  const dropped = await get(c, '/api/reports/categories?from=2026-11-16&to=2026-11-30');
  assert.deepEqual([byName(dropped.expense.rows).Shopping.amountMinor, byName(dropped.expense.rows).Shopping.previousMinor, byName(dropped.expense.rows).Shopping.changePct], [0, M(5500), -100]);

  const d = (await get(c, `/api/reports/categories?range=this-month&category=${c.cat.Food}`)).detail;
  assert.deepEqual([d.name, d.kind, d.totalMinor], ['Food', 'expense', M(2700)]);
  assert.deepEqual(d.topPayees.map((x) => [x.name, x.amountMinor]), [['Croma', M(1000)], ['Pizza Hut', M(1500)], ['Chai Stall', M(200)]].sort((a, b) => b[1] - a[1]));
  assert.equal(d.largest[0].amountMinor, M(1500));
  assert.equal(sumOf(d.overTime), d.totalMinor);
  const none = (await get(c, '/api/reports/categories?range=this-month&category=none')).detail;
  assert.equal(none.totalMinor, M(900));
  const sal = (await get(c, `/api/reports/categories?range=this-month&category=${c.cat.Salary}`)).detail;
  assert.deepEqual([sal.kind, sal.totalMinor], ['income', M(52000)]);
  assert.equal((await c.get('/api/reports/categories?category=99999')).status, 404);
  assert.equal((await c.get('/api/reports/categories?category=abc')).status, 400);
}));

/* --------------------------------------------------------------------- account activity */

test('account activity: start + money in - money out = end, for every account and in total', withSeed(async (c) => {
  const r = await get(c, '/api/reports/accounts?range=this-month');
  const a = byName(r.accounts.map((x) => ({ ...x })));
  assert.deepEqual([a.Bank.startBalanceMinor, a.Bank.inflowMinor, a.Bank.outflowMinor, a.Bank.endBalanceMinor],
    [M(181500), M(52000), M(5400), M(228100)], 'the future Netflix bill is not in it');
  assert.deepEqual([a.Card.startBalanceMinor, a.Card.inflowMinor, a.Card.outflowMinor, a.Card.endBalanceMinor, a.Card.transactionCount],
    [-M(2000), M(500), M(7000), -M(8500), 3], 'the split is ONE transaction at account level');
  assert.deepEqual([a.Cash.startBalanceMinor, a.Cash.outflowMinor, a.Cash.endBalanceMinor], [0, M(200), -M(200)]);
  assert.deepEqual([a.Savings.startBalanceMinor, a.Savings.netMinor, a.Savings.endBalanceMinor], [M(5100), 0, M(5100)]);
  assert.deepEqual([a.Invest.inflowMinor, a.Invest.endBalanceMinor], [M(300), M(20300)]);
  for (const x of r.accounts) assert.equal(x.startBalanceMinor + x.inflowMinor - x.outflowMinor, x.endBalanceMinor, x.name);
  assert.equal(r.totals.endBalanceMinor, sumOf(r.accounts, 'endBalanceMinor'));
  assert.equal(r.totals.startBalanceMinor + r.totals.netMinor, r.totals.endBalanceMinor);
  assert.equal(r.detail, null);

  // the period's end balance IS the Accounts page balance once nothing in the future is left out
  const wide = await get(c, '/api/reports/accounts?from=2020-01-01&to=2030-01-01');
  const accts = (await get(c, '/api/accounts')).accounts;
  for (const x of wide.accounts) assert.equal(x.endBalanceMinor, accts.find((y) => y.id === x.accountId).balanceMinor, x.name);
  assert.equal(wide.totals.endBalanceMinor, (await get(c, '/api/accounts')).totalFundsMinor);

  const one = await get(c, `/api/reports/accounts?range=last-3-months&account=${c.bank.id}`);
  assert.equal(one.accounts.length, 1);
  assert.equal(sumOf(one.detail.overTime, 'netMinor'), one.accounts[0].netMinor);
  assert.equal(one.detail.recent[0].date, '2026-11-10', 'newest first, and nothing dated after today');
  assert.equal(one.detail.recent.length <= 15, true);

  await c.patch(`/api/accounts/${c.invest.id}`, { closed: true });
  await c.patch(`/api/accounts/${c.cashId}`, { closed: true });
  const open = await get(c, '/api/reports/accounts?range=this-month');
  assert.ok(open.accounts.find((x) => x.name === 'Invest'), 'a closed account that still holds money stays in the report');
}));

/* --------------------------------------------------------------------- monthly summary */

test('monthly summary: this month so far, compared with the same days last month', withSeed(async (c, s) => {
  const r = await get(c, '/api/reports/monthly-summary');
  assert.deepEqual([r.month, r.isCurrent, r.daysElapsed, r.daysInMonth], ['2026-11', true, 15, 30]);
  assert.deepEqual([r.incomeMinor, r.expensesMinor, r.netMinor, r.savingsRatePct], [M(52300), M(12100), M(40200), 76.9]);
  assert.deepEqual(r.comparedWith, { from: '2026-10-01', to: '2026-10-15', label: 'Oct 2026', sameDays: true });
  assert.deepEqual([r.previous.incomeMinor, r.previous.expensesMinor], [M(50100), M(6000)]);
  assert.deepEqual([r.changes.incomeMinor, r.changes.expensesMinor, r.changes.expensesPct], [M(2200), M(6100), 101.7]);
  assert.equal(r.averageDailyExpenseMinor, Math.round(M(12100) / 15));
  assert.equal(r.transactionCount, 9);
  assert.deepEqual(r.topCategories.map((x) => x.name), ['Shopping', 'Bills', 'Food', 'Uncategorized']);
  assert.deepEqual(r.topPayees.slice(0, 3).map((x) => x.name), ['Amazon', 'Croma', 'Landlord']);
  assert.equal(r.incomeSources[0].name, 'Acme');
  assert.equal(r.largestExpenses[0].amountMinor, M(4000));
  assert.equal(r.daily.length, 30);
  assert.equal(r.daily.filter((d) => d.future).length, 15);
  assert.equal(sumOf(r.daily, 'expensesMinor'), r.expensesMinor, 'the days add up to the month');
  assert.equal(sumOf(r.daily, 'incomeMinor'), r.incomeMinor);
  assert.equal(r.daily[4].expensesMinor, -M(500), 'a refund day is a negative expense day');
  const uid = (await get(c, '/api/auth/me')).user.id;
  const bv = B.monthView(s.server.db, uid, '2026-11');
  assert.deepEqual([r.budget.overspentCount, r.budget.assignedMinor, r.budget.toBudgetMinor], [bv.overspentCount, bv.assignedMinor, bv.toBudgetMinor], 'the budget block is the Budget page\'s own numbers');

  const oct = await get(c, '/api/reports/monthly-summary?month=2026-10');
  assert.equal(oct.isCurrent, false);
  assert.deepEqual([oct.incomeMinor, oct.expensesMinor, oct.netMinor], [M(50100), M(6000), M(44100)]);
  assert.deepEqual([oct.previous.incomeMinor, oct.previous.expensesMinor], [M(48000), M(2500)], 'a finished month against the whole month before');
  assert.equal(oct.comparedWith.sameDays, false);
  assert.equal(oct.daily.length, 31);

  const future = await get(c, '/api/reports/monthly-summary?month=2026-12');
  assert.deepEqual([future.daysElapsed, future.incomeMinor, future.expensesMinor], [0, 0, 0]);
  assert.equal((await c.get('/api/reports/monthly-summary?month=2026-13')).status, 400);
  assert.equal((await c.get('/api/reports/monthly-summary?month=november')).status, 400);
}));

/* --------------------------------------------------------------------- net worth */

test('net worth: assets, liabilities and history are hand-checked and agree with Total Funds', withSeed(async (c, s) => {
  const r = await get(c, '/api/reports/net-worth?months=3');
  assert.equal(r.asOf, TODAY);
  assert.deepEqual([r.current.assetsMinor, r.current.liabilitiesMinor, r.current.netWorthMinor], [M(253300), M(8500), M(244800)]);
  const g = Object.fromEntries(r.current.groups.map((x) => [x.type, x]));
  assert.deepEqual([g.cash.balanceMinor, g.checking.balanceMinor, g.savings.balanceMinor, g.investment.balanceMinor, g.credit.balanceMinor],
    [-M(200), M(228100), M(5100), M(20300), M(8500)]);
  assert.equal(g.credit.kind, 'liability');
  assert.equal(g.checking.kind, 'asset');
  assert.equal(g.checking.label, 'Bank accounts');
  assert.equal(r.hasLiabilities, true);
  assert.equal(r.current.assetsMinor, sumOf(r.current.groups.filter((x) => x.kind === 'asset'), 'balanceMinor'));
  assert.equal(r.current.liabilitiesMinor, sumOf(r.current.groups.filter((x) => x.kind === 'liability'), 'balanceMinor'));

  assert.deepEqual(r.series.map((p) => [p.label, p.date, p.netWorthMinor]), [
    ['Aug 2026', '2026-08-31', M(115000)], ['Sep 2026', '2026-09-30', M(160500)], ['Oct 2026', '2026-10-31', M(204600)], ['Today', TODAY, M(244800)],
  ]);
  for (const p of r.series) assert.equal(p.netWorthMinor, p.assetsMinor - p.liabilitiesMinor);
  assert.equal(r.change.sinceLastMonthEndMinor, M(40200), 'this month so far = the cash flow of the month');
  assert.equal(r.change.overRangeMinor, M(244800 - 115000));
  assert.equal(r.trend, 'up');

  // the last point equals the Accounts page once nothing is dated in the future: the Netflix bill (700) is the only gap
  const funds = (await get(c, '/api/accounts')).totalFundsMinor;
  assert.equal(r.current.netWorthMinor, funds + M(700), 'Total Funds includes the bill dated 20 Nov; net worth is "as of today"');
  s.server.clock.fixed = '2026-12-31';
  const later = await get(c, '/api/reports/net-worth?months=1');
  assert.equal(later.current.netWorthMinor, funds, 'once the date has passed, they agree to the paisa');
  assert.equal(later.series.at(-1).label, 'Today');

  const all = await get(c, '/api/reports/net-worth?months=all');
  assert.equal(all.series[0].label, 'Jun 2025', 'history starts at the first transaction');
  assert.equal(all.series[0].netWorthMinor, M(35000 + 40000), 'opening balances 35,000 + the June 2025 salary');
  assert.equal((await c.get('/api/reports/net-worth?months=abc')).status, 400);
  assert.equal((await get(c, '/api/reports/net-worth?months=9999')).series.length, 121, 'capped at ten years');
}));

test('net worth: a brand-new user, a loan, an "other" account and closed accounts', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'fresh@example.com');
    const r = await get(c, '/api/reports/net-worth');
    assert.deepEqual([r.current.assetsMinor, r.current.liabilitiesMinor, r.current.netWorthMinor], [0, 0, 0]);
    assert.equal(r.series.length, 13, '12 month-ends and today');
    assert.equal(r.trend, 'flat');
    assert.equal(r.hasLiabilities, false);

    const loan = (await c.post('/api/accounts', { name: 'Car loan', type: 'loan', openingBalanceMinor: -M(100000) })).data.account;
    await c.post('/api/accounts', { name: 'Gold', type: 'other', openingBalanceMinor: M(30000) });
    const old = (await c.post('/api/accounts', { name: 'Old', type: 'checking', openingBalanceMinor: 0 })).data.account;
    await c.patch(`/api/accounts/${old.id}`, { closed: true });
    let n = await get(c, '/api/reports/net-worth?months=1');
    assert.deepEqual([n.current.assetsMinor, n.current.liabilitiesMinor, n.current.netWorthMinor], [M(30000), M(100000), -M(70000)]);
    assert.equal(n.current.groups.some((x) => x.accounts.some((a) => a.name === 'Old')), false, 'a closed account with nothing in it is not listed');
    assert.equal(n.current.groups.find((x) => x.type === 'other').label, 'Other assets');
    // paying the loan down moves net worth up by the payment
    await tx(c, { accountId: loan.id, date: TODAY, amountMinor: M(10000), payee: 'Bank', categoryId: null });
    n = await get(c, '/api/reports/net-worth?months=1');
    assert.equal(n.current.liabilitiesMinor, M(90000));
    assert.equal(n.current.netWorthMinor, -M(60000));
    // an overpaid credit card is a negative liability, never a hidden one
    await c.post('/api/accounts', { name: 'Card', type: 'credit', openingBalanceMinor: M(500) });
    n = await get(c, '/api/reports/net-worth?months=1');
    assert.equal(n.current.liabilitiesMinor, M(90000 - 500));
  } finally { await s.close(); }
});

/* --------------------------------------------------------------------- insights */

test('insights: each finding is worked out from the numbers above and sorted warnings first', withSeed(async (c) => {
  const { insights, asOf } = await get(c, '/api/reports/insights');
  assert.equal(asOf, TODAY);
  const by = Object.fromEntries(insights.map((i) => [i.id, i]));
  assert.equal(by['spend-pace'].level, 'warn');
  assert.match(by['spend-pace'].title, /up 101\.7%/);
  assert.match(by['spend-pace'].detail, /₹12,100.*₹6,000.*₹6,100 more/);
  assert.equal(by.projection.level, 'info', 'a straight-line guess is never shown as a warning');
  assert.match(by.projection.title, /₹24,200/, '12,100 over 15 days, for 30 days');
  assert.match(by['top-category'].title, /Shopping/);
  assert.match(by['top-category'].detail, /45\.5%/);
  assert.match(by['category-spike'].title, /Shopping/, 'the biggest rise: +3,500 against Food +1,700');
  assert.equal(by['savings-rate'].level, 'good');
  assert.match(by['savings-rate'].title, /88% of your income in Oct 2026/);
  assert.equal(by['income-change'], undefined, 'Oct income rose only 4.4%, under the 10% bar');
  assert.match(by['biggest-expense'].title, /₹4,000/);
  assert.equal(by.overspent.level, 'warn', 'nothing is assigned in the budget, so spent categories are overspent');
  assert.match(by.uncategorized.title, /^3 recent transactions have no category/);
  assert.equal(by['net-worth'].level, 'good');
  assert.match(by['net-worth'].title, /up ₹40,200/);
  const levels = insights.map((i) => i.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ({ warn: 0, good: 1, info: 2 })[a] - ({ warn: 0, good: 1, info: 2 })[b]));
  assert.ok(insights.every((i) => i.title && i.detail && i.link.startsWith('/')));
}));

test('insights: spending down, a shortfall month, and a new user with nothing yet', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'quiet@example.com');
    const empty = (await get(c, '/api/reports/insights')).insights;
    assert.deepEqual(empty.map((i) => i.id), ['no-data']);

    await tx(c, { date: '2026-10-02', amountMinor: M(1000), payee: 'Acme', categoryId: c.cat.Salary });
    await tx(c, { date: '2026-10-04', amountMinor: -M(4000), payee: 'Shop', categoryId: c.cat.Shopping });      // spent more than earned
    await tx(c, { date: '2026-11-05', amountMinor: -M(1000), payee: 'Shop', categoryId: c.cat.Shopping });      // 1,000 vs 4,000 by the same day
    const by = Object.fromEntries((await get(c, '/api/reports/insights')).insights.map((i) => [i.id, i]));
    assert.equal(by['spend-pace'].level, 'good');
    assert.match(by['spend-pace'].title, /down 75%/);
    assert.equal(by['savings-rate'].level, 'warn');
    assert.match(by['savings-rate'].detail, /shortfall of ₹3,000/);
    assert.match(by.projection.title, /₹2,000/, '1,000 over 15 days, for 30 days');
  } finally { await s.close(); }
});

/* --------------------------------------------------------------------- csv */

test('CSV export: same numbers as the screen, safe to open in a spreadsheet', withSeed(async (c) => {
  await tx(c, { date: '2026-11-09', amountMinor: -M(10), payee: '=HYPERLINK("http://evil.example","click")', categoryId: c.cat.Other });
  const res = await c.req('/api/reports/spending?range=this-month&format=csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="spendwise-spending-2026-11-01-to-2026-11-15\.csv"/);
  const raw = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'starts with a byte-order mark so Excel reads the rupee sign correctly');
  const text = raw.toString('utf8').slice(1);
  assert.ok(text.startsWith('Section,Name,Amount,Share %,Transactions'));
  assert.match(text, /By category,Shopping,5500\.00,45\.\d,/);
  assert.match(text, /Total,,12110\.00,,8/);
  assert.ok(!/^=HYPERLINK/m.test(text) && /'=HYPERLINK/.test(text), 'a payee that looks like a formula is neutralised');
  assert.match(text, /\r\n/);
  assert.ok(!text.includes('NaN') && !text.includes('undefined') && !text.includes('[object'));

  for (const kind of ['income', 'cashflow', 'categories', 'accounts', 'monthly-summary', 'net-worth']) {
    const r = await c.req(`/api/reports/${kind}?range=this-month&format=csv`);
    assert.equal(r.status, 200, kind);
    const t = await r.text();
    assert.ok(t.split('\r\n').length > 2, `${kind} has rows`);
    assert.ok(!t.includes('NaN') && !t.includes('undefined'), kind);
  }
  const cf = (await (await c.req('/api/reports/cashflow?range=last-3-months&format=csv')).text()).split('\r\n');
  assert.equal(cf[1], 'Sep 2026,48000.00,2500.00,45500.00,94.8,0.00');
  assert.equal(cf.at(-2), 'Total,150400.00,20610.00,129790.00,86.3,400.00');
  assert.equal((await c.get('/api/reports/insights?format=csv')).status, 200, 'insights ignore the format');
}));

/* --------------------------------------------------------------------- privacy and safety */

test('every report needs a sign-in and shows only the signed-in user\'s own data', async () => {
  const s = await boot();
  try {
    const a = await seed(s, 'a@example.com');
    const b = await newUser(s.base, 'b@example.com');
    await tx(b, { date: '2026-11-03', amountMinor: -M(77), payee: 'Only B', categoryId: b.cat.Food });
    const anon = new Client(s.base);
    for (const p of ['spending', 'income', 'cashflow', 'categories', 'accounts', 'monthly-summary', 'net-worth', 'insights']) {
      assert.equal((await anon.get(`/api/reports/${p}`)).status, 401, p);
    }
    const rb = await get(b, '/api/reports/spending?range=this-month');
    assert.equal(rb.totalMinor, M(77));
    assert.deepEqual(rb.byPayee.map((x) => x.name), ['Only B']);
    assert.equal((await get(b, '/api/reports/net-worth')).current.netWorthMinor, -M(77));
    assert.equal((await get(a, '/api/reports/spending?range=this-month')).totalMinor, M(12100), 'and A is unaffected');

    // B cannot aim a report at A's account or category (not found, not "forbidden": it does not confirm they exist)
    assert.equal((await b.get(`/api/reports/spending?account=${a.bank.id}`)).status, 404);
    assert.equal((await b.get(`/api/reports/accounts?account=${a.bank.id}`)).status, 404);
    assert.equal((await b.get(`/api/reports/categories?category=${a.cat.Food}`)).status, 404);
    // leaving out someone else's category is harmless: it matches nothing of B's
    assert.equal((await get(b, `/api/reports/spending?range=this-month&exclude=${a.cat.Food}`)).totalMinor, M(77));
  } finally { await s.close(); }
});

test('reports only read: nothing is written, the schema is untouched, and big requests are refused cleanly', withSeed(async (c, s) => {
  const db = s.server.db;
  const tables = ['transactions', 'transaction_splits', 'accounts', 'categories', 'payees', 'budget_months', 'budget_transfers', 'schedules', 'schedule_occurrences', 'rules', 'reconciliations'];
  const snap = () => JSON.stringify([
    ...tables.map((t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()),
    db.prepare('SELECT SUM(amount_minor) AS s, MAX(updated_at) AS u, SUM(id) AS i FROM transactions').get(),
  ]);

  const before = snap();
  for (const p of ['spending', 'income', 'cashflow', 'categories', 'accounts', 'monthly-summary', 'net-worth', 'insights']) {
    await get(c, `/api/reports/${p}?range=all`);
    await c.req(`/api/reports/${p}?format=csv`);
  }
  assert.equal(snap(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 6, 'no new migration: a Phase 6 database opens as it is');

  assert.equal((await c.get(`/api/reports/spending?exclude=${Array.from({ length: 201 }, (_, i) => i + 1).join(',')}`)).status, 400);
  assert.equal((await c.get('/api/reports/spending?from=1990-01-01&to=2026-01-01&granularity=month')).status, 400, 'too many columns');
  assert.equal((await get(c, '/api/reports/spending?from=1980-01-01&to=2026-01-01&granularity=year')).overTime.length, 47);
  assert.equal((await c.get('/api/reports/spending?from=1900-01-01&to=2026-01-01')).status, 400, 'dates before 1970 are not real here');
  const post = await c.post('/api/reports/spending', {});
  assert.ok(post.status === 404 || post.status === 405, 'reports have no write routes');
}));

test('the Reports page and its scripts are served, and the Phase 5 category report still answers exactly as before', withSeed(async (c) => {
  const page = await c.req('/reports');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /data-page="reports"/);
  assert.doesNotMatch(html, /Coming in Phase 7/);
  assert.equal((await c.req('/reports/spending')).status, 200);
  for (const f of ['/js/pages/reports.js', '/js/pages/reports-views.js', '/js/charts.js']) assert.equal((await c.req(f)).status, 200, f);
  const old = await get(c, '/api/reports/spending-by-category?month=2026-11');
  assert.deepEqual(Object.keys(old).sort(), ['categories', 'totals']);
  assert.deepEqual([old.totals.spentMinor, old.totals.receivedMinor], [M(13300), M(52800)], 'the whole of November, including the Netflix bill dated the 20th');
}));
