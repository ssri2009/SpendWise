import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDate, formatMoney, formatMoneyCompact, type MoneyFormat } from '../../lib/format';
import { CHART_MOTION_LINE } from '../../lib/motion';
import type { ForecastPoint } from '../../types/forecast';
import { SERIES, TooltipCard } from '../reports/charts';
import { DataTable } from '../reports/common';

/* Projected balance, one series (so no legend: the panel title names it). Mark specs from the dataviz
   skill: 2px line, solid hairline grid, one y-axis, ≥ 8px marker with a 2px surface ring, text in text
   tokens. The balance only changes on days with money in or out, so the line is drawn as steps. */

const AXIS_TICK = { fill: 'var(--sw-muted)', fontSize: 12 };
const GRID = 'var(--sw-rp-grid)';
const BALANCE = SERIES.net.color;

interface Datum extends ForecastPoint {
  label: string;
}

export function BalanceChart({
  timeline,
  lowestDate,
  fmt,
  height = 300,
}: {
  timeline: ForecastPoint[];
  lowestDate: string;
  fmt: MoneyFormat;
  height?: number;
}) {
  const data = useMemo<Datum[]>(() => timeline.map((p) => ({ ...p, label: formatDate(p.date, fmt.locale, { day: 'numeric', month: 'short' }) })), [timeline, fmt.locale]);
  const min = Math.min(...timeline.map((p) => p.balanceMinor));
  const max = Math.max(...timeline.map((p) => p.balanceMinor));
  // Mark the low point only when the balance actually dips below today's.
  const low = data.length && min < data[0].balanceMinor ? data.find((d) => d.date === lowestDate) : undefined;
  const crossesZero = min < 0;
  const ticks = useMemo(() => niceTicks(Math.min(0, min), Math.max(0, max)), [min, max]);
  const last = data[data.length - 1];

  return (
    <div
      style={{ height }}
      role="img"
      aria-label={`Projected balance from ${formatMoney(data[0]?.balanceMinor ?? 0, fmt)} today to ${formatMoney(last?.balanceMinor ?? 0, fmt)} on ${last?.label}, lowest ${formatMoney(min, fmt)}. Use the table view for exact figures.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            dy={6}
            interval="preserveStartEnd"
            minTickGap={28}
            tickFormatter={(d: string) => formatDate(d, fmt.locale, { day: 'numeric', month: 'short' })}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={64}
            tick={AXIS_TICK}
            domain={[ticks[0], ticks[ticks.length - 1]]}
            ticks={ticks}
            tickFormatter={(v: number) => formatMoneyCompact(v, fmt)}
          />
          <Tooltip
            cursor={{ stroke: 'var(--sw-border)', strokeWidth: 1 }}
            content={(p) => {
              const d = p.payload?.[0]?.payload as Datum | undefined;
              if (!d) return null;
              const rows: { label: string; value: string; color?: string; line?: boolean }[] = [
                { label: 'Balance', value: formatMoney(d.balanceMinor, fmt), color: BALANCE, line: true },
              ];
              if (d.incomeMinor) rows.push({ label: 'Coming in', value: formatMoney(d.incomeMinor, fmt, { signed: true }) });
              if (d.expenseMinor) rows.push({ label: 'Going out', value: formatMoney(-d.expenseMinor, fmt) });
              return (
                <TooltipCard
                  title={formatDate(d.date, fmt.locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                  rows={rows}
                  foot={d.balanceMinor < 0 ? <span className="font-semibold text-expense">Below zero</span> : undefined}
                />
              );
            }}
          />
          {crossesZero && <ReferenceLine y={0} stroke="var(--sw-muted)" strokeWidth={1} />}
          <Line
            dataKey="balanceMinor"
            name="Balance"
            type="stepAfter"
            stroke={BALANCE}
            strokeWidth={2}
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--sw-elevated)', fill: BALANCE }}
            {...CHART_MOTION_LINE}
          />
          {low && (
            <ReferenceDot
              x={low.date}
              y={low.balanceMinor}
              r={5}
              fill={BALANCE}
              stroke="var(--sw-elevated)"
              strokeWidth={2}
              label={(props: { viewBox?: { x?: number; y?: number } }) => {
                // Near the left edge the text starts at the dot instead of centring on it, so it never hits the axis labels.
                const x = props.viewBox?.x ?? 0;
                const y = (props.viewBox?.y ?? 0) + 20;
                const early = data.indexOf(low) < data.length * 0.2;
                return (
                  <text x={early ? x - 4 : x} y={y} textAnchor={early ? 'start' : 'middle'} fill="var(--sw-text)" fontSize={11} fontWeight={600}>
                    Lowest {formatMoneyCompact(low.balanceMinor, fmt)}
                  </text>
                );
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Table view: today, every day the balance moves, and the last day. */
export function BalanceTable({ timeline, fmt }: { timeline: ForecastPoint[]; fmt: MoneyFormat }) {
  const rows = timeline.filter((p, i) => i === 0 || i === timeline.length - 1 || p.incomeMinor || p.expenseMinor);
  return (
    <DataTable
      caption="Projected balance by day"
      head={[{ label: 'Date' }, { label: 'In', align: 'right' }, { label: 'Out', align: 'right' }, { label: 'Balance', align: 'right' }]}
      rows={rows.map((p) => [
        formatDate(p.date, fmt.locale, { weekday: 'short', day: 'numeric', month: 'short' }),
        p.incomeMinor ? formatMoney(p.incomeMinor, fmt, { signed: true }) : '—',
        p.expenseMinor ? formatMoney(-p.expenseMinor, fmt) : '—',
        <span className={p.balanceMinor < 0 ? 'font-semibold text-expense' : 'font-semibold'}>{formatMoney(p.balanceMinor, fmt)}</span>,
      ])}
    />
  );
}

/**
 * Round tick values (1, 2, 2.5, 5 × 10ⁿ rupees) covering [lo, hi], with a step of room under the lowest
 * point so its label never sits on the date axis.
 */
function niceTicks(lo: number, hi: number): number[] {
  if (hi === lo) hi = lo + 100_00;
  const rough = (hi - lo) / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  let start = Math.floor(lo / step) * step;
  if (lo - start < step * 0.35 && lo < 0) start -= step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Math.round(v));
  return out;
}
