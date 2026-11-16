import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, option, openModal, confirmModal, field, monthLabel } from '/js/ui.js';
import { makeMoney, parseMoney, toInput } from '/js/money.js';

const { user } = await ready;
if (!user) await new Promise(() => {}); // layout.js is already redirecting to /login

const money = makeMoney(user.locale, user.currency);
let rules = [];
let maxRules = 200;
let payees = [];
let groups = [];
let accounts = [];

const payeeName = (id) => (payees.find((p) => p.id === id) || {}).name || 'a deleted payee';
const accountName = (id) => (accounts.find((a) => a.id === id) || {}).name || 'a deleted account';
const catName = (id) => { for (const g of groups) { const c = g.categories.find((x) => x.id === id); if (c) return `${c.icon} ${c.name}`; } return 'a deleted category'; };
const dirText = { any: '', expense: ' (expenses)', income: ' (income)' };

const describeCond = (c) => ({
  description_contains: () => `description contains “${c.value}”`,
  payee_equals: () => `payee is ${payeeName(c.payeeId)}`,
  amount_gt: () => `amount > ${money.fmt(c.valueMinor)}${dirText[c.direction] || ''}`,
  amount_lt: () => `amount < ${money.fmt(c.valueMinor)}${dirText[c.direction] || ''}`,
  account_equals: () => `account is ${accountName(c.accountId)}`,
}[c.type] || (() => c.type))();
const describeAct = (a) => ({
  set_category: () => `set category ${catName(a.categoryId)}`,
  set_payee: () => `set payee ${payeeName(a.payeeId)}`,
  add_note: () => `add note “${a.text}”`,
  mark_cleared: () => 'mark cleared',
}[a.type] || (() => a.type))();

/* ================================ list ================================ */

async function load() {
  try {
    const d = await api('/api/rules');
    rules = d.rules; maxRules = d.maxRules;
  } catch (err) { toast(err.message); }
  $('rLoading').hidden = true;
  render();
}

function render() {
  const list = $('rList');
  list.textContent = '';
  $('rEmpty').hidden = rules.length > 0;
  $('rCount').textContent = rules.length ? `${rules.length} of ${maxRules} rules, running in this order` : '';
  $('rAdd').disabled = rules.length >= maxRules;
  $('rReapply').disabled = !rules.some((r) => r.enabled);
  rules.forEach((r, i) => list.append(ruleNode(r, i)));
}

async function saveOrder(ids) {
  try {
    ({ rules } = await api('/api/rules/reorder', { method: 'POST', body: { ids } }));
  } catch (err) { toast(err.message); await load(); return; }
  render();
}

let dragId = null;
function ruleNode(r, i) {
  const toggle = el('input', { type: 'checkbox', className: 'tx-check', checked: r.enabled, ariaLabel: `Enable ${r.name}`, title: r.enabled ? 'Enabled' : 'Disabled' });
  toggle.onchange = async () => {
    try { await api(`/api/rules/${r.id}`, { method: 'PATCH', body: { enabled: toggle.checked } }); toast(toggle.checked ? '✔ Rule enabled' : '⏸ Rule disabled'); }
    catch (err) { toast(err.message); }
    await load();
  };
  const up = el('button', { type: 'button', className: 'mini-btn', textContent: '▲', title: 'Move up', ariaLabel: 'Move up', disabled: i === 0 });
  const down = el('button', { type: 'button', className: 'mini-btn', textContent: '▼', title: 'Move down', ariaLabel: 'Move down', disabled: i === rules.length - 1 });
  const move = (d) => { const ids = rules.map((x) => x.id); [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; saveOrder(ids); };
  up.onclick = () => move(-1);
  down.onclick = () => move(1);

  const edit = el('button', { type: 'button', className: 'small-btn', textContent: 'Edit' });
  const del = el('button', { type: 'button', className: 'small-btn danger', textContent: 'Delete' });
  edit.onclick = () => editRule(r);
  del.onclick = () => confirmModal({ title: 'Delete rule?', message: `“${r.name}” will stop running. Transactions it already changed stay as they are.`, onConfirm: async () => {
    await api(`/api/rules/${r.id}`, { method: 'DELETE' }); toast('🗑 Rule deleted'); await load();
  } });

  const when = r.conditions.map(describeCond).join(r.matchMode === 'any' ? '  OR  ' : '  AND  ');
  const then = r.actions.map(describeAct).join(', ');
  const body = el('div', { className: 'grow' },
    el('b', { textContent: r.name }),
    r.stopAfter ? el('span', { className: 'pill', textContent: 'stops after' }) : '',
    ...r.problems.map((p) => el('span', { className: 'pill warn', textContent: '⚠ ' + p })),
    el('br'),
    el('small', { textContent: `If ${when}` }), el('br'),
    el('small', { textContent: `Then ${then}` }));

  const row = el('div', { className: 'row-item rule-row' + (r.enabled ? '' : ' dim'), draggable: true },
    el('span', { className: 'drag-handle', textContent: '⠿', title: 'Drag to reorder' }),
    el('span', { className: 'rule-pos', textContent: String(r.position) }),
    toggle, body, el('div', { className: 'actions' }, up, down, edit, del));

  row.addEventListener('dragstart', (e) => { dragId = r.id; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(r.id)); } catch { /* ok */ } });
  row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); document.querySelectorAll('.rule-row.over').forEach((n) => n.classList.remove('over')); });
  row.addEventListener('dragover', (e) => { if (dragId !== null && dragId !== r.id) { e.preventDefault(); row.classList.add('over'); } });
  row.addEventListener('dragleave', () => row.classList.remove('over'));
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    row.classList.remove('over');
    if (dragId === null || dragId === r.id) return;
    const ids = rules.map((x) => x.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(r.id) + (rules.findIndex((x) => x.id === dragId) < i ? 1 : 0), 0, dragId);
    saveOrder(ids);
  });
  return row;
}

/* ================================ editor ================================ */

const COND_TYPES = [
  ['description_contains', 'Description contains'],
  ['payee_equals', 'Payee is'],
  ['amount_gt', 'Amount is greater than'],
  ['amount_lt', 'Amount is less than'],
  ['account_equals', 'Account is'],
];
const ACT_TYPES = [
  ['set_category', 'Set category'],
  ['set_payee', 'Set payee'],
  ['add_note', 'Add note'],
  ['mark_cleared', 'Mark cleared'],
];

function simpleSelect(items, selected) {
  const s = el('select');
  for (const [v, l] of items) s.append(option(v, l, String(v) === String(selected)));
  return s;
}
const CHOOSE = ['', 'Choose…'];
const payeeSelect = (sel) => simpleSelect([...(sel ? [] : [CHOOSE]), ...payees.filter((p) => !p.archived || p.id === sel).map((p) => [p.id, p.name + (p.archived ? ' (archived)' : '')])], sel);
const accountSelect = (sel) => simpleSelect(accounts.map((a) => [a.id, a.name + (a.closed ? ' (closed)' : '')]), sel);
function categorySelect(sel) {
  const s = el('select');
  if (!sel) s.append(option('', 'Choose…', true));
  for (const g of groups) {
    const og = el('optgroup', { label: g.name });
    for (const c of g.categories) og.append(option(c.id, `${c.icon} ${c.name}`, c.id === sel));
    if (og.children.length) s.append(og);
  }
  return s;
}

/** One editable line. `types` = the kind choices; `build(type, initial)` returns { node, read() } for the kind's value inputs. */
function lineEditor(types, build, initial, onRemove) {
  const typeSel = simpleSelect(types, initial ? initial.type : types[0][0]);
  const slot = el('div', { className: 'line-slot' });
  const remove = el('button', { type: 'button', className: 'mini-btn', textContent: '✕', title: 'Remove', ariaLabel: 'Remove' });
  let part;
  const paint = (init) => { part = build(typeSel.value, init); slot.textContent = ''; slot.append(part.node); };
  typeSel.onchange = () => paint(null);
  paint(initial);
  const node = el('div', { className: 'line' }, typeSel, slot, remove);
  remove.onclick = () => onRemove(node);
  return { node, read: () => ({ type: typeSel.value, ...part.read() }) };
}

function buildCondition(type, init) {
  if (type === 'description_contains') {
    const t = el('input', { type: 'text', maxLength: 100, placeholder: 'e.g. swiggy', value: init ? init.value || '' : '' });
    return { node: t, read: () => { if (!t.value.trim()) throw new Error('Enter the text to look for.'); return { value: t.value.trim() }; } };
  }
  if (type === 'payee_equals') {
    const s = payeeSelect(init && init.payeeId);
    return { node: s, read: () => { if (!s.value) throw new Error('Pick a payee (create it on the Payees page first).'); return { payeeId: Number(s.value) }; } };
  }
  if (type === 'account_equals') {
    const s = accountSelect(init && init.accountId);
    return { node: s, read: () => ({ accountId: Number(s.value) }) };
  }
  const amt = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00', value: init && init.valueMinor !== undefined ? toInput(init.valueMinor) : '' });
  const dir = simpleSelect([['any', 'any amount'], ['expense', 'expenses only'], ['income', 'income only']], init ? init.direction : 'any');
  return {
    node: el('div', { className: 'amt-pair' }, amt, dir),
    read: () => { const m = parseMoney(amt.value); if (m === null) throw new Error('Enter an amount like 500 or 500.50.'); return { valueMinor: m, direction: dir.value }; },
  };
}

function buildAction(type, init) {
  if (type === 'set_category') {
    const s = categorySelect(init && init.categoryId);
    return { node: s, read: () => { if (!s.value) throw new Error('Pick a category.'); return { categoryId: Number(s.value) }; } };
  }
  if (type === 'set_payee') {
    const s = payeeSelect(init && init.payeeId);
    return { node: s, read: () => { if (!s.value) throw new Error('Pick a payee (create it on the Payees page first).'); return { payeeId: Number(s.value) }; } };
  }
  if (type === 'add_note') {
    const t = el('input', { type: 'text', maxLength: 200, placeholder: 'Note text', value: init ? init.text || '' : '' });
    return { node: t, read: () => { if (!t.value.trim()) throw new Error('Enter the note text.'); return { text: t.value.trim() }; } };
  }
  return { node: el('small', { className: 'muted', textContent: 'The transaction is marked cleared.' }), read: () => ({}) };
}

function editRule(existing) {
  const r = existing || { name: '', matchMode: 'all', stopAfter: false, conditions: [], actions: [] };
  const name = el('input', { type: 'text', maxLength: 60, value: r.name, placeholder: 'e.g. Swiggy is food', autocomplete: 'off' });
  const mode = simpleSelect([['all', 'ALL of these are true'], ['any', 'ANY of these is true']], r.matchMode);
  const stop = el('input', { type: 'checkbox', checked: !!r.stopAfter });
  const condBox = el('div', { className: 'lines' });
  const actBox = el('div', { className: 'lines' });
  const conds = [];
  const acts = [];
  const add = (box, list, types, build, init, max) => {
    if (list.length >= max) return;
    const ed = lineEditor(types, build, init, (node) => { list.splice(list.indexOf(ed), 1); node.remove(); });
    list.push(ed); box.append(ed.node);
  };
  const addCond = (init) => add(condBox, conds, COND_TYPES, buildCondition, init, 10);
  const addAct = (init) => add(actBox, acts, ACT_TYPES, buildAction, init, 10);
  (r.conditions.length ? r.conditions : [null]).forEach(addCond);
  (r.actions.length ? r.actions : [null]).forEach(addAct);
  const moreC = el('button', { type: 'button', className: 'small-btn', textContent: '+ Condition' });
  const moreA = el('button', { type: 'button', className: 'small-btn', textContent: '+ Action' });
  moreC.onclick = () => addCond(null);
  moreA.onclick = () => addAct(null);

  const content = el('div', { className: 'rule-editor' },
    field('Rule name', name),
    el('h4', { textContent: 'When' }), field('Match', mode), condBox, moreC,
    el('h4', { textContent: 'Then' }), actBox, moreA,
    el('label', { className: 'check roll-check' }, stop, ' Stop after this rule (later rules will not run if this one matches)'));

  openModal({
    title: existing ? 'Edit rule' : 'New rule', content,
    buttons: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: async () => {
      const body = {
        name: name.value.trim(), matchMode: mode.value, stopAfter: stop.checked,
        conditions: conds.map((c) => c.read()), actions: acts.map((a) => a.read()),
      };
      if (!body.name) throw new Error('Give the rule a name.');
      if (!body.conditions.length) throw new Error('Add at least one condition.');
      if (!body.actions.length) throw new Error('Add at least one action.');
      if (existing) await api(`/api/rules/${existing.id}`, { method: 'PATCH', body });
      else await api('/api/rules', { method: 'POST', body });
      toast('✔ Rule saved');
      await load();
    } }],
  });
}

/* ============================ re-apply to existing ============================ */

async function reapply() {
  let months = [];
  try { ({ months } = await api('/api/transactions/months')); } catch { /* the picker just offers "all time" */ }
  const month = simpleSelect([['all', 'All time'], ...months.map((m) => [m, monthLabel(m, user.locale)])], 'all');
  const acct = simpleSelect([['', 'All accounts'], ...accounts.map((a) => [a.id, a.name])], '');
  const only = el('input', { type: 'checkbox' });
  const out = el('div', { className: 'reapply-out' });
  const previewBtn = el('button', { type: 'button', className: 'small-btn', textContent: '👁 Preview changes' });
  const applyBtn = el('button', { type: 'button', className: 'btn btn-danger btn-sm', textContent: 'Apply these changes', hidden: true });

  const scope = () => {
    const b = { month: month.value };
    if (acct.value) b.accountId = Number(acct.value);
    if (only.checked) b.onlyUncategorized = true;
    return b;
  };
  let seen = '';
  const reset = () => { applyBtn.hidden = true; out.textContent = ''; seen = ''; };
  for (const n of [month, acct, only]) n.addEventListener('change', reset);

  previewBtn.onclick = async () => {
    previewBtn.disabled = true; out.textContent = '';
    try {
      const r = await api('/api/rules/reprocess', { method: 'POST', body: { ...scope(), dryRun: true } });
      seen = JSON.stringify(scope());
      out.append(el('p', { className: 'modal-text', textContent: `Checked ${r.scanned} transaction${r.scanned === 1 ? '' : 's'}; ${r.changed} would change.${r.truncated ? ' (Only the first 5,000 were checked. Narrow it by month or account.)' : ''} Nothing has been changed yet.` }));
      for (const s of r.samples) {
        const diff = ['payee', 'category', 'notes', 'cleared'].filter((k) => s.before[k] !== s.after[k])
          .map((k) => `${k}: ${String(s.before[k] === '' ? '—' : s.before[k])} → ${String(s.after[k] === '' ? '—' : s.after[k])}`);
        out.append(el('div', { className: 'sample' }, el('small', { textContent: `#${s.id} • ${s.rules.join(', ')}` }), el('br'), diff.join('  •  ')));
      }
      if (r.changed > 50) out.append(el('small', { className: 'muted', textContent: `…and ${r.changed - 50} more.` }));
      applyBtn.hidden = r.changed === 0;
      applyBtn.textContent = `Apply to ${r.changed} transaction${r.changed === 1 ? '' : 's'}`;
    } catch (err) { out.append(el('p', { className: 'err', textContent: err.message })); }
    finally { previewBtn.disabled = false; }
  };
  applyBtn.onclick = async () => {
    if (seen !== JSON.stringify(scope())) { reset(); return; }
    applyBtn.disabled = true;
    try {
      const r = await api('/api/rules/reprocess', { method: 'POST', body: { ...scope(), dryRun: false } });
      out.textContent = '';
      out.append(el('p', { className: 'modal-text', textContent: `✔ Done. ${r.changed} transaction${r.changed === 1 ? '' : 's'} updated.` }));
      applyBtn.hidden = true;
      toast(`♻ ${r.changed} updated`);
    } catch (err) { out.append(el('p', { className: 'err', textContent: err.message })); }
    finally { applyBtn.disabled = false; }
  };

  openModal({
    title: 'Re-apply rules to existing transactions',
    content: el('div', {},
      el('p', { className: 'modal-text', textContent: 'Runs your enabled rules, in order, on transactions you already have. Preview first: nothing changes until you press Apply.' }),
      el('div', { className: 'fields' }, field('Month', month), field('Account', acct)),
      el('label', { className: 'check roll-check' }, only, ' Only transactions without a category'),
      el('div', { className: 'row-btns' }, previewBtn, applyBtn), out),
    buttons: [{ label: 'Close', kind: 'ghost' }],
  });
}

/* ================================ wiring ================================ */

$('rAdd').onclick = () => editRule(null);
$('rReapply').onclick = reapply;

try {
  [{ payees }, { groups }, { accounts }] = await Promise.all([
    api('/api/payees?status=all&limit=1000&sort=name'), api('/api/categories'), api('/api/accounts'),
  ]);
} catch (err) { toast(err.message); }
await load();
