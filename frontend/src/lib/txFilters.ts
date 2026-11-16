import { addMonths, currentMonth, isMonthKey } from './months';
import { localToday, parseIsoDate, toIsoDate } from './format';

/* ---------------------------------------------------------------------
   Transaction filters, using the exact query parameters of
   GET /api/transactions (server/txquery.js buildFilter):
     q, account, category (id | none), payee, cleared (yes | no),
     type (income | expense), month (YYYY-MM) or from / to (YYYY-MM-DD),
     min / max (absolute amount, paise).
   They live in the page URL, so a filtered view can be bookmarked and
   other screens can link to it (/transactions?month=2026-11&category=none).
   --------------------------------------------------------------------- */

export interface TxFilters {
  q: string;
  account: number | null;
  category: number | 'none' | null;
  payee: number | null;
  cleared: 'yes' | 'no' | null;
  type: 'income' | 'expense' | null;
  month: string | null;
  from: string | null;
  to: string | null;
  min: number | null;
  max: number | null;
}

export const EMPTY_FILTERS: TxFilters = {
  q: '', account: null, category: null, payee: null, cleared: null, type: null,
  month: null, from: null, to: null, min: null, max: null,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const id = (v: string | null) => (v && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null);
const paise = (v: string | null) => (v && /^\d{1,13}$/.test(v) ? Number(v) : null);

export function readFilters(params: URLSearchParams): TxFilters {
  const category = params.get('category');
  const cleared = params.get('cleared');
  const type = params.get('type');
  const month = params.get('month');
  const from = params.get('from');
  const to = params.get('to');
  return {
    q: (params.get('q') ?? '').slice(0, 80),
    account: id(params.get('account')),
    category: category === 'none' ? 'none' : id(category),
    payee: id(params.get('payee')),
    cleared: cleared === 'yes' || cleared === 'no' ? cleared : null,
    type: type === 'income' || type === 'expense' ? type : null,
    month: isMonthKey(month) ? month : null,
    from: from && ISO_DATE.test(from) ? from : null,
    to: to && ISO_DATE.test(to) ? to : null,
    min: paise(params.get('min')),
    max: paise(params.get('max')),
  };
}

/** Filters → query string for both the page URL and the API (same names). Empty values are left out. */
export function filtersToParams(f: TxFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.account !== null) p.set('account', String(f.account));
  if (f.category !== null) p.set('category', String(f.category));
  if (f.payee !== null) p.set('payee', String(f.payee));
  if (f.cleared) p.set('cleared', f.cleared);
  if (f.type) p.set('type', f.type);
  if (f.month) p.set('month', f.month);
  else {
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
  }
  if (f.min !== null) p.set('min', String(f.min));
  if (f.max !== null) p.set('max', String(f.max));
  return p;
}

export const activeFilterCount = (f: TxFilters) =>
  [f.account, f.category, f.payee, f.cleared, f.type, f.month ?? f.from ?? f.to, f.min, f.max].filter((v) => v !== null).length +
  (f.q.trim() ? 1 : 0);

/* ---------- date presets ---------- */

export type DatePreset = 'all' | 'this-month' | 'last-month' | 'last-30' | 'last-90' | 'this-year' | 'month' | 'custom';

export const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-30', label: 'Last 30 days' },
  { id: 'last-90', label: 'Last 90 days' },
  { id: 'this-year', label: 'This year' },
  { id: 'month', label: 'Pick a month…' },
  { id: 'custom', label: 'Custom range…' },
];

const daysAgo = (n: number) => {
  const d = parseIsoDate(localToday());
  d.setDate(d.getDate() - n);
  return toIsoDate(d);
};

/** Which preset the current date filter corresponds to. */
export function presetOf(f: TxFilters): DatePreset {
  const today = localToday();
  if (f.month) {
    if (f.month === currentMonth()) return 'this-month';
    if (f.month === addMonths(currentMonth(), -1)) return 'last-month';
    return 'month';
  }
  if (!f.from && !f.to) return 'all';
  if (f.to === today && f.from === daysAgo(29)) return 'last-30';
  if (f.to === today && f.from === daysAgo(89)) return 'last-90';
  if (f.to === today && f.from === `${today.slice(0, 4)}-01-01`) return 'this-year';
  return 'custom';
}

/** The date part of the filters for a preset ('month' / 'custom' keep or seed a value the user then edits). */
export function applyPreset(f: TxFilters, preset: DatePreset): TxFilters {
  const today = localToday();
  const base = { ...f, month: null, from: null, to: null };
  switch (preset) {
    case 'all':
      return base;
    case 'this-month':
      return { ...base, month: currentMonth() };
    case 'last-month':
      return { ...base, month: addMonths(currentMonth(), -1) };
    case 'last-30':
      return { ...base, from: daysAgo(29), to: today };
    case 'last-90':
      return { ...base, from: daysAgo(89), to: today };
    case 'this-year':
      return { ...base, from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'month':
      return { ...base, month: f.month ?? currentMonth() };
    case 'custom':
      return { ...base, from: f.from ?? f.month?.concat('-01') ?? daysAgo(29), to: f.to ?? today };
  }
}
