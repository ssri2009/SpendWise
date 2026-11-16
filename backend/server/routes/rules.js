'use strict';
const { httpError, sendJson } = require('../http');
const { inTransaction } = require('../db');
const v = require('../validate');
const R = require('../rules');

module.exports = ({ db }) => {
  const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

  const present = (userId) => {
    const env = R.loadEnv(db, userId);
    return R.listRules(db, userId).map((r) => ({ ...r, problems: R.problemsOf(r, env) }));
  };
  const one = (userId, id) => {
    const r = present(userId).find((x) => x.id === id);
    if (!r) throw httpError(404, 'Rule not found.');
    return r;
  };
  const own = (userId, id) => {
    if (!db.prepare('SELECT 1 FROM rules WHERE id = ? AND user_id = ?').get(id, userId)) throw httpError(404, 'Rule not found.');
  };

  return {
    // In execution order: position 1 runs first.
    'GET /api/rules': {
      auth: true,
      handler: (ctx) => sendJson(ctx.res, 200, { rules: present(ctx.user.id), maxRules: R.MAX_RULES }),
    },

    'GET /api/rules/:id': {
      auth: true,
      handler: (ctx) => sendJson(ctx.res, 200, { rule: one(ctx.user.id, v.paramId(ctx)) }),
    },

    'POST /api/rules': {
      auth: true, body: true,
      handler: (ctx) => {
        const count = db.prepare('SELECT COUNT(*) AS n FROM rules WHERE user_id = ?').get(ctx.user.id).n;
        if (count >= R.MAX_RULES) throw v.bad(`You can have at most ${R.MAX_RULES} rules.`);
        const r = R.parseRule(ctx.body, R.loadEnv(db, ctx.user.id));
        const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM rules WHERE user_id = ?').get(ctx.user.id).n;
        const id = Number(db.prepare(
          `INSERT INTO rules (user_id, name, enabled, match_mode, stop_after, conditions, actions, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(ctx.user.id, r.name, r.enabled, r.matchMode, r.stopAfter, JSON.stringify(r.conditions), JSON.stringify(r.actions), next).lastInsertRowid);
        sendJson(ctx.res, 201, { rule: one(ctx.user.id, id) });
      },
    },

    // Any of: name, enabled, matchMode, stopAfter, conditions, actions (a list replaces the whole list).
    'PATCH /api/rules/:id': {
      auth: true, body: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        own(ctx.user.id, id);
        const p = R.parseRule(ctx.body, R.loadEnv(db, ctx.user.id), { partial: true });
        const sets = [], vals = [];
        const put = (col, val) => { sets.push(`${col} = ?`); vals.push(val); };
        if (p.name !== undefined) put('name', p.name);
        if (p.enabled !== undefined) put('enabled', p.enabled);
        if (p.matchMode !== undefined) put('match_mode', p.matchMode);
        if (p.stopAfter !== undefined) put('stop_after', p.stopAfter);
        if (p.conditions !== undefined) put('conditions', JSON.stringify(p.conditions));
        if (p.actions !== undefined) put('actions', JSON.stringify(p.actions));
        if (!sets.length) throw v.bad('Nothing to change.');
        db.prepare(`UPDATE rules SET ${sets.join(', ')}, updated_at = ${NOW} WHERE id = ? AND user_id = ?`).run(...vals, id, ctx.user.id);
        sendJson(ctx.res, 200, { rule: one(ctx.user.id, id) });
      },
    },

    'DELETE /api/rules/:id': {
      auth: true,
      handler: (ctx) => {
        const id = v.paramId(ctx);
        own(ctx.user.id, id);
        db.prepare('DELETE FROM rules WHERE id = ? AND user_id = ?').run(id, ctx.user.id);
        sendJson(ctx.res, 200, { ok: true });
      },
    },

    // { ids: [...] } every one of your rules exactly once, first = runs first. All or nothing.
    'POST /api/rules/reorder': {
      auth: true, body: true,
      handler: (ctx) => {
        const ids = ctx.body.ids;
        if (!Array.isArray(ids) || !ids.length || ids.length > R.MAX_RULES) throw v.bad('ids must be a list of your rules.');
        const parsed = ids.map((x) => v.intId(x, 'id'));
        const mine = db.prepare('SELECT id FROM rules WHERE user_id = ?').all(ctx.user.id).map((r) => Number(r.id));
        if (new Set(parsed).size !== parsed.length || parsed.length !== mine.length || !parsed.every((id) => mine.includes(id))) {
          throw v.bad('The list must contain each of your rules exactly once.');
        }
        const upd = db.prepare('UPDATE rules SET sort_order = ? WHERE id = ? AND user_id = ?');
        inTransaction(db, () => parsed.forEach((id, i) => upd.run(i, id, ctx.user.id)));
        sendJson(ctx.res, 200, { rules: present(ctx.user.id) });
      },
    },

    // Run rules over EXISTING transactions. Does nothing but preview unless dryRun is explicitly false.
    // { dryRun?: true, month?: 'all'|'2026-11', accountId?, onlyUncategorized?, ruleIds? }
    'POST /api/rules/reprocess': {
      auth: true, body: true,
      handler: (ctx) => {
        const b = ctx.body;
        const dryRun = b.dryRun === undefined ? true : !!(v.boolish(b.dryRun, 'dryRun'));
        let month = null;
        if (b.month !== undefined && b.month !== 'all' && b.month !== null) {
          if (typeof b.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.month)) throw v.bad('month must be "all" or look like 2026-11.');
          month = b.month;
        }
        let accountId = null;
        if (b.accountId !== undefined && b.accountId !== null) {
          accountId = v.intId(b.accountId, 'accountId');
          if (!db.prepare('SELECT 1 FROM accounts WHERE id = ? AND user_id = ?').get(accountId, ctx.user.id)) throw httpError(404, 'Account not found.');
        }
        const onlyUncategorized = b.onlyUncategorized === undefined ? false : !!v.boolish(b.onlyUncategorized, 'onlyUncategorized');
        let ruleIds = null;
        if (b.ruleIds !== undefined && b.ruleIds !== null) {
          if (!Array.isArray(b.ruleIds) || !b.ruleIds.length || b.ruleIds.length > R.MAX_RULES) throw v.bad('ruleIds must be a list of your rules.');
          ruleIds = [...new Set(b.ruleIds.map((x) => v.intId(x, 'ruleId')))];
          const owned = db.prepare(`SELECT COUNT(*) AS n FROM rules WHERE user_id = ? AND id IN (${ruleIds.map(() => '?').join(',')})`).get(ctx.user.id, ...ruleIds).n;
          if (owned !== ruleIds.length) throw httpError(404, 'Rule not found.');
        }
        sendJson(ctx.res, 200, R.reprocess(db, ctx.user, { dryRun, month, accountId, onlyUncategorized, ruleIds }));
      },
    },
  };
};
