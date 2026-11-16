'use strict';
// "Total Funds" (money held now, all accounts) vs "Net This Period" (income - expenses of the filtered rows).
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, newUser, tx } = require('./helpers');

// Amounts in paise. Mirrors the reported scenario: Cash 3,300 + Federal Savings 2,000 = 5,300 funds,
// while the shown period only has a 1,700 expense.
async function scenario(s) {
  const c = await newUser(s.base, 'funds@example.com');
  // The default "Cash" account starts at 0; give it an opening balance of 5,000 so it ends at 3,300 after the expense.
  await c.patch(`/api/accounts/${c.accountId}`, { openingBalanceMinor: 500000 });
  const fed = (await c.post('/api/accounts', { name: 'Federal Savings', type: 'savings', openingBalanceMinor: 200000 })).data.account;
  await tx(c, { date: '2026-11-05', amountMinor: -170000 });          // Cash: 5,000 - 1,700 = 3,300
  return { c, fed };
}

const funds = async (c, qs = '') => (await c.get('/api/transactions' + qs)).data.summary;
const accountsSum = async (c) => {
  const { accounts, totalFundsMinor } = (await c.get('/api/accounts')).data;
  return { sum: accounts.reduce((n, a) => n + a.balanceMinor, 0), totalFundsMinor, accounts };
};

test('Total Funds equals the sum of all account balances (and matches the Accounts page)', async () => {
  const s = await start();
  try {
    const { c } = await scenario(s);
    const { sum, totalFundsMinor, accounts } = await accountsSum(c);
    assert.deepEqual(accounts.map((a) => a.balanceMinor).sort((x, y) => x - y), [200000, 330000]); // 2,000 and 3,300
    assert.equal(sum, 530000);
    assert.equal(totalFundsMinor, 530000);
    assert.equal((await funds(c)).totalFundsMinor, 530000);
    // closed and off-budget accounts are counted, exactly like the Accounts list counts them
    const off = (await c.post('/api/accounts', { name: 'Brokerage', type: 'investment', offbudget: true, openingBalanceMinor: 100000 })).data.account;
    const closed = (await c.post('/api/accounts', { name: 'Old', type: 'other', openingBalanceMinor: 5000 })).data.account;
    assert.equal((await c.patch(`/api/accounts/${closed.id}`, { closed: true })).status, 200);
    void off;
    const after = await accountsSum(c);
    assert.equal(after.sum, 635000);
    assert.equal(after.totalFundsMinor, after.sum);
    assert.equal((await funds(c)).totalFundsMinor, after.sum);
  } finally { await s.close(); }
});

test('Total Funds never changes with month, type, category, account or search filters', async () => {
  const s = await start();
  try {
    const { c, fed } = await scenario(s);
    await tx(c, { date: '2026-10-12', amountMinor: 900000, payee: 'Employer', categoryId: c.cat.Salary || null }); // income in another month
    const expected = (await accountsSum(c)).sum;
    for (const qs of ['', '?month=2026-11', '?month=2026-10', '?month=2025-01', `?account=${fed.id}`, '?type=income', '?type=expense',
      `?category=${c.cat.Food}`, '?q=pizza', '?q=zzz-no-match', `?account=${fed.id}&month=2026-11&type=income`]) {
      assert.equal((await funds(c, qs)).totalFundsMinor, expected, `funds changed for filter "${qs}"`);
    }
  } finally { await s.close(); }
});

test('Net This Period = filtered income - filtered expenses', async () => {
  const s = await start();
  try {
    const { c, fed } = await scenario(s);
    await tx(c, { date: '2026-11-20', amountMinor: 250000, payee: 'Refund' });                       // Nov income
    await tx(c, { date: '2026-11-21', amountMinor: -30000, payee: 'Bus' });                          // Nov expense
    await tx(c, { date: '2026-10-03', amountMinor: -99000, payee: 'Old rent' });                     // Oct expense
    await tx(c, { accountId: fed.id, date: '2026-11-09', amountMinor: 40000, payee: 'Interest' });   // Nov income, other account

    let sm = await funds(c, '?month=2026-11');
    assert.equal(sm.incomeMinor, 290000);
    assert.equal(sm.expenseMinor, 200000);                          // 170,000 + 30,000
    assert.equal(sm.netMinor, sm.incomeMinor - sm.expenseMinor);
    assert.equal(sm.netMinor, 90000);

    sm = await funds(c, '?month=2026-10');
    assert.equal(sm.netMinor, -99000);

    sm = await funds(c, `?month=2026-11&account=${fed.id}`);
    assert.equal(sm.netMinor, 40000);

    sm = await funds(c, '?month=2026-11&q=bus');
    assert.equal(sm.netMinor, -30000);

    sm = await funds(c, '?month=2019-01');                          // empty period
    assert.deepEqual([sm.incomeMinor, sm.expenseMinor, sm.netMinor], [0, 0, 0]);

    // the old field is gone, so nothing can still read the misleading "balance"
    assert.equal('balanceMinor' in (await funds(c)), false);
  } finally { await s.close(); }
});

test('opening balances count only in Total Funds, never in Net This Period', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'open@example.com');
    await c.patch(`/api/accounts/${c.accountId}`, { openingBalanceMinor: 1234500 });
    await c.post('/api/accounts', { name: 'Savings', type: 'savings', openingBalanceMinor: 777700 });
    // no transactions at all: funds = opening balances, period figures are zero
    let sm = await funds(c);
    assert.equal(sm.totalFundsMinor, 2012200);
    assert.deepEqual([sm.incomeMinor, sm.expenseMinor, sm.netMinor], [0, 0, 0]);

    await tx(c, { date: '2026-11-05', amountMinor: -10000 });
    sm = await funds(c, '?month=all');
    assert.equal(sm.netMinor, -10000);                              // opening balance not in here
    assert.equal(sm.totalFundsMinor, 2012200 - 10000);              // ...but it is here

    // changing an opening balance moves Total Funds and leaves the period numbers alone
    const before = await funds(c, '?month=2026-11');
    await c.patch(`/api/accounts/${c.accountId}`, { openingBalanceMinor: 0 });
    const after = await funds(c, '?month=2026-11');
    assert.equal(after.totalFundsMinor, before.totalFundsMinor - 1234500);
    assert.equal(after.netMinor, before.netMinor);
    assert.equal(after.incomeMinor, before.incomeMinor);
    assert.equal(after.expenseMinor, before.expenseMinor);
  } finally { await s.close(); }
});

test('the two cards can legitimately differ (the reported example: funds 5,300 vs net -1,700)', async () => {
  const s = await start();
  try {
    const { c } = await scenario(s);
    const sm = await funds(c, '?month=2026-11');
    assert.equal(sm.totalFundsMinor, 530000);                       // ₹5,300 across both accounts
    assert.equal(sm.incomeMinor, 0);
    assert.equal(sm.expenseMinor, 170000);                          // ₹1,700
    assert.equal(sm.netMinor, -170000);                             // -₹1,700
    assert.notEqual(sm.totalFundsMinor, sm.netMinor);
    assert.equal(sm.totalFundsMinor - sm.netMinor, 700000);         // the gap = ₹7,000 of opening balances
  } finally { await s.close(); }
});

test('Total Funds only counts your own accounts, and updates when data changes', async () => {
  const s = await start();
  try {
    const { c } = await scenario(s);
    const other = await newUser(s.base, 'other@example.com');
    await other.patch(`/api/accounts/${other.accountId}`, { openingBalanceMinor: 99999900 });
    await tx(other, { amountMinor: 5000000 });
    assert.equal((await funds(c)).totalFundsMinor, 530000);
    assert.equal((await accountsSum(other)).totalFundsMinor, 99999900 + 5000000);

    const made = (await tx(c, { date: '2026-11-06', amountMinor: 100000, payee: 'Gift' })).data.transaction;
    assert.equal((await funds(c)).totalFundsMinor, 630000);
    await c.del(`/api/transactions/${made.id}`);
    assert.equal((await funds(c)).totalFundsMinor, 530000);
  } finally { await s.close(); }
});
