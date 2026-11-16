import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, option, todayLocal, openModal, confirmModal } from '/js/ui.js';
import { makeMoney, parseMoney } from '/js/money.js';

const { user } = await ready;
if (!user) await new Promise(() => {}); // layout.js is already redirecting to /login

const money = makeMoney(user.locale, user.currency);
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(user.locale, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtStamp = (iso) => new Date(iso).toLocaleString(user.locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

let accounts = [];
let state = null;          // GET /api/accounts/:id/reconciliation
let accountId = null;

/* ---------- loading ---------- */

async function loadAccount() {
  $('txLoading').hidden = false;
  try {
    state = await api(`/api/accounts/${accountId}/reconciliation`);
  } catch (err) {
    toast(err.message);
    return;
  } finally {
    $('txLoading').hidden = true;
  }
  paintCards();
  paintTx();
  paintDiff();
  $('viewTx').href = `/transactions?account=${accountId}&month=all`;
  await loadHistory();
}

function paintCards() {
  $('cCleared').textContent = money.net(state.clearedBalanceMinor);
  $('cClearedN').textContent = `${state.clearedCount} cleared transaction${state.clearedCount === 1 ? '' : 's'} + opening balance`;
  $('cUncleared').textContent = money.net(state.unclearedBalanceMinor);
  $('cUnclearedN').textContent = `${state.unclearedCount} not cleared yet`;
  $('cTotal').textContent = money.net(state.balanceMinor);
  const last = state.lastReconciliation;
  $('cLast').textContent = last ? fmtDate(last.statementDate) : 'Never';
  $('cLastHint').textContent = last ? `Statement balance ${money.net(last.statementBalanceMinor)}` : 'No reconciliation yet';
}

/* ---------- transactions to tick off ---------- */

function paintTx() {
  const filter = $('show').value;
  const list = state.transactions.filter((t) => filter === 'all' || (filter === 'yes') === t.cleared);
  const box = $('txList');
  box.textContent = '';
  $('txEmpty').hidden = list.length > 0;
  $('txCount').textContent = list.length ? `${list.length} shown` : '';
  for (const t of list) {
    const cb = el('input', { type: 'checkbox', className: 'tx-check', checked: t.cleared, ariaLabel: `Cleared: ${t.payee || 'transaction'}` });
    cb.onchange = async () => {
      cb.disabled = true;
      try {
        await api(`/api/transactions/${t.id}`, { method: 'PATCH', body: { cleared: cb.checked } });
        await loadAccount();
      } catch (err) { toast(err.message); cb.checked = !cb.checked; cb.disabled = false; }
    };
    box.append(el('label', { className: 'rec-tx' + (t.cleared ? ' is-cleared' : '') },
      cb,
      el('div', { className: 'grow' },
        el('b', { textContent: t.payee || '(no payee)' }), el('br'),
        el('small', { textContent: `${fmtDate(t.date)} • ${t.isSplit ? '✂ Split' : (t.categoryName || 'Uncategorized')}` })),
      el('span', { className: t.amountMinor > 0 ? 'inc' : 'exp', textContent: money.signed(t.amountMinor) })));
  }
}

$('show').onchange = paintTx;
$('clearAll').onclick = async () => {
  const ids = state.transactions.filter((t) => !t.cleared && ($('show').value !== 'yes')).map((t) => t.id);
  if (!ids.length) return toast('Everything shown is already cleared.');
  confirmModal({
    title: `Mark ${ids.length} transaction${ids.length === 1 ? '' : 's'} as cleared?`,
    message: 'Only do this if all of them appear on your statement. You can untick any of them afterwards.',
    confirmLabel: 'Mark cleared', danger: false,
    onConfirm: async () => {
      for (let i = 0; i < ids.length; i += 500) {
        await api('/api/transactions/bulk', { method: 'POST', body: { ids: ids.slice(i, i + 500), action: 'update', changes: { cleared: true } } });
      }
      toast(`✓ Marked ${ids.length} cleared`);
      await loadAccount();
    },
  });
};

/* ---------- the comparison ---------- */

function statementMinor() {
  const t = $('stBal').value.trim();
  if (t === '') return undefined;
  return parseMoney(t, { allowNegative: true });   // null = unreadable
}

function paintDiff() {
  const box = $('diff');
  const finish = $('finish');
  const adj = $('adjust');
  $('recErr').textContent = '';
  adj.hidden = true;
  const st = statementMinor();
  if (!state || st === undefined) {
    box.className = 'rec-diff';
    box.textContent = 'Type the balance from your statement to compare.';
    finish.disabled = true;
    return;
  }
  if (st === null) {
    box.className = 'rec-diff bad';
    box.textContent = 'That does not look like an amount. Try 13000 or 12,950.50 (a minus sign for an overdrawn account).';
    finish.disabled = true;
    return;
  }
  const diff = st - state.clearedBalanceMinor;
  box.textContent = '';
  if (diff === 0) {
    box.className = 'rec-diff ok';
    box.append(el('b', { className: 'big', textContent: '✓ They match' }),
      `Your statement and SpendWise's cleared balance are both ${money.net(st)}.`);
    finish.disabled = !state.transactions.some((t) => t.cleared);   // nothing cleared since the last reconciliation: nothing to lock in
    finish.textContent = 'Finish reconciliation';
  } else {
    box.className = 'rec-diff bad';
    box.append(
      el('b', { className: 'big', textContent: `Difference ${diff > 0 ? '+' : '−'}${money.fmt(diff)}` }),
      `Statement ${money.net(st)} vs SpendWise cleared ${money.net(state.clearedBalanceMinor)}. `,
      diff > 0 ? `SpendWise is ${money.fmt(diff)} short: a transaction may be missing, or one is marked wrong.`
        : `SpendWise shows ${money.fmt(diff)} more than the bank: a transaction may be missing a clear mark, or entered twice.`);
    finish.disabled = true;
    finish.textContent = 'Finish reconciliation';
    adj.hidden = false;
    adj.textContent = `Can't find it? Add a ${diff > 0 ? '+' : '−'}${money.fmt(diff)} adjustment and finish`;
  }
}
$('stBal').addEventListener('input', paintDiff);

async function submit(withAdjustment) {
  $('recErr').textContent = '';
  const st = statementMinor();
  if (st === undefined || st === null) { $('recErr').textContent = 'Type the statement balance first.'; return; }
  if (!$('stDate').value) { $('recErr').textContent = 'Pick the statement date.'; return; }
  try {
    const r = await api(`/api/accounts/${accountId}/reconcile`, {
      method: 'POST',
      body: { statementBalanceMinor: st, statementDate: $('stDate').value, adjust: withAdjustment, note: $('stNote').value.trim() },
    });
    const h = r.reconciliation;
    toast(`✔ Reconciled ${h.transactionCount} transaction${h.transactionCount === 1 ? '' : 's'}` + (h.adjustmentMinor ? ` with a ${money.net(h.adjustmentMinor)} adjustment` : ''));
    $('stBal').value = ''; $('stNote').value = '';
    await loadAccount();
  } catch (err) {
    $('recErr').textContent = err.message;
    await loadAccount();
  }
}

$('recForm').addEventListener('submit', (e) => { e.preventDefault(); if (!$('finish').disabled) submit(false); });
$('adjust').onclick = () => {
  const st = statementMinor();
  if (typeof st !== 'number') return;
  const diff = st - state.clearedBalanceMinor;
  confirmModal({
    title: 'Add an adjustment?',
    message: `This adds one cleared transaction of ${money.net(diff)} ("Reconciliation Balance Adjustment", no category) dated ${fmtDate($('stDate').value || todayLocal())} so SpendWise matches your statement, then locks everything cleared. You can undo this reconciliation later from the history below.`,
    confirmLabel: 'Add adjustment and finish', danger: false,
    onConfirm: () => submit(true),
  });
};

/* ---------- history ---------- */

async function loadHistory() {
  const { reconciliations } = await api(`/api/reconciliations?account=${accountId}`);
  const body = $('histBody');
  body.textContent = '';
  $('hist').hidden = reconciliations.length === 0;
  $('histEmpty').hidden = reconciliations.length > 0;
  for (const r of reconciliations) {
    const view = el('button', { className: 'mini-btn', type: 'button', textContent: 'Details' });
    view.onclick = () => showDetails(r);
    const undo = r.canUndo ? el('button', { className: 'mini-btn', type: 'button', textContent: '↶ Undo', title: 'Unlock its transactions and remove its adjustment' }) : '';
    if (r.canUndo) undo.onclick = () => undoRec(r);
    body.append(el('tr', {},
      el('td', { textContent: fmtDate(r.statementDate) }),
      el('td', { textContent: fmtStamp(r.reconciledAt) }),
      el('td', { className: 'num', textContent: money.net(r.statementBalanceMinor) }),
      el('td', { className: 'num', textContent: money.net(r.clearedBalanceMinor) }),
      el('td', { className: 'num', textContent: r.differenceMinor === 0 ? '✓ none' : `${money.net(r.differenceMinor)} (adjusted)` }),
      el('td', { className: 'num', textContent: String(r.transactionCount) }),
      el('td', { className: 'num' }, view, undo)));
  }
}

async function showDetails(r) {
  let data;
  try { data = await api(`/api/reconciliations/${r.id}`); } catch (err) { return toast(err.message); }
  const list = el('div', { className: 'row-list', style: 'max-height:360px;overflow:auto' });
  for (const t of data.transactions) {
    list.append(el('div', { className: 'rec-tx' },
      el('div', { className: 'grow' }, el('b', { textContent: t.payee || '(no payee)' }), el('br'), el('small', { textContent: fmtDate(t.date) })),
      el('span', { className: t.amountMinor > 0 ? 'inc' : 'exp', textContent: money.signed(t.amountMinor) })));
  }
  openModal({
    title: `Statement of ${fmtDate(r.statementDate)}`,
    content: el('div', {},
      el('p', { className: 'modal-text', textContent: `Reconciled ${fmtStamp(r.reconciledAt)}. Statement ${money.net(r.statementBalanceMinor)}; SpendWise's cleared balance was ${money.net(r.clearedBalanceMinor)}`
        + (r.adjustmentMinor ? `, so an adjustment of ${money.net(r.adjustmentMinor)} was added.` : ', no adjustment needed.') + (r.note ? ` Note: ${r.note}` : '') }),
      list),
    buttons: [{ label: 'Close', kind: 'ghost' }],
  });
}

function undoRec(r) {
  confirmModal({
    title: 'Undo this reconciliation?',
    message: `Its ${r.transactionCount} transaction${r.transactionCount === 1 ? '' : 's'} are unlocked again` + (r.adjustmentMinor ? ` and the ${money.net(r.adjustmentMinor)} adjustment transaction is deleted.` : '.') + ' The transactions themselves stay.',
    confirmLabel: 'Undo reconciliation',
    onConfirm: async () => {
      await api(`/api/reconciliations/${r.id}`, { method: 'DELETE' });
      toast('↶ Reconciliation undone');
      await loadAccount();
    },
  });
}

/* ---------- start ---------- */

$('stDate').value = todayLocal();
try {
  ({ accounts } = await api('/api/accounts'));
} catch (err) { toast(err.message); }
const want = new URLSearchParams(location.search).get('account');
const sel = $('account');
for (const a of accounts) sel.append(option(a.id, a.name + (a.closed ? ' (closed)' : '')));
sel.value = [...sel.options].some((o) => o.value === want) ? want : (sel.options[0] ? sel.options[0].value : '');
accountId = sel.value ? Number(sel.value) : null;
sel.onchange = () => { accountId = Number(sel.value); history.replaceState(null, '', `/reconcile?account=${accountId}`); $('stBal').value = ''; loadAccount(); };
if (accountId) await loadAccount();
