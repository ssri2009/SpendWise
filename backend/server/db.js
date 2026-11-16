'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { seedUser } = require('./seed');

// Append new migrations to the end. Never edit one that has shipped.
const MIGRATIONS = [
  {
    id: 1,
    name: 'users and sessions',
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        currency      TEXT NOT NULL DEFAULT 'INR',
        locale        TEXT NOT NULL DEFAULT 'en-IN',
        budget_mode   TEXT NOT NULL DEFAULT 'envelope',
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        last_login_at TEXT
      );
      CREATE TABLE sessions (
        id_hash    TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        user_agent TEXT
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);
    `,
  },
  {
    id: 2,
    name: 'accounts, categories, payees, transactions',
    sql: `
      CREATE TABLE accounts (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name                  TEXT NOT NULL,
        type                  TEXT NOT NULL DEFAULT 'checking',
        offbudget             INTEGER NOT NULL DEFAULT 0,
        closed                INTEGER NOT NULL DEFAULT 0,
        opening_balance_minor INTEGER NOT NULL DEFAULT 0,
        sort_order            INTEGER NOT NULL DEFAULT 0,
        created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE UNIQUE INDEX idx_accounts_name ON accounts(user_id, name COLLATE NOCASE);

      CREATE TABLE category_groups (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        is_income  INTEGER NOT NULL DEFAULT 0,
        hidden     INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX idx_groups_name ON category_groups(user_id, name COLLATE NOCASE);

      CREATE TABLE categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        group_id   INTEGER NOT NULL REFERENCES category_groups(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        icon       TEXT NOT NULL DEFAULT '📦',
        hidden     INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX idx_categories_name ON categories(group_id, name COLLATE NOCASE);
      CREATE INDEX idx_categories_user ON categories(user_id);

      CREATE TABLE payees (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name                TEXT NOT NULL,
        default_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
      );
      CREATE UNIQUE INDEX idx_payees_name ON payees(user_id, name COLLATE NOCASE);

      CREATE TABLE transactions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        date         TEXT NOT NULL,
        amount_minor INTEGER NOT NULL,
        payee_id     INTEGER REFERENCES payees(id) ON DELETE SET NULL,
        category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        notes        TEXT NOT NULL DEFAULT '',
        cleared      INTEGER NOT NULL DEFAULT 0,
        imported_id  TEXT,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_tx_user_date ON transactions(user_id, date);
      CREATE INDEX idx_tx_user_account ON transactions(user_id, account_id, date);
      CREATE INDEX idx_tx_user_category ON transactions(user_id, category_id);
      CREATE UNIQUE INDEX idx_tx_imported ON transactions(user_id, imported_id) WHERE imported_id IS NOT NULL;
    `,
    // People who signed up during Phase 1 get the same starting setup as new sign-ups.
    run(db) {
      for (const u of db.prepare('SELECT id FROM users').all()) seedUser(db, u.id);
    },
  },
  {
    id: 3,
    name: 'envelope budget: monthly assignments and category transfers',
    sql: `
      -- One row per (month, category) the user has touched. No row = nothing assigned, no rollover flag.
      -- Activity and Available are never stored: they are computed from transactions, so they cannot drift.
      CREATE TABLE budget_months (
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        month          TEXT    NOT NULL,                 -- 'YYYY-MM'
        category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        assigned_minor INTEGER NOT NULL DEFAULT 0,       -- paise; may be negative after a transfer out of a rolled-over balance
        carryover      INTEGER CHECK (carryover IN (0, 1)), -- NULL = same as the previous month that set it; 1 = carry overspending forward; 0 = deduct it from next month's To Budget
        updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (user_id, month, category_id)
      ) WITHOUT ROWID;
      CREATE INDEX idx_budget_months_cat ON budget_months(category_id);

      -- Append-only audit trail of money moved between categories. Names are copied in so the history still
      -- reads correctly after a category is renamed, merged or deleted (the id then becomes NULL).
      CREATE TABLE budget_transfers (
        id                          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id                     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        month                       TEXT    NOT NULL,
        from_category_id            INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        to_category_id              INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        from_name                   TEXT    NOT NULL,
        to_name                     TEXT    NOT NULL,
        amount_minor                INTEGER NOT NULL CHECK (amount_minor > 0),
        from_available_before_minor INTEGER NOT NULL,
        from_available_after_minor  INTEGER NOT NULL,
        to_available_before_minor   INTEGER NOT NULL,
        to_available_after_minor    INTEGER NOT NULL,
        note                        TEXT    NOT NULL DEFAULT '',
        created_at                  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_budget_transfers_user ON budget_transfers(user_id, month, id);
    `,
  },
  {
    id: 4,
    name: 'payee archiving and rules',
    sql: `
      -- Archived payees are hidden from pickers but keep their history. Using one again un-archives it.
      ALTER TABLE payees ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

      -- One row per rule. Conditions and actions are JSON, validated by server/rules.js on every write
      -- (never trusted on read). Execution order = sort_order ascending, then id.
      CREATE TABLE rules (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT    NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1,
        match_mode TEXT    NOT NULL DEFAULT 'all' CHECK (match_mode IN ('all', 'any')),
        stop_after INTEGER NOT NULL DEFAULT 0,
        conditions TEXT    NOT NULL,
        actions    TEXT    NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_rules_user ON rules(user_id, sort_order, id);
    `,
  },
  {
    id: 5,
    name: 'split transactions and reconciliation',
    sql: `
      -- One row per completed reconciliation (the history). Nothing here is ever edited; "undo" deletes the newest one.
      CREATE TABLE reconciliations (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id              INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        statement_date          TEXT    NOT NULL,                 -- the date printed on the bank statement
        statement_balance_minor INTEGER NOT NULL,                 -- the balance printed on it
        cleared_balance_minor   INTEGER NOT NULL,                 -- SpendWise's cleared balance when you finished, BEFORE any adjustment
        difference_minor        INTEGER NOT NULL,                 -- statement - cleared (0 = they matched)
        adjustment_minor        INTEGER NOT NULL DEFAULT 0,       -- the adjustment transaction written to close the gap (0 = none)
        adjustment_tx_id        INTEGER,                          -- that transaction (plain number: it is deleted together with this row on undo)
        transaction_count       INTEGER NOT NULL,                 -- how many transactions this reconciliation locked in
        note                    TEXT    NOT NULL DEFAULT '',
        created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_recon_account ON reconciliations(user_id, account_id, id);

      -- reconciliation_id: set when a transaction is locked in by a reconciliation. is_split: 1 = the amount is shared out in transaction_splits
      -- and the transaction's own category_id is NULL.
      ALTER TABLE transactions ADD COLUMN reconciliation_id INTEGER REFERENCES reconciliations(id) ON DELETE SET NULL;
      ALTER TABLE transactions ADD COLUMN is_split INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_tx_account_cleared ON transactions(user_id, account_id, cleared);

      -- The parts of a split transaction. Invariant (enforced in server/splits.js, checked by tests):
      -- the amounts of a transaction's splits add up to the transaction's own amount, and there are at least two.
      CREATE TABLE transaction_splits (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        amount_minor   INTEGER NOT NULL CHECK (amount_minor != 0),
        notes          TEXT    NOT NULL DEFAULT '',
        sort_order     INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_splits_tx ON transaction_splits(transaction_id, sort_order, id);
      CREATE INDEX idx_splits_cat ON transaction_splits(user_id, category_id);

      -- THE one place that knows how to read "what category got how much". The budget, the reports and the category
      -- filters all read this view, so a split transaction can never be counted twice or not at all:
      -- a normal transaction is one line; a split transaction is one line per split (and its own amount is not used).
      CREATE VIEW tx_lines AS
        SELECT t.id AS tx_id, t.user_id AS user_id, t.account_id AS account_id, t.date AS date, t.cleared AS cleared,
               t.amount_minor AS amount_minor, t.category_id AS category_id, 0 AS split_id
          FROM transactions t WHERE t.is_split = 0
        UNION ALL
        SELECT t.id, t.user_id, t.account_id, t.date, t.cleared, s.amount_minor, s.category_id, s.id
          FROM transactions t JOIN transaction_splits s ON s.transaction_id = t.id WHERE t.is_split = 1;
    `,
  },
  {
    id: 6,
    name: 'scheduled and recurring transactions',
    sql: `
      -- One row per schedule (a rule such as "Netflix, every month"). Append-only migration: no existing table is touched.
      -- The recurrence is worked out from start_date every time (see server/recurrence.js); occ_index is the number of the NEXT
      -- occurrence to handle and next_date is its date (NULL = finished: one-time schedule done, or past end_date).
      CREATE TABLE schedules (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name          TEXT    NOT NULL,
        account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        payee_id      INTEGER REFERENCES payees(id) ON DELETE SET NULL,
        category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        amount_minor  INTEGER NOT NULL CHECK (amount_minor != 0),         -- negative = expense (a bill), positive = income
        notes         TEXT    NOT NULL DEFAULT '',
        cleared       INTEGER NOT NULL DEFAULT 0,                         -- cleared status given to the transactions it creates
        mode          TEXT    NOT NULL DEFAULT 'approval' CHECK (mode IN ('auto', 'approval')),
        frequency     TEXT    NOT NULL CHECK (frequency IN ('once', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom')),
        interval_n    INTEGER NOT NULL DEFAULT 1 CHECK (interval_n >= 1),
        interval_unit TEXT    NOT NULL DEFAULT 'month' CHECK (interval_unit IN ('day', 'week', 'month', 'year')),
        start_date    TEXT    NOT NULL,
        end_date      TEXT,
        occ_index     INTEGER NOT NULL DEFAULT 0,
        next_date     TEXT,
        paused        INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_schedules_user ON schedules(user_id, paused, next_date);
      CREATE INDEX idx_schedules_account ON schedules(account_id);

      -- One row per occurrence that has "arrived" (or was paid / skipped early). THE duplicate guard is the UNIQUE index:
      -- a schedule can only ever have one occurrence for a given due date, however many times the engine runs.
      --   pending = waiting for you to approve it   posted = a transaction was created   skipped = you chose not to pay it
      CREATE TABLE schedule_occurrences (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        schedule_id    INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
        due_date       TEXT    NOT NULL,
        status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'skipped')),
        amount_minor   INTEGER NOT NULL,
        transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
        note           TEXT    NOT NULL DEFAULT '',
        created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        resolved_at    TEXT
      );
      CREATE UNIQUE INDEX idx_occ_unique ON schedule_occurrences(schedule_id, due_date);
      CREATE INDEX idx_occ_user_status ON schedule_occurrences(user_id, status, due_date);
    `,
  },
];

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      if (m.run) m.run(db);
      db.prepare('INSERT INTO schema_migrations(id, name) VALUES (?, ?)').run(m.id, m.name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.id} (${m.name}) failed: ${err.message}`);
    }
  }
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

/** Run fn atomically. Not re-entrant: never call inside another inTransaction. */
function inTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* connection already rolled back */ }
    throw err;
  }
}

module.exports = { openDb, inTransaction, MIGRATIONS };
