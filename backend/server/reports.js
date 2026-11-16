'use strict';
// Reports engine (Phase 7). Read-only: nothing in this file writes to the database, and every query starts from
// user_id = ?, so a user can only ever report on their own data.
//
// ONE set of definitions, used by every report so the numbers always agree with each other:
//
//   LINE     a row of the tx_lines view: a normal transaction is one line, a split transaction is one line per split.
//            (So a split is counted in each of its categories and never twice.)
//   INCOME   a line in an Income-group category, or an uncategorised line with a positive amount.
//   EXPENSE  a line in any other category, or an uncategorised line with a negative amount.
//            A refund (positive amount in an expense category) therefore REDUCES that category's spending, and a
//            negative amount in an income category reduces income. This is the same rule the Budget page uses.
//   NET      income - expenses = the plain sum of all lines in the period. Nothing is ever dropped or counted twice,
//            which is why "by category", "by payee", "by account" and "over time" always add up to the same total.
//
// Not income or expense: opening balances (they are not money that moved in the period).
// Transfers between accounts are not built yet (README, Known limits). A transfer entered as an expense plus an income
// would count as both; give it its own category and use the "Leave out" filter to take it out of the reports.

const { httpError } = require('./http');
const v = require('./validate');
const RC = require('./recurrence');
const B = require('./budget');

const GRANULARITIES = ['month', 'quarter', 'year'];
const RANGES = ['this-month', 'last-month', 'last-3-months', 'last-6-months', 'last-12-months', 'this-year', 'last-year', 'all', 'custom'];
const MAX_BUCKETS = 240;
const MAX_EXCLUDE = 200;
const TOP = 5;
const ADJUSTMENT_PAYEE = 'Reconciliation Balance Adjustment';   // written by reconciliation, not something the user typed

const ASSET_TYPES = ['cash', 'checking', 'savings', 'investment', 'other'];
const LIABILITY_TYPES = ['credit', 'loan'];
const TYPE_LABELS = {
  cash: 'Cash', checking: 'Bank accounts', savings: 'Savings', investment: 'Investments', other: 'Other assets',
  credit: 'Credit cards', loan: 'Loans',
};
const SAVINGS_TYPES = ['savings', 'investment'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ------------------------------ small date and number helpers (YYYY-MM-DD strings, no Date objects) ------------------------------ */

const pad = (n) => String(n).padStart(2, '0');
const monthIdx = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
const idxYear = (i) => Math.floor(i / 12);
const idxMonth = (i) => (i % 12) + 1;
const firstOfIdx = (i) => `${idxYear(i)}-${pad(idxMonth(i))}-01`;
const lastOfIdx = (i) => `${idxYear(i)}-${pad(idxMonth(i))}-${pad(RC.daysInMonth(idxYear(i), idxMonth(i)))}`;
const idxKey = (i) => `${idxYear(i)}-${pad(idxMonth(i))}`;
const monthLabel = (i) => `${MONTH_NAMES[idxMonth(i) - 1]} ${idxYear(i)}`;
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const isLastDayOfMonth = (iso) => Number(iso.slice(8, 10)) === RC.daysInMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
const isFirstDay = (iso) => iso.slice(8, 10) === '01';
const minIso = (a, b) => (a <= b ? a : b);
const maxIso = (a, b) => (a >= b ? a : b);

/** Same day-of-month `n` months away, clamped to the length of that month (31 Mar -1 month = 28 Feb). */
function shiftMonths(iso, n) {
  const i = monthIdx(iso) + n;
  const d = Math.min(Number(iso.slice(8, 10)), RC.daysInMonth(idxYear(i), idxMonth(i)));
  return `${idxKey(i)}-${pad(d)}`;
}

/** Percent change from prev to cur, one decimal. null when there is nothing to compare with. */
function pctChange(cur, prev) {
  if (!prev) return null;
  return Math.round((cur - prev) * 1000 / Math.abs(prev)) / 10;
}
function pctOf(part, whole) {
  if (!(whole > 0)) return null;
  return Math.round(part * 1000 / whole) / 10;
}
const sum = (arr, f) => arr.reduce((n, x) => n + f(x), 0);

/* ------------------------------ query parsing ------------------------------ */

function parseGranularity(q) {
  const g = q.get('granularity') || q.get('group') || 'month';
  if (!GRANULARITIES.includes(g)) throw v.bad(`granularity must be one of: ${GRANULARITIES.join(', ')}.`);
  return g;
}

/** range=this-month|last-month|last-3-months|last-6-months|last-12-months|this-year|last-year|all|custom, or from/to. Default last-12-months. */
function resolvePeriod(db, userId, q, today) {
  const hasDates = !!(q.get('from') || q.get('to'));
  const range = q.get('range') || (hasDates ? 'custom' : 'last-12-months');
  if (!RANGES.includes(range)) throw v.bad(`range must be one of: ${RANGES.join(', ')}.`);
  const ti = monthIdx(today);
  const ty = Number(today.slice(0, 4));
  let from, to;
  switch (range) {
    case 'this-month': from = firstOfIdx(ti); to = today; break;
    case 'last-month': from = firstOfIdx(ti - 1); to = lastOfIdx(ti - 1); break;
    case 'last-3-months': from = firstOfIdx(ti - 2); to = today; break;
    case 'last-6-months': from = firstOfIdx(ti - 5); to = today; break;
    case 'last-12-months': from = firstOfIdx(ti - 11); to = today; break;
    case 'this-year': from = `${ty}-01-01`; to = today; break;
    case 'last-year': from = `${ty - 1}-01-01`; to = `${ty - 1}-12-31`; break;
    case 'all': {
      const first = db.prepare('SELECT MIN(date) AS d FROM transactions WHERE user_id = ?').get(userId).d;
      from = first && first < today ? first : firstOfIdx(ti);
      to = today;
      break;
    }
    default: {
      from = q.get('from') ? v.isoDate(q.get('from'), 'from') : firstOfIdx(ti - 11);
      to = q.get('to') ? v.isoDate(q.get('to'), 'to') : today;
    }
  }
  if (from > to) throw v.bad('The start date must not be after the end date.');
  if (RC.daysBetween(from, to) > 366 * 50) throw v.bad('That period is too long (50 years at most).');
  return { range, from, to };
}

/** The period of the same length directly before this one, aligned to calendar months when the period starts on the 1st. */
function previousPeriod(from, to) {
  if (isFirstDay(from)) {
    let span = monthIdx(to) - monthIdx(from) + 1;
    if (from.slice(5) === '01-01' && span > 6 && span <= 12) span = 12;   // this year so far / last year: compare with a year earlier
    const pFrom = firstOfIdx(monthIdx(from) - span);
    const pTo = isLastDayOfMonth(to) ? lastOfIdx(monthIdx(to) - span) : shiftMonths(to, -span);
    return { from: pFrom, to: pTo };
  }
  const days = RC.daysBetween(from, to) + 1;
  return { from: RC.addDays(from, -days), to: RC.addDays(from, -1) };
}

/** account=<id>, offbudget=yes|no|all, exclude=3,5,none  (category ids, "none" = uncategorised). */
function parseFilters(db, userId, q) {
  const f = { accountId: null, offbudget: 'all', excludeIds: new Set(), excludeNone: false };
  const account = q.get('account');
  if (account && account !== 'all') {
    f.accountId = v.intId(account, 'account');
    if (!db.prepare('SELECT 1 FROM accounts WHERE id = ? AND user_id = ?').get(f.accountId, userId)) throw httpError(404, 'Account not found.');
  }
  const off = q.get('offbudget');
  if (off === 'yes' || off === 'no') f.offbudget = off;
  else if (off && off !== 'all') throw v.bad('offbudget must be yes or no.');
  const ex = (q.get('exclude') || '').trim();
  if (ex) {
    const parts = ex.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > MAX_EXCLUDE) throw v.bad(`You can leave out at most ${MAX_EXCLUDE} categories.`);
    for (const p of parts) {
      if (p === 'none') f.excludeNone = true;
      else f.excludeIds.add(v.intId(p, 'exclude'));
    }
  }
  return f;
}
const NO_FILTERS = Object.freeze({ accountId: null, offbudget: 'all', excludeIds: new Set(), excludeNone: false });

/* ------------------------------ reading lines ------------------------------ */

/** Every line (split-aware) in [from, to] that passes the filters. kind is 'income' or 'expense' (see the rules at the top). */
function loadLines(db, userId, from, to, filters = NO_FILTERS) {
  const where = ['l.user_id = ?', 'l.date >= ?', 'l.date <= ?'];
  const args = [userId, from, to];
  if (filters.accountId !== null) { where.push('l.account_id = ?'); args.push(filters.accountId); }
  if (filters.offbudget === 'yes') where.push('a.offbudget = 1');
  else if (filters.offbudget === 'no') where.push('a.offbudget = 0');
  const rows = db.prepare(
    `SELECT l.tx_id, l.date, l.account_id, l.amount_minor, l.category_id,
            a.name AS account_name, c.name AS cat_name, c.icon AS cat_icon, g.name AS group_name, g.is_income AS g_inc,
            t.payee_id, p.name AS payee_name, t.notes
       FROM tx_lines l
       JOIN accounts a ON a.id = l.account_id
       JOIN transactions t ON t.id = l.tx_id
       LEFT JOIN payees p ON p.id = t.payee_id
       LEFT JOIN categories c ON c.id = l.category_id
       LEFT JOIN category_groups g ON g.id = c.group_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.date, l.tx_id, l.split_id`
  ).all(...args);

  const out = [];
  for (const r of rows) {
    const categoryId = r.category_id === null ? null : Number(r.category_id);
    if (categoryId === null ? filters.excludeNone : filters.excludeIds.has(categoryId)) continue;
    const amount = Number(r.amount_minor);
    const kind = categoryId === null ? (amount < 0 ? 'expense' : 'income') : (r.g_inc ? 'income' : 'expense');
    out.push({
      txId: Number(r.tx_id), date: r.date, accountId: Number(r.account_id), accountName: r.account_name,
      amountMinor: amount, value: kind === 'expense' ? -amount : amount, kind,
      categoryId, categoryName: r.cat_name || 'Uncategorized', categoryIcon: r.cat_icon || '📦', groupName: r.group_name || '',
      payeeId: r.payee_id === null ? null : Number(r.payee_id), payeeName: r.payee_name || 'No payee', notes: r.notes || '',
    });
  }
  return out;
}

/** Group lines into rows: { ...meta, amountMinor, count (distinct transactions) }, biggest first. */
function groupLines(lines, keyOf, metaOf) {
  const map = new Map();
  for (const l of lines) {
    const k = keyOf(l);
    let row = map.get(k);
    if (!row) { row = { ...metaOf(l), amountMinor: 0, txIds: new Set() }; map.set(k, row); }
    row.amountMinor += l.value;
    row.txIds.add(l.txId);
  }
  return [...map.values()]
    .map(({ txIds, ...r }) => ({ ...r, count: txIds.size }))
    .sort((a, b) => b.amountMinor - a.amountMinor || String(a.name).localeCompare(String(b.name)));
}

const byCategory = (lines) => groupLines(lines, (l) => l.categoryId, (l) => ({
  categoryId: l.categoryId, name: l.categoryName, icon: l.categoryIcon, groupName: l.groupName,
}));
const byPayee = (lines) => groupLines(lines, (l) => l.payeeId, (l) => ({ payeeId: l.payeeId, name: l.payeeName }));
const byAccount = (lines) => groupLines(lines, (l) => l.accountId, (l) => ({ accountId: l.accountId, name: l.accountName }));

function withShare(rows, total) {
  return rows.map((r) => ({ ...r, sharePct: pctOf(Math.max(0, r.amountMinor), total) ?? 0 }));
}

/* ------------------------------ buckets (month / quarter / year) ------------------------------ */

function bucketKey(date, gran) {
  if (gran === 'year') return date.slice(0, 4);
  if (gran === 'quarter') return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  return date.slice(0, 7);
}

/** Every bucket between from and to (empty ones too), each with its own from/to clipped to the period. */
function makeBuckets(from, to, gran) {
  const out = [];
  const fi = monthIdx(from);
  const ti = monthIdx(to);
  const step = gran === 'year' ? 12 : gran === 'quarter' ? 3 : 1;
  // snap the first bucket back to its start (Jan for a year, Jan/Apr/Jul/Oct for a quarter)
  let i = fi - (gran === 'year' ? idxMonth(fi) - 1 : gran === 'quarter' ? (idxMonth(fi) - 1) % 3 : 0);
  for (; i <= ti; i += step) {
    if (out.length >= MAX_BUCKETS) throw v.bad('That period has too many columns for this grouping. Choose a shorter period or group by quarter or year.');
    const last = i + step - 1;
    const bFrom = maxIso(firstOfIdx(i), from);
    const bTo = minIso(lastOfIdx(last), to);
    const y = idxYear(i);
    const key = gran === 'year' ? String(y) : gran === 'quarter' ? `${y}-Q${Math.floor((idxMonth(i) - 1) / 3) + 1}` : idxKey(i);
    const label = gran === 'year' ? String(y) : gran === 'quarter' ? `Q${Math.floor((idxMonth(i) - 1) / 3) + 1} ${y}` : monthLabel(i);
    out.push({ key, label, from: bFrom, to: bTo });
  }
  return out;
}

function fillBuckets(buckets, lines, pick) {
  const idx = new Map(buckets.map((b, n) => [b.key, n]));
  const amounts = buckets.map(() => 0);
  for (const l of lines) {
    const n = idx.get(bucketKey(l.date, buckets.gran));
    if (n !== undefined) amounts[n] += pick(l);
  }
  return amounts;
}

function bucketsFor(from, to, gran) {
  const b = makeBuckets(from, to, gran);
  b.gran = gran;
  return b;
}

const daysIn = (from, to) => RC.daysBetween(from, to) + 1;

/* ------------------------------ spending ------------------------------ */

function spending(db, userId, { from, to, gran, filters, today }) {
  const lines = loadLines(db, userId, from, to, filters).filter((l) => l.kind === 'expense');
  const totalMinor = sum(lines, (l) => l.value);
  const buckets = bucketsFor(from, to, gran);
  const amounts = fillBuckets(buckets, lines, (l) => l.value);
  const overTime = buckets.map((b, n) => ({ key: b.key, label: b.label, from: b.from, to: b.to, amountMinor: amounts[n] }));
  const elapsedTo = minIso(to, maxIso(today, from));
  const days = daysIn(from, elapsedTo);
  const biggest = lines.filter((l) => l.value > 0).sort((a, b) => b.value - a.value || b.date.localeCompare(a.date)).slice(0, TOP)
    .map((l) => ({ txId: l.txId, date: l.date, payee: l.payeeName, category: l.categoryName, account: l.accountName, amountMinor: l.value }));
  return {
    totalMinor,
    transactionCount: new Set(lines.map((l) => l.txId)).size,
    averagePerDayMinor: Math.round(totalMinor / days),
    averagePerPeriodMinor: Math.round(totalMinor / Math.max(1, buckets.length)),
    byCategory: withShare(byCategory(lines), totalMinor),
    byPayee: withShare(byPayee(lines), totalMinor),
    byAccount: withShare(byAccount(lines), totalMinor),
    overTime,
    highest: pickExtreme(overTime, 'amountMinor', 1),
    biggest,
  };
}

function pickExtreme(rows, key, dir) {
  if (!rows.length) return null;
  const r = rows.reduce((best, x) => (dir * (x[key] - best[key]) > 0 ? x : best), rows[0]);
  return { key: r.key, label: r.label, amountMinor: r[key] };
}

/* ------------------------------ income ------------------------------ */

function incomeYears(db, userId, filters, today) {
  const ty = Number(today.slice(0, 4));
  const lines = loadLines(db, userId, '1970-01-01', today, filters).filter((l) => l.kind === 'income');
  const perYear = new Map();
  for (const l of lines) { const y = Number(l.date.slice(0, 4)); perYear.set(y, (perYear.get(y) || 0) + l.value); }
  const firstYear = perYear.size ? Math.min(...perYear.keys()) : ty;
  const start = Math.max(firstYear, ty - 9);
  // "same time last year" for the year in progress: 1 Jan to today's month and day, a year earlier
  let prevEnd = `${ty - 1}-${today.slice(5)}`;
  if (today.slice(5) === '02-29' && !isLeap(ty - 1)) prevEnd = `${ty - 1}-02-28`;
  const prevYtd = sum(lines.filter((l) => l.date >= `${ty - 1}-01-01` && l.date <= prevEnd), (l) => l.value);
  const rows = [];
  for (let y = start; y <= ty; y++) {
    const incomeMinor = perYear.get(y) || 0;
    const hasPrev = rows.length > 0 || perYear.has(y - 1);          // the first year on the list may have nothing before it
    const prev = rows.length ? rows[rows.length - 1].incomeMinor : (perYear.get(y - 1) || 0);
    const row = { year: y, incomeMinor, changeMinor: hasPrev ? incomeMinor - prev : null, changePct: hasPrev ? pctChange(incomeMinor, prev) : null, partial: y === ty };
    if (y === ty) {
      row.previousSamePeriodMinor = prevYtd;
      row.samePeriodChangeMinor = incomeMinor - prevYtd;
      row.samePeriodChangePct = pctChange(incomeMinor, prevYtd);
    }
    rows.push(row);
  }
  return rows;
}

function income(db, userId, { from, to, gran, filters, today }) {
  const lines = loadLines(db, userId, from, to, filters).filter((l) => l.kind === 'income');
  const totalMinor = sum(lines, (l) => l.value);
  const buckets = bucketsFor(from, to, gran);
  const amounts = fillBuckets(buckets, lines, (l) => l.value);
  const overTime = buckets.map((b, n) => ({ key: b.key, label: b.label, from: b.from, to: b.to, amountMinor: amounts[n] }));

  // Monthly comparison always uses calendar months, whatever the grouping chosen for the trend chart.
  const mBuckets = bucketsFor(from, to, 'month');
  const mAmounts = fillBuckets(mBuckets, lines, (l) => l.value);
  const monthly = mBuckets.map((b, n) => {
    const prev = n > 0 ? mAmounts[n - 1] : null;
    return { key: b.key, label: b.label, partial: b.to < lastOfIdx(monthIdx(b.from)), incomeMinor: mAmounts[n],
      changeMinor: prev === null ? null : mAmounts[n] - prev, changePct: prev === null ? null : pctChange(mAmounts[n], prev) };
  });

  // Trend: average of the second half of the buckets against the first half (needs at least 4 buckets).
  let trend = { direction: 'flat', changePct: null };
  if (overTime.length >= 4) {
    const h = Math.floor(overTime.length / 2);
    const first = sum(overTime.slice(0, h), (b) => b.amountMinor) / h;
    const second = sum(overTime.slice(overTime.length - h), (b) => b.amountMinor) / h;
    const pct = pctChange(second, first);
    trend = { direction: pct === null || Math.abs(pct) < 5 ? 'flat' : pct > 0 ? 'up' : 'down', changePct: pct };
  }
  return {
    totalMinor,
    transactionCount: new Set(lines.map((l) => l.txId)).size,
    averagePerPeriodMinor: Math.round(totalMinor / Math.max(1, buckets.length)),
    sources: withShare(byPayee(lines), totalMinor),
    byCategory: withShare(byCategory(lines), totalMinor),
    overTime,
    highest: pickExtreme(overTime, 'amountMinor', 1),
    lowest: pickExtreme(overTime, 'amountMinor', -1),
    trend,
    monthly,
    yearly: incomeYears(db, userId, filters, today),
  };
}

/* ------------------------------ cash flow ------------------------------ */

/** Money moved into / out of savings and investment accounts is not tracked as transfers, so "saved" is the change in those accounts' balances. */
function savingsActivity(db, userId, from, to, filters) {
  const where = ['t.user_id = ?', 't.date >= ?', 't.date <= ?', `a.type IN (${SAVINGS_TYPES.map(() => '?').join(',')})`];
  const args = [userId, from, to, ...SAVINGS_TYPES];
  if (filters.accountId !== null) { where.push('t.account_id = ?'); args.push(filters.accountId); }
  if (filters.offbudget === 'yes') where.push('a.offbudget = 1');
  else if (filters.offbudget === 'no') where.push('a.offbudget = 0');
  const rows = db.prepare(`SELECT t.date, t.amount_minor FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE ${where.join(' AND ')}`).all(...args);
  const count = db.prepare(`SELECT COUNT(*) AS c FROM accounts WHERE user_id = ? AND type IN (${SAVINGS_TYPES.map(() => '?').join(',')})`).get(userId, ...SAVINGS_TYPES).c;
  return { rows: rows.map((r) => ({ date: r.date, amountMinor: Number(r.amount_minor) })), accounts: Number(count) };
}

function cashflow(db, userId, { from, to, gran, filters }) {
  const lines = loadLines(db, userId, from, to, filters);
  const buckets = bucketsFor(from, to, gran);
  const inc = fillBuckets(buckets, lines, (l) => (l.kind === 'income' ? l.value : 0));
  const exp = fillBuckets(buckets, lines, (l) => (l.kind === 'expense' ? l.value : 0));
  const sav = savingsActivity(db, userId, from, to, filters);
  const idx = new Map(buckets.map((b, n) => [b.key, n]));
  const saved = buckets.map(() => 0);
  for (const r of sav.rows) { const n = idx.get(bucketKey(r.date, gran)); if (n !== undefined) saved[n] += r.amountMinor; }

  const periods = buckets.map((b, n) => ({
    key: b.key, label: b.label, from: b.from, to: b.to,
    incomeMinor: inc[n], expensesMinor: exp[n], netMinor: inc[n] - exp[n], savedMinor: saved[n],
    savingsRatePct: pctOf(inc[n] - exp[n], inc[n]),
  }));
  const incomeMinor = sum(periods, (p) => p.incomeMinor);
  const expensesMinor = sum(periods, (p) => p.expensesMinor);
  const netMinor = incomeMinor - expensesMinor;
  return {
    totals: {
      incomeMinor, expensesMinor, netMinor, savedMinor: sum(periods, (p) => p.savedMinor),
      savingsRatePct: pctOf(netMinor, incomeMinor),
      averageNetPerPeriodMinor: Math.round(netMinor / Math.max(1, periods.length)),
    },
    savingsAccounts: sav.accounts,
    best: pickExtreme(periods.map((p) => ({ key: p.key, label: p.label, net: p.netMinor })), 'net', 1),
    worst: pickExtreme(periods.map((p) => ({ key: p.key, label: p.label, net: p.netMinor })), 'net', -1),
    periods,
  };
}

/* ------------------------------ categories ------------------------------ */

function categories(db, userId, { from, to, gran, filters, categoryParam }) {
  const prev = previousPeriod(from, to);
  const cur = loadLines(db, userId, from, to, filters);
  const old = loadLines(db, userId, prev.from, prev.to, filters);
  const months = Math.max(1, Math.round(daysIn(from, to) / 30.4375 * 100) / 100);

  const build = (kind) => {
    const a = byCategory(cur.filter((l) => l.kind === kind));
    const b = new Map(byCategory(old.filter((l) => l.kind === kind)).map((r) => [r.categoryId, r]));
    const rows = a.map((r) => ({ ...r, previousMinor: b.has(r.categoryId) ? b.get(r.categoryId).amountMinor : 0 }));
    const seen = new Set(rows.map((r) => r.categoryId));
    for (const r of b.values()) if (!seen.has(r.categoryId)) rows.push({ ...r, amountMinor: 0, count: 0, previousMinor: r.amountMinor });
    const total = sum(rows, (r) => r.amountMinor);
    return {
      totalMinor: total,
      previousTotalMinor: sum(rows, (r) => r.previousMinor),
      rows: rows.map((r) => ({
        ...r, changeMinor: r.amountMinor - r.previousMinor, changePct: pctChange(r.amountMinor, r.previousMinor),
        sharePct: pctOf(Math.max(0, r.amountMinor), total) ?? 0, averagePerMonthMinor: Math.round(r.amountMinor / months),
      })).sort((x, y) => y.amountMinor - x.amountMinor || y.previousMinor - x.previousMinor || String(x.name).localeCompare(String(y.name))),
    };
  };
  const result = { previous: prev, months, expense: build('expense'), income: build('income'), detail: null };

  if (categoryParam) {
    let meta;
    if (categoryParam === 'none') meta = { categoryId: null, name: 'Uncategorized', icon: '📦', kind: null };
    else {
      const id = v.intId(categoryParam, 'category');
      const c = db.prepare(
        `SELECT c.id, c.name, c.icon, g.is_income FROM categories c JOIN category_groups g ON g.id = c.group_id WHERE c.id = ? AND c.user_id = ?`
      ).get(id, userId);
      if (!c) throw httpError(404, 'Category not found.');
      meta = { categoryId: Number(c.id), name: c.name, icon: c.icon, kind: c.is_income ? 'income' : 'expense' };
    }
    const mine = cur.filter((l) => l.categoryId === meta.categoryId);
    // uncategorised lines can be either kind; report the larger side as "the" kind
    if (meta.kind === null) {
      meta.kind = sum(mine.filter((l) => l.kind === 'expense'), (l) => l.value) >= sum(mine.filter((l) => l.kind === 'income'), (l) => l.value) ? 'expense' : 'income';
    }
    const lines = mine.filter((l) => l.kind === meta.kind);
    const buckets = bucketsFor(from, to, gran);
    const amounts = fillBuckets(buckets, lines, (l) => l.value);
    result.detail = {
      ...meta,
      totalMinor: sum(lines, (l) => l.value),
      overTime: buckets.map((b, n) => ({ key: b.key, label: b.label, amountMinor: amounts[n] })),
      topPayees: byPayee(lines).slice(0, TOP),
      largest: lines.filter((l) => l.value > 0).sort((x, y) => y.value - x.value || y.date.localeCompare(x.date)).slice(0, TOP)
        .map((l) => ({ txId: l.txId, date: l.date, payee: l.payeeName, account: l.accountName, amountMinor: l.value, notes: l.notes })),
    };
  }
  return result;
}

/* ------------------------------ account activity ------------------------------ */

/** Per account: balance at the start of the period, money in, money out, balance at the end. Whole transactions (a split is one transaction here). */
function accountActivity(db, userId, { from, to, gran, filters }) {
  const where = ['a.user_id = ?'];
  const args = [from, from, to, from, to, from, to, userId];   // the order of the ? marks below
  if (filters.accountId !== null) { where.push('a.id = ?'); args.push(filters.accountId); }
  if (filters.offbudget === 'yes') where.push('a.offbudget = 1');
  else if (filters.offbudget === 'no') where.push('a.offbudget = 0');
  const rows = db.prepare(
    `SELECT a.id, a.name, a.type, a.closed, a.offbudget, a.opening_balance_minor AS opening,
            COALESCE(SUM(CASE WHEN t.date < ? THEN t.amount_minor END), 0) AS before_sum,
            COALESCE(SUM(CASE WHEN t.date >= ? AND t.date <= ? AND t.amount_minor > 0 THEN t.amount_minor END), 0) AS inflow,
            COALESCE(SUM(CASE WHEN t.date >= ? AND t.date <= ? AND t.amount_minor < 0 THEN -t.amount_minor END), 0) AS outflow,
            COUNT(CASE WHEN t.date >= ? AND t.date <= ? THEN 1 END) AS cnt
       FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.user_id = a.user_id
      WHERE ${where.join(' AND ')} GROUP BY a.id ORDER BY a.closed, a.sort_order, a.id`
  ).all(...args);

  const accounts = [];
  for (const r of rows) {
    const startBalanceMinor = Number(r.opening) + Number(r.before_sum);
    const inflowMinor = Number(r.inflow);
    const outflowMinor = Number(r.outflow);
    const endBalanceMinor = startBalanceMinor + inflowMinor - outflowMinor;
    if (r.closed && !Number(r.cnt) && startBalanceMinor === 0 && endBalanceMinor === 0) continue;   // a closed, empty account is just noise
    accounts.push({
      accountId: Number(r.id), name: r.name, type: r.type, closed: !!r.closed, offbudget: !!r.offbudget,
      startBalanceMinor, inflowMinor, outflowMinor, netMinor: inflowMinor - outflowMinor, endBalanceMinor, transactionCount: Number(r.cnt),
    });
  }
  const totals = {
    startBalanceMinor: sum(accounts, (a) => a.startBalanceMinor), inflowMinor: sum(accounts, (a) => a.inflowMinor),
    outflowMinor: sum(accounts, (a) => a.outflowMinor), netMinor: sum(accounts, (a) => a.netMinor),
    endBalanceMinor: sum(accounts, (a) => a.endBalanceMinor), transactionCount: sum(accounts, (a) => a.transactionCount),
  };

  let detail = null;
  if (filters.accountId !== null && accounts.length) {
    const txs = db.prepare(
      `SELECT t.id, t.date, t.amount_minor, t.is_split, t.cleared, p.name AS payee, c.name AS category, t.notes
         FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.user_id = ? AND t.account_id = ? AND t.date >= ? AND t.date <= ? ORDER BY t.date, t.id`
    ).all(userId, filters.accountId, from, to);
    const buckets = bucketsFor(from, to, gran);
    const inflow = buckets.map(() => 0);
    const outflow = buckets.map(() => 0);
    const idx = new Map(buckets.map((b, n) => [b.key, n]));
    for (const t of txs) {
      const n = idx.get(bucketKey(t.date, gran));
      const amt = Number(t.amount_minor);
      if (amt > 0) inflow[n] += amt; else outflow[n] += -amt;
    }
    detail = {
      overTime: buckets.map((b, n) => ({ key: b.key, label: b.label, inflowMinor: inflow[n], outflowMinor: outflow[n], netMinor: inflow[n] - outflow[n] })),
      recent: txs.slice(-15).reverse().map((t) => ({
        txId: Number(t.id), date: t.date, amountMinor: Number(t.amount_minor), payee: t.payee || 'No payee',
        category: t.is_split ? 'Split' : (t.category || 'Uncategorized'), cleared: !!t.cleared,
      })),
    };
  }
  return { accounts, totals, detail };
}

/* ------------------------------ monthly summary ------------------------------ */

function totalsOf(lines) {
  const incomeMinor = sum(lines.filter((l) => l.kind === 'income'), (l) => l.value);
  const expensesMinor = sum(lines.filter((l) => l.kind === 'expense'), (l) => l.value);
  return { incomeMinor, expensesMinor, netMinor: incomeMinor - expensesMinor, savingsRatePct: pctOf(incomeMinor - expensesMinor, incomeMinor) };
}

function monthlySummary(db, userId, { month, filters, today }) {
  if (!B.isMonth(month)) throw v.bad('month must look like 2026-11.');
  const mi = monthIdx(`${month}-01`);
  const monthStart = firstOfIdx(mi);
  const monthEnd = lastOfIdx(mi);
  const isCurrent = month === today.slice(0, 7);
  const isFuture = month > today.slice(0, 7);
  const to = isCurrent ? today : monthEnd;                      // the month in progress is reported "so far"
  const daysElapsed = isFuture ? 0 : isCurrent ? Number(today.slice(8, 10)) : RC.daysInMonth(idxYear(mi), idxMonth(mi));

  const lines = loadLines(db, userId, monthStart, isFuture ? monthEnd : to, filters);
  const t = totalsOf(lines);

  // Compare like with like: a month in progress against the same number of days last month.
  const pStart = firstOfIdx(mi - 1);
  const pEnd = isCurrent ? shiftMonths(to, -1) : lastOfIdx(mi - 1);
  const pEndClipped = minIso(pEnd, lastOfIdx(mi - 1));
  const prevLines = loadLines(db, userId, pStart, pEndClipped, filters);
  const p = totalsOf(prevLines);

  const expenseLines = lines.filter((l) => l.kind === 'expense');
  const incomeLines = lines.filter((l) => l.kind === 'income');
  const daily = [];
  const perDay = new Map();
  for (const l of lines) {
    const d = perDay.get(l.date) || { incomeMinor: 0, expensesMinor: 0 };
    if (l.kind === 'income') d.incomeMinor += l.value; else d.expensesMinor += l.value;
    perDay.set(l.date, d);
  }
  for (let day = monthStart; day <= monthEnd; day = RC.addDays(day, 1)) {
    const d = perDay.get(day) || { incomeMinor: 0, expensesMinor: 0 };
    daily.push({ date: day, ...d, future: day > today });
  }

  let budget = null;
  try {
    const bv = B.monthView(db, userId, month);
    budget = {
      assignedMinor: bv.assignedMinor, activityMinor: bv.activityMinor, availableMinor: bv.availableMinor, toBudgetMinor: bv.toBudgetMinor,
      overspentCount: bv.overspentCount, overspentMinor: bv.overspentMinor, uncategorizedCount: bv.uncategorizedCount,
    };
  } catch { budget = null; }

  return {
    month, from: monthStart, to: isFuture ? monthEnd : to, isCurrent, daysElapsed, daysInMonth: RC.daysInMonth(idxYear(mi), idxMonth(mi)),
    ...t,
    comparedWith: { from: pStart, to: pEndClipped, label: monthLabel(mi - 1), sameDays: isCurrent },
    previous: p,
    changes: {
      incomeMinor: t.incomeMinor - p.incomeMinor, expensesMinor: t.expensesMinor - p.expensesMinor, netMinor: t.netMinor - p.netMinor,
      incomePct: pctChange(t.incomeMinor, p.incomeMinor), expensesPct: pctChange(t.expensesMinor, p.expensesMinor),
    },
    averageDailyExpenseMinor: daysElapsed ? Math.round(t.expensesMinor / daysElapsed) : 0,
    transactionCount: new Set(lines.map((l) => l.txId)).size,
    topCategories: withShare(byCategory(expenseLines), t.expensesMinor).slice(0, TOP),
    topPayees: withShare(byPayee(expenseLines), t.expensesMinor).slice(0, TOP),
    incomeSources: withShare(byPayee(incomeLines), t.incomeMinor).slice(0, TOP),
    largestExpenses: expenseLines.filter((l) => l.value > 0).sort((a, b) => b.value - a.value || b.date.localeCompare(a.date)).slice(0, TOP)
      .map((l) => ({ txId: l.txId, date: l.date, payee: l.payeeName, category: l.categoryName, account: l.accountName, amountMinor: l.value })),
    daily,
    budget,
  };
}

/* ------------------------------ net worth ------------------------------ */

/**
 * Net worth = assets - liabilities, as of a date. Each account's balance is its opening balance plus its transactions
 * dated on or before that date (the same maths as the Accounts page). Credit cards and loans are liabilities (what you
 * owe = minus their balance); every other account type is an asset. Closed accounts count while they hold a balance.
 * History assumes each opening balance was already there at the start of the chart (accounts have no opening DATE).
 */
function netWorth(db, userId, { months, today }) {
  const accts = db.prepare('SELECT id, name, type, closed, opening_balance_minor AS opening FROM accounts WHERE user_id = ? ORDER BY closed, sort_order, id').all(userId)
    .map((a) => ({ id: Number(a.id), name: a.name, type: a.type, closed: !!a.closed, opening: Number(a.opening) }));
  const sums = new Map();   // accountId -> Map(month 'YYYY-MM' -> paise), up to today only
  for (const r of db.prepare(
    `SELECT account_id, substr(date, 1, 7) AS m, SUM(amount_minor) AS s FROM transactions WHERE user_id = ? AND date <= ? GROUP BY account_id, m`
  ).all(userId, today)) {
    if (!sums.has(Number(r.account_id))) sums.set(Number(r.account_id), new Map());
    sums.get(Number(r.account_id)).set(r.m, Number(r.s));
  }
  const balanceThrough = (a, monthKey) => {
    let s = a.opening;
    const m = sums.get(a.id);
    if (m) for (const [k, val] of m) if (k <= monthKey) s += val;
    return s;
  };
  const isLiability = (a) => LIABILITY_TYPES.includes(a.type);

  // chart points: the end of each of the N months before this one, then today
  const ti = monthIdx(today);
  let n = months;
  if (months === 'all') {
    const first = db.prepare('SELECT MIN(date) AS d FROM transactions WHERE user_id = ?').get(userId).d;
    n = first ? Math.max(0, Math.min(120, ti - monthIdx(first))) : 0;
  }
  const points = [];
  for (let k = n; k >= 1; k--) points.push({ date: lastOfIdx(ti - k), label: monthLabel(ti - k), monthKey: idxKey(ti - k) });
  points.push({ date: today, label: 'Today', monthKey: today.slice(0, 7) });

  const series = points.map((p) => {
    let assets = 0, liabilities = 0;
    for (const a of accts) {
      const b = balanceThrough(a, p.monthKey);
      if (isLiability(a)) liabilities -= b; else assets += b;
    }
    return { date: p.date, label: p.label, assetsMinor: assets, liabilitiesMinor: liabilities, netWorthMinor: assets - liabilities };
  });

  // today's breakdown by account type
  const nowKey = today.slice(0, 7);
  const groups = [];
  for (const type of [...ASSET_TYPES, ...LIABILITY_TYPES]) {
    const list = accts.filter((a) => a.type === type).map((a) => {
      const bal = balanceThrough(a, nowKey);
      return { accountId: a.id, name: a.name, closed: a.closed, balanceMinor: isLiability(a) ? -bal : bal };
    }).filter((a) => !(a.closed && a.balanceMinor === 0));
    if (!list.length) continue;
    groups.push({ type, label: TYPE_LABELS[type], kind: LIABILITY_TYPES.includes(type) ? 'liability' : 'asset', balanceMinor: sum(list, (a) => a.balanceMinor), accounts: list });
  }
  const last = series[series.length - 1];
  const first = series[0];
  const prevPoint = series.length > 1 ? series[series.length - 2] : null;
  const diff = last.netWorthMinor - first.netWorthMinor;
  const flatBand = Math.max(Math.abs(first.netWorthMinor) * 0.01, 100);
  return {
    asOf: today,
    current: { assetsMinor: last.assetsMinor, liabilitiesMinor: last.liabilitiesMinor, netWorthMinor: last.netWorthMinor, groups },
    series,
    change: {
      overRangeMinor: diff, overRangePct: pctChange(last.netWorthMinor, first.netWorthMinor),
      sinceLastMonthEndMinor: prevPoint ? last.netWorthMinor - prevPoint.netWorthMinor : null,
      from: first.label,
    },
    trend: Math.abs(diff) < flatBand ? 'flat' : diff > 0 ? 'up' : 'down',
    hasLiabilities: groups.some((g) => g.kind === 'liability'),
  };
}

/* ------------------------------ insights ------------------------------ */

/** Plain-language findings, each worked out from the same numbers as the reports. level: warn | good | info. */
function insights(db, userId, user, today) {
  const money = (m) => B.moneyText(user, m);
  const out = [];
  const add = (id, level, title, detail, link) => out.push({ id, level, title, detail, link });

  const anyTx = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?').get(userId).c;
  if (!anyTx) {
    add('no-data', 'info', 'Nothing to analyse yet', 'Add a few transactions (or import a CSV) and your insights will appear here.', '/transactions');
    return out;
  }

  const ti = monthIdx(today);
  const day = Number(today.slice(8, 10));
  const dim = RC.daysInMonth(idxYear(ti), idxMonth(ti));
  const monthStart = firstOfIdx(ti);
  const thisMonth = loadLines(db, userId, monthStart, today).filter((l) => l.kind === 'expense');
  const spentSoFar = sum(thisMonth, (l) => l.value);
  const lastEnd = shiftMonths(today, -1);
  const lastLines = loadLines(db, userId, firstOfIdx(ti - 1), lastOfIdx(ti - 1)).filter((l) => l.kind === 'expense');
  const lastSamePoint = sum(lastLines.filter((l) => l.date <= minIso(lastEnd, lastOfIdx(ti - 1))), (l) => l.value);
  const lastTotal = sum(lastLines, (l) => l.value);

  // 1. pace against the same point last month
  if (day >= 3 && lastSamePoint > 0) {
    const pct = pctChange(spentSoFar, lastSamePoint);
    const abs = Math.abs(spentSoFar - lastSamePoint);
    if (pct >= 15) add('spend-pace', 'warn', `Spending is up ${pct}% on this point last month`, `${money(spentSoFar)} so far this month, against ${money(lastSamePoint)} by the same day last month (${money(abs)} more).`, '/reports#spending');
    else if (pct <= -15) add('spend-pace', 'good', `Spending is down ${Math.abs(pct)}% on this point last month`, `${money(spentSoFar)} so far this month, against ${money(lastSamePoint)} by the same day last month (${money(abs)} less).`, '/reports#spending');
    else add('spend-pace', 'info', 'Spending is in line with last month', `${money(spentSoFar)} so far, against ${money(lastSamePoint)} by the same day last month.`, '/reports#spending');
  }

  // 2. where the month is heading at the current pace
  if (day >= 7 && day < dim && spentSoFar > 0) {
    const projected = Math.round(spentSoFar / day * dim);
    const vs = lastTotal > 0 ? ` Last month's total was ${money(lastTotal)}.` : '';
    add('projection', 'info', `At this pace you would spend about ${money(projected)} this month`, `That is ${money(Math.round(spentSoFar / day))} a day so far.${vs} A rough guide only: it assumes the rest of the month looks like the days so far, so rent or bills paid early in the month make it look high.`, '/reports#monthly');
  }

  // 3. the biggest category this month
  const cats = byCategory(thisMonth).filter((c) => c.amountMinor > 0);
  if (cats.length && spentSoFar > 0) {
    const top = cats[0];
    add('top-category', 'info', `${top.icon} ${top.name} is your biggest spend this month`, `${money(top.amountMinor)}, which is ${pctOf(top.amountMinor, spentSoFar)}% of what you have spent so far.`, '/reports#categories');
  }

  // 4. a category that jumped
  const lastCats = new Map(byCategory(lastLines.filter((l) => l.date <= minIso(lastEnd, lastOfIdx(ti - 1)))).map((c) => [c.categoryId, c.amountMinor]));
  let spike = null;
  for (const c of cats) {
    const before = lastCats.get(c.categoryId) || 0;
    const rise = c.amountMinor - before;
    if (rise >= 50000 && (before === 0 || c.amountMinor >= before * 1.5) && (!spike || rise > spike.rise)) spike = { c, before, rise };
  }
  if (spike) {
    add('category-spike', 'warn', `${spike.c.icon} ${spike.c.name} is well above last month`, `${money(spike.c.amountMinor)} so far, against ${money(spike.before)} by the same day last month (${money(spike.rise)} more).`, '/reports#categories');
  }

  // 5 and 6. last full month: savings rate, and income against the month before
  const lm = totalsOf(loadLines(db, userId, firstOfIdx(ti - 1), lastOfIdx(ti - 1)));
  const lm2 = totalsOf(loadLines(db, userId, firstOfIdx(ti - 2), lastOfIdx(ti - 2)));
  const lmName = monthLabel(ti - 1);
  if (lm.incomeMinor > 0) {
    const r = lm.savingsRatePct;
    if (lm.netMinor < 0) add('savings-rate', 'warn', `You spent more than you earned in ${lmName}`, `Income ${money(lm.incomeMinor)}, spending ${money(lm.expensesMinor)}: a shortfall of ${money(-lm.netMinor)}.`, '/reports#cashflow');
    else if (r >= 20) add('savings-rate', 'good', `You kept ${r}% of your income in ${lmName}`, `${money(lm.netMinor)} left over from ${money(lm.incomeMinor)} earned.`, '/reports#cashflow');
    else add('savings-rate', 'info', `You kept ${r}% of your income in ${lmName}`, `${money(lm.netMinor)} left over from ${money(lm.incomeMinor)} earned. Many people aim for 20% or more.`, '/reports#cashflow');
  }
  if (lm.incomeMinor > 0 && lm2.incomeMinor > 0) {
    const pct = pctChange(lm.incomeMinor, lm2.incomeMinor);
    if (Math.abs(pct) >= 10) add('income-change', pct > 0 ? 'good' : 'warn', `Income ${pct > 0 ? 'rose' : 'fell'} ${Math.abs(pct)}% in ${lmName}`, `${money(lm.incomeMinor)}, against ${money(lm2.incomeMinor)} in ${monthLabel(ti - 2)}.`, '/reports#income');
  }

  // 7. the largest single expense this month
  const big = thisMonth.filter((l) => l.value > 0).sort((a, b) => b.value - a.value)[0];
  if (big && spentSoFar > 0 && thisMonth.length > 1) {
    add('biggest-expense', 'info', `Largest expense this month: ${money(big.value)}`, `${big.payeeName} on ${big.date} (${big.categoryName}), ${pctOf(big.value, spentSoFar)}% of this month's spending.`, '/transactions');
  }

  // 8. envelopes that are overspent
  try {
    const bv = B.monthView(db, userId, today.slice(0, 7));
    if (bv.overspentCount > 0) {
      add('overspent', 'warn', `${bv.overspentCount} budget envelope${bv.overspentCount === 1 ? ' is' : 's are'} overspent`, `${money(bv.overspentMinor)} over in total this month. Move money between envelopes on the Budget page.`, '/budget');
    }
  } catch { /* the budget needs a valid month; nothing to say if it cannot be read */ }

  // 9. uncategorised transactions in the last 90 days (the adjustment reconciliation writes is meant to be uncategorised)
  const since = RC.addDays(today, -90);
  const unc = db.prepare(
    `SELECT COUNT(DISTINCT t.id) AS c FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id
      WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? AND t.is_split = 0 AND t.category_id IS NULL AND COALESCE(p.name, '') != ?`
  ).get(userId, since, today, ADJUSTMENT_PAYEE).c;
  if (unc > 0) add('uncategorized', 'info', `${unc} recent transaction${unc === 1 ? ' has' : 's have'} no category`, 'Categorising them makes the spending reports more accurate. A Rule can do it for you next time.', '/transactions?category=none');

  // 10. net worth against the end of last month
  const nw = netWorth(db, userId, { months: 1, today });
  const since1 = nw.change.sinceLastMonthEndMinor;
  if (since1) {
    add('net-worth', since1 > 0 ? 'good' : 'warn', `Net worth is ${since1 > 0 ? 'up' : 'down'} ${money(Math.abs(since1))} since the end of last month`, `It stands at ${money(nw.current.netWorthMinor)} today.`, '/reports#networth');
  }

  const order = { warn: 0, good: 1, info: 2 };
  return out.map((x, i) => ({ x, i })).sort((a, b) => order[a.x.level] - order[b.x.level] || a.i - b.i).map(({ x }) => x);
}

/* ------------------------------ CSV (one flat table per report) ------------------------------ */

/** 123456 -> "1234.56", -5 -> "-0.05". Integer maths only. */
function minorText(m) {
  const abs = Math.abs(m);
  return `${m < 0 ? '-' : ''}${Math.floor(abs / 100)}.${pad(abs % 100)}`;
}
const pctText = (p) => (p === null || p === undefined ? '' : String(p));

function csvRows(kind, r) {
  const rows = [];
  switch (kind) {
    case 'spending': {
      rows.push(['Section', 'Name', 'Amount', 'Share %', 'Transactions']);
      for (const c of r.byCategory) rows.push(['By category', c.name, minorText(c.amountMinor), pctText(c.sharePct), c.count]);
      for (const c of r.byPayee) rows.push(['By payee', c.name, minorText(c.amountMinor), pctText(c.sharePct), c.count]);
      for (const c of r.byAccount) rows.push(['By account', c.name, minorText(c.amountMinor), pctText(c.sharePct), c.count]);
      for (const c of r.overTime) rows.push(['Over time', c.label, minorText(c.amountMinor), '', '']);
      rows.push(['Total', '', minorText(r.totalMinor), '', r.transactionCount]);
      break;
    }
    case 'income': {
      rows.push(['Section', 'Name', 'Amount', 'Change vs previous', 'Change %']);
      for (const c of r.sources) rows.push(['Source', c.name, minorText(c.amountMinor), '', pctText(c.sharePct)]);
      for (const c of r.byCategory) rows.push(['By category', c.name, minorText(c.amountMinor), '', pctText(c.sharePct)]);
      for (const c of r.monthly) rows.push(['Month', c.label, minorText(c.incomeMinor), c.changeMinor === null ? '' : minorText(c.changeMinor), pctText(c.changePct)]);
      for (const c of r.yearly) rows.push(['Year', String(c.year) + (c.partial ? ' (so far)' : ''), minorText(c.incomeMinor), c.changeMinor === null ? '' : minorText(c.changeMinor), pctText(c.changePct)]);
      rows.push(['Total', '', minorText(r.totalMinor), '', '']);
      break;
    }
    case 'cashflow': {
      rows.push(['Period', 'Income', 'Expenses', 'Net cash flow', 'Savings rate %', 'Saved in savings and investment accounts']);
      for (const p of r.periods) rows.push([p.label, minorText(p.incomeMinor), minorText(p.expensesMinor), minorText(p.netMinor), pctText(p.savingsRatePct), minorText(p.savedMinor)]);
      const t = r.totals;
      rows.push(['Total', minorText(t.incomeMinor), minorText(t.expensesMinor), minorText(t.netMinor), pctText(t.savingsRatePct), minorText(t.savedMinor)]);
      break;
    }
    case 'categories': {
      rows.push(['Type', 'Category', 'Group', 'Amount', 'Previous period', 'Change', 'Change %', 'Share %', 'Average per month', 'Transactions']);
      for (const type of ['expense', 'income']) {
        for (const c of r[type].rows) {
          rows.push([type === 'expense' ? 'Expense' : 'Income', c.name, c.groupName, minorText(c.amountMinor), minorText(c.previousMinor), minorText(c.changeMinor),
            pctText(c.changePct), pctText(c.sharePct), minorText(c.averagePerMonthMinor), c.count]);
        }
      }
      break;
    }
    case 'accounts': {
      rows.push(['Account', 'Type', 'Start balance', 'Money in', 'Money out', 'Net', 'End balance', 'Transactions']);
      for (const a of r.accounts) rows.push([a.name, a.type, minorText(a.startBalanceMinor), minorText(a.inflowMinor), minorText(a.outflowMinor), minorText(a.netMinor), minorText(a.endBalanceMinor), a.transactionCount]);
      const t = r.totals;
      rows.push(['Total', '', minorText(t.startBalanceMinor), minorText(t.inflowMinor), minorText(t.outflowMinor), minorText(t.netMinor), minorText(t.endBalanceMinor), t.transactionCount]);
      break;
    }
    case 'monthly-summary': {
      rows.push(['Section', 'Name', 'Amount', 'Share %']);
      rows.push(['Summary', 'Income', minorText(r.incomeMinor), '']);
      rows.push(['Summary', 'Expenses', minorText(r.expensesMinor), '']);
      rows.push(['Summary', 'Net cash flow', minorText(r.netMinor), pctText(r.savingsRatePct)]);
      for (const c of r.topCategories) rows.push(['Top categories', c.name, minorText(c.amountMinor), pctText(c.sharePct)]);
      for (const c of r.topPayees) rows.push(['Top payees', c.name, minorText(c.amountMinor), pctText(c.sharePct)]);
      for (const c of r.incomeSources) rows.push(['Income sources', c.name, minorText(c.amountMinor), pctText(c.sharePct)]);
      for (const c of r.largestExpenses) rows.push(['Largest expenses', `${c.date} ${c.payee}`, minorText(c.amountMinor), '']);
      for (const d of r.daily.filter((x) => !x.future)) rows.push(['Daily expenses', d.date, minorText(d.expensesMinor), '']);
      break;
    }
    case 'net-worth': {
      rows.push(['Date', 'Assets', 'Liabilities', 'Net worth']);
      for (const s of r.series) rows.push([s.date, minorText(s.assetsMinor), minorText(s.liabilitiesMinor), minorText(s.netWorthMinor)]);
      for (const g of r.current.groups) for (const a of g.accounts) rows.push([`${g.label}: ${a.name}`, g.kind === 'asset' ? minorText(a.balanceMinor) : '', g.kind === 'liability' ? minorText(a.balanceMinor) : '', '']);
      break;
    }
    default: throw new Error(`unknown report ${kind}`);
  }
  return rows;
}

/** Spreadsheet apps run cells that start with = + - @ as formulas; a leading quote keeps them text (same rule as the transactions export). */
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

module.exports = {
  GRANULARITIES, RANGES, TYPE_LABELS, ASSET_TYPES, LIABILITY_TYPES,
  parseGranularity, resolvePeriod, previousPeriod, parseFilters, NO_FILTERS,
  loadLines, makeBuckets, bucketKey, shiftMonths, pctChange,
  spending, income, cashflow, categories, accountActivity, monthlySummary, netWorth, insights,
  csvRows, toCsv, minorText,
};
