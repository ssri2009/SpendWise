'use strict';
// Advanced CSV import: preview first, then import. Two endpoints share ONE analysis function, so the preview can
// never promise something the import then does differently.
//
//   POST /api/import/csv/preview   { csv, accountId, mapping?, hasHeader?, dateFormat?, amountMode?, createAccounts?, duplicates?, decisions? }
//        Writes NOTHING. Returns the detected columns, a suggested mapping, every row with its parsed values, its problems,
//        and whether it looks like a duplicate of a transaction you already have.
//   POST /api/import/csv/commit    same body + { applyRules?, onErrors? }
//        Imports what the analysis says to import (rows with errors are never imported) and returns a summary.
//
// DUPLICATES: a row is a possible duplicate when your account already has a transaction with the same DATE, AMOUNT and PAYEE
// (payee compared ignoring capitals and extra spaces). Counting is by repeats: if the file has the same row twice and you already
// have it once, one is a duplicate and one is new. Re-importing a file you already imported is detected even when your rules
// rewrote the payee (every imported row remembers a fingerprint of what the FILE said).
//   duplicates: "skip" (default) skips them, "import" imports them anyway; decisions {"<row number>": "import"|"skip"} overrides one row.
//
// RULES: the same rules engine as everywhere else runs on every imported row (applyRules, default true). Rules win over the
// file for the fields they set. Their effect is counted in the summary (categories / payees / notes / cleared).

const crypto = require('node:crypto');
const { httpError, sendJson } = require('../http');
const { inTransaction } = require('../db');
const v = require('../validate');
const C = require('../csv');
const R = require('../rules');
const { findOrCreatePayee } = require('../txquery');

const MAX_BYTES = 3 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_ERROR_ROWS_RETURNED = 1000;
const DATE_FORMATS = ['auto', 'DMY', 'MDY', 'YMD'];
const AMOUNT_MODES = ['signed', 'inverted'];

const normPayee = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
const fingerprint = (date, amount, payeeNorm, accountKey) =>
  crypto.createHash('sha1').update([date, amount, payeeNorm, accountKey].join('|')).digest('hex');

module.exports = ({ db }) => {
  /** Reads and checks everything the client sent. Never trusts the mapping, the account or the numbers. */
  function readOptions(userId, b, { forCommit }) {
    if (typeof b.csv !== 'string' || !b.csv.trim()) throw v.bad('Choose a CSV file first.');
    if (b.csv.length > MAX_BYTES) throw v.bad('That file is too big (3 MB limit).');
    const dateFormat = b.dateFormat === undefined ? 'auto' : b.dateFormat;
    if (!DATE_FORMATS.includes(dateFormat)) throw v.bad(`dateFormat must be one of: ${DATE_FORMATS.join(', ')}.`);
    const amountMode = b.amountMode === undefined ? 'signed' : b.amountMode;
    if (!AMOUNT_MODES.includes(amountMode)) throw v.bad(`amountMode must be one of: ${AMOUNT_MODES.join(', ')}.`);
    const duplicates = b.duplicates === undefined ? 'skip' : b.duplicates;
    if (duplicates !== 'skip' && duplicates !== 'import') throw v.bad('duplicates must be "skip" or "import".');
    const hasHeader = b.hasHeader === undefined ? true : !!v.boolish(b.hasHeader, 'hasHeader');
    const createAccounts = b.createAccounts === undefined ? false : !!v.boolish(b.createAccounts, 'createAccounts');
    const applyRules = b.applyRules === undefined ? true : !!v.boolish(b.applyRules, 'applyRules');
    const onErrors = b.onErrors === undefined ? 'skip' : b.onErrors;
    if (onErrors !== 'skip' && onErrors !== 'abort') throw v.bad('onErrors must be "skip" or "abort".');

    let decisions = {};
    if (b.decisions !== undefined && b.decisions !== null) {
      if (typeof b.decisions !== 'object' || Array.isArray(b.decisions)) throw v.bad('decisions must be an object.');
      for (const [k, val] of Object.entries(b.decisions)) {
        if (!/^\d{1,5}$/.test(k) || (val !== 'import' && val !== 'skip')) throw v.bad('decisions must look like {"3": "import", "7": "skip"}.');
        decisions[Number(k)] = val;
      }
    }

    // The account the rows go into (rows may name another one of YOUR accounts in an Account column).
    if (b.accountId === undefined || b.accountId === null) throw v.bad('Pick an open account to import into.');
    const account = db.prepare('SELECT id, name FROM accounts WHERE id = ? AND user_id = ? AND closed = 0').get(v.intId(b.accountId, 'accountId'), userId);
    if (!account) throw v.bad('Pick an open account to import into.');
    return { dateFormat, amountMode, duplicates, hasHeader, createAccounts, applyRules, onErrors, decisions, account, forCommit, mapping: b.mapping };
  }

  function analyze(userId, opt, csvText) {
    const { delimiter, rows: all } = C.parseCsv(csvText, undefined);
    if (!all.length) throw v.bad('That file is empty.');
    const headers = opt.hasHeader ? all[0].map((h) => String(h).trim()) : all[0].map((_, i) => `Column ${i + 1}`);
    const dataRows = opt.hasHeader ? all.slice(1) : all;
    const columnCount = Math.max(headers.length, ...dataRows.slice(0, 200).map((r) => r.length));
    while (headers.length < columnCount) headers.push(`Column ${headers.length + 1}`);
    const truncated = Math.max(0, dataRows.length - MAX_ROWS);
    const data = dataRows.slice(0, MAX_ROWS);

    const suggestedMapping = opt.hasHeader ? C.suggestMapping(headers) : Object.fromEntries(C.MAPPING_FIELDS.map((f) => [f, null]));
    const mapping = opt.mapping === undefined || opt.mapping === null ? suggestedMapping : C.cleanMapping(opt.mapping, columnCount);
    const hasAmount = mapping.amount !== null || mapping.debit !== null || mapping.credit !== null;
    const base = {
      delimiter, headers, columnCount, totalRows: data.length, truncated, mapping, suggestedMapping,
      sample: data.slice(0, 8),
    };
    if (mapping.date === null || !hasAmount) {
      return { ...base, needsMapping: true, rows: [], summary: null };
    }

    // ---- what this user already has (only this user's rows, ever) ----
    const accountsByName = new Map(db.prepare('SELECT id, name, closed FROM accounts WHERE user_id = ?').all(userId)
      .map((a) => [a.name.toLowerCase(), { id: Number(a.id), name: a.name, closed: !!a.closed }]));
    const categoriesByName = new Map();
    for (const c of db.prepare('SELECT id, name FROM categories WHERE user_id = ? ORDER BY id').all(userId)) {
      const k = c.name.toLowerCase();
      if (!categoriesByName.has(k)) categoriesByName.set(k, { id: Number(c.id), name: c.name });
    }

    const parsed = data.map((cells, i) => parseRow(cells, i + 1, mapping, opt, accountsByName, categoriesByName));

    // ---- duplicate detection ----
    const dates = parsed.filter((r) => r.date).map((r) => r.date).sort();
    const have = new Map();         // 'date|amount|payee|accountId' -> [existing ids, oldest first]
    const importedCount = new Map(); // fingerprint -> how many imports of it already exist
    const importedMax = new Map();   // fingerprint -> highest repeat number used
    if (dates.length) {
      const existing = db.prepare(
        `SELECT t.id, t.account_id, t.date, t.amount_minor, COALESCE(p.name, '') AS payee, t.imported_id
           FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id
          WHERE t.user_id = ? AND t.date >= ? AND t.date <= ? ORDER BY t.id`
      ).all(userId, dates[0], dates[dates.length - 1]);
      for (const e of existing) {
        const k = [e.date, Number(e.amount_minor), normPayee(e.payee), Number(e.account_id)].join('|');
        if (!have.has(k)) have.set(k, []);
        have.get(k).push({ id: Number(e.id), date: e.date, amountMinor: Number(e.amount_minor), payee: e.payee, accountId: Number(e.account_id) });
      }
    }
    for (const e of db.prepare("SELECT imported_id FROM transactions WHERE user_id = ? AND imported_id LIKE 'csv:%'").all(userId)) {
      const m = /^csv:([0-9a-f]{40}):(\d+)$/.exec(e.imported_id);
      if (!m) continue;
      importedCount.set(m[1], (importedCount.get(m[1]) || 0) + 1);
      importedMax.set(m[1], Math.max(importedMax.get(m[1]) || 0, Number(m[2])));
    }
    const acctNames = new Map([...accountsByName.values()].map((a) => [a.id, a.name]));

    const seenInFile = new Map();
    for (const r of parsed) {
      if (r.errors.length) { r.status = 'error'; r.action = 'error'; continue; }
      const pn = normPayee(r.payee);
      const accountKey = r.accountId === null ? `new:${r.accountName.toLowerCase()}` : String(r.accountId);
      const key = [r.date, r.amountMinor, pn, accountKey].join('|');
      const nth = (seenInFile.get(key) || 0) + 1;
      seenInFile.set(key, nth);
      r.repeat = nth > 1;
      r.fingerprint = fingerprint(r.date, r.amountMinor, pn, accountKey);
      const same = have.get(key) || [];
      const known = Math.max(same.length, importedCount.get(r.fingerprint) || 0);
      if (nth <= known) {
        r.status = 'duplicate';
        const hit = same[nth - 1];
        r.duplicateOf = hit
          ? { id: hit.id, date: hit.date, amountMinor: hit.amountMinor, payee: hit.payee, accountName: acctNames.get(hit.accountId) || '' }
          : { id: null, via: 'import history' };
        r.action = opt.decisions[r.n] || (opt.duplicates === 'import' ? 'import' : 'skip');
      } else {
        r.status = 'new';
        r.action = opt.decisions[r.n] === 'skip' ? 'skip' : 'import';
      }
    }

    const count = (f) => parsed.filter(f).length;
    const newCategories = [...new Set(parsed.filter((r) => r.action === 'import' && r.newCategory).map((r) => r.category))];
    const newAccounts = [...new Set(parsed.filter((r) => r.action === 'import' && r.accountId === null && r.accountName).map((r) => r.accountName))];
    const summary = {
      totalRows: parsed.length,
      newRows: count((r) => r.status === 'new'),
      duplicateRows: count((r) => r.status === 'duplicate'),
      errorRows: count((r) => r.status === 'error'),
      repeatedInFile: count((r) => r.repeat),
      willImport: count((r) => r.action === 'import'),
      willSkip: count((r) => r.action === 'skip'),
      newCategories, newAccounts,
      clearedRows: count((r) => r.action === 'import' && r.cleared === 1),
    };
    return { ...base, needsMapping: false, rows: parsed, summary, importedMax };
  }

  /** One CSV row -> a clean record, or a list of everything that is wrong with it (all problems at once, not just the first). */
  function parseRow(cells, n, mapping, opt, accountsByName, categoriesByName) {
    const cell = (f) => (mapping[f] === null || mapping[f] === undefined ? '' : String(cells[mapping[f]] ?? '').trim());
    const text = (f) => C.unquoteFormula(cell(f));
    const errors = [];
    const r = {
      n, date: null, amountMinor: null, payee: '', category: '', categoryId: null, newCategory: false,
      account: '', accountId: opt.account.id, accountName: opt.account.name, notes: '', cleared: 0, errors,
      status: 'new', action: 'import', repeat: false, duplicateOf: null, fingerprint: null,
      raw: null,
    };
    const attempt = (fn) => { try { return fn(); } catch (e) { errors.push(e.message); return undefined; } };

    r.date = attempt(() => C.parseDate(cell('date'), opt.dateFormat)) ?? null;

    // Amount: one signed column, or debit + credit columns; an optional Type column says income / expense.
    attempt(() => {
      let amt;
      if (mapping.amount !== null) {
        amt = C.parseAmount(cell('amount'));
      } else {
        const debit = C.parseOptionalAmount(cell('debit'));
        const credit = C.parseOptionalAmount(cell('credit'));
        if (debit === null && credit === null) throw new Error('Both Debit and Credit are empty.');
        if (debit !== null && credit !== null) throw new Error('Both Debit and Credit have a value.');
        amt = debit !== null ? -Math.abs(debit) : Math.abs(credit);
      }
      if (mapping.type !== null && mapping.amount !== null) {
        amt = C.parseType(cell('type')) === 'income' ? Math.abs(amt) : -Math.abs(amt);
      } else if (opt.amountMode === 'inverted' && mapping.amount !== null) {
        amt = -amt;
      }
      r.amountMinor = amt;
    });

    r.payee = text('payee');
    if (r.payee.length > 60) errors.push(`Payee is longer than 60 characters (${r.payee.length}).`);
    r.notes = text('notes');
    if (r.notes.length > 200) errors.push(`Notes are longer than 200 characters (${r.notes.length}).`);

    r.category = text('category');
    if (r.category.length > 40) errors.push(`Category is longer than 40 characters (${r.category.length}).`);
    else if (r.category) {
      const hit = categoriesByName.get(r.category.toLowerCase());
      if (hit) { r.categoryId = hit.id; r.category = hit.name; } else r.newCategory = true;
    }

    r.account = text('account');
    if (r.account) {
      if (r.account.length > 40) errors.push(`Account is longer than 40 characters (${r.account.length}).`);
      else {
        const hit = accountsByName.get(r.account.toLowerCase());
        if (hit) {
          if (hit.closed) errors.push(`Account "${hit.name}" is closed.`);
          r.accountId = hit.id; r.accountName = hit.name;
        } else if (opt.createAccounts) {
          r.accountId = null; r.accountName = r.account;     // created when you import
        } else {
          errors.push(`Account "${r.account}" does not exist. Fix the name, or tick "Create accounts that don't exist yet".`);
        }
      }
    }

    if (mapping.cleared !== null) r.cleared = attempt(() => C.parseCleared(cell('cleared'))) ?? 0;

    if (errors.length) r.raw = cells;
    return r;
  }

  /** Public view of a row (no internals). */
  const rowJson = (r) => ({
    n: r.n, status: r.status, action: r.action, errors: r.errors,
    date: r.date, amountMinor: r.amountMinor, payee: r.payee, category: r.category, newCategory: r.newCategory,
    account: r.accountName, newAccount: r.accountId === null, notes: r.notes, cleared: !!r.cleared,
    repeat: r.repeat, duplicateOf: r.duplicateOf, raw: r.raw,
  });

  const analysisJson = (a) => ({
    delimiter: a.delimiter === '\t' ? 'tab' : a.delimiter,
    headers: a.headers, columnCount: a.columnCount, totalRows: a.totalRows, truncated: a.truncated,
    mapping: a.mapping, suggestedMapping: a.suggestedMapping, sample: a.sample,
    needsMapping: a.needsMapping, summary: a.summary, rows: a.rows.map(rowJson),
  });

  /* ---------- the Imported group + missing categories / accounts (same behaviour as the backup importer) ---------- */

  function makeCreators(userId) {
    const catCache = new Map();
    const categoryFor = (name) => {
      const key = name.toLowerCase();
      if (catCache.has(key)) return catCache.get(key);
      let row = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE ORDER BY id LIMIT 1').get(userId, name);
      if (!row) {
        let g = db.prepare("SELECT id FROM category_groups WHERE user_id = ? AND name = 'Imported' COLLATE NOCASE").get(userId);
        if (!g) {
          const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM category_groups WHERE user_id = ?').get(userId).n;
          g = { id: Number(db.prepare("INSERT INTO category_groups (user_id, name, is_income, sort_order) VALUES (?, 'Imported', 0, ?)").run(userId, next).lastInsertRowid) };
        }
        const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories WHERE group_id = ?').get(g.id).n;
        row = { id: Number(db.prepare('INSERT INTO categories (user_id, group_id, name, icon, sort_order) VALUES (?, ?, ?, ?, ?)').run(userId, g.id, name, '📦', order).lastInsertRowid) };
      }
      catCache.set(key, Number(row.id));
      return Number(row.id);
    };
    const acctCache = new Map();
    const accountFor = (name) => {
      const key = name.toLowerCase();
      if (acctCache.has(key)) return acctCache.get(key);
      let row = db.prepare('SELECT id FROM accounts WHERE user_id = ? AND name = ? COLLATE NOCASE').get(userId, name);
      if (!row) {
        const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts WHERE user_id = ?').get(userId).n;
        row = { id: Number(db.prepare("INSERT INTO accounts (user_id, name, type, sort_order) VALUES (?, ?, 'other', ?)").run(userId, name, next).lastInsertRowid) };
      }
      acctCache.set(key, Number(row.id));
      return Number(row.id);
    };
    return { categoryFor, accountFor };
  }

  return {
    'POST /api/import/csv/preview': {
      auth: true, body: true, bodyLimit: MAX_BYTES + 64 * 1024,
      handler: (ctx) => {
        const opt = readOptions(ctx.user.id, ctx.body, { forCommit: false });
        sendJson(ctx.res, 200, analysisJson(analyze(ctx.user.id, opt, ctx.body.csv)));
      },
    },

    'POST /api/import/csv/commit': {
      auth: true, body: true, bodyLimit: MAX_BYTES + 64 * 1024,
      handler: (ctx) => {
        const userId = ctx.user.id;
        const opt = readOptions(userId, ctx.body, { forCommit: true });

        const result = inTransaction(db, () => {
          // Analysed INSIDE the transaction, from the data as it is right now: a second click on "Import" finds everything
          // already there and imports nothing twice.
          const a = analyze(userId, opt, ctx.body.csv);
          if (a.needsMapping) throw v.bad('Tell me which columns hold the Date and the Amount first.');
          const bad = a.rows.filter((r) => r.status === 'error');
          if (bad.length && opt.onErrors === 'abort') {
            throw v.bad(`${bad.length} row${bad.length === 1 ? ' has' : 's have'} errors, so nothing was imported (first: row ${bad[0].n}: ${bad[0].errors[0]}).`);
          }

          const prepared = opt.applyRules ? R.prepare(db, userId) : null;
          const { categoryFor, accountFor } = makeCreators(userId);
          const nextRepeat = new Map(a.importedMax);
          const ins = db.prepare(
            `INSERT INTO transactions (user_id, account_id, date, amount_minor, payee_id, category_id, notes, cleared, imported_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

          const createdCategories = new Set();
          const createdAccounts = new Set();
          const effect = { rowsTouchedByRules: 0, category: 0, payee: 0, notes: 0, cleared: 0 };
          let imported = 0, skippedDuplicates = 0, importedDuplicates = 0, skippedByChoice = 0, clearedImported = 0;

          for (const r of a.rows) {
            if (r.action === 'error') continue;
            if (r.action === 'skip') { if (r.status === 'duplicate') skippedDuplicates++; else skippedByChoice++; continue; }

            const accountId = r.accountId !== null ? r.accountId : accountFor(r.accountName);
            if (r.accountId === null) createdAccounts.add(r.accountName);
            let categoryId = r.categoryId;
            if (r.category && categoryId === null) { categoryId = categoryFor(r.category); createdCategories.add(r.category); }

            let draft = { accountId, amountMinor: r.amountMinor, payee: r.payee, categoryId, notes: r.notes, cleared: r.cleared };
            if (prepared) {
              const run = R.runRules(prepared.rules, draft, prepared.env);
              if (run.applied.length) effect.rowsTouchedByRules++;
              if (run.draft.categoryId !== draft.categoryId) effect.category++;
              if (run.draft.payee !== draft.payee) effect.payee++;
              if (run.draft.notes !== draft.notes) effect.notes++;
              if (run.draft.cleared !== draft.cleared) effect.cleared++;
              draft = run.draft;
            }
            const pid = draft.payee ? findOrCreatePayee(db, userId, draft.payee) : null;
            // The fingerprint of what the FILE said (not what the rules made of it) + the next free repeat number,
            // so "import anyway" of a known duplicate never collides with the original's fingerprint.
            const repeat = (nextRepeat.get(r.fingerprint) || 0) + 1;
            nextRepeat.set(r.fingerprint, repeat);
            ins.run(userId, accountId, r.date, r.amountMinor, pid, draft.categoryId, draft.notes, draft.cleared, `csv:${r.fingerprint}:${repeat}`);
            imported++;
            if (draft.cleared) clearedImported++;
            if (r.status === 'duplicate') importedDuplicates++;
          }

          return {
            totalRows: a.totalRows, imported, skippedDuplicates, importedDuplicates, skippedByChoice,
            errorRows: bad.length, repeatedInFile: a.summary.repeatedInFile, clearedImported,
            newCategories: [...createdCategories], newAccounts: [...createdAccounts],
            rules: prepared ? effect : null, truncated: a.truncated,
            errors: bad.slice(0, MAX_ERROR_ROWS_RETURNED).map((r) => ({ n: r.n, errors: r.errors, raw: r.raw })),
          };
        });
        sendJson(ctx.res, 200, result);
      },
    },
  };
};
