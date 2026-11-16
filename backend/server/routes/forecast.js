'use strict';
// Read-only views: bills, calendar, cash-flow forecast. All scoped to the signed-in user.
const { sendJson } = require('../http');
const v = require('../validate');
const S = require('../schedules');
const F = require('../forecast');

module.exports = ({ db, clock }) => {
  const today = () => clock.today();
  const prep = (ctx) => {
    S.runDue(db, ctx.user.id, today());          // so auto-posted items and the approval queue are current
    const raw = ctx.query.get('account');
    return raw === null || raw === '' || raw === 'all' ? null : v.intId(raw, 'account');
  };

  return {
    // ?days=7|30|90 (any 1 to 365). Always also returns the 7 / 30 / 90 summaries in `horizons`. ?account=<id> limits it to one account.
    'GET /api/forecast': {
      auth: true,
      handler: (ctx) => {
        const accountId = prep(ctx);
        const days = F.parseDays(ctx.query.get('days'));
        sendJson(ctx.res, 200, { forecast: F.forecast(db, ctx.user.id, today(), { days, accountId }) });
      },
    },

    // ?upcomingDays=30&paidDays=60
    'GET /api/bills': {
      auth: true,
      handler: (ctx) => {
        const accountId = prep(ctx);
        const upcomingDays = v.clampInt(ctx.query.get('upcomingDays'), 1, 365, 30);
        const paidDays = v.clampInt(ctx.query.get('paidDays'), 1, 730, 60);
        sendJson(ctx.res, 200, F.bills(db, ctx.user.id, today(), { upcomingDays, paidDays, accountId }));
      },
    },

    // ?month=2026-12
    'GET /api/calendar': {
      auth: true,
      handler: (ctx) => {
        const accountId = prep(ctx);
        const month = ctx.query.get('month') || today().slice(0, 7);
        sendJson(ctx.res, 200, F.calendar(db, ctx.user.id, today(), month, { accountId }));
      },
    },
  };
};
