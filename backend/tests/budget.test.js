'use strict';
// Phase 3: envelope budget. Amounts are paise; R(n) = n rupees.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start, Client, newUser, tx } = require('./helpers');
const { MIGRATIONS, openDb } = require('../server/db');

const R = (n) => n * 100;
const bud = async (c, m) => (await c.get(`/api/budget/${m}`)).data;
const assign = (c, m, cat, amt) => c.patch(`/api/budget/${m}/categories/${cat}`, { assignedMinor: amt });
const carry = (c, m, cat, on) => c.patch(`/api/budget/${m}/categories/${cat}`, { carryover: on });
const move = (c, m, from, to, amt, note) => c.post(`/api/budget/${m}/transfers`, { fromCategoryId: from, toCategoryId: to, amountMinor: amt, note });
const cat = (b, id) => b.groups.flatMap((g) => g.categories).find((x) => x.id === id);
const sumAvail = (b) => b.groups.flatMap((g) => g.categories).reduce((n, x) => n + x.availableMinor, 0);
const OCT = '2026-10', NOV = '2026-11', DEC = '2026-12';

/** A user with ₹5,000 of salary on 1 Oct 2026 (Cash account opens at 0). */
async function salaried(s, email = 'b@example.com', salary = R(5000)) {
  const c = await newUser(s.base, email);
  assert.equal((await tx(c, { date: '2026-10-01', amountMinor: salary, payee: 'Employer', categoryId: c.cat.Salary })).status, 201);
  return c;
}

/* ------------------------------ To Budget ------------------------------ */

test('income raises To Budget until it is assigned; expenses do not touch it', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    let b = await bud(c, OCT);
    assert.equal(b.toBudgetMinor, R(5000));
    assert.equal(b.incomeMinor, R(5000));
    assert.equal(sumAvail(b), 0);

    assert.equal((await assign(c, OCT, c.cat.Food, R(1200))).status, 200);
    b = await bud(c, OCT);
    assert.equal(b.toBudgetMinor, R(3800));
    assert.equal(b.assignedMinor, R(1200));
    assert.equal(cat(b, c.cat.Food).availableMinor, R(1200));

    // spending comes out of the envelope, not out of To Budget
    await tx(c, { date: '2026-10-05', amountMinor: -R(300), categoryId: c.cat.Food });
    b = await bud(c, OCT);
    assert.equal(cat(b, c.cat.Food).activityMinor, -R(300));
    assert.equal(cat(b, c.cat.Food).availableMinor, R(900));
    assert.equal(b.toBudgetMinor, R(3800));

    // more income -> more To Budget; a refund into an expense category raises that envelope instead
    await tx(c, { date: '2026-10-09', amountMinor: R(700), payee: 'Side gig', categoryId: null }); // uncategorized income counts as income
    await tx(c, { date: '2026-10-10', amountMinor: R(50), payee: 'Refund', categoryId: c.cat.Food });
    b = await bud(c, OCT);
    assert.equal(b.toBudgetMinor, R(4500));
    assert.equal(cat(b, c.cat.Food).availableMinor, R(950));
  } finally { await s.close(); }
});

test('To Budget + all Available always equals the money in on-budget accounts (uncategorized spending, off-budget accounts, opening balances)', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'inv@example.com');
    await c.patch(`/api/accounts/${c.accountId}`, { openingBalanceMinor: R(1000) });
    const off = (await c.post('/api/accounts', { name: 'Brokerage', type: 'investment', offbudget: true, openingBalanceMinor: R(9000) })).data.account;
    await tx(c, { accountId: off.id, date: '2026-10-02', amountMinor: -R(400), categoryId: c.cat.Food });   // off budget: ignored
    await tx(c, { date: '2026-10-01', amountMinor: R(2000), categoryId: c.cat.Salary });
    await assign(c, OCT, c.cat.Food, R(500));
    const spend = (await tx(c, { date: '2026-10-03', amountMinor: -R(700), categoryId: null })).data.transaction; // no envelope

    let b = await bud(c, OCT);
    assert.equal(b.openingBalanceMinor, R(1000), 'on-budget opening balance only; the brokerage is excluded');
    assert.equal(b.uncategorizedCount, 1);
    assert.equal(b.uncategorizedSpendMinor, R(700));
    assert.equal(b.toBudgetMinor, R(1000) + R(2000) - R(700) - R(500));
    assert.equal(b.toBudgetMinor + sumAvail(b), R(1000) + R(2000) - R(700));       // = on-budget money

    // categorizing the spending moves it from To Budget into that envelope; the total does not change
    await c.patch(`/api/transactions/${spend.id}`, { categoryId: c.cat.Food });
    b = await bud(c, OCT);
    assert.equal(b.uncategorizedCount, 0);
    assert.equal(cat(b, c.cat.Food).availableMinor, R(500) - R(700));
    assert.equal(b.toBudgetMinor, R(1000) + R(2000) - R(500));
    assert.equal(b.toBudgetMinor + sumAvail(b), R(1000) + R(2000) - R(700));
  } finally { await s.close(); }
});

/* --------------------------- over-allocation guard --------------------------- */

test('assigning more than To Budget is refused and changes nothing; lowering is always allowed', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    const r = await assign(c, OCT, c.cat.Food, R(6000));
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Not enough in To Budget/);
    assert.match(r.data.error, /5,000/);
    assert.equal(cat(await bud(c, OCT), c.cat.Food).assignedMinor, 0);

    assert.equal((await assign(c, OCT, c.cat.Food, R(5000))).status, 200);          // exactly all of it
    assert.equal((await bud(c, OCT)).toBudgetMinor, 0);
    assert.equal((await assign(c, OCT, c.cat.Travel, 1)).status, 400);              // one paisa too much
    assert.equal((await assign(c, OCT, c.cat.Food, R(4000))).status, 200);          // lowering is fine
    assert.equal((await bud(c, OCT)).toBudgetMinor, R(1000));
    assert.equal((await assign(c, OCT, c.cat.Food, R(5000) + 1)).status, 400);
    assert.equal((await assign(c, OCT, c.cat.Food, R(4000))).status, 200);          // same value again is a no-op
  } finally { await s.close(); }
});

test('over-allocation is also blocked in a month before the first data, and in later months that would go negative', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    // September has no money at all (the salary arrives in October)
    const early = await assign(c, '2026-09', c.cat.Food, 100);
    assert.equal(early.status, 400);
    assert.match(early.data.error, /Not enough in To Budget/);

    await assign(c, OCT, c.cat.Food, R(4000));                                      // Oct To Budget = 1,000
    assert.equal((await assign(c, DEC, c.cat.Travel, R(800))).status, 200);         // fine: 1,000 rolls into December
    const r = await assign(c, OCT, c.cat.Shopping, R(500));                         // would leave December at -300
    assert.equal(r.status, 400);
    assert.match(r.data.error, /over-allocate December 2026/);
    assert.equal(cat(await bud(c, OCT), c.cat.Shopping).assignedMinor, 0, 'rolled back');
    assert.equal((await assign(c, OCT, c.cat.Shopping, R(200))).status, 200);       // 200 still fits
  } finally { await s.close(); }
});

test('income categories cannot be budgeted; bad input is rejected', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    assert.equal((await assign(c, OCT, c.cat.Salary, R(1))).status, 400);
    for (const m of ['2026-13', 'abc', '1999-12', '2100-01', '2026-1']) assert.equal((await c.get(`/api/budget/${m}`)).status, 400, m);
    assert.equal((await assign(c, OCT, c.cat.Food, 12.5)).status, 400);
    assert.equal((await assign(c, OCT, c.cat.Food, '100')).status, 400);
    assert.equal((await assign(c, OCT, c.cat.Food, Number.MAX_SAFE_INTEGER)).status, 400);
    assert.equal((await c.patch(`/api/budget/${OCT}/categories/${c.cat.Food}`, {})).status, 400);
    assert.equal((await c.patch(`/api/budget/${OCT}/categories/${c.cat.Food}`, { carryover: 'maybe' })).status, 400);
    assert.equal((await assign(c, OCT, 999999, R(1))).status, 404);
  } finally { await s.close(); }
});

/* --------------------------- months and rollover --------------------------- */

test('months are separate, and positive balances roll over (also across empty months)', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Food, R(1000));
    await tx(c, { date: '2026-10-10', amountMinor: -R(300), categoryId: c.cat.Food });

    let b = await bud(c, OCT);
    assert.equal(cat(b, c.cat.Food).availableMinor, R(700));
    assert.equal(b.toBudgetMinor, R(4000));

    // November: nothing assigned yet, but the 700 rolled in and the unassigned 4,000 rolled too
    b = await bud(c, NOV);
    let f = cat(b, c.cat.Food);
    assert.deepEqual([f.carryInMinor, f.assignedMinor, f.activityMinor, f.availableMinor], [R(700), 0, 0, R(700)]);
    assert.equal(b.rolledFromLastMonthMinor, R(4000));
    assert.equal(b.toBudgetMinor, R(4000));
    assert.equal(b.assignedMinor, 0, 'assignments belong to their own month');

    await assign(c, NOV, c.cat.Food, R(200));
    await tx(c, { date: '2026-11-04', amountMinor: -R(50), categoryId: c.cat.Food });
    await tx(c, { date: '2026-11-05', amountMinor: R(1000), categoryId: c.cat.Salary });
    b = await bud(c, NOV);
    f = cat(b, c.cat.Food);
    assert.deepEqual([f.carryInMinor, f.assignedMinor, f.activityMinor, f.availableMinor], [R(700), R(200), -R(50), R(850)]);
    assert.equal(b.toBudgetMinor, R(4000) + R(1000) - R(200));

    // a spending in November does not change October
    b = await bud(c, OCT);
    assert.equal(cat(b, c.cat.Food).availableMinor, R(700));
    assert.equal(b.toBudgetMinor, R(4000));

    // three months later, with nothing in between: everything is still there
    b = await bud(c, '2027-02');
    assert.equal(cat(b, c.cat.Food).availableMinor, R(850));
    assert.equal(cat(b, c.cat.Food).carryInMinor, R(850));
    assert.equal(b.toBudgetMinor, R(4800));
    assert.equal(b.toBudgetMinor + sumAvail(b), R(5000) + R(1000) - R(300) - R(50));
  } finally { await s.close(); }
});

test('month switching gives the same answer in any order and never changes data (pure reads)', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Bills, R(900));
    await tx(c, { date: '2026-11-02', amountMinor: -R(1200), categoryId: c.cat.Bills });
    const first = {};
    for (const m of [OCT, NOV, DEC, '2026-09']) first[m] = await bud(c, m);
    for (const m of [DEC, '2026-09', NOV, OCT, DEC]) assert.deepEqual(await bud(c, m), first[m], `${m} changed between reads`);
    assert.equal(first[OCT].prevMonth, '2026-09');
    assert.equal(first[OCT].nextMonth, NOV);
    assert.equal((await bud(c, '2026-12')).nextMonth, '2027-01');
    assert.equal((await bud(c, '2000-01')).prevMonth, null);
    assert.equal((await bud(c, '2099-12')).nextMonth, null);
  } finally { await s.close(); }
});

/* ------------------------------- overspending ------------------------------- */

test('overspending is detected; by default it is taken out of next month\'s To Budget and the envelope restarts at 0', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Food, R(500));
    await tx(c, { date: '2026-10-10', amountMinor: -R(800), categoryId: c.cat.Food });

    let b = await bud(c, OCT);
    let f = cat(b, c.cat.Food);
    assert.equal(f.availableMinor, -R(300));
    assert.equal(f.overspent, true);
    assert.equal(b.overspentCount, 1);
    assert.equal(b.overspentMinor, R(300));
    assert.equal(b.toBudgetMinor, R(4500), 'overspending does not touch this month\'s To Budget');
    assert.equal(cat(b, c.cat.Travel).overspent, false);

    b = await bud(c, NOV);
    f = cat(b, c.cat.Food);
    assert.deepEqual([f.carryInMinor, f.availableMinor, f.overspent], [0, 0, false]);
    assert.equal(b.overspentLastMonthMinor, R(300));
    assert.equal(b.toBudgetMinor, R(4200));
    assert.equal(b.overspentCount, 0);
    assert.equal(b.toBudgetMinor + sumAvail(b), R(5000) - R(800));
  } finally { await s.close(); }
});

test('"roll over overspending" carries the negative forward instead, and is sticky until changed', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Food, R(500));
    await tx(c, { date: '2026-10-10', amountMinor: -R(800), categoryId: c.cat.Food });
    assert.equal((await carry(c, OCT, c.cat.Food, true)).status, 200);

    let b = await bud(c, NOV);
    let f = cat(b, c.cat.Food);
    assert.deepEqual([f.carryInMinor, f.availableMinor, f.overspent, f.carryover], [-R(300), -R(300), true, true]);
    assert.equal(b.overspentLastMonthMinor, 0);
    assert.equal(b.toBudgetMinor, R(4500));
    assert.equal(b.toBudgetMinor + sumAvail(b), R(4200));

    // more spending in November: the flag set in October still applies, so December carries -400
    await tx(c, { date: '2026-11-03', amountMinor: -R(100), categoryId: c.cat.Food });
    b = await bud(c, DEC);
    f = cat(b, c.cat.Food);
    assert.equal(f.carryInMinor, -R(400));
    assert.equal(b.overspentLastMonthMinor, 0);

    // switching it off in November changes December onwards but leaves October -> November alone
    await carry(c, NOV, c.cat.Food, false);
    assert.equal(cat(await bud(c, NOV), c.cat.Food).carryInMinor, -R(300));
    b = await bud(c, DEC);
    assert.equal(cat(b, c.cat.Food).carryInMinor, 0);
    assert.equal(b.overspentLastMonthMinor, R(400));
    assert.equal(b.toBudgetMinor + sumAvail(b), R(5000) - R(900));
  } finally { await s.close(); }
});

test('covering an overspent envelope with a transfer removes the warning and the deduction', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Food, R(500));
    await assign(c, OCT, c.cat.Travel, R(1000));
    await tx(c, { date: '2026-10-10', amountMinor: -R(800), categoryId: c.cat.Food });
    assert.equal((await bud(c, OCT)).overspentCount, 1);

    assert.equal((await move(c, OCT, c.cat.Travel, c.cat.Food, R(300), 'cover food')).status, 201);
    const b = await bud(c, OCT);
    assert.equal(cat(b, c.cat.Food).availableMinor, 0);
    assert.equal(cat(b, c.cat.Travel).availableMinor, R(700));
    assert.equal(b.overspentCount, 0);
    assert.equal((await bud(c, NOV)).overspentLastMonthMinor, 0);
  } finally { await s.close(); }
});

/* ----------------------------- category transfers ----------------------------- */

test('transfer moves money between envelopes, leaves To Budget alone, and writes a full audit row', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Food, R(1000));
    await assign(c, OCT, c.cat.Travel, R(200));
    await tx(c, { date: '2026-10-04', amountMinor: -R(100), categoryId: c.cat.Food });
    const before = await bud(c, OCT);

    const r = await move(c, OCT, c.cat.Food, c.cat.Travel, R(400), 'trip');
    assert.equal(r.status, 201);
    const b = r.data.budget;
    assert.equal(cat(b, c.cat.Food).assignedMinor, R(600));
    assert.equal(cat(b, c.cat.Food).availableMinor, R(500));
    assert.equal(cat(b, c.cat.Travel).assignedMinor, R(600));
    assert.equal(cat(b, c.cat.Travel).availableMinor, R(600));
    assert.equal(b.toBudgetMinor, before.toBudgetMinor);
    assert.equal(b.assignedMinor, before.assignedMinor);

    const { transfers } = (await c.get('/api/budget-transfers')).data;
    assert.equal(transfers.length, 1);
    assert.deepEqual(
      (({ id, createdAt, ...rest }) => rest)(transfers[0]),
      {
        month: OCT, fromCategoryId: c.cat.Food, toCategoryId: c.cat.Travel, fromName: 'Food', toName: 'Travel', amountMinor: R(400),
        fromAvailableBeforeMinor: R(900), fromAvailableAfterMinor: R(500), toAvailableBeforeMinor: R(200), toAvailableAfterMinor: R(600), note: 'trip',
      });
    assert.match(transfers[0].createdAt, /^\d{4}-\d\d-\d\dT/);
    assert.equal(r.data.transferId, transfers[0].id);
  } finally { await s.close(); }
});

test('transfer rules: cannot move more than is available, same category, income categories, zero, or fractions; nothing is written on failure', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Food, R(100));
    const snap = JSON.stringify(await bud(c, OCT));
    const bad = async (body, status = 400) => assert.equal((await c.post(`/api/budget/${OCT}/transfers`, body)).status, status, JSON.stringify(body));
    const r = await move(c, OCT, c.cat.Food, c.cat.Travel, R(100) + 1);
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Only .*100 is available in Food/);
    assert.equal((await move(c, OCT, c.cat.Travel, c.cat.Food, R(1))).data.error, 'Travel has nothing available to move.');
    await bad({ fromCategoryId: c.cat.Food, toCategoryId: c.cat.Food, amountMinor: R(1) });
    await bad({ fromCategoryId: c.cat.Food, toCategoryId: c.cat.Salary, amountMinor: R(1) });
    await bad({ fromCategoryId: c.cat.Salary, toCategoryId: c.cat.Food, amountMinor: R(1) });
    await bad({ fromCategoryId: c.cat.Food, toCategoryId: c.cat.Travel, amountMinor: 0 });
    await bad({ fromCategoryId: c.cat.Food, toCategoryId: c.cat.Travel, amountMinor: -R(1) });
    await bad({ fromCategoryId: c.cat.Food, toCategoryId: c.cat.Travel, amountMinor: 1.5 });
    await bad({ fromCategoryId: c.cat.Food, toCategoryId: 987654, amountMinor: R(1) }, 404);
    await bad({ fromCategoryId: c.cat.Food, toCategoryId: c.cat.Travel, amountMinor: R(1), note: 'x'.repeat(201) });
    assert.equal(JSON.stringify(await bud(c, OCT)), snap, 'failed transfers must not change the budget');
    assert.equal((await c.get('/api/budget-transfers')).data.transfers.length, 0, 'and must not leave an audit row');
  } finally { await s.close(); }
});

test('moving a rolled-over balance works (assigned goes negative) and later months follow', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Food, R(700));
    // In November Food has 700 carried in and 0 assigned; move 500 of it to Travel
    assert.equal((await move(c, NOV, c.cat.Food, c.cat.Travel, R(500))).status, 201);
    let b = await bud(c, NOV);
    assert.equal(cat(b, c.cat.Food).assignedMinor, -R(500));
    assert.equal(cat(b, c.cat.Food).availableMinor, R(200));
    assert.equal(cat(b, c.cat.Travel).availableMinor, R(500));
    b = await bud(c, DEC);
    assert.equal(cat(b, c.cat.Food).availableMinor, R(200));
    assert.equal(cat(b, c.cat.Travel).availableMinor, R(500));
    assert.equal(b.toBudgetMinor + sumAvail(b), R(5000));
    assert.equal((await move(c, NOV, c.cat.Food, c.cat.Travel, R(201))).status, 400);
  } finally { await s.close(); }
});

test('transfer history: newest first, filterable by month, and it survives renames and deletions', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Food, R(900));
    await assign(c, NOV, c.cat.Food, R(100));
    await move(c, OCT, c.cat.Food, c.cat.Travel, R(100), 'one');
    await move(c, OCT, c.cat.Food, c.cat.Shopping, R(200), 'two');
    await move(c, NOV, c.cat.Food, c.cat.Bills, R(50), 'three');
    const all = (await c.get('/api/budget-transfers')).data.transfers;
    assert.deepEqual(all.map((t) => t.note), ['three', 'two', 'one']);
    assert.deepEqual((await c.get(`/api/budget-transfers?month=${OCT}`)).data.transfers.map((t) => t.note), ['two', 'one']);
    assert.equal((await c.get('/api/budget-transfers?month=nope')).status, 400);

    await c.patch(`/api/categories/${c.cat.Travel}`, { name: 'Trips' });
    const del = await c.del(`/api/categories/${c.cat.Shopping}?moveTo=none`);
    assert.equal(del.status, 200);
    const after = (await c.get('/api/budget-transfers')).data.transfers;
    const one = after.find((t) => t.note === 'one'), two = after.find((t) => t.note === 'two');
    assert.equal(one.toName, 'Travel', 'the name at the time is kept');
    assert.equal(one.toCategoryId, c.cat.Travel);
    assert.equal(two.toName, 'Shopping');
    assert.equal(two.toCategoryId, null, 'deleted category: id cleared, name kept');
    assert.equal(two.amountMinor, R(200));
  } finally { await s.close(); }
});

/* ------------------------- categories, merge, delete ------------------------- */

test('merging or deleting-with-move keeps the assigned money; deleting without a target returns it to To Budget', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await assign(c, OCT, c.cat.Food, R(600));
    await assign(c, OCT, c.cat.Shopping, R(300));
    await assign(c, OCT, c.cat.Bills, R(250));
    assert.equal((await bud(c, OCT)).toBudgetMinor, R(3850));

    assert.equal((await c.post(`/api/categories/${c.cat.Food}/merge`, { targetId: c.cat.Shopping })).status, 200);
    let b = await bud(c, OCT);
    assert.equal(cat(b, c.cat.Shopping).assignedMinor, R(900));
    assert.equal(cat(b, c.cat.Food), undefined);
    assert.equal(b.toBudgetMinor, R(3850));

    assert.equal((await c.del(`/api/categories/${c.cat.Bills}?moveTo=${c.cat.Other}`)).status, 200);
    b = await bud(c, OCT);
    assert.equal(cat(b, c.cat.Other).assignedMinor, R(250));
    assert.equal(b.toBudgetMinor, R(3850));

    assert.equal((await c.del(`/api/categories/${c.cat.Shopping}?moveTo=none`)).status, 200);
    b = await bud(c, OCT);
    assert.equal(b.toBudgetMinor, R(3850) + R(900), 'unspent assigned money returns to To Budget');
  } finally { await s.close(); }
});

test('new categories and groups show up at once; renames keep history; hidden envelopes still count', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    const g = (await c.post('/api/category-groups', { name: 'Fun' })).data.groups.find((x) => x.name === 'Fun');
    const made = (await c.post('/api/categories', { groupId: g.id, name: 'Movies' })).data.groups.find((x) => x.id === g.id).categories[0];
    await assign(c, OCT, made.id, R(250));
    await tx(c, { date: '2026-10-12', amountMinor: -R(100), categoryId: made.id });
    let b = await bud(c, OCT);
    assert.ok(b.groups.find((x) => x.name === 'Fun'));
    assert.equal(cat(b, made.id).availableMinor, R(150));

    await c.patch(`/api/categories/${made.id}`, { name: 'Cinema' });
    b = await bud(c, OCT);
    assert.equal(cat(b, made.id).name, 'Cinema');
    assert.equal(cat(b, made.id).availableMinor, R(150));

    await c.patch(`/api/categories/${made.id}`, { hidden: true });
    b = await bud(c, OCT);
    assert.equal(cat(b, made.id).hidden, true);
    assert.equal(b.toBudgetMinor + sumAvail(b), R(5000) - R(100), 'hidden envelopes are still part of the totals');

    // income groups are not part of the budget grid
    assert.equal(b.groups.some((x) => x.name === 'Income'), false);
  } finally { await s.close(); }
});

test('group reorder: needs every group exactly once; the budget follows the new order', async () => {
  const s = await start();
  try {
    const c = await salaried(s);
    await c.post('/api/category-groups', { name: 'Fun' });
    await c.post('/api/category-groups', { name: 'Savings' });
    const groups = (await c.get('/api/categories')).data.groups;
    const ids = groups.map((g) => g.id);
    const reversed = [...ids].reverse();
    const r = await c.post('/api/category-groups/reorder', { ids: reversed });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.groups.map((g) => g.id), reversed);
    assert.deepEqual((await bud(c, OCT)).groups.map((g) => g.id), reversed.filter((id) => !groups.find((g) => g.id === id).isIncome));
    for (const bad of [[], ids.slice(1), [...ids, ids[0]], [ids[0], ids[0], ids[1], ids[2]], [...ids.slice(1), 987654], 'x']) {
      assert.equal((await c.post('/api/category-groups/reorder', { ids: bad })).status, 400, JSON.stringify(bad));
    }
    const other = await newUser(s.base, 'o@example.com');
    assert.equal((await other.post('/api/category-groups/reorder', { ids })).status, 400, 'someone else\'s group ids are refused');
  } finally { await s.close(); }
});

/* ----------------------------- multi-user isolation ----------------------------- */

test('users never see or touch each other\'s budget, assignments, transfers or history', async () => {
  const s = await start();
  try {
    const a = await salaried(s, 'a@example.com');
    const b = await salaried(s, 'b2@example.com', R(100));
    await assign(a, OCT, a.cat.Food, R(1000));
    await assign(b, OCT, b.cat.Food, R(40));
    await move(a, OCT, a.cat.Food, a.cat.Travel, R(300), 'A private note');
    // Rows with no category carry no category id to filter on, so they are the ones that would leak first.
    await tx(b, { date: '2026-10-03', amountMinor: R(777), categoryId: null });
    await tx(b, { date: '2026-10-04', amountMinor: -R(11), categoryId: null });
    await b.patch(`/api/accounts/${b.accountId}`, { openingBalanceMinor: R(333) });

    // B only ever sees B's numbers
    const vb = await bud(b, OCT);
    assert.equal(vb.incomeMinor, R(100) + R(777));
    assert.equal(vb.uncategorizedCount, 1);
    assert.equal(vb.openingBalanceMinor, R(333));
    assert.equal(vb.toBudgetMinor, R(333) + R(100) + R(777) - R(11) - R(40));
    assert.equal(JSON.stringify(vb).includes('A private note'), false);
    assert.deepEqual((await b.get('/api/budget-transfers')).data.transfers, []);

    // B cannot use A's category ids to assign, carry or transfer
    assert.equal((await assign(b, OCT, a.cat.Food, R(1))).status, 404);
    assert.equal((await carry(b, OCT, a.cat.Food, true)).status, 404);
    assert.equal((await move(b, OCT, a.cat.Food, b.cat.Food, R(1))).status, 404);
    assert.equal((await move(b, OCT, b.cat.Food, a.cat.Travel, R(1))).status, 404);

    // ...and none of that changed A
    const va = await bud(a, OCT);
    assert.equal(cat(va, a.cat.Food).assignedMinor, R(700));
    assert.equal(cat(va, a.cat.Travel).assignedMinor, R(300));
    assert.equal(va.toBudgetMinor, R(4000));
    assert.equal(va.uncategorizedCount, 0, 'B\'s uncategorized rows are not A\'s');
    assert.equal(va.openingBalanceMinor, 0, 'B\'s opening balance is not A\'s');
    assert.equal((await a.get('/api/budget-transfers')).data.transfers.length, 1);

    // same category ids can exist for both users, so only user_id keeps them apart: assignments must not leak across
    assert.equal(cat(await bud(b, OCT), b.cat.Food).assignedMinor, R(40));
  } finally { await s.close(); }
});

test('budget endpoints need a login and a CSRF token on writes', async () => {
  const s = await start();
  try {
    const anon = new Client(s.base);
    assert.equal((await anon.get(`/api/budget/${OCT}`)).status, 401);
    assert.equal((await anon.get('/api/budget-transfers')).status, 401);
    assert.equal((await anon.patch(`/api/budget/${OCT}/categories/1`, { assignedMinor: 1 })).status, 401);
    const c = await salaried(s);
    const noToken = await c.req(`/api/budget/${OCT}/categories/${c.cat.Food}`, { method: 'PATCH', csrf: false, body: { assignedMinor: R(1) } });
    assert.equal(noToken.status, 403);
    assert.equal(cat(await bud(c, OCT), c.cat.Food).assignedMinor, 0);
  } finally { await s.close(); }
});

/* ----------------------------- upgrade from Phase 2 ----------------------------- */

test('a Phase 2 database upgrades in place: data kept, budget works at once', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sw-p3-')), 'old.db');
  const { DatabaseSync } = require('node:sqlite');
  const old = new DatabaseSync(file);
  old.exec('PRAGMA foreign_keys = ON');
  old.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  old.exec(MIGRATIONS[0].sql); old.exec(MIGRATIONS[1].sql);
  old.prepare('INSERT INTO schema_migrations(id, name) VALUES (1, ?), (2, ?)').run(MIGRATIONS[0].name, MIGRATIONS[1].name);
  old.prepare("INSERT INTO users (email, display_name, password_hash) VALUES ('old@example.com', 'Old', 'x')").run();
  require('../server/seed').seedUser(old, 1);
  const food = old.prepare("SELECT id FROM categories WHERE name = 'Food'").get().id;
  const sal = old.prepare("SELECT id FROM categories WHERE name = 'Salary'").get().id;
  old.prepare("UPDATE accounts SET opening_balance_minor = 100000 WHERE user_id = 1").run();
  old.prepare("INSERT INTO transactions (user_id, account_id, date, amount_minor, category_id) VALUES (1, 1, '2026-10-02', 500000, ?)").run(sal);
  old.prepare("INSERT INTO transactions (user_id, account_id, date, amount_minor, category_id) VALUES (1, 1, '2026-10-03', -20000, ?)").run(food);
  old.close();

  const db = openDb(file);
  try {
    assert.deepEqual(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id), MIGRATIONS.map((m) => m.id));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 2);
    const B = require('../server/budget');
    const v = B.monthView(db, 1, OCT);
    assert.equal(v.toBudgetMinor, 100000 + 500000);                       // opening balance + salary, nothing assigned yet
    const f = v.groups.flatMap((g) => g.categories).find((x) => x.id === Number(food));
    assert.deepEqual([f.assignedMinor, f.activityMinor, f.availableMinor], [0, -20000, -20000]);
    assert.equal(v.toBudgetMinor + v.availableMinor, 100000 + 500000 - 20000);
  } finally { db.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});

/* --------------------------- randomized money invariant --------------------------- */

test('random operations never break "To Budget + Available = money in on-budget accounts", never over-allocate, never go non-integer', async () => {
  const s = await start();
  try {
    let seed = 20261113;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const c = await newUser(s.base, 'rand@example.com');
    await c.patch(`/api/accounts/${c.accountId}`, { openingBalanceMinor: R(1000) });
    const bank = (await c.post('/api/accounts', { name: 'Bank', type: 'checking', openingBalanceMinor: R(2000) })).data.account;
    const off = (await c.post('/api/accounts', { name: 'Brokerage', type: 'investment', offbudget: true, openingBalanceMinor: R(500) })).data.account;
    const spendable = [c.cat.Food, c.cat.Travel, c.cat.Shopping, c.cat.Bills, c.cat.Other];
    const months = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];
    const txs = new Map(); // id -> { month, amount, onBudget }
    const opening = R(1000) + R(2000);

    const views = async () => Object.fromEntries(await Promise.all(months.map(async (m) => [m, await bud(c, m)])));
    const check = (v, label) => {
      for (const m of months) {
        let expected = opening;
        for (const t of txs.values()) if (t.onBudget && t.month <= m) expected += t.amount;
        const b = v[m];
        assert.equal(b.toBudgetMinor + sumAvail(b), expected, `${label}: invariant broken in ${m}`);
        for (const n of [b.toBudgetMinor, b.assignedMinor, b.activityMinor, b.availableMinor]) assert.ok(Number.isSafeInteger(n), `${label}: ${n}`);
        for (const g of b.groups) for (const x of g.categories) assert.equal(x.overspent, x.availableMinor < 0);
      }
    };

    let before = await views();
    let accepted = 0, refused = 0;
    for (let step = 0; step < 160; step++) {
      const kind = pick(['tx', 'tx', 'tx', 'assign', 'assign', 'assign', 'move', 'move', 'carry', 'del']);
      let changedFrom = null;
      if (kind === 'tx') {
        const income = rnd() < 0.25;
        const acc = pick([c.accountId, bank.id, off.id]);
        const body = {
          accountId: acc, date: `${pick(months)}-${pick(['03', '15', '28'])}`,
          amountMinor: (income ? 1 : -1) * R(1 + Math.floor(rnd() * 900)) + (rnd() < 0.3 ? 37 : 0),
          payee: 'p', categoryId: income ? pick([c.cat.Salary, null, pick(spendable)]) : pick([...spendable, null]),
        };
        const r = await c.post('/api/transactions', body);
        assert.equal(r.status, 201, JSON.stringify(r.data));
        txs.set(r.data.transaction.id, { month: body.date.slice(0, 7), amount: body.amountMinor, onBudget: acc !== off.id });
      } else if (kind === 'del' && txs.size) {
        const id = pick([...txs.keys()]);
        assert.equal((await c.del(`/api/transactions/${id}`)).status, 200);
        txs.delete(id);
      } else if (kind === 'assign') {
        const m = pick(months);
        const r = await assign(c, m, pick(spendable), pick([0, R(100), R(250), R(700), R(1500), R(4000)]));
        assert.ok(r.status === 200 || r.status === 400, `assign -> ${r.status}`);
        r.status === 200 ? accepted++ : refused++;
        if (r.status === 200) changedFrom = m;
      } else if (kind === 'move') {
        const m = pick(months);
        const [a, b] = [pick(spendable), pick(spendable)];
        const r = await move(c, m, a, b, R(1 + Math.floor(rnd() * 600)));
        assert.ok(r.status === 201 || r.status === 400, `move -> ${r.status} ${JSON.stringify(r.data)}`);
        r.status === 201 ? accepted++ : refused++;
        if (r.status === 201) changedFrom = m;
      } else if (kind === 'carry') {
        assert.equal((await carry(c, pick(months), pick(spendable), rnd() < 0.5)).status, 200);
      }
      const after = await views();
      check(after, `step ${step} (${kind})`);
      // The guard: a successful assign/transfer may never push a month's To Budget lower AND below zero.
      if (changedFrom) {
        for (const m of months.filter((x) => x >= changedFrom)) {
          const was = before[m].toBudgetMinor, now = after[m].toBudgetMinor;
          assert.ok(!(now < 0 && now < was), `step ${step}: ${kind} over-allocated ${m} (${was} -> ${now})`);
        }
      }
      before = after;
    }
    assert.ok(accepted > 15 && refused > 3, `the run should exercise both outcomes (accepted ${accepted}, refused ${refused})`);
  } finally { await s.close(); }
});
