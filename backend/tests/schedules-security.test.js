'use strict';
// Phase 6: multi-user isolation and request safety for schedules, bills, the calendar and the forecast.
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, newUser, Client } = require('./helpers');

const R = (n) => n * 100;
const TODAY = '2026-11-15';
const boot = () => start({ TODAY });
const setToday = (s, d) => { s.server.clock.fixed = d; };
const mk = async (c, over = {}) => {
  const r = await c.post('/api/schedules', {
    accountId: c.accountId, payee: 'Landlord', name: 'Rent', categoryId: c.cat.Bills, amountMinor: -R(300),
    startDate: '2026-12-01', frequency: 'monthly', mode: 'approval', ...over,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.schedule;
};
const userTxCount = (s, userId) => s.server.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?').get(userId).n;

/** Alice has an auto schedule, a waiting bill, a paused schedule, some money and a rule. Bob is a stranger with his own account. */
async function world(s) {
  const alice = await newUser(s.base, 'alice@example.com');
  const bob = await newUser(s.base, 'bob@example.com');
  await alice.post('/api/transactions', { accountId: alice.accountId, date: TODAY, amountMinor: R(5000), payee: 'Employer', categoryId: alice.cat.Salary });
  const auto = await mk(alice, { name: 'Alice Netflix', payee: 'Alice Streaming', mode: 'auto', startDate: '2026-12-01' });
  const waiting = await mk(alice, { name: 'Alice Rent', startDate: '2026-11-01' });
  const paused = await mk(alice, { name: 'Alice Gym', payee: 'Alice Gym Co', startDate: '2026-12-05' });
  await alice.post(`/api/schedules/${paused.id}/pause`, {});
  const pending = (await alice.get('/api/schedule-occurrences?status=pending')).data.occurrences[0];
  return { alice, bob, auto, waiting, paused, pending };
}

test('every schedule, bill, calendar and forecast endpoint needs a login', async () => {
  const s = await boot();
  try {
    const anon = new Client(s.base);
    await anon.json('/api/auth/csrf');
    for (const path of ['/api/schedules', '/api/schedules/1', '/api/schedule-occurrences', '/api/bills', '/api/calendar', '/api/forecast']) {
      assert.equal((await anon.get(path)).status, 401, `GET ${path}`);
    }
    for (const [method, path] of [
      ['POST', '/api/schedules'], ['POST', '/api/schedules/run'], ['PATCH', '/api/schedules/1'], ['DELETE', '/api/schedules/1'],
      ['POST', '/api/schedules/1/pause'], ['POST', '/api/schedules/1/resume'], ['POST', '/api/schedules/1/post-next'],
      ['POST', '/api/schedules/1/skip-next'], ['POST', '/api/schedule-occurrences/1/approve'], ['POST', '/api/schedule-occurrences/1/skip'],
    ]) {
      const r = await anon.json(path, { method, body: {} });
      assert.equal(r.status, 401, `${method} ${path}`);
    }
    for (const page of ['/schedules', '/bills', '/calendar', '/forecast']) {
      const r = await anon.req(page);
      assert.equal(r.status, 302, `${page} sends a logged-out visitor to the login page`);
      assert.match(r.headers.get('location'), /^\/login\?next=/);
    }
  } finally { await s.close(); }
});

test("one user cannot see, change, pause, pay, skip or delete another user's schedule (always a plain 404)", async () => {
  const s = await boot();
  try {
    const { alice, bob, auto, waiting, pending } = await world(s);
    const before = JSON.stringify((await alice.get('/api/schedules')).data.schedules);

    assert.equal((await bob.get(`/api/schedules/${auto.id}`)).status, 404);
    assert.equal((await bob.patch(`/api/schedules/${auto.id}`, { amountMinor: -1, name: 'hacked' })).status, 404);
    assert.equal((await bob.del(`/api/schedules/${auto.id}`)).status, 404);
    assert.equal((await bob.post(`/api/schedules/${auto.id}/pause`, {})).status, 404);
    assert.equal((await bob.post(`/api/schedules/${auto.id}/resume`, {})).status, 404);
    assert.equal((await bob.post(`/api/schedules/${auto.id}/post-next`, {})).status, 404);
    assert.equal((await bob.post(`/api/schedules/${auto.id}/skip-next`, {})).status, 404);
    assert.equal((await bob.post(`/api/schedule-occurrences/${pending.id}/approve`, { amountMinor: -1 })).status, 404);
    assert.equal((await bob.post(`/api/schedule-occurrences/${pending.id}/skip`, {})).status, 404);

    // nothing of Alice's moved
    assert.equal(JSON.stringify((await alice.get('/api/schedules')).data.schedules), before);
    assert.equal((await alice.get('/api/schedule-occurrences?status=pending')).data.occurrences.length, 1);
    assert.equal(userTxCount(s, 1), 1, 'only the salary she entered herself');

    // Bob's own lists are empty, even when he asks for Alice's ids explicitly
    assert.deepEqual((await bob.get('/api/schedules')).data.schedules, []);
    assert.deepEqual((await bob.get('/api/schedule-occurrences?status=all')).data.occurrences, []);
    assert.deepEqual((await bob.get(`/api/schedule-occurrences?status=all&schedule=${waiting.id}`)).data.occurrences, []);
  } finally { await s.close(); }
});

test("bills, the calendar and the forecast only ever contain your own money", async () => {
  const s = await boot();
  try {
    const { alice, bob } = await world(s);
    for (const path of ['/api/bills', '/api/calendar?month=2026-11', '/api/calendar?month=2026-12', '/api/forecast?days=90']) {
      const mine = JSON.stringify((await alice.get(path)).data);
      assert.ok(mine.includes('Alice'), `${path} shows Alice her own items`);
      const theirs = JSON.stringify((await bob.get(path)).data);
      assert.ok(!/Alice|Landlord|Rent/.test(theirs), `${path} shows Bob nothing of Alice's`);
    }
    const f = (await bob.get('/api/forecast?days=90')).data.forecast;
    assert.deepEqual([f.currentFundsMinor, f.upcomingIncomeMinor, f.upcomingExpensesMinor, f.events.length], [0, 0, 0, 0]);
    assert.equal((await alice.get('/api/forecast?days=7')).data.forecast.currentFundsMinor, R(5000));
    const b = (await bob.get('/api/bills')).data;
    assert.deepEqual([b.overdue.length, b.upcoming.length, b.paid.length, b.totals.subscriptionsMonthlyMinor], [0, 0, 0, 0]);

    // Bob's own schedules do not leak into Alice's totals either
    await mk(bob, { name: 'Bob Gym', payee: 'Bob Gym Co', amountMinor: -R(77), startDate: '2026-11-20' });
    const aliceBills = JSON.stringify((await alice.get('/api/bills')).data);
    assert.ok(!aliceBills.includes('Bob'));
    assert.equal((await bob.get('/api/forecast?days=7')).data.forecast.upcomingExpensesMinor, R(77));
  } finally { await s.close(); }
});

test("you cannot point a schedule or a filter at someone else's account or category", async () => {
  const s = await boot();
  try {
    const { alice, bob } = await world(s);
    const mkBad = (over) => bob.post('/api/schedules', { accountId: bob.accountId, amountMinor: -R(1), startDate: '2026-12-01', frequency: 'monthly', payee: 'X', ...over });
    assert.equal((await mkBad({ accountId: alice.accountId })).status, 400);
    assert.equal((await mkBad({ categoryId: alice.cat.Food })).status, 400);
    const mine = await mk(bob, { name: 'Bob thing' });
    assert.equal((await bob.patch(`/api/schedules/${mine.id}`, { accountId: alice.accountId })).status, 400);
    assert.equal((await bob.patch(`/api/schedules/${mine.id}`, { categoryId: alice.cat.Food })).status, 400);
    assert.equal((await bob.get(`/api/forecast?account=${alice.accountId}`)).status, 404);
    assert.equal((await bob.get(`/api/bills?account=${alice.accountId}`)).status, 404);
    assert.equal((await bob.get(`/api/calendar?account=${alice.accountId}`)).status, 404);
    assert.equal(userTxCount(s, 2), 0);
  } finally { await s.close(); }
});

test("running schedules for one user never touches another user's data, and one user's rules never apply to another's", async () => {
  const s = await boot();
  try {
    const { alice, bob } = await world(s);
    await alice.post('/api/rules', { name: 'alice rule', conditions: [{ type: 'description_contains', value: 'streaming' }],
      actions: [{ type: 'set_category', categoryId: alice.cat.Travel }, { type: 'add_note', text: 'ALICE-RULE' }] });
    await mk(bob, { name: 'Bob streaming', payee: 'Bob Streaming', mode: 'auto', startDate: '2026-12-01', categoryId: bob.cat.Food });
    setToday(s, '2026-12-02');
    // Bob acts first: only Bob's schedule is handled
    assert.equal((await bob.post('/api/schedules/run', {})).data.generated.posted, 1);
    assert.equal(userTxCount(s, 1), 1, "Alice's auto schedule has not run (she has not asked)");
    assert.equal(userTxCount(s, 2), 1);
    const bobTx = (await bob.get('/api/transactions?month=all')).data.transactions[0];
    assert.deepEqual([bobTx.notes, bobTx.categoryId], ['', bob.cat.Food], "Alice's rule did not touch Bob's transaction");
    // Alice's turn: her rule applies to hers
    assert.equal((await alice.post('/api/schedules/run', {})).data.generated.posted, 1);
    const aliceTx = (await alice.get('/api/transactions?month=all')).data.transactions.find((t) => t.payee === 'Alice Streaming');
    assert.deepEqual([aliceTx.notes, aliceTx.categoryId], ['ALICE-RULE', alice.cat.Travel]);
    assert.equal(userTxCount(s, 2), 1);
  } finally { await s.close(); }
});

test('ids in the request body are ignored: a schedule is always created for the signed-in user', async () => {
  const s = await boot();
  try {
    const { alice, bob } = await world(s);
    const r = await bob.post('/api/schedules', {
      accountId: bob.accountId, amountMinor: -R(5), startDate: '2026-12-01', frequency: 'monthly', payee: 'Mine',
      userId: 1, user_id: 1, id: 1, next_date: '2020-01-01', occ_index: 99, paused: true,
    });
    assert.equal(r.status, 201);
    const row = s.server.db.prepare('SELECT user_id, next_date, occ_index, paused FROM schedules WHERE id = ?').get(r.data.schedule.id);
    assert.deepEqual({ ...row }, { user_id: 2, next_date: '2026-12-01', occ_index: 0, paused: 0 });
    assert.equal((await alice.get('/api/schedules')).data.schedules.length, 3, "nothing was added to Alice's list");
  } finally { await s.close(); }
});

test('writes need the CSRF token and a same-site origin', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const body = { accountId: c.accountId, amountMinor: -R(5), startDate: '2026-12-01', frequency: 'monthly', payee: 'X' };
    const noToken = await c.json('/api/schedules', { method: 'POST', body, csrf: false });
    assert.equal(noToken.status, 403);
    const foreign = await c.json('/api/schedules', { method: 'POST', body, headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    assert.equal((await c.get('/api/schedules')).data.schedules.length, 0);
    assert.equal((await c.json('/api/schedules', { method: 'POST', body })).status, 201);
  } finally { await s.close(); }
});

test('odd input is stored as text and ids that are not numbers are just not found', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const nasty = `"; DROP TABLE schedules; -- <script>alert(1)</script>`;
    const x = await mk(c, { name: nasty.slice(0, 60), payee: nasty.slice(0, 60), notes: nasty });
    assert.equal(x.name, nasty.slice(0, 60));
    assert.equal(x.notes, nasty);
    assert.equal((await c.get('/api/schedules')).data.schedules.length, 1, 'the table is still there');
    for (const id of ['abc', '1;DROP', '-1', '0', '1e3', '99999999999999999999']) {
      assert.equal((await c.get(`/api/schedules/${encodeURIComponent(id)}`)).status, 404, id);
      assert.equal((await c.post(`/api/schedule-occurrences/${encodeURIComponent(id)}/approve`, {})).status, 404, id);
    }
    assert.equal((await c.post('/api/schedules', { ...x, accountId: c.accountId, startDate: '2026-12-01', amountMinor: null })).status, 400);
    const raw = await c.json('/api/schedules', { method: 'POST', rawBody: '{not json' });
    assert.equal(raw.status, 400);
    const arr = await c.json('/api/schedules', { method: 'POST', rawBody: '[1,2]' });
    assert.equal(arr.status, 400);
  } finally { await s.close(); }
});

test('a user is limited to 500 schedules', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const db = s.server.db;
    const ins = db.prepare(`INSERT INTO schedules (user_id, name, account_id, amount_minor, frequency, start_date, next_date)
      VALUES (1, ?, ?, -100, 'monthly', '2030-01-01', '2030-01-01')`);
    for (let i = 0; i < 500; i++) ins.run(`s${i}`, c.accountId);
    const r = await c.post('/api/schedules', { accountId: c.accountId, amountMinor: -R(5), startDate: '2030-01-01', frequency: 'monthly', payee: 'X' });
    assert.equal(r.status, 409);
    assert.match(r.data.error, /500/);
  } finally { await s.close(); }
});
