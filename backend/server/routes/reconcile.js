'use strict';
// Account reconciliation: "does SpendWise agree with my bank statement?"
//
// THE RULES (README has the same list):
//   * Cleared balance   = the account's opening balance + every CLEARED transaction. Uncleared transactions are shown
//                         separately and never counted. (Opening balance is treated as already cleared.)
//   * You type the balance printed on the statement and its date. Difference = statement - cleared balance.
//   * Difference 0  -> finishing locks every cleared, not-yet-reconciled transaction of that account.
//   * Difference != 0 -> finishing is refused (409, code "discrepancy") unless you ask for an adjustment:
//                         one cleared transaction for exactly the difference ("Reconciliation Balance Adjustment") is added,
//                         then everything is locked. It has no category, so it moves To Budget like any uncategorized amount.
//   * Locked (reconciled) transactions cannot be deleted, moved, re-dated, re-valued or un-cleared; category, payee, notes and
//     splits can still be fixed. Undoing the NEWEST reconciliation of an account unlocks its transactions and removes its adjustment.
//   * Every reconciliation is kept as history: statement date, when you did it, balances, difference, adjustment, how many transactions.

const { httpError, sendJson } = require('../http');
const { inTransaction } = require('../db');
const v = require('../validate');
const { findOrCreatePayee } = require('../txquery');

const ADJUSTMENT_PAYEE = 'Reconciliation Balance Adjustment';

module.exports = ({ db }) => {
  const ownAccount = (userId, id) => {
    const a = db.prepare('SELECT id, name, closed, opening_balance_minor FROM accounts WHERE id = ? AND user_id = ?').get(id, userId);
    if (!a) throw httpError(404, 'Account not found.');   // someone else's account looks exactly like a missing one
    return a;
  };

  function balances(userId, account) {
    const r = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN cleared = 1 THEN amount_minor END), 0) AS cleared,
              COALESCE(SUM(CASE WHEN cleared = 0 THEN amount_minor END), 0) AS uncleared,
              COUNT(CASE WHEN cleared = 1 THEN 1 END) AS cleared_n,
              COUNT(CASE WHEN cleared = 0 THEN 1 END) AS uncleared_n,
              COUNT(CASE WHEN reconciliation_id IS NOT NULL THEN 1 END) AS locked_n
         FROM transactions WHERE user_id = ? AND account_id = ?`
    ).get(userId, account.id);
    const opening = Number(account.opening_balance_minor);
    return {
      openingBalanceMinor: opening,
      clearedBalanceMinor: opening + Number(r.cleared),
      unclearedBalanceMinor: Number(r.uncleared),
      balanceMinor: opening + Number(r.cleared) + Number(r.uncleared),
      clearedCount: Number(r.cleared_n),
      unclearedCount: Number(r.uncleared_n),
      lockedCount: Number(r.locked_n),
    };
  }

  const latestId = (userId, accountId) => {
    const r = db.prepare('SELECT MAX(id) AS id FROM reconciliations WHERE user_id = ? AND account_id = ?').get(userId, accountId);
    return r.id === null ? null : Number(r.id);
  };

  const recToJson = (r, newest) => ({
    id: Number(r.id),
    accountId: Number(r.account_id),
    accountName: r.account_name,
    statementDate: r.statement_date,
    statementBalanceMinor: Number(r.statement_balance_minor),
    clearedBalanceMinor: Number(r.cleared_balance_minor),   // SpendWise's cleared balance before any adjustment
    differenceMinor: Number(r.difference_minor),
    adjustmentMinor: Number(r.adjustment_minor),
    adjustmentTransactionId: r.adjustment_tx_id === null ? null : Number(r.adjustment_tx_id),
    transactionCount: Number(r.transaction_count),
    note: r.note,
    reconciledAt: r.created_at,
    canUndo: newest === Number(r.id),
  });

  const REC_SELECT = `SELECT r.*, a.name AS account_name FROM reconciliations r JOIN accounts a ON a.id = r.account_id`;

  const getRec = (userId, id) => {
    const r = db.prepare(`${REC_SELECT} WHERE r.user_id = ? AND r.id = ?`).get(userId, id);
    if (!r) throw httpError(404, 'Reconciliation not found.');
    return r;
  };

  const txRows = (userId, where, args, limit = 1000) => db.prepare(
    `SELECT t.id, t.date, t.amount_minor, t.cleared, t.is_split, t.reconciliation_id, COALESCE(p.name, '') AS payee, c.name AS category_name
       FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.user_id = ? AND ${where} ORDER BY t.date DESC, t.id DESC LIMIT ?`
  ).all(userId, ...args, limit).map((t) => ({
    id: Number(t.id), date: t.date, amountMinor: Number(t.amount_minor), cleared: !!t.cleared, isSplit: !!t.is_split,
    reconciled: t.reconciliation_id !== null, payee: t.payee, categoryName: t.category_name || null,
  }));

  return {
    // Where this account stands: cleared vs uncleared balances, and the transactions still open (not locked by an earlier reconciliation).
    'GET /api/accounts/:id/reconciliation': {
      auth: true,
      handler: (ctx) => {
        const a = ownAccount(ctx.user.id, v.paramId(ctx));
        const last = db.prepare(`${REC_SELECT} WHERE r.user_id = ? AND r.account_id = ? ORDER BY r.id DESC LIMIT 1`).get(ctx.user.id, a.id);
        sendJson(ctx.res, 200, {
          account: { id: Number(a.id), name: a.name, closed: !!a.closed },
          ...balances(ctx.user.id, a),
          lastReconciliation: last ? recToJson(last, Number(last.id)) : null,
          transactions: txRows(ctx.user.id, 't.account_id = ? AND t.reconciliation_id IS NULL', [a.id]),
        });
      },
    },

    // { statementBalanceMinor, statementDate, adjust?: boolean, note? }
    'POST /api/accounts/:id/reconcile': {
      auth: true, body: true,
      handler: (ctx) => {
        const userId = ctx.user.id;
        const a = ownAccount(userId, v.paramId(ctx));
        const b = ctx.body;
        const statement = v.minor(b.statementBalanceMinor, 'Statement balance', { allowZero: true });
        const statementDate = v.isoDate(b.statementDate, 'Statement date');
        const adjust = b.adjust === undefined ? false : !!v.boolish(b.adjust, 'adjust');
        const note = v.optString(b.note, 'Note', 200);

        const bal = balances(userId, a);
        const diff = statement - bal.clearedBalanceMinor;
        if (diff !== 0 && !adjust) {
          return sendJson(ctx.res, 409, {
            error: 'Your cleared balance does not match the statement. Mark the missing transactions as cleared, or add an adjustment.',
            code: 'discrepancy',
            statementBalanceMinor: statement, clearedBalanceMinor: bal.clearedBalanceMinor, differenceMinor: diff,
          });
        }
        const toLock = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND account_id = ? AND cleared = 1 AND reconciliation_id IS NULL')
          .get(userId, a.id).c;
        if (toLock === 0 && diff === 0) {
          throw httpError(409, 'Nothing new to reconcile: there are no cleared transactions since the last reconciliation.');
        }

        const id = inTransaction(db, () => {
          let adjTx = null;
          if (diff !== 0) {
            const pid = findOrCreatePayee(db, userId, ADJUSTMENT_PAYEE);
            adjTx = Number(db.prepare(
              `INSERT INTO transactions (user_id, account_id, date, amount_minor, payee_id, category_id, notes, cleared)
               VALUES (?, ?, ?, ?, ?, NULL, ?, 1)`
            ).run(userId, a.id, statementDate, diff, pid, `Adjustment so the account matches the statement of ${statementDate}`).lastInsertRowid);
          }
          const count = Number(db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND account_id = ? AND cleared = 1 AND reconciliation_id IS NULL')
            .get(userId, a.id).c);
          const recId = Number(db.prepare(
            `INSERT INTO reconciliations (user_id, account_id, statement_date, statement_balance_minor, cleared_balance_minor, difference_minor,
               adjustment_minor, adjustment_tx_id, transaction_count, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(userId, a.id, statementDate, statement, bal.clearedBalanceMinor, diff, diff, adjTx, count, note).lastInsertRowid);
          db.prepare('UPDATE transactions SET reconciliation_id = ? WHERE user_id = ? AND account_id = ? AND cleared = 1 AND reconciliation_id IS NULL')
            .run(recId, userId, a.id);
          return recId;
        });
        sendJson(ctx.res, 201, {
          reconciliation: recToJson(getRec(userId, id), id),
          ...balances(userId, a),
        });
      },
    },

    // History, newest first. ?account=ID narrows it to one account.
    'GET /api/reconciliations': {
      auth: true,
      handler: (ctx) => {
        const raw = ctx.query.get('account');
        let rows;
        if (raw) {
          const a = ownAccount(ctx.user.id, v.intId(raw, 'account'));
          rows = db.prepare(`${REC_SELECT} WHERE r.user_id = ? AND r.account_id = ? ORDER BY r.id DESC LIMIT 500`).all(ctx.user.id, a.id);
        } else {
          rows = db.prepare(`${REC_SELECT} WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 500`).all(ctx.user.id);
        }
        const newest = new Map();
        for (const r of db.prepare('SELECT account_id, MAX(id) AS id FROM reconciliations WHERE user_id = ? GROUP BY account_id').all(ctx.user.id)) {
          newest.set(Number(r.account_id), Number(r.id));
        }
        sendJson(ctx.res, 200, { reconciliations: rows.map((r) => recToJson(r, newest.get(Number(r.account_id)))) });
      },
    },

    // One reconciliation and the transactions it locked in.
    'GET /api/reconciliations/:id': {
      auth: true,
      handler: (ctx) => {
        const r = getRec(ctx.user.id, v.paramId(ctx));
        sendJson(ctx.res, 200, {
          reconciliation: recToJson(r, latestId(ctx.user.id, Number(r.account_id))),
          transactions: txRows(ctx.user.id, 't.reconciliation_id = ?', [r.id], 5000),
        });
      },
    },

    // Undo: only the NEWEST reconciliation of an account (older ones sit under it).
    'DELETE /api/reconciliations/:id': {
      auth: true,
      handler: (ctx) => {
        const userId = ctx.user.id;
        const r = getRec(userId, v.paramId(ctx));
        if (latestId(userId, Number(r.account_id)) !== Number(r.id)) {
          throw httpError(409, 'Only the newest reconciliation of an account can be undone. Undo the later ones first.');
        }
        inTransaction(db, () => {
          if (r.adjustment_tx_id !== null) db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(r.adjustment_tx_id, userId);
          db.prepare('UPDATE transactions SET reconciliation_id = NULL WHERE user_id = ? AND reconciliation_id = ?').run(userId, r.id);
          db.prepare('DELETE FROM reconciliations WHERE id = ? AND user_id = ?').run(r.id, userId);
        });
        sendJson(ctx.res, 200, { ok: true });
      },
    },
  };
};
