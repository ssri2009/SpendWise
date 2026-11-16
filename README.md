# SpendWise v2

Multi-user budgeting app. Node.js server, SQLite database, your original glass/gradient UI.

**Status: Phases 0 to 7 done.** Login and sessions, multiple accounts, editable categories,
the Transactions page (daily list, filters, add/edit/delete, bulk actions), CSV and full-backup
export, import of your old localStorage backup, the **envelope Budget** (Phase 3), **Payees and Rules** (Phase 4), **Split transactions, Reconciliation and CSV import** (Phase 5), **Scheduled & recurring transactions, Bills, Calendar and Cash-flow forecast** (Phase 6), and now **Reports, analytics, net worth and insights** (Phase 7).

**Upgrading from Phase 1, 2, 3, 4, 5 or 6?** Just replace the files (keep your `data/` folder) and run `npm start`.
Your database upgrades itself on startup; no data is changed or lost. Phase 3 added two tables; Phase 4 adds one table (`rules`) and one column (`payees.archived`). Phase 5 (migration 5) adds two tables (`transaction_splits`, `reconciliations`), two columns on `transactions` (`is_split`, `reconciliation_id`) and one read-only view (`tx_lines`). See `PHASE5_NOTES.md`. Phase 6 (migration 6) adds two tables (`schedules`, `schedule_occurrences`) and nothing else. See `PHASE6_NOTES.md`. **Phase 7 changes no table, column or view** (no migration 7): a Phase 6 database opens exactly as it is. See `PHASE7_NOTES.md`.

## Run it (local)

Needs **Node 22.13 or newer** (`node -v`). There is nothing to `npm install`.

```bash
npm start
# open http://localhost:3000 and create your account
```

First run creates `data/spendwise.db` and a dev-only `data/.session-secret`.

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with auto-restart on file changes |
| `npm test` | Run the automated tests (253 tests, ~10 s) |
| `npm run user:reset-password -- you@example.com` | Set a new password from the terminal (also signs that user out everywhere) |

## Settings (`.env`)

Copy `.env.example` to `.env`. Everything has a safe default for local use.
For production you **must** set `SESSION_SECRET` (32+ random characters); the app refuses to start without it.

## Self-host with Docker

```bash
cp .env.example .env     # set SESSION_SECRET, DOMAIN, and ALLOW_SIGNUP=false after you sign up
docker compose up -d --build                 # app on 127.0.0.1:3000
docker compose --profile https up -d         # + Caddy with automatic HTTPS on your DOMAIN
```

Your database lives in the `spendwise_data` volume.

## Managed cloud

Deploy the Dockerfile on Render / Railway / Fly.io. Set `SESSION_SECRET`, `TRUST_PROXY=1`,
and attach a **persistent disk/volume mounted at `/app/data`** (SQLite is a file, so without
a persistent disk you lose your data on every deploy). Not for static hosts such as Neocities
or GitHub Pages: they cannot run Node.

## Security notes (what is implemented)

- Passwords hashed with scrypt (per-user salt, parameters stored with the hash); 10-character minimum + common-password check
- Sessions: random 256-bit token in an HttpOnly, SameSite=Lax cookie (Secure in production); only a SHA-256 of the token is stored; session ID is replaced on login
- CSRF: signed double-submit token + Origin check on every write
- Login rate limit (5 failures / 15 min per IP+email, 30 per IP); sign-up limit (10 / hour per IP)
- Same error for "wrong password" and "unknown email", and constant-time work for both
- CSP (scripts from this site only), `X-Frame-Options: DENY`, `nosniff`, HSTS in production
- Static files served only from `/css`, `/js`, `/img` (no path traversal, `/server` and `/data` are never reachable)
- Every `/api` route except the auth ones requires a session. Every data table carries `user_id` and every query filters by it; a test makes user B try to read, edit, delete, merge into and attach to user A's records and expects "not found" each time.

## Troubleshooting

**"Missing or invalid security token"** when logging in or registering. The sign-in cookie is signed with
your `SESSION_SECRET`. In development that secret is created once in `data/.session-secret`. If you run the
app from a new folder (or delete `data/`), the secret changes and your browser still holds a cookie signed
with the old one. The page now repairs this by itself: it fetches a fresh token and retries once, and the
server replaces the bad cookie. If you ever still see it, clear cookies for `localhost` once.
**Keep the `data/` folder when you update**, so your database and secret move with you.

## What Phase 2 added

- **Accounts**: any number (checking, savings, cash, credit...), opening balance, off-budget flag, close instead of delete when it has history
- **Editable categories**: rename (history follows, same id), add, hide, change icon, reorder by drag or ▲▼, move between groups, **merge**, and **delete with "move transactions to..."**
- **Transactions page** (`/transactions`): grouped by day, filter by account / month / type / category / search, add, edit, delete (with confirmation), select several and set category / mark cleared / delete
- **Money is stored as whole paise** (integers), so there are no rounding errors. Amounts you type are parsed from text, never through floating point
- **Import your old backup** (Settings → Your data): converts rupees to paise, skips records you already have (safe to import twice), keeps two real identical purchases, reports how many were invalid, and creates an "Imported" group for any category you no longer have
- **Export**: CSV (follows the filters you have on screen; spreadsheet formulas in titles are neutralised) and a full JSON backup that can be restored into any account
- Fixed from the old app: the "today" date no longer jumps to yesterday between midnight and 5:30 am IST (it used UTC)

## Reading the cards on the Transactions page

| Card | What it is | Follows filters? | Opening balances? |
|---|---|---|---|
| **Total Funds** | Money you hold right now: the sum of every account balance (same figure as Settings → Accounts) | **No**, never changes with month, account, type, category or search | **Included** |
| **Net This Period** | Income − Expenses of the transactions currently shown | Yes (month, account, category, search) | Not included |
| **Income** / **Expenses** | Money in / out of the transactions currently shown | Yes | Not included |

So the two can legitimately differ. Example: Cash ₹3,300 + Federal Savings ₹2,000 → Total Funds ₹5,300, while a month with only a ₹1,700 expense shows Net This Period −₹1,700.
Total Funds includes closed and off-budget accounts, exactly like the Accounts list. The type filter (Income/Expenses) is deliberately ignored by the three period cards so they always add up.

## The Budget (Phase 3)

Open **Budget**. It follows Actual Budget's envelope rules with SpendWise's look.

**The four numbers**

| Name | Meaning |
|---|---|
| **To Budget** | Money you have but have not given a job yet |
| **Assigned** | What you put in each category this month (type it in the Assigned box, press Enter) |
| **Activity** | What you spent (or got refunded) in that category this month, straight from your Transactions |
| **Available** | What is left in the category: `rolled in from last month + Assigned + Activity` |

**How money moves**

- **Income raises To Budget** until you assign it. Income = a positive transaction in an Income-group category (like Salary) or with no category, plus the opening balance of each on-budget account.
- **Expenses reduce the category's Available**, not To Budget. A positive amount in an expense category is a refund and raises that category.
- **Spending with no category** has no envelope to come out of, so it comes straight out of To Budget (the money is gone) and the page says so. Categorize it later and the same amount moves out of that envelope instead. This keeps one rule true at all times: **To Budget + every Available = the money in your on-budget accounts**.
- **Off-budget accounts** (Settings → Accounts) are left out of the budget completely.
- **You cannot over-allocate.** Assigning more than To Budget is refused with the amount you do have. The same check covers later months (it will not push a future month's To Budget below zero) and months before your first data. Lowering an assignment is always allowed.
- **Months are separate, balances roll.** Each month has its own Assigned. Positive Available and unassigned To Budget roll into the next month automatically, across empty months too. Switch months with ◀ ▶, the month menu, "This month", or the URL (`/budget/2026-11`).
- **Overspending** shows a red ⚠ pill, a tinted row, a note on the row, a group badge and a banner. By default the overspent amount is **taken out of next month's To Budget** and the category restarts at ₹0 (Actual's default). Turn on **Roll over overspending** in the category's ⋯ menu to keep the negative balance in the category instead. That setting is sticky: it applies from the month you set it until you change it, and it never rewrites earlier months.
- **Move money between categories**: click a category's Available amount (or "Cover" an overspent one: the amount is pre-filled). You can move at most what the source has available. To Budget does not change. Every move is saved in the **Move-money history** panel with before and after balances, an optional note and the time. Names are copied in, so history still reads correctly after you rename, merge or delete a category.
- **Groups and categories**: add groups and categories on the page, click a name to rename it, drag **⋮⋮** to reorder or move between groups (or ⋯ → Move up / down, which also works on touch screens), ▲ ▼ to reorder groups, ✎ to rename or hide a group. Merging or "delete and move to…" a category also moves its budgeted money; deleting one with no target returns its budgeted money to To Budget.

Activity, Available and To Budget are never stored. They are worked out from your transactions each time, so they cannot drift out of step. Only what you assign is stored.

## Payees and Rules (Phase 4)

### Payees

Open **Payees**. Every payee belongs to you alone.

- **Created automatically** the first time you type a new name on a transaction (same name in different capitals is the same payee), or by hand with **New payee**.
- **List**: search box, Active / Archived / All, sort by name, most used or recently used. Each row shows the **usage count** (transactions) and the **last-used date** (newest transaction date), its default category and how many rules mention it. **View** opens the Transactions page filtered to that payee (`/transactions?month=all&payee=ID`; there is also a removable "Payee: …" chip there).
- **Edit** renames it (all its transactions follow, because they point at the payee, not at a copy of the text) and sets an optional **default category**. The default only pre-fills the Category box of the Add form while it is still "Uncategorized". It never changes an existing transaction.
- **Merge**: tick two or more rows, **Merge selected…**, pick the one to keep. Transactions, default-category use and rules that pointed at the others move to it; the others are removed. It cannot be undone.
- **Archive** hides a payee from suggestions and the Active list. Its transactions keep it. Typing that name on a new transaction brings it back automatically.
- **Delete** only works for a payee nothing uses (no transactions, no rules). Otherwise you are told why and offered Archive.
- On the Transactions page the payee box suggests your active payees as you type, and **editing a transaction** can add or change its payee (clearing the box removes it).

### Rules

Open **Rules**. A rule is *when* (one to ten conditions) → *then* (one to ten actions). Up to 200 rules each.

| Conditions | Meaning |
|---|---|
| Description contains | The text (any capitals) appears in the payee name or the notes |
| Payee is | The payee name equals that payee's name (any capitals) |
| Amount is greater / less than | **Strict** (500 is not greater than 500). Compares the size of the amount, optionally only for expenses or only for income |
| Account is | The transaction is in that account |

Choose **ALL** conditions or **ANY** condition per rule.

| Actions | Effect |
|---|---|
| Set category | Sets the category |
| Set payee | Sets the payee (it must already exist; create it on the Payees page) |
| Add note | Adds text to the notes (see below) |
| Mark cleared | Marks the transaction cleared |

### Execution order (this is the contract)

1. Enabled rules run **top to bottom** by their position on the Rules page (position 1 first). New rules go to the bottom. Drag a rule or use ▲ ▼ to reorder. Disabled rules are skipped.
2. **Every** matching rule runs, not only the first. Each rule's conditions see the transaction **as the earlier rules left it** (so rule 1 can set a payee and rule 2 can match on that payee).
3. When several rules set the same field (category, payee, cleared), the **lowest rule in the list wins**. Notes accumulate in rule order, separated by a space. A note is skipped if the notes already contain that text, or if adding it would pass the 200-character limit (it is never cut in half).
4. A rule with **Stop after this rule** ends the run as soon as it matches. A rule that does not match never stops anything.
5. **When rules run:** when a transaction is **added** and when transactions are **imported** (Settings → Import, tick "Apply my rules", on by default). Rules win over what was typed for the fields they set. **Editing a transaction or a bulk change never runs rules.**
6. **Existing data never changes on its own.** Creating, editing, enabling or reordering a rule touches no existing transaction. Only **Re-apply rules…** does, and only after you preview and confirm.
7. The payee stays a plain name while rules run, so a rule that renames "SWIGGY*ORDER 88" to Swiggy does not leave a stray "SWIGGY*ORDER 88" payee behind.

When you add a transaction, the toast names the rules that ran. The API returns them as `rulesApplied`.

### Re-apply rules (reprocessing)

**Re-apply rules…** runs your enabled rules over transactions you already have. Choose a month (or all time), an account, and optionally "only transactions without a category". **Preview changes** shows how many would change and before/after for up to 50 of them, and changes nothing. **Apply** is a second, deliberate step. A second run changes nothing more. At most 5,000 transactions per run (narrow by month or account for more). The API default is a preview: you must send `"dryRun": false` to write.

### Import

Imported rows go through the same rules (`applyRules`, default true; send `false` to import the file exactly as it is). Re-importing the same file is still safe even though rules rewrote the stored rows: every imported row remembers a fingerprint of the original file row. The import result says how many rows rules changed.

### If something a rule points at disappears

Merging or "delete and move to…" a category or payee re-points the rules automatically. Deleting a category with no move target leaves the rule in place with a red warning on its row; that action is skipped until you fix the rule.

## Split transactions, Reconciliation and CSV import (Phase 5)

### Split transactions

One bank transaction can be shared across categories: Amazon ₹3,000 → Shopping ₹2,000 + Electronics ₹1,000.

- **Create:** in the Add or Edit form, type the amount, press **✂ Split across categories…**, pick a category and amount per part. The dialog shows "Left to assign" live and only saves when the parts add up to the paisa. **⇥ Rest** puts whatever is left into one part. 2 to 30 parts.
- **View:** a split row shows "✂ Split into N"; click **▸ N parts** to see every part with its category, amount and note.
- **Edit / delete:** **Edit split…** changes categories, amounts, notes or adds parts. Delete one part with its ✕ in the detail: you choose which other part receives its amount (when only one part would remain, the transaction turns back into a normal one). **Unsplit** in the Edit form does the same for the whole thing.
- **The rules (all enforced by the API, not just the screen):**
  1. The transaction keeps its own amount and account; balances and Total Funds always use that amount.
  2. The parts always add up to it, exactly. A bad set is refused before anything is saved.
  3. A split transaction has no category of its own. Budget, category filters and reports read the **parts** (database view `tx_lines`), so every paisa is counted once, in the right category.
  4. A part may be uncategorized.
- **Budget:** Activity per category is the sum of that category's parts. Overspending, rollover and To Budget follow.
- **Filters:** filtering by a category finds a transaction if any part is in it; the summary cards then count only that part. Without a category filter the cards use whole transactions.
- **Reports:** every report reads the parts (never the parent amount), so a split is counted once, in the right categories, and category rows always add up to the totals.
- **Rules engine:** a split transaction keeps its split categories. "Only uncategorized" re-apply skips split transactions. Bulk "set category" skips them too and says how many were skipped (`skippedSplit`).
- **Export / backup:** the CSV export has one row per part; the full backup keeps the parts and restores them.

### Cleared status

Every transaction is cleared or not. Click the ○/✓ mark on a row, tick the box in the form, or select rows and use **Mark cleared / Mark uncleared**. The Transactions page has a **Cleared** filter (all / cleared / not cleared; API `?cleared=yes|no`).

### Reconciliation

Open **Reconcile**, choose an account, enter the **statement date** and the **balance on the statement**.

- SpendWise shows **cleared balance** (opening balance + cleared transactions), **uncleared balance**, total, and the last reconciliation. Reconciliation uses **cleared transactions only**.
- Tick off the transactions that appear on the statement (or "mark all shown as cleared"). The **Difference** updates live.
- **Finish reconciliation** works only when the difference is zero; it locks the cleared transactions and writes a history entry.
- Not zero and you cannot find the reason? **Add a ±₹X adjustment and finish** records a manual adjustment transaction (payee "Reconciliation Balance Adjustment", uncategorized, already cleared) so it ties out. Uncategorized means it shows up in To Budget, where you can see and deal with it.
- Example: bank ₹13,000, SpendWise cleared ₹12,950 → "SpendWise is ₹50 short", with the choices above.
- **Locked transactions:** once reconciled, a transaction's amount, date, account and cleared status cannot change (409, with a message). Category, payee, notes and splits still can. It cannot be deleted.
- **History:** every reconciliation is listed with date, balances, adjustment and count; **Details** lists its transactions. **Undo** removes the newest reconciliation of an account (and its adjustment), unlocking its transactions; older ones are undone newest first.

### CSV import (Import page, also linked from Settings)

1. **Choose a file** and an account. Options: header row, date format (automatic day-first, or D/M/Y or M/D/Y), amount signs (negative = out, or inverted for card exports), what to do with duplicates, create missing accounts, apply rules.
2. **Match the columns.** Date, Amount (or separate Money out / Money in), Payee, Category, Account, Notes, Cleared, Type. SpendWise guesses from the header names; you can change any of them and the preview updates.
3. **Preview and review.** Every row is validated and shown as New, Possible duplicate or Error with the reason. Nothing is saved yet. Tabs: All / New / Duplicates / Errors. Untick or tick any row to override the default.
4. **Import**, then read the **summary**: imported, skipped, errors, cleared, new categories/accounts and what rules did. **Download error report** gives a CSV of the rejected rows with the reasons.

Details worth knowing:

- Amounts are parsed strictly to whole paise: `12,50` (comma decimals), more than 2 decimals, text and zero are errors, never guessed. Dates must be real calendar dates. `=`/`+`/`-`/`@` text is never treated as a formula.
- **Duplicate detection** compares **account + date + amount + payee**. It survives rules that rewrite the payee on a row imported earlier (every imported row stores a fingerprint). Two identical rows *inside the same file* are kept (you may really have bought twice) but flagged.
- **Rules run on import** (switchable): category, payee, notes and cleared are applied exactly like on a manually added transaction, and the summary counts each effect. Imported rows can also arrive already cleared (Cleared column: yes/no/true/false/1/0/cleared/✓).
- A row = one transaction. CSV import does not create splits.
- Preview and import use one shared analysis: what the preview promised is what gets imported. The import is all-or-nothing per file (a database transaction); "stop if any row has an error" is an option.
- Limits: 3 MB and 5,000 rows per file; 60 columns.
- **Security:** you can only import into your own open accounts; reconciliation history, reconciliations and splits of other users return 404.

## Scheduled transactions, Bills, Calendar and Forecast (Phase 6)

Four pages under one tab bar: **Schedules** (`/schedules`), **Bills** (`/bills`), **Calendar** (`/calendar`) and **Forecast** (`/forecast`).

### Schedules
A schedule is a template for a transaction that repeats: name, account, payee, category, amount (expense or income), notes, cleared, a **first date**, an optional **stop date**, and how it repeats. Actions: create, edit, delete, **pause**, **resume**, **pay next** (pay early), **skip next**.

| Repeat | Meaning |
|---|---|
| Daily / Weekly / Monthly / Quarterly / Yearly | Every 1 day / 7 days / 1 month / 3 months / 1 year |
| Custom | Every N days, weeks, months or years (N from 1 to 1000), e.g. "every 6 weeks" |
| Once | A single future bill |

- **Monthly never drifts.** Occurrence *k* is always worked out from the first date, not from the previous one. A schedule starting on the 31st lands on 31 Jan, 28 Feb, 31 Mar, 30 Apr and so on, and a 29 Feb yearly schedule uses 28 Feb in non-leap years and 29 Feb again in leap years.
- **When a date arrives** you choose per schedule: **Automatic** (the transaction is created for you) or **Ask me first** (it waits in the "Waiting for your approval" list on the Schedules page until you approve, change the amount/date, or skip it). Nothing touches your balance while it is waiting.
- **No duplicates, ever.** The database holds one row per schedule and due date (a UNIQUE index), each schedule is processed in a single database transaction, and the insert is "do nothing on conflict". Two browser tabs, two server runs at once, paying early, editing the schedule: the same date can never produce two transactions.
- **Pause** generates nothing. **Resume** asks what to do with dates that passed meanwhile: skip them (default) or create them now.
- **Editing the repeat rule or first date** applies from today forward; it does not back-fill the past. Moving a stop date later on a finished schedule continues from today as well.
- **Catch-up.** Due items are generated at app start, every 15 minutes, and (at most once a minute per user) when you open any page. So if the server was off for a week, everything due is created or queued next time it runs. At most 366 occurrences per schedule are processed per run, so a schedule dated far in the past cannot flood the database; the rest follows on the next run.
- **Rules apply.** A generated transaction goes through the same rules engine as one you type (payee rules, category, notes, cleared) and then the payee's default category if it is still uncategorized. Payees are created or matched case-insensitively, exactly as for manual transactions.
- **Closed account?** An automatic schedule whose account was closed is queued for approval with a note instead of failing silently.
- Accounts, payees and categories that a schedule uses cannot be deleted by accident: deleting an account with schedules is refused (409); a payee is refused until merged or the schedule changed; merging payees or categories re-points schedules.

### Bills & subscriptions
Overdue (waiting for you), Upcoming (next 14 / 30 / 60 / 90 days), Paid (last 60 days) and Skipped, plus four totals including the **monthly cost of your repeating bills** (a yearly ₹18,000 insurance counts as ₹1,500 a month). Only expenses are bills; income schedules show on the Calendar and Forecast. "Mark paid" on a future bill pays that schedule's **next** one early.

### Calendar
A Sunday-first month grid with prev / next / this month and an account filter. Each chip is one event: income (green) or expense (red); **dashed** = upcoming, **bold outline** = waiting for approval, **✔** = created, **struck through** = skipped. Click a day for details and to approve waiting items. The month's income, expenses and net are shown above the grid. On a phone the chips shrink to coloured bars.

### Cash-flow forecast
Pick 7, 30 or 90 days (all three are also shown side by side).

- **Current funds** = opening balances + every transaction dated today or earlier.
- **Upcoming income / expenses** = scheduled occurrences still to happen in the window, plus anything you have already entered with a **future date** in the ledger, plus occurrences waiting for approval (counted on today if overdue).
- **Estimated balance** = current funds + income − expenses, with the **lowest point** and the **first date it goes below zero**, and a step chart of the balance day by day.
- Nothing is counted twice: a posted occurrence is already a transaction, a skipped one is gone, and an item waiting for approval counts once.

**Budget impact.** For every month in the window, the scheduled money is added to a *copy* of your budget and the budget engine is run before and after, so the numbers follow the same rules as your Budget page: carry-over, overspending, and envelopes that do or do not roll over. The table shows, per category, *Available now → Scheduled → Available after* and flags envelopes that will be **short**. Scheduled items in off-budget accounts move your cash but not your envelopes.

### Time zone
"Today" is the **server's** local date. Set `TZ` (for example `TZ=Asia/Kolkata`) so a bill due on the 1st is created on the 1st in your time zone, not on the 1st in UTC. In Docker, `TZ` is set for you in `docker-compose.yml`.

### Security
Schedules, waiting items, bills, calendar and forecast are all scoped to the signed-in user in the query itself. Another user's id returns 404 (not 403) so it cannot be probed. Accounts, payees and categories sent in a schedule must belong to you. Every write needs the CSRF token.

## Reports, analytics, net worth and insights (Phase 7)

Open **Reports**. Tabs: **Overview** (this month, insights, last six months), **Spending**, **Income**, **Cash flow**, **Categories**, **Accounts**, **Net worth**, **Monthly summary**. One filter row sits above the numbers and scopes everything below it: Period (this month ... all time, or your own dates), Group by (monthly, quarterly, yearly), Account, "Accounts counted" (all / on-budget / off-budget) and **Leave out** (categories to remove from the numbers). Every tab except Overview and Net worth uses them; **Download CSV** gives the same numbers as a spreadsheet.

### The definitions (one set, used by every report)
- **Expense** = a line in any non-Income category, or an uncategorised negative line. A **refund** (positive amount in an expense category) *reduces* that category. **Income** = a line in an Income category, or an uncategorised positive line. **Net cash flow** = income - expenses = the plain sum of every line. Opening balances are not income.
- A split transaction is counted by its **parts**, so by category it is never double counted; by payee and account it is still one transaction.
- That is why **by category, by payee, by account and over time always add up to the same total** (tested), and why Cash flow's net equals the Transactions page's income - expenses for the same dates.
- "So far" reports stop at **today**. A transaction dated in the future is not in them until its day arrives.
- **Compare with before:** a period that starts on the 1st is compared with the same months directly before it; a month in progress is compared with the **same number of days** last month (not with a whole month); this year / last year is compared with a year earlier; anything else with the same number of days before.
- **Net worth** = assets - liabilities, as of a date. Balance = opening balance + transactions up to that date (the same sum as the Accounts page). Credit cards and loans are liabilities (what you owe = minus the balance); every other account type is an asset. Closed accounts count while they hold money. Today's net worth equals Total Funds once nothing is dated in the future (tested).
- **Savings** = the change in your Savings and Investment account balances in the period. **Savings rate** = net cash flow / income.
- **Insights** are rules, not guesses: spending pace against the same point last month, a straight-line projection (always a note, never a warning), the biggest category, a category that jumped, last month's savings rate and income change, the largest expense, overspent budget envelopes, uncategorised transactions, and the net worth move since last month end. Each states its numbers.

### Charts
Plain SVG, no library (the Content-Security-Policy allows scripts from this site only). Every chart has a legend when it shows two or more series, a hover **and keyboard** tooltip (click or Tab into the chart, then the arrow keys; Esc closes), a **View as table**, and colours that work in both themes (the validated eight-colour order from the data-visualisation guide; checked with its validator). Bars on one baseline are used to compare parts; the doughnut is for the one-look share.

### Reports only read
No report writes anything. They need a sign-in, they only see your own accounts and categories (another user's account or category id is "not found"), and bad input is a clear 400.

## Known limits (honest list)
- Reports: **no transfers**, so a transfer recorded as an expense plus an income counts as both. Give it its own category and use **Leave out**. History before today assumes every opening balance was there from the start (opening balances have no date). Investment accounts show what you recorded, not market value. Reports are not in the JSON backup because they are computed, not stored. No budget-vs-actual chart over time, no tags, no forecast of unscheduled spending, no PDF/print layout beyond the browser's Print.
- Schedules: no "last day of month" or "every 2nd Tuesday" patterns (the day of the first date is kept, clamped to short months). No end-after-N-times (use a stop date). No transfers between accounts (same gap as Transactions). Schedules are **not** part of the JSON backup or CSV export (migrate by copying `data/`). Amounts are fixed; to change them edit the schedule or change the amount when you approve. The forecast does not estimate unscheduled spending (it only knows what you scheduled or dated in the future).
- Scheduled time is the server's local day; there is no time-of-day.
- **SQLite only for now.** `DB_CLIENT=pg` is rejected with a clear message. Postgres comes with the data phases.
- Rate-limit counters are in memory (reset on restart; fine for one instance).
- No email-based password reset yet; use the CLI command above.
- Budget: no "hold money for next month", no "copy last month's budget" button, no per-category goals/templates. Amounts you assign are whole paise typed by you.
- Budget: if you lower or delete income after assigning it, To Budget can go negative. The page shows a red "Overbudgeted" warning instead of refusing (a transaction change cannot be refused retroactively).
- Budget: moving a category into an Income group removes it from the budget grid, and money assigned to it returns to To Budget.
- Transfers between accounts are not built yet. A transfer today is an expense in one account plus an income in the other.
- Splits: a split transaction has no category of its own, so a rule's "set category" is ignored when you create it as a split, and bulk "set category" skips it. The summary cards count whole transactions unless a category filter is on. 
- Reconciliation: one statement at a time per account; Undo goes newest first. The adjustment transaction is uncategorized on purpose.
- CSV import: one row = one transaction (no splits from CSV), CSV only (no OFX/QIF), 3 MB / 5,000 rows per file.
- Rules: no regular-expression or "starts with" conditions, no "set amount/date/account" actions, and no "payee contains". Rules are **not** part of the JSON backup file (payee names are). The "same note twice" check is a plain text-contains test, so a note that is a fragment of an existing one is skipped.
- Payees: a payee's default category only pre-fills the form. A payee cannot be deleted while a transaction or rule uses it (merge or archive instead). Archived payees still show on their old transactions.
- Restoring a full backup puts any category you no longer have into an "Imported" group, and keeps all accounts by name. Category icons and groups are not restored one-to-one.
- Dragging across a very long page relies on your browser's own auto-scroll. The ▲ ▼ buttons and the Edit dialog (Group menu) do the same thing without dragging.
- Uses Node's built-in `node:sqlite`, which Node still labels experimental (the warning is hidden in the npm scripts).

## Layout

```
server/    index.js (boot) · app.js (router, CSRF, page guards) · db.js (migrations)
           security.js (scrypt, CSRF) · sessions.js · ratelimit.js · http.js · config.js
           seed.js (starter data) · validate.js · txquery.js (shared filter) · funds.js (Total Funds)
           budget.js (envelope engine: To Budget, rollover, overspending, transfers)
           rules.js (rules engine: validation, runRules, reprocess, reference rewriting)
           splits.js (split rules: validate, write, delete one) · csv.js (CSV parser, date/amount parsing)
           recurrence.js (date maths, no drift) · schedules.js (engine + CRUD, dedupe) · forecast.js (forecast, bills, calendar, budget impact)
           routes/ schedules.js · forecast.js · accounts.js · categories.js · transactions.js · budget.js · payees.js · rules.js · dataio.js (import/export)
                   reconcile.js · csvimport.js (preview + commit) · reports.js (Phase 7 report maths; routes/reports.js is the API)
public/    css/style.css (your original, untouched) · css/app.css (new additions)
           js/layout.js (nav, theme, session) · js/api.js · js/ui.js (dom, modal) · js/money.js
           js/txform.js (add/edit fields) · js/splitedit.js (split dialog)
           js/schedcommon.js (tabs, approve/pay dialogs) · js/schedform.js (schedule form) · js/pages/*.js
           pages/*.html (one per route)
scripts/   reset-password.js
tests/     auth · data (isolation, categories, import, CSV) · money · upgrade · csrf · funds · budget · payees · rules
           splits · reconcile · csvimport · phase5-upgrade
           recurrence · schedules · forecast · schedules-security · phase6-upgrade
```

## Routes

`/` `/login` `/register` are public. `/budget` (also `/budget/2026-11`) `/transactions`
`/reports` (also `/reports/:id`) `/schedules` `/bills` `/calendar` `/forecast` `/payees` `/rules` `/reconcile` `/import` `/settings` require login
and redirect to `/login?next=...` otherwise.

## API (Phases 2 to 6)

All need a login and (for writes) the CSRF header, which `public/js/api.js` adds for you.

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/accounts` | List with balances (plus `totalFundsMinor`) / create |
| PATCH / DELETE | `/api/accounts/:id` | Edit, close / delete (only when empty) |
| GET | `/api/categories` | Groups with their categories and usage counts |
| POST / PATCH / DELETE | `/api/category-groups[/:id]` | Add / rename, hide / delete (only when empty) |
| POST | `/api/categories` | Add `{groupId, name, icon}` |
| PATCH | `/api/categories/:id` | Rename, icon, hide, change group |
| POST | `/api/categories/reorder` | `{items: [{id, groupId, sortOrder}]}` (all or nothing) |
| POST | `/api/category-groups/reorder` | `{ids: [...]}`: every group once, in the new order |
| POST | `/api/categories/:id/merge` | `{targetId}` (its budgeted money moves too) |
| GET | `/api/budget/:month` | One month (`2026-11`): `toBudgetMinor`, totals, and per group/category `carryInMinor assignedMinor activityMinor availableMinor overspent carryover` |
| PATCH | `/api/budget/:month/categories/:id` | `{assignedMinor}` (refused if it over-allocates) and/or `{carryover: true\|false}` |
| POST | `/api/budget/:month/transfers` | `{fromCategoryId, toCategoryId, amountMinor, note?}` → writes the audit row |
| GET | `/api/budget-transfers` | Audit trail, newest first. `?month=2026-11&limit=` |
| DELETE | `/api/categories/:id?moveTo=ID\|none` | `moveTo` required when it has transactions |
| GET | `/api/transactions` | Filters: `account month from to type category payee q min max limit offset`. Returns `summary: {incomeMinor, expenseMinor, netMinor, totalFundsMinor}`; `netMinor` follows the filters, `totalFundsMinor` never does |
| GET | `/api/transactions/months` | Months that have data |
| POST / PATCH / DELETE | `/api/transactions[/:id]` | Amounts are signed whole paise (expense negative) |
| POST | `/api/transactions/bulk` | `{ids, action: "delete"}` or `{ids, action: "update", changes}` |
| POST | `/api/import/spendwise-backup` | `{data, accountId?}`: old v1 file or a full v2 backup |
| GET | `/api/export/transactions.csv` | Same filters as the list |
| GET | `/api/export/full.json` | Full backup |
| GET / POST | `/api/payees` | List `?q=&status=active\|archived\|all&sort=name\|usage\|last&limit=&offset=` → `{payees, total}` (each: `usageCount lastUsed ruleCount defaultCategoryId archived`) / create `{name, defaultCategoryId?}` |
| GET / PATCH / DELETE | `/api/payees/:id` | One / `{name?, defaultCategoryId?, archived?}` / delete (409 while used) |
| POST | `/api/payees/:id/merge` | `{targetId}` → `{payee, moved}` |
| GET | `/api/transactions?payee=ID` | Filter by payee (combines with every other filter) |
| GET / POST | `/api/rules` | List in execution order (`position`, `problems[]`) / create (appended last). Body `{name, enabled?, matchMode: all\|any, stopAfter?, conditions[], actions[]}` |
| GET / PATCH / DELETE | `/api/rules/:id` | One / partial update (a list you send replaces that whole list) / delete |
| POST | `/api/rules/reorder` | `{ids: [...]}` every rule once, in the new order (all or nothing) |
| POST | `/api/rules/reprocess` | `{dryRun?: true, month?, accountId?, onlyUncategorized?, ruleIds?}`. **Preview unless `dryRun` is exactly `false`** |
| POST | `/api/transactions` | Now also returns `rulesApplied: [{id, name}]` |
| POST | `/api/import/spendwise-backup` | Now accepts `applyRules` (default true) and reports `rulesApplied` when rules ran |

| POST / PATCH | `/api/transactions[/:id]` | Phase 5: accept `splits: [{categoryId, amountMinor, notes}]` (must sum to the amount; not together with `categoryId`), `splits: null` to unsplit, and `cleared`. Responses carry `isSplit`, `splits`, `reconciled` |
| GET | `/api/transactions/:id` | One transaction (with its splits) |
| PUT | `/api/transactions/:id/splits` | Replace all splits |
| DELETE | `/api/transactions/:id/splits/:splitId?moveTo=SPLITID` | Remove one part; its amount moves to `moveTo` (not needed when one part would remain) |
| GET | `/api/transactions?cleared=yes\|no\|all` | Cleared filter. The `category` filter also matches split parts |
| POST | `/api/transactions/bulk` | Now `{affected, skippedSplit}`; `changes.cleared` for bulk clear/unclear; 409 for reconciled rows where it would change them |
| GET | `/api/accounts/:id/reconciliation` | `openingBalanceMinor clearedBalanceMinor unclearedBalanceMinor balanceMinor clearedCount unclearedCount lockedCount lastReconciliation transactions[]` |
| POST | `/api/accounts/:id/reconcile` | `{statementBalanceMinor, statementDate, adjust?, note?}`. 409 `code:"discrepancy"` with `differenceMinor` unless it matches or `adjust: true` |
| GET | `/api/reconciliations[?account=ID]` · `/api/reconciliations/:id` | History / one entry with its transactions |
| DELETE | `/api/reconciliations/:id` | Undo (newest of that account only) |
| POST | `/api/import/csv/preview` | `{csv, accountId, mapping?, hasHeader?, dateFormat?, amountMode?, duplicates?, decisions?, createAccounts?, applyRules?}` → headers, mapping, summary and per-row status. Saves nothing |
| POST | `/api/import/csv/commit` | Same body plus `onErrors: "skip"\|"abort"` → `{imported, skippedDuplicates, importedDuplicates, skippedByChoice, errorRows, clearedImported, newCategories, newAccounts, rules, errors[]}` |
| GET | `/api/reports/spending-by-category` | `?month=2026-11` or `from`/`to`, `account`, `offbudget`. Counts split parts, never the parent (Phase 5, unchanged) |
| GET | `/api/reports/spending` | By category, payee, account and over time. See "Reports" below for the filters every report takes |
| GET | `/api/reports/income` | Sources, trend, month by month, year by year |
| GET | `/api/reports/cashflow` | Income, expenses, net cash flow, savings rate and savings-account growth per period |
| GET | `/api/reports/categories` | This period against the one before; `&category=ID\|none` adds a drill-down |
| GET | `/api/reports/accounts` | Start balance, money in, money out, end balance per account; `&account=ID` adds its chart and latest transactions |
| GET | `/api/reports/monthly-summary` | `?month=2026-11` (default: this month so far) |
| GET | `/api/reports/net-worth` | `?months=1..120\|all` → current assets / liabilities by account type, and the history |
| GET | `/api/reports/insights` | Plain-language findings, warnings first |

| GET | `/api/schedules` | `?status=all\|active\|paused\|finished` → `{today, schedules[]}` (each: `name accountId payee categoryId amountMinor kind notes cleared mode frequency frequencyLabel intervalN intervalUnit startDate endDate nextDate paused status pendingCount monthlyEquivalentMinor`) |
| POST | `/api/schedules` | `{name?, accountId, payee?, categoryId?, amountMinor (signed), notes?, cleared?, mode: "auto"\|"approval", frequency: once\|daily\|weekly\|monthly\|quarterly\|yearly\|custom, interval?, unit?, startDate, endDate?}` → `201 {schedule, generated}` (a start date that has already arrived is processed straight away) |
| GET / PATCH / DELETE | `/api/schedules/:id` | One / partial update (repeat or start-date changes apply from today) / delete (created transactions stay) |
| POST | `/api/schedules/:id/pause` · `/resume` | Resume takes `{catchUp?: true}`; default skips missed dates |
| POST | `/api/schedules/:id/post-next` | Pay the next occurrence now: `{amountMinor?, date?, notes?}` |
| POST | `/api/schedules/:id/skip-next` | Skip the next occurrence |
| POST | `/api/schedules/run` | Process everything due now (also runs automatically) → `{generated: {posted, pending, duplicates, more}}` |
| GET | `/api/schedule-occurrences` | `?status=pending\|posted\|skipped\|all&schedule=ID&limit=` (default `pending`, limit default 200, max 500) |
| POST | `/api/schedule-occurrences/:id/approve` · `/skip` | Approve `{amountMinor?, date?, notes?}` creates the transaction (409 if already handled) / skip |
| GET | `/api/forecast` | `?days=1..365&account=ID` → `currentFundsMinor upcomingIncomeMinor upcomingExpensesMinor estimatedBalanceMinor lowestBalanceMinor lowestDate firstNegativeDate events[] timeline[] horizons[7,30,90] categoryImpact` |
| GET | `/api/bills` | `?upcomingDays=&paidDays=&account=` → `overdue[] upcoming[] paid[] skipped[] totals` |
| GET | `/api/calendar` | `?month=2026-11&account=ID` → `days[{date, events[]}] totals prevMonth nextMonth today` |

Condition objects: `{type:'description_contains', value}`, `{type:'payee_equals', payeeId}`, `{type:'amount_gt'\|'amount_lt', valueMinor, direction?: any\|expense\|income}`, `{type:'account_equals', accountId}`.

Action objects: `{type:'set_category', categoryId}`, `{type:'set_payee', payeeId}`, `{type:'add_note', text}`, `{type:'mark_cleared'}`.
Another user's payee, category, account or rule id gives 404 (or 400 when it is named inside a rule body).
