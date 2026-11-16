'use strict';
const { httpError, sendJson } = require('../http');
const { inTransaction } = require('../db');
const v = require('../validate');
const crypto = require('node:crypto');
const { FROM, buildFilter, findOrCreatePayee } = require('../txquery');
const R = require('../rules');
const S = require('../splits');

const MAX_IMPORT_RECORDS = 5000;
const MAX_IMPORT_BYTES = 3 * 1024 * 1024;

/** Spreadsheet apps treat cells starting with these as formulas. Prefix a quote so they stay text. */
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const money = (minor) => (Math.abs(minor) / 100).toFixed(2);

module.exports = ({ db }) => {
  /* ---------- import ---------- */

  // Turn either backup version into one neutral record shape (or null if it is invalid).
  function normalize(r, version) {
    if (!r || typeof r !== 'object') return null;
    try {
      if (version === 2) {
        const payee = String(r.payee ?? '').trim();
        if (payee.length > 60) return null;
        const notes = String(r.notes ?? '').trim().slice(0, 200);
        const amountMinor = v.minor(r.amountMinor);
        // A split transaction in a backup carries its parts. They must add up, or the whole record is invalid.
        let splits = null;
        if (r.splits !== undefined && r.splits !== null) {
          if (!Array.isArray(r.splits) || r.splits.length < S.MIN_SPLITS || r.splits.length > S.MAX_SPLITS) return null;
          splits = r.splits.map((x) => ({
            category: x.category ? String(x.category).trim().slice(0, 40) : '',
            amountMinor: v.minor(x.amountMinor),
            notes: String(x.notes ?? '').trim().slice(0, 200),
          }));
          if (splits.reduce((n, x) => n + x.amountMinor, 0) !== amountMinor) return null;
        }
        return {
          date: v.isoDate(r.date),
          amountMinor,
          payee, notes,
          category: splits ? '' : (r.category ? String(r.category).trim().slice(0, 40) : ''),
          account: r.account ? String(r.account).trim().slice(0, 40) : '',
          cleared: r.cleared === true ? 1 : 0,
          splits,
        };
      }
      // v1: the original localStorage format. Amounts are whole or decimal rupees.
      const title = String(r.title ?? '').trim();
      const amount = Number(r.amount);
      if (!title || title.length > 40) return null;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e10) return null;
      if (r.type !== 'income' && r.type !== 'expense') return null;
      const cat = String(r.cat ?? '').trim();
      if (!cat || cat.length > 40) return null;
      const paise = v.minor(Math.round(amount * 100)); // rejects 0 (e.g. 0.001 rupees) and oversize
      return {
        date: v.isoDate(String(r.date)),
        amountMinor: r.type === 'income' ? paise : -paise,
        payee: title, notes: '', category: cat, account: '', cleared: 0,
      };
    } catch {
      return null;
    }
  }

  const importRoute = {
    auth: true, body: true, bodyLimit: MAX_IMPORT_BYTES,
    handler: (ctx) => {
      const userId = ctx.user.id;
      const data = ctx.body.data;
      let list = null;
      let version = 1;
      if (Array.isArray(data)) list = data;
      else if (data && typeof data === 'object' && Array.isArray(data.transactions)) {
        list = data.transactions;
        if (data.version === 2) version = 2;
      }
      if (!list) throw httpError(400, 'That file is not a SpendWise backup.');

      let defaultAccount = null;
      if (ctx.body.accountId !== undefined && ctx.body.accountId !== null) {
        defaultAccount = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ? AND closed = 0')
          .get(v.intId(ctx.body.accountId, 'accountId'), userId);
        if (!defaultAccount) throw httpError(400, 'Pick an open account to import into.');
      } else {
        defaultAccount = db.prepare('SELECT id FROM accounts WHERE user_id = ? AND closed = 0 ORDER BY sort_order, id LIMIT 1').get(userId);
      }
      if (!defaultAccount) throw httpError(400, 'Create an account first.');

      // Rules run on every NEW row by default; { applyRules: false } imports the file exactly as it is.
      const applyRules = ctx.body.applyRules === undefined ? true : !!v.boolish(ctx.body.applyRules, 'applyRules');

      const truncated = Math.max(0, list.length - MAX_IMPORT_RECORDS);
      const result = inTransaction(db, () => {
        const prepared = applyRules ? R.prepare(db, userId) : null;
        // Rules may rewrite a row, so "have I imported this already?" must not depend on the stored values alone.
        // Each row also gets an id made from what the FILE said (plus which repeat of it this is).
        const seenIds = new Set(db.prepare('SELECT imported_id FROM transactions WHERE user_id = ? AND imported_id IS NOT NULL')
          .all(userId).map((r) => r.imported_id));
        const repeats = new Map();
        // Count what already exists so re-importing the same file adds nothing,
        // while two real identical purchases on one day are still both kept.
        const have = new Map();
        for (const e of db.prepare(
          `SELECT t.date, t.amount_minor, COALESCE(p.name,'') AS payee, COALESCE(c.name,'') AS cat, a.name AS acct ${FROM} WHERE t.user_id = ?`
        ).all(userId)) {
          const k = [e.date, e.amount_minor, e.payee.toLowerCase(), e.cat.toLowerCase(), e.acct.toLowerCase()].join('|');
          have.set(k, (have.get(k) || 0) + 1);
        }

        const acctCache = new Map();
        const catCache = new Map();
        const acctName = new Map(db.prepare('SELECT id, name FROM accounts WHERE user_id = ?').all(userId).map((a) => [a.id, a.name]));
        const accountFor = (name) => {
          if (!name) return Number(defaultAccount.id);
          const key = name.toLowerCase();
          if (acctCache.has(key)) return acctCache.get(key);
          let row = db.prepare('SELECT id, closed FROM accounts WHERE user_id = ? AND name = ? COLLATE NOCASE').get(userId, name);
          if (!row) {
            const next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM accounts WHERE user_id = ?').get(userId).n;
            row = { id: Number(db.prepare("INSERT INTO accounts (user_id, name, type, sort_order) VALUES (?, ?, 'other', ?)").run(userId, name, next).lastInsertRowid), closed: 0 };
          }
          acctName.set(Number(row.id), name);
          acctCache.set(key, Number(row.id));
          return Number(row.id);
        };

        const categoryFor = (name) => {
          if (!name) return null;
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

        const ins = db.prepare(
          `INSERT INTO transactions (user_id, account_id, date, amount_minor, payee_id, category_id, notes, cleared, imported_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        let added = 0, duplicates = 0, invalid = 0, rulesApplied = 0;
        for (const raw of list.slice(0, MAX_IMPORT_RECORDS)) {
          const r = normalize(raw, version);
          if (!r) { invalid++; continue; }
          const accountId = accountFor(r.account);
          const key = [r.date, r.amountMinor, r.payee.toLowerCase(), r.category.toLowerCase(), String(acctName.get(accountId)).toLowerCase()].join('|');
          const nth = (repeats.get(key) || 0) + 1;
          repeats.set(key, nth);
          const importedId = `imp:${crypto.createHash('sha1').update(key).digest('hex')}:${nth}`;
          const left = have.get(key) || 0;
          if (seenIds.has(importedId) || left > 0) { if (left > 0) have.set(key, left - 1); duplicates++; continue; }

          let draft = { accountId, amountMinor: r.amountMinor, payee: r.payee, categoryId: categoryFor(r.category), notes: r.notes, cleared: r.cleared };
          if (prepared) {
            const run = R.runRules(prepared.rules, draft, prepared.env);
            if (run.applied.length) rulesApplied++;
            draft = run.draft;
          }
          const pid = draft.payee ? findOrCreatePayee(db, userId, draft.payee) : null;
          const newId = Number(ins.run(userId, accountId, r.date, r.amountMinor, pid, r.splits ? null : draft.categoryId, draft.notes, draft.cleared, importedId).lastInsertRowid);
          if (r.splits) {
            S.writeSplits(db, userId, newId, r.splits.map((x) => ({ categoryId: categoryFor(x.category), amountMinor: x.amountMinor, notes: x.notes })));
          }
          added++;
        }
        // Same response as before Phase 4 unless rules actually ran, so existing clients and tests see no change.
        return prepared ? { added, duplicates, invalid, rulesApplied } : { added, duplicates, invalid };
      });
      sendJson(ctx.res, 200, { ...result, truncated });
    },
  };

  /* ---------- export ---------- */

  const exportCsv = {
    auth: true,
    handler: (ctx) => {
      const f = buildFilter(ctx.user.id, ctx.query);
      const found = db.prepare(
        `SELECT t.id, t.is_split, t.date, a.name AS account, COALESCE(p.name,'') AS payee, COALESCE(c.name,'') AS category, t.notes, t.amount_minor, t.cleared
           ${FROM} WHERE ${f.where} ORDER BY t.date DESC, t.id DESC`
      ).all(...f.params);
      // A split transaction is written as ONE ROW PER SPLIT (each with its own category and amount), so category totals in a
      // spreadsheet are right and the rows still add up to the transaction. Normal transactions are one row, as before.
      const splitsOf = S.loadSplits(db, ctx.user.id, found.filter((r) => r.is_split).map((r) => Number(r.id)));
      const rows = [];
      for (const r of found) {
        if (!r.is_split) { rows.push(r); continue; }
        for (const sp of splitsOf.get(Number(r.id)) || []) {
          rows.push({ ...r, category: sp.categoryName || '', amount_minor: sp.amountMinor, notes: sp.notes || r.notes });
        }
      }
      const lines = ['Date,Account,Payee,Category,Notes,Type,Amount,Cleared'];
      for (const r of rows) {
        lines.push([
          r.date, csvCell(r.account), csvCell(r.payee), csvCell(r.category), csvCell(r.notes),
          r.amount_minor > 0 ? 'income' : 'expense', money(r.amount_minor), r.cleared ? 'yes' : 'no',
        ].join(','));
      }
      const body = '﻿' + lines.join('\r\n') + '\r\n'; // BOM so Excel reads ₹ names correctly
      ctx.res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="spendwise-transactions.csv"',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      ctx.res.end(body);
    },
  };

  const exportFull = {
    auth: true,
    handler: (ctx) => {
      const userId = ctx.user.id;
      const accounts = db.prepare('SELECT name, type, offbudget, closed, opening_balance_minor FROM accounts WHERE user_id = ? ORDER BY sort_order, id').all(userId)
        .map((a) => ({ name: a.name, type: a.type, offbudget: !!a.offbudget, closed: !!a.closed, openingBalanceMinor: Number(a.opening_balance_minor) }));
      const categories = db.prepare(
        `SELECT g.name AS grp, g.is_income, c.name, c.icon FROM categories c JOIN category_groups g ON g.id = c.group_id
          WHERE c.user_id = ? ORDER BY g.sort_order, c.sort_order`
      ).all(userId).map((c) => ({ group: c.grp, isIncome: !!c.is_income, name: c.name, icon: c.icon }));
      const allTx = db.prepare(
        `SELECT t.id, t.is_split, t.date, t.amount_minor, a.name AS account, COALESCE(p.name,'') AS payee, COALESCE(c.name,'') AS category, t.notes, t.cleared
           ${FROM} WHERE t.user_id = ? ORDER BY t.date, t.id`
      ).all(userId);
      const splitsOf = S.loadSplits(db, userId, allTx.filter((t) => t.is_split).map((t) => Number(t.id)));
      const transactions = allTx.map((t) => {
        const out = {
          date: t.date, amountMinor: Number(t.amount_minor), account: t.account, payee: t.payee,
          category: t.category, notes: t.notes, cleared: !!t.cleared,
        };
        if (t.is_split) out.splits = (splitsOf.get(Number(t.id)) || []).map((x) => ({ category: x.categoryName || '', amountMinor: x.amountMinor, notes: x.notes }));
        return out;
      });
      const body = JSON.stringify({ app: 'SpendWise', version: 2, exportedAt: new Date().toISOString(), accounts, categories, transactions }, null, 2);
      ctx.res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="spendwise-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      ctx.res.end(body);
    },
  };

  return {
    'POST /api/import/spendwise-backup': importRoute,
    'GET /api/export/transactions.csv': exportCsv,
    'GET /api/export/full.json': exportFull,
  };
};
