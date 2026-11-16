import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, option, openModal, confirmModal, field } from '/js/ui.js';

const { user } = await ready;
if (!user) await new Promise(() => {}); // layout.js is already redirecting to /login

const PAGE = 100;
let groups = [];
let rows = [];
let total = 0;
let token = 0;
const picked = new Set();

const dateText = (iso) => iso ? new Date(...iso.split('-').map((n, i) => (i === 1 ? n - 1 : +n)))
  .toLocaleDateString(user.locale, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never';

function categorySelect(selectedId) {
  const sel = el('select');
  sel.append(option('', 'None', selectedId == null));
  for (const g of groups) {
    const og = el('optgroup', { label: g.name });
    for (const c of g.categories) og.append(option(c.id, `${c.icon} ${c.name}`, c.id === selectedId));
    if (og.children.length) sel.append(og);
  }
  return sel;
}

/* ---------- list ---------- */

async function load({ append = false } = {}) {
  const mine = ++token;
  $('pLoading').hidden = false;
  const p = new URLSearchParams({ status: $('pStatus').value, sort: $('pSort').value, limit: PAGE, offset: append ? rows.length : 0 });
  const q = $('pSearch').value.trim();
  if (q) p.set('q', q);
  let data;
  try { data = await api('/api/payees?' + p); } catch (err) { if (mine === token) { $('pLoading').hidden = true; toast(err.message); } return; }
  if (mine !== token) return;
  rows = append ? rows.concat(data.payees) : data.payees;
  total = data.total;
  if (!append) picked.clear();
  $('pLoading').hidden = true;
  render();
}

function render() {
  const list = $('pList');
  list.textContent = '';
  $('pEmpty').hidden = rows.length > 0;
  $('pCount').textContent = rows.length ? `Showing ${rows.length} of ${total}` : '';
  $('pMore').hidden = rows.length >= total;
  for (const p of rows) list.append(rowNode(p));
  updateMerge();
}

function rowNode(p) {
  const check = el('input', { type: 'checkbox', className: 'tx-check', checked: picked.has(p.id), ariaLabel: `Select ${p.name}` });
  check.addEventListener('change', () => { if (check.checked) picked.add(p.id); else picked.delete(p.id); updateMerge(); });

  const bits = [
    `${p.usageCount} transaction${p.usageCount === 1 ? '' : 's'}`,
    `last used ${dateText(p.lastUsed)}`,
    p.defaultCategoryName ? `default: ${p.defaultCategoryName}` : null,
    p.ruleCount ? `${p.ruleCount} rule${p.ruleCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' • ');

  const view = el('a', { className: 'small-btn', href: `/transactions?month=all&payee=${p.id}`, textContent: 'View', title: 'Show this payee’s transactions' });
  const edit = el('button', { type: 'button', className: 'small-btn', textContent: 'Edit' });
  const arch = el('button', { type: 'button', className: 'small-btn', textContent: p.archived ? 'Restore' : 'Archive' });
  const del = el('button', { type: 'button', className: 'small-btn danger', textContent: 'Delete' });
  edit.onclick = () => editPayee(p);
  arch.onclick = async () => {
    try { await api(`/api/payees/${p.id}`, { method: 'PATCH', body: { archived: !p.archived } }); toast(p.archived ? '↩ Restored' : '🗄 Archived'); await load(); }
    catch (err) { toast(err.message); }
  };
  del.onclick = () => deletePayee(p);

  return el('div', { className: 'row-item' + (p.archived ? ' dim' : '') },
    check,
    el('div', { className: 'grow' },
      el('b', { textContent: p.name }), p.archived ? el('span', { className: 'pill', textContent: 'archived' }) : '',
      el('br'), el('small', { textContent: bits })),
    el('div', { className: 'actions' }, view, edit, arch, del));
}

function updateMerge() { $('pMerge').disabled = picked.size < 2; $('pMerge').textContent = picked.size > 1 ? `Merge ${picked.size} selected…` : 'Merge selected…'; }

/* ---------- create / edit / delete / merge ---------- */

function payeeForm(p) {
  const name = el('input', { type: 'text', maxLength: 60, value: p ? p.name : '', autocomplete: 'off' });
  const cat = categorySelect(p ? p.defaultCategoryId : null);
  return {
    node: el('div', { className: 'fields' },
      field('Name', name, { full: true }),
      field('Default category', cat, { full: true, hint: 'Pre-fills the category when you add a transaction for this payee. It never changes existing ones.' })),
    read: () => ({ name: name.value.trim(), defaultCategoryId: cat.value ? Number(cat.value) : null }),
  };
}

function newPayee() {
  const f = payeeForm(null);
  openModal({
    title: 'New payee', content: f.node,
    buttons: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Create', kind: 'primary', onClick: async () => {
      await api('/api/payees', { method: 'POST', body: f.read() }); toast('✔ Payee created'); await load();
    } }],
  });
}

function editPayee(p) {
  const f = payeeForm(p);
  openModal({
    title: 'Edit payee', content: f.node,
    buttons: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: async () => {
      await api(`/api/payees/${p.id}`, { method: 'PATCH', body: f.read() }); toast('✔ Saved'); await load();
    } }],
  });
}

function deletePayee(p) {
  const blocked = p.usageCount > 0 || p.ruleCount > 0;
  if (blocked) {
    openModal({
      title: `Can’t delete ${p.name}`,
      content: el('p', { className: 'modal-text', textContent: `It is used by ${p.usageCount} transaction${p.usageCount === 1 ? '' : 's'}${p.ruleCount ? ` and ${p.ruleCount} rule${p.ruleCount === 1 ? '' : 's'}` : ''}. Merge it into another payee, or archive it to hide it from suggestions.` }),
      buttons: [{ label: 'Close', kind: 'ghost' }, { label: 'Archive instead', kind: 'primary', onClick: async () => {
        await api(`/api/payees/${p.id}`, { method: 'PATCH', body: { archived: true } }); toast('🗄 Archived'); await load();
      } }],
    });
    return;
  }
  confirmModal({ title: 'Delete payee?', message: `“${p.name}” is not used anywhere. This cannot be undone.`, onConfirm: async () => {
    await api(`/api/payees/${p.id}`, { method: 'DELETE' }); toast('🗑 Payee deleted'); await load();
  } });
}

function mergeSelected() {
  const chosen = rows.filter((p) => picked.has(p.id));
  if (chosen.length < 2) return;
  const target = el('select');
  chosen.forEach((p, i) => target.append(option(p.id, `${p.name} (${p.usageCount})`, i === 0)));
  openModal({
    title: `Merge ${chosen.length} payees`,
    content: el('div', {},
      el('p', { className: 'modal-text', textContent: 'All their transactions and rules move to the payee you keep. The others are removed. This cannot be undone.' }),
      field('Keep this payee', target)),
    buttons: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Merge', kind: 'danger', onClick: async () => {
      const keep = Number(target.value);
      let moved = 0;
      for (const p of chosen) if (p.id !== keep) moved += (await api(`/api/payees/${p.id}/merge`, { method: 'POST', body: { targetId: keep } })).moved;
      toast(`🔀 Merged, ${moved} transaction${moved === 1 ? '' : 's'} moved`); await load();
    } }],
  });
}

/* ---------- wiring ---------- */

let timer;
$('pSearch').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
$('pStatus').addEventListener('change', () => load());
$('pSort').addEventListener('change', () => load());
$('pMore').onclick = () => load({ append: true });
$('pAdd').onclick = newPayee;
$('pMerge').onclick = mergeSelected;

try { ({ groups } = await api('/api/categories')); } catch (err) { toast(err.message); }
await load();
