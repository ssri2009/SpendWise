'use strict';
// Recurrence maths for scheduled transactions. Pure functions on 'YYYY-MM-DD' strings: no database, no clock.
//
// A rule is { frequency, n, unit } where unit is 'day' | 'week' | 'month' | 'year' and n >= 1.
//   daily = every 1 day        weekly = every 1 week      monthly = every 1 month
//   quarterly = every 3 months yearly = every 1 year      custom = any n + unit      once = one date, no repeat
//
// IMPORTANT: occurrence number k is always worked out from the START date, never from the previous occurrence.
// That is what keeps "monthly on the 31st" correct: Jan 31, Feb 28, Mar 31 (not Mar 28), and "yearly on Feb 29"
// land on Feb 28 in common years and Feb 29 again in leap years.

const { bad } = require('./validate');

const MAX_YEAR = 2200;                 // same upper bound as validate.isoDate
const MAX_INTERVAL = 1000;
const FREQUENCIES = ['once', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'];
const UNITS = ['day', 'week', 'month', 'year'];
const PRESETS = {
  once: { unit: 'month', n: 1 },
  daily: { unit: 'day', n: 1 },
  weekly: { unit: 'week', n: 1 },
  monthly: { unit: 'month', n: 1 },
  quarterly: { unit: 'month', n: 3 },
  yearly: { unit: 'year', n: 1 },
};

const pad = (n) => String(n).padStart(2, '0');
const parts = (iso) => iso.split('-').map(Number);
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m is 1..12

function addDays(iso, n) {
  const [y, m, d] = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function daysBetween(a, b) {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Today's date in the SERVER's local time zone (set TZ in the environment to change it). */
function localToday(d = new Date()) {
  return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Validates and normalises what the API receives. Presets ignore any interval/unit that was sent.
 * Returns { frequency, n, unit }.
 */
function makeRule(frequency, interval, unit) {
  if (!FREQUENCIES.includes(frequency)) throw bad(`frequency must be one of: ${FREQUENCIES.join(', ')}.`);
  if (frequency !== 'custom') return { frequency, ...PRESETS[frequency] };
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    throw bad(`A custom interval must be a whole number from 1 to ${MAX_INTERVAL}.`);
  }
  if (!UNITS.includes(unit)) throw bad(`A custom repeat needs a unit: ${UNITS.join(', ')}.`);
  return { frequency, n: interval, unit };
}

/** The date of occurrence number k (0 = the start date), or null if there is none (past 2200, or a one-time schedule's k >= 1). */
function occurrenceDate(startIso, rule, k) {
  if (!Number.isSafeInteger(k) || k < 0) return null;
  if (rule.frequency === 'once') return k === 0 ? startIso : null;
  let out;
  if (rule.unit === 'day' || rule.unit === 'week') {
    const days = k * rule.n * (rule.unit === 'week' ? 7 : 1);
    if (days > 400000) return null;                       // ~1,000 years: far past the 2200 limit
    out = addDays(startIso, days);
  } else {
    const [y, m, d] = parts(startIso);
    const total = y * 12 + (m - 1) + k * rule.n * (rule.unit === 'year' ? 12 : 1);
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    if (ny > MAX_YEAR) return null;
    out = fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
  }
  return Number(out.slice(0, 4)) > MAX_YEAR ? null : out;
}

/** The smallest k whose date is on or after `dateIso`, or null if the rule never reaches it. */
function firstIndexOnOrAfter(startIso, rule, dateIso) {
  if (dateIso <= startIso) return 0;
  if (rule.frequency === 'once') return null;
  let k;
  if (rule.unit === 'day' || rule.unit === 'week') {
    k = Math.ceil(daysBetween(startIso, dateIso) / (rule.n * (rule.unit === 'week' ? 7 : 1)));
  } else {
    const [y1, m1] = parts(startIso);
    const [y2, m2] = parts(dateIso);
    k = Math.max(0, Math.floor(((y2 * 12 + m2) - (y1 * 12 + m1)) / (rule.n * (rule.unit === 'year' ? 12 : 1))) - 1);
  }
  for (let i = 0; i < 1000; i++, k++) {                    // the estimate is at most a step or two early
    const date = occurrenceDate(startIso, rule, k);
    if (date === null) return null;
    if (date >= dateIso) return k;
  }
  return null;
}

/** Date of occurrence k, or null when there is none or it is after the end date. This is the stored "next date". */
function nextDate(startIso, rule, endIso, k) {
  const date = occurrenceDate(startIso, rule, k);
  if (date === null) return null;
  return endIso && date > endIso ? null : date;
}

/**
 * Occurrences from index `fromIndex` onward whose date falls in [fromDate, toDate] (inclusive),
 * never past `endIso`. At most `limit` of them. Returns [{ k, date }].
 */
function occurrencesInRange(startIso, rule, endIso, fromIndex, fromDate, toDate, limit = 400) {
  const out = [];
  const first = firstIndexOnOrAfter(startIso, rule, fromDate);
  if (first === null) return out;
  for (let k = Math.max(fromIndex, first); out.length < limit; k++) {
    const date = nextDate(startIso, rule, endIso, k);
    if (date === null || date > toDate) break;
    out.push({ k, date });
  }
  return out;
}

const PLURAL = { day: 'days', week: 'weeks', month: 'months', year: 'years' };
/** "Monthly", "Every 3 months", "One time". */
function label(rule) {
  switch (rule.frequency) {
    case 'once': return 'One time';
    case 'daily': return 'Daily';
    case 'weekly': return 'Weekly';
    case 'monthly': return 'Monthly';
    case 'quarterly': return 'Quarterly';
    case 'yearly': return 'Yearly';
    default: return rule.n === 1 ? `Every ${rule.unit}` : `Every ${rule.n} ${PLURAL[rule.unit]}`;
  }
}

/** What a repeating amount costs per month on average, in paise (rounded). A one-time schedule is 0. */
function monthlyEquivalent(amountMinor, rule) {
  if (rule.frequency === 'once') return 0;
  const perYear = rule.unit === 'day' ? 365.25 / rule.n
    : rule.unit === 'week' ? 365.25 / (7 * rule.n)
      : rule.unit === 'month' ? 12 / rule.n : 1 / rule.n;
  return Math.round(Math.abs(amountMinor) * perYear / 12);
}

module.exports = {
  FREQUENCIES, UNITS, MAX_INTERVAL,
  addDays, daysBetween, localToday, daysInMonth,
  makeRule, occurrenceDate, firstIndexOnOrAfter, nextDate, occurrencesInRange, label, monthlyEquivalent,
};
