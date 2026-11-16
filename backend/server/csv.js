'use strict';
// CSV reading and the strict value parsers used by the advanced importer. Pure functions, no database.
// Money never goes through floating point: amounts are parsed from text straight into whole paise.

const v = require('./validate');

const DELIMS = [',', ';', '\t', '|'];
const MAX_COLS = 60;

/** Which delimiter does the first non-empty line use most (outside quotes)? Comma when in doubt. */
function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQ = false, seen = false;
  for (const ch of text) {
    if (ch === '"') { inQ = !inQ; seen = true; continue; }
    if (!inQ && (ch === '\n' || ch === '\r')) { if (seen) break; continue; }
    if (ch.trim() !== '') seen = true;
    if (!inQ && Object.hasOwn(counts, ch)) counts[ch]++;
  }
  let best = ',';
  for (const d of DELIMS) if (counts[d] > counts[best]) best = d;
  return best;
}

/**
 * RFC 4180 reader: quoted fields, "" for a quote, line breaks inside quotes, CRLF / LF / CR, a leading BOM.
 * Returns { delimiter, rows: string[][] } with fully blank lines dropped.
 * Throws a 400 for an unterminated quote or a row with too many columns.
 */
function parseCsv(input, delimiterHint) {
  let text = String(input);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const delimiter = delimiterHint && DELIMS.includes(delimiterHint) ? delimiterHint : detectDelimiter(text);

  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  let wasQuoted = false;

  const endField = () => { row.push(field); field = ''; wasQuoted = false; };
  const endRow = () => {
    endField();
    if (row.length > MAX_COLS) throw v.bad(`Too many columns (more than ${MAX_COLS}). Is this really a CSV file?`);
    if (!(row.length === 1 && row[0].trim() === '' )) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"' && field === '' && !wasQuoted) {
      inQ = true; wasQuoted = true;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (inQ) throw v.bad('The file has a quote (") that is never closed. Check the file around the last quoted value.');
  if (field !== '' || row.length) endRow();
  return { delimiter, rows };
}

/* ------------------------------ column detection ------------------------------ */

const NAMES = {
  date: ['date', 'transaction date', 'txn date', 'posted', 'posted date', 'posting date', 'value date', 'booking date'],
  payee: ['payee', 'description', 'merchant', 'name', 'narration', 'details', 'title', 'particulars', 'transaction description', 'vendor'],
  category: ['category', 'categories', 'cat'],
  account: ['account', 'account name'],
  notes: ['notes', 'note', 'memo', 'remarks', 'comment', 'comments'],
  amount: ['amount', 'amt', 'value', 'transaction amount'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'dr', 'paid out', 'money out', 'debit amount'],
  credit: ['credit', 'deposit', 'deposits', 'cr', 'paid in', 'money in', 'credit amount'],
  cleared: ['cleared', 'cleared status', 'reconciled'],
  type: ['type', 'direction', 'dr/cr', 'transaction type'],
};

/** Guess a mapping from the header row. Unknown columns stay unmapped (null). Each column is used at most once. */
function suggestMapping(headers) {
  const norm = headers.map((h) => String(h).trim().toLowerCase());
  const out = {};
  const used = new Set();
  for (const field of Object.keys(NAMES)) {
    const i = norm.findIndex((h, idx) => !used.has(idx) && NAMES[field].includes(h));
    out[field] = i === -1 ? null : i;
    if (i !== -1) used.add(i);
  }
  // A file with debit/credit columns has no single amount column.
  if (out.amount !== null && (out.debit !== null || out.credit !== null)) { out.amount = null; }
  return out;
}

const MAPPING_FIELDS = Object.keys(NAMES);

/** Validates a mapping from the client: every value is null or a column index inside the file. */
function cleanMapping(m, columnCount) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw v.bad('mapping must be an object.');
  const out = {};
  for (const f of MAPPING_FIELDS) {
    const x = m[f];
    if (x === undefined || x === null || x === '') { out[f] = null; continue; }
    if (!Number.isInteger(x) || x < 0 || x >= columnCount) throw v.bad(`Column for "${f}" is not in the file.`);
    out[f] = x;
  }
  return out;
}

/* ------------------------------ value parsers (each throws Error with a message fit for the user) ------------------------------ */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad2 = (n) => String(n).padStart(2, '0');

function realDate(y, m, d, original) {
  const iso = `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
  try { return v.isoDate(iso); } catch { throw new Error(`"${original}" is not a real date.`); }
}

/** fmt: 'auto' (default: day first, month first only when the day is obviously second), 'DMY', 'MDY', 'YMD'. */
function parseDate(raw, fmt = 'auto') {
  const s0 = String(raw ?? '').trim();
  if (!s0) throw new Error('Date is empty.');
  const s = s0.replace(/[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i, '').trim(); // drop a time of day

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return realDate(+m[1], +m[2], +m[3], s0);

  m = /^(\d{1,2})[ \-/.]([A-Za-z]{3,9})\.?[ \-/.,]+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi === -1) throw new Error(`"${s0}" is not a date I understand.`);
    return realDate(+m[3], mi + 1, +m[1], s0);
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi === -1) throw new Error(`"${s0}" is not a date I understand.`);
    return realDate(+m[3], mi + 1, +m[2], s0);
  }

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (fmt === 'MDY') return realDate(y, a, b, s0);
    if (fmt === 'DMY') return realDate(y, b, a, s0);
    if (fmt === 'YMD') throw new Error(`"${s0}" does not look like year-month-day.`);
    // auto: day first (the usual order in India), unless that cannot be a month but the other way can
    return b > 12 && a <= 12 ? realDate(y, a, b, s0) : realDate(y, b, a, s0);
  }
  throw new Error(`"${s0}" is not a date I understand (try 2026-11-05 or 05/11/2026).`);
}

/** Amount text -> signed whole paise. "₹1,234.50" "(450.00)" "-450" "450-" "1,23,456.5" all work; "12,50" is refused (comma or thousands?). */
function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s) throw new Error('Amount is empty.');
  const original = s;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/[−–—]/g, '-').replace(/^(₹|rs\.?|inr)\s*/i, '').replace(/\s*(₹|rs\.?|inr)$/i, '');
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1).trim(); } else if (s.startsWith('+')) s = s.slice(1).trim();
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1).trim(); }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, '');
  if (!/^\d[\d,]*(\.\d+)?$/.test(s)) throw new Error(`"${original}" is not an amount.`);
  if (s.includes(',')) {
    const whole = s.split('.')[0];
    if (!/^\d{1,3}(,\d{2,3})*,\d{3}$/.test(whole)) throw new Error(`"${original}" is unclear: use a dot for decimals (450.50) and commas only for thousands (1,250).`);
    s = s.replace(/,/g, '');
  }
  const [whole, frac = ''] = s.split('.');
  if (frac.length > 2) throw new Error(`"${original}" has more than 2 decimal places.`);
  if (whole.replace(/^0+/, '').length > 10) throw new Error(`"${original}" is too large.`);
  const paise = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (paise === 0) throw new Error('Amount is zero.');
  if (paise > v.MAX_MINOR) throw new Error(`"${original}" is too large.`);
  return neg ? -paise : paise;
}

/** Same as parseAmount but an empty cell means "nothing here" (for the debit / credit pair). */
function parseOptionalAmount(raw) {
  return String(raw ?? '').trim() === '' ? null : parseAmount(raw);
}

function parseCleared(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'cleared', 'c', 'x', '✓', '✔', 'reconciled', 'r'].includes(s)) return 1;
  if (['', 'no', 'n', 'false', '0', 'uncleared', 'u', 'pending', '-'].includes(s)) return 0;
  throw new Error(`Cleared must be yes or no (got "${String(raw).trim()}").`);
}

/** The Type column: income / expense (and their usual bank names). */
function parseType(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['income', 'credit', 'cr', 'deposit', 'inflow', 'in'].includes(s)) return 'income';
  if (['expense', 'debit', 'dr', 'withdrawal', 'outflow', 'out', 'spend'].includes(s)) return 'expense';
  throw new Error(`Type must be income or expense (got "${String(raw).trim()}").`);
}

/** Our own CSV export writes a ' in front of text starting with = + - @ so spreadsheets don't run it as a formula. Undo that. */
function unquoteFormula(text) {
  return /^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
}

module.exports = {
  parseCsv, detectDelimiter, suggestMapping, cleanMapping, MAPPING_FIELDS,
  parseDate, parseAmount, parseOptionalAmount, parseCleared, parseType, unquoteFormula,
};
