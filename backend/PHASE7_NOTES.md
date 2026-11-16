# Phase 7: reports, analytics, net worth, cash flow, insights

## New files
`server/reports.js` (all the maths), `public/js/charts.js`, `public/js/pages/reports.js`, `public/js/pages/reports-views.js`, `tests/reports.test.js`.

## Changed files
`server/routes/reports.js` (eight new routes; the Phase 5 route is unchanged and still first), `server/app.js` (passes `clock` to the reports routes: one word),
`public/pages/reports.html` (replaces the "coming soon" panel), `public/css/app.css` (appended), `README.md`, `package.json` (2.0.0-alpha.7).

Not touched: authentication, sessions, accounts, transactions, the budget engine, payees, rules, splits, reconciliation, CSV import, schedules, the forecast. **No migration**: `schema_migrations` still has 6 rows and a Phase 6 database opens as it is (a test checks this, and that running every report writes nothing).

## Upgrade
Unzip over your folder, keep `data/`, `npm start`. Then `npm test`: expect **253 passing** (235 from Phases 1 to 6 plus 18 new).

## Decisions worth knowing
1. **One set of definitions** (top of `server/reports.js`): income, expense, net, refunds, splits. Every report uses it, so the numbers cannot disagree. Refunds reduce their category (same as the Budget). Splits are read through `tx_lines`.
2. **"As of today".** Reports stop at today, so the current month is "so far". It is compared with the same number of days last month, not a whole month. Net worth today differs from Total Funds only by transactions dated in the future.
3. **Liabilities** = credit and loan accounts (balance negated). Every other type, including "other", is an asset. Change the account type if you want it the other way round.
4. **Savings** is the change in Savings + Investment balances. It is separate from net cash flow because transfers do not exist yet; an income-only deposit into a savings account is both income and "added to savings".
5. **Leave out** (categories) is the answer to "transfers count twice" until real transfers are built. It is remembered per browser.
6. **Compare-with-before** is calendar-aware (see README). A category that only existed in the previous period still shows, at zero.
7. **The insights projection is never a warning.** Early-month rent makes a straight-line guess look high, so it is a note; warnings are reserved for things that are true (pace against the same point, overspent envelopes, shortfalls).
8. **Charts have no library.** SVG and HTML, redrawn at the width they are shown at, each with a table view and keyboard access. Chart colours are `--viz-*` variables in `app.css`, validated for both themes. Income/expense in charts are blue/orange (safe for colour-blind readers); the text amounts elsewhere keep the app's green/red with +/- signs and arrows.
9. **CSV**: `?format=csv` on every report, formula-neutralised like the transactions export, byte-order mark so Excel reads the rupee sign.
10. **Limits**: 240 columns per chart (400 with a clear message), 50 years per period, 200 "leave out" categories, net worth history 120 months.

## How it was checked
- 18 new tests with hand-worked numbers (a 17-transaction ledger over 6 accounts, including a split, a refund, an uncategorised spend, a future-dated bill, a closed account and a credit card): period and bucket maths, every report, totals that add up across four breakdowns, net worth equal to Total Funds, insights, CSV, isolation between users, no writes, no schema change, and bad input.
- Full regression: all 235 earlier tests pass unchanged.
- In headless Chrome against a 15-month demo database with the date pinned: all eight tabs in dark and light and at 390px wide (no console errors, no failed requests, no horizontal overflow); hover and keyboard tooltips, table views, period / grouping / custom dates / account / "leave out" filters (and that "leave out" is remembered), category and account drill-downs, month picker, net-worth range and the CSV link.
