'use strict';
const { httpError } = require('./http');
const v = require('./validate');

// Shared by the transactions list, the summary cards and the CSV export.
const FROM = `FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN payees p ON p.id = t.payee_id
  LEFT JOIN categories c ON c.id = t.category_id`;

function qInt(query, name) {
  const raw = query.get(name);
  if (raw === null || raw === '' || raw === 'all') return null;
  if (!/^\d{1,15}$/.test(raw)) throw httpError(400, `${name} is invalid.`);
  return Number(raw);
}

const likeEscape = (s) => s.replace(/[\\%_]/g, (ch) => '\\' + ch);

/**
 * Builds the WHERE clause for the signed-in user. Every query starts with t.user_id = ?
 * so one user can never see another user's rows.
 */
function buildFilter(userId, query, { skipType = false } = {}) {
  const where = ['t.user_id = ?'];
  const params = [userId];

  const account = qInt(query, 'account');
  if (account !== null) { where.push('t.account_id = ?'); params.push(account); }

  // A split transaction has no category of its own: it matches a category when one of its SPLITS is in it,
  // and "uncategorized" when one of its splits has no category.
  const category = query.get('category');
  let categoryFilter = null;
  if (category === 'none') {
    where.push(`((t.is_split = 0 AND t.category_id IS NULL)
      OR (t.is_split = 1 AND EXISTS (SELECT 1 FROM transaction_splits sx WHERE sx.transaction_id = t.id AND sx.category_id IS NULL)))`);
    categoryFilter = { none: true };
  } else if (category && category !== 'all') {
    const id = qInt(query, 'category');
    where.push(`(t.category_id = ? OR (t.is_split = 1 AND EXISTS (SELECT 1 FROM transaction_splits sx WHERE sx.transaction_id = t.id AND sx.category_id = ?)))`);
    params.push(id, id);
    categoryFilter = { id };
  }

  // Cleared status: yes = cleared, no = not cleared yet. (Reconciliation only ever looks at the cleared ones.)
  const cleared = query.get('cleared');
  if (cleared === 'yes') where.push('t.cleared = 1');
  else if (cleared === 'no') where.push('t.cleared = 0');
  else if (cleared && cleared !== 'all') throw httpError(400, 'cleared must be yes or no.');

  const payee = qInt(query, 'payee');
  if (payee !== null) { where.push('t.payee_id = ?'); params.push(payee); }

  const month = query.get('month');
  if (month && month !== 'all') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw httpError(400, 'month must look like 2026-11.');
    where.push('t.date >= ? AND t.date <= ?');
    params.push(`${month}-01`, `${month}-31`);
  }
  if (query.get('from')) { where.push('t.date >= ?'); params.push(v.isoDate(query.get('from'), 'from')); }
  if (query.get('to')) { where.push('t.date <= ?'); params.push(v.isoDate(query.get('to'), 'to')); }

  if (!skipType) {
    const type = query.get('type');
    if (type === 'income') where.push('t.amount_minor > 0');
    else if (type === 'expense') where.push('t.amount_minor < 0');
    else if (type && type !== 'all') throw httpError(400, 'type must be income or expense.');
  }

  const min = qInt(query, 'min');
  if (min !== null) { where.push('ABS(t.amount_minor) >= ?'); params.push(min); }
  const max = qInt(query, 'max');
  if (max !== null) { where.push('ABS(t.amount_minor) <= ?'); params.push(max); }

  const q = (query.get('q') || '').trim().slice(0, 80);
  if (q) {
    const like = `%${likeEscape(q)}%`;
    where.push(`(COALESCE(p.name,'') LIKE ? ESCAPE '\\' OR t.notes LIKE ? ESCAPE '\\' OR COALESCE(c.name,'') LIKE ? ESCAPE '\\'
      OR (t.is_split = 1 AND EXISTS (SELECT 1 FROM transaction_splits sx JOIN categories sc ON sc.id = sx.category_id
                                      WHERE sx.transaction_id = t.id AND (sc.name LIKE ? ESCAPE '\\' OR sx.notes LIKE ? ESCAPE '\\'))))`);
    params.push(like, like, like, like, like);
  }

  return { where: where.join(' AND '), params, categoryFilter };
}

/** Same payee spelled with different capitals is one payee. */
function findOrCreatePayee(db, userId, name) {
  const row = db.prepare('SELECT id, archived FROM payees WHERE user_id = ? AND name = ? COLLATE NOCASE').get(userId, name);
  if (row) {
    // Using an archived payee again brings it back, so it never hides behind a transaction that still uses it.
    if (row.archived) db.prepare('UPDATE payees SET archived = 0 WHERE id = ? AND user_id = ?').run(row.id, userId);
    return Number(row.id);
  }
  return Number(db.prepare('INSERT INTO payees (user_id, name) VALUES (?, ?)').run(userId, name).lastInsertRowid);
}

module.exports = { FROM, buildFilter, findOrCreatePayee };
