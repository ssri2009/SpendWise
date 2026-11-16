'use strict';
const { httpError, sendJson } = require('../http');
const { inTransaction } = require('../db');
const v = require('../validate');
const R = require('../rules');

const likeEscape = (s) => s.replace(/[\\%_]/g, (ch) => '\\' + ch);
const ORDER = {
  name: 'p.name COLLATE NOCASE ASC, p.id ASC',
  usage: 'uses DESC, p.name COLLATE NOCASE ASC',
  last: '(last_used IS NULL), last_used DESC, p.name COLLATE NOCASE ASC',
};

module.exports = ({ db }) => {
  // usageCount = transactions using the payee; lastUsed = date of its newest transaction (null if none).
  const SELECT = `SELECT p.id, p.name, p.archived, p.default_category_id, c.name AS cat_name,
      (SELECT COUNT(*) FROM transactions t WHERE t.payee_id = p.id AND t.user_id = p.user_id) AS uses,
      (SELECT MAX(t.date) FROM transactions t WHERE t.payee_id = p.id AND t.user_id = p.user_id) AS last_used
    FROM payees p LEFT JOIN categories c ON c.id = p.default_category_id AND c.user_id = p.user_id`;

  const toJson = (r, ruleCount = 0) => ({
    id: Number(r.id), name: r.name, archived: !!r.archived,
    defaultCategoryId: r.default_category_id === null ? null : Number(r.default_category_id),
    defaultCategoryName: r.cat_name || null,
    usageCount: Number(r.uses), lastUsed: r.last_used || null, ruleCount,
  });

  const ruleCounts = (userId) => {
    const m = new Map();
    for (const r of R.listRules(db, userId)) {
      const ids = new Set([...r.conditions.filter((c) => c.type === 'payee_equals').map((c) => c.payeeId),
        ...r.actions.filter((a) => a.type === 'set_payee').map((a) => a.payeeId)]);
      for (const id of ids) m.set(id, (m.get(id) || 0) + 1);
    }
    return m;
  };

  const getRow = (userId, id) => {
    const row = db.prepare(`${SELECT} WHERE p.user_id = ? AND p.id = ?`).get(userId, id);
    if (!row) throw httpError(404, 'Payee not found.');
    return row;
  };
  const one = (userId, id) => toJson(getRow(userId, id), ruleCounts(userId).get(id) || 0);

  const ownCategory = (userId, id) => {
    if (id === null) return null;
    if (!db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(id, userId)) throw v.bad('That category does not exist.');
    return id;
  };

  const clash = (userId, name, exceptId = 0) =>
    db.prepare('SELECT id, archived FROM payees WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?').get(userId, name, exceptId);
  const clashError = (row) => httpError(409, row.archived
    ? 'A payee with that name exists but is archived. Open the Archived tab and unarchive it.'
    : 'You already have a payee with that name. To combine them, merge one into the other.');

  return {
    'GET /api/payees': {
      auth: true,
      handler: (ctx) => {
        const status = ctx.query.get('status') || 'active';
        if (!['active', 'archived', 'all'].includes(status)) throw v.bad('status must be active, archived or all.');
        const sort = ctx.query.get('sort') || 'name';
        if (!ORDER[sort]) throw v.bad('sort must be name, usage or last.');
        const limit = v.clampInt(ctx.query.get('limit'), 1, 1000, 200);
        const offset = v.clampInt(ctx.query.get('offset'), 0, 1e9, 0);
        const q = (ctx.query.get('q') || '').trim().slice(0, 60);

        const where = ['p.user_id = ?'];
        const args = [ctx.user.id];
        if (status !== 'all') { where.push('p.archived = ?'); args.push(status === 'archived' ? 1 : 0); }
        if (q) { where.push("p.name LIKE ? ESCAPE '\\'"); args.push(`%${likeEscape(q)}%`); }
        const rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${ORDER[sort]} LIMIT ? OFFSET ?`).all(...args, limit, offset);
        const total = db.prepare(`SELECT COUNT(*) AS n FROM payees p WHERE ${where.join(' AND ')}`).get(...args).n;
        const counts = ruleCounts(ctx.user.id);
        sendJson(ctx.res, 200, { payees: rows.map((r) => toJson(r, counts.get(Number(r.id)) || 0)), total: Number(total) });
      },
    },

    'GET /api/payees/:id': {
      auth: true,
      handler: (ctx) => sendJson(ctx.res, 200, { payee: one(ctx.user.id, v.paramId(ctx)) }),
    },

    'POST /api/payees': {
      auth: true, body: true,
      handler: (ctx) => {
        const name = v.reqString(ctx.body.name, 'Name', 60);
        const cat = ownCategory(ctx.user.id, v.optId(ctx.body.defaultCategoryId, 'defaultCategoryId'));
        const hit = clash(ctx.user.id, name);
        if (hit) throw clashError(hit);
        const id = Number(db.prepare('INSERT INTO payees (user_id, name, default_category_id) VALUES (?, ?, ?)').run(ctx.user.id, name, cat).lastInsertRowid);
        sendJson(ctx.res, 201, { payee: one(ctx.user.id, id) });
      },
    },

    // { name?, defaultCategoryId? (null clears), archived? }
    'PATCH /api/payees/:id': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const cur = getRow(ctx.user.id, id);
        const b = ctx.body;
        const name = b.name === undefined ? cur.name : v.reqString(b.name, 'Name', 60);
        const cat = b.defaultCategoryId === undefined ? cur.default_category_id : ownCategory(ctx.user.id, v.optId(b.defaultCategoryId, 'defaultCategoryId'));
        const archived = b.archived === undefined ? cur.archived : v.boolish(b.archived, 'archived');
        const hit = clash(ctx.user.id, name, id);   // renaming to your own name in different capitals is fine
        if (hit) throw clashError(hit);
        db.prepare('UPDATE payees SET name = ?, default_category_id = ?, archived = ? WHERE id = ? AND user_id = ?').run(name, cat, archived, id, ctx.user.id);
        sendJson(ctx.res, 200, { payee: one(ctx.user.id, id) });
      },
    },

    // Everything that pointed at this payee (transactions, rules) now points at the target; this payee is removed.
    'POST /api/payees/:id/merge': {
      auth: true, body: true,
      handler: (ctx) => {
        const fromId = v.paramId(ctx);
        const toId = v.intId(ctx.body.targetId, 'targetId');
        if (fromId === toId) throw v.bad('Pick a different payee to merge into.');
        const from = getRow(ctx.user.id, fromId);
        const to = getRow(ctx.user.id, toId);
        const moved = inTransaction(db, () => {
          const n = db.prepare('UPDATE transactions SET payee_id = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE user_id = ? AND payee_id = ?')
            .run(toId, ctx.user.id, fromId).changes;
          R.rewriteRefs(db, ctx.user.id, 'payee', fromId, toId);
          db.prepare('UPDATE schedules SET payee_id = ? WHERE user_id = ? AND payee_id = ?').run(toId, ctx.user.id, fromId);
          // The target keeps its own default category; it inherits the old one only if it had none.
          // It stays archived only if both were archived.
          db.prepare('UPDATE payees SET default_category_id = COALESCE(default_category_id, ?), archived = ? WHERE id = ? AND user_id = ?')
            .run(from.default_category_id, to.archived && from.archived ? 1 : 0, toId, ctx.user.id);
          db.prepare('DELETE FROM payees WHERE id = ? AND user_id = ?').run(fromId, ctx.user.id);
          return Number(n);
        });
        sendJson(ctx.res, 200, { payee: one(ctx.user.id, toId), moved });
      },
    },

    // Only a payee nothing uses can be deleted. Otherwise merge it into another, or archive it.
    'DELETE /api/payees/:id': {
      auth: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        const cur = toJson(getRow(ctx.user.id, id));
        if (cur.usageCount > 0) {
          throw httpError(409, `"${cur.name}" is used by ${cur.usageCount} transaction${cur.usageCount === 1 ? '' : 's'}. Merge it into another payee, or archive it to hide it.`);
        }
        const rules = R.rulesUsingPayee(db, ctx.user.id, id);
        if (rules.length) {
          throw httpError(409, `"${cur.name}" is used by the rule${rules.length === 1 ? '' : 's'} ${rules.map((n) => `"${n}"`).join(', ')}. Change or delete ${rules.length === 1 ? 'that rule' : 'those rules'} first, or archive the payee.`);
        }
        const sched = db.prepare('SELECT name FROM schedules WHERE user_id = ? AND payee_id = ?').all(ctx.user.id, id).map((r) => r.name);
        if (sched.length) {
          throw httpError(409, `"${cur.name}" is used by the schedule${sched.length === 1 ? '' : 's'} ${sched.map((n) => `"${n}"`).join(', ')}. Change or delete ${sched.length === 1 ? 'that schedule' : 'those schedules'} first, or archive the payee.`);
        }
        db.prepare('DELETE FROM payees WHERE id = ? AND user_id = ?').run(id, ctx.user.id);
        sendJson(ctx.res, 200, { ok: true });
      },
    },
  };
};
