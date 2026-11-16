'use strict';
// Rules engine. A rule is "if <conditions> then <actions>". Rules run on a DRAFT transaction:
//   { accountId, amountMinor, payee (name text), categoryId|null, notes, cleared (0|1) }
// The same pure function serves new transactions, imports and the explicit "re-apply" tool, so they can
// never disagree. The payee is carried as a NAME until the very end, so a rule that renames the payee never
// leaves a throw-away payee behind (an import of "SWIGGY ORDER 123" does not create that payee first).
//
// EXECUTION ORDER (also documented in the README and on the Rules page):
//   1. Enabled rules run top to bottom (sort_order, then id).
//   2. EVERY rule whose conditions match runs, not just the first. Conditions are checked against the
//      draft as earlier rules left it, so a rule can build on the result of one above it.
//   3. Single-value fields (category, payee, cleared): the LAST matching rule that sets it wins.
//      Notes accumulate (each distinct text is added once). 
//   4. A matching rule with "stop after this rule" ends processing: nothing below it runs.
//   5. Rules run when a transaction is CREATED or IMPORTED. Editing a transaction never runs them, and
//      existing transactions change only when the user runs "re-apply rules" and confirms.

const { httpError } = require('./http');
const v = require('./validate');
const { inTransaction } = require('./db');
const { findOrCreatePayee } = require('./txquery');

const MAX_RULES = 200;
const MAX_CONDITIONS = 10;
const MAX_ACTIONS = 10;
const NOTE_MAX = 200;            // same limit as transactions.notes
const MAX_REPROCESS = 5000;      // transactions looked at per re-apply run
const DIRECTIONS = ['any', 'expense', 'income'];

/* ------------------------------ what a user owns ------------------------------ */

/** Names/ids this user actually has. Rules may only point at these. */
function loadEnv(db, userId) {
  const map = (sql) => new Map(db.prepare(sql).all(userId).map((r) => [Number(r.id), r.name]));
  return {
    payees: map('SELECT id, name FROM payees WHERE user_id = ?'),
    categories: map('SELECT id, name FROM categories WHERE user_id = ?'),
    accounts: map('SELECT id, name FROM accounts WHERE user_id = ?'),
  };
}

/* ------------------------------ validation (write side) ------------------------------ */

function parseConditions(list, env) {
  if (!Array.isArray(list) || !list.length) throw v.bad('A rule needs at least one condition.');
  if (list.length > MAX_CONDITIONS) throw v.bad(`A rule can have at most ${MAX_CONDITIONS} conditions.`);
  return list.map((c, i) => {
    const at = `Condition ${i + 1}`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw v.bad(`${at} is invalid.`);
    switch (c.type) {
      case 'description_contains':
        return { type: c.type, value: v.reqString(c.value, `${at}: text`, 100) };
      case 'payee_equals': {
        const id = v.intId(c.payeeId, `${at}: payee`);
        if (!env.payees.has(id)) throw v.bad(`${at}: that payee does not exist.`);
        return { type: c.type, payeeId: id };
      }
      case 'amount_gt':
      case 'amount_lt': {
        const valueMinor = v.minor(c.valueMinor, `${at}: amount`, { allowZero: true });
        if (valueMinor < 0) throw v.bad(`${at}: amount cannot be negative. Use the direction (expense / income) instead.`);
        const direction = c.direction === undefined ? 'any' : c.direction;
        if (!DIRECTIONS.includes(direction)) throw v.bad(`${at}: direction must be any, expense or income.`);
        return { type: c.type, valueMinor, direction };
      }
      case 'account_equals': {
        const id = v.intId(c.accountId, `${at}: account`);
        if (!env.accounts.has(id)) throw v.bad(`${at}: that account does not exist.`);
        return { type: c.type, accountId: id };
      }
      default: throw v.bad(`${at}: unknown condition type.`);
    }
  });
}

function parseActions(list, env) {
  if (!Array.isArray(list) || !list.length) throw v.bad('A rule needs at least one action.');
  if (list.length > MAX_ACTIONS) throw v.bad(`A rule can have at most ${MAX_ACTIONS} actions.`);
  return list.map((a, i) => {
    const at = `Action ${i + 1}`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw v.bad(`${at} is invalid.`);
    switch (a.type) {
      case 'set_category': {
        const id = v.intId(a.categoryId, `${at}: category`);
        if (!env.categories.has(id)) throw v.bad(`${at}: that category does not exist.`);
        return { type: a.type, categoryId: id };
      }
      case 'set_payee': {
        const id = v.intId(a.payeeId, `${at}: payee`);
        if (!env.payees.has(id)) throw v.bad(`${at}: that payee does not exist.`);
        return { type: a.type, payeeId: id };
      }
      case 'add_note': return { type: a.type, text: v.reqString(a.text, `${at}: note`, NOTE_MAX) };
      case 'mark_cleared': return { type: a.type };
      default: throw v.bad(`${at}: unknown action type.`);
    }
  });
}

/** Validates a create body (or the fields present in a patch body) and returns normalized values. */
function parseRule(body, env, { partial = false } = {}) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has('name')) out.name = v.reqString(body.name, 'Name', 60);
  if (!partial || has('enabled')) out.enabled = has('enabled') ? v.boolish(body.enabled, 'enabled') : 1;
  if (!partial || has('stopAfter')) out.stopAfter = has('stopAfter') ? v.boolish(body.stopAfter, 'stopAfter') : 0;
  if (!partial || has('matchMode')) {
    const m = has('matchMode') ? body.matchMode : 'all';
    if (m !== 'all' && m !== 'any') throw v.bad('matchMode must be "all" or "any".');
    out.matchMode = m;
  }
  if (!partial || has('conditions')) out.conditions = parseConditions(body.conditions, env);
  if (!partial || has('actions')) out.actions = parseActions(body.actions, env);
  return out;
}

/* ------------------------------ reading rules ------------------------------ */

function safeJson(text) {
  try { const x = JSON.parse(text); return Array.isArray(x) ? x : []; } catch { return []; }
}

function rowToRule(r, position) {
  return {
    id: Number(r.id), name: r.name, enabled: !!r.enabled, matchMode: r.match_mode, stopAfter: !!r.stop_after,
    position, conditions: safeJson(r.conditions), actions: safeJson(r.actions),
  };
}

/** All of the user's rules in execution order. */
function listRules(db, userId) {
  return db.prepare('SELECT * FROM rules WHERE user_id = ? ORDER BY sort_order, id').all(userId).map((r, i) => rowToRule(r, i + 1));
}

/** Things a rule points at that no longer exist (deleted category / account / payee). Shown as warnings. */
function problemsOf(rule, env) {
  const out = [];
  for (const c of rule.conditions) {
    if (c.type === 'payee_equals' && !env.payees.has(c.payeeId)) out.push('A payee in its conditions was deleted, so that condition never matches.');
    if (c.type === 'account_equals' && !env.accounts.has(c.accountId)) out.push('An account in its conditions was deleted, so that condition never matches.');
  }
  for (const a of rule.actions) {
    if (a.type === 'set_category' && !env.categories.has(a.categoryId)) out.push('Its "set category" action points at a deleted category and is skipped.');
    if (a.type === 'set_payee' && !env.payees.has(a.payeeId)) out.push('Its "set payee" action points at a deleted payee and is skipped.');
  }
  return [...new Set(out)];
}

/** Enabled rules + the lookups the engine needs, or null when there is nothing to run (the common, cheap case). */
function prepare(db, userId, { ids = null } = {}) {
  let rules = listRules(db, userId);
  if (ids) { const want = new Set(ids); rules = rules.filter((r) => want.has(r.id)); } else rules = rules.filter((r) => r.enabled);
  if (!rules.length) return null;
  return { rules, env: loadEnv(db, userId) };
}

/* ------------------------------ the engine (pure) ------------------------------ */

function conditionMatches(c, d, env) {
  switch (c.type) {
    case 'description_contains':
      return `${d.payee}\n${d.notes}`.toLowerCase().includes(c.value.toLowerCase());
    case 'payee_equals': {
      const name = env.payees.get(c.payeeId);
      return name !== undefined && d.payee !== '' && d.payee.toLowerCase() === name.toLowerCase();
    }
    case 'amount_gt':
    case 'amount_lt': {
      if (c.direction === 'expense' && d.amountMinor >= 0) return false;
      if (c.direction === 'income' && d.amountMinor <= 0) return false;
      const abs = Math.abs(d.amountMinor);
      return c.type === 'amount_gt' ? abs > c.valueMinor : abs < c.valueMinor;
    }
    case 'account_equals': return d.accountId === c.accountId;
    default: return false;
  }
}

function applyAction(a, d, env) {
  switch (a.type) {
    case 'set_category': if (env.categories.has(a.categoryId)) d.categoryId = a.categoryId; break;
    case 'set_payee': { const name = env.payees.get(a.payeeId); if (name !== undefined) d.payee = name; break; }
    case 'add_note': {
      if (d.notes.includes(a.text)) break;                       // never add the same text twice
      const next = d.notes ? `${d.notes} ${a.text}` : a.text;
      if (next.length <= NOTE_MAX) d.notes = next;               // too long for the notes box: skipped, never cut in half
      break;
    }
    case 'mark_cleared': d.cleared = 1; break;
    default: break;
  }
}

/** Runs `rules` (already in execution order) over a copy of `draft`. Returns { draft, applied: [{id, name}] }. */
function runRules(rules, draft, env) {
  const d = { ...draft };
  const applied = [];
  for (const rule of rules) {
    const hit = rule.matchMode === 'any'
      ? rule.conditions.some((c) => conditionMatches(c, d, env))
      : rule.conditions.every((c) => conditionMatches(c, d, env));
    if (!hit) continue;
    for (const a of rule.actions) applyAction(a, d, env);
    applied.push({ id: rule.id, name: rule.name });
    if (rule.stopAfter) break;
  }
  return { draft: d, applied };
}

/* ------------------------------ keeping references valid ------------------------------ */

/** A payee or category was merged into another: every rule that pointed at the old one now points at the new one. */
function rewriteRefs(db, userId, kind, fromId, toId) {
  const upd = db.prepare("UPDATE rules SET conditions = ?, actions = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?");
  for (const r of db.prepare('SELECT id, conditions, actions FROM rules WHERE user_id = ?').all(userId)) {
    const conds = safeJson(r.conditions), acts = safeJson(r.actions);
    let changed = false;
    if (kind === 'payee') {
      for (const c of conds) if (c.type === 'payee_equals' && c.payeeId === fromId) { c.payeeId = toId; changed = true; }
      for (const a of acts) if (a.type === 'set_payee' && a.payeeId === fromId) { a.payeeId = toId; changed = true; }
    } else if (kind === 'category') {
      for (const a of acts) if (a.type === 'set_category' && a.categoryId === fromId) { a.categoryId = toId; changed = true; }
    }
    if (changed) upd.run(JSON.stringify(conds), JSON.stringify(acts), r.id, userId);
  }
}

/** Names of the user's rules that point at this payee (used to refuse deleting it). */
function rulesUsingPayee(db, userId, payeeId) {
  return listRules(db, userId)
    .filter((r) => r.conditions.some((c) => c.type === 'payee_equals' && c.payeeId === payeeId)
      || r.actions.some((a) => a.type === 'set_payee' && a.payeeId === payeeId))
    .map((r) => r.name);
}

/* ------------------------------ explicit re-apply to existing data ------------------------------ */

/**
 * Runs rules over EXISTING transactions. Nothing is written unless dryRun is false.
 * opts: { dryRun, month: 'YYYY-MM'|null, accountId|null, onlyUncategorized, ruleIds|null }
 * With ruleIds only those rules run (even if disabled, so a rule can be tried out); otherwise all enabled rules.
 */
function reprocess(db, user, opts) {
  const prepared = prepare(db, user.id, { ids: opts.ruleIds });
  if (!prepared) return { dryRun: opts.dryRun, scanned: 0, changed: 0, truncated: false, samples: [], note: 'No enabled rules to run.' };
  const { rules, env } = prepared;

  const where = ['t.user_id = ?'];
  const args = [user.id];
  if (opts.month) { where.push('t.date >= ? AND t.date <= ?'); args.push(`${opts.month}-01`, `${opts.month}-31`); }
  if (opts.accountId) { where.push('t.account_id = ?'); args.push(opts.accountId); }
  if (opts.onlyUncategorized) where.push('t.category_id IS NULL AND t.is_split = 0');
  const rows = db.prepare(
    `SELECT t.id, t.account_id, t.amount_minor, t.notes, t.cleared, t.category_id, t.is_split, COALESCE(p.name, '') AS payee
       FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id
      WHERE ${where.join(' AND ')} ORDER BY t.date, t.id LIMIT ?`
  ).all(...args, MAX_REPROCESS + 1);
  const truncated = rows.length > MAX_REPROCESS;
  if (truncated) rows.length = MAX_REPROCESS;

  const changes = [];
  for (const r of rows) {
    const before = {
      accountId: Number(r.account_id), amountMinor: Number(r.amount_minor), payee: r.payee,
      categoryId: r.category_id === null ? null : Number(r.category_id), notes: r.notes, cleared: r.cleared ? 1 : 0,
    };
    const { draft, applied } = runRules(rules, before, env);
    // A split transaction's category lives in its splits. Rules may still set its payee, notes and cleared flag.
    if (r.is_split) draft.categoryId = before.categoryId;
    if (draft.payee !== before.payee || draft.categoryId !== before.categoryId || draft.notes !== before.notes || draft.cleared !== before.cleared) {
      changes.push({ id: Number(r.id), before, after: draft, rules: applied.map((x) => x.name) });
    }
  }

  if (!opts.dryRun && changes.length) {
    inTransaction(db, () => {
      const upd = db.prepare(
        "UPDATE transactions SET payee_id = ?, category_id = ?, notes = ?, cleared = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?");
      for (const c of changes) {
        const pid = c.after.payee ? findOrCreatePayee(db, user.id, c.after.payee) : null;
        upd.run(pid, c.after.categoryId, c.after.notes, c.after.cleared, c.id, user.id);
      }
    });
  }

  const catName = (id) => (id === null ? 'Uncategorized' : env.categories.get(id) || 'Uncategorized');
  return {
    dryRun: opts.dryRun, scanned: rows.length, changed: changes.length, truncated,
    samples: changes.slice(0, 50).map((c) => ({
      id: c.id, rules: c.rules,
      before: { payee: c.before.payee, category: catName(c.before.categoryId), notes: c.before.notes, cleared: !!c.before.cleared },
      after: { payee: c.after.payee, category: catName(c.after.categoryId), notes: c.after.notes, cleared: !!c.after.cleared },
    })),
  };
}

module.exports = {
  MAX_RULES, MAX_REPROCESS, loadEnv, parseRule, listRules, problemsOf, prepare, runRules,
  rewriteRefs, rulesUsingPayee, reprocess, rowToRule,
};
