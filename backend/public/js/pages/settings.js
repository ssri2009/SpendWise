import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, field, option, openModal, confirmModal } from '/js/ui.js';
import { makeMoney, parseMoney, toInput } from '/js/money.js';

const { user } = await ready;
if (!user) await new Promise(() => {}); // layout.js is already redirecting to /login

const money = makeMoney(user.locale, user.currency);
const TYPES = [['checking', 'Checking'], ['savings', 'Savings'], ['cash', 'Cash'], ['credit', 'Credit card'],
  ['investment', 'Investment'], ['loan', 'Loan'], ['other', 'Other']];
const typeLabel = (t) => (TYPES.find((x) => x[0] === t) || [, t])[1];
const EMOJI = ['🍕', '🍔', '🛒', '☕', '🍽️', '🥗', '🚌', '🚗', '⛽', '✈️', '🏨', '🏠', '💡', '🧾', '📱', '🌐', '🎬', '🎮', '🎵', '📚',
  '🛍️', '👕', '💄', '💊', '🏥', '🏋️', '🐶', '🎁', '👶', '🎓', '💼', '💰', '💵', '📈', '🏦', '🔧', '🧹', '🎉', '❤️', '📦'];

let accounts = [];
let totalFundsMinor = 0;
let groups = [];

const pill = (text, warn = false) => el('span', { className: 'pill' + (warn ? ' warn' : ''), textContent: text });
const allCategories = () => groups.flatMap((g) => g.categories);

/* =========================== Accounts =========================== */

function renderAccounts() {
  const box = $('accounts');
  box.textContent = '';
  for (const a of accounts) {
    const edit = el('button', { className: 'small-btn', type: 'button', textContent: '✎ Edit' });
    const del = el('button', { className: 'small-btn danger', type: 'button', textContent: '🗑' });
    del.title = 'Delete account';
    edit.onclick = () => editAccount(a);
    del.onclick = () => deleteAccount(a);
    box.append(el('div', { className: 'row-item' },
      el('div', { className: 'grow' },
        el('b', { textContent: a.name }),
        a.offbudget ? pill('Off budget') : '',
        a.closed ? pill('Closed', true) : '',
        el('br'),
        el('small', { textContent: `${typeLabel(a.type)} • ${a.transactionCount} transaction${a.transactionCount === 1 ? '' : 's'}` })),
      el('b', { className: a.balanceMinor < 0 ? 'exp' : '', textContent: money.net(a.balanceMinor) }),
      el('div', { className: 'actions' },
        el('a', { className: 'small-btn', href: `/transactions?account=${a.id}&month=all`, textContent: 'View' }),
        a.closed ? '' : el('a', { className: 'small-btn', href: `/reconcile?account=${a.id}`, textContent: '✔ Reconcile' }), edit, del)));
  }
  if (accounts.length) {
    box.append(el('div', { className: 'row-item total-row' },
      el('div', { className: 'grow' },
        el('b', { textContent: 'Total Funds' }), el('br'),
        el('small', { textContent: 'Sum of all accounts above (same figure as on the Transactions page)' })),
      el('b', { id: 'totalFunds', className: totalFundsMinor < 0 ? 'exp' : '', textContent: money.net(totalFundsMinor) })));
  }
  const sel = $('importAccount');
  sel.textContent = '';
  for (const a of accounts.filter((x) => !x.closed)) sel.append(option(a.id, a.name));
}

async function loadAccounts() {
  ({ accounts, totalFundsMinor } = await api('/api/accounts'));
  renderAccounts();
}

function typeSelect(value) {
  const s = el('select');
  for (const [v, l] of TYPES) s.append(option(v, l, v === value));
  return s;
}

$('accType').append(...TYPES.map(([v, l]) => option(v, l)));

$('addAccount').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('accErr').textContent = '';
  const opening = $('accOpen').value.trim() === '' ? 0 : parseMoney($('accOpen').value, { allowNegative: true });
  if (opening === null) { $('accErr').textContent = 'Opening balance should look like 25000 or 1,250.50.'; return; }
  try {
    await api('/api/accounts', {
      method: 'POST',
      body: { name: $('accName').value, type: $('accType').value, offbudget: $('accOff').checked, openingBalanceMinor: opening },
    });
    $('accName').value = ''; $('accOpen').value = ''; $('accOff').checked = false;
    toast('✔ Account added');
    await loadAccounts();
  } catch (err) {
    $('accErr').textContent = err.message;
  }
});

function editAccount(a) {
  const name = el('input', { type: 'text', maxLength: 40, value: a.name });
  const type = typeSelect(a.type);
  const opening = el('input', { type: 'text', inputMode: 'decimal', value: toInput(a.openingBalanceMinor) });
  const off = el('input', { type: 'checkbox', className: 'tx-check', checked: a.offbudget });
  const closed = el('input', { type: 'checkbox', className: 'tx-check', checked: a.closed });
  openModal({
    title: 'Edit account',
    content: el('div', { className: 'fields' },
      field('Name', name, { full: true }),
      field('Type', type),
      field('Opening balance', opening),
      el('label', { className: 'check full' }, off, ' Off budget (e.g. investments, not part of your monthly budget)'),
      el('label', { className: 'check full' }, closed, ' Closed (hidden from new transactions, history kept)')),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save', kind: 'primary',
        onClick: async () => {
          const ob = opening.value.trim() === '' ? 0 : parseMoney(opening.value, { allowNegative: true });
          if (ob === null) throw new Error('Opening balance should look like 25000 or 1,250.50.');
          await api(`/api/accounts/${a.id}`, {
            method: 'PATCH',
            body: { name: name.value, type: type.value, offbudget: off.checked, closed: closed.checked, openingBalanceMinor: ob },
          });
          toast('✔ Saved');
          await loadAccounts();
        },
      },
    ],
  });
}

function deleteAccount(a) {
  confirmModal({
    title: `Delete "${a.name}"?`,
    message: a.transactionCount
      ? `It has ${a.transactionCount} transaction(s), so it can't be deleted. Edit it and tick "Closed" instead.`
      : 'This cannot be undone.',
    onConfirm: async () => {
      await api(`/api/accounts/${a.id}`, { method: 'DELETE' });
      toast('🗑 Account deleted');
      await loadAccounts();
    },
  });
}

/* =========================== Categories =========================== */

let dragId = null;

function clearLines() { document.querySelectorAll('.drop-line').forEach((n) => n.remove()); }

function rowBefore(list, y) {
  return [...list.querySelectorAll('.cat-row:not(.dragging)')].find((r) => {
    const b = r.getBoundingClientRect();
    return y < b.top + b.height / 2;
  }) || null;
}

function wireDrop(list, groupId) {
  list.addEventListener('dragover', (e) => {
    if (dragId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearLines();
    const before = rowBefore(list, e.clientY);
    const line = el('div', { className: 'drop-line' });
    if (before) list.insertBefore(line, before); else list.append(line);
  });
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) clearLines(); });
  list.addEventListener('drop', (e) => {
    if (dragId === null) return;
    e.preventDefault();
    const before = rowBefore(list, e.clientY);
    clearLines();
    moveCategory(dragId, groupId, before ? Number(before.dataset.id) : null);
  });
}

/** Put category `id` into group `destGroupId`, just before category `beforeId` (null = at the end). */
async function moveCategory(id, destGroupId, beforeId) {
  const moving = allCategories().find((c) => c.id === id);
  const next = groups.map((g) => ({ id: g.id, cats: g.categories.filter((c) => c.id !== id) }));
  const dest = next.find((g) => g.id === destGroupId);
  let idx = beforeId === null ? dest.cats.length : dest.cats.findIndex((c) => c.id === beforeId);
  if (idx < 0) idx = dest.cats.length;
  dest.cats.splice(idx, 0, moving);
  const items = next
    .filter((g) => g.id === destGroupId || g.id === moving.groupId)
    .flatMap((g) => g.cats.map((c, i) => ({ id: c.id, groupId: g.id, sortOrder: i })));
  try {
    ({ groups } = await api('/api/categories/reorder', { method: 'POST', body: { items } }));
  } catch (err) {
    toast(err.message);
  }
  renderCategories();
}

function categoryRow(g, c, i) {
  const up = el('button', { className: 'mini-btn', type: 'button', textContent: '▲', title: 'Move up', disabled: i === 0 });
  const down = el('button', { className: 'mini-btn', type: 'button', textContent: '▼', title: 'Move down', disabled: i === g.categories.length - 1 });
  up.setAttribute('aria-label', `Move ${c.name} up`);
  down.setAttribute('aria-label', `Move ${c.name} down`);
  up.onclick = () => moveCategory(c.id, g.id, g.categories[i - 1].id);
  down.onclick = () => moveCategory(c.id, g.id, i + 2 < g.categories.length ? g.categories[i + 2].id : null);
  const edit = el('button', { className: 'mini-btn', type: 'button', textContent: '✎ Edit' });
  edit.onclick = () => editCategory(c);

  const row = el('div', { className: 'cat-row' + (c.hidden ? ' hidden-cat' : ''), draggable: true, dataset: { id: c.id } },
    el('span', { className: 'drag-handle', textContent: '⋮⋮', title: 'Drag to reorder' }),
    el('div', { className: 't-ico', textContent: c.icon }),
    el('div', { className: 'grow' },
      el('b', { textContent: c.name }), c.hidden ? pill('Hidden') : '',
      el('br'),
      el('small', { textContent: `${c.transactionCount} transaction${c.transactionCount === 1 ? '' : 's'}` })),
    up, down, edit);
  row.addEventListener('dragstart', (e) => {
    dragId = c.id;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(c.id));
  });
  row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); clearLines(); });
  return row;
}

function renderCategories() {
  const box = $('categories');
  box.textContent = '';
  for (const g of groups) {
    const list = el('div', { className: 'cat-list', dataset: { group: g.id } });
    g.categories.forEach((c, i) => list.append(categoryRow(g, c, i)));
    wireDrop(list, g.id);

    const editGroupBtn = el('button', { className: 'mini-btn', type: 'button', textContent: '✎ Edit group' });
    editGroupBtn.onclick = () => editGroup(g);

    const input = el('input', { type: 'text', maxLength: 40, placeholder: `Add a category to ${g.name}`, autocomplete: 'off' });
    input.setAttribute('aria-label', `New category in ${g.name}`);
    const addBtn = el('button', { className: 'small-btn', type: 'button', textContent: 'Add' });
    const add = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        ({ groups } = await api('/api/categories', { method: 'POST', body: { groupId: g.id, name } }));
        toast('✔ Category added');
        renderCategories();
      } catch (err) { toast(err.message); }
    };
    addBtn.onclick = add;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

    box.append(el('div', { className: 'cat-group' },
      el('div', { className: 'cat-group-head' },
        el('h4', {}, g.name, g.isIncome ? pill('Income') : '', g.hidden ? pill('Hidden') : ''), editGroupBtn),
      list,
      el('div', { className: 'inline-form' }, input, addBtn)));
  }
}

function editCategory(c) {
  const icon = el('input', { type: 'text', maxLength: 16, value: c.icon, autocomplete: 'off' });
  const name = el('input', { type: 'text', maxLength: 40, value: c.name, autocomplete: 'off' });
  const group = el('select');
  for (const g of groups) group.append(option(g.id, g.name, g.id === c.groupId));
  const hidden = el('input', { type: 'checkbox', className: 'tx-check', checked: c.hidden });
  const palette = el('div', { className: 'palette' });
  for (const emo of EMOJI) {
    const b = el('button', { type: 'button', textContent: emo, title: emo });
    b.onclick = () => { icon.value = emo; };
    palette.append(b);
  }
  const dlg = openModal({
    title: 'Edit category',
    content: el('div', { className: 'fields' },
      field('Icon', icon), field('Name', name),
      el('div', { className: 'full' }, palette),
      field('Group', group, { full: true }),
      el('label', { className: 'check full' }, hidden, ' Hide from pickers (history is kept)')),
    buttons: [
      { label: 'Delete…', kind: 'warn', onClick: () => deleteCategory(c) },
      { label: 'Merge into…', kind: 'ghost', onClick: () => mergeCategory(c) },
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save', kind: 'primary',
        onClick: async () => {
          ({ groups } = await api(`/api/categories/${c.id}`, {
            method: 'PATCH',
            body: { name: name.value, icon: icon.value, groupId: Number(group.value), hidden: hidden.checked },
          }));
          toast('✔ Saved');
          renderCategories();
        },
      },
    ],
  });
  name.focus();
  name.select();
  return dlg;
}

function mergeCategory(c) {
  const target = el('select');
  for (const g of groups) {
    const og = el('optgroup', { label: g.name });
    for (const o of g.categories) if (o.id !== c.id) og.append(option(o.id, `${o.icon} ${o.name}`));
    if (og.children.length) target.append(og);
  }
  if (!target.options.length) { toast('There is no other category to merge into.'); return; }
  openModal({
    title: `Merge "${c.name}"`,
    content: el('div', {},
      el('p', { className: 'modal-text', textContent: `All ${c.transactionCount} transaction(s) in "${c.name}" move to the category you pick, then "${c.name}" is removed.` }),
      field('Merge into', target)),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Merge', kind: 'primary',
        onClick: async () => {
          ({ groups } = await api(`/api/categories/${c.id}/merge`, { method: 'POST', body: { targetId: Number(target.value) } }));
          toast('✔ Merged');
          renderCategories();
        },
      },
    ],
  });
}

function deleteCategory(c) {
  const dest = el('select');
  dest.append(option('none', 'Uncategorized'));
  for (const g of groups) {
    const og = el('optgroup', { label: g.name });
    for (const o of g.categories) if (o.id !== c.id) og.append(option(o.id, `${o.icon} ${o.name}`));
    if (og.children.length) dest.append(og);
  }
  const used = c.transactionCount > 0;
  openModal({
    title: `Delete "${c.name}"?`,
    content: el('div', {},
      el('p', {
        className: 'modal-text',
        textContent: used ? `${c.transactionCount} transaction(s) use this category. Where should they go?` : 'No transactions use it. This cannot be undone.',
      }),
      used ? field('Move them to', dest) : ''),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Delete category', kind: 'danger',
        onClick: async () => {
          const q = used ? `?moveTo=${encodeURIComponent(dest.value)}` : '';
          ({ groups } = await api(`/api/categories/${c.id}${q}`, { method: 'DELETE' }));
          toast('🗑 Category deleted');
          renderCategories();
        },
      },
    ],
  });
}

function editGroup(g) {
  const name = el('input', { type: 'text', maxLength: 40, value: g.name, autocomplete: 'off' });
  const hidden = el('input', { type: 'checkbox', className: 'tx-check', checked: g.hidden });
  openModal({
    title: 'Edit group',
    content: el('div', { className: 'fields' },
      field('Name', name, { full: true }),
      el('label', { className: 'check full' }, hidden, ' Hide this group')),
    buttons: [
      {
        label: 'Delete group', kind: 'warn',
        onClick: async () => {
          ({ groups } = await api(`/api/category-groups/${g.id}`, { method: 'DELETE' }));
          toast('🗑 Group deleted');
          renderCategories();
        },
      },
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save', kind: 'primary',
        onClick: async () => {
          ({ groups } = await api(`/api/category-groups/${g.id}`, { method: 'PATCH', body: { name: name.value, hidden: hidden.checked } }));
          toast('✔ Saved');
          renderCategories();
        },
      },
    ],
  });
  name.focus();
}

$('addGroup').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    ({ groups } = await api('/api/category-groups', { method: 'POST', body: { name: $('grpName').value, isIncome: $('grpIncome').checked } }));
    $('grpName').value = ''; $('grpIncome').checked = false;
    toast('✔ Group added');
    renderCategories();
  } catch (err) { toast(err.message); }
});

/* =========================== Import =========================== */

function showImport(text, bad = false, linkToTx = false) {
  const box = $('importResult');
  box.hidden = false;
  box.textContent = '';
  box.append(text);
  box.classList.toggle('err', bad);
  if (linkToTx) box.append(' ', el('a', { href: '/transactions?month=all', textContent: 'View them →' }));
}

$('importBtn').onclick = () => $('importFile').click();
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // so the same file can be chosen again
  if (!file) return;
  if (file.size > 2.9 * 1024 * 1024) return showImport('That file is too big to be a SpendWise backup.', true);
  let data;
  try { data = JSON.parse(await file.text()); } catch { return showImport('That file is not a SpendWise backup.', true); }
  try {
    const r = await api('/api/import/spendwise-backup', { method: 'POST', body: { accountId: Number($('importAccount').value), data, applyRules: $('importRules').checked } });
    const extra = [
      r.duplicates && `${r.duplicates} already here`,
      r.invalid && `${r.invalid} invalid`,
      r.rulesApplied && `rules changed ${r.rulesApplied}`,
      r.truncated && `${r.truncated} over the 5,000 limit were skipped`,
    ].filter(Boolean).join(', ');
    showImport(r.added
      ? `📥 Imported ${r.added} transaction${r.added === 1 ? '' : 's'}${extra ? ` (${extra})` : ''}.`
      : `Nothing new to import${extra ? ` (${extra})` : ''}.`, false, r.added > 0);
    await Promise.all([loadAccounts(), loadGroups()]);
  } catch (err) {
    showImport(err.message, true);
  }
});

/* =========================== start =========================== */

async function loadGroups() {
  ({ groups } = await api('/api/categories'));
  renderCategories();
}

try {
  await Promise.all([loadAccounts(), loadGroups()]);
} catch (err) {
  toast(err.message);
}
