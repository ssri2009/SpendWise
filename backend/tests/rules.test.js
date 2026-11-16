'use strict';
// Phase 4: rules engine. Amounts are paise; R(n) = n rupees.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start, Client, newUser, tx } = require('./helpers');
const { MIGRATIONS, openDb } = require('../server/db');

const R = (n) => n * 100;
const has = (value) => ({ type: 'description_contains', value });
const payeeIs = (payeeId) => ({ type: 'payee_equals', payeeId });
const gt = (rupees, direction) => ({ type: 'amount_gt', valueMinor: R(rupees), ...(direction ? { direction } : {}) });
const lt = (rupees, direction) => ({ type: 'amount_lt', valueMinor: R(rupees), ...(direction ? { direction } : {}) });
const inAccount = (accountId) => ({ type: 'account_equals', accountId });
const setCat = (categoryId) => ({ type: 'set_category', categoryId });
const setPayee = (payeeId) => ({ type: 'set_payee', payeeId });
const note = (text) => ({ type: 'add_note', text });
const cleared = { type: 'mark_cleared' };

const rule = async (c, conditions, actions, extra = {}) => {
  const r = await c.post('/api/rules', { name: `rule ${Math.random().toString(36).slice(2, 7)}`, conditions, actions, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.rule;
};
// a transaction with NO category and no notes, so what a rule does is easy to see
const add = async (c, over = {}) => {
  const r = await tx(c, { payee: 'Misc', categoryId: null, amountMinor: -R(100), date: '2026-11-05', ...over });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};
const payee = async (c, name) => (await c.post('/api/payees', { name })).data.payee;
const allTx = async (c, qs = '?month=all') => (await c.get('/api/transactions' + qs)).data.transactions;
const payeeNames = async (c) => (await c.get('/api/payees?status=all')).data.payees.map((p) => p.name).sort();

/* --------------------------------- CRUD --------------------------------- */

test('create a rule with every condition and action type; read, list, update, enable/disable, delete', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r1@example.com');
    const sw = await payee(c, 'Swiggy');
    const acct2 = (await c.post('/api/accounts', { name: 'Bank', type: 'checking' })).data.account;
    const r = await c.post('/api/rules', {
      name: '  Everything  ', matchMode: 'any', stopAfter: true,
      conditions: [has('swiggy'), payeeIs(sw.id), gt(500, 'expense'), lt(10), inAccount(acct2.id)],
      actions: [setCat(c.cat.Food), setPayee(sw.id), note('food'), cleared],
    });
    assert.equal(r.status, 201);
    const x = r.data.rule;
    assert.deepEqual([x.name, x.enabled, x.matchMode, x.stopAfter, x.position, x.problems], ['Everything', true, 'any', true, 1, []]);
    assert.equal(x.conditions.length, 5);
    assert.deepEqual(x.conditions[3], { type: 'amount_lt', valueMinor: R(10), direction: 'any' }, 'direction defaults to any');
    assert.equal(x.actions.length, 4);

    assert.equal((await c.get(`/api/rules/${x.id}`)).data.rule.name, 'Everything');
    assert.equal((await c.get('/api/rules')).data.rules.length, 1);

    let u = await c.patch(`/api/rules/${x.id}`, { enabled: false });
    assert.equal(u.data.rule.enabled, false);
    assert.equal(u.data.rule.conditions.length, 5, 'other fields are untouched');
    u = await c.patch(`/api/rules/${x.id}`, { name: 'Renamed', matchMode: 'all', stopAfter: false, conditions: [has('only')], actions: [cleared], enabled: true });
    assert.deepEqual([u.data.rule.name, u.data.rule.matchMode, u.data.rule.stopAfter, u.data.rule.enabled, u.data.rule.conditions.length], ['Renamed', 'all', false, true, 1]);

    assert.equal((await c.del(`/api/rules/${x.id}`)).status, 200);
    assert.equal((await c.get(`/api/rules/${x.id}`)).status, 404);
    assert.equal((await c.del(`/api/rules/${x.id}`)).status, 404);
    assert.deepEqual((await c.get('/api/rules')).data.rules, []);
  } finally { await s.close(); }
});

test('rule validation rejects bad input and anything that is not yours', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r2@example.com');
    const other = await newUser(s.base, 'r2b@example.com');
    const theirs = await payee(other, 'Theirs');
    const ok = { name: 'ok', conditions: [has('x')], actions: [cleared] };
    const bad = async (over, why) => assert.equal((await c.post('/api/rules', { ...ok, ...over })).status, 400, why);

    await bad({ name: '' }, 'empty name');
    await bad({ name: 'x'.repeat(61) }, 'long name');
    await bad({ conditions: [] }, 'no conditions');
    await bad({ conditions: undefined }, 'missing conditions');
    await bad({ actions: [] }, 'no actions');
    await bad({ conditions: [{ type: 'nope' }] }, 'unknown condition');
    await bad({ actions: [{ type: 'nope' }] }, 'unknown action');
    await bad({ conditions: ['x'] }, 'condition not an object');
    await bad({ conditions: [has('')] }, 'empty text');
    await bad({ conditions: [has('x'.repeat(101))] }, 'long text');
    await bad({ conditions: [{ type: 'amount_gt', valueMinor: -1 }] }, 'negative amount');
    await bad({ conditions: [{ type: 'amount_gt', valueMinor: 1.5 }] }, 'fractional paise');
    await bad({ conditions: [{ type: 'amount_gt', valueMinor: '5' }] }, 'string amount');
    await bad({ conditions: [{ type: 'amount_gt', valueMinor: 5, direction: 'sideways' }] }, 'bad direction');
    await bad({ conditions: [payeeIs(999999)] }, 'unknown payee');
    await bad({ conditions: [payeeIs(theirs.id)] }, 'another user\'s payee');
    await bad({ conditions: [inAccount(999999)] }, 'unknown account');
    await bad({ conditions: [inAccount(other.accountId)] }, 'another user\'s account');
    await bad({ actions: [setCat(999999)] }, 'unknown category');
    await bad({ actions: [setCat(other.cat.Food)] }, 'another user\'s category');
    await bad({ actions: [setPayee(theirs.id)] }, 'another user\'s payee in an action');
    await bad({ actions: [note('')] }, 'empty note');
    await bad({ actions: [note('n'.repeat(201))] }, 'long note');
    await bad({ matchMode: 'some' }, 'bad matchMode');
    await bad({ enabled: 'yes' }, 'bad enabled');
    await bad({ stopAfter: 1 }, 'bad stopAfter');
    await bad({ conditions: Array(11).fill(has('x')) }, 'too many conditions');
    await bad({ actions: Array(11).fill(cleared) }, 'too many actions');
    assert.equal((await c.patch('/api/rules/999999', { name: 'x' })).status, 404);
    const r = await rule(c, [has('x')], [cleared]);
    assert.equal((await c.patch(`/api/rules/${r.id}`, {})).status, 400, 'nothing to change');
    assert.equal((await c.patch(`/api/rules/${r.id}`, { conditions: [] })).status, 400);
    assert.equal((await c.get('/api/rules')).data.rules.length, 1, 'no failed attempt left a rule behind');
  } finally { await s.close(); }
});

test('at most 200 rules per user', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r3@example.com');
    for (let i = 0; i < 200; i++) assert.equal((await c.post('/api/rules', { name: `r${i}`, conditions: [has('x')], actions: [cleared] })).status, 201);
    const r = await c.post('/api/rules', { name: 'one too many', conditions: [has('x')], actions: [cleared] });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /at most 200/);
  } finally { await s.close(); }
});

/* ------------------------------ conditions ------------------------------ */

test('conditions: description contains (payee text and notes, any capitals), payee equals, account equals', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r4@example.com');
    const uber = await payee(c, 'Uber');
    const bank = (await c.post('/api/accounts', { name: 'Bank', type: 'checking' })).data.account;
    await rule(c, [has('swiggy')], [setCat(c.cat.Food)]);
    await rule(c, [payeeIs(uber.id)], [setCat(c.cat.Travel)]);
    await rule(c, [inAccount(bank.id)], [note('bank')]);

    assert.equal((await add(c, { payee: 'SWIGGY ORDER #123' })).transaction.categoryName, 'Food', 'matches inside the payee text, any capitals');
    assert.equal((await add(c, { payee: 'Misc', notes: 'late night Swiggy' })).transaction.categoryName, 'Food', 'matches inside the notes');
    assert.equal((await add(c, { payee: 'Zomato' })).transaction.categoryName, null, 'no match, no change');
    assert.equal((await add(c, { payee: 'uber' })).transaction.categoryName, 'Travel', 'payee equals ignores capitals');
    assert.equal((await add(c, { payee: 'Uber Eats' })).transaction.categoryName, null, 'payee equals is exact, not "contains"');
    assert.equal((await add(c, { payee: 'Zomato', accountId: bank.id })).transaction.notes, 'bank');
    assert.equal((await add(c, { payee: 'Zomato' })).transaction.notes, '', 'other account: no match');
    // text with SQL/regex-looking characters is just text
    await rule(c, [has('50% off (promo)')], [note('tagged')]);
    assert.equal((await add(c, { payee: 'Shop', notes: '50% off (promo)' })).transaction.notes, '50% off (promo) tagged');
  } finally { await s.close(); }
});

test('conditions: amount greater / less than are strict, use the size of the amount, and can be limited to expenses or income', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r5@example.com');
    await rule(c, [gt(500)], [note('big')]);
    await rule(c, [lt(50)], [note('small')]);
    await rule(c, [gt(1000, 'expense')], [note('big-expense')]);
    await rule(c, [gt(1000, 'income')], [note('big-income')]);
    const notes = async (amountMinor) => (await add(c, { amountMinor })).transaction.notes;

    assert.equal(await notes(-R(500)), '', 'exactly 500 is not greater than 500');
    assert.equal(await notes(-R(500) - 1), 'big', 'one paisa more is');
    assert.equal(await notes(R(600)), 'big', 'income counts by size too (direction "any")');
    assert.equal(await notes(-R(50)), '', 'exactly 50 is not less than 50');
    assert.equal(await notes(-R(50) + 1), 'small');
    assert.equal(await notes(R(1)), 'small');
    assert.equal(await notes(-R(2000)), 'big big-expense');
    assert.equal(await notes(R(2000)), 'big big-income');
  } finally { await s.close(); }
});

test('match "all" needs every condition, match "any" needs one', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r6@example.com');
    await rule(c, [has('cafe'), gt(200, 'expense')], [note('ALL')], { matchMode: 'all' });
    await rule(c, [has('train'), gt(1000, 'expense')], [note('ANY')], { matchMode: 'any' });
    assert.equal((await add(c, { payee: 'Cafe', amountMinor: -R(300) })).transaction.notes, 'ALL');
    assert.equal((await add(c, { payee: 'Cafe', amountMinor: -R(100) })).transaction.notes, '', 'one of two is not enough for "all"');
    assert.equal((await add(c, { payee: 'Other', amountMinor: -R(2000) })).transaction.notes, 'ANY');
    assert.equal((await add(c, { payee: 'Train', amountMinor: -R(10) })).transaction.notes, 'ANY');
    assert.equal((await add(c, { payee: 'Other', amountMinor: -R(10) })).transaction.notes, '');
  } finally { await s.close(); }
});

/* ------------------------------ actions ------------------------------ */

test('actions: set category, set payee, add note, mark cleared; response says which rules ran', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r7@example.com');
    const swiggy = await payee(c, 'Swiggy');
    const r = await rule(c, [has('swiggy')], [setCat(c.cat.Food), setPayee(swiggy.id), note('delivery'), cleared], { name: 'Swiggy tidy' });

    const made = await add(c, { payee: 'SWIGGY*ORDER 8812', notes: 'dinner' });
    const t = made.transaction;
    assert.deepEqual([t.categoryName, t.payee, t.payeeId, t.notes, t.cleared], ['Food', 'Swiggy', swiggy.id, 'dinner delivery', true]);
    assert.deepEqual(made.rulesApplied, [{ id: r.id, name: 'Swiggy tidy' }]);
    // the messy name was never created as a payee
    assert.deepEqual(await payeeNames(c), ['Swiggy']);

    const plain = await add(c, { payee: 'Bookshop' });
    assert.deepEqual(plain.rulesApplied, []);
    assert.deepEqual([plain.transaction.categoryName, plain.transaction.notes, plain.transaction.cleared], [null, '', false]);

    // a rule wins over what was typed for the fields it sets
    const typed = await add(c, { payee: 'swiggy', categoryId: c.cat.Travel });
    assert.equal(typed.transaction.categoryName, 'Food');

    // the same note text is never added twice; a note that would not fit is skipped, never cut in half
    const again = await add(c, { payee: 'swiggy', notes: 'delivery' });
    assert.equal(again.transaction.notes, 'delivery');
    await rule(c, [has('longnote')], [note('x'.repeat(150))]);
    const long = await add(c, { payee: 'longnote', notes: 'y'.repeat(100) });
    assert.equal(long.transaction.notes, 'y'.repeat(100));
  } finally { await s.close(); }
});

test('disabled rules do not run; nor do they when a transaction is only edited or bulk-changed', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r8@example.com');
    const r = await rule(c, [has('rent')], [setCat(c.cat.Bills)]);
    await c.patch(`/api/rules/${r.id}`, { enabled: false });
    assert.equal((await add(c, { payee: 'Rent' })).transaction.categoryName, null);

    await c.patch(`/api/rules/${r.id}`, { enabled: true });
    const t = (await add(c, { payee: 'Misc' })).transaction;
    assert.equal(t.categoryName, null);
    const edited = (await c.patch(`/api/transactions/${t.id}`, { payee: 'Rent' })).data.transaction;
    assert.equal(edited.categoryName, null, 'editing never runs rules');
    await c.post('/api/transactions/bulk', { ids: [t.id], action: 'update', changes: { cleared: true } });
    assert.equal((await allTx(c)).find((x) => x.id === t.id).categoryName, null);
    assert.equal((await add(c, { payee: 'Rent' })).transaction.categoryName, 'Bills', 'creating does');
  } finally { await s.close(); }
});

/* ---------------------- several rules, order, priority ---------------------- */

test('every matching rule runs, in list order; the last one to set a field wins; notes accumulate', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r9@example.com');
    await rule(c, [has('coffee')], [setCat(c.cat.Food), note('one')], { name: 'first' });
    await rule(c, [has('coffee')], [setCat(c.cat.Shopping), note('two')], { name: 'second' });
    await rule(c, [has('nomatch')], [setCat(c.cat.Bills)], { name: 'third' });
    await rule(c, [gt(10)], [note('three'), cleared], { name: 'fourth' });
    const made = await add(c, { payee: 'Coffee', amountMinor: -R(120) });
    assert.deepEqual(made.rulesApplied.map((x) => x.name), ['first', 'second', 'fourth'], 'in order, skipping the one that did not match');
    assert.equal(made.transaction.categoryName, 'Shopping', 'last setter wins');
    assert.equal(made.transaction.notes, 'one two three');
    assert.equal(made.transaction.cleared, true);
  } finally { await s.close(); }
});

test('rules build on each other: a later rule sees what an earlier rule changed', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r10@example.com');
    const zomato = await payee(c, 'Zomato');
    await rule(c, [has('zomato')], [setPayee(zomato.id)], { name: 'clean name' });
    await rule(c, [payeeIs(zomato.id)], [setCat(c.cat.Food)], { name: 'zomato is food' });
    await rule(c, [has('[tidy]')], [note('tidied')], { name: 'needs a note first' });
    await rule(c, [has('ZOMATO*ORDER')], [note('sees the old text?')], { name: 'old text' });

    const made = await add(c, { payee: 'ZOMATO*ORDER 99' });
    // rule 2 fires only because rule 1 already renamed the payee; rule 4 no longer sees "ZOMATO*ORDER"
    assert.deepEqual([made.transaction.payee, made.transaction.categoryName, made.transaction.notes], ['Zomato', 'Food', '']);
    assert.deepEqual(made.rulesApplied.map((x) => x.name), ['clean name', 'zomato is food']);
  } finally { await s.close(); }
});

test('"stop after this rule" ends processing', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r11@example.com');
    await rule(c, [has('rent')], [setCat(c.cat.Bills)], { stopAfter: true, name: 'rent stops' });
    await rule(c, [has('rent')], [setCat(c.cat.Shopping), note('should not run')], { name: 'later' });
    await rule(c, [has('other')], [note('other')], { name: 'unrelated' });
    const made = await add(c, { payee: 'Rent' });
    assert.deepEqual([made.transaction.categoryName, made.transaction.notes], ['Bills', '']);
    assert.deepEqual(made.rulesApplied.map((x) => x.name), ['rent stops']);
    // a rule that does NOT match does not stop anything
    assert.deepEqual((await add(c, { payee: 'other' })).rulesApplied.map((x) => x.name), ['unrelated']);
  } finally { await s.close(); }
});

test('rule order is predictable: new rules go last, reordering changes who wins, and is validated', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r12@example.com');
    const a = await rule(c, [has('x')], [setCat(c.cat.Food)], { name: 'A' });
    const b = await rule(c, [has('x')], [setCat(c.cat.Travel)], { name: 'B' });
    const d = await rule(c, [has('x')], [setCat(c.cat.Bills)], { name: 'C' });
    assert.deepEqual((await c.get('/api/rules')).data.rules.map((r) => [r.name, r.position]), [['A', 1], ['B', 2], ['C', 3]]);
    assert.equal((await add(c, { payee: 'x' })).transaction.categoryName, 'Bills', 'C is last, so C wins');

    let r = await c.post('/api/rules/reorder', { ids: [d.id, a.id, b.id] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.rules.map((x) => x.name), ['C', 'A', 'B']);
    assert.deepEqual((await c.get('/api/rules')).data.rules.map((x) => x.position), [1, 2, 3]);
    assert.equal((await add(c, { payee: 'x' })).transaction.categoryName, 'Travel', 'now B is last');
    // an applied-rules list follows the same order
    assert.deepEqual((await add(c, { payee: 'x' })).rulesApplied.map((x) => x.name), ['C', 'A', 'B']);

    // a rule created later goes to the end; deleting one closes the gap without reshuffling
    const e = await rule(c, [has('x')], [setCat(c.cat.Other)], { name: 'E' });
    assert.equal(e.position, 4);
    assert.equal((await add(c, { payee: 'x' })).transaction.categoryName, 'Other');
    await c.del(`/api/rules/${a.id}`);
    assert.deepEqual((await c.get('/api/rules')).data.rules.map((x) => [x.name, x.position]), [['C', 1], ['B', 2], ['E', 3]]);

    // bad reorders change nothing
    const before = JSON.stringify((await c.get('/api/rules')).data.rules.map((x) => x.id));
    for (const ids of [[], [d.id], [d.id, b.id, e.id, e.id], [d.id, b.id, 999999], 'x', [d.id, b.id, 'no']]) {
      assert.equal((await c.post('/api/rules/reorder', { ids })).status, 400, JSON.stringify(ids));
    }
    assert.equal(JSON.stringify((await c.get('/api/rules')).data.rules.map((x) => x.id)), before);
  } finally { await s.close(); }
});

/* ------------------------------ import ------------------------------ */

const OLD = (title, amount, date, cat = 'Food', type = 'expense') => ({ title, amount, date, cat, type });

test('import: rules apply to imported rows; the original messy payee is never created; re-importing adds nothing', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r13@example.com');
    const swiggy = await payee(c, 'Swiggy');
    await rule(c, [has('swiggy')], [setPayee(swiggy.id), setCat(c.cat.Shopping), note('auto'), cleared], { name: 'Swiggy' });
    const file = [OLD('SWIGGY ORDER 123', 250, '2026-10-01'), OLD('SWIGGY ORDER 124', 300, '2026-10-02'), OLD('Bookshop', 80, '2026-10-03', 'Other')];

    const r = await c.post('/api/import/spendwise-backup', { data: file });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { added: 3, duplicates: 0, invalid: 0, rulesApplied: 2, truncated: 0 });
    const rows = await allTx(c);
    const sw = rows.filter((t) => t.payee === 'Swiggy');
    assert.equal(sw.length, 2);
    assert.ok(sw.every((t) => t.categoryName === 'Shopping' && t.notes === 'auto' && t.cleared));
    const book = rows.find((t) => t.payee === 'Bookshop');
    assert.deepEqual([book.categoryName, book.notes, book.cleared], ['Other', '', false], 'rows no rule matches are imported as they are');
    assert.deepEqual(await payeeNames(c), ['Bookshop', 'Swiggy'], 'no "SWIGGY ORDER 123" payee was left behind');

    // importing the same file again must not duplicate anything, even though the rules rewrote the stored rows
    const again = await c.post('/api/import/spendwise-backup', { data: file });
    assert.deepEqual([again.data.added, again.data.duplicates], [0, 3]);
    assert.equal((await allTx(c)).length, 3);
    // a file with one extra genuinely new row adds only that row
    const more = await c.post('/api/import/spendwise-backup', { data: [...file, OLD('SWIGGY ORDER 125', 99, '2026-10-04')] });
    assert.deepEqual([more.data.added, more.data.duplicates], [1, 3]);
  } finally { await s.close(); }
});

test('import: two identical real purchases in the file are both kept, and stay kept on re-import', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r14@example.com');
    const sw = await payee(c, 'Swiggy');
    await rule(c, [has('swiggy')], [setPayee(sw.id)]);
    const twin = OLD('SWIGGY ORDER', 100, '2026-10-01');
    const file = [twin, { ...twin }];
    assert.deepEqual((await c.post('/api/import/spendwise-backup', { data: file })).data.added, 2);
    assert.deepEqual([(await c.post('/api/import/spendwise-backup', { data: file })).data.duplicates, (await allTx(c)).length], [2, 2]);
    assert.equal((await c.post('/api/import/spendwise-backup', { data: [...file, { ...twin }] })).data.added, 1, 'a third identical row is new');
  } finally { await s.close(); }
});

test('import: applyRules:false imports exactly what the file says; without rules the response is unchanged', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r15@example.com');
    const file = [OLD('SWIGGY ORDER 1', 100, '2026-10-01')];
    // no rules at all: same shape as before Phase 4 (no rulesApplied key)
    const plain = await c.post('/api/import/spendwise-backup', { data: file });
    assert.deepEqual(plain.data, { added: 1, duplicates: 0, invalid: 0, truncated: 0 });
    await c.del(`/api/transactions/${(await allTx(c))[0].id}`);

    const sw = await payee(c, 'Swiggy');
    await rule(c, [has('swiggy')], [setPayee(sw.id), note('auto')]);
    const off = await c.post('/api/import/spendwise-backup', { data: file, applyRules: false });
    assert.equal(off.data.added, 1);
    assert.equal(off.data.rulesApplied, undefined);
    const t = (await allTx(c))[0];
    assert.deepEqual([t.payee, t.notes], ['SWIGGY ORDER 1', '']);
    assert.equal((await c.post('/api/import/spendwise-backup', { data: file, applyRules: 'no' })).status, 400);
  } finally { await s.close(); }
});

test('import of a full (v2) backup applies rules too, per account', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r16@example.com');
    await rule(c, [gt(1000, 'expense')], [note('large')]);
    await rule(c, [inAccount(c.accountId)], [cleared]);
    const data = { version: 2, transactions: [
      { date: '2026-10-01', amountMinor: -R(5000), payee: 'Laptop', notes: '', category: 'Shopping', account: 'Cash', cleared: false },
      { date: '2026-10-02', amountMinor: -R(50), payee: 'Tea', notes: '', category: 'Food', account: 'Cash', cleared: false },
    ] };
    const r = await c.post('/api/import/spendwise-backup', { data });
    assert.deepEqual([r.data.added, r.data.rulesApplied], [2, 2]);
    const rows = await allTx(c);
    assert.equal(rows.find((t) => t.payee === 'Laptop').notes, 'large');
    assert.equal(rows.find((t) => t.payee === 'Tea').notes, '');
    assert.ok(rows.every((t) => t.cleared));
  } finally { await s.close(); }
});

/* --------------------- existing data stays put unless asked --------------------- */

test('creating, enabling or editing rules never changes existing transactions', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r17@example.com');
    await add(c, { payee: 'Swiggy 1' });
    await add(c, { payee: 'Swiggy 2' });
    const snapshot = JSON.stringify(await allTx(c));
    const r = await rule(c, [has('swiggy')], [setCat(c.cat.Food), note('x'), cleared]);
    await c.patch(`/api/rules/${r.id}`, { enabled: false });
    await c.patch(`/api/rules/${r.id}`, { enabled: true, name: 'again' });
    await c.post('/api/rules/reorder', { ids: [r.id] });
    assert.equal(JSON.stringify(await allTx(c)), snapshot);
  } finally { await s.close(); }
});

test('re-apply: previews by default, changes data only when dryRun is explicitly false, and is repeatable', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r18@example.com');
    const sw = await payee(c, 'Swiggy');
    const old1 = (await add(c, { payee: 'Swiggy 1', date: '2026-09-10' })).transaction;
    await add(c, { payee: 'Swiggy 2', date: '2026-10-11' });
    await add(c, { payee: 'Swiggy 3', date: '2026-11-12', categoryId: c.cat.Travel });     // already categorized
    await add(c, { payee: 'Bookshop', date: '2026-11-13' });
    await rule(c, [has('swiggy')], [setPayee(sw.id), setCat(c.cat.Food), note('rule')], { name: 'Swiggy' });
    const before = JSON.stringify(await allTx(c));

    // default and explicit dryRun: a preview only
    for (const body of [{}, { dryRun: true }]) {
      const p = await c.post('/api/rules/reprocess', body);
      assert.equal(p.status, 200);
      assert.deepEqual([p.data.dryRun, p.data.scanned, p.data.changed, p.data.truncated], [true, 4, 3, false]);
      assert.deepEqual(p.data.samples.find((x) => x.id === old1.id), {
        id: old1.id, rules: ['Swiggy'],
        before: { payee: 'Swiggy 1', category: 'Uncategorized', notes: '', cleared: false },
        after: { payee: 'Swiggy', category: 'Food', notes: 'rule', cleared: false },
      });
      assert.equal(JSON.stringify(await allTx(c)), before, 'a preview changes nothing');
    }
    assert.equal((await c.post('/api/rules/reprocess', { dryRun: 'false' })).status, 400, 'must be a real boolean');
    assert.equal(JSON.stringify(await allTx(c)), before);

    // now for real
    const done = await c.post('/api/rules/reprocess', { dryRun: false });
    assert.deepEqual([done.data.dryRun, done.data.changed], [false, 3]);
    const rows = await allTx(c);
    assert.deepEqual(rows.filter((t) => t.payee === 'Swiggy').map((t) => [t.categoryName, t.notes]).sort(), [['Food', 'rule'], ['Food', 'rule'], ['Food', 'rule']]);
    assert.equal(rows.find((t) => t.payee === 'Bookshop').categoryName, null, 'non-matching rows untouched');
    // payees are never deleted behind your back: the old ones remain (unused), and nothing new was invented
    assert.deepEqual(await payeeNames(c), ['Bookshop', 'Swiggy', 'Swiggy 1', 'Swiggy 2', 'Swiggy 3']);
    const pl = (await c.get('/api/payees?status=all')).data.payees;
    assert.equal(pl.find((p) => p.name === 'Swiggy').usageCount, 3);
    assert.equal(pl.find((p) => p.name === 'Swiggy 1').usageCount, 0);
    // and a second run has nothing left to do
    const second = await c.post('/api/rules/reprocess', { dryRun: false });
    assert.equal(second.data.changed, 0);
  } finally { await s.close(); }
});

test('re-apply: can be limited by month, account, "only uncategorized" or chosen rules (even a disabled one)', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r19@example.com');
    const bank = (await c.post('/api/accounts', { name: 'Bank', type: 'checking' })).data.account;
    await add(c, { payee: 'Shop A', date: '2026-10-05' });
    await add(c, { payee: 'Shop B', date: '2026-11-05' });
    await add(c, { payee: 'Shop C', date: '2026-11-06', accountId: bank.id });
    await add(c, { payee: 'Shop D', date: '2026-11-07', categoryId: c.cat.Travel });
    const r = await rule(c, [has('shop')], [setCat(c.cat.Shopping)], { name: 'Shops' });
    const cat = async (name) => (await allTx(c)).find((t) => t.payee === name).categoryName;
    const run = (body) => c.post('/api/rules/reprocess', { dryRun: false, ...body });

    assert.equal((await run({ month: '2026-10' })).data.changed, 1);
    assert.equal(await cat('Shop A'), 'Shopping');
    assert.equal(await cat('Shop B'), null);
    assert.equal((await run({ accountId: bank.id })).data.changed, 1);
    assert.equal(await cat('Shop C'), 'Shopping');
    assert.equal(await cat('Shop B'), null);
    assert.equal((await run({ month: 'all', onlyUncategorized: true })).data.changed, 1);
    assert.equal(await cat('Shop B'), 'Shopping');
    assert.equal(await cat('Shop D'), 'Travel', '"only uncategorized" leaves D alone');
    assert.equal((await run({})).data.changed, 1);
    assert.equal(await cat('Shop D'), 'Shopping');

    // a disabled rule is skipped normally but can be tried on its own
    await c.patch(`/api/rules/${r.id}`, { enabled: false, actions: [note('tried')] });
    assert.equal((await c.post('/api/rules/reprocess', { dryRun: false })).data.changed, 0);
    assert.equal((await c.post('/api/rules/reprocess', { dryRun: true, ruleIds: [r.id] })).data.changed, 4);
    assert.equal((await run({ ruleIds: [r.id] })).data.changed, 4);
    assert.ok((await allTx(c)).every((t) => t.notes === 'tried'));

    for (const bad of [{ month: '2026-13' }, { month: 5 }, { accountId: 'x' }, { ruleIds: [] }, { ruleIds: ['a'] }, { onlyUncategorized: 'yes' }]) {
      assert.equal((await c.post('/api/rules/reprocess', bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await c.post('/api/rules/reprocess', { accountId: 999999 })).status, 404);
    assert.equal((await c.post('/api/rules/reprocess', { ruleIds: [999999] })).status, 404);
  } finally { await s.close(); }
});

test('re-apply with no enabled rules does nothing', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r20@example.com');
    await add(c);
    const r = await c.post('/api/rules/reprocess', { dryRun: false });
    assert.deepEqual([r.status, r.data.changed, r.data.scanned], [200, 0, 0]);
  } finally { await s.close(); }
});

/* --------------------- references stay valid / are flagged --------------------- */

test('merging a category re-points rules; deleting one leaves a visible warning, not a crash', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'r21@example.com');
    const r = await rule(c, [has('x')], [setCat(c.cat.Shopping)], { name: 'to shopping' });
    assert.equal((await c.post(`/api/categories/${c.cat.Shopping}/merge`, { targetId: c.cat.Bills })).status, 200);
    assert.equal((await c.get(`/api/rules/${r.id}`)).data.rule.actions[0].categoryId, c.cat.Bills);
    assert.equal((await add(c, { payee: 'x' })).transaction.categoryName, 'Bills');

    // "delete and move to ..." re-points as well
    await tx(c, { payee: 'Other thing', categoryId: c.cat.Other });
    await c.del(`/api/categories/${c.cat.Bills}?moveTo=${c.cat.Other}`);
    assert.equal((await c.get(`/api/rules/${r.id}`)).data.rule.actions[0].categoryId, c.cat.Other);

    // deleting with nowhere to move it: the rule stays, says so, and skips that action
    await c.del(`/api/categories/${c.cat.Other}?moveTo=none`);
    const after = (await c.get(`/api/rules/${r.id}`)).data.rule;
    assert.match(after.problems[0], /deleted category/);
    const made = await add(c, { payee: 'x', notes: 'n' });
    assert.deepEqual([made.transaction.categoryName, made.transaction.notes], [null, 'n']);
    assert.equal((await c.get('/api/rules')).data.rules.find((x) => x.id === r.id).problems.length, 1);
    // fixing the rule clears the warning
    const fixed = await c.patch(`/api/rules/${r.id}`, { actions: [setCat(c.cat.Food)] });
    assert.deepEqual(fixed.data.rule.problems, []);
  } finally { await s.close(); }
});

/* ------------------------------ upgrade ------------------------------ */

test('a Phase 3 database upgrades in place: payees gain "archived", the rules table appears, data is kept', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sw-p4-')), 'old.db');
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(file);
  old.exec('PRAGMA foreign_keys = ON');
  old.exec('CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  for (const m of MIGRATIONS.filter((x) => x.id <= 3)) {
    old.exec(m.sql);
    old.prepare('INSERT INTO schema_migrations(id, name) VALUES (?, ?)').run(m.id, m.name);
  }
  old.prepare("INSERT INTO users (email, display_name, password_hash) VALUES ('old@example.com', 'Old', 'x')").run();
  require('../server/seed').seedUser(old, 1);
  old.prepare("INSERT INTO payees (user_id, name) VALUES (1, 'Swiggy')").run();
  old.prepare("INSERT INTO transactions (user_id, account_id, date, amount_minor, payee_id) VALUES (1, 1, '2026-10-02', -5000, 1)").run();
  old.close();

  const db = openDb(file);
  try {
    assert.deepEqual(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id), MIGRATIONS.map((m) => m.id));
    const p = db.prepare('SELECT name, archived FROM payees').get();
    assert.deepEqual([p.name, p.archived], ['Swiggy', 0]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rules').get().n, 0);
  } finally { db.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});

/* ------------------------------ multi-user isolation ------------------------------ */

test('users never see, change, run or reorder each other\'s rules', async () => {
  const s = await start();
  try {
    const a = await newUser(s.base, 'ra@example.com');
    const b = await newUser(s.base, 'rb@example.com');
    const ra = await rule(a, [has('secret')], [setCat(a.cat.Food), note('A-only')], { name: 'A rule' });
    const rb = await rule(b, [has('secret')], [setCat(b.cat.Travel), note('B-only')], { name: 'B rule' });

    // lists and direct access
    assert.deepEqual((await b.get('/api/rules')).data.rules.map((r) => r.name), ['B rule']);
    assert.equal((await b.get(`/api/rules/${ra.id}`)).status, 404);
    assert.equal((await b.patch(`/api/rules/${ra.id}`, { enabled: false })).status, 404);
    assert.equal((await b.patch(`/api/rules/${ra.id}`, { name: 'hijack' })).status, 404);
    assert.equal((await b.del(`/api/rules/${ra.id}`)).status, 404);
    assert.equal((await b.post('/api/rules/reorder', { ids: [ra.id] })).status, 400);
    assert.equal((await b.post('/api/rules/reorder', { ids: [rb.id, ra.id] })).status, 400);
    assert.equal((await b.post('/api/rules/reprocess', { ruleIds: [ra.id] })).status, 404);
    assert.deepEqual([(await a.get(`/api/rules/${ra.id}`)).data.rule.enabled, (await a.get(`/api/rules/${ra.id}`)).data.rule.name], [true, 'A rule']);

    // each user's rules run only on that user's own new transactions
    const ta = (await add(a, { payee: 'secret' })).transaction;
    const tb = (await add(b, { payee: 'secret' })).transaction;
    assert.deepEqual([ta.categoryName, ta.notes], ['Food', 'A-only']);
    assert.deepEqual([tb.categoryName, tb.notes], ['Travel', 'B-only']);
    const bImport = await b.post('/api/import/spendwise-backup', { data: [OLD('secret thing', 10, '2026-10-01', 'Other')] });
    assert.equal(bImport.data.rulesApplied, 1);
    assert.equal((await allTx(b)).find((t) => t.payee === 'secret thing').notes, 'B-only');
    assert.equal((await allTx(a)).length, 1, 'B\'s import did not touch A');

    // B re-applying rules never touches A's transactions
    const snapshotA = JSON.stringify(await allTx(a));
    await a.post('/api/rules/reprocess', { dryRun: false });           // normalise A first
    const normalisedA = JSON.stringify(await allTx(a));
    const r = await b.post('/api/rules/reprocess', { dryRun: false });
    assert.equal(r.status, 200);
    assert.equal(JSON.stringify(await allTx(a)), normalisedA, 'A\'s data is unchanged by B\'s re-apply');
    void snapshotA;

    // a rule may not point at another user's payee, account or category (even by guessing the ids)
    const theirPayee = await payee(a, 'Only A');
    assert.equal((await b.post('/api/rules', { name: 'x', conditions: [payeeIs(theirPayee.id)], actions: [cleared] })).status, 400);
    assert.equal((await b.post('/api/rules', { name: 'x', conditions: [has('y')], actions: [setPayee(theirPayee.id)] })).status, 400);
    assert.equal((await b.post('/api/rules', { name: 'x', conditions: [inAccount(a.accountId)], actions: [cleared] })).status, 400);
    assert.equal((await b.post('/api/rules', { name: 'x', conditions: [has('y')], actions: [setCat(a.cat.Food)] })).status, 400);
    assert.equal((await b.patch(`/api/rules/${rb.id}`, { actions: [setCat(a.cat.Food)] })).status, 400);
    assert.equal((await b.get('/api/rules')).data.rules.length, 1);
  } finally { await s.close(); }
});

test('rule endpoints need a login and a CSRF token on writes', async () => {
  const s = await start();
  try {
    const anon = new Client(s.base);
    for (const [m, p] of [['GET', '/api/rules'], ['POST', '/api/rules'], ['POST', '/api/rules/reorder'], ['POST', '/api/rules/reprocess']]) {
      const r = await anon.json(p, { method: m, body: m === 'POST' ? {} : undefined });
      assert.equal(r.status, 401, `${m} ${p}`);
    }
    const c = await newUser(s.base, 'r22@example.com');
    const noToken = await c.req('/api/rules', { method: 'POST', csrf: false, body: { name: 'x', conditions: [has('y')], actions: [cleared] } });
    assert.equal(noToken.status, 403);
    assert.deepEqual((await c.get('/api/rules')).data.rules, []);
    const noTokenReprocess = await c.req('/api/rules/reprocess', { method: 'POST', csrf: false, body: { dryRun: false } });
    assert.equal(noTokenReprocess.status, 403);
  } finally { await s.close(); }
});
