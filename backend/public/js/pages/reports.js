// Reports page shell: tabs, one filter row above everything, CSV download. The screens themselves are in reports-views.js.
//   Tabs are links to #overview, #spending, ... so the back button and bookmarks work.
//   Filters scope everything below them; a reload keeps the frame (the old numbers fade) instead of blanking the page.
import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, option, field } from '/js/ui.js';
import { makeMoney } from '/js/money.js';
import { TABS, VIEWS } from '/js/pages/reports-views.js';

const { user } = await ready;
if (!user) await new Promise(() => {});
const money = makeMoney(user.locale, user.currency);

const RANGES = [
  ['this-month', 'This month'], ['last-month', 'Last month'], ['last-3-months', 'Last 3 months'], ['last-6-months', 'Last 6 months'],
  ['last-12-months', 'Last 12 months'], ['this-year', 'This year'], ['last-year', 'Last year'], ['all', 'All time'], ['custom', 'Custom dates'],
];
const STORE = 'sw_reports_v1';
const SAVED_KEYS = ['range', 'from', 'to', 'gran', 'scope', 'exclude', 'nwMonths'];

const state = { range: 'last-12-months', from: '', to: '', gran: 'month', account: 'all', scope: 'all', exclude: [], month: '', category: null, nwMonths: '12' };
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
  for (const k of SAVED_KEYS) if (saved[k] !== undefined && typeof saved[k] === typeof state[k]) state[k] = saved[k];
  if (!RANGES.some(([v]) => v === state.range)) state.range = 'last-12-months';
} catch { /* storage blocked: filters just start fresh each visit */ }
const persist = () => {
  try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(SAVED_KEYS.map((k) => [k, state[k]])))); } catch { /* ignore */ }
};

/* ------------------------------ talking to the API ------------------------------ */

/** The filter row as a query string. `extra` adds or replaces parameters for one screen (a category, a month, ...). */
function query(extra = {}) {
  const q = new URLSearchParams();
  q.set('range', state.range);
  if (state.range === 'custom') { if (state.from) q.set('from', state.from); if (state.to) q.set('to', state.to); }
  q.set('granularity', state.gran);
  if (state.account !== 'all') q.set('account', state.account);
  if (state.scope !== 'all') q.set('offbudget', state.scope);
  if (state.exclude.length) q.set('exclude', state.exclude.join(','));
  for (const [k, v] of Object.entries(extra)) { if (v === null || v === undefined || v === '') q.delete(k); else q.set(k, v); }
  return q;
}

const ctx = {
  user, money, state,
  get: async (kind, extra) => api(`/api/reports/${kind}?${query(extra)}`),
  getRaw: async (kind, qs) => api(`/api/reports/${kind}${qs ? '?' + qs : ''}`),
  setState: (patch) => { Object.assign(state, patch); render(); },
  go: (tab, patch = {}) => { Object.assign(state, patch); location.hash = tab; },
};

/* ------------------------------ controls ------------------------------ */

const form = $('rpFilters');
const controls = {};
const catalog = { accounts: [], groups: [] };

function buildControls() {
  const sel = (id, label, options, onChange) => {
    const s = el('select', { id });
    for (const [v, t] of options) s.append(option(v, t));
    s.onchange = () => onChange(s.value);
    const f = field(label, s);
    controls[id] = { node: f, input: s };
    form.append(f);
    return s;
  };
  sel('f-range', 'Period', RANGES, (v) => { state.range = v; persist(); render(); });
  const from = el('input', { id: 'f-from', type: 'date' });
  const to = el('input', { id: 'f-to', type: 'date' });
  from.onchange = () => { state.from = from.value; persist(); if (state.range === 'custom') render(); };
  to.onchange = () => { state.to = to.value; persist(); if (state.range === 'custom') render(); };
  const ff = field('From', from), ft = field('To', to);
  controls['f-from'] = { node: ff, input: from }; controls['f-to'] = { node: ft, input: to };
  form.append(ff, ft);
  sel('f-gran', 'Group by', [['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly']], (v) => { state.gran = v; persist(); render(); });
  sel('f-account', 'Account', [['all', 'All accounts']], (v) => { state.account = v; render(); });
  sel('f-scope', 'Accounts counted', [['all', 'All accounts'], ['no', 'On-budget only'], ['yes', 'Off-budget only']], (v) => { state.scope = v; persist(); render(); });

  // "Leave out": categories to take out of the numbers (for example a Transfers category)
  const pop = el('div', { className: 'pop' });
  const summary = el('summary', { id: 'f-exclude-sum' });
  const det = el('details', { className: 'filter-pop' }, summary, pop);
  const exWrap = el('div', { className: 'field' }, el('label', { textContent: 'Leave out' }), det);
  controls['f-exclude'] = { node: exWrap, input: det, summary, pop };
  form.append(exWrap);

  const month = el('select', { id: 'f-month' });
  month.onchange = () => { state.month = month.value; render(); };
  const fm = field('Month', month);
  controls['f-month'] = { node: fm, input: month };
  form.append(fm);
  sel('f-nw', 'History', [['6', 'Last 6 months'], ['12', 'Last 12 months'], ['24', 'Last 2 years'], ['60', 'Last 5 years'], ['all', 'Since the start']], (v) => { state.nwMonths = v; persist(); render(); });

  form.append(el('span', { className: 'spacer' }));
  const csv = el('a', { className: 'small-btn', id: 'csvLink', textContent: '⬇ Download CSV', href: '#' });
  csv.setAttribute('download', '');
  form.append(csv);
  controls.csv = csv;
  document.addEventListener('click', (e) => { if (!e.target.closest('.filter-pop')) det.open = false; });
}

function fillExclude() {
  const { pop } = controls['f-exclude'];
  pop.textContent = '';
  pop.append(el('small', { textContent: 'Tick a category to take it out of the numbers, for example Transfers.' }));
  const box = (value, text) => {
    const cb = el('input', { type: 'checkbox', className: 'tx-check', checked: state.exclude.includes(value) });
    cb.onchange = () => {
      state.exclude = cb.checked ? [...new Set([...state.exclude, value])] : state.exclude.filter((x) => x !== value);
      persist(); updateExcludeSummary(); render();
    };
    return el('label', { className: 'check' }, cb, text);
  };
  pop.append(box('none', '📦 Uncategorized'));
  for (const g of catalog.groups) {
    if (!g.categories.length) continue;
    pop.append(el('h4', { textContent: g.name }));
    for (const c of g.categories) pop.append(box(String(c.id), `${c.icon} ${c.name}`));
  }
  updateExcludeSummary();
}
function updateExcludeSummary() {
  controls['f-exclude'].summary.textContent = state.exclude.length ? `Leave out: ${state.exclude.length} categor${state.exclude.length === 1 ? 'y' : 'ies'}` : 'Leave out: nothing';
}

function fillMonths() {
  const sel = controls['f-month'].input;
  sel.textContent = '';
  sel.append(option('', 'This month'));
  const now = new Date();
  for (let i = 1; i <= 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    sel.append(option(key, d.toLocaleDateString(user.locale, { month: 'long', year: 'numeric' })));
  }
}

function syncControls(view, tab) {
  const show = new Set(view.controls);
  const visible = {
    'f-range': show.has('range'), 'f-from': show.has('range') && state.range === 'custom', 'f-to': show.has('range') && state.range === 'custom',
    'f-gran': show.has('gran'), 'f-account': show.has('account'), 'f-scope': show.has('scope'), 'f-exclude': show.has('exclude'),
    'f-month': show.has('month'), 'f-nw': show.has('nwMonths'),
  };
  for (const [id, on] of Object.entries(visible)) controls[id].node.hidden = !on;
  form.hidden = !view.controls.length;
  controls['f-range'].input.value = state.range;
  controls['f-from'].input.value = state.from; controls['f-to'].input.value = state.to;
  controls['f-gran'].input.value = state.gran;
  controls['f-account'].input.value = state.account;
  controls['f-scope'].input.value = state.scope;
  controls['f-month'].input.value = state.month;
  controls['f-nw'].input.value = state.nwMonths;
  const csv = controls.csv;
  csv.hidden = !view.csv;
  if (view.csv) {
    const extra = tab === 'monthly' ? { month: state.month } : tab === 'networth' ? { months: state.nwMonths } : tab === 'categories' && state.category ? { category: state.category } : {};
    const q = tab === 'networth' ? new URLSearchParams(extra) : tab === 'monthly' ? (() => { const m = query(extra); for (const k of ['range', 'from', 'to', 'granularity']) m.delete(k); return m; })() : query(extra);
    q.set('format', 'csv');
    csv.href = `/api/reports/${view.csv}?${q}`;
  }
}

/* ------------------------------ tabs and rendering ------------------------------ */

const tabsNav = $('rpTabs');
for (const [id, label] of TABS) tabsNav.append(el('a', { href: `#${id}`, textContent: label, dataset: { tab: id } }));
const currentTab = () => { const h = location.hash.slice(1); return VIEWS[h] ? h : 'overview'; };

const body = $('rpBody');
let seq = 0;
async function render() {
  const tab = currentTab();
  const view = VIEWS[tab];
  for (const a of tabsNav.children) { const on = a.dataset.tab === tab; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  document.title = `${TABS.find((t) => t[0] === tab)[1]} · Reports · SpendWise`;
  syncControls(view, tab);
  if (tab !== 'categories') state.category = null;
  const mine = ++seq;
  body.classList.add('loading');
  try {
    const node = await view.build(ctx);
    if (mine !== seq) return;                        // a newer request has started: drop this answer
    body.textContent = '';
    body.append(node);
    syncControls(view, tab);                          // the CSV link now knows the selected category
  } catch (err) {
    if (mine !== seq) return;
    body.textContent = '';
    body.append(el('section', { className: 'panel' }, el('h3', { textContent: 'Could not build this report' }), el('p', { className: 'empty-note', textContent: err.message })));
    toast(err.message);
  } finally {
    if (mine === seq) body.classList.remove('loading');
  }
}

buildControls();
fillMonths();
try {
  const [a, c] = await Promise.all([api('/api/accounts'), api('/api/categories')]);
  catalog.groups = c.groups;
  const sel = controls['f-account'].input;
  for (const x of a.accounts) sel.append(option(x.id, x.name + (x.closed ? ' (closed)' : '')));
  fillExclude();
} catch (err) { toast(err.message); }
window.addEventListener('hashchange', render);
await render();
