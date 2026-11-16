/* Money, percent and date formatting. Amounts are integer paise; dates are YYYY-MM-DD strings. */

export interface MoneyFormat {
  locale: string;
  currency: string;
}

export const DEFAULT_MONEY_FORMAT: MoneyFormat = { locale: 'en-IN', currency: 'INR' };

const MINUS = '−';
const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, options);
    } catch {
      f = new Intl.NumberFormat('en-IN', options.style === 'currency' ? { ...options, currency: 'INR' } : options);
    }
    formatters.set(key, f);
  }
  return f;
}

/** 1234500 → "₹12,345"; 1234567 → "₹12,345.67". `signed` adds "+" to positive amounts. */
export function formatMoney(
  minor: number,
  fmt: MoneyFormat = DEFAULT_MONEY_FORMAT,
  opts: { signed?: boolean; decimals?: number } = {},
): string {
  const abs = Math.abs(minor);
  const decimals = opts.decimals ?? (abs % 100 === 0 ? 0 : 2);
  const text = numberFormat(fmt.locale, {
    style: 'currency',
    currency: fmt.currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(abs / 100);
  const sign = minor < 0 ? MINUS : opts.signed && minor > 0 ? '+' : '';
  return sign + text;
}

/** Short form for chart axes: "₹1.2L", "₹45K". */
export function formatMoneyCompact(minor: number, fmt: MoneyFormat = DEFAULT_MONEY_FORMAT): string {
  const abs = Math.abs(minor) / 100;
  const text = numberFormat(fmt.locale, {
    style: 'currency',
    currency: fmt.currency,
    notation: 'compact',
    maximumFractionDigits: abs >= 1000 ? 1 : 0,
  }).format(abs);
  return (minor < 0 ? MINUS : '') + text;
}

export function formatPct(pct: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  const sign = pct < 0 ? MINUS : opts.signed && pct > 0 ? '+' : '';
  return `${sign}${Math.abs(pct).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Parses YYYY-MM-DD as a local calendar date (no UTC shift). */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localToday(): string {
  return toIsoDate(new Date());
}

export function formatDate(
  iso: string,
  locale = DEFAULT_MONEY_FORMAT.locale,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
): string {
  return parseIsoDate(iso).toLocaleDateString(locale, options);
}

/** "Today", "Yesterday", "Tomorrow", otherwise "12 Nov" (with the year when it isn't this year). */
export function relativeDay(iso: string, today: string, locale = DEFAULT_MONEY_FORMAT.locale): string {
  const diff = Math.round((parseIsoDate(iso).getTime() - parseIsoDate(today).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return formatDate(iso, locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "2026-11" → "November 2026". */
export function monthName(month: string, locale = DEFAULT_MONEY_FORMAT.locale): string {
  return parseIsoDate(`${month}-01`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
