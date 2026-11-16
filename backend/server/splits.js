'use strict';
// Split transactions. One bank transaction (Amazon, ₹3,000) shared across several categories
// (Shopping ₹2,000 + Electronics ₹1,000).
//
// THE RULES (README has the same list):
//   1. A split transaction keeps its own amount and account. Account balances and Total Funds use that amount, never the splits.
//   2. Its splits are two or more rows and ALWAYS add up to the transaction's amount, to the paisa. Every write goes through
//      checkSplits(), so a bad set is refused before anything is saved.
//   3. The transaction's own category is empty while it is split. Budget, reports and category filters read the splits instead
//      (through the tx_lines view), so every paisa is counted once, in the right category.
//   4. A split may have no category (that part is "uncategorized", like any uncategorized transaction).
//   5. Deleting one split moves its amount into another split (you choose which), or, when only one split is left, turns the
//      transaction back into a normal one in that category. Splits are never silently dropped, so the total can't change.

const { httpError } = require('./http');
const v = require('./validate');

const MIN_SPLITS = 2;
const MAX_SPLITS = 30;
const NOTE_MAX = 200;

/**
 * Validates a list of splits for a transaction worth `amountMinor`. Returns clean rows
 * [{categoryId|null, amountMinor, notes}]. Throws a 400 with a readable message otherwise.
 * `ownCategory(id)` must return the id if the signed-in user owns it, or throw.
 */
function checkSplits(list, amountMinor, ownCategory) {
  if (!Array.isArray(list)) throw v.bad('splits must be a list.');
  if (list.length < MIN_SPLITS) throw v.bad(`A split needs at least ${MIN_SPLITS} parts. To keep one category, unsplit the transaction instead.`);
  if (list.length > MAX_SPLITS) throw v.bad(`A transaction can have at most ${MAX_SPLITS} splits.`);
  let sum = 0;
  const out = list.map((s, i) => {
    const at = `Split ${i + 1}`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw v.bad(`${at} is invalid.`);
    const amt = v.minor(s.amountMinor, `${at}: amount`);
    sum += amt;
    return {
      categoryId: ownCategory(v.optId(s.categoryId, `${at}: category`)),
      amountMinor: amt,
      notes: v.optString(s.notes, `${at}: notes`, NOTE_MAX),
    };
  });
  if (sum !== amountMinor) {
    const diff = amountMinor - sum;
    throw v.bad(`The splits must add up to the transaction amount. They are ${diff > 0 ? 'short' : 'over'} by ${Math.abs(diff)} paise (${(Math.abs(diff) / 100).toFixed(2)}).`);
  }
  return out;
}

/** Replaces all splits of a transaction and marks it split (category cleared). Call inside inTransaction. */
function writeSplits(db, userId, txId, clean) {
  db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ? AND user_id = ?').run(txId, userId);
  const ins = db.prepare(
    'INSERT INTO transaction_splits (user_id, transaction_id, category_id, amount_minor, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  clean.forEach((s, i) => ins.run(userId, txId, s.categoryId, s.amountMinor, s.notes, i));
  db.prepare("UPDATE transactions SET is_split = 1, category_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?")
    .run(txId, userId);
}

/** Turns a split transaction back into a normal one in `categoryId` (may be null). Call inside inTransaction. */
function removeSplits(db, userId, txId, categoryId) {
  db.prepare('DELETE FROM transaction_splits WHERE transaction_id = ? AND user_id = ?').run(txId, userId);
  db.prepare("UPDATE transactions SET is_split = 0, category_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?")
    .run(categoryId, txId, userId);
}

const rowToSplit = (r) => ({
  id: Number(r.id),
  categoryId: r.category_id === null ? null : Number(r.category_id),
  categoryName: r.category_name || null,
  categoryIcon: r.category_icon || null,
  amountMinor: Number(r.amount_minor),
  notes: r.notes,
});

/** Map txId -> [split] for the given transaction ids, scoped to one user. */
function loadSplits(db, userId, txIds) {
  const out = new Map();
  if (!txIds.length) return out;
  for (let i = 0; i < txIds.length; i += 400) {
    const chunk = txIds.slice(i, i + 400);
    const rows = db.prepare(
      `SELECT s.id, s.transaction_id, s.category_id, c.name AS category_name, c.icon AS category_icon, s.amount_minor, s.notes
         FROM transaction_splits s LEFT JOIN categories c ON c.id = s.category_id
        WHERE s.user_id = ? AND s.transaction_id IN (${chunk.map(() => '?').join(',')}) ORDER BY s.sort_order, s.id`
    ).all(userId, ...chunk);
    for (const r of rows) {
      const k = Number(r.transaction_id);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(rowToSplit(r));
    }
  }
  return out;
}

/**
 * Deletes ONE split. Its amount goes to `moveToSplitId` (required when 2+ parts would remain); when only one part would remain
 * the transaction becomes a normal one in that part's category. Returns { unsplit: boolean }.
 */
function deleteOneSplit(db, userId, txId, splitId, moveToSplitId) {
  const splits = db.prepare('SELECT id, category_id, amount_minor, notes FROM transaction_splits WHERE transaction_id = ? AND user_id = ? ORDER BY sort_order, id')
    .all(txId, userId);
  const gone = splits.find((s) => Number(s.id) === splitId);
  if (!gone) throw httpError(404, 'Split not found.');
  const rest = splits.filter((s) => Number(s.id) !== splitId);

  let receiver;
  if (rest.length === 1) receiver = rest[0];
  else {
    if (moveToSplitId === null) throw v.bad('Choose which other split receives this amount (moveTo).');
    receiver = rest.find((s) => Number(s.id) === moveToSplitId);
    if (!receiver) throw v.bad('moveTo must be another split of this transaction.');
  }
  db.prepare('UPDATE transaction_splits SET amount_minor = amount_minor + ? WHERE id = ? AND user_id = ?').run(Number(gone.amount_minor), receiver.id, userId);
  db.prepare('DELETE FROM transaction_splits WHERE id = ? AND user_id = ?').run(splitId, userId);

  // The receiver's amount could now be zero (e.g. +500 and -500 merged). Zero is not allowed, so drop it too and merge again.
  // Cheap approach: if it hit zero, remove it as well; the sum is unchanged because it contributes nothing.
  const after = db.prepare('SELECT id, category_id, amount_minor FROM transaction_splits WHERE transaction_id = ? AND user_id = ? ORDER BY sort_order, id')
    .all(txId, userId);
  const zero = after.filter((s) => Number(s.amount_minor) === 0);
  for (const z of zero) db.prepare('DELETE FROM transaction_splits WHERE id = ? AND user_id = ?').run(z.id, userId);
  const left = after.filter((s) => Number(s.amount_minor) !== 0);

  if (left.length <= 1) {
    removeSplits(db, userId, txId, left.length ? (left[0].category_id === null ? null : Number(left[0].category_id)) : null);
    return { unsplit: true };
  }
  return { unsplit: false };
}

module.exports = { MIN_SPLITS, MAX_SPLITS, checkSplits, writeSplits, removeSplits, loadSplits, deleteOneSplit };
