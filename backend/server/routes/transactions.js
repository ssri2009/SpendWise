'use strict';
const { httpError, sendJson } = require('../http');
const { inTransaction } = require('../db');
const v = require('../validate');
const { totalFundsMinor } = require('../funds');
const R = require('../rules');
const { FROM, buildFilter, findOrCreatePayee } = require('../txquery');
const S = require('../splits');

const COLS = `t.id, t.account_id, a.name AS account_name, t.date, t.amount_minor, t.payee_id, p.name AS payee,
  t.category_id, c.name AS category_name, c.icon AS category_icon, t.notes, t.cleared, t.is_split, t.reconciliation_id`;
const LOCKED = 'This transaction is locked because it was reconciled. Undo that reconciliation (Reconcile page → History) to change it.';
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const toJson = (r, splits = []) => ({
  id: Number(r.id),
  accountId: Number(r.account_id),
  accountName: r.account_name,
  date: r.date,
  amountMinor: Number(r.amount_minor),
  payeeId: r.payee_id === null ? null : Number(r.payee_id),
  payee: r.payee || '',
  categoryId: r.category_id === null ? null : Number(r.category_id),
  categoryName: r.category_name || null,
  categoryIcon: r.category_icon || null,
  notes: r.notes,
  cleared: !!r.cleared,
  // A split transaction has no category of its own (categoryId is null): its parts are in `splits`.
  isSplit: !!r.is_split,
  splits: r.is_split ? splits : [],
  reconciled: r.reconciliation_id !== null && r.reconciliation_id !== undefined,
  reconciliationId: r.reconciliation_id === null || r.reconciliation_id === undefined ? null : Number(r.reconciliation_id),
});

module.exports = ({ db }) => {
  const getOne = (userId, id) => {
    const row = db.prepare(`SELECT ${COLS} ${FROM} WHERE t.user_id = ? AND t.id = ?`).get(userId, id);
    if (!row) throw httpError(404, 'Transaction not found.');
    return row;
  };

  const present = (userId, id) => {
    const row = getOne(userId, id);
    return toJson(row, row.is_split ? (S.loadSplits(db, userId, [id]).get(id) || []) : []);
  };

  const ownAccount = (userId, id, { mustBeOpen }) => {
    const a = db.prepare('SELECT id, closed FROM accounts WHERE id = ? AND user_id = ?').get(id, userId);
    if (!a) throw httpError(400, 'That account does not exist.');
    if (mustBeOpen && a.closed) throw httpError(400, 'That account is closed.');
    return Number(a.id);
  };

  const ownCategory = (userId, id) => {
    if (id === null) return null;
    const c = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(id, userId);
    if (!c) throw httpError(400, 'That category does not exist.');
    return Number(c.id);
  };

  const payeeId = (userId, name) => (name ? findOrCreatePayee(db, userId, name) : null);

  return {
    'GET /api/transactions': {
      auth: true,
      handler: (ctx) => {
        const f = buildFilter(ctx.user.id, ctx.query);
        const limit = v.clampInt(ctx.query.get('limit'), 1, 500, 200);
        const offset = v.clampInt(ctx.query.get('offset'), 0, 1e9, 0);
        const rows = db.prepare(
          `SELECT ${COLS} ${FROM} WHERE ${f.where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`
        ).all(...f.params, limit, offset);
        const total = db.prepare(`SELECT COUNT(*) AS c ${FROM} WHERE ${f.where}`).get(...f.params).c;
        const splitsOf = S.loadSplits(db, ctx.user.id, rows.filter((r) => r.is_split).map((r) => Number(r.id)));

        // Summary ignores the income/expense filter so the three cards always add up.
        const sf = buildFilter(ctx.user.id, ctx.query, { skipType: true });
        let s;
        if (sf.categoryFilter) {
          // Filtered to one category: count only the PART of a split transaction that is in that category.
          const cf = sf.categoryFilter;
          s = db.prepare(
            `SELECT COALESCE(SUM(CASE WHEN l.amount_minor > 0 THEN l.amount_minor END), 0) AS income,
                    COALESCE(SUM(CASE WHEN l.amount_minor < 0 THEN -l.amount_minor END), 0) AS expense
               FROM tx_lines l WHERE l.tx_id IN (SELECT t.id ${FROM} WHERE ${sf.where})
                AND ${cf.none ? 'l.category_id IS NULL' : 'l.category_id = ?'}`
          ).get(...sf.params, ...(cf.none ? [] : [cf.id]));
        } else {
          s = db.prepare(
            `SELECT COALESCE(SUM(CASE WHEN t.amount_minor > 0 THEN t.amount_minor END), 0) AS income,
                    COALESCE(SUM(CASE WHEN t.amount_minor < 0 THEN -t.amount_minor END), 0) AS expense ${FROM} WHERE ${sf.where}`
          ).get(...sf.params);
        }

        sendJson(ctx.res, 200, {
          transactions: rows.map((r) => toJson(r, splitsOf.get(Number(r.id)) || [])),
          total: Number(total),
          summary: {
            // Period figures: follow the filters (month, account, category, search...). Opening balances are NOT in these.
            incomeMinor: Number(s.income),
            expenseMinor: Number(s.expense),
            netMinor: Number(s.income) - Number(s.expense),          // "Net This Period"
            // Money you hold right now across all accounts. Ignores every filter. Includes opening balances.
            totalFundsMinor: totalFundsMinor(db, ctx.user.id),        // "Total Funds"
          },
        });
      },
    },

    // Months that have data, newest first. Used by the month picker.
    'GET /api/transactions/months': {
      auth: true,
      handler: (ctx) => {
        const rows = db.prepare('SELECT DISTINCT substr(date, 1, 7) AS m FROM transactions WHERE user_id = ? ORDER BY m DESC').all(ctx.user.id);
        sendJson(ctx.res, 200, { months: rows.map((r) => r.m) });
      },
    },

    'GET /api/transactions/:id': {
      auth: true,
      handler: (ctx) => sendJson(ctx.res, 200, { transaction: present(ctx.user.id, v.paramId(ctx)) }),
    },

    'POST /api/transactions': {
      auth: true, body: true,
      handler: (ctx) => {
        const b = ctx.body;
        const accountId = ownAccount(ctx.user.id, v.intId(b.accountId, 'accountId'), { mustBeOpen: true });
        const date = v.isoDate(b.date);
        const amount = v.minor(b.amountMinor);
        const payeeName = v.optString(b.payee, 'Payee', 60);
        const categoryId = ownCategory(ctx.user.id, v.optId(b.categoryId, 'categoryId'));
        const notes = v.optString(b.notes, 'Notes', 200);
        const cleared = b.cleared === undefined ? 0 : v.boolish(b.cleared, 'cleared');
        // Splits are checked first, so a bad split never leaves a half-made transaction behind.
        const splits = b.splits === undefined || b.splits === null
          ? null : S.checkSplits(b.splits, amount, (id) => ownCategory(ctx.user.id, id));
        if (splits && categoryId !== null) throw v.bad('A split transaction has no single category. Send either categoryId or splits.');

        // Rules run once, on creation, and win over what was typed for the fields they set (see server/rules.js).
        // The payee stays a NAME until the rules are done, so a rule that renames it leaves no stray payee behind.
        const prepared = R.prepare(db, ctx.user.id);
        const run = prepared
          ? R.runRules(prepared.rules, { accountId, amountMinor: amount, payee: payeeName, categoryId, notes, cleared }, prepared.env)
          : { draft: { payee: payeeName, categoryId, notes, cleared }, applied: [] };
        const d = run.draft;

        const id = inTransaction(db, () => {
          const pid = payeeId(ctx.user.id, d.payee);
          // The splits decide the categories, so a rule's "set category" is not applied to a split transaction
          // (its payee / notes / cleared actions still are).
          const newId = Number(db.prepare(
            `INSERT INTO transactions (user_id, account_id, date, amount_minor, payee_id, category_id, notes, cleared)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(ctx.user.id, accountId, date, amount, pid, splits ? null : d.categoryId, d.notes, d.cleared).lastInsertRowid);
          if (splits) S.writeSplits(db, ctx.user.id, newId, splits);
          return newId;
        });
        sendJson(ctx.res, 201, { transaction: present(ctx.user.id, id), rulesApplied: run.applied });
      },
    },

    'PATCH /api/transactions/:id': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const cur = getOne(ctx.user.id, id);
        const b = ctx.body;
        const accountId = b.accountId === undefined
          ? Number(cur.account_id)
          : ownAccount(ctx.user.id, v.intId(b.accountId, 'accountId'), { mustBeOpen: Number(b.accountId) !== Number(cur.account_id) });
        const date = b.date === undefined ? cur.date : v.isoDate(b.date);
        const amount = b.amountMinor === undefined ? Number(cur.amount_minor) : v.minor(b.amountMinor);
        const requestedCategory = b.categoryId === undefined ? undefined : ownCategory(ctx.user.id, v.optId(b.categoryId, 'categoryId'));
        const notes = b.notes === undefined ? cur.notes : v.optString(b.notes, 'Notes', 200);
        const cleared = b.cleared === undefined ? cur.cleared : v.boolish(b.cleared, 'cleared');

        // A reconciled transaction is part of a statement you signed off. What affects the balance is locked;
        // category, payee, notes and the way it is split can still be corrected.
        if (cur.reconciliation_id !== null && (accountId !== Number(cur.account_id) || date !== cur.date
            || amount !== Number(cur.amount_minor) || cleared !== (cur.cleared ? 1 : 0))) {
          throw httpError(409, LOCKED);
        }

        // Work out the splits after this edit: undefined = leave as they are, null = unsplit, array = replace.
        let splits;
        if (b.splits === undefined) {
          splits = undefined;
          if (cur.is_split) {
            if (amount !== Number(cur.amount_minor)) {
              throw v.bad('This transaction is split. Changing its amount means sending the new splits too (they must add up to it).');
            }
            if (requestedCategory !== undefined && requestedCategory !== null) {
              throw v.bad('This transaction is split, so it has no single category. Edit its splits, or send splits: null to unsplit it first.');
            }
          }
        } else if (b.splits === null) {
          splits = null;
        } else {
          splits = S.checkSplits(b.splits, amount, (cid) => ownCategory(ctx.user.id, cid));
          if (requestedCategory !== undefined && requestedCategory !== null) throw v.bad('Send either categoryId or splits, not both.');
        }
        const unsplitCategory = requestedCategory === undefined ? null : requestedCategory;

        inTransaction(db, () => {
          const pid = b.payee === undefined ? cur.payee_id : payeeId(ctx.user.id, v.optString(b.payee, 'Payee', 60));
          const keepCategory = cur.is_split || splits ? null : (requestedCategory === undefined ? cur.category_id : requestedCategory);
          db.prepare(
            `UPDATE transactions SET account_id = ?, date = ?, amount_minor = ?, payee_id = ?, category_id = ?,
               notes = ?, cleared = ?, updated_at = ${NOW} WHERE id = ? AND user_id = ?`
          ).run(accountId, date, amount, pid, keepCategory, notes, cleared, id, ctx.user.id);
          if (Array.isArray(splits)) S.writeSplits(db, ctx.user.id, id, splits);
          else if (splits === null && cur.is_split) S.removeSplits(db, ctx.user.id, id, unsplitCategory);
          else if (splits === null && !cur.is_split && requestedCategory !== undefined) {
            db.prepare('UPDATE transactions SET category_id = ? WHERE id = ? AND user_id = ?').run(requestedCategory, id, ctx.user.id);
          }
        });
        sendJson(ctx.res, 200, { transaction: present(ctx.user.id, id) });
      },
    },

    'DELETE /api/transactions/:id': {
      auth: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const cur = getOne(ctx.user.id, id);
        if (cur.reconciliation_id !== null) throw httpError(409, LOCKED);
        db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, ctx.user.id);   // its splits go with it (ON DELETE CASCADE)
        sendJson(ctx.res, 200, { ok: true });
      },
    },

    // Create or replace all the splits of a transaction. The amounts must add up to the transaction's amount.
    // { splits: [{categoryId, amountMinor, notes?}, ...] }
    'PUT /api/transactions/:id/splits': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const cur = getOne(ctx.user.id, id);
        const clean = S.checkSplits(ctx.body.splits, Number(cur.amount_minor), (cid) => ownCategory(ctx.user.id, cid));
        inTransaction(db, () => S.writeSplits(db, ctx.user.id, id, clean));
        sendJson(ctx.res, 200, { transaction: present(ctx.user.id, id) });
      },
    },

    // Delete ONE split. Its amount goes to another split (?moveTo=<splitId>); with only one other split left that is automatic
    // and the transaction becomes a normal one again.
    'DELETE /api/transactions/:id/splits/:splitId': {
      auth: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const splitId = v.paramId(ctx, 'splitId');
        const cur = getOne(ctx.user.id, id);
        if (!cur.is_split) throw httpError(404, 'This transaction is not split.');
        const raw = ctx.query.get('moveTo');
        const moveTo = raw === null || raw === '' ? null : v.intId(raw, 'moveTo');
        const result = inTransaction(db, () => S.deleteOneSplit(db, ctx.user.id, id, splitId, moveTo));
        sendJson(ctx.res, 200, { transaction: present(ctx.user.id, id), unsplit: result.unsplit });
      },
    },

    // { ids: [...], action: 'delete' }  or  { ids, action: 'update', changes: { categoryId, accountId, date, cleared } }
    'POST /api/transactions/bulk': {
      auth: true, body: true,
      handler: (ctx) => {
        const { ids, action, changes } = ctx.body;
        if (!Array.isArray(ids) || !ids.length || ids.length > 500) throw v.bad('Select between 1 and 500 transactions.');
        const list = [...new Set(ids.map((i) => v.intId(i, 'id')))];
        const marks = list.map(() => '?').join(',');
        const owned = db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND id IN (${marks})`).get(ctx.user.id, ...list).c;
        if (owned !== list.length) throw httpError(404, 'One or more transactions were not found.');

        const locked = db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND reconciliation_id IS NOT NULL AND id IN (${marks})`)
          .get(ctx.user.id, ...list).c;

        if (action === 'delete') {
          if (locked) throw httpError(409, `${locked} of the selected transaction(s) are reconciled and locked. Undo that reconciliation first, or deselect them.`);
          db.prepare(`DELETE FROM transactions WHERE user_id = ? AND id IN (${marks})`).run(ctx.user.id, ...list);
          return sendJson(ctx.res, 200, { affected: list.length });
        }
        if (action !== 'update' || !changes || typeof changes !== 'object') throw v.bad('action must be "delete" or "update".');

        const sets = [];
        const vals = [];
        let categorySet = false;
        let newCategory = null;
        if (changes.categoryId !== undefined) { categorySet = true; newCategory = ownCategory(ctx.user.id, v.optId(changes.categoryId, 'categoryId')); }
        if (changes.accountId !== undefined) { sets.push('account_id = ?'); vals.push(ownAccount(ctx.user.id, v.intId(changes.accountId, 'accountId'), { mustBeOpen: true })); }
        if (changes.date !== undefined) { sets.push('date = ?'); vals.push(v.isoDate(changes.date)); }
        if (changes.cleared !== undefined) { sets.push('cleared = ?'); vals.push(v.boolish(changes.cleared, 'cleared')); }
        if (!sets.length && !categorySet) throw v.bad('Nothing to change.');

        // Reconciled transactions keep their account, date and cleared flag (category changes are fine).
        const clearing = changes.cleared !== undefined && vals[sets.indexOf('cleared = ?')] === 0;
        if (locked && (changes.accountId !== undefined || changes.date !== undefined || clearing)) {
          throw httpError(409, `${locked} of the selected transaction(s) are reconciled and locked. Undo that reconciliation first, or deselect them.`);
        }
        // A split transaction has several categories, so a bulk "set category" leaves it alone (and says so).
        const splitCount = categorySet
          ? db.prepare(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ? AND is_split = 1 AND id IN (${marks})`).get(ctx.user.id, ...list).c : 0;
        inTransaction(db, () => {
          if (sets.length) {
            db.prepare(`UPDATE transactions SET ${sets.join(', ')}, updated_at = ${NOW} WHERE user_id = ? AND id IN (${marks})`)
              .run(...vals, ctx.user.id, ...list);
          }
          if (categorySet) {
            db.prepare(`UPDATE transactions SET category_id = ?, updated_at = ${NOW} WHERE user_id = ? AND is_split = 0 AND id IN (${marks})`)
              .run(newCategory, ctx.user.id, ...list);
          }
        });
        sendJson(ctx.res, 200, { affected: sets.length ? list.length : list.length - splitCount, skippedSplit: splitCount });
      },
    },
  };
};
