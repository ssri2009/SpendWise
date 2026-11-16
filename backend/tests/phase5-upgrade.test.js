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

test('upgrading a Phase 4 database to Phase 5 keeps every transaction, balance and budget figure exactly as it was', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-p5-'));
  const file = path.join(dir, 'phase4.db');
  try {
    // Build exactly what a Phase 4 install looks like: migrations 1 to 4 only, with real data in it.
    const old = new DatabaseSync(file);
    old.exec('PRAGMA foreign_keys = ON');
    old.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
    for (const m of MIGRATIONS.filter((x) => x.id <= 4)) {
      old.exec(m.sql);
      old.prepare('INSERT INTO schema_migrations(id, name) VALUES (?, ?)').run(m.id, m.name);
    }
    old.prepare('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)').run('p4@example.com', 'P4', 'x');
    old.exec("INSERT INTO accounts (user_id, name, opening_balance_minor) VALUES (1, 'Cash', 100000)");
    old.exec("INSERT INTO category_groups (user_id, name, is_income) VALUES (1, 'Income', 1), (1, 'Spending', 0)");
    old.exec("INSERT INTO categories (user_id, group_id, name) VALUES (1, 1, 'Salary'), (1, 2, 'Food')");
    old.exec(`INSERT INTO transactions (user_id, account_id, date, amount_minor, category_id, cleared) VALUES
      (1, 1, '2026-11-01', 500000, 1, 1), (1, 1, '2026-11-02', -45000, 2, 1), (1, 1, '2026-11-03', -12000, NULL, 0)`);
    old.close();

    // Figures before the upgrade, computed with the Phase 5 engine on the Phase 4 schema is impossible (the view does not exist
    // yet), so compare against hand-checked numbers.
    const db = openDb(file);
    // A Phase 4 database upgrades through every later migration (5, and then any newer one such as Phase 6's).
    assert.deepEqual(db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id), MIGRATIONS.map((m) => m.id));

    const t = db.prepare('SELECT COUNT(*) AS n, SUM(amount_minor) AS s, SUM(is_split) AS sp, COUNT(reconciliation_id) AS r FROM transactions').get();
    assert.deepEqual([t.n, t.s, t.sp, t.r], [3, 443000, 0, 0], 'nothing changed, nothing split, nothing reconciled');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tx_lines').get().n, 3, 'every old transaction is exactly one line');
    assert.equal(db.prepare('SELECT SUM(amount_minor) AS s FROM tx_lines').get().s, 443000);
    assert.equal(totalFundsMinor(db, 1), 543000);

    const m = monthView(db, 1, '2026-11');
    assert.equal(m.incomeMinor, 500000);
    assert.equal(m.groups[0].categories[0].activityMinor, -45000);      // Food
    assert.equal(m.uncategorizedSpendMinor, 12000);
    assert.equal(m.toBudgetMinor, 100000 + 500000 - 12000);
    db.close();

    // opening it again changes nothing
    const again = openDb(file);
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, MIGRATIONS.length);
    assert.equal(again.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 3);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
