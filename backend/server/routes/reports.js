'use strict';
// Reports API. Read-only. The maths lives in server/reports.js (one set of definitions for income, expense, net and
// net worth, so every report agrees with every other). The first route below is the Phase 5 one and is unchanged.
// It is split-aware: a split transaction contributes each split to its own category, never its parent amount.
//
// Every report accepts  ?format=csv  to download the same numbers as a spreadsheet file.

const { httpError, sendJson, sendText } = require('../http');
const v = require('../validate');
const R = require('../reports');
const B = require('../budget');

module.exports = ({ db, clock }) => {
  const today = () => (clock ? clock.today() : require('../recurrence').localToday());

  /** Period + grouping + filters, parsed the same way for every report. */
  const common = (ctx, { period = true } = {}) => ({
    today: today(),
    ...(period ? R.resolvePeriod(db, ctx.user.id, ctx.query, today()) : {}),
    gran: R.parseGranularity(ctx.query),
    filters: R.parseFilters(db, ctx.user.id, ctx.query),
  });

  /** JSON by default, a spreadsheet when ?format=csv. */
  const reply = (ctx, kind, body, fileTag) => {
    const fmt = ctx.query.get('format');
    if (fmt === 'csv') {
      const name = `spendwise-${kind}-${fileTag}.csv`.replace(/[^A-Za-z0-9._-]/g, '-');
      return sendText(ctx.res, 200, R.toCsv(R.csvRows(kind, body)), {
        'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store',
      });
    }
    if (fmt && fmt !== 'json') throw httpError(400, 'format must be json or csv.');
    return sendJson(ctx.res, 200, body);
  };

  const periodOut = (c) => ({ range: c.range, from: c.from, to: c.to });

  return {
  // Spending (and income) per category for a period. Filters: month=2026-11 | from=&to= (dates), account=ID, offbudget=yes|no.
  // Every figure comes from tx_lines, so the category rows ALWAYS add up to the grand totals.
  'GET /api/reports/spending-by-category': {
    auth: true,
    handler: (ctx) => {
      const where = ['l.user_id = ?'];
      const args = [ctx.user.id];
      const q = ctx.query;

      const month = q.get('month');
      if (month && month !== 'all') {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw httpError(400, 'month must look like 2026-11.');
        where.push('l.date >= ? AND l.date <= ?');
        args.push(`${month}-01`, `${month}-31`);
      }
      if (q.get('from')) { where.push('l.date >= ?'); args.push(v.isoDate(q.get('from'), 'from')); }
      if (q.get('to')) { where.push('l.date <= ?'); args.push(v.isoDate(q.get('to'), 'to')); }
      const account = q.get('account');
      if (account && account !== 'all') {
        const id = v.intId(account, 'account');
        if (!db.prepare('SELECT 1 FROM accounts WHERE id = ? AND user_id = ?').get(id, ctx.user.id)) throw httpError(404, 'Account not found.');
        where.push('l.account_id = ?');
        args.push(id);
      }
      const off = q.get('offbudget');
      if (off === 'no') where.push('a.offbudget = 0');
      else if (off === 'yes') where.push('a.offbudget = 1');
      else if (off && off !== 'all') throw httpError(400, 'offbudget must be yes or no.');

      const rows = db.prepare(
        `SELECT l.category_id AS cid, c.name AS name, c.icon AS icon,
                COALESCE(SUM(CASE WHEN l.amount_minor < 0 THEN -l.amount_minor END), 0) AS spent,
                COALESCE(SUM(CASE WHEN l.amount_minor > 0 THEN l.amount_minor END), 0) AS received,
                SUM(l.amount_minor) AS net, COUNT(*) AS lines
           FROM tx_lines l JOIN accounts a ON a.id = l.account_id LEFT JOIN categories c ON c.id = l.category_id
          WHERE ${where.join(' AND ')} GROUP BY l.category_id ORDER BY c.name IS NULL, c.name`
      ).all(...args);

      const categories = rows.map((r) => ({
        categoryId: r.cid === null ? null : Number(r.cid),
        name: r.name || 'Uncategorized', icon: r.icon || '📦',
        spentMinor: Number(r.spent), receivedMinor: Number(r.received), netMinor: Number(r.net), lines: Number(r.lines),
      }));
      const sum = (k) => categories.reduce((n, c) => n + c[k], 0);
      sendJson(ctx.res, 200, {
        categories,
        totals: { spentMinor: sum('spentMinor'), receivedMinor: sum('receivedMinor'), netMinor: sum('netMinor') },
      });
    },
  },

    // ---- Phase 7 ----

    // ?range=last-12-months|this-month|last-month|last-3-months|last-6-months|this-year|last-year|all|custom (+ from/to)
    // &granularity=month|quarter|year  &account=<id>  &offbudget=yes|no  &exclude=3,5,none
    'GET /api/reports/spending': {
      auth: true,
      handler: (ctx) => {
        const c = common(ctx);
        const body = { period: periodOut(c), granularity: c.gran, ...R.spending(db, ctx.user.id, c) };
        reply(ctx, 'spending', body, `${c.from}-to-${c.to}`);
      },
    },

    'GET /api/reports/income': {
      auth: true,
      handler: (ctx) => {
        const c = common(ctx);
        const body = { period: periodOut(c), granularity: c.gran, ...R.income(db, ctx.user.id, c) };
        reply(ctx, 'income', body, `${c.from}-to-${c.to}`);
      },
    },

    'GET /api/reports/cashflow': {
      auth: true,
      handler: (ctx) => {
        const c = common(ctx);
        const body = { period: periodOut(c), granularity: c.gran, ...R.cashflow(db, ctx.user.id, c) };
        reply(ctx, 'cashflow', body, `${c.from}-to-${c.to}`);
      },
    },

    // &category=<id>|none adds a drill-down for that category
    'GET /api/reports/categories': {
      auth: true,
      handler: (ctx) => {
        const c = common(ctx);
        const category = ctx.query.get('category');
        const body = {
          period: periodOut(c), granularity: c.gran,
          ...R.categories(db, ctx.user.id, { ...c, categoryParam: category && category !== 'all' ? category : null }),
        };
        reply(ctx, 'categories', body, `${c.from}-to-${c.to}`);
      },
    },

    // &account=<id> adds that account's activity over time and its latest transactions
    'GET /api/reports/accounts': {
      auth: true,
      handler: (ctx) => {
        const c = common(ctx);
        const body = { period: periodOut(c), granularity: c.gran, ...R.accountActivity(db, ctx.user.id, c) };
        reply(ctx, 'accounts', body, `${c.from}-to-${c.to}`);
      },
    },

    // ?month=2026-11 (default: this month, so far)
    'GET /api/reports/monthly-summary': {
      auth: true,
      handler: (ctx) => {
        const c = common(ctx, { period: false });
        const month = ctx.query.get('month') || c.today.slice(0, 7);
        if (!B.isMonth(month)) throw httpError(400, 'month must look like 2026-11.');
        const body = R.monthlySummary(db, ctx.user.id, { month, filters: c.filters, today: c.today });
        reply(ctx, 'monthly-summary', body, month);
      },
    },

    // ?months=12 (1 to 120) or months=all: how far back the history goes
    'GET /api/reports/net-worth': {
      auth: true,
      handler: (ctx) => {
        const raw = ctx.query.get('months');
        const months = raw === 'all' ? 'all' : v.clampInt(raw, 1, 120, 12);
        const body = R.netWorth(db, ctx.user.id, { months, today: today() });
        reply(ctx, 'net-worth', body, body.asOf);
      },
    },

    'GET /api/reports/insights': {
      auth: true,
      handler: (ctx) => {
        const t = today();
        sendJson(ctx.res, 200, { asOf: t, insights: R.insights(db, ctx.user.id, ctx.user, t) });
      },
    },
  };
};
