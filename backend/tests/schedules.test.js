'use strict';
// Phase 6: scheduled and recurring transactions. Amounts are paise; R(n) = n rupees.
// "Today" is pinned to 2026-11-15 and moved with server.clock.fixed, so none of this depends on the real date.
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, newUser, Client } = require('./helpers');

const R = (n) => n * 100;
const TODAY = '2026-11-15';

const boot = async (today = TODAY) => {
  const s = await start({ TODAY: today });
  return s;
};
const setToday = (s, d) => { s.server.clock.fixed = d; };

const mk = async (c, over = {}) => {
  const r = await c.post('/api/schedules', {
    accountId: c.accountId, payee: 'Netflix', categoryId: c.cat.Bills, amountMinor: -R(649),
    startDate: '2026-12-01', frequency: 'monthly', mode: 'auto', ...over,
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
};
const run = async (c) => (await c.post('/api/schedules/run', {})).data.generated;
const allTx = async (c, qs = '') => (await c.get('/api/transactions?month=all&limit=500' + qs)).data.transactions;
const txDates = async (c) => (await allTx(c)).map((t) => t.date).sort();
const sched = async (c, id) => (await c.get(`/api/schedules/${id}`)).data.schedule;
const occs = async (c, status = 'all') => (await c.get(`/api/schedule-occurrences?status=${status}`)).data.occurrences;

/* --------------------------------- creating --------------------------------- */

test('create a schedule: every field is stored and the response shows the next date', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const out = await mk(c, { name: 'Netflix HD', notes: 'family plan', cleared: true, mode: 'approval' });
    const x = out.schedule;
    assert.equal(x.name, 'Netflix HD');
    assert.equal(x.accountId, c.accountId);
    assert.equal(x.payee, 'Netflix');
    assert.equal(x.categoryId, c.cat.Bills);
    assert.equal(x.amountMinor, -R(649));
    assert.equal(x.kind, 'expense');
    assert.equal(x.notes, 'family plan');
    assert.equal(x.cleared, true);
    assert.equal(x.mode, 'approval');
    assert.equal(x.frequency, 'monthly');
    assert.equal(x.frequencyLabel, 'Monthly');
    assert.equal(x.startDate, '2026-12-01');
    assert.equal(x.nextDate, '2026-12-01');
    assert.equal(x.status, 'active');
    assert.equal(x.monthlyEquivalentMinor, R(649));
    assert.deepEqual(out.generated, { posted: 0, pending: 0, duplicates: 0, more: false }, 'a future schedule creates nothing yet');
    assert.equal((await allTx(c)).length, 0);

    // the name falls back to the payee, and income schedules are allowed
    const sal = (await mk(c, { name: undefined, payee: 'Acme Ltd', amountMinor: R(50000), categoryId: c.cat.Salary, mode: 'approval' })).schedule;
    assert.equal(sal.name, 'Acme Ltd');
    assert.equal(sal.kind, 'income');

    const list = (await c.get('/api/schedules')).data.schedules;
    assert.equal(list.length, 2);
    assert.equal((await c.get('/api/schedules?status=paused')).data.schedules.length, 0);
    assert.equal((await c.get('/api/schedules?status=bogus')).status, 400);
  } finally { await s.close(); }
});

test('a schedule is validated: account, category, amount, dates, repeat rule and mode', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const other = await newUser(s.base, 'b@example.com');
    const base = { accountId: c.accountId, payee: 'X', amountMinor: -R(10), startDate: '2026-12-01', frequency: 'monthly' };
    const bad = async (over, why, re) => {
      const r = await c.post('/api/schedules', { ...base, ...over });
      assert.equal(r.status, 400, `${why}: ${JSON.stringify(r.data)}`);
      if (re) assert.match(r.data.error, re, why);
    };
    await bad({ accountId: undefined }, 'no account');
    await bad({ accountId: other.accountId }, "someone else's account", /account does not exist/);
    await bad({ accountId: 999999 }, 'unknown account');
    await bad({ categoryId: other.cat.Food }, "someone else's category", /category does not exist/);
    await bad({ amountMinor: 0 }, 'zero amount');
    await bad({ amountMinor: 12.5 }, 'fractional paise');
    await bad({ amountMinor: '100' }, 'text amount');
    await bad({ startDate: '2026-02-30' }, 'impossible date', /real date/);
    await bad({ startDate: undefined }, 'no start date');
    await bad({ endDate: '2026-11-30' }, 'end before start', /end date cannot be before/);
    await bad({ frequency: 'fortnightly' }, 'unknown frequency', /frequency must be/);
    await bad({ frequency: 'custom' }, 'custom without an interval', /custom interval/);
    await bad({ frequency: 'custom', interval: 0, unit: 'day' }, 'zero interval');
    await bad({ frequency: 'custom', interval: 3, unit: 'fortnight' }, 'unknown unit');
    await bad({ mode: 'whenever' }, 'unknown mode', /mode must be/);
    await bad({ notes: 'x'.repeat(201) }, 'long notes');
    await bad({ payee: 'x'.repeat(61) }, 'long payee');
    await bad({ payee: '', name: undefined }, 'no name and no payee', /name or a payee/);
    const closed = (await c.post('/api/accounts', { name: 'Old', openingBalanceMinor: 0 })).data.account;
    await c.patch(`/api/accounts/${closed.id}`, { closed: true });
    await bad({ accountId: closed.id }, 'closed account', /closed/);
    assert.equal((await c.get('/api/schedules')).data.schedules.length, 0, 'nothing half-created');
    assert.equal((await c.get('/api/payees?status=all')).data.payees.length, 0, 'a rejected schedule leaves no payee behind');
  } finally { await s.close(); }
});

test('edit a schedule: fields change, the next date stays, and bad edits are rejected', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const id = (await mk(c, { mode: 'approval' })).schedule.id;
    const r = await c.patch(`/api/schedules/${id}`, { amountMinor: -R(799), notes: 'price rise', mode: 'auto', cleared: true, name: 'Netflix 4K', categoryId: c.cat.Food, payee: 'Netflix Inc' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const x = r.data.schedule;
    assert.deepEqual([x.amountMinor, x.notes, x.mode, x.cleared, x.name, x.categoryId, x.payee, x.nextDate],
      [-R(799), 'price rise', 'auto', true, 'Netflix 4K', c.cat.Food, 'Netflix Inc', '2026-12-01']);
    // clearing the payee and the category
    const y = (await c.patch(`/api/schedules/${id}`, { payee: '', categoryId: null })).data.schedule;
    assert.deepEqual([y.payee, y.categoryId], ['', null]);
    for (const [body, re] of [
      [{ amountMinor: 0 }, /zero/], [{ frequency: 'nope' }, /frequency/], [{ endDate: '2026-01-01' }, /end date/],
      [{ mode: 'x' }, /mode/], [{ name: '' }, /Name is required/], [{ startDate: 'tomorrow' }, /Start date/],
    ]) {
      const bad = await c.patch(`/api/schedules/${id}`, body);
      assert.equal(bad.status, 400, JSON.stringify(body));
      assert.match(bad.data.error, re);
    }
    assert.equal((await c.patch('/api/schedules/999999', { notes: 'x' })).status, 404);
    assert.equal((await c.patch('/api/schedules/abc', { notes: 'x' })).status, 404);
  } finally { await s.close(); }
});

test('delete a schedule: the rule and its queue go, the transactions it already created stay', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const id = (await mk(c, { startDate: '2026-11-01' })).schedule.id;           // auto: one transaction on creation
    await mk(c, { startDate: '2026-11-10', mode: 'approval', payee: 'Rent', name: 'Rent' });
    assert.equal((await allTx(c)).length, 1);
    assert.equal((await occs(c)).length, 2);
    assert.equal((await c.del(`/api/schedules/${id}`)).status, 200);
    assert.equal((await c.get(`/api/schedules/${id}`)).status, 404);
    assert.equal((await allTx(c)).length, 1, 'the transaction it created is an ordinary transaction now');
    assert.equal((await occs(c)).length, 1, 'only the other schedule is left in the queue');
    assert.equal((await c.del(`/api/schedules/${id}`)).status, 404);
  } finally { await s.close(); }
});

/* --------------------------------- recurrence, end to end --------------------------------- */

test('monthly recurrence on the 31st: every month is created on the right day (no drift to the 28th)', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const out = await mk(c, { startDate: '2026-01-31', payee: 'Rent' });
    assert.equal(out.generated.posted, 10);
    assert.deepEqual(await txDates(c), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
      '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31']);
    assert.equal((await sched(c, out.schedule.id)).nextDate, '2026-11-30');
    setToday(s, '2026-11-30');
    assert.equal((await run(c)).posted, 1);
    assert.equal((await sched(c, out.schedule.id)).nextDate, '2026-12-31');
  } finally { await s.close(); }
});

test('yearly recurrence: a Feb 29 start is created on Feb 28 in common years and Feb 29 in leap years', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const out = await mk(c, { startDate: '2024-02-29', frequency: 'yearly', payee: 'Insurance', amountMinor: -R(12000) });
    assert.deepEqual(await txDates(c), ['2024-02-29', '2025-02-28', '2026-02-28']);
    assert.equal(out.schedule.nextDate, '2027-02-28');
    assert.equal(out.schedule.monthlyEquivalentMinor, R(1000));
    setToday(s, '2028-03-01');
    await run(c);
    assert.deepEqual((await txDates(c)).slice(-2), ['2027-02-28', '2028-02-29']);
  } finally { await s.close(); }
});

test('daily, weekly, quarterly and custom intervals each create exactly the due dates', async () => {
  const s = await boot();
  try {
    const cases = [
      [{ frequency: 'daily', startDate: '2026-11-11' }, ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], '2026-11-16'],
      [{ frequency: 'weekly', startDate: '2026-10-31' }, ['2026-10-31', '2026-11-07', '2026-11-14'], '2026-11-21'],
      [{ frequency: 'quarterly', startDate: '2026-02-15' }, ['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15'], '2027-02-15'],
      [{ frequency: 'custom', interval: 10, unit: 'day', startDate: '2026-10-20' }, ['2026-10-20', '2026-10-30', '2026-11-09'], '2026-11-19'],
      [{ frequency: 'custom', interval: 2, unit: 'month', startDate: '2026-05-10' }, ['2026-05-10', '2026-07-10', '2026-09-10', '2026-11-10'], '2027-01-10'],
      [{ frequency: 'custom', interval: 2, unit: 'week', startDate: '2026-11-01' }, ['2026-11-01', '2026-11-15'], '2026-11-29'],
      [{ frequency: 'once', startDate: '2026-11-03' }, ['2026-11-03'], null],
    ];
    for (const [over, expected, next] of cases) {
      const c = await newUser(s.base, `u${Math.random().toString(36).slice(2, 8)}@example.com`);
      const out = await mk(c, over);
      assert.deepEqual(await txDates(c), expected, JSON.stringify(over));
      assert.equal(out.schedule.nextDate, next, JSON.stringify(over));
      assert.equal(out.schedule.status, next === null ? 'finished' : 'active');
    }
  } finally { await s.close(); }
});

test('a schedule ends on its end date (inclusive) and a one-time schedule runs once', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const out = await mk(c, { startDate: '2026-12-01', endDate: '2027-02-01' });
    setToday(s, '2027-06-01');
    assert.equal((await run(c)).posted, 3, 'Dec 1, Jan 1 and Feb 1: the end date is included');
    assert.equal((await sched(c, out.schedule.id)).status, 'finished');
    assert.equal((await run(c)).posted, 0);

    // extending the end date brings it back to life
    const back = (await c.patch(`/api/schedules/${out.schedule.id}`, { endDate: '2027-12-31' })).data;
    assert.equal(back.schedule.status, 'active');
    assert.equal(back.generated.posted, 1, 'Jun 1 is due today');
    assert.deepEqual((await txDates(c)).slice(-2), ['2027-02-01', '2027-06-01'], 'Mar to May were not back-filled');
    assert.equal(back.schedule.nextDate, '2027-07-01');
  } finally { await s.close(); }
});

/* --------------------------------- execution: auto and approval --------------------------------- */

test('auto mode creates a real transaction with the schedule\'s account, payee, category, notes, amount and cleared status', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await mk(c, { startDate: '2026-11-15', notes: 'family plan', cleared: true });
    const t = (await allTx(c))[0];
    assert.deepEqual([t.date, t.amountMinor, t.payee, t.categoryId, t.notes, t.cleared, t.accountId],
      ['2026-11-15', -R(649), 'Netflix', c.cat.Bills, 'family plan', true, c.accountId]);
    const o = (await occs(c, 'posted'))[0];
    assert.equal(o.transactionId, t.id);
    assert.equal(o.status, 'posted');
    // it really counts: Total Funds moved
    assert.equal((await c.get('/api/transactions?month=all')).data.summary.totalFundsMinor, -R(649));
  } finally { await s.close(); }
});

test('approval mode queues the occurrence and touches nothing until you approve; approve takes the real amount and date', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const id = (await mk(c, { startDate: '2026-11-10', mode: 'approval', payee: 'Electricity', amountMinor: -R(2000) })).schedule.id;
    assert.equal((await allTx(c)).length, 0, 'nothing is posted without approval');
    const q = await occs(c, 'pending');
    assert.equal(q.length, 1);
    assert.deepEqual([q[0].dueDate, q[0].amountMinor, q[0].overdue, q[0].status], ['2026-11-10', -R(2000), true, 'pending']);
    assert.equal((await sched(c, id)).pendingCount, 1);
    assert.equal((await sched(c, id)).nextDate, '2026-12-10', 'the schedule moves on; the queue holds the bill');

    const a = await c.post(`/api/schedule-occurrences/${q[0].id}/approve`, { amountMinor: -R(2345), date: '2026-11-12', notes: 'Oct bill' });
    assert.equal(a.status, 200, JSON.stringify(a.data));
    const t = (await allTx(c))[0];
    assert.deepEqual([t.date, t.amountMinor, t.payee, t.notes, t.id], ['2026-11-12', -R(2345), 'Electricity', 'Oct bill', a.data.transactionId]);
    assert.equal(a.data.occurrence.status, 'posted');
    assert.equal(a.data.occurrence.amountMinor, -R(2345), 'the paid amount is remembered');
    assert.equal((await occs(c, 'pending')).length, 0);

    // approving it a second time creates nothing
    assert.equal((await c.post(`/api/schedule-occurrences/${q[0].id}/approve`, {})).status, 409);
    assert.equal((await allTx(c)).length, 1);
    // the amount must keep the schedule's direction
    setToday(s, '2026-12-10');
    await run(c);
    const next = (await occs(c, 'pending'))[0];
    const wrongSign = await c.post(`/api/schedule-occurrences/${next.id}/approve`, { amountMinor: R(5) });
    assert.equal(wrongSign.status, 400);
    assert.equal((await allTx(c)).length, 1);
  } finally { await s.close(); }
});

test('skipping a pending bill creates nothing and cannot be undone by approving it', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await mk(c, { startDate: '2026-11-10', mode: 'approval' });
    const o = (await occs(c, 'pending'))[0];
    const r = await c.post(`/api/schedule-occurrences/${o.id}/skip`, {});
    assert.equal(r.status, 200);
    assert.equal(r.data.occurrence.status, 'skipped');
    assert.equal((await allTx(c)).length, 0);
    assert.equal((await c.post(`/api/schedule-occurrences/${o.id}/skip`, {})).status, 409);
    assert.equal((await c.post(`/api/schedule-occurrences/${o.id}/approve`, {})).status, 409);
    assert.equal((await occs(c, 'skipped')).length, 1);
  } finally { await s.close(); }
});

test('"pay next bill early" creates the transaction now and moves the schedule on; "skip next" skips one cycle', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const id = (await mk(c, { startDate: '2026-12-01', mode: 'approval' })).schedule.id;
    const r = await c.post(`/api/schedules/${id}/post-next`, { amountMinor: -R(700) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.dueDate, '2026-12-01');
    assert.equal(r.data.schedule.nextDate, '2027-01-01');
    const t = (await allTx(c))[0];
    assert.deepEqual([t.date, t.amountMinor], [TODAY, -R(700)], 'dated the day you paid it');
    const o = (await occs(c, 'posted'))[0];
    assert.equal(o.dueDate, '2026-12-01');

    const k = await c.post(`/api/schedules/${id}/skip-next`, {});
    assert.equal(k.status, 200);
    assert.equal(k.data.schedule.nextDate, '2027-02-01');
    assert.equal((await occs(c, 'skipped')).length, 1);
    assert.equal((await allTx(c)).length, 1);
  } finally { await s.close(); }
});

/* --------------------------------- duplicate prevention --------------------------------- */

test('running the schedule again never creates a second transaction for the same date', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await mk(c, { startDate: '2026-11-01' });
    assert.equal((await allTx(c)).length, 1);
    for (let i = 0; i < 4; i++) assert.deepEqual(await run(c), { posted: 0, pending: 0, duplicates: 0, more: false });
    // listing pages and other requests run the catch-up too: still one
    await c.get('/api/schedules'); await c.get('/api/bills'); await c.get('/api/forecast'); await c.get('/api/transactions');
    assert.equal((await allTx(c)).length, 1);
    assert.equal((await occs(c)).length, 1);
  } finally { await s.close(); }
});

test('five simultaneous runs still create each occurrence exactly once', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const out = await mk(c, { startDate: '2026-12-01', frequency: 'weekly' });
    setToday(s, '2026-12-29');                                                    // Dec 1, 8, 15, 22, 29 are due
    await Promise.all([1, 2, 3, 4, 5].map(() => run(c)));
    assert.deepEqual(await txDates(c), ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2026-12-29']);
    assert.equal((await occs(c)).length, 5);
    assert.equal((await sched(c, out.schedule.id)).nextDate, '2027-01-05');
  } finally { await s.close(); }
});

test('the database itself refuses a second occurrence for the same schedule and date', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const id = (await mk(c, { startDate: '2026-11-01' })).schedule.id;
    assert.throws(() => s.server.db.prepare(
      "INSERT INTO schedule_occurrences (user_id, schedule_id, due_date, status, amount_minor) VALUES (1, ?, '2026-11-01', 'pending', -100)").run(id),
    /UNIQUE/);
  } finally { await s.close(); }
});

test('paying a bill early means nothing is created when its date arrives', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const id = (await mk(c, { startDate: '2026-12-01' })).schedule.id;           // auto
    await c.post(`/api/schedules/${id}/post-next`, {});
    assert.equal((await allTx(c)).length, 1);
    setToday(s, '2026-12-01');
    assert.equal((await run(c)).posted, 0, 'Dec 1 was already paid');
    assert.equal((await allTx(c)).length, 1);
    setToday(s, '2027-01-01');
    assert.equal((await run(c)).posted, 1, 'the next one is created normally');
    assert.equal((await allTx(c)).length, 2);
  } finally { await s.close(); }
});

test('changing the repeat so it lands on a date that was already handled does not create it twice', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const id = (await mk(c, { startDate: '2026-12-01' })).schedule.id;
    await c.post(`/api/schedules/${id}/post-next`, {});                           // Dec 1 handled, next = Jan 1
    const r = await c.patch(`/api/schedules/${id}`, { frequency: 'weekly' });    // a new rule from today lands on Dec 1 again
    assert.equal(r.data.schedule.nextDate, '2026-12-01');
    assert.equal((await allTx(c)).length, 1);
    setToday(s, '2026-12-01');
    const g = await run(c);
    assert.deepEqual([g.posted, g.duplicates], [0, 1]);
    assert.equal((await allTx(c)).length, 1, 'still one transaction for Dec 1');
    assert.equal((await sched(c, id)).nextDate, '2026-12-08', 'and the schedule moved on');
  } finally { await s.close(); }
});

test('a long backlog is handled in batches, then finishes', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const out = await mk(c, { startDate: '2025-10-01', frequency: 'daily', mode: 'approval' });      // 411 days are due
    assert.deepEqual([out.generated.pending, out.generated.more], [366, true]);
    const second = await run(c);
    assert.deepEqual([second.pending, second.more], [45, false]);
    assert.equal((await c.get('/api/schedule-occurrences?status=pending&limit=500')).data.occurrences.length, 411);
    assert.equal((await sched(c, out.schedule.id)).nextDate, '2026-11-16');
  } finally { await s.close(); }
});

/* --------------------------------- paused schedules --------------------------------- */

test('a paused schedule creates and queues nothing; resume skips what was missed unless you ask to catch up', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const id = (await mk(c, { startDate: '2026-12-01', frequency: 'weekly' })).schedule.id;
    const p = await c.post(`/api/schedules/${id}/pause`, {});
    assert.equal(p.status, 200);
    assert.deepEqual([p.data.schedule.status, p.data.schedule.paused], ['paused', true]);

    setToday(s, '2026-12-20');                                                    // Dec 1, 8, 15 passed while paused
    assert.deepEqual(await run(c), { posted: 0, pending: 0, duplicates: 0, more: false });
    assert.equal((await allTx(c)).length, 0);
    assert.equal((await occs(c)).length, 0);
    assert.equal((await c.get('/api/schedules?status=paused')).data.schedules.length, 1);
    assert.equal((await c.get('/api/schedules?status=active')).data.schedules.length, 0);
    assert.equal((await c.post(`/api/schedules/${id}/post-next`, {})).status, 409, 'cannot pay a paused schedule');

    const r = await c.post(`/api/schedules/${id}/resume`, {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.skipped, 3);
    assert.equal(r.data.schedule.status, 'active');
    assert.equal(r.data.schedule.nextDate, '2026-12-22', 'carries on from the first date on or after today');
    assert.equal((await allTx(c)).length, 0, 'the missed weeks were not back-billed');

    // pause again, and this time catch up
    await c.post(`/api/schedules/${id}/pause`, {});
    setToday(s, '2027-01-06');                                                    // Dec 22, Dec 29, Jan 5 missed
    const back = await c.post(`/api/schedules/${id}/resume`, { catchUp: true });
    assert.equal(back.data.skipped, 0);
    assert.equal(back.data.generated.posted, 3);
    assert.deepEqual(await txDates(c), ['2026-12-22', '2026-12-29', '2027-01-05']);
  } finally { await s.close(); }
});

test('resuming a paused one-time schedule whose date passed skips it; with catch-up it is created', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const a = (await mk(c, { startDate: '2026-12-01', frequency: 'once' })).schedule.id;
    const b = (await mk(c, { startDate: '2026-12-01', frequency: 'once', payee: 'Other' })).schedule.id;
    await c.post(`/api/schedules/${a}/pause`, {});
    await c.post(`/api/schedules/${b}/pause`, {});
    setToday(s, '2026-12-10');
    const ra = await c.post(`/api/schedules/${a}/resume`, {});
    assert.equal(ra.data.skipped, 1);
    assert.equal(ra.data.schedule.status, 'finished');
    const rb = await c.post(`/api/schedules/${b}/resume`, { catchUp: true });
    assert.equal(rb.data.generated.posted, 1);
    assert.deepEqual(await txDates(c), ['2026-12-01']);
  } finally { await s.close(); }
});

/* --------------------------------- editing the repeat --------------------------------- */

test('changing the repeat applies from today: nothing is back-filled and nothing already handled is repeated', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const id = (await mk(c, { startDate: '2026-01-01' })).schedule.id;           // Jan 1 .. Nov 1: 11 transactions
    assert.equal((await allTx(c)).length, 11);
    const r = await c.patch(`/api/schedules/${id}`, { frequency: 'weekly' });
    assert.equal(r.data.schedule.nextDate, '2026-11-19', 'the first Thursday (Jan 1 + 7n) on or after today');
    assert.equal((await allTx(c)).length, 11);

    const q = await c.patch(`/api/schedules/${id}`, { frequency: 'custom', interval: 3, unit: 'month', startDate: '2026-12-15' });
    assert.equal(q.data.schedule.nextDate, '2026-12-15');
    assert.equal(q.data.schedule.frequencyLabel, 'Every 3 months');
    // editing only the amount does not move the next date
    const m = await c.patch(`/api/schedules/${id}`, { amountMinor: -R(1) });
    assert.equal(m.data.schedule.nextDate, '2026-12-15');
    setToday(s, '2026-12-15');
    await run(c);
    assert.equal((await allTx(c))[0].amountMinor, -R(1), 'the new amount is used from now on');
  } finally { await s.close(); }
});

/* --------------------------------- rules, payees and categories --------------------------------- */

const rule = async (c, conditions, actions, extra = {}) => {
  const r = await c.post('/api/rules', { name: 'r' + Math.random().toString(36).slice(2, 6), conditions, actions, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.rule;
};
const has = (value) => ({ type: 'description_contains', value });

test('auto-generated transactions run through the rules: category, note, cleared and payee rename', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const streaming = (await c.post('/api/payees', { name: 'Streaming Co' })).data.payee;
    await rule(c, [has('netflix')], [{ type: 'set_category', categoryId: c.cat.Shopping }, { type: 'add_note', text: '[sub]' }, { type: 'mark_cleared' }]);
    await rule(c, [has('hotstar')], [{ type: 'set_payee', payeeId: streaming.id }]);
    await mk(c, { payee: 'NETFLIX INDIA', startDate: '2026-11-15', categoryId: c.cat.Bills, notes: 'plan' });
    await mk(c, { payee: 'Hotstar', startDate: '2026-11-15', categoryId: c.cat.Bills });
    const txs = await allTx(c);
    const nf = txs.find((t) => t.payee === 'NETFLIX INDIA');
    assert.deepEqual([nf.categoryId, nf.cleared, nf.notes], [c.cat.Shopping, true, 'plan [sub]'], 'a rule wins over the schedule for the fields it sets');
    const hs = txs.find((t) => t.payee === 'Streaming Co');
    assert.ok(hs, 'the rule renamed the payee on the generated transaction');
    assert.equal(hs.categoryId, c.cat.Bills);
  } finally { await s.close(); }
});

test('approving a pending bill runs the rules too, and says which ones applied', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const r1 = await rule(c, [has('electric')], [{ type: 'set_category', categoryId: c.cat.Bills }, { type: 'add_note', text: 'utilities' }]);
    await mk(c, { payee: 'City Electric', startDate: '2026-11-10', mode: 'approval', categoryId: null });
    const o = (await occs(c, 'pending'))[0];
    const a = await c.post(`/api/schedule-occurrences/${o.id}/approve`, { amountMinor: -R(1800) });
    assert.deepEqual(a.data.rulesApplied.map((x) => x.id), [r1.id]);
    const t = (await allTx(c))[0];
    assert.deepEqual([t.categoryId, t.notes, t.amountMinor], [c.cat.Bills, 'utilities', -R(1800)], 'rules see the amount you actually paid');
  } finally { await s.close(); }
});

test('rule conditions can use the generated amount and account', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await rule(c, [{ type: 'amount_gt', valueMinor: R(5000), direction: 'expense' }], [{ type: 'add_note', text: 'big' }]);
    await mk(c, { payee: 'Rent', startDate: '2026-11-15', amountMinor: -R(20000) });
    await mk(c, { payee: 'Tea', startDate: '2026-11-15', amountMinor: -R(50) });
    const txs = await allTx(c);
    assert.equal(txs.find((t) => t.payee === 'Rent').notes, 'big');
    assert.equal(txs.find((t) => t.payee === 'Tea').notes, '');
  } finally { await s.close(); }
});

test('payee matching: a payee typed in other capitals reuses your payee, and its default category fills a missing category', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await c.post('/api/payees', { name: 'Netflix', defaultCategoryId: c.cat.Food });
    await mk(c, { payee: 'nEtFlIx', categoryId: null, startDate: '2026-11-15' });
    const t = (await allTx(c))[0];
    assert.equal(t.payee, 'Netflix');
    assert.equal(t.categoryId, c.cat.Food, 'the payee default category applies when nothing else set one');
    assert.deepEqual((await c.get('/api/payees?status=all')).data.payees.map((p) => p.name), ['Netflix'], 'no duplicate payee was created');
    // an explicit category on the schedule beats the payee default
    await mk(c, { payee: 'Netflix', categoryId: c.cat.Travel, startDate: '2026-11-15', name: 'second' });
    assert.equal((await allTx(c)).find((x) => x.categoryId === c.cat.Travel).payee, 'Netflix');
  } finally { await s.close(); }
});

test('merging or deleting payees, categories and accounts keeps schedules valid', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const a = (await c.post('/api/payees', { name: 'Old Name' })).data.payee;
    const b = (await c.post('/api/payees', { name: 'New Name' })).data.payee;
    const id = (await mk(c, { payee: 'Old Name' })).schedule.id;

    const del = await c.del(`/api/payees/${a.id}`);
    assert.equal(del.status, 409, 'a payee a schedule uses cannot be deleted');
    assert.match(del.data.error, /schedule/);
    assert.equal((await c.post(`/api/payees/${a.id}/merge`, { targetId: b.id })).status, 200);
    assert.equal((await sched(c, id)).payee, 'New Name', 'the schedule followed the merge');

    const extra = (await c.post('/api/categories', { groupId: c.groupIds['Usual Expenses'], name: 'Subs', icon: '📺' })).data;
    const subs = extra.groups.flatMap((g) => g.categories).find((x) => x.name === 'Subs');
    await c.patch(`/api/schedules/${id}`, { categoryId: subs.id });
    assert.equal((await c.post(`/api/categories/${subs.id}/merge`, { targetId: c.cat.Food })).status, 200);
    assert.equal((await sched(c, id)).categoryId, c.cat.Food, 'the schedule followed the category merge');
    assert.equal((await c.del(`/api/categories/${c.cat.Food}`)).status, 200, 'unused by transactions, so it can be deleted');
    assert.equal((await sched(c, id)).categoryId, null, 'and the schedule is simply uncategorized now');

    const second = (await c.post('/api/accounts', { name: 'Savings' })).data.account;
    await mk(c, { accountId: second.id, name: 'Sweep' });
    const dacc = await c.del(`/api/accounts/${second.id}`);
    assert.equal(dacc.status, 409);
    assert.match(dacc.data.error, /schedule/);
  } finally { await s.close(); }
});

test('an auto schedule on an account that was closed is queued for approval instead of being lost', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    const acc = (await c.post('/api/accounts', { name: 'Old card' })).data.account;
    const id = (await mk(c, { accountId: acc.id, startDate: '2026-12-01' })).schedule.id;
    await c.patch(`/api/accounts/${acc.id}`, { closed: true });
    assert.equal((await sched(c, id)).accountClosed, true);
    setToday(s, '2026-12-01');
    const g = await run(c);
    assert.deepEqual([g.posted, g.pending], [0, 1]);
    const o = (await occs(c, 'pending'))[0];
    assert.match(o.note, /closed/);
    const a = await c.post(`/api/schedule-occurrences/${o.id}/approve`, {});
    assert.equal(a.status, 409);
    assert.match(a.data.error, /closed/);
    // fixing the schedule's account lets the bill be approved
    await c.patch(`/api/schedules/${id}`, { accountId: c.accountId });
    assert.equal((await c.post(`/api/schedule-occurrences/${o.id}/approve`, {})).status, 200);
    assert.equal((await allTx(c)).length, 1);
  } finally { await s.close(); }
});

test('just opening a normal page (like your transactions) brings due schedules up to date', async () => {
  const s = await boot();
  try {
    const c = await newUser(s.base, 'a@example.com');
    await mk(c, { startDate: '2026-12-01' });
    assert.equal((await allTx(c)).length, 0);
    setToday(s, '2026-12-01');                                    // a new day: the next request catches up by itself
    const t = (await c.get('/api/transactions?month=all')).data;
    assert.equal(t.transactions.length, 1);
    assert.equal(t.transactions[0].date, '2026-12-01');
  } finally { await s.close(); }
});

test('the start-up catch-up handles every user whose schedules fell due while the server was off', async () => {
  const s = await boot();
  try {
    const a = await newUser(s.base, 'a@example.com');
    const b = await newUser(s.base, 'b@example.com');
    await mk(a, { startDate: '2026-12-01' });
    await mk(b, { startDate: '2026-12-02', payee: 'Gym' });
    setToday(s, '2026-12-05');
    const { runAllDue } = require('../server/schedules');
    assert.deepEqual(runAllDue(s.server.db, '2026-12-05'), { users: 2, posted: 2, pending: 0 });
    assert.equal((await allTx(a)).length, 1);
    assert.equal((await allTx(b)).length, 1);
    assert.deepEqual(runAllDue(s.server.db, '2026-12-05'), { users: 0, posted: 0, pending: 0 });
  } finally { await s.close(); }
});
