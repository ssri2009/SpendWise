import { localToday } from './format';

/** Same range the server accepts (server/budget.js MONTH_RE). */
const MONTH_RE = /^(20\d\d)-(0[1-9]|1[0-2])$/;

export const isMonthKey = (m: string | undefined | null): m is string => typeof m === 'string' && MONTH_RE.test(m);

export const currentMonth = () => localToday().slice(0, 7);

const toIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const fromIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

/** "2026-11" + 2 → "2027-01", or null outside 2000-01..2099-12. */
export function addMonths(m: string, n: number): string | null {
  const i = toIndex(m) + n;
  return i < 2000 * 12 || i > 2099 * 12 + 11 ? null : fromIndex(i);
}

/** Months from `back` before to `ahead` after `around`, newest first. */
export function monthRange(around: string, back: number, ahead: number): string[] {
  const out: string[] = [];
  for (let n = ahead; n >= -back; n--) {
    const m = addMonths(around, n);
    if (m) out.push(m);
  }
  return out;
}
