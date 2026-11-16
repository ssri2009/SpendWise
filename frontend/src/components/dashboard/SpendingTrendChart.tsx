import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, ChartNoAxesCombined, Table2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useCashflow, useMoneyFormat, type TrendRange } from '../../hooks/useDashboard';
import { formatMoney, formatMoneyCompact, formatPct, type MoneyFormat } from '../../lib/format';
import { CHART_MOTION, CHART_MOTION_LINE } from '../../lib/motion';
import { EmptyState, ErrorState, Panel, Segmented, Skeleton, svgId } from './ui';

const RANGES = [
  { id: 'last-6-months', label: '6M' },
  { id: 'last-12-months', label: '12M' },
  { id: 'this-year', label: 'YTD' },
] as const satisfies readonly { id: TrendRange; label: string }[];

// Blue / orange for income / expenses (safe for colour-blind readers), accent for net.
const SERIES = {
  income: { label: 'Income', color: 'var(--sw-viz-2)' },
  expenses: { label: 'Expenses', color: 'var(--sw-viz-4)' },
  net: { label: 'Net', color: 'var(--sw-accent)' },
} as const;

interface TrendRow {
  key: string;
  label: string;
  fullLabel: string;
  income: number;
  expenses: number;
  net: number;
  rate: number | null;
}

function TrendTooltip({ row, fmt }: { row?: TrendRow; fmt: MoneyFormat }) {
  if (!row) return null;
  return (
    <div className="min-w-48 rounded-2xl border border-line bg-elevated px-4 py-3 text-sm shadow-glass">
      <p className="mb-2 font-semibold">{row.fullLabel}</p>
      {(['income', 'expenses', 'net'] as const).map((k) => (
        <div key={k} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-2 text-muted">
            <span className={`inline-block ${k === 'net' ? 'h-0.5 w-3' : 'size-2.5 rounded-sm'}`} style={{ background: SERIES[k].color }} />
            {SERIES[k].label}
          </span>
          <span className="font-semibold tabular-nums">{formatMoney(row[k], fmt, { signed: k === 'net' })}</span>
        </div>
      ))}
      <div className="mt-2 border-t border-line pt-2 text-xs text-muted">
        Savings rate: <span className="font-semibold text-fg">{formatPct(row.rate)}</span>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
      {(['income', 'expenses', 'net'] as const).map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={`inline-block ${k === 'net' ? 'h-0.5 w-4 rounded-full' : 'size-2.5 rounded-sm'}`} style={{ background: SERIES[k].color }} />
          {SERIES[k].label}
        </li>
      ))}
    </ul>
  );
}

function Totals({ items }: { items: { label: string; value: string; tone?: string }[] }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-xs text-muted">{i.label}</dt>
          <dd className={`truncate text-sm font-semibold tabular-nums sm:text-base ${i.tone ?? ''}`}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SpendingTrendChart({ className = '' }: { className?: string }) {
  const [range, setRange] = useState<TrendRange>('last-6-months');
  const [asTable, setAsTable] = useState(false);
  const fmt = useMoneyFormat();
  const query = useCashflow(range);
  const ids = svgId(useId());

  const rows = useMemo<TrendRow[]>(() => {
    const periods = query.data?.periods ?? [];
    const years = new Set(periods.map((p) => p.key.slice(0, 4)));
    return periods.map((p) => {
      const [mon, year] = p.label.split(' ');
      return {
        key: p.key,
        label: years.size > 1 ? `${mon} ’${(year ?? '').slice(2)}` : mon,
        fullLabel: p.label,
        income: p.incomeMinor,
        expenses: p.expensesMinor,
        net: p.netMinor,
        rate: p.savingsRatePct,
      };
    });
  }, [query.data]);

  const hasData = rows.some((r) => r.income !== 0 || r.expenses !== 0);
  const totals = query.data?.totals;

  return (
    <Panel
      title="Spending trend"
      icon={ChartNoAxesCombined}
      className={className}
      action={
        <div className="flex items-center gap-2">
          <Segmented options={RANGES} value={range} onChange={setRange} label="Period" layoutId={`trend-range-${ids}`} />
          <button
            type="button"
            onClick={() => setAsTable((t) => !t)}
            aria-pressed={asTable}
            aria-label={asTable ? 'Show as chart' : 'Show as table'}
            title={asTable ? 'Show as chart' : 'Show as table'}
            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            {asTable ? <BarChart3 className="size-4" aria-hidden /> : <Table2 className="size-4" aria-hidden />}
          </button>
        </div>
      }
    >
      {query.isPending ? (
        <>
          <Skeleton className="h-72" />
          <Skeleton className="mt-4 h-12" />
        </>
      ) : query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !hasData ? (
        <EmptyState icon={ChartNoAxesCombined} title="No income or spending in this period">
          Transactions you add or import will show up here month by month.
        </EmptyState>
      ) : (
        <div className={`transition-opacity ${query.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={query.isFetching}>
          {!asTable && <Legend />}
          <AnimatePresence mode="wait" initial={false}>
            {asTable ? (
              <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Income, expenses and net cash flow by month</caption>
                  <thead className="sticky top-0 bg-elevated text-xs text-muted">
                    <tr>
                      <th scope="col" className="py-2 text-left font-medium">Month</th>
                      <th scope="col" className="py-2 text-right font-medium">Income</th>
                      <th scope="col" className="py-2 text-right font-medium">Expenses</th>
                      <th scope="col" className="py-2 text-right font-medium">Net</th>
                      <th scope="col" className="hidden py-2 text-right font-medium sm:table-cell">Kept</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line tabular-nums">
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <th scope="row" className="py-2 text-left font-medium">{r.fullLabel}</th>
                        <td className="py-2 text-right">{formatMoney(r.income, fmt)}</td>
                        <td className="py-2 text-right">{formatMoney(r.expenses, fmt)}</td>
                        <td className={`py-2 text-right font-semibold ${r.net < 0 ? 'text-expense' : r.net > 0 ? 'text-income' : ''}`}>
                          {formatMoney(r.net, fmt, { signed: true })}
                        </td>
                        <td className="hidden py-2 text-right text-muted sm:table-cell">{formatPct(r.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </motion.div>
            ) : (
              <motion.div
                key="chart"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-3 h-72"
                role="img"
                aria-label={`Income, expenses and net cash flow for ${rows.length} months. Use the table button for exact figures.`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={3} barCategoryGap="22%">
                    <defs>
                      <linearGradient id={`inc-${ids}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" style={{ stopColor: SERIES.income.color, stopOpacity: 0.95 }} />
                        <stop offset="100%" style={{ stopColor: SERIES.income.color, stopOpacity: 0.45 }} />
                      </linearGradient>
                      <linearGradient id={`exp-${ids}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" style={{ stopColor: SERIES.expenses.color, stopOpacity: 0.95 }} />
                        <stop offset="100%" style={{ stopColor: SERIES.expenses.color, stopOpacity: 0.45 }} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--sw-border)" strokeDasharray="3 4" />
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: 'var(--sw-muted)', fontSize: 12 }}
                      dy={6}
                      interval="preserveStartEnd"
                      minTickGap={8}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tick={{ fill: 'var(--sw-muted)', fontSize: 12 }}
                      tickFormatter={(v: number) => formatMoneyCompact(v, fmt)}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--sw-subtle)' }}
                      content={(p) => <TrendTooltip row={p.payload?.[0]?.payload as TrendRow | undefined} fmt={fmt} />}
                    />
                    <ReferenceLine y={0} stroke="var(--sw-border)" />
                    <Bar dataKey="income" name={SERIES.income.label} fill={`url(#inc-${ids})`} radius={[4, 4, 0, 0]} maxBarSize={24} {...CHART_MOTION} />
                    <Bar dataKey="expenses" name={SERIES.expenses.label} fill={`url(#exp-${ids})`} radius={[4, 4, 0, 0]} maxBarSize={24} {...CHART_MOTION} />
                    <Line
                      dataKey="net"
                      name={SERIES.net.label}
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
              </motion.div>
            )}
          </AnimatePresence>

          {totals && (
            <Totals
              items={[
                { label: 'Income', value: formatMoney(totals.incomeMinor, fmt) },
                { label: 'Expenses', value: formatMoney(totals.expensesMinor, fmt) },
                {
                  label: 'Net',
                  value: formatMoney(totals.netMinor, fmt, { signed: true }),
                  tone: totals.netMinor < 0 ? 'text-expense' : totals.netMinor > 0 ? 'text-income' : '',
                },
                { label: 'Savings rate', value: formatPct(totals.savingsRatePct) },
              ]}
            />
          )}
        </div>
      )}
    </Panel>
  );
}
