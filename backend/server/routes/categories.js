'use strict';
const { httpError, sendJson } = require('../http');
const { inTransaction } = require('../db');
const v = require('../validate');
const { mergeAssignments } = require('../budget');
const { rewriteRefs } = require('../rules');

module.exports = ({ db }) => {
  const getGroup = (userId, id) => {
    const g = db.prepare('SELECT * FROM category_groups WHERE id = ? AND user_id = ?').get(id, userId);
    if (!g) throw httpError(404, 'Category group not found.');
    return g;
  };
  const getCat = (userId, id) => {
    const c = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id, userId);
    if (!c) throw httpError(404, 'Category not found.');
    return c;
  };
  // A category is "used" by a transaction directly, or by one of the splits of a split transaction.
  const usage = (catId) => db.prepare(
    `SELECT (SELECT COUNT(*) FROM transactions WHERE category_id = ?)
          + (SELECT COUNT(DISTINCT transaction_id) FROM transaction_splits WHERE category_id = ?) AS c`).get(catId, catId).c;
  const nameInGroup = (groupId, name, exceptId = 0) =>
    !!db.prepare('SELECT 1 FROM categories WHERE group_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(groupId, name, exceptId);

  function tree(userId) {
    const groups = db.prepare('SELECT * FROM category_groups WHERE user_id = ? ORDER BY sort_order, id').all(userId);
    const cats = db.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id)
                 + (SELECT COUNT(DISTINCT s.transaction_id) FROM transaction_splits s WHERE s.category_id = c.id) AS uses
         FROM categories c WHERE c.user_id = ? ORDER BY c.sort_order, c.id`
    ).all(userId);
    return groups.map((g) => ({
      id: Number(g.id), name: g.name, isIncome: !!g.is_income, hidden: !!g.hidden, sortOrder: Number(g.sort_order),
      categories: cats.filter((c) => c.group_id === g.id).map((c) => ({
        id: Number(c.id), groupId: Number(c.group_id), name: c.name, icon: c.icon,
        hidden: !!c.hidden, sortOrder: Number(c.sort_order), transactionCount: Number(c.uses),
      })),
    }));
  }

  const send = (ctx, status = 200) => sendJson(ctx.res, status, { groups: tree(ctx.user.id) });
  const catById = (userId, id) => tree(userId).flatMap((g) => g.categories).find((c) => c.id === id);

  /** Move every reference from one category to another (used by merge and delete-with-move). */
  function reassign(userId, fromId, toId) {
    db.prepare('UPDATE transactions SET category_id = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE user_id = ? AND category_id = ?')
      .run(toId, userId, fromId);
    db.prepare('UPDATE transaction_splits SET category_id = ? WHERE user_id = ? AND category_id = ?').run(toId, userId, fromId);
    db.prepare('UPDATE payees SET default_category_id = ? WHERE user_id = ? AND default_category_id = ?').run(toId, userId, fromId);
    db.prepare('UPDATE schedules SET category_id = ? WHERE user_id = ? AND category_id = ?').run(toId, userId, fromId);
    // Budget money assigned to the old category follows the transactions into the new one.
    if (toId !== null) mergeAssignments(db, userId, fromId, toId);
    // Rules that set the old category now set the new one.
    if (toId !== null) rewriteRefs(db, userId, 'category', fromId, toId);
  }

  return {
    'GET /api/categories': { auth: true, handler: (ctx) => send(ctx) },

    /* ----- groups ----- */
    'POST /api/category-groups': {
      auth: true, body: true,
      handler: (ctx) => {
        const name = v.reqString(ctx.body.name, 'Name', 40);
        const isIncome = ctx.body.isIncome === undefined ? 0 : v.boolish(ctx.body.isIncome, 'isIncome');
        if (db.prepare('SELECT 1 FROM category_groups WHERE user_id = ? AND name = ? COLLATE NOCASE').get(ctx.user.id, name)) {
          throw httpError(409, 'You already have a group with that name.');
        }
        const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM category_groups WHERE user_id = ?').get(ctx.user.id).n;
        db.prepare('INSERT INTO category_groups (user_id, name, is_income, sort_order) VALUES (?, ?, ?, ?)').run(ctx.user.id, name, isIncome, next);
        send(ctx, 201);
      },
    },

    // Put the groups in this order. Must list every one of your groups exactly once (all or nothing).
    'POST /api/category-groups/reorder': {
      auth: true, body: true,
      handler: (ctx) => {
        const ids = ctx.body.ids;
        if (!Array.isArray(ids) || !ids.length || ids.length > 200) throw v.bad('ids must be a list of your groups.');
        const parsed = ids.map((x) => v.intId(x, 'id'));
        const mine = db.prepare('SELECT id FROM category_groups WHERE user_id = ?').all(ctx.user.id).map((r) => Number(r.id));
        if (new Set(parsed).size !== parsed.length || parsed.length !== mine.length || !parsed.every((id) => mine.includes(id))) {
          throw v.bad('The list must contain each of your groups exactly once.');
        }
        const upd = db.prepare('UPDATE category_groups SET sort_order = ? WHERE id = ? AND user_id = ?');
        inTransaction(db, () => parsed.forEach((id, i) => upd.run(i, id, ctx.user.id)));
        send(ctx);
      },
    },

    'PATCH /api/category-groups/:id': {
      auth: true, body: true,
      handler: (ctx) => {
        const g = getGroup(ctx.user.id, v.paramId(ctx));
        const name = ctx.body.name === undefined ? g.name : v.reqString(ctx.body.name, 'Name', 40);
        const hidden = ctx.body.hidden === undefined ? g.hidden : v.boolish(ctx.body.hidden, 'hidden');
        if (db.prepare('SELECT 1 FROM category_groups WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(ctx.user.id, name, g.id)) {
          throw httpError(409, 'You already have a group with that name.');
        }
        db.prepare('UPDATE category_groups SET name = ?, hidden = ? WHERE id = ? AND user_id = ?').run(name, hidden, g.id, ctx.user.id);
        send(ctx);
      },
    },

    'DELETE /api/category-groups/:id': {
      auth: true,
      handler: (ctx) => {
        const g = getGroup(ctx.user.id, v.paramId(ctx));
        const n = db.prepare('SELECT COUNT(*) AS c FROM categories WHERE group_id = ?').get(g.id).c;
        if (n) throw httpError(409, 'Move or delete the categories in this group first.');
        db.prepare('DELETE FROM category_groups WHERE id = ? AND user_id = ?').run(g.id, ctx.user.id);
        send(ctx);
      },
    },

    /* ----- categories ----- */
    'POST /api/categories': {
      auth: true, body: true,
      handler: (ctx) => {
        const g = getGroup(ctx.user.id, v.intId(ctx.body.groupId, 'groupId'));
        const name = v.reqString(ctx.body.name, 'Name', 40);
        const ic = ctx.body.icon === undefined ? '📦' : v.icon(ctx.body.icon);
        if (nameInGroup(g.id, name)) throw httpError(409, 'That group already has a category with this name.');
        const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE group_id = ?').get(g.id).n;
        const id = Number(db.prepare(
          'INSERT INTO categories (user_id, group_id, name, icon, sort_order) VALUES (?, ?, ?, ?, ?)'
        ).run(ctx.user.id, g.id, name, ic, next).lastInsertRowid);
        sendJson(ctx.res, 201, { category: catById(ctx.user.id, id), groups: tree(ctx.user.id) });
      },
    },

    'POST /api/categories/reorder': {
      auth: true, body: true,
      handler: (ctx) => {
        const items = ctx.body.items;
        if (!Array.isArray(items) || !items.length || items.length > 500) throw v.bad('items must be a list of 1 to 500 entries.');
        const seen = new Set();
        const parsed = items.map((it) => {
          const id = v.intId(it && it.id, 'id');
          if (seen.has(id)) throw v.bad('Duplicate category in list.');
          seen.add(id);
          return { id, groupId: v.intId(it.groupId, 'groupId'), sortOrder: v.minor(it.sortOrder, 'sortOrder', { allowZero: true }) };
        });
        // Everything must belong to this user, or nothing changes.
        for (const it of parsed) { getCat(ctx.user.id, it.id); getGroup(ctx.user.id, it.groupId); }
        const upd = db.prepare('UPDATE categories SET group_id = ?, sort_order = ? WHERE id = ? AND user_id = ?');
        inTransaction(db, () => {
          for (const it of parsed) {
            const cur = getCat(ctx.user.id, it.id);
            if (cur.group_id !== it.groupId && nameInGroup(it.groupId, cur.name, cur.id)) {
              throw httpError(409, `"${cur.name}" already exists in the group you dropped it into.`);
            }
            upd.run(it.groupId, it.sortOrder, it.id, ctx.user.id);
          }
        });
        send(ctx);
      },
    },

    'PATCH /api/categories/:id': {
      auth: true, body: true,
      handler: (ctx) => {
        const c = getCat(ctx.user.id, v.paramId(ctx));
        const b = ctx.body;
        const name = b.name === undefined ? c.name : v.reqString(b.name, 'Name', 40);
        const ic = b.icon === undefined ? c.icon : v.icon(b.icon);
        const hidden = b.hidden === undefined ? c.hidden : v.boolish(b.hidden, 'hidden');
        const groupId = b.groupId === undefined ? c.group_id : getGroup(ctx.user.id, v.intId(b.groupId, 'groupId')).id;
        if (nameInGroup(groupId, name, c.id)) throw httpError(409, 'That group already has a category with this name.');
        db.prepare('UPDATE categories SET name = ?, icon = ?, hidden = ?, group_id = ? WHERE id = ? AND user_id = ?')
          .run(name, ic, hidden, groupId, c.id, ctx.user.id);
        send(ctx);
      },
    },

    'POST /api/categories/:id/merge': {
      auth: true, body: true,
      handler: (ctx) => {
        const from = getCat(ctx.user.id, v.paramId(ctx));
        const to = getCat(ctx.user.id, v.intId(ctx.body.targetId, 'targetId'));
        if (from.id === to.id) throw v.bad('Pick a different category to merge into.');
        inTransaction(db, () => {
          reassign(ctx.user.id, from.id, to.id);
          db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(from.id, ctx.user.id);
        });
        send(ctx);
      },
    },

    // ?moveTo=<id> moves its transactions first; ?moveTo=none leaves them uncategorized.
    'DELETE /api/categories/:id': {
      auth: true,
      handler: (ctx) => {
        const c = getCat(ctx.user.id, v.paramId(ctx));
        const uses = usage(c.id);
        const moveToRaw = ctx.query.get('moveTo');
        let target = null;
        if (uses > 0) {
          if (!moveToRaw) {
            throw httpError(409, `"${c.name}" is used by ${uses} transaction(s). Choose where to move them (or "none" for uncategorized).`);
          }
          if (moveToRaw !== 'none') {
            target = getCat(ctx.user.id, v.intId(moveToRaw, 'moveTo'));
            if (target.id === c.id) throw v.bad('Pick a different category to move them to.');
          }
        } else if (moveToRaw && moveToRaw !== 'none') {
          // No transactions to move, but the caller named a target: budget money assigned here goes there too.
          target = getCat(ctx.user.id, v.intId(moveToRaw, 'moveTo'));
          if (target.id === c.id) throw v.bad('Pick a different category to move them to.');
        }
        inTransaction(db, () => {
          if (uses > 0) reassign(ctx.user.id, c.id, target ? target.id : null);
          else if (target) { mergeAssignments(db, ctx.user.id, c.id, target.id); rewriteRefs(db, ctx.user.id, 'category', c.id, target.id); }
          if (uses === 0) db.prepare('UPDATE schedules SET category_id = ? WHERE user_id = ? AND category_id = ?').run(target ? target.id : null, ctx.user.id, c.id);
          db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(c.id, ctx.user.id);
        });
        send(ctx);
      },
    },
  };
};
