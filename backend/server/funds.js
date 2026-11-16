'use strict';
// Total Funds = the money you actually hold right now = the sum of every account's balance.
// Each account's balance is opening_balance + all of its transactions, so the sum across accounts is
// (all opening balances) + (all transactions). Deliberately ignores every filter (month, type, search,
// account) so it can never disagree with the Accounts page. Includes closed and off-budget accounts,
// exactly like the Accounts list does. Always scoped to one user.
function totalFundsMinor(db, userId) {
  const row = db.prepare(`
    SELECT
      COALESCE((SELECT SUM(opening_balance_minor) FROM accounts WHERE user_id = ?), 0) +
      COALESCE((SELECT SUM(amount_minor) FROM transactions WHERE user_id = ?), 0) AS total`).get(userId, userId);
  return Number(row.total);
}

module.exports = { totalFundsMinor };
