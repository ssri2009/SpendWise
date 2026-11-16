// Money is whole paise (integers) everywhere. These turn text into paise and paise into text
// without ever doing floating-point maths on rupees.

export function parseMoney(text, { allowNegative = false } = {}) {
  let s = String(text ?? '').trim().replace(/^₹\s*/, '');
  let sign = 1;
  if (allowNegative && s.startsWith('-')) { sign = -1; s = s.slice(1).trim(); }
  // Commas are only accepted as proper thousands separators (1,250.50), never as decimals (12,5).
  if (s.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return sign * (Number(whole) * 100 + Number((frac + '00').slice(0, 2)));
}

/** Paise -> text for an <input> (no currency symbol): 45050 -> "450.5", 45000 -> "450". */
export function toInput(minor) {
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const sign = minor < 0 ? '-' : '';
  return frac === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

export function makeMoney(locale = 'en-IN', currency = 'INR') {
  const base = { style: 'currency', currency };
  const nf0 = new Intl.NumberFormat(locale, { ...base, minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat(locale, { ...base, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt = (minor) => {
    const abs = Math.abs(minor);
    return (abs % 100 === 0 ? nf0 : nf2).format(abs / 100);
  };
  return {
    fmt,
    signed: (minor) => (minor < 0 ? '−' : '+') + fmt(minor),
    net: (minor) => (minor < 0 ? '−' : '') + fmt(minor),
  };
}
