import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, option, todayLocal, monthLabel, openModal, field } from '/js/ui.js';
import { makeMoney, parseMoney, toInput } from '/js/money.js';

const { user } = await ready;
if (!user) await new Promise(() => {}); // layout.js is already redirecting to /login

const money = makeMoney(user.locale, user.currency);
const MONTH_RE = /^(20\d\d)-(0[1-9]|1[0-2])$/;
const thisMonth = () => todayLocal().slice(0, 7);
const addM = (m, n) => {
  const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};
function monthFromPath() {
  const hit = location.pathname.match(/^\/budget\/([^/]+)\/?$/);
  return hit && MONTH_RE.test(hit[1]) ? hit[1] : thisMonth();
}

let month = monthFromPath();
let view = null;
let loadToken = 0;
let structure = '';
let histScope = 'month';
const refs = new Map();        // categoryId -> its DOM nodes (so numbers can change without rebuilding the grid)
const groupRefs = new Map();   // groupId -> total nodes

function readCollapsed() { try { return JSON.parse(localStorage.getItem('sw_budget_collapsed') || '[]'); } catch { return []; } }
const collapsed = new Set(readCollapsed());
function saveCollapsed() { try { localStorage.setItem('sw_budget_collapsed', JSON.stringify([...collapsed])); } catch { /* storage blocked */ } }

/* Saves are sent one after another so quick edits in several rows can never overtake each other. */
let saving = Promise.resolve();
const enqueue = (fn) => { const p = saving.then(fn); saving = p.catch(() => {}); return p; };

const allCats = () => (view ? view.groups.flatMap((g) => g.categories) : []);
const catById = (id) => allCats().find((c) => c.id === id);
const visible = (c) => !c.hidden || c.carryInMinor !== 0 || c.assignedMinor !== 0 || c.activityMinor !== 0 || c.availableMinor !== 0;

/* ================================ loading ================================ */

async function load() {
  const token = ++loadToken;
  try {
    const data = await api(`/api/budget/${month}`);
    if (token !== loadToken) return;
    view = data;
    $('loading').hidden = true;
    draw();
    if ($('histPanel').open) loadHistory();
  } catch (err) {
    if (token === loadToken) { $('loading').hidden = true; toast(err.message); }
  }
}

function goTo(m, { replace = false } = {}) {
  if (!MONTH_RE.test(m)) return;
  month = m;
  const url = `/budget/${m}`;
  if (replace) history.replaceState(null, '', url); else if (location.pathname !== url) history.pushState(null, '', url);
  load();
}
window.addEventListener('popstate', () => { month = monthFromPath(); load(); });

/* ================================ top of the page ================================ */

function fillMonthSelect() {
  const sel = $('monthSel');
  const set = new Set([month]);
  const now = thisMonth();
  for (let i = -18; i <= 12; i++) set.add(addM(now, i));
  sel.textContent = '';
  for (const m of [...set].filter((x) => MONTH_RE.test(x)).sort()) sel.append(option(m, monthLabel(m, user.locale), m === month));
  sel.value = month;
}

function paintTop() {
  const v = view;
  fillMonthSelect();
  $('prevM').disabled = !v.prevMonth;
  $('nextM').disabled = !v.nextMonth;
  $('todayM').disabled = month === thisMonth();

  const tb = v.toBudgetMinor;
  $('sToBudget').textContent = money.net(tb);
  const card = $('tbCard');
  card.classList.toggle('pos', tb > 0);
  card.classList.toggle('zero', tb === 0);
  card.classList.toggle('neg', tb < 0);
  $('sToBudgetHint').textContent = tb > 0 ? 'Ready to assign' : tb === 0 ? 'Every rupee has a job ✓' : 'Overbudgeted: assign less or add income';
  $('sAssigned').textContent = money.fmt(v.assignedMinor);
  $('sActivity').textContent = money.net(v.activityMinor);
  $('sAvailable').textContent = money.net(v.availableMinor);

  // banners
  const box = $('banners');
  box.textContent = '';
  const note = (kind, ...kids) => box.append(el('div', { className: `bd-note ${kind}`, role: kind === 'warn' || kind === 'neg' ? 'alert' : 'status' }, ...kids));
  if (tb < 0) {
    note('neg', el('b', { textContent: `⚠ Overbudgeted by ${money.fmt(-tb)}.` }),
      ' You have assigned more than you have. Lower an Assigned amount, or add income.');
  }
  if (v.overspentCount > 0) {
    note('warn', el('b', { textContent: `⚠ ${v.overspentCount} categor${v.overspentCount === 1 ? 'y is' : 'ies are'} overspent by ${money.fmt(v.overspentMinor)}.` }),
      ' Click the red amount to cover it from another category. Overspending that is not covered comes out of next month\'s To Budget (unless the category rolls it over).');
  }
  if (v.overspentLastMonthMinor > 0) {
    note('info', `Last month's overspending of ${money.fmt(v.overspentLastMonthMinor)} was taken out of this month's To Budget.`);
  }
  if (v.uncategorizedCount > 0) {
    note('info', `${v.uncategorizedCount} transaction${v.uncategorizedCount === 1 ? '' : 's'} with no category (${money.fmt(v.uncategorizedSpendMinor)} spent) came straight out of To Budget. `,
      el('a', { href: `/transactions?month=${month}`, textContent: 'Categorize them' }), ' to take that money from an envelope instead.');
  }

  // how To Budget is worked out
  const rows = $('tbRows');
  rows.textContent = '';
  const line = (label, minor, { sign, strong = false } = {}) => rows.append(el('div', { className: 'tb-line' + (strong ? ' total' : '') },
    el('span', { textContent: label }), el('b', { textContent: (sign || '') + (strong ? money.net(minor) : money.fmt(minor)) })));
  line('Left over from last month', v.rolledFromLastMonthMinor, { sign: v.rolledFromLastMonthMinor < 0 ? '' : '' });
  line('Income this month', v.incomeMinor, { sign: '+ ' });
  if (v.openingBalanceMinor) line('Opening balances (on-budget accounts)', v.openingBalanceMinor, { sign: '+ ' });
  if (v.uncategorizedSpendMinor) line('Spent with no category', v.uncategorizedSpendMinor, { sign: '− ' });
  if (v.overspentLastMonthMinor) line('Overspent last month', v.overspentLastMonthMinor, { sign: '− ' });
  line('Assigned to categories', v.assignedMinor, { sign: '− ' });
  line('To Budget', tb, { strong: true });
}

/* ================================ the grid ================================ */

function signature() {
  return month + '|' + view.groups.map((g) => `${g.id}:${g.name}:${g.hidden}:${collapsed.has(g.id)}:`
    + g.categories.map((c) => `${c.id}.${c.name}.${c.icon}.${visible(c)}`).join(',')).join(';');
}

function draw() {
  paintTop();
  const sig = signature();
  if (sig !== structure) { structure = sig; renderGrid(); } else paintGrid();
}

function paintCat(c, r) {
  if (!r.renaming) r.name.textContent = c.name;
  r.row.classList.toggle('over', c.overspent);
  r.row.classList.toggle('dim', c.hidden);
  r.flag.hidden = !c.carryover;
  if (document.activeElement !== r.input) r.input.value = money.net(c.assignedMinor);
  r.input.setAttribute('aria-label', `Assigned for ${c.name}`);
  r.act.textContent = money.net(c.activityMinor);
  r.act.className = 'act-link' + (c.activityMinor === 0 ? ' zero' : '');
  r.act.href = `/transactions?category=${c.id}&month=${month}`;
  r.act.title = `See ${c.name} transactions in ${monthLabel(month, user.locale)}`;
  r.avail.textContent = (c.overspent ? '⚠ ' : '') + money.net(c.availableMinor);
  r.avail.className = 'avail ' + (c.overspent ? 'neg' : c.availableMinor === 0 ? 'zero' : 'pos');
  const parts = [`Rolled in ${money.net(c.carryInMinor)}`, `Assigned ${money.net(c.assignedMinor)}`, `Activity ${money.net(c.activityMinor)}`];
  r.avail.title = parts.join(' · ') + (c.overspent ? ' — click to cover this overspending' : ' — click to move money');
  r.note.hidden = !c.overspent;
  if (c.overspent) {
    r.note.textContent = `Overspent ${money.fmt(-c.availableMinor)}. ` + (c.carryover ? 'Carries into next month.' : 'Taken from next month\'s To Budget.');
  }
}

function paintGrid() {
  for (const g of view.groups) {
    const t = groupRefs.get(g.id);
    if (t) {
      t.a.textContent = money.net(g.totals.assignedMinor);
      t.t.textContent = money.net(g.totals.activityMinor);
      t.v.textContent = money.net(g.totals.availableMinor);
      const n = g.categories.filter((c) => c.overspent).length;
      t.warn.hidden = n === 0;
      t.warn.textContent = n ? `⚠ ${n} overspent` : '';
    }
    for (const c of g.categories) { const r = refs.get(c.id); if (r) paintCat(c, r); }
  }
}

function renderGrid() {
  const box = $('grid');
  box.textContent = '';
  refs.clear();
  groupRefs.clear();
  const shown = view.groups.filter((g) => !g.hidden || g.categories.some(visible));
  if (!shown.length) box.append(el('p', { className: 'empty', textContent: 'No groups yet. Add one below to start budgeting.' }));
  shown.forEach((g, gi) => box.append(groupNode(g, gi, shown)));
  paintGrid();
}

function groupNode(g, gi, shown) {
  const isCollapsed = collapsed.has(g.id);
  const toggle = el('button', { className: 'mini-btn tgl', type: 'button', textContent: isCollapsed ? '▸' : '▾' });
  toggle.setAttribute('aria-expanded', String(!isCollapsed));
  toggle.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} ${g.name}`);
  toggle.onclick = () => { if (collapsed.has(g.id)) collapsed.delete(g.id); else collapsed.add(g.id); saveCollapsed(); structure = ''; draw(); };

  const up = el('button', { className: 'mini-btn', type: 'button', textContent: '▲', title: 'Move group up', disabled: gi === 0 });
  const down = el('button', { className: 'mini-btn', type: 'button', textContent: '▼', title: 'Move group down', disabled: gi === shown.length - 1 });
  up.setAttribute('aria-label', `Move ${g.name} up`);
  down.setAttribute('aria-label', `Move ${g.name} down`);
  up.onclick = () => nudgeGroup(g, -1);
  down.onclick = () => nudgeGroup(g, 1);
  const edit = el('button', { className: 'mini-btn', type: 'button', textContent: '✎', title: 'Rename or hide group' });
  edit.setAttribute('aria-label', `Edit group ${g.name}`);
  edit.onclick = () => editGroup(g);

  const t = { a: el('div', { className: 'bg-num' }), t: el('div', { className: 'bg-num' }), v: el('div', { className: 'bg-num' }), warn: el('span', { className: 'pill warn' }) };
  groupRefs.set(g.id, t);
  const head = el('div', { className: 'bg-row bg-ghead' },
    el('div', { className: 'bg-name' }, toggle, el('h4', { textContent: g.name }), g.hidden ? el('span', { className: 'pill', textContent: 'Hidden' }) : '', t.warn, el('span', { className: 'g-actions' }, up, down, edit)),
    t.a, t.t, t.v);

  const node = el('section', { className: 'bg-group' }, head);
  if (!isCollapsed) {
    const list = el('div', { className: 'bg-list', dataset: { group: g.id } });
    for (const c of g.categories.filter(visible)) list.append(catRow(g, c));
    wireDrop(list, g.id);
    node.append(list);
    const input = el('input', { type: 'text', maxLength: 40, placeholder: `Add a category to ${g.name}`, autocomplete: 'off' });
    input.setAttribute('aria-label', `New category in ${g.name}`);
    const add = async () => {
      const name = input.value.trim();
      if (!name) return;
      try { await api('/api/categories', { method: 'POST', body: { groupId: g.id, name } }); toast('✔ Category added'); await load(); } catch (err) { toast(err.message); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const btn = el('button', { className: 'small-btn', type: 'button', textContent: 'Add' });
    btn.onclick = add;
    node.append(el('div', { className: 'bg-addcat' }, input, btn));
  }
  return node;
}

function catRow(g, c) {
  const r = { renaming: false };
  r.handle = el('span', { className: 'drag-handle', textContent: '⋮⋮', title: 'Drag to reorder' });
  r.name = el('button', { className: 'name-btn', type: 'button', title: 'Click to rename' });
  r.flag = el('span', { className: 'rollflag', textContent: '↻', title: 'Overspending rolls over into next month' });
  r.more = el('button', { className: 'mini-btn', type: 'button', textContent: '⋯', title: 'Category options' });
  r.note = el('small', { className: 'bg-note' });
  r.input = el('input', { className: 'assign-input', type: 'text', inputMode: 'decimal', autocomplete: 'off' });
  r.act = el('a', { className: 'act-link' });
  r.avail = el('button', { className: 'avail', type: 'button' });
  r.row = el('div', { className: 'bg-row bg-cat', dataset: { id: c.id } },
    el('div', { className: 'bg-name' }, r.handle, el('span', { className: 'ico', textContent: c.icon }),
      el('div', { className: 'nm' }, el('div', { className: 'nm-line' }, r.name, r.flag), r.note), r.more),
    el('div', { className: 'bg-num' }, r.input),
    el('div', { className: 'bg-num' }, r.act),
    el('div', { className: 'bg-num' }, r.avail));
  refs.set(c.id, r);

  // Assigned: type a number, Enter or leave the box to save, Esc to undo.
  r.input.addEventListener('focus', () => { const cur = catById(c.id); r.input.value = toInput(cur.assignedMinor); r.input.select(); });
  r.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); r.input.blur(); }
    else if (e.key === 'Escape') { r.input.value = toInput(catById(c.id).assignedMinor); r.input.blur(); }
  });
  r.input.addEventListener('blur', () => commitAssigned(c.id, r));

  r.avail.onclick = () => { const cur = catById(c.id); if (cur.overspent) openMove({ to: cur }); else openMove({ from: cur }); };
  r.more.onclick = () => openCategory(c.id);
  r.name.onclick = () => startRename(c.id, r);

  // Dragging only starts from the handle, so selecting text in the amount box never drags the row.
  r.handle.addEventListener('mousedown', () => { r.row.draggable = true; });
  r.row.addEventListener('dragstart', (e) => {
    dragId = c.id;
    r.row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(c.id));
  });
  r.row.addEventListener('dragend', () => { dragId = null; r.row.draggable = false; r.row.classList.remove('dragging'); clearLines(); });
  return r.row;
}

async function commitAssigned(id, r) {
  const c = catById(id);
  if (!c) return;
  const text = r.input.value.trim();
  if (text === toInput(c.assignedMinor) || text === money.net(c.assignedMinor)) { paintCat(c, r); return; }
  const minor = text === '' ? 0 : parseMoney(text, { allowNegative: true });
  if (minor === null) { toast('Enter an amount like 1500 or 1,500.50'); paintCat(c, r); return; }
  if (minor === c.assignedMinor) { paintCat(c, r); return; }
  const m = month;
  await enqueue(async () => {
    try {
      const data = await api(`/api/budget/${m}/categories/${id}`, { method: 'PATCH', body: { assignedMinor: minor } });
      if (m === month) { view = data; draw(); }
    } catch (err) {
      toast(err.message);
      const back = catById(id);
      if (back && refs.get(id)) { paintCat(back, refs.get(id)); r.row.classList.add('shake'); setTimeout(() => r.row.classList.remove('shake'), 500); }
    }
  });
}

/* ---------- rename in place ---------- */

function startRename(id, r) {
  const c = catById(id);
  r.renaming = true;
  const input = el('input', { className: 'rename-input', type: 'text', maxLength: 40, value: c.name, autocomplete: 'off' });
  input.setAttribute('aria-label', `Rename ${c.name}`);
  r.name.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const name = input.value.trim();
    r.renaming = false;
    input.replaceWith(r.name);
    if (!save || !name || name === c.name) { paintCat(catById(id), r); return; }
    try { await api(`/api/categories/${id}`, { method: 'PATCH', body: { name } }); toast('✔ Renamed'); await load(); } catch (err) { toast(err.message); paintCat(catById(id), r); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
}

/* ---------- drag to reorder (same behaviour as Settings) ---------- */

let dragId = null;
function clearLines() { document.querySelectorAll('.drop-line').forEach((n) => n.remove()); }
function rowBefore(list, y) {
  return [...list.querySelectorAll('.bg-cat:not(.dragging)')].find((row) => {
    const b = row.getBoundingClientRect();
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
  const moving = catById(id);
  if (!moving) return;
  const next = view.groups.map((g) => ({ id: g.id, cats: g.categories.filter((c) => c.id !== id) }));
  const dest = next.find((g) => g.id === destGroupId);
  let idx = beforeId === null ? dest.cats.length : dest.cats.findIndex((c) => c.id === beforeId);
  if (idx < 0) idx = dest.cats.length;
  dest.cats.splice(idx, 0, moving);
  const items = next.filter((g) => g.id === destGroupId || g.id === moving.groupId)
    .flatMap((g) => g.cats.map((c, i) => ({ id: c.id, groupId: g.id, sortOrder: i })));
  try { await api('/api/categories/reorder', { method: 'POST', body: { items } }); } catch (err) { toast(err.message); }
  await load();
}

async function nudgeCategory(c, dir) {
  const g = view.groups.find((x) => x.id === c.groupId);
  const list = g.categories;
  const i = list.findIndex((x) => x.id === c.id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  // dir -1: go before the neighbour above; dir +1: go before the item two places down (or to the end)
  if (dir < 0) await moveCategory(c.id, g.id, list[j].id);
  else await moveCategory(c.id, g.id, j + 1 < list.length ? list[j + 1].id : null);
}

async function nudgeGroup(g, dir) {
  try {
    const { groups } = await api('/api/categories');
    const ids = groups.map((x) => x.id);
    const order = view.groups.map((x) => x.id);
    const other = order[order.indexOf(g.id) + dir];
    if (other === undefined) return;
    const i = ids.indexOf(g.id), j = ids.indexOf(other);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('/api/category-groups/reorder', { method: 'POST', body: { ids } });
    await load();
  } catch (err) { toast(err.message); }
}

/* ================================ dialogs ================================ */

function openMove({ from = null, to = null } = {}) {
  const cats = allCats().filter(visible);
  if (cats.length < 2) { toast('You need at least two categories to move money between.'); return; }
  const best = cats.filter((c) => (!to || c.id !== to.id) && c.availableMinor > 0).sort((a, b) => b.availableMinor - a.availableMinor)[0];
  const fromCat = from || best || cats.find((c) => !to || c.id !== to.id);
  const toCat = to || cats.find((c) => c.id !== fromCat.id);

  const mk = (sel) => {
    const s = el('select');
    for (const c of cats) s.append(option(c.id, `${c.icon} ${c.name} (${money.net(c.availableMinor)} available)`, c.id === sel.id));
    return s;
  };
  const fromSel = mk(fromCat), toSel = mk(toCat);
  const suggested = to && to.overspent && fromCat.availableMinor > 0 ? Math.min(-to.availableMinor, fromCat.availableMinor) : 0;
  const amount = el('input', { type: 'text', inputMode: 'decimal', autocomplete: 'off', placeholder: '0', value: suggested ? toInput(suggested) : '' });
  const note = el('input', { type: 'text', maxLength: 200, autocomplete: 'off', placeholder: 'Optional, e.g. "cover groceries"' });
  const hint = el('p', { className: 'modal-text' });
  const upd = () => {
    const f = catById(Number(fromSel.value));
    hint.textContent = f ? `${f.name} has ${money.net(f.availableMinor)} available in ${monthLabel(month, user.locale)}.` : '';
  };
  fromSel.onchange = upd; upd();

  const form = el('div', { className: 'fields' },
    field('Move from', fromSel, { full: true }),
    field('Move to', toSel, { full: true }),
    field('Amount', amount, { full: true }),
    field('Note', note, { full: true }));
  openModal({
    title: to && to.overspent ? `Cover ${to.name}` : 'Move money',
    content: el('div', {}, form, hint),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Move money', kind: 'primary',
        onClick: async () => {
          const minor = parseMoney(amount.value);
          if (minor === null || minor <= 0) throw new Error('Enter an amount like 500 or 1,250.50.');
          const f = catById(Number(fromSel.value)), t = catById(Number(toSel.value));
          const r = await api(`/api/budget/${month}/transfers`, {
            method: 'POST', body: { fromCategoryId: Number(fromSel.value), toCategoryId: Number(toSel.value), amountMinor: minor, note: note.value.trim() },
          });
          view = r.budget; draw(); loadHistory();
          toast(`✔ Moved ${money.fmt(minor)} from ${f.name} to ${t.name}`);
        },
      },
    ],
  });
}

function openCategory(id) {
  const c = catById(id);
  const name = el('input', { type: 'text', maxLength: 40, value: c.name, autocomplete: 'off' });
  const roll = el('input', { type: 'checkbox', className: 'tx-check', checked: c.carryover });
  const g = view.groups.find((x) => x.id === c.groupId);
  const i = g.categories.findIndex((x) => x.id === c.id);
  const up = el('button', { className: 'small-btn', type: 'button', textContent: '▲ Move up', disabled: i === 0 });
  const down = el('button', { className: 'small-btn', type: 'button', textContent: '▼ Move down', disabled: i === g.categories.length - 1 });
  let dlg;
  up.onclick = async () => { dlg.close(); await nudgeCategory(c, -1); };
  down.onclick = async () => { dlg.close(); await nudgeCategory(c, 1); };
  const facts = el('dl', { className: 'kv facts' },
    el('dt', { textContent: 'Rolled in from last month' }), el('dd', { textContent: money.net(c.carryInMinor) }),
    el('dt', { textContent: 'Assigned' }), el('dd', { textContent: money.net(c.assignedMinor) }),
    el('dt', { textContent: 'Activity' }), el('dd', { textContent: money.net(c.activityMinor) }),
    el('dt', { textContent: 'Available' }), el('dd', { textContent: money.net(c.availableMinor) }));
  const content = el('div', {},
    field('Name', name, { full: true }),
    facts,
    el('label', { className: 'check roll-check' }, roll, ` Roll over overspending from ${monthLabel(month, user.locale)} onwards`),
    el('p', { className: 'modal-text', textContent: 'Off (default): if this category is overspent at month end, the overspending is taken out of next month\'s To Budget and the category starts again at 0. On: the negative balance stays in this category instead.' }),
    el('div', { className: 'row-btns' }, up, down),
    el('p', { className: 'modal-text' }, 'Icon, hiding and deleting are in ', el('a', { href: '/settings', textContent: 'Settings' }), '.'));
  const m = openModal({
    title: c.icon + ' ' + c.name,
    content,
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save', kind: 'primary',
        onClick: async () => {
          const nm = name.value.trim();
          if (!nm) throw new Error('Name cannot be empty.');
          if (nm !== c.name) await api(`/api/categories/${id}`, { method: 'PATCH', body: { name: nm } });
          if (roll.checked !== c.carryover) await api(`/api/budget/${month}/categories/${id}`, { method: 'PATCH', body: { carryover: roll.checked } });
          toast('✔ Saved');
          await load();
        },
      },
    ],
  });
  dlg = m;
}

function editGroup(g) {
  const name = el('input', { type: 'text', maxLength: 40, value: g.name, autocomplete: 'off' });
  const hidden = el('input', { type: 'checkbox', className: 'tx-check', checked: g.hidden });
  openModal({
    title: 'Edit group',
    content: el('div', {}, field('Name', name, { full: true }),
      el('label', { className: 'check roll-check' }, hidden, ' Hide this group (its money still counts)')),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save', kind: 'primary',
        onClick: async () => {
          const nm = name.value.trim();
          if (!nm) throw new Error('Name cannot be empty.');
          await api(`/api/category-groups/${g.id}`, { method: 'PATCH', body: { name: nm, hidden: hidden.checked } });
          toast('✔ Saved');
          await load();
        },
      },
    ],
  });
}

/* ================================ history ================================ */

async function loadHistory() {
  const box = $('histList');
  try {
    const { transfers } = await api('/api/budget-transfers' + (histScope === 'month' ? `?month=${month}` : ''));
    box.textContent = '';
    if (!transfers.length) {
      box.append(el('p', { className: 'empty', textContent: histScope === 'month' ? 'No money moved between categories in this month.' : 'No money has been moved between categories yet.' }));
      return;
    }
    for (const t of transfers) {
      const when = new Date(t.createdAt).toLocaleString(user.locale, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
      box.append(el('div', { className: 'hist-item' },
        el('div', { className: 'grow' },
          el('b', { textContent: `${t.fromName} → ${t.toName}` }),
          histScope === 'all' ? el('span', { className: 'pill', textContent: monthLabel(t.month, user.locale) }) : '',
          el('br'),
          el('small', { textContent: `${t.fromName}: ${money.net(t.fromAvailableBeforeMinor)} → ${money.net(t.fromAvailableAfterMinor)}  ·  ${t.toName}: ${money.net(t.toAvailableBeforeMinor)} → ${money.net(t.toAvailableAfterMinor)}` }),
          t.note ? el('br') : '', t.note ? el('small', { className: 'hist-note', textContent: `“${t.note}”` }) : '',
          el('br'), el('small', { textContent: when })),
        el('b', { textContent: money.fmt(t.amountMinor) })));
    }
  } catch (err) { box.textContent = ''; box.append(el('p', { className: 'err', textContent: err.message })); }
}

/* ================================ wiring ================================ */

$('prevM').onclick = () => view && view.prevMonth && goTo(view.prevMonth);
$('nextM').onclick = () => view && view.nextMonth && goTo(view.nextMonth);
$('todayM').onclick = () => goTo(thisMonth());
$('monthSel').onchange = (e) => goTo(e.target.value);
$('histPanel').addEventListener('toggle', () => { if ($('histPanel').open) loadHistory(); });
for (const [id, scope] of [['histMonth', 'month'], ['histAll', 'all']]) {
  $(id).onclick = () => {
    histScope = scope;
    $('histMonth').classList.toggle('active', scope === 'month');
    $('histAll').classList.toggle('active', scope === 'all');
    loadHistory();
  };
}
async function addGroup() {
  const input = $('newGroup');
  const name = input.value.trim();
  if (!name) return;
  try { await api('/api/category-groups', { method: 'POST', body: { name } }); input.value = ''; toast('✔ Group added'); await load(); } catch (err) { toast(err.message); }
}
$('addGroupBtn').onclick = addGroup;
$('newGroup').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addGroup(); } });

// /budget, /budget/ and /budget/<invalid> all settle on the month actually being shown.
if (location.pathname !== `/budget/${month}`) goTo(month, { replace: true }); else load();
