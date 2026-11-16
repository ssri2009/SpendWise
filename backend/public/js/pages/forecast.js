import { api } from '/js/api.js';
import { ready, toast } from '/js/layout.js';
import { el, $, option, monthLabel } from '/js/ui.js';
import { makeMoney } from '/js/money.js';
import { mountTabs, dateText, shortDate, pill, relative } from '/js/schedcommon.js';

const { user } = await ready;
if (!user) await new Promise(() => {});
mountTabs('/forecast');

const money = makeMoney(user.locale, user.currency);
let days = 30;
const NS = 'http://www.w3.org/2000/svg';

const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  n.append(...kids);
  return n;
};

/* ---------- the balance chart (plain SVG, no library) ---------- */

function drawChart(timeline) {
  const box = $('fChart');
  box.textContent = '';
  const W = 720, H = 250, L = 64, R = 14, T = 14, B = 30;
  const vals = timeline.map((t) => t.balanceMinor);
  let lo = Math.min(...vals, 0);
  let hi = Math.max(...vals, 0);
  if (lo === hi) { hi += 100; lo -= 100; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x = (i) => L + (timeline.length === 1 ? 0 : (i / (timeline.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  // The balance only changes on event days, so draw it as steps.
  let d = `M ${x(0)} ${y(vals[0])}`;
  for (let i = 1; i < timeline.length; i++) d += ` H ${x(i)} V ${y(vals[i])}`;
  const area = `${d} V ${y(Math.max(lo, Math.min(0, hi)))} H ${x(0)} Z`;

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg',
    'aria-label': `Balance from ${money.net(vals[0])} to ${money.net(vals[vals.length - 1])} over ${timeline.length - 1} days` });
  for (const v of [lo + pad, (lo + hi) / 2, hi - pad]) {
    root.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'chart-grid' }));
    root.append(svg('text', { x: L - 8, y: y(v) + 4, class: 'chart-label', 'text-anchor': 'end' }, money.net(Math.round(v / 100) * 100)));
  }
  if (lo < 0 && hi > 0) root.append(svg('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'chart-zero' }));
  root.append(svg('path', { d: area, class: 'chart-area' }), svg('path', { d, class: 'chart-line' }));
  timeline.forEach((t, i) => {
    if (!t.incomeMinor && !t.expenseMinor) return;
    const dot = svg('circle', { cx: x(i), cy: y(t.balanceMinor), r: 3.5, class: 'chart-dot ' + (t.balanceMinor < 0 ? 'neg' : t.incomeMinor > t.expenseMinor ? 'inc' : 'exp') });
    dot.append(svg('title', {}, `${dateText(t.date, user.locale)}: ${money.net(t.balanceMinor)}`));
    root.append(dot);
  });
  for (const i of [0, Math.floor((timeline.length - 1) / 2), timeline.length - 1]) {
    root.append(svg('text', { x: x(i), y: H - 8, class: 'chart-label', 'text-anchor': i === 0 ? 'start' : i === timeline.length - 1 ? 'end' : 'middle' }, shortDate(timeline[i].date, user.locale)));
  }
  box.append(root);
}

/* ---------- tables ---------- */

function td(text, cls = '') { return el('td', { textContent: text, className: cls }); }

function drawHorizons(horizons) {
  const t = $('fTable');
  t.textContent = '';
  const head = el('tr', {}, el('th', { textContent: '' }), ...horizons.map((h) => el('th', { textContent: `${h.days} days` })));
  const line = (label, fn, cls = () => '') => el('tr', {}, el('th', { scope: 'row', textContent: label }), ...horizons.map((h) => td(fn(h), cls(h))));
  t.append(el('thead', {}, head), el('tbody', {},
    line('Until', (h) => dateText(h.endDate, user.locale)),
    line('Current funds', (h) => money.net(h.currentFundsMinor)),
    line('Upcoming income', (h) => '+' + money.fmt(h.upcomingIncomeMinor), () => 'amt-inc'),
    line('Upcoming expenses', (h) => '−' + money.fmt(h.upcomingExpensesMinor), () => 'amt-exp'),
    line('Estimated balance', (h) => money.net(h.estimatedBalanceMinor), (h) => 'strong ' + (h.estimatedBalanceMinor < 0 ? 'amt-exp' : '')),
    line('Lowest point', (h) => `${money.net(h.lowestBalanceMinor)} on ${shortDate(h.lowestDate, user.locale)}`, (h) => (h.lowestBalanceMinor < 0 ? 'amt-exp' : ''))));
}

function drawImpact(impact) {
  const root = $('fImpact');
  root.textContent = '';
  $('fImpactNote').textContent = impact.months.length
    ? 'How the scheduled money changes each envelope. “Now” is what is available as your ledger stands; “after” adds the schedules, using the same carry-over and overspending rules as your Budget page.'
    : 'No scheduled money lands in your budget in this period.';
  if (impact.offBudgetEvents) {
    root.append(el('p', { className: 'summary-note', textContent: `${impact.offBudgetEvents} scheduled item${impact.offBudgetEvents === 1 ? ' is' : 's are'} in off-budget accounts, so they move your cash but not your envelopes.` }));
  }
  for (const m of impact.months) {
    const rows = m.categories.map((c) => el('tr', {},
      td(`${c.icon} ${c.name}`), td(money.net(c.availableMinor)), td(money.net(c.scheduledMinor), c.scheduledMinor < 0 ? 'amt-exp' : 'amt-inc'),
      td(money.net(c.projectedAvailableMinor), c.overspent ? 'amt-exp strong' : 'strong'),
      el('td', {}, c.overspent ? pill(`short by ${money.fmt(c.shortfallMinor)}`, 'warn') : pill('covered', 'good'))));
    root.append(el('div', { className: 'impact-month' },
      el('h4', { textContent: monthLabel(m.month, user.locale) }),
      el('p', { className: 'summary-note', textContent:
        `To Budget: ${money.net(m.toBudgetMinor)} now → ${money.net(m.projectedToBudgetMinor)} after scheduled money` +
        (m.scheduledIncomeMinor ? ` (income +${money.fmt(m.scheduledIncomeMinor)})` : '') +
        (m.scheduledUncategorizedExpenseMinor ? ` (uncategorized −${money.fmt(m.scheduledUncategorizedExpenseMinor)})` : '') }),
      m.categories.length
        ? el('div', { className: 'table-wrap' }, el('table', { className: 'plain-table' },
          el('thead', {}, el('tr', {}, ...['Category', 'Available now', 'Scheduled', 'Available after', ''].map((h) => el('th', { textContent: h })))),
          el('tbody', {}, ...rows)))
        : ''));
  }
}

function drawEvents(events, today) {
  const list = $('fEvents');
  list.textContent = '';
  $('fEmpty').hidden = events.length > 0;
  for (const e of events) {
    const state = e.state === 'pending' ? pill(e.overdue ? 'waiting, overdue' : 'waiting for approval', 'warn')
      : e.source === 'ledger' ? pill('already entered') : e.mode === 'auto' ? pill('auto') : '';
    list.append(el('div', { className: 'row-item' },
      el('div', { className: 'grow' }, el('b', { textContent: e.name }), state,
        el('br'), el('small', { textContent: [dateText(e.date, user.locale) + ` (${relative(e.date, today)})`, e.accountName, e.categoryName].filter(Boolean).join(' • ') })),
      el('b', { className: e.amountMinor < 0 ? 'amt-exp' : 'amt-inc', textContent: (e.amountMinor < 0 ? '−' : '+') + money.fmt(e.amountMinor) })));
  }
}

/* ---------- load ---------- */

async function load() {
  let f;
  try {
    const q = new URLSearchParams({ days });
    if ($('fAccount').value) q.set('account', $('fAccount').value);
    ({ forecast: f } = await api('/api/forecast?' + q));
  } catch (err) { toast(err.message); return; }
  for (const b of $('fHorizon').children) b.classList.toggle('active', Number(b.dataset.days) === days);

  $('fNow').textContent = money.net(f.currentFundsMinor);
  $('fInc').textContent = '+' + money.fmt(f.upcomingIncomeMinor);
  $('fExp').textContent = '−' + money.fmt(f.upcomingExpensesMinor);
  $('fEst').textContent = money.net(f.estimatedBalanceMinor);
  $('fEst').className = f.estimatedBalanceMinor < 0 ? 'amt-exp' : '';
  $('fIncHint').textContent = `Until ${dateText(f.endDate, user.locale)}`;
  $('fExpHint').textContent = `Until ${dateText(f.endDate, user.locale)}`;
  $('fEstHint').textContent = `Lowest ${money.net(f.lowestBalanceMinor)} on ${shortDate(f.lowestDate, user.locale)}`;
  $('fEstCard').classList.toggle('neg', f.estimatedBalanceMinor < 0);

  const warn = $('fWarn');
  const notes = [];
  if (f.firstNegativeDate) notes.push(`⚠ Your balance is expected to go below zero on ${dateText(f.firstNegativeDate, user.locale)}.`);
  const short = new Set(f.categoryImpact.months.flatMap((m) => m.categories.filter((c) => c.overspent).map((c) => c.name)));
  if (short.size) notes.push(`${short.size} envelope${short.size === 1 ? '' : 's'} (${[...short].join(', ')}) will not cover the scheduled spending (see Budget impact).`);
  if (f.truncated) notes.push('Very many scheduled items: the list was cut short.');
  warn.hidden = notes.length === 0;
  warn.textContent = notes.join(' ');

  drawChart(f.timeline);
  drawHorizons(f.horizons);
  drawImpact(f.categoryImpact);
  drawEvents(f.events, f.asOf);
}

$('fHorizon').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  days = Number(b.dataset.days);
  load();
});
$('fAccount').addEventListener('change', load);

try {
  const { accounts } = await api('/api/accounts');
  $('fAccount').append(option('', 'All accounts', true));
  for (const a of accounts) $('fAccount').append(option(a.id, a.name));
} catch (err) { toast(err.message); }
await load();
