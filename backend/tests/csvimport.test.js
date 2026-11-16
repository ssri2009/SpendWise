'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, newUser, tx, Client } = require('./helpers');
const csv = require('../server/csv');

const PREVIEW = '/api/import/csv/preview';
const COMMIT = '/api/import/csv/commit';

const FILE = [
  'Date,Payee,Category,Account,Notes,Amount,Cleared',
  '2026-11-01,Employer,Salary,,October pay,50000.00,yes',
  '2026-11-02,Swiggy,Food,,dinner,-450.50,no',
  '2026-11-03,Uber,Travel,,,-1200,yes',
].join('\n');

const body = (c, text, over = {}) => ({ csv: text, accountId: c.accountId, ...over });
const count = async (c) => (await c.get('/api/transactions?month=all')).data.total;

/* ---------------------------------------------------------------- the CSV reader (unit) */

test('CSV reader: quotes, doubled quotes, line breaks inside quotes, BOM, CRLF, other delimiters, blank lines', () => {
  assert.deepEqual(csv.parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"two\nlines",3\r\n').rows,
    [['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', '3']]);
  assert.equal(csv.parseCsv('a;b;c\n1;2;3').delimiter, ';');
  assert.equal(csv.parseCsv('a\tb\n1\t2').delimiter, '\t');
  assert.equal(csv.parseCsv('a|b\n1|2').delimiter, '|');
  assert.equal(csv.parseCsv('"a,b",c\n1,2').delimiter, ',', 'commas inside quotes do not count');
  assert.throws(() => csv.parseCsv('a,b\n"never closed,2'), /never closed/);
  assert.throws(() => csv.parseCsv(Array.from({ length: 70 }, (_, i) => i).join(',')), /Too many columns/);
});

test('CSV reader: amounts are exact paise, strict about decimals and thousands', () => {
  const ok = { '1234.5': 123450, '₹1,234.50': 123450, 'Rs. 99': 9900, '(450.00)': -45000, '-450': -45000, '450-': -45000, '−450': -45000,
    '1,23,456.5': 12345650, '0.05': 5, '+7': 700 };
  for (const [text, minor] of Object.entries(ok)) assert.equal(csv.parseAmount(text), minor, text);
  for (const bad of ['', 'abc', '0', '0.00', '1.234', '12,50', '1,2345', '1e5', '12.5.1', '99999999999.00']) {
    assert.throws(() => csv.parseAmount(bad), Error, `"${bad}" should be refused`);
  }
});

test('CSV reader: dates', () => {
  assert.equal(csv.parseDate('2026-11-05'), '2026-11-05');
  assert.equal(csv.parseDate('05/11/2026'), '2026-11-05', 'day first by default');
  assert.equal(csv.parseDate('11/13/2026'), '2026-11-13', 'auto notices a month-first date when the day cannot be second');
  assert.equal(csv.parseDate('05/11/2026', 'MDY'), '2026-05-11');
  assert.equal(csv.parseDate('5 Nov 2026'), '2026-11-05');
  assert.equal(csv.parseDate('Nov 5, 2026'), '2026-11-05');
  assert.equal(csv.parseDate('2026-11-05T10:30:00Z'), '2026-11-05');
  for (const bad of ['', 'x', '31/02/2026', '2026-13-01', '5/5/26']) assert.throws(() => csv.parseDate(bad), Error, bad);
});

/* ---------------------------------------------------------------- preview */

test('preview: detects columns, suggests the mapping, parses every row, and writes nothing', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-preview@example.com');
    const r = await c.post(PREVIEW, body(c, FILE));
    assert.equal(r.status, 200);
    const d = r.data;
    assert.equal(d.delimiter, ',');
    assert.deepEqual(d.headers, ['Date', 'Payee', 'Category', 'Account', 'Notes', 'Amount', 'Cleared']);
    assert.deepEqual(d.suggestedMapping, { date: 0, payee: 1, category: 2, account: 3, notes: 4, amount: 5, debit: null, credit: null, cleared: 6, type: null });
    assert.equal(d.needsMapping, false);
    assert.equal(d.totalRows, 3);
    assert.deepEqual(d.rows.map((x) => [x.n, x.date, x.amountMinor, x.payee, x.category, x.cleared, x.status]), [
      [1, '2026-11-01', 5000000, 'Employer', 'Salary', true, 'new'],
      [2, '2026-11-02', -45050, 'Swiggy', 'Food', false, 'new'],
      [3, '2026-11-03', -120000, 'Uber', 'Travel', true, 'new'],
    ]);
    assert.deepEqual(d.summary, {
      totalRows: 3, newRows: 3, duplicateRows: 0, errorRows: 0, repeatedInFile: 0, willImport: 3, willSkip: 0,
      newCategories: [], newAccounts: [], clearedRows: 2,
    });
    assert.equal(await count(c), 0, 'a preview never writes');
    assert.equal(s.server.db.prepare('SELECT COUNT(*) AS n FROM payees').get().n, 0, 'nor creates payees');
  } finally { await s.close(); }
});

test('column mapping: a file with other headers, ";" delimiter, no header row, debit/credit columns and inverted signs', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-mapping@example.com');

    // unknown headers: the importer asks for a mapping instead of guessing
    const odd = 'Booked;Who;Out;In\n05/11/2026;Cafe;120,00;\n06/11/2026;Employer;;5000.00';
    let r = (await c.post(PREVIEW, body(c, odd))).data;
    assert.equal(r.delimiter, ';');
    assert.equal(r.needsMapping, true);
    assert.deepEqual(r.rows, []);

    // the person maps them: Out = debit, In = credit. "120,00" is refused (decimal comma), so fix the file to 120.00
    const fixed = 'Booked;Who;Out;In\n05/11/2026;Cafe;120.00;\n06/11/2026;Employer;;5000.00\n07/11/2026;Oops;1.00;2.00';
    r = (await c.post(PREVIEW, body(c, fixed, { mapping: { date: 0, payee: 1, debit: 2, credit: 3 } }))).data;
    assert.deepEqual(r.rows.map((x) => [x.date, x.amountMinor, x.status]), [['2026-11-05', -12000, 'new'], ['2026-11-06', 500000, 'new'], ['2026-11-07', null, 'error']]);
    assert.match(r.rows[2].errors.join(' '), /Both Debit and Credit/);

    // no header row
    r = (await c.post(PREVIEW, body(c, '2026-11-05,Cafe,-120\n2026-11-06,Bus,-20', { hasHeader: false, mapping: { date: 0, payee: 1, amount: 2 } }))).data;
    assert.equal(r.totalRows, 2);
    assert.deepEqual(r.headers, ['Column 1', 'Column 2', 'Column 3']);

    // credit-card style: spending is positive
    r = (await c.post(PREVIEW, body(c, 'Date,Desc,Amt\n2026-11-05,Shop,100\n2026-11-06,Refund,-30', { mapping: { date: 0, payee: 1, amount: 2 }, amountMode: 'inverted' }))).data;
    assert.deepEqual(r.rows.map((x) => x.amountMinor), [-10000, 3000]);

    // month-first dates
    r = (await c.post(PREVIEW, body(c, 'Date,Desc,Amt\n03/04/2026,Shop,-1', { dateFormat: 'MDY' }))).data;
    assert.equal(r.rows[0].date, '2026-03-04');
    r = (await c.post(PREVIEW, body(c, 'Date,Desc,Amt\n03/04/2026,Shop,-1', { dateFormat: 'DMY' }))).data;
    assert.equal(r.rows[0].date, '2026-04-03');

    // a mapping that points outside the file is refused
    assert.equal((await c.post(PREVIEW, body(c, FILE, { mapping: { date: 0, amount: 99 } }))).status, 400);
    assert.equal((await c.post(PREVIEW, body(c, FILE, { mapping: { date: -1, amount: 5 } }))).status, 400);
    assert.equal((await c.post(PREVIEW, body(c, FILE, { dateFormat: 'XYZ' }))).status, 400);
    assert.equal((await c.post(PREVIEW, body(c, FILE, { amountMode: 'x' }))).status, 400);
  } finally { await s.close(); }
});

test('column mapping with the Type column: the file\'s own export (Type + positive Amount) imports with the right signs', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-type@example.com');
    await tx(c, { amountMinor: -45000, payee: '=HYPERLINK("x")', categoryId: c.cat.Food, date: '2026-11-05', notes: '+note' });
    await tx(c, { amountMinor: 900000, payee: 'Employer', categoryId: c.cat.Salary, date: '2026-11-06' });
    const exported = await (await c.req('/api/export/transactions.csv')).text();

    const other = await newUser(s.base, 'csv-type-b@example.com');
    const prev = (await other.post(PREVIEW, body(other, exported))).data;
    assert.equal(prev.suggestedMapping.type, 5);
    assert.deepEqual(prev.rows.map((x) => [x.payee, x.amountMinor, x.notes]).sort(), [['=HYPERLINK("x")', -45000, '+note'], ['Employer', 900000, '']].sort(),
      'the protective quote our export adds is removed again');
    const done = (await other.post(COMMIT, body(other, exported))).data;
    assert.equal(done.imported, 2);
    const names = (await other.get('/api/transactions?month=all')).data.transactions.map((t) => [t.payee, t.amountMinor]).sort();
    assert.deepEqual(names, [['=HYPERLINK("x")', -45000], ['Employer', 900000]].sort());
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- validation and error reporting */

const BAD = [
  'Date,Payee,Category,Account,Notes,Amount,Cleared',
  '2026-11-01,Good one,Food,,,-100,no',
  '31/02/2026,Bad date,Food,,,-100,no',
  '2026-11-02,Bad amount,Food,,,abc,no',
  '2026-11-02,Zero,Food,,,0,no',
  `2026-11-02,${'x'.repeat(61)},Food,,,-5,no`,
  '2026-11-02,Ghost account,Food,Nowhere,,-5,no',
  '2026-11-02,Maybe cleared,Food,,,-5,maybe',
  '2026-11-02,Everything wrong,Food,,,x,maybe',
  '2026-11-04,Another good one,Food,,,-200,no',
].join('\n');

test('validation: every problem is listed per row, in plain words, and good rows are still imported', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-errors@example.com');
    const prev = (await c.post(PREVIEW, body(c, BAD))).data;
    assert.equal(prev.summary.errorRows, 7);
    assert.equal(prev.summary.newRows, 2);
    const err = Object.fromEntries(prev.rows.filter((r) => r.status === 'error').map((r) => [r.n, r.errors.join(' | ')]));
    assert.match(err[2], /not a real date/);
    assert.match(err[3], /not an amount/);
    assert.match(err[4], /zero/i);
    assert.match(err[5], /longer than 60/);
    assert.match(err[6], /Account "Nowhere" does not exist/);
    assert.match(err[7], /Cleared must be yes or no/);
    assert.match(err[8], /not an amount.*Cleared must be yes or no/, 'all problems of a row at once');
    assert.ok(prev.rows.find((r) => r.n === 2).raw, 'the original line is returned so an error report can be made');

    // default: skip the bad rows
    const done = (await c.post(COMMIT, body(c, BAD))).data;
    assert.equal(done.imported, 2);
    assert.equal(done.errorRows, 7);
    assert.deepEqual(done.errors.map((e) => e.n), [2, 3, 4, 5, 6, 7, 8]);
    assert.ok(done.errors[0].raw.includes('Bad date'));
    assert.equal(await count(c), 2);
  } finally { await s.close(); }
});

test('validation: onErrors "abort" imports nothing at all when any row is bad', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-abort@example.com');
    const r = await c.post(COMMIT, body(c, BAD, { onErrors: 'abort' }));
    assert.equal(r.status, 400);
    assert.match(r.data.error, /nothing was imported/);
    assert.equal(await count(c), 0);
    assert.equal(s.server.db.prepare('SELECT COUNT(*) AS n FROM payees').get().n, 0);
    assert.equal((await c.post(COMMIT, body(c, FILE, { onErrors: 'whatever' }))).status, 400);
  } finally { await s.close(); }
});

test('validation: bad requests are refused cleanly', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-bad@example.com');
    assert.equal((await c.post(PREVIEW, { accountId: c.accountId })).status, 400);                     // no file
    assert.equal((await c.post(PREVIEW, body(c, '   \n  '))).status, 400);                             // blank
    assert.equal((await c.post(PREVIEW, { csv: FILE })).status, 400);                                  // no account
    assert.equal((await c.post(PREVIEW, body(c, FILE, { accountId: 0 }))).status, 400);
    assert.equal((await c.post(PREVIEW, body(c, 'a,b\n"open,1'))).status, 400);                        // unterminated quote
    assert.equal((await c.post(COMMIT, body(c, 'Foo,Bar\n1,2'))).status, 400, 'import needs Date and Amount columns');
    assert.equal((await c.post(PREVIEW, body(c, FILE, { duplicates: 'maybe' }))).status, 400);
    assert.equal((await c.post(PREVIEW, body(c, FILE, { decisions: { x: 'import' } }))).status, 400);
    assert.equal((await c.post(PREVIEW, body(c, FILE, { decisions: { 1: 'sure' } }))).status, 400);
    assert.equal((await c.post(PREVIEW, body(c, 'x'.repeat(3 * 1024 * 1024 + 10)))).status, 400);

    // a closed account cannot be imported into
    const closed = (await c.post('/api/accounts', { name: 'Old', type: 'savings' })).data.account;
    await c.patch(`/api/accounts/${closed.id}`, { closed: true });
    assert.equal((await c.post(PREVIEW, body(c, FILE, { accountId: closed.id }))).status, 400);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- import + summary */

test('import: creates the transactions, payees and the new category; cleared column is honoured; summary says what happened', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-import@example.com');
    const text = FILE + '\n2026-11-04,Gym,Fitness,,monthly,-999.99,no';
    const done = (await c.post(COMMIT, body(c, text))).data;
    assert.deepEqual([done.totalRows, done.imported, done.skippedDuplicates, done.errorRows, done.clearedImported], [4, 4, 0, 0, 2]);
    assert.deepEqual(done.newCategories, ['Fitness']);
    assert.deepEqual(done.newAccounts, []);
    assert.equal(done.rules, null, 'no rules exist, so none ran');

    const list = (await c.get('/api/transactions?month=all')).data.transactions;
    const by = Object.fromEntries(list.map((t) => [t.payee, t]));
    assert.equal(by.Employer.amountMinor, 5000000);
    assert.equal(by.Employer.cleared, true);
    assert.equal(by.Employer.notes, 'October pay');
    assert.equal(by.Employer.categoryName, 'Salary');
    assert.equal(by.Swiggy.cleared, false);
    assert.equal(by.Swiggy.amountMinor, -45050);
    assert.equal(by.Gym.categoryName, 'Fitness');
    const groups = (await c.get('/api/categories')).data.groups;
    assert.ok(groups.find((g) => g.name === 'Imported').categories.some((x) => x.name === 'Fitness'));
    assert.equal(by.Gym.accountName, 'Cash');
    assert.equal((await c.get('/api/payees?status=all')).data.payees.length, 4);
    // the money is exact
    assert.equal((await c.get('/api/accounts')).data.totalFundsMinor, 5000000 - 45050 - 120000 - 99999);
  } finally { await s.close(); }
});

test('import: an Account column picks another of YOUR accounts; unknown ones need "create accounts"', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-accounts@example.com');
    const sav = (await c.post('/api/accounts', { name: 'HDFC Savings', type: 'savings' })).data.account;
    const text = 'Date,Payee,Amount,Account\n2026-11-01,Interest,100,hdfc savings\n2026-11-02,Cafe,-50,Wallet\n2026-11-03,Plain,-5,';
    let prev = (await c.post(PREVIEW, body(c, text))).data;
    assert.equal(prev.rows[0].account, 'HDFC Savings');
    assert.equal(prev.rows[1].status, 'error');
    assert.match(prev.rows[1].errors[0], /does not exist/);

    prev = (await c.post(PREVIEW, body(c, text, { createAccounts: true }))).data;
    assert.equal(prev.rows[1].status, 'new');
    assert.equal(prev.rows[1].newAccount, true);
    assert.deepEqual(prev.summary.newAccounts, ['Wallet']);
    assert.equal((await c.get('/api/accounts')).data.accounts.length, 2, 'preview created nothing');

    const done = (await c.post(COMMIT, body(c, text, { createAccounts: true }))).data;
    assert.equal(done.imported, 3);
    assert.deepEqual(done.newAccounts, ['Wallet']);
    const accts = Object.fromEntries((await c.get('/api/accounts')).data.accounts.map((a) => [a.name, a.balanceMinor]));
    assert.deepEqual(accts, { Cash: -500, 'HDFC Savings': 10000, Wallet: -5000 });
    assert.ok(sav.id);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- duplicates */

test('duplicates: same date + amount + payee as something you already have (any capitals) is flagged, with what it matches', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-dupes@example.com');
    const mine = (await tx(c, { date: '2026-11-02', amountMinor: -45050, payee: 'SWIGGY', categoryId: c.cat.Food })).data.transaction;
    await tx(c, { date: '2026-11-03', amountMinor: -120001, payee: 'Uber' });          // other amount: not a duplicate of the file's Uber
    await tx(c, { date: '2026-11-04', amountMinor: -120000, payee: 'Uber' });          // other date: not a duplicate either

    const prev = (await c.post(PREVIEW, body(c, FILE))).data;
    assert.deepEqual(prev.rows.map((r) => r.status), ['new', 'duplicate', 'new']);
    assert.equal(prev.rows[1].duplicateOf.id, mine.id);
    assert.equal(prev.rows[1].duplicateOf.payee, 'SWIGGY');
    assert.equal(prev.rows[1].duplicateOf.amountMinor, -45050);
    assert.equal(prev.rows[1].action, 'skip', 'skipped by default');
    assert.equal(prev.summary.duplicateRows, 1);
    assert.equal(prev.summary.willImport, 2);
    assert.equal(prev.summary.willSkip, 1);
  } finally { await s.close(); }
});

test('duplicates: skip (default), import anyway, and decide row by row; the preview always matches the import', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-dupe-actions@example.com');
    await tx(c, { date: '2026-11-02', amountMinor: -45050, payee: 'Swiggy' });
    const before = await count(c);

    // skip
    let done = (await c.post(COMMIT, body(c, FILE))).data;
    assert.deepEqual([done.imported, done.skippedDuplicates, done.importedDuplicates], [2, 1, 0]);
    assert.equal(await count(c), before + 2);

    // everything is now a duplicate; "import anyway" for all of it
    done = (await c.post(COMMIT, body(c, FILE, { duplicates: 'import' }))).data;
    assert.deepEqual([done.imported, done.importedDuplicates, done.skippedDuplicates], [3, 3, 0]);
    assert.equal(await count(c), before + 2 + 3);

    // row by row: import only row 2 anyway; the preview shows the same plan the import then follows
    const plan = (await c.post(PREVIEW, body(c, FILE, { decisions: { 2: 'import' } }))).data;
    assert.deepEqual(plan.rows.map((r) => r.action), ['skip', 'import', 'skip']);
    assert.equal(plan.summary.willImport, 1);
    done = (await c.post(COMMIT, body(c, FILE, { decisions: { 2: 'import' } }))).data;
    assert.deepEqual([done.imported, done.skippedDuplicates], [1, 2]);
    assert.equal(await count(c), before + 2 + 3 + 1);

    // a new row can also be left out by choice
    const fresh = '2026-12-01,Fresh,-10\n2026-12-02,Other,-20';
    done = (await c.post(COMMIT, body(c, 'Date,Payee,Amount\n' + fresh, { decisions: { 1: 'skip' } }))).data;
    assert.deepEqual([done.imported, done.skippedByChoice], [1, 1]);
  } finally { await s.close(); }
});

test('duplicates: re-importing the same file is safe, even when rules rewrote the stored rows', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-reimport@example.com');
    await c.post('/api/rules', {
      name: 'Rename', matchMode: 'all', conditions: [{ type: 'description_contains', value: 'swiggy' }],
      actions: [{ type: 'add_note', text: '[swiggy]' }],
    });
    const swiggy = (await c.post('/api/payees', { name: 'Swiggy Instamart' })).data.payee;
    await c.post('/api/rules', {
      name: 'Pretty payee', matchMode: 'all', conditions: [{ type: 'description_contains', value: 'swiggy' }],
      actions: [{ type: 'set_payee', payeeId: swiggy.id }],
    });
    const text = 'Date,Payee,Amount\n2026-11-02,SWIGGY*ORDER 88,-450.50\n2026-11-03,Metro,-30';
    assert.equal((await c.post(COMMIT, body(c, text))).data.imported, 2);
    assert.equal((await c.get('/api/transactions?month=all')).data.transactions.find((t) => t.notes === '[swiggy]').payee, 'Swiggy Instamart');

    const again = (await c.post(PREVIEW, body(c, text))).data;
    assert.deepEqual(again.rows.map((r) => r.status), ['duplicate', 'duplicate']);
    const done = (await c.post(COMMIT, body(c, text))).data;
    assert.deepEqual([done.imported, done.skippedDuplicates], [0, 2]);
    // "import anyway" works and does not trip over the unique fingerprint
    const forced = (await c.post(COMMIT, body(c, text, { duplicates: 'import' }))).data;
    assert.equal(forced.imported, 2);
    const forcedAgain = (await c.post(COMMIT, body(c, text, { duplicates: 'import' }))).data;
    assert.equal(forcedAgain.imported, 2, 'and again');
  } finally { await s.close(); }
});

test('duplicates: repeats are counted, so two real identical purchases are not lost; other accounts and other users do not count', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-repeat@example.com');
    const twice = 'Date,Payee,Amount\n2026-11-05,Chai,-20\n2026-11-05,Chai,-20';

    const prev = (await c.post(PREVIEW, body(c, twice))).data;
    assert.deepEqual(prev.rows.map((r) => r.status), ['new', 'new']);
    assert.equal(prev.summary.repeatedInFile, 1, 'the second is flagged as a repeat but not skipped');
    assert.equal((await c.post(COMMIT, body(c, twice))).data.imported, 2);

    // you already have one of them: one is a duplicate, one is new
    const c2 = await newUser(s.base, 'csv-repeat2@example.com');
    await tx(c2, { date: '2026-11-05', amountMinor: -2000, payee: 'chai' });
    assert.deepEqual((await c2.post(PREVIEW, body(c2, twice))).data.rows.map((r) => r.status), ['duplicate', 'new']);

    // the same purchase in a DIFFERENT account is not a duplicate
    const sav = (await c2.post('/api/accounts', { name: 'Card', type: 'credit' })).data.account;
    assert.deepEqual((await c2.post(PREVIEW, body(c2, twice, { accountId: sav.id }))).data.rows.map((r) => r.status), ['new', 'new']);

    // another user's identical transactions are invisible to duplicate detection
    const c3 = await newUser(s.base, 'csv-repeat3@example.com');
    assert.deepEqual((await c3.post(PREVIEW, body(c3, twice))).data.rows.map((r) => r.status), ['new', 'new']);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- rules on import */

test('rules on import: category, payee, notes and cleared status are applied; counts are reported', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-rules@example.com');
    const swiggy = (await c.post('/api/payees', { name: 'Swiggy' })).data.payee;
    const r1 = await c.post('/api/rules', {
      name: 'Swiggy is food', matchMode: 'all',
      conditions: [{ type: 'description_contains', value: 'swiggy' }],
      actions: [{ type: 'set_category', categoryId: c.cat.Food }, { type: 'set_payee', payeeId: swiggy.id }, { type: 'add_note', text: 'auto: food' }, { type: 'mark_cleared' }],
    });
    assert.equal(r1.status, 201);
    await c.post('/api/rules', {
      name: 'Big spend', matchMode: 'all', conditions: [{ type: 'amount_gt', valueMinor: 100000, direction: 'expense' }],
      actions: [{ type: 'add_note', text: 'big' }],
    });

    const text = [
      'Date,Payee,Category,Notes,Amount,Cleared',
      '2026-11-02,SWIGGY*ORDER 88,,lunch,-450.50,no',     // rules: category, payee, note, cleared
      '2026-11-03,Landlord,,,-15000,no',                  // rules: "big" note only
      '2026-11-04,Uber,Travel,,-120,no',                  // no rule matches: stays as in the file
    ].join('\n');
    const done = (await c.post(COMMIT, body(c, text))).data;
    assert.equal(done.imported, 3);
    assert.deepEqual(done.rules, { rowsTouchedByRules: 2, category: 1, payee: 1, notes: 2, cleared: 1 });

    const by = Object.fromEntries((await c.get('/api/transactions?month=all')).data.transactions.map((t) => [t.payee, t]));
    assert.equal(by.Swiggy.categoryName, 'Food', 'category assigned');
    assert.equal(by.Swiggy.notes, 'lunch auto: food', 'notes added to what the file said');
    assert.equal(by.Swiggy.cleared, true, 'cleared status applied');
    assert.equal(by.Swiggy.amountMinor, -45050);
    assert.equal(by['SWIGGY*ORDER 88'], undefined, 'payee assigned, and no throw-away payee left behind');
    assert.equal((await c.get('/api/payees?status=all')).data.payees.some((p) => p.name === 'SWIGGY*ORDER 88'), false);
    assert.equal(by.Landlord.notes, 'big');
    assert.equal(by.Landlord.cleared, false);
    assert.equal(by.Uber.categoryName, 'Travel');
    assert.equal(by.Uber.notes, '');
  } finally { await s.close(); }
});

test('rules on import: "applyRules: false" imports the file exactly as it is; disabled rules do not run', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-rules-off@example.com');
    const rule = (await c.post('/api/rules', {
      name: 'Everything', matchMode: 'all', conditions: [{ type: 'description_contains', value: 'a' }],
      actions: [{ type: 'set_category', categoryId: c.cat.Food }, { type: 'mark_cleared' }, { type: 'add_note', text: 'ruled' }],
    })).data.rule;
    const text = 'Date,Payee,Amount\n2026-11-02,Cafe,-100';

    let done = (await c.post(COMMIT, body(c, text, { applyRules: false }))).data;
    assert.equal(done.rules, null);
    let t = (await c.get('/api/transactions?month=all')).data.transactions[0];
    assert.deepEqual([t.categoryName, t.cleared, t.notes], [null, false, '']);

    await c.patch(`/api/rules/${rule.id}`, { enabled: false });
    done = (await c.post(COMMIT, body(c, text.replace('Cafe', 'Cafe2').replace('-100', '-101')))).data;
    t = (await c.get('/api/transactions?month=all')).data.transactions.find((x) => x.payee === 'Cafe2');
    assert.deepEqual([t.categoryName, t.cleared, t.notes], [null, false, '']);
  } finally { await s.close(); }
});

test('rules on import: a rule can build on the CSV category; the CSV cleared flag survives when no rule touches it', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-rules2@example.com');
    await c.post('/api/rules', {
      name: 'Travel note', matchMode: 'all', conditions: [{ type: 'description_contains', value: 'uber' }],
      actions: [{ type: 'add_note', text: 'ride' }],
    });
    const done = (await c.post(COMMIT, body(c, 'Date,Payee,Amount,Cleared\n2026-11-02,Uber,-100,yes'))).data;
    assert.equal(done.rules.rowsTouchedByRules, 1);
    assert.equal(done.rules.cleared, 0, 'a rule did not change cleared; the file did');
    const t = (await c.get('/api/transactions?month=all')).data.transactions[0];
    assert.deepEqual([t.cleared, t.notes], [true, 'ride']);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- reconcile after import */

test('imported cleared transactions feed straight into reconciliation', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-recon@example.com');
    await c.post(COMMIT, body(c, FILE));
    const r = (await c.get(`/api/accounts/${c.accountId}/reconciliation`)).data;
    assert.equal(r.clearedBalanceMinor, 5000000 - 120000);       // Employer + Uber are cleared; Swiggy is not
    assert.equal(r.unclearedBalanceMinor, -45050);
    const ok = await c.post(`/api/accounts/${c.accountId}/reconcile`, { statementBalanceMinor: 5000000 - 120000, statementDate: '2026-11-05' });
    assert.equal(ok.status, 201);
    assert.equal(ok.data.reconciliation.transactionCount, 2);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- multi-user security */

test('security: you can only import into your own accounts, and an Account column cannot reach someone else\'s', async () => {
  const s = await start();
  try {
    const a = await newUser(s.base, 'csv-sec-a@example.com');
    const b = await newUser(s.base, 'csv-sec-b@example.com');
    await a.post('/api/accounts', { name: 'Secret Savings', type: 'savings' });
    await tx(a, { date: '2026-11-02', amountMinor: -45050, payee: 'Swiggy' });

    // B names A's account id
    assert.equal((await b.post(PREVIEW, body(b, FILE, { accountId: a.accountId }))).status, 400);
    assert.equal((await b.post(COMMIT, body(b, FILE, { accountId: a.accountId }))).status, 400);
    assert.equal((await a.get('/api/transactions?month=all')).data.total, 1, 'nothing landed in A\'s account');

    // B names A's account by NAME in the file: for B it does not exist
    const text = 'Date,Payee,Amount,Account\n2026-11-02,Sneaky,-1,Secret Savings';
    const prev = (await b.post(PREVIEW, body(b, text))).data;
    assert.equal(prev.rows[0].status, 'error');
    assert.match(prev.rows[0].errors[0], /does not exist/);
    // with "create accounts", B just gets their OWN new account of that name
    const done = (await b.post(COMMIT, body(b, text, { createAccounts: true }))).data;
    assert.equal(done.imported, 1);
    assert.equal((await a.get('/api/transactions?month=all')).data.total, 1);
    const bAccts = (await b.get('/api/accounts')).data.accounts.find((x) => x.name === 'Secret Savings');
    const aAccts = (await a.get('/api/accounts')).data.accounts.find((x) => x.name === 'Secret Savings');
    assert.notEqual(bAccts.id, aAccts.id);
    assert.equal(aAccts.transactionCount, 0);

    // A's swiggy transaction is not visible to B's duplicate detection or its rules
    assert.deepEqual((await b.post(PREVIEW, body(b, FILE))).data.rows.map((r) => r.status), ['new', 'new', 'new']);
    await a.post('/api/rules', { name: 'A rule', matchMode: 'all', conditions: [{ type: 'description_contains', value: 'swiggy' }], actions: [{ type: 'add_note', text: 'A-only' }] });
    await b.post(COMMIT, body(b, FILE));
    assert.equal((await b.get('/api/transactions?month=all')).data.transactions.some((t) => t.notes.includes('A-only')), false);
    // and B's categories were created for B only
    const aGroups = (await a.get('/api/categories')).data.groups.map((g) => g.name);
    assert.equal(aGroups.includes('Imported'), false);
  } finally { await s.close(); }
});

test('security: the import routes need a login and a CSRF token', async () => {
  const s = await start();
  try {
    const anon = new Client(s.base);
    await anon.json('/api/auth/csrf');
    assert.equal((await anon.post(PREVIEW, { csv: FILE, accountId: 1 })).status, 401);
    assert.equal((await anon.post(COMMIT, { csv: FILE, accountId: 1 })).status, 401);

    const c = await newUser(s.base, 'csv-csrf@example.com');
    const noToken = await c.json(COMMIT, { method: 'POST', body: body(c, FILE), csrf: false });
    assert.equal(noToken.status, 403);
    assert.equal(await count(c), 0);
  } finally { await s.close(); }
});

/* ---------------------------------------------------------------- big file */

test('a 5,000-row file previews and imports; rows beyond the limit are reported, not silently dropped', async () => {
  const s = await start();
  try {
    const c = await newUser(s.base, 'csv-big@example.com');
    const rows = ['Date,Payee,Amount'];
    for (let i = 0; i < 5100; i++) rows.push(`2026-11-${String((i % 28) + 1).padStart(2, '0')},Shop ${i},-${(i % 90) + 1}`);
    const text = rows.join('\n');
    const prev = (await c.post(PREVIEW, body(c, text))).data;
    assert.equal(prev.totalRows, 5000);
    assert.equal(prev.truncated, 100);
    const done = (await c.post(COMMIT, body(c, text))).data;
    assert.equal(done.imported, 5000);
    assert.equal(done.truncated, 100);
    assert.equal(await count(c), 5000);
  } finally { await s.close(); }
});
