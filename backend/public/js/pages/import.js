import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, option } from '/js/ui.js';
import { makeMoney } from '/js/money.js';

const { user } = await ready;
if (!user) await new Promise(() => {}); // layout.js is already redirecting to /login

const money = makeMoney(user.locale, user.currency);
const PAGE_ROWS = 300;

// What the person chose. Everything the server needs to repeat the exact same analysis at import time.
let csvText = '';
let fileName = '';
let preview = null;             // last answer from /preview
let mapping = null;
let decisions = {};             // row number -> 'import' | 'skip' (only where the person overrode the default)
let tab = 'all';
let shown = PAGE_ROWS;
let lastErrors = [];            // rows with errors, for the error report
let timer = null;
let seq = 0;

const FIELDS = [
  ['date', 'Date', true], ['amount', 'Amount', true], ['debit', 'Money out (debit)', false], ['credit', 'Money in (credit)', false],
  ['payee', 'Payee / description', false], ['category', 'Category', false], ['account', 'Account', false],
  ['notes', 'Notes', false], ['cleared', 'Cleared', false], ['type', 'Type (income / expense)', false],
];

function options() {
  return {
    csv: csvText,
    accountId: Number($('account').value),
    hasHeader: $('hasHeader').checked,
    dateFormat: $('dateFormat').value,
    amountMode: $('amountMode').value,
    duplicates: $('dupMode').value,
    createAccounts: $('createAccounts').checked,
    applyRules: $('applyRules').checked,
    mapping: mapping || undefined,
    decisions,
  };
}

/* ---------- step 1: the file ---------- */

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $('err1').textContent = '';
  if (f.size > 3 * 1024 * 1024) { $('err1').textContent = 'That file is over 3 MB. Split it into smaller files (a year at a time works well).'; return; }
  try { csvText = await f.text(); } catch { $('err1').textContent = 'Could not read that file.'; return; }
  fileName = f.name;
  mapping = null; decisions = {}; tab = 'all'; shown = PAGE_ROWS;
  await runPreview({ resetMapping: true });
});

for (const id of ['account', 'hasHeader', 'dateFormat', 'amountMode', 'dupMode', 'createAccounts', 'applyRules']) {
  $(id).addEventListener('change', () => {
    if (!csvText) return;
    if (id === 'hasHeader') { mapping = null; decisions = {}; }
    if (id === 'dupMode' || id === 'createAccounts' || id === 'dateFormat' || id === 'amountMode') decisions = {};
    schedule(id === 'hasHeader');
  });
}

function schedule(resetMapping = false) {
  clearTimeout(timer);
  timer = setTimeout(() => runPreview({ resetMapping }), 150);
}

/* ---------- the preview call ---------- */

async function runPreview({ resetMapping = false } = {}) {
  const mine = ++seq;
  $('err1').textContent = '';
  $('err3').textContent = '';
  let data;
  try {
    const body = options();
    if (resetMapping) delete body.mapping;
    data = await api('/api/import/csv/preview', { method: 'POST', body });
  } catch (err) {
    if (mine !== seq) return;
    $('err1').textContent = err.message;
    $('step2').hidden = true; $('step3').hidden = true;
    return;
  }
  if (mine !== seq) return;       // a newer request replaced this one
  preview = data;
  if (!mapping || resetMapping) mapping = { ...data.mapping };
  paintAll();
}

/* ---------- step 2: column mapping ---------- */

function paintMapping() {
  $('fileInfo').textContent = `${fileName}: ${preview.totalRows} data row${preview.totalRows === 1 ? '' : 's'}, ${preview.columnCount} columns, separated by ${preview.delimiter === 'tab' ? 'tabs' : `"${preview.delimiter}"`}.`
    + (preview.truncated ? ` Only the first 5,000 rows are used (${preview.truncated} more are ignored).` : '');
  const grid = $('mapGrid');
  grid.textContent = '';
  for (const [key, label, required] of FIELDS) {
    const sel = el('select', { id: `map-${key}` });
    sel.append(option('', '— not in my file —'));
    preview.headers.forEach((h, i) => {
      const ex = preview.sample[0] && preview.sample[0][i] !== undefined ? String(preview.sample[0][i]).slice(0, 24) : '';
      sel.append(option(i, `${h || `Column ${i + 1}`}${ex ? `  (e.g. ${ex})` : ''}`));
    });
    sel.value = mapping[key] === null || mapping[key] === undefined ? '' : String(mapping[key]);
    sel.onchange = () => {
      mapping[key] = sel.value === '' ? null : Number(sel.value);
      // Amount and Money out/in are alternatives: choosing one clears the other.
      if (key === 'amount' && mapping.amount !== null) { mapping.debit = null; mapping.credit = null; }
      if ((key === 'debit' || key === 'credit') && mapping[key] !== null) mapping.amount = null;
      decisions = {};
      paintMapping();
      schedule();
    };
    const wrap = el('div', { className: 'field' + ((required && (key === 'date' || (key === 'amount' && mapping.debit === null && mapping.credit === null))) ? ' req' : '') },
      el('label', { htmlFor: `map-${key}`, textContent: label }), sel);
    grid.append(wrap);
  }
  const t = $('sample');
  t.textContent = '';
  t.append(el('thead', {}, el('tr', {}, ...preview.headers.map((h, i) => el('th', { textContent: h || `Column ${i + 1}` })))));
  t.append(el('tbody', {}, ...preview.sample.map((r) => el('tr', {}, ...preview.headers.map((_, i) => el('td', { textContent: r[i] ?? '' }))))));
}

/* ---------- step 3: preview table ---------- */

const planned = (r) => r.action === 'import';

function paintChips() {
  const s = preview.summary;
  const chips = $('chips');
  chips.textContent = '';
  const add = (num, text, cls = '') => chips.append(el('span', { className: `sum-chip ${cls}` }, el('b', { textContent: String(num) }), text));
  add(s.totalRows, 'rows in file');
  add(s.newRows, 'new', 'good');
  add(s.duplicateRows, 'possible duplicates');
  add(s.errorRows, 'with errors');
  if (s.newCategories.length) add(s.newCategories.length, `new categor${s.newCategories.length === 1 ? 'y' : 'ies'} (${s.newCategories.slice(0, 4).join(', ')}${s.newCategories.length > 4 ? '…' : ''})`);
  if (s.newAccounts.length) add(s.newAccounts.length, `new account${s.newAccounts.length === 1 ? '' : 's'} (${s.newAccounts.join(', ')})`);
  if (s.repeatedInFile) add(s.repeatedInFile, 'repeat a row above in this file (kept: could be real)');
  const btn = $('doImport');
  btn.textContent = `Import ${s.willImport} transaction${s.willImport === 1 ? '' : 's'}`;
  btn.disabled = s.willImport === 0;
  $('errCsv').hidden = s.errorRows === 0;
}

function paintTabs() {
  const s = preview.summary;
  const defs = [['all', `All (${s.totalRows})`], ['new', `New (${s.newRows})`], ['duplicate', `Duplicates (${s.duplicateRows})`], ['error', `Errors (${s.errorRows})`]];
  const box = $('tabs');
  box.textContent = '';
  for (const [key, label] of defs) {
    const b = el('button', { type: 'button', className: 'small-btn' + (tab === key ? ' active' : ''), textContent: label });
    b.onclick = () => { tab = key; shown = PAGE_ROWS; paintTabs(); paintTable(); };
    box.append(b);
  }
}

function paintTable() {
  const rows = preview.rows.filter((r) => tab === 'all' || r.status === tab);
  const t = $('prev');
  t.textContent = '';
  t.append(el('thead', {}, el('tr', {},
    el('th', { textContent: 'Row' }), el('th', { textContent: 'Import?' }), el('th', { textContent: 'Date' }), el('th', { textContent: 'Payee' }),
    el('th', { textContent: 'Category' }), el('th', { textContent: 'Account' }), el('th', { className: 'num', textContent: 'Amount' }),
    el('th', { textContent: 'Cleared' }), el('th', { textContent: 'Status' }))));
  const body = el('tbody');
  for (const r of rows.slice(0, shown)) body.append(rowNode(r));
  t.append(body);
  $('showMore').hidden = rows.length <= shown;
  if (!rows.length) body.append(el('tr', {}, el('td', { colSpan: 9, className: 'why', textContent: 'Nothing in this tab.' })));
}

function rowNode(r) {
  let statusCell;
  if (r.status === 'error') {
    statusCell = el('td', { className: 'why bad' }, el('b', { textContent: 'Error: ' }), r.errors.join(' '));
  } else if (r.status === 'duplicate') {
    const d = r.duplicateOf;
    const where = d && d.id ? `Matches ${d.payee || '(no payee)'} · ${d.date} · ${money.net(d.amountMinor)} already in ${d.accountName}` : 'Matches something you imported earlier';
    statusCell = el('td', { className: 'why' }, el('span', { className: 'pill dupe', textContent: 'Possible duplicate' }), ' ', where);
  } else {
    statusCell = el('td', { className: 'why' }, el('span', { className: 'pill good', textContent: 'New' }),
      r.repeat ? ' Same as a row above in this file (kept: you may have bought twice).' : '',
      r.newCategory ? ` New category "${r.category}".` : '', r.newAccount ? ` New account "${r.account}".` : '');
  }

  let pick = '';
  if (r.status !== 'error') {
    const cb = el('input', { type: 'checkbox', className: 'tx-check', checked: planned(r), ariaLabel: `Import row ${r.n}` });
    cb.onchange = () => {
      const def = r.status === 'duplicate' ? $('dupMode').value === 'import' : true;
      if (cb.checked === def) delete decisions[r.n]; else decisions[r.n] = cb.checked ? 'import' : 'skip';
      r.action = cb.checked ? 'import' : 'skip';
      tr.classList.toggle('skipped', !cb.checked);
      schedule();      // let the server recount, so the button always shows exactly what will happen
    };
    pick = cb;
  }
  const tr = el('tr', { className: `st-${r.status}` + (r.status !== 'error' && !planned(r) ? ' skipped' : '') },
    el('td', { textContent: String(r.n) }),
    el('td', {}, pick),
    el('td', { textContent: r.date || '—' }),
    el('td', { textContent: r.payee || '' }),
    el('td', { textContent: r.category || '' }),
    el('td', { textContent: r.account || '' }),
    el('td', { className: 'num ' + (r.amountMinor > 0 ? 'inc' : 'exp'), textContent: r.amountMinor === null ? '—' : money.signed(r.amountMinor) }),
    el('td', { textContent: r.cleared ? '✓' : '' }),
    statusCell);
  return tr;
}

$('showMore').onclick = () => { shown += PAGE_ROWS; paintTable(); };

function paintAll() {
  $('step2').hidden = false;
  paintMapping();
  if (preview.needsMapping) {
    $('step3').hidden = true;
    $('err1').textContent = '';
    return;
  }
  $('step3').hidden = false;
  paintChips();
  paintTabs();
  paintTable();
  lastErrors = preview.rows.filter((r) => r.status === 'error').map((r) => ({ n: r.n, errors: r.errors, raw: r.raw }));
}

/* ---------- error report ---------- */

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadErrors(list) {
  const cols = preview ? preview.headers : [];
  const lines = [['Row', 'Problems', ...cols].map(csvCell).join(',')];
  for (const e of list) lines.push([e.n, e.errors.join(' | '), ...(e.raw || [])].map(csvCell).join(','));
  const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' })), download: 'spendwise-import-errors.csv' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('errCsv').onclick = () => downloadErrors(lastErrors);
$('errCsv2').onclick = () => downloadErrors(lastErrors);

/* ---------- import ---------- */

$('doImport').onclick = async () => {
  $('err3').textContent = '';
  const btn = $('doImport');
  btn.disabled = true;
  clearTimeout(timer);
  try {
    const body = { ...options(), onErrors: $('abortOnErr').checked ? 'abort' : 'skip' };
    const r = await api('/api/import/csv/commit', { method: 'POST', body });
    showResult(r);
  } catch (err) {
    $('err3').textContent = err.message;
    btn.disabled = false;
  }
};

function showResult(r) {
  lastErrors = r.errors;
  $('step1').hidden = true; $('step2').hidden = true; $('step3').hidden = true; $('step4').hidden = false;
  const grid = $('resultGrid');
  grid.textContent = '';
  const card = (num, label) => grid.append(el('div', { className: 'rec-card' }, el('small', { textContent: label }), el('h3', { textContent: String(num) })));
  card(r.imported, 'Imported');
  card(r.skippedDuplicates + r.skippedByChoice, 'Skipped');
  card(r.errorRows, 'Rows with errors');
  card(r.clearedImported, 'Imported as cleared');

  const notes = $('resultNotes');
  notes.textContent = '';
  const line = (t) => notes.append(el('p', { className: 'modal-text', textContent: t }));
  if (r.skippedDuplicates) line(`${r.skippedDuplicates} possible duplicate${r.skippedDuplicates === 1 ? ' was' : 's were'} skipped.`);
  if (r.importedDuplicates) line(`${r.importedDuplicates} possible duplicate${r.importedDuplicates === 1 ? ' was' : 's were'} imported anyway, as you chose.`);
  if (r.skippedByChoice) line(`${r.skippedByChoice} row${r.skippedByChoice === 1 ? ' was' : 's were'} left out by your choice.`);
  if (r.newCategories.length) line(`New categories (in the "Imported" group): ${r.newCategories.join(', ')}.`);
  if (r.newAccounts.length) line(`New accounts: ${r.newAccounts.join(', ')}.`);
  if (r.truncated) line(`${r.truncated} rows beyond the 5,000-row limit were not read. Import the rest as a second file.`);
  if (r.rules) {
    line(`Your rules changed ${r.rules.rowsTouchedByRules} row${r.rules.rowsTouchedByRules === 1 ? '' : 's'}: `
      + `${r.rules.category} categor${r.rules.category === 1 ? 'y' : 'ies'} set, ${r.rules.payee} payee${r.rules.payee === 1 ? '' : 's'} set, `
      + `${r.rules.notes} note${r.rules.notes === 1 ? '' : 's'} added, ${r.rules.cleared} marked cleared.`);
  } else line($('applyRules').checked ? 'You have no enabled rules, so nothing was changed by rules.' : 'Rules were not applied to this import.');

  const box = $('resultErrors');
  box.textContent = '';
  $('errCsv2').hidden = r.errors.length === 0;
  if (r.errors.length) {
    box.append(el('h4', { textContent: `Rows that were not imported (${r.errorRows})`, style: 'margin:14px 0 8px' }));
    const t = el('table', { className: 'prev-table' }, el('thead', {}, el('tr', {}, el('th', { textContent: 'Row' }), el('th', { textContent: 'Problem' }), el('th', { textContent: 'Your line' }))));
    const body = el('tbody');
    for (const e of r.errors.slice(0, 200)) {
      body.append(el('tr', { className: 'st-error' }, el('td', { textContent: String(e.n) }), el('td', { className: 'why bad', textContent: e.errors.join(' ') }), el('td', { className: 'why', textContent: (e.raw || []).join(' | ') })));
    }
    t.append(body);
    box.append(el('div', { className: 'prev-wrap' }, t));
    if (r.errors.length > 200) box.append(el('p', { className: 'dz-note', textContent: 'Showing the first 200. The error report has them all.' }));
  }
  $('goRecon').href = `/reconcile?account=${$('account').value}`;
  $('viewTx').href = `/transactions?account=${$('account').value}&month=all`;
  toast(`📥 Imported ${r.imported} transaction${r.imported === 1 ? '' : 's'}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('again').onclick = () => {
  csvText = ''; preview = null; mapping = null; decisions = {}; lastErrors = [];
  $('file').value = '';
  $('step1').hidden = false; $('step2').hidden = true; $('step3').hidden = true; $('step4').hidden = true;
};

/* ---------- start ---------- */

try {
  const { accounts } = await api('/api/accounts');
  for (const a of accounts.filter((x) => !x.closed)) $('account').append(option(a.id, a.name));
  const want = new URLSearchParams(location.search).get('account');
  if (want && [...$('account').options].some((o) => o.value === want)) $('account').value = want;
} catch (err) { toast(err.message); }
