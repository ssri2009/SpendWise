'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MIGRATIONS, openDb } = require('../server/db');

test('upgrading a Phase 1 database gives existing users their Cash account and categories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-upgrade-'));
  const file = path.join(dir, 'old.db');
  try {
    // Build exactly what a Phase 1 install looks like: only migration 1, with a real user in it.
    const old = new DatabaseSync(file);
    old.exec('PRAGMA foreign_keys = ON');
    old.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
    old.exec(MIGRATIONS[0].sql);
    old.prepare('INSERT INTO schema_migrations(id, name) VALUES (1, ?)').run(MIGRATIONS[0].name);
    old.prepare('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)').run('a@example.com', 'A', 'x');
    old.prepare('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)').run('b@example.com', 'B', 'x');
    old.close();

    const db = openDb(file);
    for (const u of db.prepare('SELECT id FROM users').all()) {
      const accts = db.prepare('SELECT name FROM accounts WHERE user_id = ?').all(u.id);
      assert.deepEqual(accts.map((a) => a.name), ['Cash']);
      const cats = db.prepare('SELECT name FROM categories WHERE user_id = ? ORDER BY id').all(u.id).map((c) => c.name);
      assert.deepEqual(cats, ['Salary', 'Food', 'Travel', 'Shopping', 'Bills', 'Other']);
    }
    // Each user got their own rows (no sharing)
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM categories').get().c, 12);

    // Opening it again must not seed twice
    db.close();
    const again = openDb(file);
    assert.equal(again.prepare('SELECT COUNT(*) AS c FROM categories').get().c, 12);
    assert.equal(again.prepare('SELECT COUNT(*) AS c FROM accounts').get().c, 2);
    again.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing migration rolls back completely and names the migration that failed', () => {
  MIGRATIONS.push({ id: 999, name: 'deliberately broken', sql: 'CREATE TABLE half_done (a); CREATE TABLE half_done (a);' });
  try {
    assert.throws(() => openDb(':memory:'), /Migration 999 \(deliberately broken\) failed/);
  } finally {
    MIGRATIONS.pop();
  }
  // With the broken one removed, a fresh database opens normally again.
  const db = openDb(':memory:');
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'half_done'").get().c, 0);
  db.close();
});
