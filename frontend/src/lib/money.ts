/* ---------------------------------------------------------------------
   Money typed by a person ↔ integer paise. No floating-point maths on
   rupees anywhere (same rules as the Phase 7 public/js/money.js).
   --------------------------------------------------------------------- */

/** Largest amount the server accepts (server/validate.js MAX_MINOR). */
export const MAX_MINOR = 1e12;

/**
 * "1500", "1,500.50", "₹ 1,50,000", "450.5" → paise, or null if it isn't a clean amount.
 * Commas are accepted only as thousands separators (Indian 1,50,000 or Western 150,000).
 */
export function parseMoney(text: string, { allowNegative = false } = {}): number | null {
  let s = String(text ?? '')
    .trim()
    .replace(/^[₹$€£]\s*/, '')
    .replace(/\s+/g, '');
  let sign = 1;
  if (allowNegative && (s.startsWith('-') || s.startsWith('−'))) {
    sign = -1;
    s = s.slice(1);
  }
  if (s.includes(',')) {
    // 1,234,567.89 or 12,34,567.89
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) && !/^\d{1,2}(,\d{2})*,\d{3}(\.\d+)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s) && !/^\.\d{1,2}$/.test(s)) return null;
  const [whole = '0', frac = ''] = s.split('.');
  const minor = sign * (Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)));
  if (Math.abs(minor) > MAX_MINOR) return null;
  return minor;
}

/** Paise → editable text with no symbol or grouping: 45050 → "450.50", 45000 → "450". */
export function toInputValue(minor: number): string {
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const sign = minor < 0 ? '-' : '';
  return frac === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(frac).padStart(2, '0')}`;
}
