'use strict';
const { httpError, sendJson } = require('../http');
const v = require('../validate');
const { totalFundsMinor } = require('../funds');

const TYPES = ['checking', 'savings', 'cash', 'credit', 'investment', 'loan', 'other'];

function accountType(t) {
  if (!TYPES.includes(t)) throw v.bad(`Account type must be one of: ${TYPES.join(', ')}.`);
  return t;
}

module.exports = ({ db }) => {
  const toJson = (r) => ({
    id: Number(r.id),
    name: r.name,
    type: r.type,
    offbudget: !!r.offbudget,
    closed: !!r.closed,
    openingBalanceMinor: Number(r.opening_balance_minor),
    balanceMinor: Number(r.opening_balance_minor) + Number(r.tx_sum || 0),
    transactionCount: Number(r.tx_count || 0),
    sortOrder: Number(r.sort_order),
  });

  const SELECT = `SELECT a.*, COALESCE(SUM(t.amount_minor), 0) AS tx_sum, COUNT(t.id) AS tx_count
                    FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id`;

  const getOwn = (userId, id) => {
    const row = db.prepare(`${SELECT} WHERE a.user_id = ? AND a.id = ? GROUP BY a.id`).get(userId, id);
    if (!row) throw httpError(404, 'Account not found.');
    return row;
  };

  const nameTaken = (userId, name, exceptId = 0) =>
    !!db.prepare('SELECT 1 FROM accounts WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(userId, name, exceptId);

  return {
    'GET /api/accounts': {
      auth: true,
      handler: (ctx) => {
        const rows = db.prepare(`${SELECT} WHERE a.user_id = ? GROUP BY a.id ORDER BY a.closed, a.sort_order, a.id`).all(ctx.user.id);
        sendJson(ctx.res, 200, { accounts: rows.map(toJson), totalFundsMinor: totalFundsMinor(db, ctx.user.id) });
      },
    },

    'POST /api/accounts': {
      auth: true, body: true,
      handler: (ctx) => {
        const b = ctx.body;
        const name = v.reqString(b.name, 'Name', 40);
        const type = accountType(b.type ?? 'checking');
        const offbudget = b.offbudget === undefined ? 0 : v.boolish(b.offbudget, 'offbudget');
        const opening = b.openingBalanceMinor === undefined ? 0 : v.minor(b.openingBalanceMinor, 'Opening balance', { allowZero: true });
        if (nameTaken(ctx.user.id, name)) throw httpError(409, 'You already have an account with that name.');
        const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts WHERE user_id = ?').get(ctx.user.id).n;
        const id = Number(db.prepare(
          'INSERT INTO accounts (user_id, name, type, offbudget, opening_balance_minor, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(ctx.user.id, name, type, offbudget, opening, next).lastInsertRowid);
        sendJson(ctx.res, 201, { account: toJson(getOwn(ctx.user.id, id)) });
      },
    },

    'PATCH /api/accounts/:id': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const cur = getOwn(ctx.user.id, id);
        const b = ctx.body;
        const name = b.name === undefined ? cur.name : v.reqString(b.name, 'Name', 40);
        const type = b.type === undefined ? cur.type : accountType(b.type);
        const offbudget = b.offbudget === undefined ? cur.offbudget : v.boolish(b.offbudget, 'offbudget');
        const closed = b.closed === undefined ? cur.closed : v.boolish(b.closed, 'closed');
        const opening = b.openingBalanceMinor === undefined
          ? cur.opening_balance_minor : v.minor(b.openingBalanceMinor, 'Opening balance', { allowZero: true });
        if (nameTaken(ctx.user.id, name, id)) throw httpError(409, 'You already have an account with that name.');
        if (closed && !cur.closed) {
          const open = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ? AND closed = 0 AND id != ?').get(ctx.user.id, id).c;
          if (!open) throw httpError(409, 'You need at least one open account.');
        }
        db.prepare(
          'UPDATE accounts SET name = ?, type = ?, offbudget = ?, closed = ?, opening_balance_minor = ? WHERE id = ? AND user_id = ?'
        ).run(name, type, offbudget, closed, opening, id, ctx.user.id);
        sendJson(ctx.res, 200, { account: toJson(getOwn(ctx.user.id, id)) });
      },
    },

    'DELETE /api/accounts/:id': {
      auth: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const cur = getOwn(ctx.user.id, id);
        if (Number(cur.tx_count) > 0) {
          throw httpError(409, `This account has ${cur.tx_count} transaction(s). Close it instead, or move or delete them first.`);
        }
        const open = db.prepare('SELECT COUNT(*) AS c FROM accounts WHERE user_id = ? AND closed = 0 AND id != ?').get(ctx.user.id, id).c;
        if (!open) throw httpError(409, 'You need at least one open account.');
        const sched = db.prepare('SELECT COUNT(*) AS c FROM schedules WHERE user_id = ? AND account_id = ?').get(ctx.user.id, id).c;
        if (sched > 0) {
          throw httpError(409, `This account is used by ${sched} schedule${sched === 1 ? '' : 's'}. Move or delete ${sched === 1 ? 'it' : 'them'} first (Schedules page).`);
        }
        db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(id, ctx.user.id);
        sendJson(ctx.res, 200, { ok: true });
      },
    },
  };
};
