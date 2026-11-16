import type { CategoryGroupNode } from '../types/api';
import type { Granularity, ReportRange } from '../types/reports';

/* ---------------------------------------------------------------------
   Report filters, kept in the page URL:
     range, from, to         → the API's period (server/reports.js resolvePeriod)
     granularity             → month | quarter | year
     account                 → one account id
     cats                    → categories to INCLUDE ("only these"), ids or "none"
   The API filters categories with `exclude=` (leave out), so "only these" is
   sent as "leave out every other category" — the reports then agree with
   each other exactly as the server defines them.
   --------------------------------------------------------------------- */

export interface ReportFilters {
  range: ReportRange;
  from: string | null;
  to: string | null;
  granularity: Granularity;
  account: number | null;
  /** Categories to include; empty = all. 'none' = Uncategorized. */
  cats: (number | 'none')[];
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  range: 'last-12-months', from: null, to: null, granularity: 'month', account: null, cats: [],
};

export const RANGE_OPTIONS: { id: ReportRange; label: string }[] = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-3-months', label: 'Last 3 months' },
  { id: 'last-6-months', label: 'Last 6 months' },
  { id: 'last-12-months', label: 'Last 12 months' },
  { id: 'this-year', label: 'This year' },
  { id: 'last-year', label: 'Last year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom range…' },
];

/** server/reports.js MAX_EXCLUDE. */
export const MAX_EXCLUDE = 200;

const RANGES = new Set(RANGE_OPTIONS.map((r) => r.id));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function readReportFilters(p: URLSearchParams): ReportFilters {
  const range = p.get('range') as ReportRange | null;
  const from = p.get('from');
  const to = p.get('to');
  const g = p.get('granularity');
  const acc = p.get('account');
  const cats = (p.get('cats') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === 'none' ? 'none' : /^\d{1,15}$/.test(s) ? Number(s) : null))
    .filter((v): v is number | 'none' => v !== null);
  const hasDates = !!((from && ISO.test(from)) || (to && ISO.test(to)));
  return {
    range: range && RANGES.has(range) ? range : hasDates ? 'custom' : 'last-12-months',
    from: from && ISO.test(from) ? from : null,
    to: to && ISO.test(to) ? to : null,
    granularity: g === 'quarter' || g === 'year' ? g : 'month',
    account: acc && /^\d{1,15}$/.test(acc) ? Number(acc) : null,
    cats: [...new Set(cats)],
  };
}

/** Filters → the page's own query string (only what differs from the defaults). */
export function reportFiltersToUrl(f: ReportFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.range !== 'last-12-months') p.set('range', f.range);
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
  }
  if (f.granularity !== 'month') p.set('granularity', f.granularity);
  if (f.account !== null) p.set('account', String(f.account));
  if (f.cats.length) p.set('cats', f.cats.join(','));
  return p;
}

/** Category ids to leave out so that only `cats` remain. */
export function excludeFor(cats: ReportFilters['cats'], groups: CategoryGroupNode[]): string[] {
  if (!cats.length) return [];
  const keep = new Set(cats);
  const out: string[] = [];
  for (const g of groups) for (const c of g.categories) if (!keep.has(c.id)) out.push(String(c.id));
  if (!keep.has('none')) out.push('none');
  return out;
}

/** Filters → the API query string shared by every report. */
export function reportApiParams(f: ReportFilters, groups: CategoryGroupNode[]): URLSearchParams {
  const p = new URLSearchParams();
  p.set('range', f.range);
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from);
    if (f.to) p.set('to', f.to);
  }
  p.set('granularity', f.granularity);
  if (f.account !== null) p.set('account', String(f.account));
  const exclude = excludeFor(f.cats, groups);
  if (exclude.length) p.set('exclude', exclude.join(','));
  return p;
}

/** The same period as a Transactions-page filter, for "see these transactions" links. */
export function transactionsLink(period: { from: string; to: string }, extra: Record<string, string | number | null> = {}, account: number | null = null) {
  const p = new URLSearchParams({ from: period.from, to: period.to });
  if (account !== null) p.set('account', String(account));
  for (const [k, v] of Object.entries(extra)) if (v !== null && v !== undefined) p.set(k, String(v));
  return `/transactions?${p}`;
}
