'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, newUser, tx } = require('./helpers');

/* ---------- seeding ---------- */

test('a new user starts with a Cash account and your six categories', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'seed@example.com');
    const accts = (await c.get('/api/accounts')).data.accounts;
    assert.equal(accts.length, 1);
    assert.equal(accts[0].name, 'Cash');
    assert.equal(accts[0].balanceMinor, 0);
    const groups = (await c.get('/api/categories')).data.groups;
    assert.deepEqual(groups.map((g) => g.name), ['Income', 'Usual Expenses']);
    assert.equal(groups[0].isIncome, true);
    assert.deepEqual(groups[0].categories.map((x) => x.name), ['Salary']);
    assert.deepEqual(groups[1].categories.map((x) => x.name), ['Food', 'Travel', 'Shopping', 'Bills', 'Other']);
    assert.equal(groups[1].categories[0].icon, '🍕');
  } finally { await s.close(); }
});

test('all data routes need a login', async () => {
  const s = await start();
  try {
    const { Client } = require('./helpers');
    const c = new Client(s.base);
    for (const p of ['/api/accounts', '/api/categories', '/api/transactions', '/api/transactions/months', '/api/export/full.json', '/api/export/transactions.csv']) {
      assert.equal((await c.get(p)).status, 401, p);
    }
  } finally { await s.close(); }
});

/* ---------- isolation (the most important test in the project) ---------- */

test('user B can never read or change user A data', async () => {
  const s = await start();
  try {
    const a = await newUser(s.base, 'alice@example.com');
    const b = await newUser(s.base, 'bob@example.com');
    const t = (await tx(a)).data.transaction;
    const acct2 = (await a.post('/api/accounts', { name: 'Savings', type: 'savings' })).data.account;
    const newCat = (await a.post('/api/categories', { groupId: a.groupIds['Usual Expenses'], name: 'Gym' })).data.category;

    // B's own lists are empty of A's stuff
    assert.equal((await b.get('/api/transactions')).data.total, 0);
    assert.equal((await b.get('/api/accounts')).data.accounts.some((x) => x.name === 'Savings'), false);
    assert.equal((await b.get('/api/categories')).data.groups.flatMap((g) => g.categories).some((x) => x.name === 'Gym'), false);

    // Direct access by id is "not found", never "forbidden" (does not confirm the id exists)
    assert.equal((await b.patch(`/api/transactions/${t.id}`, { notes: 'hacked' })).status, 404);
    assert.equal((await b.del(`/api/transactions/${t.id}`)).status, 404);
    assert.equal((await b.patch(`/api/accounts/${acct2.id}`, { name: 'x' })).status, 404);
    assert.equal((await b.del(`/api/accounts/${acct2.id}`)).status, 404);
    assert.equal((await b.patch(`/api/categories/${newCat.id}`, { name: 'x' })).status, 404);
    assert.equal((await b.del(`/api/categories/${newCat.id}`)).status, 404);
    assert.equal((await b.post(`/api/categories/${newCat.id}/merge`, { targetId: b.cat.Food })).status, 404);
    assert.equal((await b.post(`/api/categories/${b.cat.Food}/merge`, { targetId: newCat.id })).status, 404);
    assert.equal((await b.post('/api/transactions/bulk', { ids: [t.id], action: 'delete' })).status, 404);

    // B cannot attach their own transaction to A's account or category
    assert.equal((await tx(b, { accountId: a.accountId })).status, 400);
    assert.equal((await tx(b, { categoryId: newCat.id })).status, 400);
    assert.equal((await b.post('/api/category-groups', { name: 'Mine' })).status, 201);
    assert.equal((await b.post('/api/categories', { groupId: a.groupIds['Usual Expenses'], name: 'Sneaky' })).status, 404);
    assert.equal((await b.post('/api/categories/reorder', { items: [{ id: newCat.id, groupId: b.groupIds['Usual Expenses'], sortOrder: 0 }] })).status, 404);
    assert.equal((await b.post('/api/import/spendwise-backup', { accountId: a.accountId, data: { transactions: [] } })).status, 400);

    // CSV/JSON export contains only B's rows
    const csv = await (await b.req('/api/export/transactions.csv')).text();
    assert.doesNotMatch(csv, /Pizza Hut/);
    const full = (await b.get('/api/export/full.json')).data;
    assert.equal(full.transactions.length, 0);

    // A's data is untouched
    const still = (await a.get('/api/transactions')).data.transactions;
    assert.equal(still.length, 1);
    assert.equal(still[0].notes, '');
  } finally { await s.close(); }
});

/* ---------- accounts ---------- */

test('accounts: balance, names, close and delete rules', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'acct@example.com');
    const sav = (await c.post('/api/accounts', { name: 'Savings', type: 'savings', openingBalanceMinor: 1000000 })).data.account;
    assert.equal(sav.balanceMinor, 1000000);
    assert.equal((await c.post('/api/accounts', { name: 'savings' })).status, 409); // case-insensitive duplicate
    assert.equal((await c.post('/api/accounts', { name: 'X', type: 'bogus' })).status, 400);
    assert.equal((await c.post('/api/accounts', { name: '' })).status, 400);

    await tx(c, { accountId: sav.id, amountMinor: -25000 });
    const after = (await c.get('/api/accounts')).data.accounts.find((a) => a.id === sav.id);
    assert.equal(after.balanceMinor, 975000);
    assert.equal(after.transactionCount, 1);

    assert.equal((await c.del(`/api/accounts/${sav.id}`)).status, 409); // has transactions
    assert.equal((await c.patch(`/api/accounts/${sav.id}`, { closed: true })).status, 200);
    assert.equal((await tx(c, { accountId: sav.id })).status, 400); // closed accounts take no new transactions

    // The last open account can't be closed or deleted
    assert.equal((await c.patch(`/api/accounts/${c.accountId}`, { closed: true })).status, 409);
    assert.equal((await c.del(`/api/accounts/${c.accountId}`)).status, 409);

    const empty = (await c.post('/api/accounts', { name: 'Temp' })).data.account;
    assert.equal((await c.del(`/api/accounts/${empty.id}`)).status, 200);
  } finally { await s.close(); }
});

/* ---------- editable categories ---------- */

test('rename a category and every transaction shows the new name', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'rename@example.com');
    await tx(c);
    assert.equal((await c.patch(`/api/categories/${c.cat.Food}`, { name: 'Groceries & Dining', icon: '🛒' })).status, 200);
    const t = (await c.get('/api/transactions')).data.transactions[0];
    assert.equal(t.categoryName, 'Groceries & Dining');
    assert.equal(t.categoryIcon, '🛒');
    // The in-place rename must keep the same category id (history is intact)
    assert.equal(t.categoryId, c.cat.Food);
  } finally { await s.close(); }
});

test('adding categories: validation and duplicates', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'add@example.com');
    const g = c.groupIds['Usual Expenses'];
    const ok = await c.post('/api/categories', { groupId: g, name: ' Utilities ', icon: '💡' });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.category.name, 'Utilities'); // trimmed
    assert.equal((await c.post('/api/categories', { groupId: g, name: 'utilities' })).status, 409);
    assert.equal((await c.post('/api/categories', { groupId: g, name: 'x'.repeat(41) })).status, 400);
    assert.equal((await c.post('/api/categories', { groupId: g, name: '  ' })).status, 400);
    assert.equal((await c.post('/api/categories', { groupId: g, name: 'Bad', icon: '<script>' })).status, 400);
    assert.equal((await c.post('/api/categories', { groupId: 999999, name: 'Nope' })).status, 404);
    // Same name in a different group is allowed
    const g2 = (await c.post('/api/category-groups', { name: 'Fun' })).data.groups.find((x) => x.name === 'Fun').id;
    assert.equal((await c.post('/api/categories', { groupId: g2, name: 'Utilities' })).status, 201);
  } finally { await s.close(); }
});

test('deleting a used category needs a destination; moveTo moves, none uncategorizes', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'del@example.com');
    await tx(c, { categoryId: c.cat.Shopping });
    await tx(c, { categoryId: c.cat.Shopping, date: '2026-11-06' });

    const blocked = await c.del(`/api/categories/${c.cat.Shopping}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /2 transaction/);
    assert.equal((await c.del(`/api/categories/${c.cat.Shopping}?moveTo=${c.cat.Shopping}`)).status, 400);

    assert.equal((await c.del(`/api/categories/${c.cat.Shopping}?moveTo=${c.cat.Other}`)).status, 200);
    const rows = (await c.get('/api/transactions')).data.transactions;
    assert.ok(rows.every((t) => t.categoryName === 'Other'));
    assert.equal((await c.get('/api/categories')).data.groups.flatMap((g) => g.categories).some((x) => x.name === 'Shopping'), false);

    // Unused category deletes straight away; moveTo=none leaves transactions uncategorized
    const tmp = (await c.post('/api/categories', { groupId: c.groupIds['Usual Expenses'], name: 'Temp' })).data.category;
    assert.equal((await c.del(`/api/categories/${tmp.id}`)).status, 200);
    await tx(c, { categoryId: c.cat.Travel });
    assert.equal((await c.del(`/api/categories/${c.cat.Travel}?moveTo=none`)).status, 200);
    const unc = (await c.get('/api/transactions?category=none')).data.transactions;
    assert.equal(unc.length, 1);
    assert.equal(unc[0].categoryId, null);
  } finally { await s.close(); }
});

test('merge moves transactions and removes the source', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'merge@example.com');
    await tx(c, { categoryId: c.cat.Food });
    await tx(c, { categoryId: c.cat.Other, date: '2026-11-06' });
    assert.equal((await c.post(`/api/categories/${c.cat.Food}/merge`, { targetId: c.cat.Food })).status, 400);
    const r = await c.post(`/api/categories/${c.cat.Food}/merge`, { targetId: c.cat.Other });
    assert.equal(r.status, 200);
    const other = r.data.groups.flatMap((g) => g.categories).find((x) => x.name === 'Other');
    assert.equal(other.transactionCount, 2);
    assert.equal(r.data.groups.flatMap((g) => g.categories).some((x) => x.name === 'Food'), false);
  } finally { await s.close(); }
});

test('reorder across groups; a name clash in the destination is refused and rolled back', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'order@example.com');
    const income = c.groupIds.Income;
    const expenses = c.groupIds['Usual Expenses'];
    const ok = await c.post('/api/categories/reorder', { items: [
      { id: c.cat.Bills, groupId: income, sortOrder: 5 },
      { id: c.cat.Food, groupId: expenses, sortOrder: 9 },
    ] });
    assert.equal(ok.status, 200);
    const groups = ok.data.groups;
    assert.ok(groups.find((g) => g.id === income).categories.some((x) => x.name === 'Bills'));

    // Make a clash: a second "Food" in Income, then try to drop the expense Food there.
    await c.post('/api/categories', { groupId: income, name: 'Food' });
    const clash = await c.post('/api/categories/reorder', { items: [
      { id: c.cat.Other, groupId: income, sortOrder: 0 },
      { id: c.cat.Food, groupId: income, sortOrder: 1 },
    ] });
    assert.equal(clash.status, 409);
    // The first move in the same request must have been undone
    const after = (await c.get('/api/categories')).data.groups;
    assert.ok(after.find((g) => g.id === expenses).categories.some((x) => x.name === 'Other'));
    assert.equal((await c.post('/api/categories/reorder', { items: [] })).status, 400);
  } finally { await s.close(); }
});

test('groups: rename, hide, delete only when empty', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'groups@example.com');
    assert.equal((await c.patch(`/api/category-groups/${c.groupIds['Usual Expenses']}`, { name: 'Everyday', hidden: true })).status, 200);
    const g = (await c.get('/api/categories')).data.groups.find((x) => x.name === 'Everyday');
    assert.equal(g.hidden, true);
    assert.equal((await c.del(`/api/category-groups/${g.id}`)).status, 409);
    const empty = (await c.post('/api/category-groups', { name: 'Empty' })).data.groups.find((x) => x.name === 'Empty');
    assert.equal((await c.del(`/api/category-groups/${empty.id}`)).status, 200);
    assert.equal((await c.post('/api/category-groups', { name: 'everyday' })).status, 409);
  } finally { await s.close(); }
});

/* ---------- transactions ---------- */

test('transaction validation', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'valid@example.com');
    const bad = async (over) => (await tx(c, over)).status;
    assert.equal(await bad({ amountMinor: 0 }), 400);
    assert.equal(await bad({ amountMinor: 12.5 }), 400);        // fractional paise
    assert.equal(await bad({ amountMinor: '500' }), 400);        // string
    assert.equal(await bad({ amountMinor: 1e15 }), 400);         // absurdly large
    assert.equal(await bad({ amountMinor: Number.MAX_SAFE_INTEGER }), 400);
    assert.equal(await bad({ date: '2026-02-30' }), 400);        // not a real day
    assert.equal(await bad({ date: '11/05/2026' }), 400);
    assert.equal(await bad({ date: '' }), 400);
    assert.equal(await bad({ payee: 'x'.repeat(61) }), 400);
    assert.equal(await bad({ notes: 'x'.repeat(201) }), 400);
    assert.equal(await bad({ accountId: 'abc' }), 400);
    assert.equal(await bad({ categoryId: 424242 }), 400);
    assert.equal(await bad({}), 201);
    assert.equal((await c.patch('/api/transactions/abc', { notes: 'x' })).status, 404);
    assert.equal((await c.patch('/api/transactions/99999', { notes: 'x' })).status, 404);
  } finally { await s.close(); }
});

test('transaction CRUD; payee names are reused case-insensitively; XSS text is stored as plain text', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'crud@example.com');
    const a = (await tx(c, { payee: 'Swiggy' })).data.transaction;
    const b = (await tx(c, { payee: 'SWIGGY', date: '2026-11-06' })).data.transaction;
    assert.equal(a.payeeId, b.payeeId);

    const x = (await tx(c, { payee: '<img src=x onerror=alert(1)>', notes: '"><script>' })).data.transaction;
    assert.equal(x.payee, '<img src=x onerror=alert(1)>'); // stored verbatim; the UI escapes on display

    const upd = await c.patch(`/api/transactions/${a.id}`, { amountMinor: -99900, categoryId: null, notes: 'edited', cleared: true, date: '2026-10-31' });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.transaction.amountMinor, -99900);
    assert.equal(upd.data.transaction.categoryId, null);
    assert.equal(upd.data.transaction.cleared, true);
    assert.equal(upd.data.transaction.date, '2026-10-31');
    assert.equal(upd.data.transaction.payee, 'Swiggy'); // unchanged when not sent

    assert.equal((await c.del(`/api/transactions/${a.id}`)).status, 200);
    assert.equal((await c.del(`/api/transactions/${a.id}`)).status, 404);
  } finally { await s.close(); }
});

test('list: filters, search (wildcards are literal), summary and newest-first order', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'list@example.com');
    await tx(c, { date: '2026-11-01', amountMinor: 5000000, payee: 'Employer', categoryId: c.cat.Salary });
    await tx(c, { date: '2026-11-03', amountMinor: -45000, payee: 'Pizza Hut', categoryId: c.cat.Food });
    await tx(c, { date: '2026-11-05', amountMinor: -280000, payee: 'Groceries 100%', categoryId: c.cat.Food });
    await tx(c, { date: '2026-10-20', amountMinor: -110000, payee: 'Power Co', categoryId: c.cat.Bills, notes: 'electricity' });

    const all = (await c.get('/api/transactions')).data;
    assert.equal(all.total, 4);
    assert.deepEqual(all.transactions.map((t) => t.date), ['2026-11-05', '2026-11-03', '2026-11-01', '2026-10-20']);

    const nov = (await c.get('/api/transactions?month=2026-11')).data;
    assert.equal(nov.total, 3);
    assert.equal(nov.summary.incomeMinor, 5000000);
    assert.equal(nov.summary.expenseMinor, 325000);
    assert.equal(nov.summary.netMinor, 4675000);

    // The type filter narrows the list but not the summary
    const exp = (await c.get('/api/transactions?month=2026-11&type=expense')).data;
    assert.equal(exp.total, 2);
    assert.equal(exp.summary.incomeMinor, 5000000);

    assert.equal((await c.get(`/api/transactions?category=${c.cat.Bills}`)).data.total, 1);
    assert.equal((await c.get('/api/transactions?q=electric')).data.total, 1);          // searches notes
    assert.equal((await c.get('/api/transactions?q=pizza')).data.total, 1);             // case-insensitive payee
    assert.equal((await c.get('/api/transactions?q=Salary')).data.total, 1);            // category name
    assert.equal((await c.get('/api/transactions?q=%25')).data.total, 1);               // "%" is literal, only "100%" matches
    assert.equal((await c.get('/api/transactions?q=_')).data.total, 0);                 // "_" is literal
    assert.equal((await c.get('/api/transactions?from=2026-11-02&to=2026-11-04')).data.total, 1);
    assert.equal((await c.get('/api/transactions?min=200000')).data.total, 2);          // >= 2000.00 either sign
    assert.equal((await c.get('/api/transactions?limit=2&offset=1')).data.transactions.length, 2);

    assert.equal((await c.get('/api/transactions?month=nov')).status, 400);
    assert.equal((await c.get('/api/transactions?type=sideways')).status, 400);
    assert.equal((await c.get('/api/transactions?account=abc')).status, 400);
    assert.equal((await c.get('/api/transactions?limit=-5')).status, 400);
    assert.deepEqual((await c.get('/api/transactions/months')).data.months, ['2026-11', '2026-10']);
  } finally { await s.close(); }
});

test('bulk update and delete', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'bulk@example.com');
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await tx(c, { date: `2026-11-0${i + 1}` })).data.transaction.id);

    const up = await c.post('/api/transactions/bulk', { ids, action: 'update', changes: { categoryId: c.cat.Travel, cleared: true } });
    assert.equal(up.data.affected, 3);
    const rows = (await c.get('/api/transactions')).data.transactions;
    assert.ok(rows.every((t) => t.categoryName === 'Travel' && t.cleared));

    assert.equal((await c.post('/api/transactions/bulk', { ids, action: 'update', changes: {} })).status, 400);
    assert.equal((await c.post('/api/transactions/bulk', { ids: [], action: 'delete' })).status, 400);
    assert.equal((await c.post('/api/transactions/bulk', { ids: [...ids, 99999], action: 'delete' })).status, 404);
    assert.equal((await c.get('/api/transactions')).data.total, 3); // failed call deleted nothing

    assert.equal((await c.post('/api/transactions/bulk', { ids: ids.slice(0, 2), action: 'delete' })).data.affected, 2);
    assert.equal((await c.get('/api/transactions')).data.total, 1);
  } finally { await s.close(); }
});

/* ---------- import (your old localStorage backup) ---------- */

const OLD_BACKUP = {
  app: 'SpendWise', version: 1, exportedAt: '2026-11-07T10:00:00.000Z',
  transactions: [
    { id: 1, title: 'Monthly Salary', amount: 50000, type: 'income', cat: 'Salary', date: '2026-11-01' },
    { id: 2, title: 'Pizza Night', amount: 450.5, type: 'expense', cat: 'Food', date: '2026-11-03' },
    { id: 3, title: 'Chai', amount: 20, type: 'expense', cat: 'Food', date: '2026-11-04' },
    { id: 4, title: 'Chai', amount: 20, type: 'expense', cat: 'Food', date: '2026-11-04' }, // a real second chai
    { id: 5, title: 'Gym Pass', amount: 1500, type: 'expense', cat: 'Fitness', date: '2026-11-05' }, // category you don't have
    { id: 6, title: '', amount: 10, type: 'expense', cat: 'Food', date: '2026-11-05' },              // invalid
    { id: 7, title: 'Neg', amount: -5, type: 'expense', cat: 'Food', date: '2026-11-05' },           // invalid
    { id: 8, title: 'Bad type', amount: 5, type: 'transfer', cat: 'Food', date: '2026-11-05' },     // invalid
    { id: 9, title: 'Bad date', amount: 5, type: 'expense', cat: 'Food', date: '2026-13-45' },      // invalid
    'garbage', null,
  ],
};

test('import: old backup converts rupees to paise, keeps real duplicates, flags invalid records', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'import@example.com');
    const r = await c.post('/api/import/spendwise-backup', { data: OLD_BACKUP });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { added: 5, duplicates: 0, invalid: 6, truncated: 0 });

    const list = (await c.get('/api/transactions')).data.transactions;
    const pizza = list.find((t) => t.payee === 'Pizza Night');
    assert.equal(pizza.amountMinor, -45050);                 // 450.50 rupees, expense is negative
    assert.equal(list.find((t) => t.payee === 'Monthly Salary').amountMinor, 5000000);
    assert.equal(list.filter((t) => t.payee === 'Chai').length, 2); // both chais kept
    assert.equal(list.find((t) => t.payee === 'Pizza Night').categoryName, 'Food'); // mapped to your existing Food

    // An unknown category is created (in an "Imported" group) rather than dropped
    const gym = list.find((t) => t.payee === 'Gym Pass');
    assert.equal(gym.categoryName, 'Fitness');
    const groups = (await c.get('/api/categories')).data.groups;
    assert.ok(groups.find((g) => g.name === 'Imported').categories.some((x) => x.name === 'Fitness'));
  } finally { await s.close(); }
});

test('import: importing the same file again adds nothing', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'again@example.com');
    await c.post('/api/import/spendwise-backup', { data: OLD_BACKUP });
    const second = await c.post('/api/import/spendwise-backup', { data: OLD_BACKUP });
    assert.deepEqual(second.data, { added: 0, duplicates: 5, invalid: 6, truncated: 0 });
    assert.equal((await c.get('/api/transactions')).data.total, 5);
  } finally { await s.close(); }
});

test('import: accepts a bare array, rejects non-backups, caps size and count', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'edge@example.com');
    const arr = await c.post('/api/import/spendwise-backup', { data: [OLD_BACKUP.transactions[0]] });
    assert.equal(arr.data.added, 1);
    assert.equal((await c.post('/api/import/spendwise-backup', { data: { nope: true } })).status, 400);
    assert.equal((await c.post('/api/import/spendwise-backup', { data: 'hello' })).status, 400);
    assert.equal((await c.post('/api/import/spendwise-backup', {})).status, 400);

    const many = Array.from({ length: 5003 }, (_, i) => ({ title: `T${i}`, amount: 1, type: 'expense', cat: 'Food', date: '2026-11-01' }));
    const big = await c.post('/api/import/spendwise-backup', { data: many });
    assert.equal(big.data.added, 5000);
    assert.equal(big.data.truncated, 3);

    const huge = await c.post('/api/import/spendwise-backup', { data: { transactions: [], pad: 'x'.repeat(3.2 * 1024 * 1024) } });
    assert.equal(huge.status, 413);
    // Ordinary endpoints keep the small body limit
    const small = await c.post('/api/transactions', { accountId: c.accountId, date: '2026-11-01', amountMinor: -1, notes: 'x'.repeat(150 * 1024) });
    assert.equal(small.status, 413);
  } finally { await s.close(); }
});

test('import: absurd amounts are rejected as invalid, not stored', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'amount@example.com');
    const r = await c.post('/api/import/spendwise-backup', { data: { transactions: [
      { title: 'Huge', amount: 1e15, type: 'expense', cat: 'Food', date: '2026-11-01' },
      { title: 'Inf', amount: 'Infinity', type: 'expense', cat: 'Food', date: '2026-11-01' },
      { title: 'Tiny', amount: 0.001, type: 'expense', cat: 'Food', date: '2026-11-01' }, // rounds to 0 paise
      { title: 'Fine', amount: 0.5, type: 'expense', cat: 'Food', date: '2026-11-01' },
    ] } });
    assert.equal(r.data.added, 1);
    assert.equal(r.data.invalid, 3);
  } finally { await s.close(); }
});

/* ---------- export ---------- */

test('CSV export neutralises spreadsheet formulas and quotes special characters', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv@example.com');
    await tx(c, { payee: '=HYPERLINK("http://evil","click")', notes: '+1+1', amountMinor: -10000 });
    await tx(c, { payee: '@SUM(A1)', notes: 'has, comma and "quote"', amountMinor: -20000, date: '2026-11-06' });
    await tx(c, { payee: '-2+3', amountMinor: 123456, date: '2026-11-07', categoryId: c.cat.Salary });

    const res = await c.req('/api/export/transactions.csv');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const text = await res.text();
    const lines = text.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lines[0], 'Date,Account,Payee,Category,Notes,Type,Amount,Cleared');
    assert.ok(lines.some((l) => l.includes(`"'=HYPERLINK(""http://evil"",""click"")"`)), text);
    assert.ok(lines.some((l) => l.includes(",'+1+1,")), text);
    assert.ok(lines.some((l) => l.includes(",'@SUM(A1),")), text);
    assert.ok(lines.some((l) => l.includes(",'-2+3,")), text);
    assert.ok(text.includes('"has, comma and ""quote"""'));
    assert.ok(lines.some((l) => l.endsWith(',income,1234.56,no')));
    // No cell may start with a formula character (every line begins with the date)
    for (const l of lines.slice(1)) assert.doesNotMatch(l, /(^|,)[=+\-@]/);
  } finally { await s.close(); }
});

test('CSV export honours the current filters', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csvf@example.com');
    await tx(c, { payee: 'InNovember', date: '2026-11-03' });
    await tx(c, { payee: 'InOctober', date: '2026-10-03' });
    const text = await (await c.req('/api/export/transactions.csv?month=2026-11')).text();
    assert.match(text, /InNovember/);
    assert.doesNotMatch(text, /InOctober/);
  } finally { await s.close(); }
});

test('full backup (v2) round-trips into a different account, including extra accounts', async () => {
  const s = await start();
  try {
    const a = await newUser(s.base, 'src@example.com');
    const sav = (await a.post('/api/accounts', { name: 'Savings', type: 'savings' })).data.account;
    await tx(a, { payee: 'Shop', amountMinor: -12345, notes: 'n1' });
    await tx(a, { payee: 'Employer', amountMinor: 900000, accountId: sav.id, categoryId: a.cat.Salary, cleared: true });
    const backup = (await a.get('/api/export/full.json')).data;
    assert.equal(backup.version, 2);
    assert.equal(backup.transactions.length, 2);

    const b = await newUser(s.base, 'dst@example.com');
    const r = await b.post('/api/import/spendwise-backup', { data: backup });
    assert.deepEqual(r.data, { added: 2, duplicates: 0, invalid: 0, truncated: 0 });
    const rows = (await b.get('/api/transactions')).data.transactions;
    const emp = rows.find((t) => t.payee === 'Employer');
    assert.equal(emp.accountName, 'Savings');   // account re-created by name
    assert.equal(emp.amountMinor, 900000);
    assert.equal(emp.cleared, true);
    assert.equal(rows.find((t) => t.payee === 'Shop').notes, 'n1');

    // Restoring twice is still a no-op
    const again = await b.post('/api/import/spendwise-backup', { data: backup });
    assert.equal(again.data.added, 0);
  } finally { await s.close(); }
});
