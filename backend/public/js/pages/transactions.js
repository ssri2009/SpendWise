import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, field, option, dayLabel, monthLabel, todayLocal, openModal, confirmModal } from '/js/ui.js';
import { makeMoney } from '/js/money.js';
import { buildTxFields } from '/js/txform.js';
import { openSplitEditor } from '/js/splitedit.js';

const { user } = await ready;
if (!user) await new Promise(() => {}); // layout.js is already redirecting to /login

const money = makeMoney(user.locale, user.currency);
const PAGE = 200;

let accounts = [];
let groups = [];
let rows = [];
let total = 0;
let loadToken = 0;
const selected = new Set();
const openSplits = new Set();   // split transactions whose parts are shown
const shownSum = { funds: 0, net: 0, inc: 0, exp: 0 };

const params = new URLSearchParams(location.search);
const filters = {
  account: params.get('account') || 'all',
  month: params.get('month') || todayLocal().slice(0, 7),
  type: params.get('type') || 'all',
  category: params.get('category') || 'all',
  cleared: ['yes', 'no'].includes(params.get('cleared')) ? params.get('cleared') : 'all',
  q: params.get('q') || '',
  payee: /^\d+$/.test(params.get('payee') || '') ? params.get('payee') : 'all',
};
let payees = [];

/* ---------- filters ---------- */

function queryString(extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v && v !== 'all') p.set(k, v);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

function syncUrl() {
  const qs = queryString();
  history.replaceState(null, '', qs ? `/transactions?${qs}` : '/transactions');
  $('csvLink').href = '/api/export/transactions.csv' + (qs ? `?${qs}` : '');
}

function fillAccountFilter() {
  const sel = $('fAccount');
  sel.textContent = '';
  sel.append(option('all', 'All accounts'));
  for (const a of accounts) sel.append(option(a.id, a.name + (a.closed ? ' (closed)' : '')));
  sel.value = [...sel.options].some((o) => o.value === String(filters.account)) ? String(filters.account) : 'all';
  filters.account = sel.value;
}

function categoryOptions(select, { first }) {
  select.textContent = '';
  for (const [v, label] of first) select.append(option(v, label));
  for (const g of groups) {
    const og = el('optgroup', { label: g.name });
    for (const c of g.categories) og.append(option(c.id, `${c.icon} ${c.name}`));
    if (og.children.length) select.append(og);
  }
}

async function fillMonths() {
  const { months } = await api('/api/transactions/months');
  const set = new Set(months);
  set.add(todayLocal().slice(0, 7));
  if (/^\d{4}-\d{2}$/.test(filters.month)) set.add(filters.month);
  const sel = $('fMonth');
  sel.textContent = '';
  sel.append(option('all', 'All time'));
  for (const m of [...set].sort().reverse()) sel.append(option(m, monthLabel(m, user.locale)));
  sel.value = [...sel.options].some((o) => o.value === filters.month) ? filters.month : 'all';
  filters.month = sel.value;
}

/* ---------- summary cards ---------- */

function countTo(node, key, to, signed) {
  const from = shownSum[key], start = performance.now(), dur = 600;
  shownSum[key] = to;
  (function step(now) {
    const p = Math.min((now - start) / dur, 1);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    node.textContent = signed ? money.net(v) : money.fmt(v);
    if (p < 1) requestAnimationFrame(step); else node.textContent = signed ? money.net(to) : money.fmt(to);
  })(start);
}

/* ---------- list ---------- */

async function load({ append = false } = {}) {
  const token = ++loadToken;
  $('loading').hidden = false;
  if (!append) { selected.clear(); updateBulk(); }
  const qs = queryString({ limit: PAGE, offset: append ? rows.length : 0 });
  let data;
  try {
    data = await api('/api/transactions?' + qs);
  } catch (err) {
    if (token === loadToken) { $('loading').hidden = true; toast(err.message); }
    return;
  }
  if (token !== loadToken) return; // a newer request superseded this one
  rows = append ? rows.concat(data.transactions) : data.transactions;
  total = data.total;
  countTo($('sInc'), 'inc', data.summary.incomeMinor);
  countTo($('sExp'), 'exp', data.summary.expenseMinor);
  countTo($('sNet'), 'net', data.summary.netMinor, true);
  countTo($('sFunds'), 'funds', data.summary.totalFundsMinor, true);
  $('loading').hidden = true;
  render(append);
}

function groupByDay(list) {
  const out = [];
  for (const t of list) {
    const last = out[out.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else out.push({ date: t.date, items: [t] });
  }
  return out;
}

function rowNode(t, i, animate) {
  const sign = t.amountMinor > 0 ? 'inc' : 'exp';
  const check = el('input', { type: 'checkbox', className: 'tx-check', checked: selected.has(t.id), ariaLabel: 'Select transaction' });
  check.addEventListener('change', () => {
    if (check.checked) selected.add(t.id); else selected.delete(t.id);
    li.classList.toggle('selected', check.checked);
    updateBulk();
  });

  const catText = t.isSplit ? `✂ Split into ${t.splits.length}` : (t.categoryName || 'Uncategorized');
  const sub = [catText, filters.account === 'all' ? t.accountName : null, t.notes].filter(Boolean).join(' • ');
  const edit = el('button', { className: 'del', title: 'Edit', type: 'button', textContent: '✎', ariaLabel: 'Edit transaction' });
  const del = el('button', { className: 'del', title: t.reconciled ? 'Reconciled: unlock it to delete' : 'Delete', type: 'button', textContent: '✕', ariaLabel: 'Delete transaction' });
  edit.onclick = () => editTx(t);
  del.onclick = () => deleteTx(t);

  // Click the circle to mark a transaction cleared / not cleared. A reconciled one is locked (🔒).
  const clearBtn = el('button', {
    type: 'button', className: 'clear-toggle' + (t.cleared ? ' on' : ''), textContent: t.cleared ? '✓' : '',
    title: t.reconciled ? 'Cleared and reconciled (locked)' : (t.cleared ? 'Cleared: click to mark not cleared' : 'Not cleared: click to mark cleared'),
    ariaLabel: t.cleared ? 'Cleared' : 'Not cleared', disabled: t.reconciled,
  });
  clearBtn.setAttribute('aria-pressed', String(t.cleared));
  clearBtn.onclick = async () => {
    clearBtn.disabled = true;
    try {
      await api(`/api/transactions/${t.id}`, { method: 'PATCH', body: { cleared: !t.cleared } });
      await load();
    } catch (err) { toast(err.message); clearBtn.disabled = false; }
  };

  const toggle = t.isSplit
    ? el('button', { type: 'button', className: 'split-toggle', textContent: `${openSplits.has(t.id) ? '▾' : '▸'} ${t.splits.length} parts`, ariaExpanded: String(openSplits.has(t.id)) })
    : null;
  if (toggle) toggle.onclick = () => { if (openSplits.has(t.id)) openSplits.delete(t.id); else openSplits.add(t.id); render(false); };

  const li = el('li', { className: (selected.has(t.id) ? 'selected' : '') + (t.isSplit ? ' has-split' : '') },
    check,
    el('div', { className: 't-left' },
      el('div', { className: 't-ico', textContent: t.isSplit ? '✂️' : (t.categoryIcon || '📦') }),
      el('div', {},
        el('b', { textContent: t.payee || '(no payee)' }),
        clearBtn,
        t.reconciled ? el('span', { className: 'lock-badge', title: 'Reconciled', textContent: '🔒' }) : '',
        el('br'),
        el('small', { textContent: sub }),
        toggle ? ' ' : '', toggle || '')),
    el('div', { className: 't-right' },
      el('span', { className: sign, textContent: money.signed(t.amountMinor) }), edit, del));
  if (t.isSplit && openSplits.has(t.id)) li.append(splitDetail(t));
  li.style.animationDelay = animate ? `${Math.min(i, 10) * 35}ms` : '0ms';
  if (!animate) li.style.animation = 'none';
  return li;
}

/* ---------- split details: view, edit, delete one part ---------- */

function splitDetail(t) {
  const box = el('div', { className: 'split-detail' });
  for (const sp of t.splits) {
    const rm = el('button', { className: 'mini-btn', type: 'button', textContent: '✕', title: 'Delete this part', ariaLabel: `Delete the ${sp.categoryName || 'uncategorized'} part` });
    rm.onclick = () => deleteSplit(t, sp);
    box.append(el('div', { className: 'split-line' },
      el('span', { textContent: sp.categoryIcon || '📦' }),
      el('div', { className: 'grow' }, el('b', { textContent: sp.categoryName || 'Uncategorized' }), sp.notes ? el('small', { textContent: ` • ${sp.notes}` }) : ''),
      el('span', { className: sp.amountMinor > 0 ? 'inc' : 'exp', textContent: money.signed(sp.amountMinor) }), rm));
  }
  const editBtn = el('button', { className: 'small-btn', type: 'button', textContent: '✂ Edit split…' });
  editBtn.onclick = () => editSplits(t);
  const sum = t.splits.reduce((n, x) => n + x.amountMinor, 0);
  box.append(el('div', { className: 'split-foot' }, editBtn,
    el('span', { textContent: `Parts add up to ${money.net(sum)} = the transaction ${money.net(t.amountMinor)}` })));
  return box;
}

function editSplits(t) {
  openSplitEditor({
    groups, totalMinor: t.amountMinor, splits: t.splits, money, title: `Edit split: ${t.payee || 'transaction'}`,
    onSave: async (list) => {
      await api(`/api/transactions/${t.id}/splits`, { method: 'PUT', body: { splits: list } });
      toast('✔ Split saved');
      await refresh();
    },
  });
}

function deleteSplit(t, sp) {
  const label = `${sp.categoryName || 'Uncategorized'} (${money.signed(sp.amountMinor)})`;
  const others = t.splits.filter((x) => x.id !== sp.id);
  if (others.length === 1) {
    confirmModal({
      title: 'Delete this part?',
      message: `Removing ${label} leaves one part, so this becomes a normal ${others[0].categoryName || 'uncategorized'} transaction for the full ${money.signed(t.amountMinor)}. The total never changes.`,
      confirmLabel: 'Delete part',
      onConfirm: async () => {
        await api(`/api/transactions/${t.id}/splits/${sp.id}`, { method: 'DELETE' });
        toast('✔ Part removed. No longer split');
        await refresh();
      },
    });
    return;
  }
  const target = el('select');
  for (const x of others) target.append(option(x.id, `${x.categoryIcon || '📦'} ${x.categoryName || 'Uncategorized'} (${money.signed(x.amountMinor)})`));
  openModal({
    title: 'Delete this part?',
    content: el('div', {},
      el('p', { className: 'modal-text', textContent: `The ${label} part is removed and its amount is added to the part you choose. The transaction total stays ${money.signed(t.amountMinor)}.` }),
      field('Add its amount to', target)),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Delete part', kind: 'danger',
        onClick: async () => {
          await api(`/api/transactions/${t.id}/splits/${sp.id}?moveTo=${target.value}`, { method: 'DELETE' });
          toast('✔ Part removed');
          await refresh();
        },
      },
    ],
  });
}

function render(append) {
  const list = $('list');
  list.textContent = '';
  $('empty').hidden = rows.length > 0;
  $('count').textContent = rows.length ? `Showing ${rows.length} of ${total}` : '';
  let i = 0;
  for (const day of groupByDay(rows)) {
    const net = day.items.reduce((s, t) => s + t.amountMinor, 0);
    const ul = el('ul');
    day.items.forEach((t) => ul.append(rowNode(t, i++, !append)));
    list.append(el('section', { className: 'day' },
      el('div', { className: 'day-head' },
        el('span', { textContent: dayLabel(day.date, user.locale) }),
        el('span', { className: net < 0 ? 'exp' : 'inc', textContent: money.net(net) })),
      ul));
  }
  $('more').hidden = rows.length >= total;
  $('selAll').checked = false;
}

/* ---------- add / edit / delete ---------- */

let addForm;
function buildAddForm() {
  addForm = buildTxFields({ groups, accounts, payees, money }, null, {
    accountId: /^\d+$/.test(filters.account) ? Number(filters.account) : null,
  });
  $('addFields').textContent = '';
  $('addFields').append(addForm.node);
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('addErr').textContent = '';
  let payload;
  try { payload = addForm.read(); } catch (err) { $('addErr').textContent = err.message; return; }
  $('addBtn').disabled = true;
  try {
    const made = await api('/api/transactions', { method: 'POST', body: payload });
    addForm.afterAdd();
    const ran = (made.rulesApplied || []).map((r) => r.name);
    toast((payload.amountMinor > 0 ? '💰 Income added!' : '🧾 Expense added!') + (ran.length ? ` ⚙ Rules: ${ran.join(', ')}` : ''));
    loadPayees();
    // Jump to the month of the new transaction so the person sees it.
    const m = payload.date.slice(0, 7);
    if (filters.month !== 'all' && filters.month !== m) filters.month = m;
    await refresh();
  } catch (err) {
    $('addErr').textContent = err.message;
  } finally {
    $('addBtn').disabled = false;
  }
});

function editTx(t) {
  const f = buildTxFields({ groups, accounts, payees, money }, t);
  openModal({
    title: 'Edit transaction',
    content: f.node,
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save', kind: 'primary',
        onClick: async () => {
          await api(`/api/transactions/${t.id}`, { method: 'PATCH', body: f.read() });
          toast('✔ Saved');
          loadPayees();
          await refresh();
        },
      },
    ],
  });
}

function deleteTx(t) {
  confirmModal({
    title: 'Delete transaction?',
    message: `${t.payee || '(no payee)'}: ${money.signed(t.amountMinor)} on ${t.date}. This cannot be undone.`,
    onConfirm: async () => {
      await api(`/api/transactions/${t.id}`, { method: 'DELETE' });
      toast('🗑 Transaction deleted');
      await refresh();
    },
  });
}

/* ---------- bulk actions ---------- */

function updateBulk() {
  const n = selected.size;
  $('bulkBar').hidden = n === 0;
  $('bulkCount').textContent = `${n} selected`;
}

async function bulk(body, doneMsg) {
  try {
    const r = await api('/api/transactions/bulk', { method: 'POST', body: { ids: [...selected], ...body } });
    toast(`${doneMsg} (${r.affected})` + (r.skippedSplit ? `. ${r.skippedSplit} split transaction${r.skippedSplit === 1 ? ' was' : 's were'} left alone: edit their parts instead` : ''));
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

$('bulkSet').onclick = () => {
  const v = $('bulkCat').value;
  bulk({ action: 'update', changes: { categoryId: v === 'none' ? null : Number(v) } }, '🏷 Category updated');
};
$('bulkClear').onclick = () => bulk({ action: 'update', changes: { cleared: true } }, '✓ Marked cleared');
$('bulkUnclear').onclick = () => bulk({ action: 'update', changes: { cleared: false } }, '○ Marked not cleared');
$('bulkNone').onclick = () => { selected.clear(); render(false); updateBulk(); };
$('bulkDelete').onclick = () => {
  confirmModal({
    title: `Delete ${selected.size} transactions?`,
    message: 'This cannot be undone.',
    onConfirm: async () => {
      const r = await api('/api/transactions/bulk', { method: 'POST', body: { ids: [...selected], action: 'delete' } });
      toast(`🗑 Deleted ${r.affected}`);
      await refresh();
    },
  });
};
$('selAll').addEventListener('change', (e) => {
  for (const t of rows) { if (e.target.checked) selected.add(t.id); else selected.delete(t.id); }
  document.querySelectorAll('#list .tx-check').forEach((c) => { c.checked = e.target.checked; c.closest('li').classList.toggle('selected', e.target.checked); });
  updateBulk();
});

/* ---------- payee suggestions and the payee filter chip ---------- */

async function loadPayees() {
  try { ({ payees } = await api('/api/payees?status=active&limit=1000&sort=usage')); } catch { /* suggestions are optional */ }
}

async function paintPayeeChip() {
  const chip = $('payeeChip');
  chip.hidden = filters.payee === 'all';
  if (chip.hidden) return;
  chip.textContent = '';
  let name = `Payee #${filters.payee}`;
  try { name = (await api(`/api/payees/${filters.payee}`)).payee.name; } catch { /* unknown payee: the list will simply be empty */ }
  const x = el('button', { type: 'button', className: 'mini-btn', textContent: '✕', title: 'Remove payee filter', ariaLabel: 'Remove payee filter' });
  x.onclick = () => { filters.payee = 'all'; syncUrl(); paintPayeeChip(); load(); };
  chip.append('Payee: ', el('b', { textContent: name }), x);
}

/* ---------- wiring ---------- */

async function refresh() {
  await fillMonths();
  syncUrl();
  await load();
}

for (const [id, key] of [['fAccount', 'account'], ['fMonth', 'month'], ['fType', 'type'], ['fCategory', 'category'], ['fCleared', 'cleared']]) {
  $(id).addEventListener('change', () => { filters[key] = $(id).value; syncUrl(); load(); });
}
let searchTimer;
$('fSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { filters.q = $('fSearch').value.trim(); syncUrl(); load(); }, 250);
});
$('more').onclick = () => load({ append: true });

/* ---------- start ---------- */

try {
  [{ accounts }, { groups }] = await Promise.all([api('/api/accounts'), api('/api/categories')]);
} catch (err) {
  toast(err.message);
}
fillAccountFilter();
categoryOptions($('fCategory'), { first: [['all', 'All categories'], ['none', 'Uncategorized']] });
$('fCategory').value = [...$('fCategory').options].some((o) => o.value === String(filters.category)) ? String(filters.category) : 'all';
filters.category = $('fCategory').value;
categoryOptions($('bulkCat'), { first: [['none', 'Uncategorized']] });
$('fCleared').value = filters.cleared;
$('fType').value = ['income', 'expense'].includes(filters.type) ? filters.type : 'all';
filters.type = $('fType').value;
$('fSearch').value = filters.q;
await loadPayees();
buildAddForm();
paintPayeeChip();
await refresh();
