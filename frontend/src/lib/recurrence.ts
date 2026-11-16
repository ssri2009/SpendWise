/* ---------------------------------------------------------------------
   Client copy of server/recurrence.js, used only for PREVIEWS in the
   schedule form ("next dates", "this will create 3 past ones now") and
   for counting missed dates before a resume. The server stays the
   source of truth: every number it returns wins over these.

   Occurrence k is always worked out from the START date, never from the
   previous one, so "monthly on the 31st" gives Jan 31, Feb 28, Mar 31.
   --------------------------------------------------------------------- */

import type { ScheduleFrequency, ScheduleUnit } from '../types/schedules';

export interface Rule {
  frequency: ScheduleFrequency;
  n: number;
  unit: ScheduleUnit;
}

export const MAX_INTERVAL = 1000;
const MAX_YEAR = 2200;

const PRESETS: Record<Exclude<ScheduleFrequency, 'custom'>, { n: number; unit: ScheduleUnit }> = {
  once: { unit: 'month', n: 1 },
  daily: { unit: 'day', n: 1 },
  weekly: { unit: 'week', n: 1 },
  monthly: { unit: 'month', n: 1 },
  quarterly: { unit: 'month', n: 3 },
  yearly: { unit: 'year', n: 1 },
};

export const FREQUENCY_OPTIONS: { id: ScheduleFrequency; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'daily', label: 'Daily' },
  { id: 'quarterly', label: 'Quarterly (every 3 months)' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'custom', label: 'Custom…' },
  { id: 'once', label: 'One time only' },
];

export const UNIT_OPTIONS: { id: ScheduleUnit; one: string; many: string }[] = [
  { id: 'day', one: 'day', many: 'days' },
  { id: 'week', one: 'week', many: 'weeks' },
  { id: 'month', one: 'month', many: 'months' },
  { id: 'year', one: 'year', many: 'years' },
];

/** Same normalisation as the server's makeRule(); null when a custom rule is incomplete. */
export function makeRule(frequency: ScheduleFrequency, interval: number, unit: ScheduleUnit): Rule | null {
  if (frequency !== 'custom') return { frequency, ...PRESETS[frequency] };
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > MAX_INTERVAL) return null;
  return { frequency, n: interval, unit };
}

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (iso: string) => iso.split('-').map(Number);
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export const isIsoDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = parts(s);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1970 && y <= MAX_YEAR;
};

/** Date of occurrence k (0 = the start date), or null when there is none. */
export function occurrenceDate(start: string, rule: Rule, k: number): string | null {
  if (!Number.isSafeInteger(k) || k < 0) return null;
  if (rule.frequency === 'once') return k === 0 ? start : null;
  let out: string;
  if (rule.unit === 'day' || rule.unit === 'week') {
    const days = k * rule.n * (rule.unit === 'week' ? 7 : 1);
    if (days > 400_000) return null;
    out = addDays(start, days);
  } else {
    const [y, m, d] = parts(start);
    const total = y * 12 + (m - 1) + k * rule.n * (rule.unit === 'year' ? 12 : 1);
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    if (ny > MAX_YEAR) return null;
    out = fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
  }
  return Number(out.slice(0, 4)) > MAX_YEAR ? null : out;
}

/** Smallest k whose date is on or after `date`, or null if the rule never gets there. */
export function firstIndexOnOrAfter(start: string, rule: Rule, date: string): number | null {
  if (date <= start) return 0;
  if (rule.frequency === 'once') return null;
  let k: number;
  if (rule.unit === 'day' || rule.unit === 'week') {
    k = Math.ceil(daysBetween(start, date) / (rule.n * (rule.unit === 'week' ? 7 : 1)));
  } else {
    const [y1, m1] = parts(start);
    const [y2, m2] = parts(date);
    k = Math.max(0, Math.floor((y2 * 12 + m2 - (y1 * 12 + m1)) / (rule.n * (rule.unit === 'year' ? 12 : 1))) - 1);
  }
  for (let i = 0; i < 1000; i++, k++) {
    const d = occurrenceDate(start, rule, k);
    if (d === null) return null;
    if (d >= date) return k;
  }
  return null;
}

/** Up to `limit` dates on or after `from` (and never past `end`). */
export function datesFrom(start: string, rule: Rule, end: string | null, from: string, limit: number): string[] {
  const out: string[] = [];
  const first = firstIndexOnOrAfter(start, rule, from);
  if (first === null) return out;
  for (let k = first; out.length < limit; k++) {
    const d = occurrenceDate(start, rule, k);
    if (d === null || (end && d > end)) break;
    out.push(d);
  }
  return out;
}

/**
 * Dates in [from, before) – e.g. what a new schedule with a past start date will create at once,
 * or what fell due while a schedule was paused. Counts at most `cap`.
 */
export function datesBetween(start: string, rule: Rule, end: string | null, from: string, before: string, cap = 400): string[] {
  const out: string[] = [];
  const first = firstIndexOnOrAfter(start, rule, from);
  if (first === null) return out;
  for (let k = first; out.length < cap; k++) {
    const d = occurrenceDate(start, rule, k);
    if (d === null || d >= before || (end && d > end)) break;
    out.push(d);
  }
  return out;
}
