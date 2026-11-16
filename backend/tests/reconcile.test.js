'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, newUser, tx, Client } = require('./helpers');

/**
 * The example from the brief. Account opens at ₹10,000. ₹3,000 salary and a ₹50 purchase are cleared, so SpendWise
 * says ₹12,950 while the bank statement says ₹13,000 (a ₹50 difference). One more purchase is not cleared yet.
 */
async function bankExample(s, email) {
  const c = await newUser(s.base, email);
  await c.patch(`/api/accounts/${c.accountId}`, { openingBalanceMinor: 1000000 });
  const salary = (await tx(c, { amountMinor: 300000, payee: 'Employer', categoryId: c.cat.Salary, cleared: true, date: '2026-11-01' })).data.transaction;
  const coffee = (await tx(c, { amountMinor: -5000, payee: 'Cafe', categoryId: c.cat.Food, date: '2026-11-02' })).data.transaction;
  const pending = (await tx(c, { amountMinor: -12000, payee: 'Pending shop', categoryId: c.cat.Shopping, date: '2026-11-03' })).data.transaction;
  // a new transaction cannot be created cleared by the API default, so clear them the way a person would
  await c.patch(`/api/transactions/${salary.id}`, { cleared: true });
  await c.patch(`/api/transactions/${coffee.id}`, { cleared: true });
  return { c, salary, coffee, pending };
}

const rec = (c, id = c.accountId) => c.get(`/api/accounts/${id}/reconciliation`).then((r) => r.data);

/* ---------------------------------------------------------------- cleared status */

test('cleared status: toggle one, bulk clear and unclear, filter by cleared/uncleared', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'cleared@example.com');
    const a = (await tx(c, { payee: 'A', amountMinor: -1000 })).data.transaction;
    const b = (await tx(c, { payee: 'B', amountMinor: -2000 })).data.transaction;
    const d = (await tx(c, { payee: 'C', amountMinor: -3000 })).data.transaction;
    assert.deepEqual([a.cleared, b.cleared, d.cleared], [false, false, false]);

    assert.equal((await c.patch(`/api/transactions/${a.id}`, { cleared: true })).data.transaction.cleared, true);
    assert.equal((await c.patch(`/api/transactions/${a.id}`, { cleared: false })).data.transaction.cleared, false);
    assert.equal((await c.patch(`/api/transactions/${a.id}`, { cleared: 'yes' })).status, 400);

    let r = await c.post('/api/transactions/bulk', { ids: [a.id, b.id], action: 'update', changes: { cleared: true } });
    assert.equal(r.data.affected, 2);
    const ids = async (q) => (await c.get(`/api/transactions?${q}`)).data.transactions.map((t) => t.payee).sort();
    assert.deepEqual(await ids('cleared=yes'), ['A', 'B']);
    assert.deepEqual(await ids('cleared=no'), ['C']);
    assert.deepEqual(await ids('cleared=all'), ['A', 'B', 'C']);
    assert.equal((await c.get('/api/transactions?cleared=maybe')).status, 400);

    // the summary follows the filter too
    assert.equal((await c.get('/api/transactions?cleared=yes')).data.summary.expenseMinor, 3000);

    r = await c.post('/api/transactions/bulk', { ids: [a.id, b.id], action: 'update', changes: { cleared: false } });
    assert.equal(r.data.affected, 2);
    assert.deepEqual(await ids('cleared=yes'), []);
    // the CSV export honours the filter (A and B are cleared again, C never was)
    await c.post('/api/transactions/bulk', { ids: [a.id, b.id], action: 'update', changes: { cleared: true } });
    const csv = await (await c.req('/api/export/transactions.csv?cleared=no')).text();
    assert.match(csv, /,C,/);
    assert.doesNotMatch(csv, /,A,|,B,/);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- balances */

test('cleared vs uncleared balances: only cleared transactions count towards the cleared balance', async () => {
  const s = await start();
  try {
    const { c } = await bankExample(s, 'recon-balances@example.com');
    const r = await rec(c);
    assert.equal(r.openingBalanceMinor, 1000000);
    assert.equal(r.clearedBalanceMinor, 1000000 + 300000 - 5000);      // ₹12,950
    assert.equal(r.unclearedBalanceMinor, -12000);
    assert.equal(r.balanceMinor, 1000000 + 300000 - 5000 - 12000);     // what the Accounts page shows
    assert.equal(r.clearedCount, 2);
    assert.equal(r.unclearedCount, 1);
    assert.equal(r.lastReconciliation, null);
    assert.equal(r.transactions.length, 3);
    assert.equal((await c.get('/api/accounts')).data.accounts[0].balanceMinor, r.balanceMinor);

    // clearing the pending one moves it from uncleared to cleared
    const pending = r.transactions.find((t) => t.payee === 'Pending shop');
    await c.patch(`/api/transactions/${pending.id}`, { cleared: true });
    const r2 = await rec(c);
    assert.equal(r2.clearedBalanceMinor, r.balanceMinor);
    assert.equal(r2.unclearedBalanceMinor, 0);
    assert.equal(r2.unclearedCount, 0);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- the workflow */

test('reconcile: statement ₹13,000 vs SpendWise ₹12,950 shows the ₹50 difference and refuses until it is resolved', async () => {
  const s = await start();
  try {
    const { c } = await bankExample(s, 'recon-diff@example.com');
    const body = { statementBalanceMinor: 1300000, statementDate: '2026-11-04' };
    const r = await c.post(`/api/accounts/${c.accountId}/reconcile`, body);
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'discrepancy');
    assert.equal(r.data.differenceMinor, 5000);              // ₹50 missing from SpendWise
    assert.equal(r.data.clearedBalanceMinor, 1295000);
    assert.equal(r.data.statementBalanceMinor, 1300000);
    // nothing changed
    assert.equal((await rec(c)).lockedCount, 0);
    assert.equal((await c.get('/api/reconciliations')).data.reconciliations.length, 0);
  } finally { await s.close(); }
});

test('reconcile: resolve the difference with a manual adjustment transaction', async () => {
  const s = await start();
  try {
    const { c } = await bankExample(s, 'recon-adjust@example.com');
    const r = await c.post(`/api/accounts/${c.accountId}/reconcile`, {
      statementBalanceMinor: 1300000, statementDate: '2026-11-04', adjust: true, note: 'bank interest',
    });
    assert.equal(r.status, 201);
    const h = r.data.reconciliation;
    assert.equal(h.statementDate, '2026-11-04');
    assert.equal(h.statementBalanceMinor, 1300000);
    assert.equal(h.clearedBalanceMinor, 1295000);
    assert.equal(h.differenceMinor, 5000);
    assert.equal(h.adjustmentMinor, 5000);
    assert.equal(h.transactionCount, 3, 'salary + coffee + the adjustment');
    assert.equal(h.note, 'bank interest');
    assert.ok(h.reconciledAt, 'the moment you reconciled is recorded');
    assert.ok(h.adjustmentTransactionId);

    // the cleared balance now equals the statement
    assert.equal(r.data.clearedBalanceMinor, 1300000);
    const adj = (await c.get(`/api/transactions/${h.adjustmentTransactionId}`)).data.transaction;
    assert.equal(adj.amountMinor, 5000);
    assert.equal(adj.cleared, true);
    assert.equal(adj.reconciled, true);
    assert.equal(adj.payee, 'Reconciliation Balance Adjustment');
    assert.equal(adj.date, '2026-11-04');

    // the uncleared purchase is not locked and still open
    const after = await rec(c);
    assert.equal(after.lockedCount, 3);
    assert.equal(after.unclearedBalanceMinor, -12000);
    assert.equal(after.lastReconciliation.id, h.id);
    assert.deepEqual(after.transactions.map((t) => t.payee), ['Pending shop'], 'only unlocked transactions are offered next time');
  } finally { await s.close(); }
});

test('reconcile: a negative difference creates a negative adjustment; clearing the missing transaction avoids any adjustment', async () => {
  const s = await start();
  try {
    const { c } = await bankExample(s, 'recon-neg@example.com');
    // statement is ₹100 lower than SpendWise's cleared balance
    const r = await c.post(`/api/accounts/${c.accountId}/reconcile`, { statementBalanceMinor: 1285000, statementDate: '2026-11-04', adjust: true });
    assert.equal(r.data.reconciliation.adjustmentMinor, -10000);
    assert.equal((await c.get(`/api/transactions/${r.data.reconciliation.adjustmentTransactionId}`)).data.transaction.amountMinor, -10000);

    // second account: the bank already shows the pending purchase, so clear it instead of adjusting
    const s2 = await bankExample(s, 'recon-clear@example.com');
    const statement = 1295000 - 12000;
    assert.equal((await s2.c.post(`/api/accounts/${s2.c.accountId}/reconcile`, { statementBalanceMinor: statement, statementDate: '2026-11-04' })).status, 409);
    await s2.c.patch(`/api/transactions/${s2.pending.id}`, { cleared: true });
    const ok = await s2.c.post(`/api/accounts/${s2.c.accountId}/reconcile`, { statementBalanceMinor: statement, statementDate: '2026-11-04' });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.reconciliation.differenceMinor, 0);
    assert.equal(ok.data.reconciliation.adjustmentTransactionId, null);
    assert.equal(ok.data.reconciliation.transactionCount, 3);
  } finally { await s.close(); }
});

test('reconcile: the adjustment is an uncategorized amount in the budget (it is not hidden)', async () => {
  const s = await start();
  try {
    const { c } = await bankExample(s, 'recon-budget@example.com');
    const before = (await c.get('/api/budget/2026-11')).data;
    await c.post(`/api/accounts/${c.accountId}/reconcile`, { statementBalanceMinor: 1300000, statementDate: '2026-11-04', adjust: true });
    const after = (await c.get('/api/budget/2026-11')).data;
    assert.equal(after.toBudgetMinor - before.toBudgetMinor, 5000, 'a positive uncategorized adjustment is income to To Budget');
    const funds = (await c.get('/api/accounts')).data.totalFundsMinor;
    assert.equal(after.toBudgetMinor + after.availableMinor, funds);
  } finally { await s.close(); }
});

test('reconcile validates its input and will not record an empty reconciliation', async () => {
  const s = await start();
  try {
    const { c } = await bankExample(s, 'recon-validate@example.com');
    const url = `/api/accounts/${c.accountId}/reconcile`;
    assert.equal((await c.post(url, { statementDate: '2026-11-04' })).status, 400);
    assert.equal((await c.post(url, { statementBalanceMinor: 12.5, statementDate: '2026-11-04' })).status, 400);
    assert.equal((await c.post(url, { statementBalanceMinor: '1300000', statementDate: '2026-11-04' })).status, 400);
    assert.equal((await c.post(url, { statementBalanceMinor: 1300000 })).status, 400);
    assert.equal((await c.post(url, { statementBalanceMinor: 1300000, statementDate: '2026-02-31' })).status, 400);
    assert.equal((await c.post(url, { statementBalanceMinor: 1300000, statementDate: '2026-11-04', adjust: 'yes' })).status, 400);
    assert.equal((await c.post('/api/accounts/abc/reconcile', { statementBalanceMinor: 0, statementDate: '2026-11-04' })).status, 404);

    // reconcile once, then there is nothing new
    await c.post(url, { statementBalanceMinor: 1300000, statementDate: '2026-11-04', adjust: true });
    const again = await c.post(url, { statementBalanceMinor: 1300000, statementDate: '2026-11-05' });
    assert.equal(again.status, 409);
    assert.match(again.data.error, /Nothing new/);
    assert.equal((await c.get('/api/reconciliations')).data.reconciliations.length, 1);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- locking */

test('reconciled transactions are locked: no delete, no amount/date/account change, no un-clearing; category and notes still editable', async () => {
  const s = await start();
  try {
    const { c, salary, coffee } = await bankExample(s, 'recon-lock@example.com');
    await c.post(`/api/accounts/${c.accountId}/reconcile`, { statementBalanceMinor: 1300000, statementDate: '2026-11-04', adjust: true });
    const acct2 = (await c.post('/api/accounts', { name: 'Savings', type: 'savings' })).data.account;

    assert.equal((await c.del(`/api/transactions/${coffee.id}`)).status, 409);
    assert.equal((await c.patch(`/api/transactions/${coffee.id}`, { amountMinor: -6000 })).status, 409);
    assert.equal((await c.patch(`/api/transactions/${coffee.id}`, { date: '2026-11-09' })).status, 409);
    assert.equal((await c.patch(`/api/transactions/${coffee.id}`, { accountId: acct2.id })).status, 409);
    assert.equal((await c.patch(`/api/transactions/${coffee.id}`, { cleared: false })).status, 409);
    assert.equal((await c.post('/api/transactions/bulk', { ids: [coffee.id, salary.id], action: 'delete' })).status, 409);
    assert.equal((await c.post('/api/transactions/bulk', { ids: [coffee.id], action: 'update', changes: { cleared: false } })).status, 409);
    assert.equal((await c.post('/api/transactions/bulk', { ids: [coffee.id], action: 'update', changes: { date: '2026-11-09' } })).status, 409);
    assert.equal((await c.post('/api/transactions/bulk', { ids: [coffee.id], action: 'update', changes: { accountId: acct2.id } })).status, 409);

    // allowed: things that cannot change the balance
    const ok = await c.patch(`/api/transactions/${coffee.id}`, { categoryId: c.cat.Other, notes: 'fixed later', payee: 'Cafe Coffee Day', cleared: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.transaction.categoryName, 'Other');
    assert.equal(ok.data.transaction.reconciled, true);
    assert.equal((await c.post('/api/transactions/bulk', { ids: [coffee.id], action: 'update', changes: { cleared: true, categoryId: c.cat.Food } })).status, 200);

    // the account cannot vanish under its history either
    assert.equal((await c.del(`/api/accounts/${c.accountId}`)).status, 409);
    // and the balance never moved
    assert.equal((await rec(c)).clearedBalanceMinor, 1300000);
  } finally { await s.close(); }
});

test('a split transaction can be re-split after reconciling, because its total does not change', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'recon-split@example.com');
    const t = (await c.post('/api/transactions', {
      accountId: c.accountId, date: '2026-11-05', amountMinor: -300000, payee: 'Amazon', cleared: true,
      splits: [{ categoryId: c.cat.Shopping, amountMinor: -200000 }, { categoryId: c.cat.Food, amountMinor: -100000 }],
    })).data.transaction;
    assert.equal((await c.post(`/api/accounts/${c.accountId}/reconcile`, { statementBalanceMinor: -300000, statementDate: '2026-11-06' })).status, 201);
    const r = await c.json(`/api/transactions/${t.id}/splits`, { method: 'PUT', body: { splits: [
      { categoryId: c.cat.Bills, amountMinor: -100000 }, { categoryId: c.cat.Other, amountMinor: -200000 }] } });
    assert.equal(r.status, 200);
    assert.equal(r.data.transaction.reconciled, true);
    assert.equal((await c.patch(`/api/transactions/${t.id}`, { amountMinor: -400000, splits: [
      { categoryId: c.cat.Bills, amountMinor: -100000 }, { categoryId: c.cat.Other, amountMinor: -300000 }] })).status, 409);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- history and undo */

test('reconciliation history: newest first, with detail, and undo only for the newest', async () => {
  const s = await start();
  try {
    const { c, pending } = await bankExample(s, 'recon-history@example.com');
    const first = (await c.post(`/api/accounts/${c.accountId}/reconcile`, { statementBalanceMinor: 1300000, statementDate: '2026-11-04', adjust: true })).data.reconciliation;

    await c.patch(`/api/transactions/${pending.id}`, { cleared: true });
    const next = (await tx(c, { amountMinor: -3000, payee: 'Chai', date: '2026-11-10' })).data.transaction;
    await c.patch(`/api/transactions/${next.id}`, { cleared: true });
    const second = (await c.post(`/api/accounts/${c.accountId}/reconcile`, { statementBalanceMinor: 1300000 - 12000 - 3000, statementDate: '2026-11-12' })).data.reconciliation;
    assert.equal(second.transactionCount, 2);
    assert.equal(second.differenceMinor, 0);

    const list = (await c.get('/api/reconciliations')).data.reconciliations;
    assert.deepEqual(list.map((x) => x.id), [second.id, first.id]);
    assert.deepEqual(list.map((x) => x.canUndo), [true, false]);
    assert.equal(list[0].accountName, 'Cash');
    assert.equal((await c.get(`/api/reconciliations?account=${c.accountId}`)).data.reconciliations.length, 2);

    const detail = (await c.get(`/api/reconciliations/${first.id}`)).data;
    assert.deepEqual(detail.transactions.map((t) => t.payee).sort(), ['Cafe', 'Employer', 'Reconciliation Balance Adjustment']);
    assert.equal(detail.reconciliation.statementBalanceMinor, 1300000);

    // the older one is covered by the newer one
    assert.equal((await c.del(`/api/reconciliations/${first.id}`)).status, 409);
    // undo the newest: its transactions unlock
    assert.equal((await c.del(`/api/reconciliations/${second.id}`)).status, 200);
    assert.equal((await c.patch(`/api/transactions/${next.id}`, { amountMinor: -3500 })).status, 200);
    assert.equal((await c.get('/api/reconciliations')).data.reconciliations.length, 1);

    // undo the first: its adjustment transaction disappears and everything unlocks
    assert.equal((await c.del(`/api/reconciliations/${first.id}`)).status, 200);
    assert.equal((await c.get(`/api/transactions/${first.adjustmentTransactionId}`)).status, 404);
    const r = await rec(c);
    assert.equal(r.lockedCount, 0);
    assert.equal(r.clearedBalanceMinor, 1000000 + 300000 - 5000 - 12000 - 3500);
    assert.equal(r.lastReconciliation, null);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- multi-user security */

test('user B cannot reconcile, read, list or undo anything of user A', async () => {
  const s = await start();
  try {
    const { c: a } = await bankExample(s, 'recon-a@example.com');
    const b = await newUser(s.base, 'recon-b@example.com');
    const made = (await a.post(`/api/accounts/${a.accountId}/reconcile`, { statementBalanceMinor: 1300000, statementDate: '2026-11-04', adjust: true })).data.reconciliation;

    // A's account
    assert.equal((await b.get(`/api/accounts/${a.accountId}/reconciliation`)).status, 404);
    const attempt = await b.post(`/api/accounts/${a.accountId}/reconcile`, { statementBalanceMinor: 0, statementDate: '2026-11-04', adjust: true });
    assert.equal(attempt.status, 404);
    // A's history
    assert.equal((await b.get(`/api/reconciliations/${made.id}`)).status, 404);
    assert.equal((await b.del(`/api/reconciliations/${made.id}`)).status, 404);
    assert.equal((await b.get(`/api/reconciliations?account=${a.accountId}`)).status, 404);
    assert.deepEqual((await b.get('/api/reconciliations')).data.reconciliations, []);

    // nothing of A's moved: still locked, balance unchanged, B has no stray adjustment
    assert.equal((await rec(a)).clearedBalanceMinor, 1300000);
    assert.equal((await rec(a)).lockedCount, 3);
    assert.equal((await b.get('/api/transactions')).data.total, 0);
    assert.equal((await a.get('/api/reconciliations')).data.reconciliations.length, 1);
  } finally { await s.close(); }
});

test('reconciliation routes need a login', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    await c.json('/api/auth/csrf');
    assert.equal((await c.get('/api/accounts/1/reconciliation')).status, 401);
    assert.equal((await c.post('/api/accounts/1/reconcile', { statementBalanceMinor: 0, statementDate: '2026-11-04' })).status, 401);
    assert.equal((await c.get('/api/reconciliations')).status, 401);
    assert.equal((await c.get('/api/reconciliations/1')).status, 401);
    assert.equal((await c.del('/api/reconciliations/1')).status, 401);
  } finally { await s.close(); }
});
