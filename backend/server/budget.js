'use strict';
// Envelope budgeting engine (Actual Budget rules). Everything here is derived from three things:
//   transaction lines (tx_lines: one per normal transaction, one per split of a split transaction; on-budget accounts only), opening balances, and the per-month "assigned" rows.
// Activity / Available / To Budget are computed, never stored, so they can never drift from the ledger.
//
//   Available(cat, M) = carryIn(cat, M) + Assigned(cat, M) + Activity(cat, M)
//   carryIn(cat, M)   = Available(cat, M-1) if it was >= 0, or if "roll over overspending" was on for M-1;
//                       otherwise 0 (the overspent amount is taken out of next month's To Budget instead)
//   To Budget(M)      = To Budget(M-1) + Income(M) - UncategorizedSpending(M) - OverspentLastMonth(M) - TotalAssigned(M)
//
// Income = positive transactions in an Income group (or with no category) + opening balances of on-budget
// accounts (credited once, in the first month that has budget data). A positive amount in an expense category
// is a refund: it raises that category's Activity. Spending with no category has no envelope to come out of, so
// it comes straight out of To Budget (the money is gone) and is flagged so it can be categorized; categorizing it
// later moves the same amount out of that envelope instead, so To Budget + all Available always equals the money
// held in on-budget accounts.
// "Roll over overspending" is per category and sticky: the most recent month that set it decides.

const { httpError } = require('./http');

const MONTH_RE = /^(20\d\d)-(0[1-9]|1[0-2])$/;
const MIN_IDX = 2000 * 12;
const MAX_IDX = 2099 * 12 + 11;

const isMonth = (m) => typeof m === 'string' && MONTH_RE.test(m);
function needMonth(m) {
  if (!isMonth(m)) throw httpError(400, 'Month must look like 2026-11 (between 2000 and 2099).');
  return m;
}
const monthIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthFrom = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const addMonths = (m, n) => {
  const i = monthIndex(m) + n;
  return i < MIN_IDX || i > MAX_IDX ? null : monthFrom(i);
};
const monthName = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1))
  .toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function moneyText(user, minor) {
  const abs = Math.abs(minor);
  const d = abs % 100 === 0 ? 0 : 2;
  let s;
  try {
    s = new Intl.NumberFormat((user && user.locale) || 'en-IN', {
      style: 'currency', currency: (user && user.currency) || 'INR', minimumFractionDigits: d, maximumFractionDigits: d,
    }).format(abs / 100);
  } catch { s = `₹${(abs / 100).toFixed(d)}`; }
  return (minor < 0 ? '−' : '') + s;
}

/* ------------------------------ read the ledger ------------------------------ */

function loadFacts(db, userId) {
  const groups = db.prepare('SELECT id, name, hidden, is_income, sort_order FROM category_groups WHERE user_id = ? ORDER BY sort_order, id').all(userId)
    .map((g) => ({ id: Number(g.id), name: g.name, hidden: !!g.hidden, isIncome: !!g.is_income, cats: [] }));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const cats = new Map();
  for (const c of db.prepare('SELECT id, group_id, name, icon, hidden FROM categories WHERE user_id = ? ORDER BY sort_order, id').all(userId)) {
    const g = groupById.get(Number(c.group_id));
    if (!g) continue;
    const cat = { id: Number(c.id), groupId: g.id, name: c.name, icon: c.icon, hidden: !!c.hidden, isIncome: g.isIncome };
    g.cats.push(cat);
    cats.set(cat.id, cat);
  }

  const income = new Map();      // month -> paise
  const activity = new Map();    // 'YYYY-MM|catId' -> paise
  const uncategorized = new Map(); // month -> count of uncategorized on-budget expenses
  const uncategorizedSpend = new Map(); // month -> paise spent with no category (positive number)
  const touched = [];            // every month that has any data
  const rows = db.prepare(
    `SELECT substr(t.date, 1, 7) AS m, t.category_id AS cid, (t.amount_minor > 0) AS pos, SUM(t.amount_minor) AS s, COUNT(*) AS n
       FROM tx_lines t JOIN accounts a ON a.id = t.account_id
      WHERE t.user_id = ? AND a.offbudget = 0 GROUP BY m, cid, pos`
  ).all(userId);
  for (const r of rows) {
    const m = r.m; const s = Number(r.s);
    if (!isMonth(m)) continue; // dates outside 2000-2099 cannot be shown in the budget
    touched.push(m);
    const cat = r.cid === null ? null : cats.get(Number(r.cid));
    if (r.cid === null) {
      if (r.pos) income.set(m, (income.get(m) || 0) + s);
      else {
        uncategorized.set(m, (uncategorized.get(m) || 0) + Number(r.n));
        uncategorizedSpend.set(m, (uncategorizedSpend.get(m) || 0) - s);
      }
    } else if (cat && cat.isIncome) {
      income.set(m, (income.get(m) || 0) + s);
    } else if (cat) {
      const k = `${m}|${cat.id}`;
      activity.set(k, (activity.get(k) || 0) + s);
    }
  }

  const assigned = new Map(); // 'YYYY-MM|catId' -> { assigned, carryover }
  for (const r of db.prepare('SELECT month, category_id, assigned_minor, carryover FROM budget_months WHERE user_id = ?').all(userId)) {
    const cat = cats.get(Number(r.category_id));
    if (!cat || cat.isIncome || !isMonth(r.month)) continue;
    assigned.set(`${r.month}|${cat.id}`, { assigned: Number(r.assigned_minor), carryover: r.carryover === null ? null : !!r.carryover });
    touched.push(r.month);
  }

  const opening = Number(db.prepare('SELECT COALESCE(SUM(opening_balance_minor), 0) AS s FROM accounts WHERE user_id = ? AND offbudget = 0').get(userId).s);
  const idx = touched.map(monthIndex);
  return {
    groups, cats, income, activity, assigned, uncategorized, uncategorizedSpend, opening,
    firstIdx: idx.length ? Math.min(...idx) : null,
    lastIdx: idx.length ? Math.max(...idx) : null,
  };
}

/* ------------------------------ the month-by-month roll ------------------------------ */

/**
 * Walk month by month from the first month with data up to endMonth.
 * Returns { toBudget: Map(month -> paise), detail } where detail describes `detailMonth`
 * (defaults to endMonth) including every budgetable category's row.
 */
function simulate(f, endMonth, detailMonth = endMonth, startMonth = null) {
  const endIdx = monthIndex(endMonth);
  let startIdx = f.firstIdx === null ? endIdx : Math.min(f.firstIdx, endIdx);
  if (startMonth !== null) startIdx = Math.min(startIdx, monthIndex(startMonth));
  const budgetable = f.groups.filter((g) => !g.isIncome).flatMap((g) => g.cats);

  const carry = new Map();          // catId -> carry-in for the month being processed
  const sticky = new Map();         // catId -> "roll over overspending" as last set
  const toBudgetByMonth = new Map();
  let leftover = 0;                 // To Budget left at the end of the previous month
  let overspentLast = 0;            // overspending from last month that did not roll over
  let detail = null;

  for (let i = startIdx; i <= endIdx; i++) {
    const m = monthFrom(i);
    const first = i === startIdx;
    const incomeM = f.income.get(m) || 0;
    const uncatM = f.uncategorizedSpend.get(m) || 0;
    const openingM = first ? f.opening : 0;

    const rows = [];
    let assignedTotal = 0, activityTotal = 0, availableTotal = 0, overspentNow = 0, rolledIn = 0;
    for (const c of budgetable) {
      const a = f.assigned.get(`${m}|${c.id}`) || { assigned: 0, carryover: null };
      if (a.carryover !== null) sticky.set(c.id, a.carryover);
      const act = f.activity.get(`${m}|${c.id}`) || 0;
      const cin = carry.get(c.id) || 0;
      const avail = cin + a.assigned + act;
      rows.push({ cat: c, carryIn: cin, assigned: a.assigned, activity: act, available: avail, carryover: !!sticky.get(c.id) });
      assignedTotal += a.assigned; activityTotal += act; availableTotal += avail; rolledIn += cin;
    }

    const toBudget = leftover + incomeM + openingM - uncatM - overspentLast - assignedTotal;
    toBudgetByMonth.set(m, toBudget);

    if (m === detailMonth) {
      detail = {
        month: m, rows, toBudget, income: incomeM, opening: openingM, uncategorizedSpend: uncatM, rolledFromLastMonth: leftover,
        overspentLastMonth: overspentLast, assignedTotal, activityTotal, availableTotal, rolledIn,
        uncategorized: f.uncategorized.get(m) || 0,
      };
    }

    // Prepare next month.
    for (const r of rows) {
      if (r.available >= 0 || r.carryover) carry.set(r.cat.id, r.available);
      else { carry.set(r.cat.id, 0); overspentNow += -r.available; }
    }
    leftover = toBudget;
    overspentLast = overspentNow;
  }
  return { toBudget: toBudgetByMonth, detail };
}

/** The full picture of one month, in the shape the API returns. */
function monthView(db, userId, month) {
  needMonth(month);
  const f = loadFacts(db, userId);
  const { detail: d } = simulate(f, month);
  const byCat = new Map(d.rows.map((r) => [r.cat.id, r]));

  let overspentCount = 0, overspentMinor = 0;
  const groups = f.groups.filter((g) => !g.isIncome).map((g) => {
    const cats = g.cats.map((c) => {
      const r = byCat.get(c.id);
      const over = r.available < 0;
      if (over) { overspentCount++; overspentMinor += -r.available; }
      return {
        id: c.id, groupId: g.id, name: c.name, icon: c.icon, hidden: c.hidden,
        carryInMinor: r.carryIn, assignedMinor: r.assigned, activityMinor: r.activity, availableMinor: r.available,
        overspent: over, carryover: r.carryover,
      };
    });
    const sum = (k) => cats.reduce((n, c) => n + c[k], 0);
    return {
      id: g.id, name: g.name, hidden: g.hidden, categories: cats,
      totals: { assignedMinor: sum('assignedMinor'), activityMinor: sum('activityMinor'), availableMinor: sum('availableMinor') },
    };
  });

  return {
    month,
    prevMonth: addMonths(month, -1),
    nextMonth: addMonths(month, 1),
    toBudgetMinor: d.toBudget,
    incomeMinor: d.income,
    openingBalanceMinor: d.opening,                 // only non-zero in the first budget month
    rolledFromLastMonthMinor: d.rolledFromLastMonth, // last month's leftover To Budget
    overspentLastMonthMinor: d.overspentLastMonth,   // taken out of To Budget this month
    assignedMinor: d.assignedTotal,
    activityMinor: d.activityTotal,
    availableMinor: d.availableTotal,
    overspentCount, overspentMinor,
    uncategorizedCount: d.uncategorized,
    uncategorizedSpendMinor: d.uncategorizedSpend,   // spent with no category: taken straight out of To Budget
    groups,
  };
}

/* ------------------------------ writes ------------------------------ */

function budgetableCategory(db, userId, id) {
  const c = db.prepare(
    `SELECT c.id, c.name, g.is_income FROM categories c JOIN category_groups g ON g.id = c.group_id WHERE c.id = ? AND c.user_id = ?`
  ).get(id, userId);
  if (!c) throw httpError(404, 'Category not found.');
  if (c.is_income) throw httpError(400, 'Income categories are not budgeted. Income goes into To Budget by itself.');
  return { id: Number(c.id), name: c.name };
}

const UPSERT_ASSIGNED = `INSERT INTO budget_months (user_id, month, category_id, assigned_minor) VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, month, category_id) DO UPDATE SET assigned_minor = excluded.assigned_minor, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const TIDY = 'DELETE FROM budget_months WHERE user_id = ? AND assigned_minor = 0 AND carryover IS NULL';

/**
 * Throws if `change()` would push To Budget further below zero in `month` or any later month that has data.
 * (Lowering an assignment can never be refused; assigning is refused only when it over-allocates.)
 */
function guardOverAllocation(db, user, month, change) {
  const before = loadFacts(db, user.id);
  change();
  const after = loadFacts(db, user.id);
  // One month past the last data: overspending in the last month is deducted from the month after it.
  const end = monthFrom(Math.min(MAX_IDX, Math.max(monthIndex(month), before.lastIdx ?? 0, after.lastIdx ?? 0) + 1));
  // Both runs start from the same month, so a month that comes before the first data is still checked.
  const start = monthFrom(Math.min(monthIndex(month), before.firstIdx ?? Infinity, after.firstIdx ?? Infinity));
  const b = simulate(before, end, end, start).toBudget;
  const a = simulate(after, end, end, start).toBudget;
  for (let i = monthIndex(month); i <= monthIndex(end); i++) {
    const m = monthFrom(i);
    const was = b.get(m), now = a.get(m);
    if (now < 0 && now < was) {
      if (m === month) {
        throw httpError(400, `Not enough in To Budget. You have ${moneyText(user, Math.max(0, was))} left to assign in ${monthName(month)}.`);
      }
      throw httpError(400, `That would over-allocate ${monthName(m)} (its To Budget would drop to ${moneyText(user, now)}). Assign less, or add income first.`);
    }
  }
}

function setAssigned(db, user, month, categoryId, assignedMinor) {
  needMonth(month);
  budgetableCategory(db, user.id, categoryId);
  guardOverAllocation(db, user, month, () => {
    db.prepare(UPSERT_ASSIGNED).run(user.id, month, categoryId, assignedMinor);
    db.prepare(TIDY).run(user.id);
  });
}

function setCarryover(db, user, month, categoryId, on) {
  needMonth(month);
  budgetableCategory(db, user.id, categoryId);
  db.prepare(
    `INSERT INTO budget_months (user_id, month, category_id, carryover) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, month, category_id) DO UPDATE SET carryover = excluded.carryover, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(user.id, month, categoryId, on ? 1 : 0);
  db.prepare(TIDY).run(user.id);
}

/** Move `amount` from one envelope to another inside `month`, and write the audit row. Returns the audit id. */
function transfer(db, user, month, fromId, toId, amount, note) {
  needMonth(month);
  if (fromId === toId) throw httpError(400, 'Pick two different categories.');
  const from = budgetableCategory(db, user.id, fromId);
  const to = budgetableCategory(db, user.id, toId);

  const f = loadFacts(db, user.id);
  const { detail } = simulate(f, month);
  const rf = detail.rows.find((r) => r.cat.id === from.id);
  const rt = detail.rows.find((r) => r.cat.id === to.id);
  if (amount > rf.available) {
    throw httpError(400, rf.available > 0
      ? `Only ${moneyText(user, rf.available)} is available in ${from.name}.`
      : `${from.name} has nothing available to move.`);
  }

  // Same guard as assigning: a transfer must not push this or a later month's To Budget below zero
  // (it can, if it leaves the source short in a later month and that overspending is deducted).
  guardOverAllocation(db, user, month, () => {
    db.prepare(UPSERT_ASSIGNED).run(user.id, month, from.id, rf.assigned - amount);
    db.prepare(UPSERT_ASSIGNED).run(user.id, month, to.id, rt.assigned + amount);
    db.prepare(TIDY).run(user.id);
  });
  const id = Number(db.prepare(
    `INSERT INTO budget_transfers (user_id, month, from_category_id, to_category_id, from_name, to_name, amount_minor,
       from_available_before_minor, from_available_after_minor, to_available_before_minor, to_available_after_minor, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(user.id, month, from.id, to.id, from.name, to.name, amount,
    rf.available, rf.available - amount, rt.available, rt.available + amount, note).lastInsertRowid);
  return id;
}

/**
 * Called when category `fromId` is merged into / replaced by `toId`: its monthly assignments are added to
 * the target so no assigned money silently returns to To Budget. (Deleting without a target does return it.)
 */
function mergeAssignments(db, userId, fromId, toId) {
  const t = db.prepare(
    'SELECT g.is_income FROM categories c JOIN category_groups g ON g.id = c.group_id WHERE c.id = ? AND c.user_id = ?'
  ).get(toId, userId);
  if (!t || t.is_income) return;
  db.prepare(
    `INSERT INTO budget_months (user_id, month, category_id, assigned_minor, carryover)
       SELECT user_id, month, ?, assigned_minor, carryover FROM budget_months WHERE user_id = ? AND category_id = ?
     ON CONFLICT(user_id, month, category_id) DO UPDATE
       SET assigned_minor = assigned_minor + excluded.assigned_minor,
           carryover = CASE WHEN carryover IS NULL THEN excluded.carryover
                            WHEN excluded.carryover IS NULL THEN carryover
                            ELSE MAX(carryover, excluded.carryover) END`
  ).run(toId, userId, fromId);
}

function listTransfers(db, userId, { month = null, limit = 200 } = {}) {
  const where = month ? 'user_id = ? AND month = ?' : 'user_id = ?';
  const args = month ? [userId, month] : [userId];
  return db.prepare(`SELECT * FROM budget_transfers WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...args, limit).map((r) => ({
    id: Number(r.id), month: r.month,
    fromCategoryId: r.from_category_id === null ? null : Number(r.from_category_id),
    toCategoryId: r.to_category_id === null ? null : Number(r.to_category_id),
    fromName: r.from_name, toName: r.to_name, amountMinor: Number(r.amount_minor),
    fromAvailableBeforeMinor: Number(r.from_available_before_minor), fromAvailableAfterMinor: Number(r.from_available_after_minor),
    toAvailableBeforeMinor: Number(r.to_available_before_minor), toAvailableAfterMinor: Number(r.to_available_after_minor),
    note: r.note, createdAt: r.created_at,
  }));
}

module.exports = {
  isMonth, needMonth, addMonths, monthName, moneyText,
  loadFacts, simulate, monthView, setAssigned, setCarryover, transfer, mergeAssignments, listTransfers,
};
