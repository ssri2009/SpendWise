// Charts for the Reports page: plain SVG and HTML, no library, no innerHTML (every label is set with textContent).
//
// What every chart here does (the rules are written down in PHASE7_NOTES.md):
//   * a legend whenever there are two or more series, never colour alone: each chart also has a "View as table"
//   * a hover/focus tooltip that lists every series at that position; arrow keys move it, Esc hides it
//   * bars at most 24px thick, 4px rounded at the data end and square on the baseline, 2px gap between neighbours
//   * lines 2px, dots at least 8px across with a 2px ring in the surface colour, one end label at most
//   * colours come from the --viz-* CSS variables (app.css), which switch with the light/dark theme
//   * the chart is redrawn at the width it is shown at, so text stays readable on a phone
import { el } from '/js/ui.js';

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, style = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const [k, v] of Object.entries(style)) n.style[k] = v;
  return n;
}

const txt = (attrs, text) => { const n = svg('text', attrs); n.textContent = text; return n; };

/* ------------------------------ numbers ------------------------------ */

/** Round axis limits to friendly numbers: returns { min, max, ticks }. Values are paise. */
export function niceScale(lo, hi, target = 4) {
  if (!(hi > lo)) { hi = lo + 10000; }
  const raw = (hi - lo) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let t = min; t <= max + step / 1000; t += step) ticks.push(Math.round(t));
  return { min, max, ticks };
}

/** Axis labels: in full under 10,000, compact (10K, 1L) once the axis reaches it. One style per axis. */
export function axisFormatter(locale, currency, maxAbsMinor) {
  const compact = maxAbsMinor / 100 >= 10000;
  let nf;
  try {
    nf = new Intl.NumberFormat(locale, { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0, minimumFractionDigits: 0 });
  } catch { nf = { format: (n) => String(Math.round(n)) }; }
  return (minor) => (minor < 0 ? '−' : '') + nf.format(Math.abs(minor) / 100);
}

/* ------------------------------ tooltip ------------------------------ */

function makeTip(host) {
  const tip = el('div', { className: 'viz-tip', role: 'status' });
  tip.hidden = true;
  host.append(tip);
  return {
    show(x, y, title, rows) {
      tip.textContent = '';
      tip.append(el('div', { className: 'viz-tip-title', textContent: title }));
      for (const r of rows) {
        const key = el('span', { className: 'viz-key' });
        key.style.background = r.color;
        if (r.kind === 'line') key.classList.add('line');
        tip.append(el('div', { className: 'viz-tip-row' }, key,
          el('b', { textContent: r.value }), el('span', { className: 'viz-tip-name', textContent: r.name })));
      }
      tip.hidden = false;
      const box = host.getBoundingClientRect();
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let left = x + 14;
      if (left + w > box.width - 4) left = Math.max(4, x - w - 14);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(4, Math.min(y - h / 2, box.height - h - 4))}px`;
    },
    hide() { tip.hidden = true; },
  };
}

/** Run draw() now and again whenever the container changes width (rotating a phone, resizing the window). */
function responsive(host, draw) {
  let lastW = 0;
  const run = () => {
    const w = Math.round(host.clientWidth);
    if (w < 10 || Math.abs(w - lastW) < 3) return;
    lastW = w;
    draw(w);
  };
  run();
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => requestAnimationFrame(run));
    ro.observe(host);
    host.addEventListener('viz-destroy', () => ro.disconnect(), { once: true });
  }
  // the first measurement can be 0 while the page is still laying out
  if (lastW === 0) requestAnimationFrame(run);
}

/* ------------------------------ legend and table ------------------------------ */

export function legend(items) {
  const wrap = el('div', { className: 'viz-legend' });
  for (const it of items) {
    const key = el('span', { className: 'viz-key' + (it.kind === 'line' ? ' line' : '') });
    key.style.background = it.color;
    wrap.append(el('span', { className: 'viz-legend-item' }, key, it.name));
  }
  return wrap;
}

/** The "View as table" that sits under a chart: the same numbers, reachable without hover or colour. */
export function dataTable(headers, rows, { caption } = {}) {
  const t = el('table', { className: 'plain-table' });
  if (caption) t.append(el('caption', { className: 'sr-only', textContent: caption }));
  t.append(el('thead', {}, el('tr', {}, ...headers.map((h, i) => el('th', { scope: 'col', textContent: h, className: i ? 'num' : '' })))));
  t.append(el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c, i) => (i ? el('td', { className: 'num', textContent: c }) : el('th', { scope: 'row', textContent: c })))))));
  return el('details', { className: 'viz-table' }, el('summary', { textContent: 'View as table' }), el('div', { className: 'table-wrap' }, t));
}

/* ------------------------------ columns, lines and areas over a shared x axis ------------------------------ */

function barPath(x, y0, w, y1, r) {
  // y0 = baseline, y1 = data end. Rounded at the data end only.
  const up = y1 < y0;
  const h = Math.abs(y0 - y1);
  const rr = Math.min(r, w / 2, h);
  if (h < 0.5) return '';
  if (up) return `M${x},${y0} V${y1 + rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 + rr} V${y0} Z`;
  return `M${x},${y0} V${y1 - rr} Q${x},${y1} ${x + rr},${y1} H${x + w - rr} Q${x + w},${y1} ${x + w},${y1 - rr} V${y0} Z`;
}

/**
 * series: [{ name, kind: 'bar' | 'line' | 'area', values: paise[], color: 'var(--viz-1)', endLabel?: bool }]
 * One y axis only. Bars and lines can be mixed (income and expenses as bars, net as a line).
 */
export function timeChart(host, { labels, series, money, locale, currency, aria, height = 260, table = true, tableHeaders }) {
  host.textContent = '';
  host.classList.add('viz-host');
  const frame = el('div', { className: 'viz-frame' });
  const chartBox = el('div', { className: 'viz-chart' });
  host.append(series.length > 1 ? legend(series.map((s) => ({ name: s.name, color: s.color, kind: s.kind === 'bar' ? 'bar' : 'line' }))) : '', frame);
  frame.append(chartBox);
  const tip = makeTip(frame);
  const all = series.flatMap((s) => s.values);
  const maxAbs = Math.max(1, ...all.map(Math.abs));
  const scale = niceScale(Math.min(0, ...all), Math.max(0, ...all));
  const fmtAxis = axisFormatter(locale, currency, maxAbs);
  const n = labels.length;
  let active = -1;
  let redraw = () => {};

  const describe = (i) => `${labels[i]}: ${series.map((s) => `${s.name} ${money.net(s.values[i])}`).join(', ')}`;

  responsive(chartBox, (W) => {
    chartBox.textContent = '';
    const H = W < 480 ? Math.min(height, 230) : height;
    const L = 12 + Math.max(...scale.ticks.map((t) => fmtAxis(t).length)) * 6.4, R = 14, T = 14, B = 30;
    const plotW = W - L - R, plotH = H - T - B;
    const y = (v) => T + (1 - (v - scale.min) / (scale.max - scale.min)) * plotH;
    const slot = plotW / n;
    const cx = (i) => L + slot * (i + 0.5);
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'viz-svg', role: 'group', tabindex: 0, 'aria-label': `${aria}. Use the left and right arrow keys to read each point.` });

    for (const t of scale.ticks) {
      root.append(svg('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? 'viz-base' : 'viz-grid' }));
      root.append(txt({ x: L - 8, y: y(t) + 4, class: 'viz-axis', 'text-anchor': 'end' }, fmtAxis(t)));
    }
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
    for (let i = 0; i < n; i += step) {
      root.append(txt({ x: cx(i), y: H - 9, class: 'viz-axis', 'text-anchor': 'middle' }, labels[i]));
    }

    const hover = svg('g', { class: 'viz-hover' });          // band or crosshair, drawn under the marks
    root.append(hover);
    const bars = series.filter((s) => s.kind === 'bar');
    const bw = Math.min(24, Math.max(3, (slot * 0.72) / Math.max(1, bars.length) - 2));
    const groupW = bars.length * bw + (bars.length - 1) * 2;
    bars.forEach((s, bi) => {
      s.values.forEach((v, i) => {
        const x = cx(i) - groupW / 2 + bi * (bw + 2);
        const d = barPath(x, y(0), bw, y(v), 4);
        if (d) root.append(svg('path', { d, class: 'viz-bar' }, { fill: s.color }));
      });
    });
    const lineSeries = series.filter((s) => s.kind !== 'bar');
    for (const s of lineSeries) {
      const pts = s.values.map((v, i) => [cx(i), y(v)]);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
      if (s.kind === 'area' && pts.length > 1) {
        root.append(svg('path', { d: `${d} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z`, class: 'viz-area' }, { fill: s.color }));
      }
      root.append(svg('path', { d, class: 'viz-line' }, { stroke: s.color }));
      const last = pts[pts.length - 1];
      root.append(svg('circle', { cx: last[0], cy: last[1], r: 4.5, class: 'viz-dot' }, { fill: s.color }));
      if (s.endLabel) {
        const anchorEnd = last[0] > W - 90;
        root.append(txt({ x: anchorEnd ? last[0] - 2 : last[0] + 8, y: last[1] - 10, class: 'viz-endlabel', 'text-anchor': anchorEnd ? 'end' : 'start' }, money.net(s.values[n - 1])));
      }
    }
    const dots = svg('g', { class: 'viz-hover-dots' });
    root.append(dots);

    const show = (i, px, py) => {
      active = i;
      hover.textContent = ''; dots.textContent = '';
      if (lineSeries.length && !bars.length) hover.append(svg('line', { x1: cx(i), x2: cx(i), y1: T, y2: T + plotH, class: 'viz-cross' }));
      else hover.append(svg('rect', { x: cx(i) - slot / 2, y: T, width: slot, height: plotH, class: 'viz-band' }));
      for (const s of lineSeries) dots.append(svg('circle', { cx: cx(i), cy: y(s.values[i]), r: 4.5, class: 'viz-dot' }, { fill: s.color }));
      tip.show(px ?? cx(i), py ?? T + plotH / 3, labels[i], series.map((s) => ({ name: s.name, color: s.color, kind: s.kind === 'bar' ? 'bar' : 'line', value: money.net(s.values[i]) })));
    };
    const hide = () => { active = -1; hover.textContent = ''; dots.textContent = ''; tip.hide(); };
    redraw = () => { if (active >= 0) show(active); };

    for (let i = 0; i < n; i++) {
      const hit = svg('rect', { x: cx(i) - slot / 2, y: T, width: slot, height: plotH, class: 'viz-hit' });
      hit.addEventListener('pointermove', (e) => { const b = frame.getBoundingClientRect(); show(i, e.clientX - b.left, e.clientY - b.top); });
      hit.addEventListener('pointerleave', hide);
      root.append(hit);
    }
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return hide();
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -n : e.key === 'End' ? n : 0;
      if (!dir) return;
      e.preventDefault();
      show(Math.max(0, Math.min(n - 1, (active < 0 ? (dir > 0 ? -1 : n) : active) + dir)));
    });
    root.addEventListener('blur', hide);
    chartBox.append(root);
    chartBox.setAttribute('aria-label', describe(n - 1));
    redraw();
  });

  if (table) {
    host.append(dataTable(tableHeaders || ['', ...series.map((s) => s.name)], labels.map((l, i) => [l, ...series.map((s) => money.net(s.values[i]))]), { caption: aria }));
  }
}

/* ------------------------------ ranked horizontal bars (compare parts with each other) ------------------------------ */

/**
 * rows: [{ label, icon?, sub?, value (paise), onClick? }]. One hue; the value is printed at the bar tip.
 * Bars on one baseline are the most exact way to compare parts, so this is the main "by category / payee / account" view.
 */
export function rankedBars(host, rows, { money, color = 'var(--viz-1)', empty = 'Nothing to show for this period.' } = {}) {
  host.textContent = '';
  host.classList.add('hbars');
  if (!rows.length) { host.append(el('p', { className: 'empty-note', textContent: empty })); return; }
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  for (const r of rows) {
    const clickable = typeof r.onClick === 'function';
    const row = el(clickable ? 'button' : 'div', { className: 'hbar' + (clickable ? ' clickable' : ''), type: clickable ? 'button' : undefined });
    if (clickable) row.onclick = r.onClick;
    const name = el('span', { className: 'hbar-name' }, el('span', { className: 'hbar-title' },
      r.icon ? el('span', { className: 'hbar-icon', textContent: r.icon, attrs: { 'aria-hidden': 'true' } }) : '', el('span', { textContent: r.label })));
    if (r.sub) name.append(el('small', { textContent: r.sub }));
    const fill = el('span', { className: 'hbar-fill' });
    fill.style.width = `${Math.max(r.value ? 1.5 : 0, Math.abs(r.value) / max * 100)}%`;
    fill.style.background = r.value < 0 ? 'var(--viz-neg)' : color;
    row.append(name, el('span', { className: 'hbar-track' }, fill), el('b', { className: 'hbar-val', textContent: money.net(r.value) }));
    host.append(row);
  }
}

/* ------------------------------ doughnut (one whole, at a glance) ------------------------------ */

/** parts: [{ label, value (paise > 0) }]. The first six get their own colour, the rest fold into "Other". */
export function doughnut(host, parts, { money, centerLabel = 'Total', aria }) {
  host.textContent = '';
  host.classList.add('viz-host');
  const positive = parts.filter((p) => p.value > 0);
  const total = positive.reduce((n, p) => n + p.value, 0);
  if (!total) { host.append(el('p', { className: 'empty-note', textContent: 'Nothing to show for this period.' })); return; }
  const shown = positive.slice(0, 6);
  const rest = positive.slice(6).reduce((n, p) => n + p.value, 0);
  const slices = shown.map((p, i) => ({ label: p.label, value: p.value, color: `var(--viz-${i + 1})` }));
  if (rest > 0) slices.push({ label: 'Other', value: rest, color: 'var(--viz-other)' });

  const size = 220, c = size / 2, rOut = 100, rIn = 64;
  const frame = el('div', { className: 'viz-frame donut-frame' });
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'viz-svg donut', role: 'img', 'aria-label': aria });
  const tip = makeTip(frame);
  const pt = (a, r) => [c + r * Math.sin(a), c - r * Math.cos(a)];
  let a0 = 0;
  const gap = slices.length > 1 ? 0.025 : 0;
  slices.forEach((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a1 = a0 + sweep;
    const lo = a0 + gap / 2, hi = a1 - gap / 2;
    let d;
    if (slices.length === 1) {
      d = `M${c},${c - rOut} A${rOut},${rOut} 0 1 1 ${c - 0.01},${c - rOut} L${c - 0.01},${c - rIn} A${rIn},${rIn} 0 1 0 ${c},${c - rIn} Z`;
    } else {
      const [x1, y1] = pt(lo, rOut), [x2, y2] = pt(hi, rOut), [x3, y3] = pt(hi, rIn), [x4, y4] = pt(lo, rIn);
      const big = hi - lo > Math.PI ? 1 : 0;
      d = `M${x1},${y1} A${rOut},${rOut} 0 ${big} 1 ${x2},${y2} L${x3},${y3} A${rIn},${rIn} 0 ${big} 0 ${x4},${y4} Z`;
    }
    const path = svg('path', { d, class: 'viz-slice', tabindex: 0, 'aria-label': `${s.label}: ${money.fmt(s.value)}, ${Math.round(s.value / total * 1000) / 10}%` }, { fill: s.color });
    const showTip = (px, py) => tip.show(px, py, s.label, [{ name: `${Math.round(s.value / total * 1000) / 10}% of ${centerLabel.toLowerCase()}`, color: s.color, value: money.fmt(s.value) }]);
    path.addEventListener('pointermove', (e) => { const b = frame.getBoundingClientRect(); showTip(e.clientX - b.left, e.clientY - b.top); });
    path.addEventListener('pointerleave', () => tip.hide());
    path.addEventListener('focus', () => showTip(c, c));
    path.addEventListener('blur', () => tip.hide());
    root.append(path);
    a0 = a1;
  });
  const totalText = money.fmt(total);
  const totalNode = txt({ x: c, y: c - 2, class: 'donut-total', 'text-anchor': 'middle' }, totalText);
  totalNode.style.fontSize = totalText.length > 11 ? '14px' : totalText.length > 8 ? '17px' : '22px';   // keep it inside the hole
  root.append(totalNode);
  root.append(txt({ x: c, y: c + 16, class: 'viz-axis', 'text-anchor': 'middle' }, centerLabel));
  frame.append(root);

  const list = el('ul', { className: 'donut-legend' });
  for (const s of slices) {
    const key = el('span', { className: 'viz-key' });
    key.style.background = s.color;
    list.append(el('li', {}, key, el('span', { className: 'donut-name', textContent: s.label }), el('span', { className: 'donut-pct', textContent: `${Math.round(s.value / total * 1000) / 10}%` })));
  }
  host.append(el('div', { className: 'donut-wrap' }, frame, list));
}
