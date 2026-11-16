# Phase 4: payees and rules

New: `server/rules.js`, `server/routes/payees.js`, `server/routes/rules.js`, migration 4 (`payees.archived`, table `rules`),
`public/js/pages/payees.js`, `public/js/pages/rules.js`, `tests/payees.test.js`, `tests/rules.test.js`.
Changed: `server/routes/transactions.js` (rules on create), `server/routes/dataio.js` (rules on import, rewrite-proof duplicate check),
`server/routes/categories.js` (merge/delete re-point rules), `server/txquery.js` (archived payees come back when used),
`server/app.js`, `public/pages/{payees,rules,transactions,settings}.html`, `public/js/{txform.js,pages/transactions.js,pages/settings.js}`,
`public/css/app.css` (appended), `README.md`, `package.json`.

## Upgrade
Unzip over your folder, keep `data/`, run `npm start`. Migration 4 adds a column and a table and changes nothing else.
Then `npm test`: expect 114 passing.

## Decisions worth knowing
1. **Rules run on create and import only.** Editing or bulk-changing never runs them, so a manual correction is never silently undone.
2. **Every matching rule runs, last one wins per field, notes accumulate**, "stop after" ends the run. Full contract in the README.
3. **Rules win over typed values** for the fields they set (that is the point of a rule). Import can be switched off per file.
4. **Re-apply is preview-first.** The API only writes when `dryRun` is exactly `false`.
5. **Payee delete is refused while used**; merge or archive instead. Archived payees return automatically when you type them again.
6. **Imports stay idempotent** even though rules rewrite rows: each imported row stores a fingerprint (`imported_id`) of the original file row.
7. **Not built**: regex / starts-with conditions, set-amount/date/account actions, rules in the JSON backup, payee-level auto-rules from the default category.
