import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useMemo, useState, type ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api';
import { formatMoney, formatMoneyCompact, formatPct, type MoneyFormat } from '../../lib/format';
import { CHART_MOTION, CHART_MOTION_LINE } from '../../lib/motion';
import type { SpendingReport } from '../../types/reports';

/* ---------------------------------------------------------------------
   Report charts. Mark specs (dataviz skill): bars ≤ 24px with 4px rounded
   data ends and square baselines, 2px lines, ≥ 8px dots with a 2px surface
   ring, solid hairline grid, one y-axis, text in text tokens (never the
   series colour), legend whenever there are 2+ series, and every chart has
   a hover tooltip plus a table view (ReportPanel).
   --------------------------------------------------------------------- */

export const SLOT = (n: number) => `var(--sw-rp-${n})`;
export const OTHER = 'var(--sw-rp-other)';
export const SERIES = {
  income: { label: 'Income', color: SLOT(4) },
  expenses: { label: 'Expenses', color: SLOT(3) },
  net: { label: 'Net', color: SLOT(1) },
} as const;

const AXIS_TICK = { fill: 'var(--sw-muted)', fontSize: 12 };
const GRID = 'var(--sw-rp-grid)';

/* ---------- stable category colours ---------- */

/**
 * Colour follows the category, never its rank in the current view: the six slots go to the six
 * biggest spending categories of all time (unfiltered), and stay with them whatever filters are on.
 * Every other category is drawn in the neutral "Other" tone.
 */
export function useCategoryColors() {
  const q = useQuery({
    queryKey: ['reports', 'palette'],
    queryFn: ({ signal }) => api.get<SpendingReport>('/api/reports/spending?range=all&granularity=year', signal),
    staleTime: 10 * 60_000,
  });
  return useMemo(() => {
    const map = new Map<number | null, string>();
    (q.data?.byCategory ?? []).slice(0, 6).forEach((c, i) => map.set(c.categoryId, SLOT(i + 1)));
    return (id: number | null) => map.get(id) ?? OTHER;
  }, [q.data]);
}

/* ---------- tooltip ---------- */

export function TooltipCard({ title, rows, foot }: { title: string; rows: { label: string; value: string; color?: string; line?: boolean }[]; foot?: ReactNode }) {
  return (
    <div className="min-w-44 rounded-2xl border border-line bg-elevated px-4 py-3 text-sm shadow-glass">
      <p className="mb-1.5 font-semibold">{title}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-2 text-muted">
            {r.color && <span className={`inline-block ${r.line ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-sm'}`} style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="font-semibold tabular-nums">{r.value}</span>
        </div>
      ))}
      {foot && <div className="mt-2 border-t border-line pt-2 text-xs text-muted">{foot}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={`inline-block ${i.line ? 'h-0.5 w-4 rounded-full' : 'size-2.5 rounded-sm'}`} style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Short x labels: "Nov" (or "Nov ’25" when the period spans years), quarters and years as they come. */
export function shortLabels<T extends { key: string; label: string }>(rows: T[]) {
  const years = new Set(rows.map((r) => r.key.slice(0, 4)));
  return rows.map((r) => {
    if (!/^\d{4}-\d{2}$/.test(r.key)) return { ...r, short: r.label };
    const [mon, year] = r.label.split(' ');
    return { ...r, short: years.size > 1 ? `${mon} ’${(year ?? '').slice(2)}` : mon };
  });
}

/* ---------- one series over time ---------- */

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
  note?: string;
}

export function ColumnChart({
  data,
  color,
  name,
  fmt,
  average,
  ariaLabel,
  height = 280,
}: {
  data: ColumnDatum[];
  color: string;
  name: string;
  fmt: MoneyFormat;
  average?: number;
  ariaLabel: string;
  height?: number;
}) {
  const rows = shortLabels(data);
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="short" tickLine={false} axisLine={false} tick={AXIS_TICK} dy={6} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickLine={false} axisLine={false} width={60} tick={AXIS_TICK} tickFormatter={(v: number) => formatMoneyCompact(v, fmt)} />
          <Tooltip
            cursor={{ fill: 'var(--sw-subtle)' }}
            content={(p) => {
              const r = p.payload?.[0]?.payload as (ColumnDatum & { short: string }) | undefined;
              return r ? <TooltipCard title={r.label} rows={[{ label: name, value: formatMoney(r.value, fmt), color }]} foot={r.note} /> : null;
            }}
          />
          {average !== undefined && average > 0 && (
            <ReferenceLine
              y={average}
              stroke="var(--sw-muted)"
              strokeOpacity={0.6}
              label={{ value: `Avg ${formatMoneyCompact(average, fmt)}`, position: 'insideTopRight', fill: 'var(--sw-muted)', fontSize: 11 }}
            />
          )}
          <Bar dataKey="value" name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} {...CHART_MOTION} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- income vs expenses + net ---------- */

export interface CashflowDatum {
  key: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
  rate: number | null;
}

export function CashflowChart({ data, fmt, height = 300 }: { data: CashflowDatum[]; fmt: MoneyFormat; height?: number }) {
  const rows = shortLabels(data);
  return (
    <div className="space-y-3">
      <Legend
        items={[
          { label: SERIES.income.label, color: SERIES.income.color },
          { label: SERIES.expenses.label, color: SERIES.expenses.color },
          { label: 'Net cash flow', color: SERIES.net.color, line: true },
        ]}
      />
      <div style={{ height }} role="img" aria-label={`Income, expenses and net cash flow for ${data.length} periods. Use the table view for exact figures.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="short" tickLine={false} axisLine={false} tick={AXIS_TICK} dy={6} interval="preserveStartEnd" minTickGap={8} />
            <YAxis tickLine={false} axisLine={false} width={60} tick={AXIS_TICK} tickFormatter={(v: number) => formatMoneyCompact(v, fmt)} />
            <Tooltip
              cursor={{ fill: 'var(--sw-subtle)' }}
              content={(p) => {
                const r = p.payload?.[0]?.payload as CashflowDatum | undefined;
                if (!r) return null;
                return (
                  <TooltipCard
                    title={r.label}
                    rows={[
                      { label: 'Income', value: formatMoney(r.income, fmt), color: SERIES.income.color },
                      { label: 'Expenses', value: formatMoney(r.expenses, fmt), color: SERIES.expenses.color },
                      { label: 'Net', value: formatMoney(r.net, fmt, { signed: true }), color: SERIES.net.color, line: true },
                    ]}
                    foot={<>Savings rate: <b className="text-fg">{formatPct(r.rate)}</b></>}
                  />
                );
              }}
            />
            <ReferenceLine y={0} stroke="var(--sw-border)" />
            <Bar dataKey="income" name="Income" fill={SERIES.income.color} radius={[4, 4, 0, 0]} maxBarSize={24} {...CHART_MOTION} />
            <Bar dataKey="expenses" name="Expenses" fill={SERIES.expenses.color} radius={[4, 4, 0, 0]} maxBarSize={24} {...CHART_MOTION} />
            <Line
              dataKey="net"
              name="Net"
              type="monotone"
              stroke={SERIES.net.color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={{ r: 4, strokeWidth: 2, stroke: 'var(--sw-elevated)', fill: SERIES.net.color }}
              activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--sw-elevated)' }}
              {...CHART_MOTION_LINE}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ---------- ranked horizontal bars (HTML, so it stays responsive and accessible) ---------- */

export interface RankedRow {
  id: string;
  label: string;
  icon?: string;
  value: number;
  sharePct?: number | null;
  /** Optional comparison value (e.g. the previous period), drawn as a thin tick. */
  previous?: number;
  detail?: string;
  /** A small identity swatch next to the label (category colour). */
  swatch?: string;
  onSelect?: () => void;
  selected?: boolean;
}

export function RankedBars({
  rows,
  color,
  fmt,
  limit,
  empty,
  previousLabel = 'Previous period',
}: {
  rows: RankedRow[];
  color: string;
  fmt: MoneyFormat;
  limit?: number;
  empty?: ReactNode;
  previousLabel?: string;
}) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.previous ?? 0)));
  if (!rows.length) return <>{empty}</>;
  const hasPrev = rows.some((r) => r.previous !== undefined);

  return (
    <div>
      {hasPrev && (
        <div className="mb-3">
          <Legend items={[{ label: 'This period', color }, { label: previousLabel, color: 'var(--sw-muted)', line: true }]} />
        </div>
      )}
      <ul className="space-y-1">
        {shown.map((r, i) => {
          const pct = Math.max(0, (r.value / max) * 100);
          const prevPct = r.previous !== undefined ? Math.max(0, (r.previous / max) * 100) : null;
          const body = (
            <>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {r.swatch && <span className="size-2.5 shrink-0 rounded-sm" style={{ background: r.swatch }} aria-hidden />}
                  {r.icon && <span aria-hidden>{r.icon}</span>}
                  <span className="truncate font-medium">{r.label}</span>
                  {r.detail && <span className="hidden truncate text-xs text-muted sm:inline">{r.detail}</span>}
                </span>
                <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <span className="font-semibold">{formatMoney(r.value, fmt)}</span>
                  {r.sharePct !== undefined && r.sharePct !== null && <span className="w-12 text-right text-xs text-muted">{formatPct(r.sharePct)}</span>}
                </span>
              </div>
              <div className="relative mt-1.5 h-2 rounded-full bg-subtle">
                <motion.div
                  className="h-full rounded-r-[4px]"
                  style={{ background: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, delay: Math.min(i, 10) * 0.03, ease: [0.22, 1, 0.36, 1] }}
                />
                {prevPct !== null && (
                  <span
                    className="absolute -top-1 h-4 w-0.5 rounded-full bg-muted"
                    style={{ left: `calc(${prevPct}% - 1px)` }}
                    title={`${previousLabel}: ${formatMoney(r.previous ?? 0, fmt)}`}
                    aria-hidden
                  />
                )}
              </div>
            </>
          );
          const label = `${r.label}: ${formatMoney(r.value, fmt)}${r.sharePct ? `, ${formatPct(r.sharePct)} of total` : ''}${
            r.previous !== undefined ? `, ${previousLabel.toLowerCase()} ${formatMoney(r.previous, fmt)}` : ''
          }`;
          return (
            <li key={r.id}>
              {r.onSelect ? (
                <button
                  type="button"
                  onClick={r.onSelect}
                  aria-pressed={r.selected}
                  aria-label={label}
                  className={`block w-full rounded-xl px-3 py-2 text-left transition-colors hover:bg-subtle ${r.selected ? 'bg-accent/10 ring-1 ring-accent/40' : ''}`}
                >
                  {body}
                </button>
              ) : (
                <div className="rounded-xl px-3 py-2 transition-colors hover:bg-subtle" title={label}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {limit && rows.length > limit && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 px-3 text-xs font-semibold text-accent hover:underline">
          {all ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/* ---------- part-to-whole: the tall segmented bar ---------- */

export interface SharePart {
  id: string;
  label: string;
  value: number;
  color: string;
}

/**
 * One whole split into parts (≤ 6 + Other). 28px tall, 4px corners, 2px surface gaps; the share
 * is printed inside a part only when it fits. Hover/focus shows each part; the legend names them.
 */
export function ShareBar({ parts, fmt, total }: { parts: SharePart[]; fmt: MoneyFormat; total: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const visible = parts.filter((p) => p.value > 0);
  if (!visible.length || total <= 0) return null;
  const active = visible.find((p) => p.id === hover);

  return (
    <div>
      <div className="flex h-7 w-full gap-0.5" role="group" aria-label="Share of the total">
        {visible.map((p) => {
          const share = (p.value / total) * 100;
          const inkLight = p.color === OTHER;
          return (
            <motion.button
              key={p.id}
              type="button"
              aria-label={`${p.label}: ${formatMoney(p.value, fmt)}, ${formatPct(Math.round(share * 10) / 10)}`}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(p.id)}
              onBlur={() => setHover(null)}
              initial={{ flexGrow: 0 }}
              animate={{ flexGrow: share }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              style={{ background: p.color, flexBasis: 0, minWidth: 4 }}
              className={`relative overflow-visible rounded-[4px] text-left outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-accent ${
                hover && hover !== p.id ? 'opacity-50' : ''
              }`}
            >
              {share >= 9 && (
                <span className={`pointer-events-none absolute inset-y-0 left-2 flex items-center text-[11px] font-semibold ${inkLight ? 'text-fg' : 'text-white'}`}>
                  {Math.round(share)}%
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
      <p className="mt-2 h-5 text-xs text-muted" aria-live="polite">
        {active ? (
          <>
            <b className="text-fg">{active.label}</b> · {formatMoney(active.value, fmt)} · {formatPct(Math.round((active.value / total) * 1000) / 10)}
          </>
        ) : (
          'Hover or focus a part for its amount.'
        )}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {visible.map((p) => (
          <li key={p.id} className="flex items-center gap-1.5 text-muted">
            <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
            <span className="text-fg">{p.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Up to six coloured parts (the categories that own a colour slot) + everything else as "Other". */
export function shareParts<T extends { categoryId: number | null; name: string; amountMinor: number }>(
  rows: T[],
  colorOf: (id: number | null) => string,
): SharePart[] {
  const coloured: SharePart[] = [];
  let other = 0;
  for (const r of rows) {
    if (r.amountMinor <= 0) continue;
    const c = colorOf(r.categoryId);
    if (c !== OTHER && coloured.length < 6) coloured.push({ id: String(r.categoryId), label: r.name, value: r.amountMinor, color: c });
    else other += r.amountMinor;
  }
  if (other > 0) coloured.push({ id: 'other', label: 'Everything else', value: other, color: OTHER });
  return coloured;
}
