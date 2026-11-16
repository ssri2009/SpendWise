// The eight report screens. Each one fetches its numbers from /api/reports/*, builds a detached element and hands it back;
// reports.js puts it on the page. No innerHTML anywhere: every name, payee and category goes in with textContent.
import { el } from '/js/ui.js';
import { timeChart, rankedBars, doughnut, dataTable } from '/js/charts.js';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GRAN_NAME = { month: 'month', quarter: 'quarter', year: 'year' };

/* ------------------------------ small building blocks ------------------------------ */

const panel = (title, ...kids) => el('section', { className: 'panel' }, el('h3', { textContent: title }), ...kids);
const note = (text) => el('p', { className: 'note', textContent: text });
const stack = (...kids) => el('div', { className: 'rp-stack' }, ...kids.filter(Boolean));
const grid = (...kids) => el('div', { className: 'rp-grid' }, ...kids);
const empty = (text, href, linkText) => el('p', { className: 'empty-note' }, text, href ? ' ' : '', href ? el('a', { href, textContent: linkText }) : '');

/** Dates as text in the user's own locale. Parsed by hand so the time zone can never shift the day. */
function dateText(iso, locale, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, opts);
}

/** "▲ ₹2,200 (4.4%)": the arrow and sign carry the meaning, colour only backs it up. */
function delta(money, change, pct, { upGood = true, suffix = '' } = {}) {
  if (change === null || change === undefined) return el('span');
  const cls = change === 0 ? 'flat' : (change > 0) === upGood ? 'good' : 'bad';
  const arrow = change === 0 ? '■' : change > 0 ? '▲' : '▼';
  const pctPart = pct === null || pct === undefined ? '' : ` (${Math.abs(pct)}%)`;
  return el('span', { className: `delta ${cls}`, textContent: `${arrow} ${money.fmt(Math.abs(change))}${pctPart}${suffix ? ' ' + suffix : ''}` });
}

function kpi(label, value, { cls = 'bal', hint, extra } = {}) {
  const card = el('div', { className: `s-card rp-kpi ${cls}` }, el('small', { textContent: label }), el('h3', { textContent: value }));
  if (hint) card.append(el('span', { className: 'hint', textContent: hint }));
  if (extra) card.append(extra);
  return card;
}
const kpis = (...cards) => el('section', { className: 'summary four' }, ...cards);

function table(headers, rows, { totals, onPick, picked } = {}) {
  const t = el('table', { className: 'plain-table' });
  t.append(el('thead', {}, el('tr', {}, ...headers.map((h, i) => el('th', { scope: 'col', textContent: h, className: i ? 'num' : '' })))));
  const body = el('tbody');
  for (const r of rows) {
    const tr = el('tr', { className: (onPick ? 'pick ' : '') + (r.dim ? 'dim ' : '') + (picked && picked === r.id ? 'on' : '') });
    if (onPick) { tr.tabIndex = 0; tr.onclick = () => onPick(r.id); tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(r.id); } }; }
    r.cells.forEach((c, i) => {
      const cell = el(i ? 'td' : 'th', { className: i ? 'num' : '' });
      if (i === 0) cell.scope = 'row';
      cell.append(c instanceof Node ? c : document.createTextNode(String(c)));
      tr.append(cell);
    });
    body.append(tr);
  }
  if (totals) {
    body.append(el('tr', { className: 'total-line' }, ...totals.map((c, i) => el(i ? 'td' : 'th', { className: i ? 'num' : '', textContent: String(c) }))));
  }
  t.append(body);
  return el('div', { className: 'table-wrap' }, t);
}

const periodText = (ctx, p) => `${dateText(p.from, ctx.user.locale)} to ${dateText(p.to, ctx.user.locale)}`;
const shortMonth = (key) => `${SHORT_MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

function barSeries(name, values, color = 'var(--viz-1)') { return { name, kind: 'bar', values, color }; }

/* ------------------------------ overview ------------------------------ */

async function overview(ctx) {
  const [m, cf, nw, ins] = await Promise.all([
    ctx.getRaw('monthly-summary', ''), ctx.getRaw('cashflow', 'range=last-6-months&granularity=month'),
    ctx.getRaw('net-worth', 'months=12'), ctx.getRaw('insights', ''),
  ]);
  const { money, user } = ctx;
  const cmp = `vs ${m.comparedWith.label}${m.comparedWith.sameDays ? ' so far' : ''}`;
  const monthName = shortMonth(m.month);

  const insightList = el('div', { className: 'insight-list' });
  for (const i of ins.insights) {
    const mark = i.level === 'warn' ? 'Watch' : i.level === 'good' ? 'Good' : 'Note';
    insightList.append(el('div', { className: `insight ${i.level}` }, el('span', { className: 'mark', textContent: mark }),
      el('div', {}, el('b', { textContent: i.title }), el('p', { textContent: i.detail }), el('a', { href: i.link, textContent: 'See the detail →' }))));
  }

  const top = m.topCategories.map((c) => ({ label: c.name, icon: c.icon, value: c.amountMinor, sub: `${c.sharePct}% of spending`, onClick: () => ctx.go('categories', { category: c.categoryId === null ? 'none' : c.categoryId }) }));
  const topHost = el('div');
  rankedBars(topHost, top, { money, empty: 'No spending yet this month.' });
  const flowHost = el('div');
  timeChart(flowHost, {
    labels: cf.periods.map((p) => p.label), money, locale: user.locale, currency: user.currency, aria: 'Income and expenses for each of the last six months',
    series: [barSeries('Income', cf.periods.map((p) => p.incomeMinor), 'var(--viz-1)'), barSeries('Expenses', cf.periods.map((p) => p.expensesMinor), 'var(--viz-2)')],
  });

  return stack(
    el('p', { className: 'rp-lead', textContent: `${monthName} so far, across all your accounts. Use the tabs for detail and filters.` }),
    kpis(
      kpi('Income', money.fmt(m.incomeMinor), { cls: 'inc', extra: delta(money, m.changes.incomeMinor, m.changes.incomePct, { upGood: true, suffix: cmp }) }),
      kpi('Expenses', money.fmt(m.expensesMinor), { cls: 'exp', extra: delta(money, m.changes.expensesMinor, m.changes.expensesPct, { upGood: false, suffix: cmp }) }),
      kpi('Net cash flow', money.net(m.netMinor), { cls: 'net', hint: m.savingsRatePct === null ? 'No income yet' : `You kept ${m.savingsRatePct}% of your income` }),
      kpi('Net worth', money.net(nw.current.netWorthMinor), { extra: delta(money, nw.change.sinceLastMonthEndMinor, null, { upGood: true, suffix: 'since last month end' }) }),
    ),
    panel('💡 Insights', insightList.childElementCount ? insightList : empty('Nothing to report yet.')),
    grid(panel('Last 6 months', flowHost), panel(`Where ${monthName} is going`, topHost)),
  );
}

/* ------------------------------ spending ------------------------------ */

async function spending(ctx) {
  const r = await ctx.get('spending');
  const { money, user } = ctx;
  if (!r.transactionCount && !r.totalMinor) {
    return stack(panel('Spending', empty('No spending in this period. Pick a longer period, or', '/transactions', 'add a transaction.')));
  }
  const overHost = el('div');
  timeChart(overHost, {
    labels: r.overTime.map((p) => p.label), money, locale: user.locale, currency: user.currency, aria: `Spending for each ${GRAN_NAME[r.granularity]}`,
    series: [barSeries('Spending', r.overTime.map((p) => p.amountMinor))],
  });
  const rows = (list, extra = () => ({})) => list.slice(0, 10).map((c) => ({ label: c.name, icon: c.icon, value: c.amountMinor, sub: `${c.count} transaction${c.count === 1 ? '' : 's'} · ${c.sharePct}%`, ...extra(c) }));
  const catHost = el('div'); rankedBars(catHost, rows(r.byCategory, (c) => ({ onClick: () => ctx.go('categories', { category: c.categoryId === null ? 'none' : c.categoryId }) })), { money });
  const payHost = el('div'); rankedBars(payHost, rows(r.byPayee.map((p) => ({ ...p, icon: undefined }))), { money, color: 'var(--viz-1)' });
  const accHost = el('div'); rankedBars(accHost, rows(r.byAccount.map((p) => ({ ...p, icon: undefined }))), { money });
  const donutHost = el('div');
  doughnut(donutHost, r.byCategory.map((c) => ({ label: c.name, value: c.amountMinor })), { money, centerLabel: 'Spent', aria: 'Share of spending by category' });
  const big = el('div', { className: 'row-list' });
  for (const b of r.biggest) {
    big.append(el('div', { className: 'row-item' }, el('div', { className: 'grow' }, el('b', { textContent: b.payee }), el('br'),
      el('small', { textContent: `${dateText(b.date, user.locale)} • ${b.category} • ${b.account}` })), el('b', { className: 'amt-exp', textContent: '−' + money.fmt(b.amountMinor) })));
  }
  return stack(
    el('p', { className: 'rp-lead', textContent: `${periodText(ctx, r.period)}. Refunds are taken off the category they belong to, and a split transaction is counted in each of its parts.` }),
    kpis(
      kpi('Total spent', money.fmt(r.totalMinor), { cls: 'exp', hint: `${r.transactionCount} transaction${r.transactionCount === 1 ? '' : 's'}` }),
      kpi('Average per day', money.fmt(r.averagePerDayMinor)),
      kpi(`Average per ${GRAN_NAME[r.granularity]}`, money.fmt(r.averagePerPeriodMinor)),
      kpi(r.highest ? `Highest: ${r.highest.label}` : 'Highest', r.highest ? money.fmt(r.highest.amountMinor) : '—'),
    ),
    panel(`📈 Spending over time (by ${GRAN_NAME[r.granularity]})`, overHost),
    grid(panel('🥧 Share by category', donutHost), panel('By category', note('Select a category for its own report.'), catHost)),
    grid(panel('By payee', payHost), panel('By account', accHost)),
    r.biggest.length ? panel('Biggest expenses', big) : null,
  );
}

/* ------------------------------ income ------------------------------ */

async function income(ctx) {
  const r = await ctx.get('income');
  const { money, user } = ctx;
  if (!r.transactionCount && !r.totalMinor && !r.yearly.some((y) => y.incomeMinor)) {
    return stack(panel('Income', empty('No income in this period. Pick a longer period, or', '/transactions', 'add some.')));
  }
  const trendWord = { up: '▲ Rising', down: '▼ Falling', flat: '■ Steady' }[r.trend.direction];
  const overHost = el('div');
  timeChart(overHost, {
    labels: r.overTime.map((p) => p.label), money, locale: user.locale, currency: user.currency, aria: `Income for each ${GRAN_NAME[r.granularity]}`,
    series: [barSeries('Income', r.overTime.map((p) => p.amountMinor))],
  });
  const srcHost = el('div'); rankedBars(srcHost, r.sources.slice(0, 10).map((s) => ({ label: s.name, value: s.amountMinor, sub: `${s.count} deposit${s.count === 1 ? '' : 's'} · ${s.sharePct}%` })), { money });
  const catHost = el('div'); rankedBars(catHost, r.byCategory.slice(0, 10).map((s) => ({ label: s.name, icon: s.icon, value: s.amountMinor, sub: `${s.sharePct}%` })), { money });

  const pctCell = (p, upGood = true) => (p === null ? '' : el('span', { className: `delta ${p === 0 ? 'flat' : (p > 0) === upGood ? 'good' : 'bad'}`, textContent: `${p > 0 ? '▲' : p < 0 ? '▼' : '■'} ${Math.abs(p)}%` }));
  const monthRows = [...r.monthly].reverse().map((m) => ({
    cells: [m.partial ? `${m.label} (so far)` : m.label, money.fmt(m.incomeMinor), m.changeMinor === null ? '' : (m.changeMinor < 0 ? '−' : '+') + money.fmt(m.changeMinor), pctCell(m.changePct)],
  }));
  const yearHost = el('div');
  timeChart(yearHost, {
    labels: r.yearly.map((y) => (y.partial ? `${y.year} so far` : String(y.year))), money, locale: user.locale, currency: user.currency, aria: 'Income for each year',
    series: [barSeries('Income', r.yearly.map((y) => y.incomeMinor), 'var(--viz-1)')], table: false,
  });
  const cur = r.yearly[r.yearly.length - 1];
  const yearRows = [...r.yearly].reverse().map((y) => ({
    cells: [y.partial ? `${y.year} (so far)` : String(y.year), money.fmt(y.incomeMinor), y.changeMinor === null ? '' : (y.changeMinor < 0 ? '−' : '+') + money.fmt(y.changeMinor), pctCell(y.changePct)],
  }));
  const sameNote = cur && cur.previousSamePeriodMinor !== undefined && r.yearly.length > 1
    ? `This year so far is ${money.fmt(cur.incomeMinor)}. At the same point last year it was ${money.fmt(cur.previousSamePeriodMinor)}${cur.samePeriodChangePct === null ? '' : ` (${cur.samePeriodChangePct > 0 ? '+' : '−'}${Math.abs(cur.samePeriodChangePct)}%)`}.`
    : '';

  return stack(
    el('p', { className: 'rp-lead', textContent: `${periodText(ctx, r.period)}. Income is money into an Income category, plus any uncategorised deposit.` }),
    kpis(
      kpi('Total income', money.fmt(r.totalMinor), { cls: 'inc', hint: `${r.transactionCount} deposit${r.transactionCount === 1 ? '' : 's'}` }),
      kpi(`Average per ${GRAN_NAME[r.granularity]}`, money.fmt(r.averagePerPeriodMinor)),
      kpi('Trend', trendWord, { hint: r.trend.changePct === null ? 'Needs at least 4 periods' : `Second half vs first half: ${r.trend.changePct > 0 ? '+' : r.trend.changePct < 0 ? '−' : ''}${Math.abs(r.trend.changePct)}%` }),
      kpi(r.highest ? `Best: ${r.highest.label}` : 'Best period', r.highest ? money.fmt(r.highest.amountMinor) : '—'),
    ),
    panel(`📈 Income trend (by ${GRAN_NAME[r.granularity]})`, overHost),
    grid(panel('Income sources', note('Where the money came from, by payee.'), srcHost), panel('By category', catHost)),
    panel('🗓 Month by month', table(['Month', 'Income', 'Change', ''], monthRows)),
    panel('📅 Year by year', yearHost, note(sameNote), table(['Year', 'Income', 'Change', ''], yearRows)),
  );
}

/* ------------------------------ cash flow ------------------------------ */

async function cashflow(ctx) {
  const r = await ctx.get('cashflow');
  const { money, user } = ctx;
  const t = r.totals;
  const host = el('div');
  timeChart(host, {
    labels: r.periods.map((p) => p.label), money, locale: user.locale, currency: user.currency, aria: `Income, expenses and net cash flow for each ${GRAN_NAME[r.granularity]}`,
    series: [
      barSeries('Income', r.periods.map((p) => p.incomeMinor), 'var(--viz-1)'),
      barSeries('Expenses', r.periods.map((p) => p.expensesMinor), 'var(--viz-2)'),
      { name: 'Net cash flow', kind: 'line', values: r.periods.map((p) => p.netMinor), color: 'var(--viz-ink)' },
    ],
  });
  const rows = r.periods.map((p) => ({
    cells: [p.label, money.fmt(p.incomeMinor), money.fmt(p.expensesMinor), money.net(p.netMinor), p.savingsRatePct === null ? '—' : `${p.savingsRatePct}%`, money.net(p.savedMinor)],
  }));
  const savedHint = r.savingsAccounts
    ? `${money.net(t.savedMinor)} added to your savings and investment accounts`
    : 'You have no savings or investment accounts yet';
  return stack(
    el('p', { className: 'rp-lead', textContent: `${periodText(ctx, r.period)}, by ${GRAN_NAME[r.granularity]}.` }),
    kpis(
      kpi('Income', money.fmt(t.incomeMinor), { cls: 'inc' }),
      kpi('Expenses', money.fmt(t.expensesMinor), { cls: 'exp' }),
      kpi('Net cash flow', money.net(t.netMinor), { cls: 'net', hint: `Average ${money.net(t.averageNetPerPeriodMinor)} per ${GRAN_NAME[r.granularity]}` }),
      kpi('Savings rate', t.savingsRatePct === null ? '—' : `${t.savingsRatePct}%`, { hint: t.savingsRatePct === null ? 'No income in this period' : 'Share of income you kept' }),
    ),
    panel('💧 Cash flow', host),
    panel('Period by period', table(['Period', 'Income', 'Expenses', 'Net', 'Savings rate', 'Added to savings'], rows,
      { totals: ['Total', money.fmt(t.incomeMinor), money.fmt(t.expensesMinor), money.net(t.netMinor), t.savingsRatePct === null ? '—' : `${t.savingsRatePct}%`, money.net(t.savedMinor)] })),
    panel('How to read this', el('div', { className: 'note' },
      el('p', {}, el('b', { textContent: 'Net cash flow' }), ' = income − expenses. It is what is left (or what you went short by) in the period.'),
      el('p', {}, el('b', { textContent: 'Savings rate' }), ' = net cash flow ÷ income.'),
      el('p', {}, el('b', { textContent: 'Added to savings' }), ` = the change in your Savings and Investment account balances in the period. ${savedHint}.`),
      el('p', {}, 'Transfers between accounts are not built yet. If you record a transfer as an expense plus an income, give it its own category and tick it under ', el('b', { textContent: 'Leave out' }), ' so it is not counted twice.'))),
  );
}

/* ------------------------------ categories ------------------------------ */

async function categories(ctx) {
  const r = await ctx.get('categories', ctx.state.category ? { category: ctx.state.category } : {});
  const { money, user } = ctx;
  const prevText = `${dateText(r.previous.from, user.locale)} to ${dateText(r.previous.to, user.locale)}`;
  const pick = (c) => (c.categoryId === null ? 'none' : String(c.categoryId));
  const section = (title, data, upGood) => {
    if (!data.rows.length) return panel(title, empty('Nothing in this period.'));
    const rows = data.rows.map((c) => ({
      id: pick(c),
      dim: !c.amountMinor && !c.previousMinor,
      cells: [el('span', {}, `${c.icon} ${c.name}`, el('small', { className: 'muted', textContent: c.groupName ? `  ${c.groupName}` : '' })),
        money.net(c.amountMinor), money.net(c.previousMinor), delta(money, c.changeMinor, c.changePct, { upGood }), `${c.sharePct}%`, money.net(c.averagePerMonthMinor)],
    }));
    return panel(title, note(`Compared with ${prevText}. Select a row for that category's own report.`),
      table(['Category', 'This period', 'Previous', 'Change', 'Share', 'Avg per month'], rows,
        { totals: ['Total', money.net(data.totalMinor), money.net(data.previousTotalMinor), '', '', ''], onPick: (id) => ctx.setState({ category: id }), picked: ctx.state.category }));
  };

  let detailPanel = null;
  if (r.detail) {
    const d = r.detail;
    const host = el('div');
    timeChart(host, {
      labels: d.overTime.map((p) => p.label), money, locale: user.locale, currency: user.currency, aria: `${d.name} for each ${GRAN_NAME[r.granularity]}`,
      series: [barSeries(d.name, d.overTime.map((p) => p.amountMinor), d.kind === 'income' ? 'var(--viz-1)' : 'var(--viz-2)')],
    });
    const payees = el('div'); rankedBars(payees, d.topPayees.map((p) => ({ label: p.name, value: p.amountMinor, sub: `${p.count} transaction${p.count === 1 ? '' : 's'}` })), { money });
    const largest = el('div', { className: 'row-list' });
    for (const b of d.largest) {
      largest.append(el('div', { className: 'row-item' }, el('div', { className: 'grow' }, el('b', { textContent: b.payee }), el('br'),
        el('small', { textContent: `${dateText(b.date, user.locale)} • ${b.account}${b.notes ? ' • ' + b.notes : ''}` })),
        el('b', { className: d.kind === 'income' ? 'amt-inc' : 'amt-exp', textContent: (d.kind === 'income' ? '+' : '−') + money.fmt(b.amountMinor) })));
    }
    const close = el('button', { className: 'small-btn', type: 'button', textContent: '✕ Close' });
    close.onclick = () => ctx.setState({ category: null });
    detailPanel = stack(
      el('section', { className: 'panel' }, el('div', { className: 'panel-head' }, el('h3', { textContent: `${d.icon} ${d.name}: ${d.kind === 'income' ? 'received' : 'spent'} ${money.net(d.totalMinor)}` }), close),
        host),
      grid(panel('Top payees', payees), panel(`Largest ${d.kind === 'income' ? 'deposits' : 'expenses'}`, d.largest.length ? largest : empty('None in this period.'))),
    );
  }
  return stack(
    el('p', { className: 'rp-lead', textContent: `${periodText(ctx, r.period)}, compared with the period of the same length before it.` }),
    detailPanel, section('Expenses by category', r.expense, false), section('Income by category', r.income, true),
  );
}

/* ------------------------------ accounts ------------------------------ */

async function accounts(ctx) {
  const r = await ctx.get('accounts');
  const { money, user } = ctx;
  const t = r.totals;
  const rows = r.accounts.map((a) => ({
    id: String(a.accountId), dim: a.closed,
    cells: [el('span', {}, a.name, el('small', { className: 'muted', textContent: `  ${a.type}${a.closed ? ', closed' : ''}${a.offbudget ? ', off-budget' : ''}` })),
      money.net(a.startBalanceMinor), money.fmt(a.inflowMinor), money.fmt(a.outflowMinor), money.net(a.netMinor), money.net(a.endBalanceMinor), String(a.transactionCount)],
  }));
  let detail = null;
  if (r.detail) {
    const a = r.accounts[0];
    const host = el('div');
    timeChart(host, {
      labels: r.detail.overTime.map((p) => p.label), money, locale: user.locale, currency: user.currency, aria: `Money in and out of ${a.name} for each ${GRAN_NAME[r.granularity]}`,
      series: [barSeries('Money in', r.detail.overTime.map((p) => p.inflowMinor), 'var(--viz-1)'), barSeries('Money out', r.detail.overTime.map((p) => -p.outflowMinor), 'var(--viz-2)')],
    });
    const list = el('div', { className: 'row-list' });
    for (const x of r.detail.recent) {
      list.append(el('div', { className: 'row-item' }, el('div', { className: 'grow' }, el('b', { textContent: x.payee }), x.cleared ? el('span', { className: 'cleared-dot', textContent: ' ✓' }) : '', el('br'),
        el('small', { textContent: `${dateText(x.date, user.locale)} • ${x.category}` })),
        el('b', { className: x.amountMinor < 0 ? 'amt-exp' : 'amt-inc', textContent: (x.amountMinor < 0 ? '−' : '+') + money.fmt(x.amountMinor) })));
    }
    const all = el('button', { className: 'small-btn', type: 'button', textContent: '← All accounts' });
    all.onclick = () => ctx.setState({ account: 'all' });
    detail = stack(
      el('section', { className: 'panel' }, el('div', { className: 'panel-head' }, el('h3', { textContent: `${a.name}: activity` }), all), host),
      panel('Latest transactions in this period', r.detail.recent.length ? list : empty('None in this period.')));
  }
  return stack(
    el('p', { className: 'rp-lead', textContent: `${periodText(ctx, r.period)}. Start balance + money in − money out = end balance, for every account.` }),
    kpis(
      kpi('Start balance', money.net(t.startBalanceMinor)),
      kpi('Money in', money.fmt(t.inflowMinor), { cls: 'inc' }),
      kpi('Money out', money.fmt(t.outflowMinor), { cls: 'exp' }),
      kpi('End balance', money.net(t.endBalanceMinor), { cls: 'net', hint: `${t.transactionCount} transaction${t.transactionCount === 1 ? '' : 's'}` }),
    ),
    panel('Account activity', note('Select an account to see its own chart and latest transactions. This report counts whole transactions, so "Leave out" does not apply.'),
      rows.length ? table(['Account', 'Start', 'In', 'Out', 'Net', 'End', 'Txns'], rows,
        { totals: ['Total', money.net(t.startBalanceMinor), money.fmt(t.inflowMinor), money.fmt(t.outflowMinor), money.net(t.netMinor), money.net(t.endBalanceMinor), String(t.transactionCount)],
          onPick: (id) => ctx.setState({ account: id }), picked: ctx.state.account }) : empty('No accounts match.')),
    detail,
  );
}

/* ------------------------------ net worth ------------------------------ */

async function netWorth(ctx) {
  const r = await ctx.get('net-worth', { months: ctx.state.nwMonths });
  const { money, user } = ctx;
  const c = r.current;
  const host = el('div');
  timeChart(host, {
    labels: r.series.map((p) => p.label), money, locale: user.locale, currency: user.currency, aria: 'Net worth, assets and liabilities over time',
    series: [
      { name: 'Net worth', kind: 'area', values: r.series.map((p) => p.netWorthMinor), color: 'var(--viz-1)', endLabel: true },
      { name: 'Assets', kind: 'line', values: r.series.map((p) => p.assetsMinor), color: 'var(--viz-3)' },
      { name: 'Liabilities', kind: 'line', values: r.series.map((p) => p.liabilitiesMinor), color: 'var(--viz-2)' },
    ],
  });
  const trendText = { up: '▲ Net worth is rising', down: '▼ Net worth is falling', flat: '■ Net worth is steady' }[r.trend];
  const group = (g) => el('div', { className: 'nw-group' }, el('h4', {}, el('span', { textContent: g.label }), el('b', { textContent: money.net(g.balanceMinor) })),
    ...g.accounts.map((a) => el('div', { className: 'nw-acct' }, el('span', { textContent: a.name + (a.closed ? ' (closed)' : '') }), el('b', { textContent: money.net(a.balanceMinor) }))));
  const assets = c.groups.filter((g) => g.kind === 'asset');
  const debts = c.groups.filter((g) => g.kind === 'liability');
  const hero = el('div', { className: 'hero-figure' + (c.netWorthMinor < 0 ? ' neg' : ''), textContent: money.net(c.netWorthMinor) });

  return stack(
    el('p', { className: 'rp-lead', textContent: `As of ${dateText(r.asOf, user.locale)}. Net worth = what you own (assets) − what you owe (liabilities).` }),
    el('section', { className: 'panel' }, el('small', { className: 'muted', textContent: 'Net worth today' }), hero,
      el('div', {}, delta(money, r.change.sinceLastMonthEndMinor, null, { upGood: true, suffix: 'since the end of last month' })),
      el('p', { className: 'note', textContent: trendText + (r.change.overRangePct === null ? '' : ` (${r.change.overRangeMinor < 0 ? '−' : '+'}${money.fmt(r.change.overRangeMinor)} since ${r.change.from}, ${r.change.overRangePct > 0 ? '+' : r.change.overRangePct < 0 ? '−' : ''}${Math.abs(r.change.overRangePct)}%)`) })),
    kpis(kpi('Assets', money.net(c.assetsMinor), { cls: 'inc', hint: 'Cash, bank, savings, investments' }),
      kpi('Liabilities', money.net(c.liabilitiesMinor), { cls: 'exp', hint: r.hasLiabilities ? 'Credit cards and loans' : 'No credit cards or loans' }),
      kpi('Change over the chart', (r.change.overRangeMinor < 0 ? '−' : '+') + money.fmt(r.change.overRangeMinor), { cls: 'net', hint: `Since ${r.change.from}` }),
      kpi('Accounts', String(c.groups.reduce((n, g) => n + g.accounts.length, 0)), { hint: 'Closed ones count while they hold money' })),
    panel('📈 Net worth over time', host),
    grid(panel('Assets', assets.length ? el('div', { className: 'nw-groups' }, ...assets.map(group)) : empty('No asset accounts.')),
      panel('Liabilities', debts.length ? el('div', { className: 'nw-groups' }, ...debts.map(group)) : empty('You have no credit card or loan accounts. Add one on the Settings page to see what you owe.'))),
    panel('Good to know', el('div', { className: 'note' },
      el('p', {}, 'Each account\'s balance is its opening balance plus its transactions up to that date, the same sum as the Accounts page. Credit cards and loans count as liabilities; every other type counts as an asset.'),
      el('p', {}, 'Past points assume each opening balance was already there when the chart starts, because opening balances have no date.'),
      el('p', {}, 'Investment accounts show what you recorded in them, not market value. Record gains and losses as transactions to keep them current.'))),
  );
}

/* ------------------------------ monthly summary ------------------------------ */

async function monthly(ctx) {
  const r = await ctx.get('monthly-summary', ctx.state.month ? { month: ctx.state.month } : {});
  const { money, user } = ctx;
  const cmp = `vs ${r.comparedWith.label}${r.comparedWith.sameDays ? ' so far' : ''}`;
  const days = r.daily.filter((d) => !d.future);
  const host = el('div');
  if (days.length) {
    timeChart(host, {
      labels: days.map((d) => `${Number(d.date.slice(8))} ${SHORT_MONTHS[Number(d.date.slice(5, 7)) - 1]}`), money, locale: user.locale, currency: user.currency,
      aria: `Spending on each day of ${shortMonth(r.month)}`, series: [barSeries('Spending', days.map((d) => d.expensesMinor))],
    });
  } else host.append(empty('This month has not started yet.'));
  const cats = el('div'); rankedBars(cats, r.topCategories.map((c) => ({ label: c.name, icon: c.icon, value: c.amountMinor, sub: `${c.sharePct}%`, onClick: () => ctx.go('categories', { category: c.categoryId === null ? 'none' : c.categoryId }) })), { money, empty: 'No spending this month.' });
  const pay = el('div'); rankedBars(pay, r.topPayees.map((c) => ({ label: c.name, value: c.amountMinor, sub: `${c.count} transaction${c.count === 1 ? '' : 's'}` })), { money, empty: 'No spending this month.' });
  const src = el('div'); rankedBars(src, r.incomeSources.map((c) => ({ label: c.name, value: c.amountMinor, sub: `${c.sharePct}%` })), { money, empty: 'No income this month.' });
  const big = el('div', { className: 'row-list' });
  for (const b of r.largestExpenses) {
    big.append(el('div', { className: 'row-item' }, el('div', { className: 'grow' }, el('b', { textContent: b.payee }), el('br'),
      el('small', { textContent: `${dateText(b.date, user.locale)} • ${b.category} • ${b.account}` })), el('b', { className: 'amt-exp', textContent: '−' + money.fmt(b.amountMinor) })));
  }
  const b = r.budget;
  const budgetPanel = b ? panel('Budget this month', el('div', { className: 'note' },
    el('p', {}, `Assigned ${money.net(b.assignedMinor)} · Spent ${money.net(-b.activityMinor)} · Available ${money.net(b.availableMinor)} · Left to budget ${money.net(b.toBudgetMinor)}`),
    el('p', {}, b.overspentCount ? `${b.overspentCount} envelope${b.overspentCount === 1 ? ' is' : 's are'} overspent by ${money.fmt(b.overspentMinor)} in total. ` : 'No envelope is overspent. ',
      el('a', { href: `/budget/${r.month}`, textContent: 'Open the Budget →' })),
    el('p', { className: 'muted', textContent: 'The Budget counts on-budget accounts only, so its figures can differ from the filtered report above.' }))) : null;

  return stack(
    el('p', { className: 'rp-lead', textContent: r.isCurrent ? `${shortMonth(r.month)}, day ${r.daysElapsed} of ${r.daysInMonth}.` : `${shortMonth(r.month)}.` }),
    kpis(
      kpi('Income', money.fmt(r.incomeMinor), { cls: 'inc', extra: delta(money, r.changes.incomeMinor, r.changes.incomePct, { upGood: true, suffix: cmp }) }),
      kpi('Expenses', money.fmt(r.expensesMinor), { cls: 'exp', extra: delta(money, r.changes.expensesMinor, r.changes.expensesPct, { upGood: false, suffix: cmp }) }),
      kpi('Net cash flow', money.net(r.netMinor), { cls: 'net', hint: r.savingsRatePct === null ? 'No income' : `Savings rate ${r.savingsRatePct}%` }),
      kpi('Average per day', money.fmt(r.averageDailyExpenseMinor), { hint: `${r.transactionCount} transaction${r.transactionCount === 1 ? '' : 's'}` }),
    ),
    panel('Spending day by day', host),
    grid(panel('Top categories', cats), panel('Top payees', pay)),
    grid(panel('Income sources', src), panel('Largest expenses', r.largestExpenses.length ? big : empty('No spending this month.'))),
    budgetPanel,
  );
}

/* ------------------------------ the list the page uses ------------------------------ */

const FILTERED = ['range', 'gran', 'account', 'scope', 'exclude'];
export const TABS = [
  ['overview', 'Overview'], ['spending', 'Spending'], ['income', 'Income'], ['cashflow', 'Cash flow'],
  ['categories', 'Categories'], ['accounts', 'Accounts'], ['networth', 'Net worth'], ['monthly', 'Monthly summary'],
];
export const VIEWS = {
  overview: { build: overview, controls: [], csv: null },
  spending: { build: spending, controls: FILTERED, csv: 'spending' },
  income: { build: income, controls: FILTERED, csv: 'income' },
  cashflow: { build: cashflow, controls: FILTERED, csv: 'cashflow' },
  categories: { build: categories, controls: FILTERED, csv: 'categories' },
  accounts: { build: accounts, controls: ['range', 'gran', 'account', 'scope'], csv: 'accounts' },
  networth: { build: netWorth, controls: ['nwMonths'], csv: 'net-worth' },
  monthly: { build: monthly, controls: ['month', 'account', 'scope', 'exclude'], csv: 'monthly-summary' },
};
export { dataTable };
