'use strict';
// Phase 4: payees. Amounts are paise.
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client, newUser, tx } = require('./helpers');

const list = async (c, qs = '') => (await c.get('/api/payees' + qs)).data;
const names = async (c, qs = '') => (await list(c, qs)).payees.map((p) => p.name);
const byName = async (c, name, qs = '?status=all') => (await list(c, qs)).payees.find((p) => p.name === name);
const mk = async (c, name, extra = {}) => (await c.post('/api/payees', { name, ...extra })).data.payee;

/* --------------------------------- CRUD --------------------------------- */

test('create, read, rename, set and clear the default category', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'p1@example.com');
    const r = await c.post('/api/payees', { name: '  Swiggy  ', defaultCategoryId: c.cat.Food });
    assert.equal(r.status, 201);
    const p = r.data.payee;
    assert.deepEqual(
      { name: p.name, archived: p.archived, cat: p.defaultCategoryName, uses: p.usageCount, last: p.lastUsed, rules: p.ruleCount },
      { name: 'Swiggy', archived: false, cat: 'Food', uses: 0, last: null, rules: 0 });
    assert.equal((await c.get(`/api/payees/${p.id}`)).data.payee.name, 'Swiggy');

    let u = await c.patch(`/api/payees/${p.id}`, { name: 'SWIGGY' });                 // capitals only: same payee, allowed
    assert.equal(u.status, 200);
    assert.equal(u.data.payee.name, 'SWIGGY');
    u = await c.patch(`/api/payees/${p.id}`, { name: 'Swiggy Instamart', defaultCategoryId: c.cat.Shopping });
    assert.equal(u.data.payee.defaultCategoryName, 'Shopping');
    u = await c.patch(`/api/payees/${p.id}`, { defaultCategoryId: null });
    assert.equal(u.data.payee.defaultCategoryId, null);
    assert.equal(u.data.payee.name, 'Swiggy Instamart', 'a patch without a name keeps the name');
    assert.equal((await c.patch(`/api/payees/${p.id}`, {})).status, 200, 'an empty patch is harmless');
  } finally { await s.close(); }
});

test('validation: names, duplicates (any capitals), unknown or foreign category', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'p2@example.com');
    const other = await newUser(s.base, 'p2b@example.com');
    const a = await mk(c, 'Amazon');
    await mk(c, 'Flipkart');
    for (const name of ['', '   ', 'x'.repeat(61), 5, null, undefined, ['a']]) {
      assert.equal((await c.post('/api/payees', { name })).status, 400, JSON.stringify(name));
    }
    assert.equal((await c.post('/api/payees', { name: 'amazon' })).status, 409);
    assert.equal((await c.post('/api/payees', { name: 'AMAZON ' })).status, 409);
    assert.equal((await c.patch(`/api/payees/${a.id}`, { name: 'FLIPKART' })).status, 409);
    assert.equal((await c.patch(`/api/payees/${a.id}`, { name: '' })).status, 400);
    assert.equal((await c.post('/api/payees', { name: 'N1', defaultCategoryId: 999999 })).status, 400);
    assert.equal((await c.post('/api/payees', { name: 'N2', defaultCategoryId: other.cat.Food })).status, 400, 'someone else\'s category');
    assert.equal((await c.patch(`/api/payees/${a.id}`, { archived: 'yes' })).status, 400);
    assert.equal((await c.get('/api/payees?status=bogus')).status, 400);
    assert.equal((await c.get('/api/payees?sort=bogus')).status, 400);
    assert.equal((await c.get('/api/payees/abc')).status, 404);
    assert.equal((await c.get('/api/payees/999999')).status, 404);
    assert.deepEqual((await names(c)).sort(), ['Amazon', 'Flipkart']);
  } finally { await s.close(); }
});

/* ---------------------- usage count, last used, search ---------------------- */

test('usage count and last-used date follow the transactions; search, filters and sorting work', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'p3@example.com');
    await tx(c, { payee: 'Swiggy', date: '2026-10-03' });
    await tx(c, { payee: 'swiggy', date: '2026-11-09' });          // same payee, other capitals
    await tx(c, { payee: 'Swiggy', date: '2026-10-20' });
    const uber = (await tx(c, { payee: 'Uber', date: '2026-11-12' })).data.transaction;
    await tx(c, { payee: '', date: '2026-11-13' });               // no payee at all
    await mk(c, 'Unused Inc');

    let sw = await byName(c, 'Swiggy');
    assert.deepEqual([sw.usageCount, sw.lastUsed], [3, '2026-11-09']);
    assert.deepEqual([(await byName(c, 'Uber')).usageCount, (await byName(c, 'Uber')).lastUsed], [1, '2026-11-12']);
    const un = await byName(c, 'Unused Inc');
    assert.deepEqual([un.usageCount, un.lastUsed], [0, null]);
    assert.equal((await list(c, '?status=all')).total, 3, 'blank payees are not payees');

    // changing and deleting transactions moves the numbers
    await c.patch(`/api/transactions/${uber.id}`, { payee: 'Swiggy' });
    sw = await byName(c, 'Swiggy');
    assert.deepEqual([sw.usageCount, sw.lastUsed], [4, '2026-11-12']);
    assert.equal((await byName(c, 'Uber')).usageCount, 0);
    await c.del(`/api/transactions/${uber.id}`);
    assert.deepEqual([(await byName(c, 'Swiggy')).usageCount, (await byName(c, 'Swiggy')).lastUsed], [3, '2026-11-09']);

    // search: substring, case-insensitive, and % _ are plain characters
    await mk(c, '100% Pure'); await mk(c, 'Cafe_Nero');
    assert.deepEqual(await names(c, '?q=WIG'), ['Swiggy']);
    assert.deepEqual(await names(c, '?q=%25'), ['100% Pure']);
    assert.deepEqual(await names(c, '?q=_'), ['Cafe_Nero']);
    assert.deepEqual(await names(c, '?q=zzz'), []);

    // sorting
    assert.deepEqual((await names(c, '?sort=name')).slice(0, 2), ['100% Pure', 'Cafe_Nero']);
    assert.equal((await names(c, '?sort=usage'))[0], 'Swiggy');
    const last = await names(c, '?sort=last');
    assert.equal(last[0], 'Swiggy');
    assert.ok(last.indexOf('Unused Inc') > last.indexOf('Swiggy'), 'never-used payees sort last');

    // paging reports the full total
    const page = await list(c, '?limit=2&offset=1&sort=name');
    assert.equal(page.payees.length, 2);
    assert.equal(page.total, 5, 'Swiggy, Uber (0 uses now), Unused Inc, 100% Pure, Cafe_Nero');
  } finally { await s.close(); }
});

/* ------------------------- transaction integration ------------------------- */

test('transactions: assign, add and change a payee on existing transactions, clear it, filter by it', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'p4@example.com');
    const t1 = (await tx(c, { payee: '', date: '2026-11-01', amountMinor: -10000 })).data.transaction;
    assert.equal(t1.payeeId, null);
    const t2 = (await tx(c, { payee: 'Zomato', date: '2026-11-02', amountMinor: -20000 })).data.transaction;
    await tx(c, { payee: 'Zomato', date: '2026-10-05', amountMinor: -30000 });
    await tx(c, { payee: 'Uber', date: '2026-11-03', amountMinor: -40000 });

    // add a payee to a transaction that had none (a new payee is created on the fly)
    let r = await c.patch(`/api/transactions/${t1.id}`, { payee: 'Metro' });
    assert.equal(r.data.transaction.payee, 'Metro');
    assert.ok(r.data.transaction.payeeId);
    // change it to an existing one, in other capitals: reuses the same payee
    r = await c.patch(`/api/transactions/${t1.id}`, { payee: 'uber' });
    assert.equal(r.data.transaction.payee, 'Uber');
    assert.equal((await list(c, '?status=all')).total, 3, 'no duplicate payee was created');
    // clear it again
    r = await c.patch(`/api/transactions/${t1.id}`, { payee: '' });
    assert.equal(r.data.transaction.payeeId, null);

    // filter by payee (and the summary cards follow the filter)
    const zomato = (await byName(c, 'Zomato')).id;
    const f = (await c.get(`/api/transactions?payee=${zomato}&month=all`)).data;
    assert.deepEqual(f.transactions.map((t) => t.payee), ['Zomato', 'Zomato']);
    assert.equal(f.total, 2);
    assert.equal(f.summary.expenseMinor, 50000);
    assert.equal((await c.get(`/api/transactions?payee=${zomato}&month=2026-11`)).data.total, 1);
    assert.equal((await c.get('/api/transactions?payee=abc')).status, 400);
    assert.equal((await c.get('/api/transactions?payee=999999')).data.total, 0);
    assert.equal(t2.payee, 'Zomato');
  } finally { await s.close(); }
});

/* ---------------------------------- archive ---------------------------------- */

test('archive hides a payee from the default list but keeps its history; using it again brings it back', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'p5@example.com');
    const t = (await tx(c, { payee: 'Old Gym', date: '2026-09-01' })).data.transaction;
    await tx(c, { payee: 'Current Gym', date: '2026-11-01' });
    const gym = await byName(c, 'Old Gym');

    const r = await c.patch(`/api/payees/${gym.id}`, { archived: true });
    assert.equal(r.data.payee.archived, true);
    assert.deepEqual(await names(c), ['Current Gym']);
    assert.deepEqual(await names(c, '?status=archived'), ['Old Gym']);
    assert.deepEqual((await names(c, '?status=all')).sort(), ['Current Gym', 'Old Gym']);
    // history is untouched
    assert.equal((await byName(c, 'Old Gym')).usageCount, 1);
    assert.equal((await c.get('/api/transactions?month=all')).data.transactions.find((x) => x.id === t.id).payee, 'Old Gym');

    // creating the same name by hand is refused with a hint about the archive
    const dup = await c.post('/api/payees', { name: 'old gym' });
    assert.equal(dup.status, 409);
    assert.match(dup.data.error, /archived/i);

    // a new transaction with that name un-archives it instead of creating a second payee
    await tx(c, { payee: 'OLD GYM', date: '2026-11-05' });
    assert.equal((await byName(c, 'Old Gym')).archived, false);
    assert.equal((await list(c, '?status=all')).total, 2);
    // and unarchive works directly
    await c.patch(`/api/payees/${gym.id}`, { archived: true });
    assert.equal((await c.patch(`/api/payees/${gym.id}`, { archived: false })).data.payee.archived, false);
  } finally { await s.close(); }
});

/* ---------------------------------- merge ---------------------------------- */

test('merge moves transactions and rules to the target, removes the source, and merges settings sensibly', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'p6@example.com');
    await tx(c, { payee: 'SWIGGY ORDER', date: '2026-10-01' });
    await tx(c, { payee: 'SWIGGY ORDER', date: '2026-11-04' });
    await tx(c, { payee: 'Swiggy', date: '2026-10-15' });
    const from = await byName(c, 'SWIGGY ORDER');
    const to = await byName(c, 'Swiggy');
    await c.patch(`/api/payees/${from.id}`, { defaultCategoryId: c.cat.Food });
    const rule = (await c.post('/api/rules', {
      name: 'tag', conditions: [{ type: 'payee_equals', payeeId: from.id }], actions: [{ type: 'set_payee', payeeId: from.id }, { type: 'mark_cleared' }],
    })).data.rule;

    const r = await c.post(`/api/payees/${from.id}/merge`, { targetId: to.id });
    assert.equal(r.status, 200);
    assert.equal(r.data.moved, 2);
    assert.deepEqual([r.data.payee.name, r.data.payee.usageCount, r.data.payee.lastUsed], ['Swiggy', 3, '2026-11-04']);
    assert.equal(r.data.payee.defaultCategoryName, 'Food', 'inherits the default category when it had none');
    assert.equal((await c.get(`/api/payees/${from.id}`)).status, 404, 'the source is gone');
    assert.equal((await c.get('/api/transactions?month=all')).data.transactions.every((t) => t.payee === 'Swiggy'), true);

    const after = (await c.get(`/api/rules/${rule.id}`)).data.rule;
    assert.equal(after.conditions[0].payeeId, to.id);
    assert.equal(after.actions[0].payeeId, to.id);
    assert.equal(r.data.payee.ruleCount, 1);

    // the target's own default category wins; archived only if both were archived
    const a = await mk(c, 'A', { defaultCategoryId: c.cat.Bills }), b = await mk(c, 'B', { defaultCategoryId: c.cat.Travel });
    await c.patch(`/api/payees/${a.id}`, { archived: true });
    const m = await c.post(`/api/payees/${a.id}/merge`, { targetId: b.id });
    assert.deepEqual([m.data.payee.defaultCategoryName, m.data.payee.archived], ['Travel', false]);
    const x = await mk(c, 'X'), y = await mk(c, 'Y');
    await c.patch(`/api/payees/${x.id}`, { archived: true }); await c.patch(`/api/payees/${y.id}`, { archived: true });
    assert.equal((await c.post(`/api/payees/${x.id}/merge`, { targetId: y.id })).data.payee.archived, true);

    // bad merges
    assert.equal((await c.post(`/api/payees/${to.id}/merge`, { targetId: to.id })).status, 400);
    assert.equal((await c.post(`/api/payees/${to.id}/merge`, { targetId: 999999 })).status, 404);
    assert.equal((await c.post(`/api/payees/${to.id}/merge`, {})).status, 400);
  } finally { await s.close(); }
});

/* ---------------------------------- delete ---------------------------------- */

test('delete: only a payee nothing uses; a used or rule-referenced one is refused with a way out', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'p7@example.com');
    const t = (await tx(c, { payee: 'Busy', date: '2026-11-01' })).data.transaction;
    const busy = await byName(c, 'Busy');
    const idle = await mk(c, 'Idle');
    const ruled = await mk(c, 'Ruled');

    let r = await c.del(`/api/payees/${busy.id}`);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /used by 1 transaction/);
    assert.match(r.data.error, /merge|archive/i);

    const rule = (await c.post('/api/rules', { name: 'uses Ruled', conditions: [{ type: 'payee_equals', payeeId: ruled.id }], actions: [{ type: 'mark_cleared' }] })).data.rule;
    r = await c.del(`/api/payees/${ruled.id}`);
    assert.equal(r.status, 409);
    assert.match(r.data.error, /uses Ruled/);
    await c.del(`/api/rules/${rule.id}`);
    assert.equal((await c.del(`/api/payees/${ruled.id}`)).status, 200);

    assert.equal((await c.del(`/api/payees/${idle.id}`)).status, 200);
    assert.equal((await c.get(`/api/payees/${idle.id}`)).status, 404);
    assert.equal((await c.del(`/api/payees/${idle.id}`)).status, 404);

    // once its last transaction is gone, the busy payee can go too
    await c.del(`/api/transactions/${t.id}`);
    assert.equal((await c.del(`/api/payees/${busy.id}`)).status, 200);
    assert.deepEqual(await names(c, '?status=all'), []);
  } finally { await s.close(); }
});

/* ------------------------------ multi-user isolation ------------------------------ */

test('users never see or touch each other\'s payees', async () => {
  const s = await start();
  try {
    const a = await newUser(s.base, 'pa@example.com');
    const b = await newUser(s.base, 'pb@example.com');
    await tx(a, { payee: 'Secret Clinic', date: '2026-11-01' });
    const pa = await byName(a, 'Secret Clinic');
    const mine = await mk(b, 'My Own');

    assert.deepEqual(await names(b, '?status=all'), ['My Own'], 'B\'s list has none of A\'s payees');
    assert.deepEqual(await names(b, '?q=clinic&status=all'), []);
    assert.equal((await b.get(`/api/payees/${pa.id}`)).status, 404);
    assert.equal((await b.patch(`/api/payees/${pa.id}`, { name: 'Hacked' })).status, 404);
    assert.equal((await b.patch(`/api/payees/${pa.id}`, { archived: true })).status, 404);
    assert.equal((await b.del(`/api/payees/${pa.id}`)).status, 404);
    assert.equal((await b.post(`/api/payees/${pa.id}/merge`, { targetId: mine.id })).status, 404, 'cannot merge A\'s payee away');
    assert.equal((await b.post(`/api/payees/${mine.id}/merge`, { targetId: pa.id })).status, 404, 'cannot merge into A\'s payee');
    // B filtering transactions by A's payee id sees nothing
    assert.equal((await b.get(`/api/transactions?payee=${pa.id}&month=all`)).data.total, 0);

    // the same name is a different payee for each user, with separate usage
    await tx(b, { payee: 'Secret Clinic', date: '2026-11-02' });
    const pb = await byName(b, 'Secret Clinic');
    assert.notEqual(pb.id, pa.id);
    assert.equal((await byName(a, 'Secret Clinic')).usageCount, 1);
    assert.equal(pb.usageCount, 1);

    // nothing of A's changed
    const still = await byName(a, 'Secret Clinic');
    assert.deepEqual([still.name, still.archived, still.usageCount], ['Secret Clinic', false, 1]);
    assert.equal((await list(a, '?status=all')).total, 1);
  } finally { await s.close(); }
});

test('payee endpoints need a login and a CSRF token on writes', async () => {
  const s = await start();
  try {
    const anon = new Client(s.base);
    assert.equal((await anon.get('/api/payees')).status, 401);
    assert.equal((await anon.post('/api/payees', { name: 'x' })).status, 401);
    const c = await newUser(s.base, 'p8@example.com');
    const noToken = await c.req('/api/payees', { method: 'POST', csrf: false, body: { name: 'Nope' } });
    assert.equal(noToken.status, 403);
    assert.deepEqual(await names(c, '?status=all'), []);
  } finally { await s.close(); }
});
