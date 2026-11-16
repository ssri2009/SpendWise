# Phase 5: split transactions, reconciliation, advanced CSV import

## New files
`server/splits.js`, `server/csv.js`, `server/routes/reconcile.js`, `server/routes/csvimport.js`, `server/routes/reports.js`,
`public/pages/{reconcile,import}.html`, `public/js/pages/{reconcile,import}.js`, `public/js/splitedit.js`,
`tests/{splits,reconcile,csvimport,phase5-upgrade}.test.js`.

## Changed files
`server/db.js` (migration 5), `server/budget.js` (reads the `tx_lines` view; the engine's logic is untouched),
`server/txquery.js` (category filter matches split parts, `cleared` filter), `server/rules.js` (split-aware reprocess),
`server/routes/{transactions,categories,dataio}.js`, `server/app.js` (routes + `/reconcile`, `/import` pages),
`public/js/{txform.js,layout.js,pages/transactions.js,pages/settings.js}`, `public/pages/{transactions,settings}.html`,
`public/css/app.css` (appended), `README.md`, `package.json` (2.0.0-alpha.5).

Not touched: authentication, sessions, accounts, payees, the rules engine's matching/ordering, the budget calculations.

## Upgrade / migration
Unzip over your folder, **keep `data/`**, run `npm start`. Migration 5 runs by itself, inside one database transaction, and is append-only:

- table `transaction_splits` (parts of a split transaction)
- table `reconciliations` (history)
- `transactions.is_split` (default 0) and `transactions.reconciliation_id` (default NULL): existing rows are unchanged
- view `tx_lines`: one line per normal transaction, one per split part. Budget and reports read it. For data without splits it returns exactly what the `transactions` table did, so Phase 4 balances and budget numbers are identical (checked by `tests/phase5-upgrade.test.js` against a real Phase 4 database).

No data is rewritten or removed. Rolling back to Phase 4 code is not supported once migration 5 has run (Phase 4 would not know to read split parts), so take a backup first (Settings → Download full backup, or copy `data/`).

Then `npm test`: expect **168 passing**.

## Decisions worth knowing
1. **A split transaction has no category of its own**; its parts carry them. Totals, balances and Total Funds use the transaction amount; budget, category filters and reports use the parts.
2. **Parts must sum to the amount, to the paisa**, enforced in the API for create, edit, replace and delete-one-part. Deleting a part moves its amount to another part you choose; the total can never change by accident.
3. **Reconciliation uses cleared transactions only** and finishing it **locks** them (amount, date, account, cleared, delete). Category, payee, notes and splits stay editable. Undo (newest first) unlocks.
4. **Adjustments are uncategorized** on purpose, so the money shows up in To Budget instead of hiding in a category.
5. **Rules do not create splits**: a rule's "set category" is ignored for a transaction created as a split. Bulk "set category" skips split transactions and reports `skippedSplit`.
6. **CSV: preview and import share one analysis**, and import re-checks inside its database transaction. Strict money parsing (no guessing `12,50`). Duplicate key = account + date + amount + payee, rewrite-proof through a per-row fingerprint. Identical rows inside one file are kept and flagged.
7. **Rules run on CSV import** (switchable) through the same engine as manual add; the summary counts category/payee/notes/cleared effects.
8. **CSV export is one row per split part**; the JSON backup keeps splits and restores them (a backup whose parts do not add up is rejected as invalid).
9. **Not built**: Reports page (Phase 7; only `GET /api/reports/spending-by-category` exists), splits from CSV, OFX/QIF, partial reconciliation of a single statement across accounts.

## How it was checked
168 automated tests (Phases 1 to 4 untouched and passing, plus 54 new for Phase 5), mutation checks on the new money-critical code (10 of 10 deliberate bugs caught), and a headless-browser pass through the real screens (split dialog, reconcile, import wizard) with no console errors.
