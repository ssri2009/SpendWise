'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('../server/recurrence');

const dates = (start, rule, n) => Array.from({ length: n }, (_, k) => RC.occurrenceDate(start, rule, k));

test('daily, weekly and custom day/week intervals step exactly', () => {
  assert.deepEqual(dates('2026-12-30', RC.makeRule('daily'), 4), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(dates('2026-11-15', RC.makeRule('weekly'), 3), ['2026-11-15', '2026-11-22', '2026-11-29']);
  assert.deepEqual(dates('2026-12-25', RC.makeRule('custom', 10, 'day'), 3), ['2026-12-25', '2027-01-04', '2027-01-14']);
  assert.deepEqual(dates('2026-11-01', RC.makeRule('custom', 2, 'week'), 3), ['2026-11-01', '2026-11-15', '2026-11-29']);
});

test('monthly recurrence is anchored on the start day, so month ends do not drift', () => {
  const m = RC.makeRule('monthly');
  assert.deepEqual(dates('2026-01-31', m, 6), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  assert.deepEqual(dates('2028-01-31', m, 3), ['2028-01-31', '2028-02-29', '2028-03-31'], 'leap year February');
  assert.deepEqual(dates('2026-11-05', m, 3), ['2026-11-05', '2026-12-05', '2027-01-05'], 'rolls over the year');
  assert.equal(RC.occurrenceDate('2026-01-31', m, 12), '2027-01-31');
});

test('quarterly is every three months, anchored the same way', () => {
  assert.deepEqual(dates('2026-11-30', RC.makeRule('quarterly'), 5), ['2026-11-30', '2027-02-28', '2027-05-30', '2027-08-30', '2027-11-30']);
  assert.deepEqual(dates('2026-01-15', RC.makeRule('quarterly'), 3), ['2026-01-15', '2026-04-15', '2026-07-15']);
});

test('yearly recurrence keeps the date, and a Feb 29 start lands on Feb 28 in common years', () => {
  const y = RC.makeRule('yearly');
  assert.deepEqual(dates('2026-03-10', y, 3), ['2026-03-10', '2027-03-10', '2028-03-10']);
  assert.deepEqual(dates('2024-02-29', y, 5), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  assert.deepEqual(dates('2026-01-01', RC.makeRule('custom', 2, 'year'), 3), ['2026-01-01', '2028-01-01', '2030-01-01']);
  assert.deepEqual(dates('2026-01-31', RC.makeRule('custom', 5, 'month'), 3), ['2026-01-31', '2026-06-30', '2026-11-30']);
});

test('a one-time schedule has exactly one occurrence', () => {
  const o = RC.makeRule('once');
  assert.deepEqual(dates('2026-12-01', o, 3), ['2026-12-01', null, null]);
  assert.equal(RC.firstIndexOnOrAfter('2026-12-01', o, '2026-12-02'), null);
  assert.equal(RC.firstIndexOnOrAfter('2026-12-01', o, '2026-11-01'), 0);
});

test('nothing is generated past the end date or past the year 2200', () => {
  const m = RC.makeRule('monthly');
  assert.equal(RC.nextDate('2026-01-15', m, '2026-03-14', 2), null, 'Mar 15 is after the end date');
  assert.equal(RC.nextDate('2026-01-15', m, '2026-03-15', 2), '2026-03-15', 'the end date itself is included');
  assert.equal(RC.occurrenceDate('2199-12-01', m, 1), '2200-01-01', '2200 is still allowed');
  assert.equal(RC.occurrenceDate('2200-12-01', m, 1), null, '2201 is not');
  assert.equal(RC.occurrenceDate('2026-01-01', RC.makeRule('daily'), 1e9), null);
});

test('occurrencesInRange lists the dates inside a window and respects the cursor, end date and limit', () => {
  const m = RC.makeRule('monthly');
  assert.deepEqual(RC.occurrencesInRange('2026-01-31', m, null, 0, '2026-02-01', '2026-05-31').map((x) => x.date),
    ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.deepEqual(RC.occurrencesInRange('2026-01-31', m, null, 3, '2026-01-01', '2026-06-30').map((x) => x.date),
    ['2026-04-30', '2026-05-31', '2026-06-30'], 'occurrences before the cursor are already handled');
  assert.deepEqual(RC.occurrencesInRange('2026-01-31', m, '2026-03-31', 0, '2026-01-01', '2026-12-31').map((x) => x.date),
    ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(RC.occurrencesInRange('2026-01-01', RC.makeRule('daily'), null, 0, '2026-01-01', '2030-01-01', 10).length, 10);
});

test('firstIndexOnOrAfter agrees with counting one by one, for every kind of rule', () => {
  const units = ['day', 'week', 'month', 'year'];
  for (let t = 0; t < 2000; t++) {
    const rule = RC.makeRule('custom', 1 + ((t * 7) % 13), units[t % 4]);
    const start = RC.addDays('2020-01-01', (t * 37) % 900);
    const target = RC.addDays('2020-01-01', (t * 53) % 3000);
    let k = 0;
    while (RC.occurrenceDate(start, rule, k) < target) k++;
    assert.equal(RC.firstIndexOnOrAfter(start, rule, target), k, `${JSON.stringify(rule)} from ${start} to ${target}`);
  }
});

test('makeRule validates, and presets ignore a stray interval', () => {
  assert.deepEqual(RC.makeRule('quarterly', 99, 'day'), { frequency: 'quarterly', n: 3, unit: 'month' });
  assert.throws(() => RC.makeRule('fortnightly'), /frequency must be one of/);
  assert.throws(() => RC.makeRule('custom'), /custom interval/);
  assert.throws(() => RC.makeRule('custom', 0, 'day'), /custom interval/);
  assert.throws(() => RC.makeRule('custom', 1.5, 'day'), /custom interval/);
  assert.throws(() => RC.makeRule('custom', 2, 'decade'), /unit/);
  assert.throws(() => RC.makeRule('custom', 5000, 'day'), /custom interval/);
});

test('labels and the monthly equivalent used for subscriptions', () => {
  assert.equal(RC.label(RC.makeRule('monthly')), 'Monthly');
  assert.equal(RC.label(RC.makeRule('custom', 3, 'week')), 'Every 3 weeks');
  assert.equal(RC.label(RC.makeRule('custom', 1, 'year')), 'Every year');
  assert.equal(RC.label(RC.makeRule('once')), 'One time');
  assert.equal(RC.monthlyEquivalent(-64900, RC.makeRule('monthly')), 64900);
  assert.equal(RC.monthlyEquivalent(-120000, RC.makeRule('yearly')), 10000);
  assert.equal(RC.monthlyEquivalent(-30000, RC.makeRule('quarterly')), 10000);
  assert.equal(RC.monthlyEquivalent(-1000, RC.makeRule('once')), 0);
});
