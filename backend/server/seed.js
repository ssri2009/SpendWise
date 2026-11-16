'use strict';

// What every new account starts with: one "Cash" account plus your original six
// categories, now as editable rows instead of a hard-coded list.
const DEFAULT_GROUPS = [
  { name: 'Income', isIncome: 1, categories: [['Salary', '💼']] },
  {
    name: 'Usual Expenses', isIncome: 0,
    categories: [['Food', '🍕'], ['Travel', '✈️'], ['Shopping', '🛍️'], ['Bills', '🧾'], ['Other', '📦']],
  },
];

function seedUser(db, userId) {
  db.prepare("INSERT INTO accounts (user_id, name, type, sort_order) VALUES (?, 'Cash', 'cash', 0)").run(userId);
  const insGroup = db.prepare('INSERT INTO category_groups (user_id, name, is_income, sort_order) VALUES (?, ?, ?, ?)');
  const insCat = db.prepare('INSERT INTO categories (user_id, group_id, name, icon, sort_order) VALUES (?, ?, ?, ?, ?)');
  DEFAULT_GROUPS.forEach((g, gi) => {
    const groupId = Number(insGroup.run(userId, g.name, g.isIncome, gi).lastInsertRowid);
    g.categories.forEach(([name, icon], ci) => insCat.run(userId, groupId, name, icon, ci));
  });
}

module.exports = { seedUser, DEFAULT_GROUPS };
