'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, newUser, tx } = require('./helpers');

const MONTH = '2026-11';

/** A user with a Salary income and an extra "Electronics" category. */
async function setup(s, email) {
  const c = await newUser(s.base, email);
  c.cat.Electronics = (await c.post('/api/categories', { groupId: c.groupIds['Usual Expenses'], name: 'Electronics' })).data.category.id;
  return c;
}

/** The Amazon example from the brief: ₹3,000 split into Shopping ₹2,000 and Electronics ₹1,000. */
const amazon = (c, over = {}) => c.post('/api/transactions', {
  accountId: c.accountId, date: '2026-11-05', amountMinor: -300000, payee: 'Amazon',
  splits: [
    { categoryId: c.cat.Shopping, amountMinor: -200000 },
    { categoryId: c.cat.Electronics, amountMinor: -100000, notes: 'headphones' },
  ],
  ...over,
});

/** Every split transaction's parts add up to its amount (and there are at least two); normal transactions have no parts. */
function assertInvariant(db) {
  const bad = db.prepare(
    `SELECT t.id FROM transactions t
      WHERE (t.is_split = 1 AND (SELECT COALESCE(SUM(amount_minor), 0) FROM transaction_splits s WHERE s.transaction_id = t.id) != t.amount_minor)
         OR (t.is_split = 1 AND (SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) < 2)
         OR (t.is_split = 0 AND EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id))
         OR (t.is_split = 1 AND t.category_id IS NOT NULL)`
  ).all();
  assert.deepEqual(bad, [], 'split invariant broken');
}

const activity = (budget) => Object.fromEntries(budget.groups.flatMap((g) => g.categories).map((x) => [x.name, x.activityMinor]));

/* ---------------------------------------------------------------- creating */

test('create the Amazon split: ₹3,000 into Shopping ₹2,000 + Electronics ₹1,000', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-create@example.com');
    const r = await amazon(c);
    assert.equal(r.status, 201);
    const t = r.data.transaction;
    assert.equal(t.isSplit, true);
    assert.equal(t.amountMinor, -300000);
    assert.equal(t.categoryId, null, 'a split transaction has no category of its own');
    assert.deepEqual(t.splits.map((x) => [x.categoryName, x.amountMinor, x.notes]), [['Shopping', -200000, ''], ['Electronics', -100000, 'headphones']]);

    // The account still moves by the full ₹3,000, once.
    const accts = (await c.get('/api/accounts')).data;
    assert.equal(accts.accounts[0].balanceMinor, -300000);
    assert.equal(accts.totalFundsMinor, -300000);
    assertInvariant(s.server.db);
  } finally { await s.close(); }
});

test('split validation: must add up, at least two parts, own categories, no zero parts', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-validate@example.com');
    const b = await newUser(s.base, 'split-validate-b@example.com');
    const base = { accountId: c.accountId, date: '2026-11-05', amountMinor: -300000, payee: 'Amazon' };
    const post = (splits, extra = {}) => c.post('/api/transactions', { ...base, splits, ...extra });

    const short = await post([{ categoryId: c.cat.Shopping, amountMinor: -200000 }, { categoryId: c.cat.Electronics, amountMinor: -99999 }]);
    assert.equal(short.status, 400);
    assert.match(short.data.error, /add up/);
    assert.equal((await post([{ categoryId: c.cat.Shopping, amountMinor: -300000 }])).status, 400, 'one part is not a split');
    assert.equal((await post([])).status, 400);
    assert.equal((await post('nope')).status, 400);
    assert.equal((await post([{ categoryId: c.cat.Shopping, amountMinor: -300000 }, { categoryId: c.cat.Food, amountMinor: 0 }])).status, 400, 'zero part');
    assert.equal((await post([{ categoryId: c.cat.Shopping, amountMinor: -150000.5 }, { categoryId: c.cat.Food, amountMinor: -149999.5 }])).status, 400, 'fractions of a paisa');
    assert.equal((await post(Array.from({ length: 31 }, () => ({ categoryId: c.cat.Food, amountMinor: -1 })), { amountMinor: -31 })).status, 400, 'too many parts');
    // someone else's category
    assert.equal((await post([{ categoryId: b.cat.Food, amountMinor: -100000 }, { categoryId: c.cat.Food, amountMinor: -200000 }])).status, 400);
    // single category AND splits is ambiguous
    assert.equal((await post([{ categoryId: c.cat.Shopping, amountMinor: -100000 }, { categoryId: c.cat.Food, amountMinor: -200000 }], { categoryId: c.cat.Food })).status, 400);

    assert.equal((await c.get('/api/transactions')).data.total, 0, 'nothing half-saved');
    assert.equal(s.server.db.prepare('SELECT COUNT(*) AS n FROM transaction_splits').get().n, 0);
  } finally { await s.close(); }
});

test('a split may have an uncategorized part, and parts may be mixed (item + discount)', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-mixed@example.com');
    const r = await c.post('/api/transactions', {
      accountId: c.accountId, date: '2026-11-05', amountMinor: -250000, payee: 'Croma',
      splits: [{ categoryId: c.cat.Electronics, amountMinor: -300000 }, { categoryId: null, amountMinor: 50000, notes: 'coupon' }],
    });
    assert.equal(r.status, 201);
    assert.deepEqual(r.data.transaction.splits.map((x) => x.categoryName), ['Electronics', null]);
    assertInvariant(s.server.db);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- viewing */

test('view split details: single transaction and the list both carry the parts', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-view@example.com');
    const id = (await amazon(c)).data.transaction.id;
    await tx(c, { payee: 'Plain', amountMinor: -1000 });

    const one = (await c.get(`/api/transactions/${id}`)).data.transaction;
    assert.equal(one.splits.length, 2);
    assert.equal(one.splits[1].categoryIcon !== null, true);

    const list = (await c.get('/api/transactions')).data.transactions;
    const sp = list.find((t) => t.id === id);
    assert.equal(sp.isSplit, true);
    assert.equal(sp.splits.length, 2);
    const plain = list.find((t) => t.payee === 'Plain');
    assert.equal(plain.isSplit, false);
    assert.deepEqual(plain.splits, []);
    assert.equal((await c.get('/api/transactions/999999')).status, 404);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- editing */

test('edit splits: replace them, change amount only together with splits, unsplit, split a normal transaction', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-edit@example.com');
    const id = (await amazon(c)).data.transaction.id;

    // replace the parts (Food ₹500 + Shopping ₹2,500)
    let r = await c.json(`/api/transactions/${id}/splits`, { method: 'PUT', body: { splits: [
      { categoryId: c.cat.Food, amountMinor: -50000 }, { categoryId: c.cat.Shopping, amountMinor: -250000 }] } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.transaction.splits.map((x) => [x.categoryName, x.amountMinor]), [['Food', -50000], ['Shopping', -250000]]);
    assert.equal((await c.json(`/api/transactions/${id}/splits`, { method: 'PUT', body: { splits: [
      { categoryId: c.cat.Food, amountMinor: -50000 }, { categoryId: c.cat.Shopping, amountMinor: -50000 }] } })).status, 400, 'must add up');

    // amount change alone is refused; with matching splits it works and the balance follows
    assert.equal((await c.patch(`/api/transactions/${id}`, { amountMinor: -400000 })).status, 400);
    r = await c.patch(`/api/transactions/${id}`, { amountMinor: -400000, splits: [
      { categoryId: c.cat.Food, amountMinor: -100000 }, { categoryId: c.cat.Shopping, amountMinor: -300000 }] });
    assert.equal(r.status, 200);
    assert.equal((await c.get('/api/accounts')).data.accounts[0].balanceMinor, -400000);

    // a single category on a split transaction is refused; other fields still edit fine
    assert.equal((await c.patch(`/api/transactions/${id}`, { categoryId: c.cat.Food })).status, 400);
    r = await c.patch(`/api/transactions/${id}`, { notes: 'gift', payee: 'Amazon India', categoryId: null });
    assert.equal(r.status, 200);
    assert.equal(r.data.transaction.isSplit, true);
    assert.equal(r.data.transaction.splits.length, 2);

    // unsplit into one category
    r = await c.patch(`/api/transactions/${id}`, { splits: null, categoryId: c.cat.Shopping });
    assert.equal(r.data.transaction.isSplit, false);
    assert.equal(r.data.transaction.categoryName, 'Shopping');
    assert.equal(s.server.db.prepare('SELECT COUNT(*) AS n FROM transaction_splits').get().n, 0);

    // and a normal transaction can be split later
    const plain = (await tx(c, { amountMinor: -90000, payee: 'Big Basket', categoryId: c.cat.Food })).data.transaction;
    r = await c.patch(`/api/transactions/${plain.id}`, { splits: [
      { categoryId: c.cat.Food, amountMinor: -60000 }, { categoryId: c.cat.Other, amountMinor: -30000 }] });
    assert.equal(r.status, 200);
    assert.equal(r.data.transaction.isSplit, true);
    assert.equal(r.data.transaction.categoryId, null);
    assertInvariant(s.server.db);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- deleting one split */

test('delete an individual split: its amount goes to another split, last two collapse to a normal transaction', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-delete@example.com');
    const made = (await c.post('/api/transactions', {
      accountId: c.accountId, date: '2026-11-05', amountMinor: -300000, payee: 'Mall',
      splits: [{ categoryId: c.cat.Shopping, amountMinor: -200000 }, { categoryId: c.cat.Electronics, amountMinor: -60000 }, { categoryId: c.cat.Food, amountMinor: -40000 }],
    })).data.transaction;
    const [shop, elec, food] = made.splits;

    // three parts: you must say where the money goes
    assert.equal((await c.del(`/api/transactions/${made.id}/splits/${food.id}`)).status, 400);
    assert.equal((await c.del(`/api/transactions/${made.id}/splits/${food.id}?moveTo=${food.id}`)).status, 400, 'cannot move into itself');
    let r = await c.del(`/api/transactions/${made.id}/splits/${food.id}?moveTo=${elec.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.unsplit, false);
    assert.deepEqual(r.data.transaction.splits.map((x) => [x.categoryName, x.amountMinor]), [['Shopping', -200000], ['Electronics', -100000]]);
    assert.equal(r.data.transaction.amountMinor, -300000, 'the total never changes');
    assertInvariant(s.server.db);

    // two parts: deleting one folds it into the other and the transaction is a normal one again
    r = await c.del(`/api/transactions/${made.id}/splits/${elec.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.data.unsplit, true);
    assert.equal(r.data.transaction.isSplit, false);
    assert.equal(r.data.transaction.categoryName, 'Shopping');
    assert.equal(r.data.transaction.amountMinor, -300000);
    assertInvariant(s.server.db);

    assert.equal((await c.del(`/api/transactions/${made.id}/splits/${shop.id}`)).status, 404, 'not split any more');
    assert.equal((await c.del(`/api/transactions/${made.id}/splits/99999`)).status, 404);
  } finally { await s.close(); }
});

test('deleting a split transaction deletes its splits too', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-cascade@example.com');
    const id = (await amazon(c)).data.transaction.id;
    assert.equal((await c.del(`/api/transactions/${id}`)).status, 200);
    assert.equal(s.server.db.prepare('SELECT COUNT(*) AS n FROM transaction_splits').get().n, 0);
    const again = await amazon(c);
    assert.equal((await c.post('/api/transactions/bulk', { ids: [again.data.transaction.id], action: 'delete' })).status, 200);
    assert.equal(s.server.db.prepare('SELECT COUNT(*) AS n FROM transaction_splits').get().n, 0);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- budget */

test('budget: a split transaction affects each envelope by its own part, exactly like separate transactions', async () => {
  const s = await start();
  try {
    const a = await setup(s, 'split-budget-a@example.com');   // one split transaction
    const b = await setup(s, 'split-budget-b@example.com');   // the same money as two plain transactions
    for (const c of [a, b]) {
      await tx(c, { amountMinor: 5000000, payee: 'Employer', categoryId: c.cat.Salary, date: '2026-11-01' });
      await c.json(`/api/budget/${MONTH}/categories/${c.cat.Shopping}`, { method: 'PATCH', body: { assignedMinor: 500000 } });
      await c.json(`/api/budget/${MONTH}/categories/${c.cat.Electronics}`, { method: 'PATCH', body: { assignedMinor: 200000 } });
    }
    await amazon(a);
    await tx(b, { amountMinor: -200000, payee: 'Amazon', categoryId: b.cat.Shopping });
    await tx(b, { amountMinor: -100000, payee: 'Amazon', categoryId: b.cat.Electronics });

    const ba = (await a.get(`/api/budget/${MONTH}`)).data;
    const bb = (await b.get(`/api/budget/${MONTH}`)).data;
    assert.equal(activity(ba).Shopping, -200000);
    assert.equal(activity(ba).Electronics, -100000);
    assert.deepEqual(activity(ba), activity(bb));
    assert.equal(ba.toBudgetMinor, bb.toBudgetMinor);
    assert.equal(ba.activityMinor, bb.activityMinor);
    assert.equal(ba.availableMinor, bb.availableMinor);
    // the one rule that must always hold: To Budget + every Available = money in on-budget accounts
    const funds = (await a.get('/api/accounts')).data.totalFundsMinor;
    assert.equal(ba.toBudgetMinor + ba.availableMinor, funds);
  } finally { await s.close(); }
});

test('budget: an uncategorized part of a split comes out of To Budget; editing the split moves the money between envelopes', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-budget-uncat@example.com');
    await tx(c, { amountMinor: 1000000, payee: 'Employer', categoryId: c.cat.Salary, date: '2026-11-01' });
    const id = (await c.post('/api/transactions', {
      accountId: c.accountId, date: '2026-11-05', amountMinor: -100000, payee: 'Shop',
      splits: [{ categoryId: c.cat.Food, amountMinor: -60000 }, { categoryId: null, amountMinor: -40000 }],
    })).data.transaction.id;
    let bud = (await c.get(`/api/budget/${MONTH}`)).data;
    assert.equal(activity(bud).Food, -60000);
    assert.equal(bud.uncategorizedSpendMinor, 40000);
    assert.equal(bud.toBudgetMinor, 1000000 - 40000);

    await c.json(`/api/transactions/${id}/splits`, { method: 'PUT', body: { splits: [
      { categoryId: c.cat.Food, amountMinor: -10000 }, { categoryId: c.cat.Bills, amountMinor: -90000 }] } });
    bud = (await c.get(`/api/budget/${MONTH}`)).data;
    assert.equal(activity(bud).Food, -10000);
    assert.equal(activity(bud).Bills, -90000);
    assert.equal(bud.uncategorizedSpendMinor, 0);
    assert.equal(bud.toBudgetMinor, 1000000);
  } finally { await s.close(); }
});

test('budget: off-budget accounts are left out for split transactions too', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-offbudget@example.com');
    const off = (await c.post('/api/accounts', { name: 'Investments', type: 'investment', offbudget: true })).data.account;
    await amazon(c, { accountId: off.id });
    const bud = (await c.get(`/api/budget/${MONTH}`)).data;
    assert.equal(activity(bud).Shopping, 0);
    assert.equal(activity(bud).Electronics, 0);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- reports and filters */

test('reports: spending by category counts each split in its own category, and always adds up', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-report@example.com');
    await amazon(c);
    await tx(c, { amountMinor: -50000, payee: 'Cafe', categoryId: c.cat.Food });
    await tx(c, { amountMinor: 1000000, payee: 'Employer', categoryId: c.cat.Salary });

    const rep = (await c.get(`/api/reports/spending-by-category?month=${MONTH}`)).data;
    const by = Object.fromEntries(rep.categories.map((x) => [x.name, x]));
    assert.equal(by.Shopping.spentMinor, 200000);
    assert.equal(by.Electronics.spentMinor, 100000);
    assert.equal(by.Food.spentMinor, 50000);
    assert.equal(by.Salary.receivedMinor, 1000000);
    assert.equal(by.Uncategorized, undefined, 'the parent amount is not counted again');

    assert.equal(rep.totals.spentMinor, 350000);
    assert.equal(rep.totals.receivedMinor, 1000000);
    assert.equal(rep.totals.netMinor, rep.categories.reduce((n, x) => n + x.netMinor, 0));
    // ... and equals the Transactions page's own totals
    const sum = (await c.get(`/api/transactions?month=${MONTH}`)).data.summary;
    assert.equal(rep.totals.spentMinor, sum.expenseMinor);
    assert.equal(rep.totals.receivedMinor, sum.incomeMinor);

    assert.equal((await c.get('/api/reports/spending-by-category?month=bad')).status, 400);
    const onlyOct = (await c.get('/api/reports/spending-by-category?month=2026-10')).data;
    assert.deepEqual(onlyOct.categories, []);
  } finally { await s.close(); }
});

test('reports: splits stay correct when mixed with refunds and when filtered by account', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-report2@example.com');
    const acct2 = (await c.post('/api/accounts', { name: 'Card', type: 'credit' })).data.account;
    await c.post('/api/transactions', {
      accountId: acct2.id, date: '2026-11-05', amountMinor: -250000, payee: 'Croma',
      splits: [{ categoryId: c.cat.Electronics, amountMinor: -300000 }, { categoryId: c.cat.Electronics, amountMinor: 50000, notes: 'discount' }],
    });
    await amazon(c);
    const card = (await c.get(`/api/reports/spending-by-category?month=${MONTH}&account=${acct2.id}`)).data;
    assert.equal(card.categories.length, 1);
    assert.equal(card.categories[0].spentMinor, 300000);
    assert.equal(card.categories[0].receivedMinor, 50000);
    assert.equal(card.categories[0].netMinor, -250000);
    assert.equal((await c.get('/api/reports/spending-by-category?account=99999')).status, 404);
  } finally { await s.close(); }
});

test('list filters: by category finds a split transaction and its summary counts only that part; uncategorized part is found too', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-filter@example.com');
    const id = (await amazon(c)).data.transaction.id;
    const plain = (await tx(c, { amountMinor: -70000, categoryId: c.cat.Shopping, payee: 'Shoes' })).data.transaction.id;
    const other = (await c.post('/api/transactions', {
      accountId: c.accountId, date: '2026-11-06', amountMinor: -80000, payee: 'Mixed',
      splits: [{ categoryId: c.cat.Food, amountMinor: -50000 }, { categoryId: null, amountMinor: -30000 }],
    })).data.transaction.id;

    let r = (await c.get(`/api/transactions?month=${MONTH}&category=${c.cat.Shopping}`)).data;
    assert.deepEqual(r.transactions.map((t) => t.id).sort(), [id, plain].sort());
    assert.equal(r.summary.expenseMinor, 200000 + 70000, 'only the Shopping part of the split + the plain one');

    r = (await c.get(`/api/transactions?month=${MONTH}&category=${c.cat.Electronics}`)).data;
    assert.deepEqual(r.transactions.map((t) => t.id), [id]);
    assert.equal(r.summary.expenseMinor, 100000);

    r = (await c.get(`/api/transactions?month=${MONTH}&category=none`)).data;
    assert.deepEqual(r.transactions.map((t) => t.id), [other]);
    assert.equal(r.summary.expenseMinor, 30000);

    r = (await c.get(`/api/transactions?month=${MONTH}`)).data;
    assert.equal(r.summary.expenseMinor, 300000 + 70000 + 80000, 'unfiltered: whole transactions');

    r = (await c.get(`/api/transactions?month=${MONTH}&q=electronics`)).data;
    assert.deepEqual(r.transactions.map((t) => t.id), [id], 'search finds a split by one of its category names');
    r = (await c.get(`/api/transactions?month=${MONTH}&q=headphones`)).data;
    assert.deepEqual(r.transactions.map((t) => t.id), [id], 'and by a split note');
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- categories, bulk, rules */

test('merging or deleting a category moves its splits, and usage counts include splits', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-category@example.com');
    const id = (await amazon(c)).data.transaction.id;
    const cats = () => (c.get('/api/categories')).then((r) => Object.fromEntries(r.data.groups.flatMap((g) => g.categories).map((x) => [x.name, x])));
    assert.equal((await cats()).Electronics.transactionCount, 1);

    // deleting a used category asks where to move things
    assert.equal((await c.del(`/api/categories/${c.cat.Electronics}`)).status, 409);
    assert.equal((await c.post(`/api/categories/${c.cat.Electronics}/merge`, { targetId: c.cat.Shopping })).status, 200);

    const t = (await c.get(`/api/transactions/${id}`)).data.transaction;
    assert.deepEqual(t.splits.map((x) => x.categoryName), ['Shopping', 'Shopping']);
    assert.equal(t.splits.reduce((n, x) => n + x.amountMinor, 0), -300000);
    assert.equal((await cats()).Shopping.transactionCount, 1, 'one transaction, not two splits');

    assert.equal((await c.del(`/api/categories/${c.cat.Shopping}?moveTo=none`)).status, 200);
    const after = (await c.get(`/api/transactions/${id}`)).data.transaction;
    assert.deepEqual(after.splits.map((x) => x.categoryId), [null, null]);
    assertInvariant(s.server.db);
  } finally { await s.close(); }
});

test('bulk category change skips split transactions and says so; other bulk changes still apply to them', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-bulk@example.com');
    const sp = (await amazon(c)).data.transaction.id;
    const plain = (await tx(c, { amountMinor: -1000, categoryId: null })).data.transaction.id;

    let r = await c.post('/api/transactions/bulk', { ids: [sp, plain], action: 'update', changes: { categoryId: c.cat.Food } });
    assert.equal(r.status, 200);
    assert.equal(r.data.skippedSplit, 1);
    assert.equal(r.data.affected, 1);
    assert.equal((await c.get(`/api/transactions/${plain}`)).data.transaction.categoryName, 'Food');
    const still = (await c.get(`/api/transactions/${sp}`)).data.transaction;
    assert.equal(still.isSplit, true);
    assert.deepEqual(still.splits.map((x) => x.categoryName), ['Shopping', 'Electronics']);

    r = await c.post('/api/transactions/bulk', { ids: [sp, plain], action: 'update', changes: { date: '2026-11-09', cleared: true } });
    assert.equal(r.data.affected, 2);
    assert.equal((await c.get(`/api/transactions/${sp}`)).data.transaction.date, '2026-11-09');
  } finally { await s.close(); }
});

test('rules on a new split transaction: payee, notes and cleared apply; a "set category" rule does not override the splits', async () => {
  const s = await start();
  try {
    const c = await setup(s, 'split-rules@example.com');
    await c.post('/api/rules', {
      name: 'Amazon', matchMode: 'all',
      conditions: [{ type: 'description_contains', value: 'amazon' }],
      actions: [{ type: 'set_category', categoryId: c.cat.Bills }, { type: 'add_note', text: '[rule]' }, { type: 'mark_cleared' }],
    });
    const r = await amazon(c);
    const t = r.data.transaction;
    assert.equal(t.isSplit, true);
    assert.equal(t.categoryId, null);
    assert.deepEqual(t.splits.map((x) => x.categoryName), ['Shopping', 'Electronics']);
    assert.equal(t.notes, '[rule]');
    assert.equal(t.cleared, true);
    assert.equal(r.data.rulesApplied.length, 1);

    // re-applying rules to existing data never gives a split transaction a category either
    const dry = (await c.post('/api/rules/reprocess', { dryRun: false, month: 'all' })).data;
    assert.ok(dry.scanned >= 1);
    assert.equal((await c.get(`/api/transactions/${t.id}`)).data.transaction.categoryId, null);
    assertInvariant(s.server.db);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- export / backup */

test('CSV export writes one row per split and the rows add up; the full backup round-trips splits', async () => {
  const s = await start();
  try {
    const a = await setup(s, 'split-export@example.com');
    await amazon(a);
    await tx(a, { amountMinor: -50000, payee: 'Cafe', categoryId: a.cat.Food });

    const csv = await (await a.req('/api/export/transactions.csv')).text();
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    assert.equal(lines.length, 1 + 3, 'header + 2 split rows + 1 plain row');
    assert.ok(lines.some((l) => /Amazon,Shopping,.*expense,2000\.00/.test(l)));
    assert.ok(lines.some((l) => /Amazon,Electronics,headphones,expense,1000\.00/.test(l)));

    const full = (await a.get('/api/export/full.json')).data;
    const am = full.transactions.find((t) => t.payee === 'Amazon');
    assert.equal(am.category, '');
    assert.deepEqual(am.splits.map((x) => [x.category, x.amountMinor]), [['Shopping', -200000], ['Electronics', -100000]]);

    // restore into a brand-new user
    const b = await newUser(s.base, 'split-restore@example.com');
    const imp = await b.post('/api/import/spendwise-backup', { data: full, accountId: b.accountId });
    assert.equal(imp.status, 200);
    assert.equal(imp.data.added, 2);
    const got = (await b.get('/api/transactions')).data.transactions.find((t) => t.payee === 'Amazon');
    assert.equal(got.isSplit, true);
    assert.deepEqual(got.splits.map((x) => [x.categoryName, x.amountMinor]), [['Shopping', -200000], ['Electronics', -100000]]);
    assert.equal((await b.post('/api/import/spendwise-backup', { data: full, accountId: b.accountId })).data.added, 0, 'second import adds nothing');

    // a backup whose splits do not add up is rejected record by record
    const broken = JSON.parse(JSON.stringify(full));
    broken.transactions.find((t) => t.payee === 'Amazon').splits[0].amountMinor = -1;
    const c2 = await newUser(s.base, 'split-restore2@example.com');
    const r = await c2.post('/api/import/spendwise-backup', { data: broken, accountId: c2.accountId });
    assert.equal(r.data.invalid, 1);
    assert.equal(r.data.added, 1);
    assertInvariant(s.server.db);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- multi-user isolation */

test('user B cannot see, edit, split-edit or delete a split of user A', async () => {
  const s = await start();
  try {
    const a = await setup(s, 'split-iso-a@example.com');
    const b = await setup(s, 'split-iso-b@example.com');
    const t = (await amazon(a)).data.transaction;

    assert.equal((await b.get(`/api/transactions/${t.id}`)).status, 404);
    assert.equal((await b.json(`/api/transactions/${t.id}/splits`, { method: 'PUT', body: { splits: [
      { categoryId: b.cat.Food, amountMinor: -100000 }, { categoryId: b.cat.Other, amountMinor: -200000 }] } })).status, 404);
    assert.equal((await b.del(`/api/transactions/${t.id}/splits/${t.splits[0].id}?moveTo=${t.splits[1].id}`)).status, 404);
    assert.equal((await b.patch(`/api/transactions/${t.id}`, { splits: null })).status, 404);
    assert.equal((await b.get('/api/transactions')).data.total, 0);
    assert.deepEqual((await b.get(`/api/reports/spending-by-category?month=${MONTH}`)).data.categories, []);
    assert.equal(activity((await b.get(`/api/budget/${MONTH}`)).data).Shopping, 0);

    // B cannot split their own transaction into A's categories
    const mine = (await tx(b, { amountMinor: -1000 })).data.transaction;
    assert.equal((await b.json(`/api/transactions/${mine.id}/splits`, { method: 'PUT', body: { splits: [
      { categoryId: a.cat.Shopping, amountMinor: -400 }, { categoryId: b.cat.Food, amountMinor: -600 }] } })).status, 400);

    // A's split is untouched
    const still = (await a.get(`/api/transactions/${t.id}`)).data.transaction;
    assert.equal(still.splits.length, 2);
    assertInvariant(s.server.db);
  } finally { await s.close(); }
});

test('split routes need a login', async () => {
  const s = await start();
  try {
    const { Client } = require('./helpers');
    const c = new Client(s.base);
    await c.json('/api/auth/csrf');
    assert.equal((await c.get('/api/transactions/1')).status, 401);
    assert.equal((await c.json('/api/transactions/1/splits', { method: 'PUT', body: { splits: [] } })).status, 401);
    assert.equal((await c.del('/api/transactions/1/splits/1')).status, 401);
    assert.equal((await c.get('/api/reports/spending-by-category')).status, 401);
  } finally { await s.close(); }
});
