'use strict';
const { httpError, sendJson } = require('../http');
const { inTransaction } = require('../db');
const v = require('../validate');
const B = require('../budget');

module.exports = ({ db }) => ({
  // One month of the envelope budget: To Budget, and Assigned / Activity / Available per category.
  'GET /api/budget/:month': {
    auth: true,
    handler: (ctx) => sendJson(ctx.res, 200, B.monthView(db, ctx.user.id, B.needMonth(ctx.params.month))),
  },

  // { assignedMinor } sets what this month assigns to the category; { carryover } toggles rolling overspending forward.
  'PATCH /api/budget/:month/categories/:id': {
    auth: true, body: true,
    handler: (ctx) => {
      const month = B.needMonth(ctx.params.month);
      const id = v.paramId(ctx);
      const b = ctx.body;
      if (b.assignedMinor === undefined && b.carryover === undefined) throw v.bad('Nothing to change.');
      const assigned = b.assignedMinor === undefined ? undefined : v.minor(b.assignedMinor, 'Assigned amount', { allowZero: true });
      const carry = b.carryover === undefined ? undefined : v.boolish(b.carryover, 'carryover');
      inTransaction(db, () => {
        if (carry !== undefined) B.setCarryover(db, ctx.user, month, id, !!carry);
        if (assigned !== undefined) B.setAssigned(db, ctx.user, month, id, assigned);
      });
      sendJson(ctx.res, 200, B.monthView(db, ctx.user.id, month));
    },
  },

  // Move money between two categories in one month. Both sides and the audit row succeed or fail together.
  'POST /api/budget/:month/transfers': {
    auth: true, body: true,
    handler: (ctx) => {
      const month = B.needMonth(ctx.params.month);
      const fromId = v.intId(ctx.body.fromCategoryId, 'fromCategoryId');
      const toId = v.intId(ctx.body.toCategoryId, 'toCategoryId');
      const amount = v.minor(ctx.body.amountMinor, 'Amount');
      if (amount <= 0) throw httpError(400, 'Amount must be more than zero.');
      const note = v.optString(ctx.body.note, 'Note', 200);
      const transferId = inTransaction(db, () => B.transfer(db, ctx.user, month, fromId, toId, amount, note));
      sendJson(ctx.res, 201, { transferId, budget: B.monthView(db, ctx.user.id, month) });
    },
  },

  // Audit trail, newest first. ?month=2026-11 limits it to one month.
  'GET /api/budget-transfers': {
    auth: true,
    handler: (ctx) => {
      const m = ctx.query.get('month');
      const month = m ? B.needMonth(m) : null;
      const limit = v.clampInt(ctx.query.get('limit'), 1, 500, 200);
      sendJson(ctx.res, 200, { transfers: B.listTransfers(db, ctx.user.id, { month, limit }) });
    },
  },
});
