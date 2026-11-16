import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, Layers, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCategoriesReport } from '../../hooks/useReports';
import { formatDate, formatMoney, formatPct, type MoneyFormat } from '../../lib/format';
import { transactionsLink } from '../../lib/reportFilters';
import type { CategoryCompareRow } from '../../types/reports';
import { Delta, Segmented, Skeleton, stagger } from '../dashboard/ui';
import { ColumnChart, RankedBars, SERIES, ShareBar, shareParts } from './charts';
import { DataTable, ReportPanel, StatTile, TileRow } from './common';
import { ReportState } from './ReportState';

type Side = 'expense' | 'income';
const SIDES = [
  { id: 'expense', label: 'Spending' },
  { id: 'income', label: 'Income' },
] as const;

const keyOf = (id: number | null): number | 'none' => (id === null ? 'none' : id);

export function CategoriesView({
  qs,
  fmt,
  account,
  colorOf,
  side,
  onSide,
}: {
  qs: string;
  fmt: MoneyFormat;
  account: number | null;
  colorOf: (id: number | null) => string;
  side: Side;
  onSide: (s: Side) => void;
}) {
  const [picked, setPicked] = useState<number | 'none' | null>(null);
  const q = useCategoriesReport(qs, null);
  // The drill-down is its own request, so picking a category doesn't dim the whole report.
  const drill = useCategoriesReport(qs, picked ?? 'none', picked !== null);
  const r = q.data;
  const data = r?.[side];
  const color = side === 'expense' ? SERIES.expenses.color : SERIES.income.color;
  const d = (iso: string) => formatDate(iso, fmt.locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const prevLabel = r ? `Previous period (${d(r.previous.from)} – ${d(r.previous.to)})` : 'Previous period';
  const change = data ? data.totalMinor - data.previousTotalMinor : 0;
  const changePct = data && data.previousTotalMinor ? Math.round(((data.totalMinor - data.previousTotalMinor) * 1000) / data.previousTotalMinor) / 10 : null;
  const dd = drill.data?.detail;
  const detail = dd && picked !== null && keyOf(dd.categoryId) === picked && !drill.isPlaceholderData ? dd : null;

  const rowsFor = (rows: CategoryCompareRow[]) =>
    rows.map((c) => ({
      id: String(c.categoryId),
      label: c.name,
      icon: c.icon,
      value: c.amountMinor,
      previous: c.previousMinor,
      sharePct: c.sharePct,
      detail: c.groupName,
      swatch: colorOf(c.categoryId),
      selected: picked === keyOf(c.categoryId),
      onSelect: () => setPicked((p) => (p === keyOf(c.categoryId) ? null : keyOf(c.categoryId))),
    }));

  return (
    <ReportState query={q} isEmpty={(x) => !x.expense.rows.length && !x.income.rows.length} emptyTitle="No categorized activity in this period">
      {r && data && (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented options={SIDES} value={side} onChange={(s) => { onSide(s); setPicked(null); }} label="Spending or income" layoutId="cat-side" />
            <p className="text-xs text-muted">Compared with {d(r.previous.from)} – {d(r.previous.to)}</p>
          </div>

          <TileRow>
            <StatTile label={side === 'expense' ? 'Spent' : 'Received'} value={formatMoney(data.totalMinor, fmt)} tone={side === 'expense' ? 'expense' : 'income'} />
            <StatTile label="Previous period" value={formatMoney(data.previousTotalMinor, fmt)} />
            <StatTile
              label="Change"
              value={`${formatMoney(change, fmt, { signed: true })}`}
              hint={changePct === null ? 'Nothing to compare with' : formatPct(changePct, { signed: true })}
            />
            <StatTile label="Categories" value={String(data.rows.filter((x) => x.amountMinor > 0).length)} hint={`Over ${r.months.toLocaleString(fmt.locale)} months`} />
          </TileRow>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <ReportPanel
              title="Category breakdown"
              icon={Layers}
              subtitle="Bars: this period. Tick: the previous period. Click a category for details."
              chart={
                <>
                  <ShareBar parts={shareParts(data.rows, colorOf)} total={data.totalMinor} fmt={fmt} />
                  <div className="mt-5">
                    <RankedBars rows={rowsFor(data.rows)} color={color} fmt={fmt} limit={12} previousLabel={prevLabel} />
                  </div>
                </>
              }
              table={
                <DataTable
                  caption="Categories this period and the previous period"
                  head={[
                    { label: 'Category' },
                    { label: 'This period', align: 'right' },
                    { label: 'Previous', align: 'right' },
                    { label: 'Change', align: 'right' },
                    { label: 'Share', align: 'right' },
                    { label: 'Per month', align: 'right' },
                  ]}
                  rows={data.rows.map((c) => [
                    `${c.icon} ${c.name}`,
                    formatMoney(c.amountMinor, fmt),
                    formatMoney(c.previousMinor, fmt),
                    <Delta
                      key="d"
                      value={c.changePct}
                      display={c.changePct === null ? 'new' : formatPct(c.changePct, { signed: true })}
                      goodWhen={side === 'expense' ? 'down' : 'up'}
                      label="vs previous period"
                    />,
                    formatPct(c.sharePct),
                    formatMoney(c.averagePerMonthMinor, fmt),
                  ])}
                />
              }
            />

            <AnimatePresence mode="wait">
              {picked === null ? (
                <motion.div key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass grid min-h-64 place-items-center rounded-3xl border border-dashed border-line p-6 text-center text-sm text-muted">
                  <p>
                    Pick a category on the left to see it over time,
                    <br />
                    its top payees and its largest transactions.
                  </p>
                </motion.div>
              ) : !detail ? (
                <Skeleton key="loading" className="min-h-64 rounded-3xl" />
              ) : (
                <motion.div key={String(picked)} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                  <ReportPanel
                    title={
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-sm" style={{ background: colorOf(detail.categoryId) }} aria-hidden />
                        {detail.icon} {detail.name}
                      </span>
                    }
                    subtitle={`${formatMoney(detail.totalMinor, fmt)} ${detail.kind === 'expense' ? 'spent' : 'received'} in this period`}
                    action={
                      <button type="button" onClick={() => setPicked(null)} aria-label="Close details" className="grid size-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg">
                        <X className="size-4" aria-hidden />
                      </button>
                    }
                  >
                    <ColumnChart
                      data={detail.overTime.map((b) => ({ key: b.key, label: b.label, value: b.amountMinor }))}
                      color={detail.kind === 'expense' ? SERIES.expenses.color : SERIES.income.color}
                      name={detail.name}
                      fmt={fmt}
                      height={200}
                      ariaLabel={`${detail.name} per period`}
                    />
                    <h4 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wider text-muted">Top payees</h4>
                    <RankedBars
                      color={detail.kind === 'expense' ? SERIES.expenses.color : SERIES.income.color}
                      fmt={fmt}
                      rows={detail.topPayees.map((p) => ({ id: String(p.payeeId), label: p.name, value: p.amountMinor, detail: `${p.count} ×` }))}
                      empty={<p className="text-sm text-muted">No payees.</p>}
                    />
                    <h4 className="mb-1 mt-5 text-xs font-bold uppercase tracking-wider text-muted">Largest</h4>
                    <ul className="divide-y divide-line">
                      {detail.largest.map((l) => (
                        <li key={l.txId} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{l.payee}</span>
                            <span className="block truncate text-xs text-muted">
                              {d(l.date)} · {l.account}
                              {l.notes ? ` · ${l.notes}` : ''}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">{formatMoney(l.amountMinor, fmt)}</span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      to={transactionsLink(r.period, { category: keyOf(detail.categoryId) }, account)}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                    >
                      See all {detail.name} transactions <ArrowUpRight className="size-3.5" aria-hidden />
                    </Link>
                  </ReportPanel>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </ReportState>
  );
}
