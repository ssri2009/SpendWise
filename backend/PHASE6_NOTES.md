# Phase 6: scheduled and recurring transactions, bills, calendar, cash-flow forecast

## New files
`server/recurrence.js`, `server/schedules.js`, `server/forecast.js`, `server/routes/schedules.js`, `server/routes/forecast.js`,
`public/pages/{bills,calendar,forecast}.html`, `public/pages/schedules.html` (replaces the "coming soon" panel),
`public/js/{schedcommon,schedform}.js`, `public/js/pages/{schedules,bills,calendar,forecast}.js`,
`tests/{recurrence,schedules,forecast,schedules-security,phase6-upgrade}.test.js`.

## Changed files
`server/db.js` (migration 6), `server/app.js` (routes, `/bills` `/calendar` `/forecast` pages, catch-up hook, start-up run and 15-minute timer, `server.clock`),
`server/config.js` (`fixedToday`, tests only), `server/routes/{accounts,payees,categories}.js` (keep schedule references valid, see below),
`public/js/layout.js` (Schedules tab stays highlighted on the three sub-pages), `public/css/app.css` (appended),
`tests/phase5-upgrade.test.js` (compares with the `MIGRATIONS` list instead of a hard-coded `[1..5]`),
`README.md`, `.env.example` and `docker-compose.yml` (`TZ`), `package.json` (2.0.0-alpha.6).

Not touched: authentication, sessions, transactions, the budget engine's calculations, the rules engine's matching/ordering, splits, reconciliation, CSV import/export.

## Upgrade / migration
Unzip over your folder, **keep `data/`**, run `npm start`. Migration 6 runs by itself, inside one database transaction, and is append-only:

- table `schedules` (the templates), with `account_id` ON DELETE RESTRICT, `payee_id` and `category_id` ON DELETE SET NULL
- table `schedule_occurrences` (one row per handled or waiting date: `pending`, `posted` or `skipped`), cascade-deleted with its schedule; `transaction_id` is SET NULL, so deleting a transaction never breaks history
- unique index `idx_occ_unique (schedule_id, due_date)`: the structural guarantee behind "no duplicate generation"
- indexes on `schedules(user_id)`, `schedules(account_id)`, `schedule_occurrences(user_id, status)`

No existing table, column, row or view is changed. For a database with no schedules every Phase 5 number (balances, Total Funds, budget) is identical (`tests/phase6-upgrade.test.js` checks this against a real Phase 5 database, and that a failing migration 6 rolls back completely).

Rolling back to Phase 5 code is not supported once migration 6 has run, and the Phase 5 code would not know about schedules. **Take a backup first** (copy `data/`). The JSON backup does not contain schedules.

Set `TZ` (see `.env.example`). Docker users get it from `docker-compose.yml`. Without it "today" is the server's zone, often UTC.

Then `npm test`: expect **235 passing** (168 from Phases 1 to 5 plus 67 new).

## Decisions worth knowing
1. **Occurrence k comes from the start date**, never from the previous occurrence, so month-end days do not drift (31 Jan, 28 Feb, 31 Mar). Feb 29 yearly falls back to Feb 28 in common years. Dates stop at the year 2200.
2. **Duplicates are prevented by the database**, not just by code: a UNIQUE index on `(schedule_id, due_date)`, one transaction per schedule, `INSERT ... ON CONFLICT DO NOTHING`. Tested with concurrent runs, pay-early, and an edit that lands on a handled date.
3. **Edits are forward-only.** Changing the repeat rule or start date, or reviving a finished schedule with a later stop date, continues from today and never back-fills.
4. **Pause generates nothing.** Resume skips missed dates unless `catchUp: true`.
5. **Two execution modes**: `auto` creates the transaction; `approval` queues it. A closed account in auto mode queues the item with a note rather than failing.
6. **Generated transactions run through the rules engine** and payee matching like any manual one, then fall back to the payee's default category.
7. **Catch-up is lazy**: at start-up, every 15 minutes, and (throttled to once a minute per user, re-checked on a new day) before an authenticated page load or API read. The schedule and forecast routes always catch up first. At most 366 occurrences per schedule per run.
8. **Forecast current funds** = opening balances + transactions dated today or earlier. Future-dated ledger transactions are treated as upcoming events. Waiting items count on today (or their due date if later). Posted and skipped items are never counted, so nothing is counted twice.
9. **Budget impact reuses the budget engine**: scheduled events (on-budget accounts only) are added to a copy of the facts and `simulate` is run before and after, so carry-over and overspending chain across months exactly as on the Budget page.
10. **Reference safety**: deleting an account with schedules, or a payee used by one, is refused with 409; merging payees or categories re-points schedules; deleting a category re-points to the target or clears it.
11. **Isolation**: every query is scoped by `user_id`; another user's schedule, occurrence or account returns 404. 500 schedules per user maximum.
12. **Not built**: "last day of month" / "2nd Tuesday" patterns, end-after-N-times, transfers, variable amounts, schedules in the JSON backup, Reports page (Phase 7).

## How it was checked
- 67 new tests: recurrence maths (month ends, leap years, quarterly, custom, bounds), schedule CRUD and validation, auto and approval modes, pause/resume/catch-up, duplicate prevention (including concurrent runs), rules on generated transactions, forecast arithmetic for 7/30/90 days, bills, calendar, budget impact (chained, hand-computed), multi-user isolation, and the Phase 5 to 6 upgrade.
- Full regression (all Phase 1 to 5 tests) passes unchanged except one test whose hard-coded migration list was generalised.
- The four new pages were opened in headless Chrome against a seeded database with the date pinned: no console errors, no failed requests, create / edit / pause / resume / pay / approve dialogs work, and no horizontal overflow at phone width.
