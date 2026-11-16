'use strict';
// Scheduled and recurring transactions: the rows, and the engine that turns a due date into a transaction.
//
// HOW EXECUTION WORKS (also in the README):
//   * A schedule has a cursor: occ_index / next_date = the next occurrence that has not been handled yet.
//   * runDue() handles every occurrence whose date is today or earlier (catching up after the server was off):
//       mode "auto"      -> a real transaction is created through the SAME rules engine as a manually added one
//       mode "approval"  -> a PENDING occurrence is queued; nothing touches your balance until you approve it
//     then the cursor moves on. Paused schedules are skipped entirely.
//   * DUPLICATES: schedule_occurrences has a UNIQUE (schedule_id, due_date). Handling a date inserts that row first
//     (ON CONFLICT DO NOTHING); if the row already existed nothing is created. Each schedule is processed in ONE database
//     transaction, so a crash can never leave "transaction created but cursor not moved".
//   * Generated transactions: rules run (conditions can match payee/notes/amount/account), the payee is matched
//     case-insensitively to your existing payees, and if no category is set by the schedule or a rule, the payee's
//     default category is used. Exactly like adding the transaction by hand, plus that last step.

const { httpError } = require('./http');
const v = require('./validate');
const { inTransaction } = require('./db');
const R = require('./rules');
const { findOrCreatePayee } = require('./txquery');
const RC = require('./recurrence');

const MAX_SCHEDULES = 500;
const MAX_CATCHUP = 366;              // occurrences handled per schedule per run; a longer backlog continues on the next run
const MODES = ['auto', 'approval'];
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const SELECT = `SELECT s.*, p.name AS payee_name, c.name AS category_name, c.icon AS category_icon,
    a.name AS account_name, a.closed AS account_closed, a.offbudget AS account_offbudget,
    (SELECT COUNT(*) FROM schedule_occurrences o WHERE o.schedule_id = s.id AND o.user_id = s.user_id AND o.status = 'pending') AS pending_count
  FROM schedules s
  JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id
  LEFT JOIN payees p ON p.id = s.payee_id AND p.user_id = s.user_id
  LEFT JOIN categories c ON c.id = s.category_id AND c.user_id = s.user_id`;

const ruleOf = (r) => ({ frequency: r.frequency, n: Number(r.interval_n), unit: r.interval_unit });
const statusOf = (r) => (r.paused ? 'paused' : r.next_date === null ? 'finished' : 'active');

function toJson(r) {
  const rule = ruleOf(r);
  return {
    id: Number(r.id),
    name: r.name,
    accountId: Number(r.account_id),
    accountName: r.account_name,
    accountClosed: !!r.account_closed,
    payeeId: r.payee_id === null ? null : Number(r.payee_id),
    payee: r.payee_name || '',
    categoryId: r.category_id === null ? null : Number(r.category_id),
    categoryName: r.category_name || null,
    categoryIcon: r.category_icon || null,
    amountMinor: Number(r.amount_minor),
    kind: Number(r.amount_minor) < 0 ? 'expense' : 'income',
    notes: r.notes,
    cleared: !!r.cleared,
    mode: r.mode,
    frequency: r.frequency,
    interval: Number(r.interval_n),
    unit: r.interval_unit,
    frequencyLabel: RC.label(rule),
    monthlyEquivalentMinor: RC.monthlyEquivalent(Number(r.amount_minor), rule),
    startDate: r.start_date,
    endDate: r.end_date,
    nextDate: r.next_date,
    status: statusOf(r),
    paused: !!r.paused,
    pendingCount: Number(r.pending_count || 0),
  };
}

function getRow(db, userId, id) {
  const row = db.prepare(`${SELECT} WHERE s.user_id = ? AND s.id = ?`).get(userId, id);
  if (!row) throw httpError(404, 'Schedule not found.');
  return row;
}
const present = (db, userId, id) => toJson(getRow(db, userId, id));

function listSchedules(db, userId, status = 'all') {
  const rows = db.prepare(`${SELECT} WHERE s.user_id = ? ORDER BY (s.next_date IS NULL), s.next_date, s.id`).all(userId).map(toJson);
  return status === 'all' ? rows : rows.filter((r) => r.status === status);
}

/* ------------------------------ occurrences ------------------------------ */

const OCC_SELECT = `SELECT o.*, s.name AS schedule_name, s.account_id, a.name AS account_name, p.name AS payee_name,
    c.name AS category_name, c.icon AS category_icon, t.date AS tx_date, t.amount_minor AS tx_amount
  FROM schedule_occurrences o
  JOIN schedules s ON s.id = o.schedule_id AND s.user_id = o.user_id
  JOIN accounts a ON a.id = s.account_id AND a.user_id = s.user_id
  LEFT JOIN payees p ON p.id = s.payee_id AND p.user_id = s.user_id
  LEFT JOIN categories c ON c.id = s.category_id AND c.user_id = s.user_id
  LEFT JOIN transactions t ON t.id = o.transaction_id AND t.user_id = o.user_id`;

const occToJson = (r, today = null) => ({
  id: Number(r.id),
  scheduleId: Number(r.schedule_id),
  scheduleName: r.schedule_name,
  accountId: Number(r.account_id),
  accountName: r.account_name,
  payee: r.payee_name || '',
  categoryName: r.category_name || null,
  categoryIcon: r.category_icon || null,
  dueDate: r.due_date,
  status: r.status,
  amountMinor: Number(r.amount_minor),
  transactionId: r.transaction_id === null ? null : Number(r.transaction_id),
  paidDate: r.tx_date || null,                       // the date of the transaction that paid it (if it still exists)
  paidAmountMinor: r.tx_amount === null || r.tx_amount === undefined ? null : Number(r.tx_amount),
  note: r.note,
  resolvedAt: r.resolved_at,
  overdue: today !== null && r.status === 'pending' && r.due_date < today,
});

function getOcc(db, userId, id) {
  const row = db.prepare(`${OCC_SELECT} WHERE o.user_id = ? AND o.id = ?`).get(userId, id);
  if (!row) throw httpError(404, 'That scheduled item was not found.');
  return row;
}

function listOccurrences(db, userId, { status = 'pending', scheduleId = null, limit = 200 } = {}, today = null) {
  const where = ['o.user_id = ?'];
  const args = [userId];
  if (status !== 'all') { where.push('o.status = ?'); args.push(status); }
  if (scheduleId !== null) { where.push('o.schedule_id = ?'); args.push(scheduleId); }
  return db.prepare(`${OCC_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.due_date ${status === 'pending' ? 'ASC' : 'DESC'}, o.id DESC LIMIT ?`)
    .all(...args, limit).map((r) => occToJson(r, today));
}

/* ------------------------------ writing a schedule ------------------------------ */

function readFields(db, userId, b, cur) {
  const has = (k) => b[k] !== undefined;
  const out = {};

  if (!cur || has('accountId')) {
    const id = v.intId(b.accountId, 'accountId');
    const a = db.prepare('SELECT id, closed FROM accounts WHERE id = ? AND user_id = ?').get(id, userId);
    if (!a) throw v.bad('That account does not exist.');
    if (a.closed && (!cur || Number(cur.account_id) !== id)) throw v.bad('That account is closed.');
    out.account_id = id;
  }
  if (!cur || has('amountMinor')) out.amount_minor = v.minor(b.amountMinor);

  if (has('payee')) out.payeeName = v.optString(b.payee, 'Payee', 60);
  if (has('categoryId')) {
    const id = v.optId(b.categoryId, 'categoryId');
    if (id !== null && !db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').get(id, userId)) throw v.bad('That category does not exist.');
    out.category_id = id;
  }
  if (has('notes')) out.notes = v.optString(b.notes, 'Notes', 200);
  if (has('cleared')) out.cleared = v.boolish(b.cleared, 'cleared');
  if (has('mode')) {
    if (!MODES.includes(b.mode)) throw v.bad('mode must be "auto" (create the transaction by itself) or "approval" (ask me first).');
    out.mode = b.mode;
  }
  if (has('name')) out.name = v.reqString(b.name, 'Name', 60);

  // The repeat rule. Presets (monthly, quarterly...) ignore interval/unit; "custom" needs both.
  if (!cur || has('frequency') || has('interval') || has('unit')) {
    const frequency = has('frequency') ? b.frequency : cur ? cur.frequency : undefined;
    const interval = has('interval') ? b.interval : cur ? Number(cur.interval_n) : undefined;
    const unit = has('unit') ? b.unit : cur ? cur.interval_unit : undefined;
    out.rule = RC.makeRule(frequency, interval, unit);
  }
  if (!cur || has('startDate')) out.start_date = v.isoDate(b.startDate, 'Start date');
  if (has('endDate')) out.end_date = b.endDate === null || b.endDate === '' ? null : v.isoDate(b.endDate, 'End date');
  return out;
}

function createSchedule(db, userId, b) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM schedules WHERE user_id = ?').get(userId).c;
  if (count >= MAX_SCHEDULES) throw httpError(409, `You can have up to ${MAX_SCHEDULES} schedules.`);
  const f = readFields(db, userId, b, null);
  const name = f.name || f.payeeName || '';
  if (!name) throw v.bad('Give the schedule a name or a payee.');
  const end = f.end_date === undefined ? null : f.end_date;
  if (end && end < f.start_date) throw v.bad('The end date cannot be before the start date.');
  if (Number(f.amount_minor) === 0) throw v.bad('Amount cannot be zero.');

  const next = RC.nextDate(f.start_date, f.rule, end, 0);
  const id = inTransaction(db, () => {
    const pid = f.payeeName ? findOrCreatePayee(db, userId, f.payeeName) : null;
    return Number(db.prepare(
      `INSERT INTO schedules (user_id, name, account_id, payee_id, category_id, amount_minor, notes, cleared, mode,
         frequency, interval_n, interval_unit, start_date, end_date, occ_index, next_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(userId, name, f.account_id, pid, f.category_id ?? null, f.amount_minor, f.notes ?? '', f.cleared ?? 0, f.mode ?? 'approval',
      f.rule.frequency, f.rule.n, f.rule.unit, f.start_date, end, next).lastInsertRowid);
  });
  return id;
}

function updateSchedule(db, userId, id, b, today) {
  const cur = getRow(db, userId, id);
  const f = readFields(db, userId, b, cur);

  const rule = f.rule || ruleOf(cur);
  const start = f.start_date || cur.start_date;
  const end = f.end_date === undefined ? cur.end_date : f.end_date;
  if (end && end < start) throw v.bad('The end date cannot be before the start date.');

  // Changing WHEN it repeats (rule or start date) applies from today onward: nothing already handled is repeated, and
  // nothing in the past is back-filled. Anything else (amount, payee, mode, end date...) keeps the cursor where it is.
  const sameRule = rule.frequency === cur.frequency && rule.n === Number(cur.interval_n) && rule.unit === cur.interval_unit;
  let cursor = Number(cur.occ_index);
  let finished = false;
  if (!sameRule || start !== cur.start_date) {
    const k = RC.firstIndexOnOrAfter(start, rule, start > today ? start : today);
    if (k === null) finished = true; else cursor = k;
  }
  let next = finished ? null : RC.nextDate(start, rule, end, cursor);
  // A schedule that had finished (end date passed) and is brought back to life by a later end date carries on from today:
  // the months it was finished for are not back-filled.
  if (cur.next_date === null && next !== null && sameRule && start === cur.start_date) {
    const k = RC.firstIndexOnOrAfter(start, rule, today);
    if (k !== null && k > cursor) { cursor = k; next = RC.nextDate(start, rule, end, cursor); }
  }

  inTransaction(db, () => {
    let pid = cur.payee_id;
    if (f.payeeName !== undefined) pid = f.payeeName ? findOrCreatePayee(db, userId, f.payeeName) : null;
    db.prepare(
      `UPDATE schedules SET name = ?, account_id = ?, payee_id = ?, category_id = ?, amount_minor = ?, notes = ?, cleared = ?, mode = ?,
         frequency = ?, interval_n = ?, interval_unit = ?, start_date = ?, end_date = ?, occ_index = ?, next_date = ?, updated_at = ${NOW}
       WHERE id = ? AND user_id = ?`
    ).run(f.name ?? cur.name, f.account_id ?? cur.account_id, pid, f.category_id === undefined ? cur.category_id : f.category_id,
      f.amount_minor ?? cur.amount_minor, f.notes ?? cur.notes, f.cleared ?? cur.cleared, f.mode ?? cur.mode,
      rule.frequency, rule.n, rule.unit, start, end, cursor, next, id, userId);
  });
}

function deleteSchedule(db, userId, id) {
  getRow(db, userId, id);
  db.prepare('DELETE FROM schedules WHERE id = ? AND user_id = ?').run(id, userId);   // its occurrences go with it; transactions it created stay
}

function pauseSchedule(db, userId, id) {
  getRow(db, userId, id);
  db.prepare(`UPDATE schedules SET paused = 1, updated_at = ${NOW} WHERE id = ? AND user_id = ?`).run(id, userId);
}

/** How many unhandled occurrences (from `cursor`, up to the end date) fall before `date`. */
function missedBefore(s, rule, cursor, date) {
  const once = rule.frequency === 'once';
  const first = RC.firstIndexOnOrAfter(s.start_date, rule, date);          // null: a one-time schedule whose date has passed
  let upto = first === null ? (once ? 1 : cursor) : first;                 // exclusive
  if (s.end_date) {
    const e = RC.firstIndexOnOrAfter(s.start_date, rule, RC.addDays(s.end_date, 1));
    upto = Math.min(upto, e === null ? (once ? 1 : upto) : e);
  }
  return Math.max(0, Math.min(upto - cursor, 100000));
}

/**
 * Resume. By default nothing that fell due while paused is created (a paused Netflix does not back-bill you): the schedule
 * carries on from the first occurrence on or after today. With catchUp the missed ones are created / queued as normal.
 * Returns how many occurrences were skipped.
 */
function resumeSchedule(db, userId, id, { catchUp = false } = {}, today) {
  const cur = getRow(db, userId, id);
  let skipped = 0;
  let cursor = Number(cur.occ_index);
  let next = cur.next_date;
  if (!catchUp && cur.next_date !== null && cur.next_date < today) {
    const rule = ruleOf(cur);
    skipped = missedBefore(cur, rule, cursor, today);
    cursor += skipped;
    next = RC.nextDate(cur.start_date, rule, cur.end_date, cursor);
  }
  db.prepare(`UPDATE schedules SET paused = 0, occ_index = ?, next_date = ?, updated_at = ${NOW} WHERE id = ? AND user_id = ?`)
    .run(cursor, next, id, userId);
  return { skipped };
}

/* ------------------------------ making the transaction ------------------------------ */

/**
 * Creates the real transaction for one occurrence. Goes through the rules engine exactly like POST /api/transactions
 * (payee is a name until the rules are done), then falls back to the payee's default category.
 * Must be called inside a database transaction.
 */
function insertTransaction(db, userId, s, { date, amountMinor, notes, cleared }, prepared) {
  const draft = {
    accountId: Number(s.account_id), amountMinor, payee: s.payee_name || '',
    categoryId: s.category_id === null ? null : Number(s.category_id), notes, cleared: cleared ? 1 : 0,
  };
  const run = prepared ? R.runRules(prepared.rules, draft, prepared.env) : { draft, applied: [] };
  const d = run.draft;
  const pid = d.payee ? findOrCreatePayee(db, userId, d.payee) : null;
  let categoryId = d.categoryId;
  if (categoryId === null && pid !== null) {
    const p = db.prepare('SELECT default_category_id FROM payees WHERE id = ? AND user_id = ?').get(pid, userId);
    if (p && p.default_category_id !== null) categoryId = Number(p.default_category_id);
  }
  const id = Number(db.prepare(
    `INSERT INTO transactions (user_id, account_id, date, amount_minor, payee_id, category_id, notes, cleared)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, draft.accountId, date, amountMinor, pid, categoryId, d.notes, d.cleared).lastInsertRowid);
  return { id, applied: run.applied };
}

const accountOpen = (db, userId, accountId) => {
  const a = db.prepare('SELECT closed FROM accounts WHERE id = ? AND user_id = ?').get(accountId, userId);
  return !!a && !a.closed;
};

/* ------------------------------ the engine ------------------------------ */

/** Handles one schedule's due occurrences. Runs inside ONE database transaction. */
function processSchedule(db, userId, scheduleId, today, prepared, out) {
  const s = db.prepare(`SELECT s.*, p.name AS payee_name FROM schedules s LEFT JOIN payees p ON p.id = s.payee_id AND p.user_id = s.user_id
                         WHERE s.id = ? AND s.user_id = ?`).get(scheduleId, userId);
  if (!s || s.paused || s.next_date === null) return;       // re-read inside the transaction: it may have changed since we looked
  const rule = ruleOf(s);
  let cursor = Number(s.occ_index);
  let date = s.next_date;
  let handled = 0;

  const insOcc = db.prepare(`INSERT INTO schedule_occurrences (user_id, schedule_id, due_date, status, amount_minor)
                             VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(schedule_id, due_date) DO NOTHING`);
  const setPosted = db.prepare(`UPDATE schedule_occurrences SET status = 'posted', transaction_id = ?, resolved_at = ${NOW}
                                WHERE schedule_id = ? AND due_date = ? AND user_id = ?`);
  const setNote = db.prepare('UPDATE schedule_occurrences SET note = ? WHERE schedule_id = ? AND due_date = ? AND user_id = ?');

  while (date !== null && date <= today && handled < MAX_CATCHUP) {
    const fresh = insOcc.run(userId, scheduleId, date, Number(s.amount_minor)).changes === 1;
    if (!fresh) {
      out.duplicates += 1;                                   // this date was already handled (e.g. paid early): never create it twice
    } else if (s.mode === 'auto' && accountOpen(db, userId, Number(s.account_id))) {
      const made = insertTransaction(db, userId, s, { date, amountMinor: Number(s.amount_minor), notes: s.notes, cleared: s.cleared }, prepared);
      setPosted.run(made.id, scheduleId, date, userId);
      out.posted += 1;
      out.transactionIds.push(made.id);
    } else {
      // approval mode, or auto mode on a closed account (never lose a bill silently: queue it for the user).
      if (s.mode === 'auto') setNote.run('The account is closed, so this was not posted automatically.', scheduleId, date, userId);
      out.pending += 1;
    }
    handled += 1;
    cursor += 1;
    date = RC.nextDate(s.start_date, rule, s.end_date, cursor);
  }
  if (date !== null && date <= today) out.more = true;
  db.prepare(`UPDATE schedules SET occ_index = ?, next_date = ?, updated_at = ${NOW} WHERE id = ? AND user_id = ? AND occ_index = ?`)
    .run(cursor, date, scheduleId, userId, Number(s.occ_index));
}

/** Handles everything due for one user. Never call inside another database transaction. */
function runDue(db, userId, today) {
  const out = { posted: 0, pending: 0, duplicates: 0, more: false, transactionIds: [] };
  const due = db.prepare('SELECT id FROM schedules WHERE user_id = ? AND paused = 0 AND next_date IS NOT NULL AND next_date <= ? ORDER BY next_date, id')
    .all(userId, today);
  if (!due.length) return out;
  const prepared = R.prepare(db, userId);
  for (const row of due) inTransaction(db, () => processSchedule(db, userId, Number(row.id), today, prepared, out));
  return out;
}

/** Every user with something due (used at start-up and on a timer). */
function runAllDue(db, today) {
  const total = { users: 0, posted: 0, pending: 0 };
  for (const u of db.prepare('SELECT DISTINCT user_id FROM schedules WHERE paused = 0 AND next_date IS NOT NULL AND next_date <= ?').all(today)) {
    const r = runDue(db, Number(u.user_id), today);
    total.users += 1; total.posted += r.posted; total.pending += r.pending;
  }
  return total;
}

/* ------------------------------ acting on occurrences ------------------------------ */

function readOverrides(b) {
  const o = {};
  if (b.amountMinor !== undefined) o.amountMinor = v.minor(b.amountMinor);
  if (b.date !== undefined) o.date = v.isoDate(b.date);
  if (b.notes !== undefined) o.notes = v.optString(b.notes, 'Notes', 200);
  if (b.cleared !== undefined) o.cleared = v.boolish(b.cleared, 'cleared');
  return o;
}

function sameSign(a, b) { return (a < 0) === (b < 0); }

/** Approve a pending occurrence: create the transaction (optionally with the real amount / date) and mark it posted. */
function approveOccurrence(db, userId, occId, body) {
  const o = readOverrides(body);
  const prepared = R.prepare(db, userId);
  return inTransaction(db, () => {
    const occ = db.prepare('SELECT * FROM schedule_occurrences WHERE id = ? AND user_id = ?').get(occId, userId);
    if (!occ) throw httpError(404, 'That scheduled item was not found.');
    if (occ.status !== 'pending') throw httpError(409, occ.status === 'posted' ? 'That bill is already posted.' : 'That bill was skipped.');
    const s = db.prepare(`SELECT s.*, p.name AS payee_name FROM schedules s LEFT JOIN payees p ON p.id = s.payee_id AND p.user_id = s.user_id
                           WHERE s.id = ? AND s.user_id = ?`).get(occ.schedule_id, userId);
    if (!accountOpen(db, userId, Number(s.account_id))) throw httpError(409, 'The account for this schedule is closed. Edit the schedule to use an open account first.');
    const amount = o.amountMinor === undefined ? Number(occ.amount_minor) : o.amountMinor;
    if (!sameSign(amount, Number(occ.amount_minor))) throw v.bad(Number(occ.amount_minor) < 0 ? 'The amount must be an expense (negative), like the schedule.' : 'The amount must be income (positive), like the schedule.');
    const made = insertTransaction(db, userId, s, {
      date: o.date || occ.due_date, amountMinor: amount, notes: o.notes === undefined ? s.notes : o.notes,
      cleared: o.cleared === undefined ? s.cleared : o.cleared,
    }, prepared);
    const upd = db.prepare(`UPDATE schedule_occurrences SET status = 'posted', transaction_id = ?, amount_minor = ?, resolved_at = ${NOW}
                            WHERE id = ? AND user_id = ? AND status = 'pending'`).run(made.id, amount, occId, userId);
    if (upd.changes !== 1) throw httpError(409, 'That bill was just handled somewhere else.');
    return { transactionId: made.id, rulesApplied: made.applied };
  });
}

function skipOccurrence(db, userId, occId) {
  return inTransaction(db, () => {
    const occ = db.prepare('SELECT status FROM schedule_occurrences WHERE id = ? AND user_id = ?').get(occId, userId);
    if (!occ) throw httpError(404, 'That scheduled item was not found.');
    if (occ.status !== 'pending') throw httpError(409, occ.status === 'posted' ? 'That bill is already posted.' : 'That bill was already skipped.');
    db.prepare(`UPDATE schedule_occurrences SET status = 'skipped', resolved_at = ${NOW} WHERE id = ? AND user_id = ? AND status = 'pending'`).run(occId, userId);
  });
}

/**
 * Handle the NEXT not-yet-due occurrence right now ("I paid the electricity bill early" / "skip this month").
 * The cursor moves on, so when its date arrives nothing is created a second time.
 */
function handleNext(db, userId, scheduleId, { post, body = {}, today }) {
  const o = post ? readOverrides(body) : {};
  const prepared = post ? R.prepare(db, userId) : null;
  return inTransaction(db, () => {
    const s = db.prepare(`SELECT s.*, p.name AS payee_name FROM schedules s LEFT JOIN payees p ON p.id = s.payee_id AND p.user_id = s.user_id
                           WHERE s.id = ? AND s.user_id = ?`).get(scheduleId, userId);
    if (!s) throw httpError(404, 'Schedule not found.');
    if (s.paused) throw httpError(409, 'This schedule is paused. Resume it first.');
    if (s.next_date === null) throw httpError(409, 'This schedule has no more occurrences.');
    const rule = ruleOf(s);
    const due = s.next_date;
    const amount = o.amountMinor === undefined ? Number(s.amount_minor) : o.amountMinor;
    if (post) {
      if (!accountOpen(db, userId, Number(s.account_id))) throw httpError(409, 'The account for this schedule is closed. Edit the schedule to use an open account first.');
      if (!sameSign(amount, Number(s.amount_minor))) throw v.bad(Number(s.amount_minor) < 0 ? 'The amount must be an expense (negative), like the schedule.' : 'The amount must be income (positive), like the schedule.');
    }
    const ins = db.prepare(`INSERT INTO schedule_occurrences (user_id, schedule_id, due_date, status, amount_minor)
                            VALUES (?, ?, ?, 'pending', ?) ON CONFLICT(schedule_id, due_date) DO NOTHING`).run(userId, scheduleId, due, amount);
    if (ins.changes !== 1) throw httpError(409, 'That date was already handled.');
    let result = {};
    if (post) {
      const made = insertTransaction(db, userId, s, {
        date: o.date || (due < today ? due : today), amountMinor: amount, notes: o.notes === undefined ? s.notes : o.notes,
        cleared: o.cleared === undefined ? s.cleared : o.cleared,
      }, prepared);
      db.prepare(`UPDATE schedule_occurrences SET status = 'posted', transaction_id = ?, resolved_at = ${NOW} WHERE schedule_id = ? AND due_date = ? AND user_id = ?`)
        .run(made.id, scheduleId, due, userId);
      result = { transactionId: made.id, rulesApplied: made.applied };
    } else {
      db.prepare(`UPDATE schedule_occurrences SET status = 'skipped', resolved_at = ${NOW} WHERE schedule_id = ? AND due_date = ? AND user_id = ?`).run(scheduleId, due, userId);
    }
    const cursor = Number(s.occ_index) + 1;
    db.prepare(`UPDATE schedules SET occ_index = ?, next_date = ?, updated_at = ${NOW} WHERE id = ? AND user_id = ?`)
      .run(cursor, RC.nextDate(s.start_date, rule, s.end_date, cursor), scheduleId, userId);
    return { dueDate: due, ...result };
  });
}

module.exports = {
  MAX_SCHEDULES, MAX_CATCHUP,
  toJson, getRow, present, listSchedules, listOccurrences, getOcc, occToJson,
  createSchedule, updateSchedule, deleteSchedule, pauseSchedule, resumeSchedule,
  runDue, runAllDue, approveOccurrence, skipOccurrence, handleNext,
};
