'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MIGRATIONS, openDb } = require('../server/db');
const { monthView } = require('../server/budget');
const { totalFundsMinor } = require('../server/funds');

test('upgrading a Phase 5 database to Phase 6 only adds tables: every transaction, split, balance and budget figure is unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-p6-'));
  const file = path.join(dir, 'phase5.db');
  try {
    // Exactly what a Phase 5 install looks like: migrations 1 to 5, with real data (including a split and a reconciled row).
    const old = new DatabaseSync(file);
    old.exec('PRAGMA foreign_keys = ON');
    old.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
    for (const m of MIGRATIONS.filter((x) => x.id <= 5)) {
      old.exec(m.sql);
      old.prepare('INSERT INTO schema_migrations(id, name) VALUES (?, ?)').run(m.id, m.name);
    }
    old.prepare('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)').run('p5@example.com', 'P5', 'x');
    old.exec("INSERT INTO accounts (user_id, name, opening_balance_minor) VALUES (1, 'Cash', 100000)");
    old.exec("INSERT INTO category_groups (user_id, name, is_income) VALUES (1, 'Income', 1), (1, 'Spending', 0)");
    old.exec("INSERT INTO categories (user_id, group_id, name) VALUES (1, 1, 'Salary'), (1, 2, 'Food'), (1, 2, 'Bills')");
    old.exec(`INSERT INTO transactions (user_id, account_id, date, amount_minor, category_id, cleared, is_split) VALUES
      (1, 1, '2026-11-01', 500000, 1, 1, 0), (1, 1, '2026-11-02', -45000, 2, 1, 0), (1, 1, '2026-11-03', -12000, NULL, 0, 0),
      (1, 1, '2026-11-04', -30000, NULL, 0, 1)`);
    old.exec("INSERT INTO transaction_splits (user_id, transaction_id, category_id, amount_minor) VALUES (1, 4, 2, -10000), (1, 4, 3, -20000)");
    old.exec("INSERT INTO rules (user_id, name, conditions, actions) VALUES (1, 'r', '[]', '[]')");
    old.close();

    const db = openDb(file);
    assert.deepEqual(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id), MIGRATIONS.map((m) => m.id));
    assert.equal(MIGRATIONS.at(-1).id >= 6, true);

    // nothing that existed changed
    const t = db.prepare('SELECT COUNT(*) AS n, SUM(amount_minor) AS s, SUM(is_split) AS sp FROM transactions').get();
    assert.deepEqual([t.n, t.s, t.sp], [4, 413000, 1]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transaction_splits').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM rules').get().n, 1);
    assert.equal(totalFundsMinor(db, 1), 513000);
    const m = monthView(db, 1, '2026-11');
    assert.equal(m.incomeMinor, 500000);
    assert.equal(m.uncategorizedSpendMinor, 12000);
    assert.equal(m.groups[0].categories.find((c) => c.name === 'Food').activityMinor, -45000 - 10000);
    assert.equal(m.groups[0].categories.find((c) => c.name === 'Bills').activityMinor, -20000);

    // the new tables exist, empty, with the duplicate guard
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedules').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_occurrences').get().n, 0);
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_occ_unique'").get();
    assert.match(idx.sql, /UNIQUE/);

    // an account that a schedule uses cannot be removed behind the app's back
    db.prepare(`INSERT INTO schedules (user_id, name, account_id, amount_minor, frequency, start_date, next_date)
      VALUES (1, 'x', 1, -100, 'monthly', '2027-01-01', '2027-01-01')`).run();
    assert.throws(() => db.prepare('DELETE FROM accounts WHERE id = 1').run(), /FOREIGN KEY/);
    db.close();

    // opening it again changes nothing
    const again = openDb(file);
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, MIGRATIONS.length);
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 4);
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM schedules').get().n, 1);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a user removes their schedules and occurrences (nothing is left behind)', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (email, display_name, password_hash) VALUES ('a@example.com', 'A', 'x')").run();
  db.prepare("INSERT INTO accounts (user_id, name) VALUES (1, 'Cash')").run();
  db.prepare(`INSERT INTO schedules (user_id, name, account_id, amount_minor, frequency, start_date, next_date)
    VALUES (1, 'x', 1, -100, 'monthly', '2027-01-01', '2027-01-01')`).run();
  db.prepare("INSERT INTO schedule_occurrences (user_id, schedule_id, due_date, amount_minor) VALUES (1, 1, '2027-01-01', -100)").run();
  db.prepare('DELETE FROM users WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedules').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schedule_occurrences').get().n, 0);
  db.close();
});
