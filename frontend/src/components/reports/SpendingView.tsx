import { motion } from 'framer-motion';
import { ArrowUpRight, Landmark, PieChart, ReceiptText, Store, TrendingDown } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useSpendingReport } from '../../hooks/useReports';
import { formatDate, formatMoney, formatPct, type MoneyFormat } from '../../lib/format';
import { transactionsLink } from '../../lib/reportFilters';
import { EmptyState, rise, stagger } from '../dashboard/ui';
import { ColumnChart, RankedBars, SERIES, ShareBar, shareParts } from './charts';
import { DataTable, ReportPanel, StatTile, TileRow } from './common';
import { ReportState } from './ReportState';

const PER = { month: 'month', quarter: 'quarter', year: 'year' } as const;

export function SpendingView({ qs, fmt, account, colorOf }: { qs: string; fmt: MoneyFormat; account: number | null; colorOf: (id: number | null) => string }) {
  const q = useSpendingReport(qs);
  const navigate = useNavigate();
  const r = q.data;

  return (
    <ReportState query={q} isEmpty={(d) => d.totalMinor === 0 && d.transactionCount === 0} emptyTitle="No spending in this period">
      {r && (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
          <TileRow>
            <StatTile label="Total spent" value={formatMoney(r.totalMinor, fmt)} hint={`${r.transactionCount.toLocaleString(fmt.locale)} transactions`} tone="expense" />
            <StatTile label="Average per day" value={formatMoney(r.averagePerDayMinor, fmt)} hint="Days so far in the period" />
            <StatTile label={`Average per ${PER[r.granularity]}`} value={formatMoney(r.averagePerPeriodMinor, fmt)} hint={`${r.overTime.length} ${PER[r.granularity]}s`} />
            <StatTile label={`Highest ${PER[r.granularity]}`} value={r.highest ? formatMoney(r.highest.amountMinor, fmt) : '—'} hint={r.highest?.label} />
          </TileRow>

          <ReportPanel
            title="Spending over time"
            icon={TrendingDown}
            subtitle={`Per ${PER[r.granularity]}. The line marks the average.`}
            chart={
              <ColumnChart
                data={r.overTime.map((b) => ({ key: b.key, label: b.label, value: b.amountMinor }))}
                color={SERIES.expenses.color}
                name="Spent"
                fmt={fmt}
                average={r.averagePerPeriodMinor}
                ariaLabel={`Spending per ${PER[r.granularity]}, ${r.overTime.length} columns. Use the table view for exact figures.`}
              />
            }
            table={
              <DataTable
                caption="Spending per period"
                head={[{ label: 'Period' }, { label: 'Spent', align: 'right' }]}
                rows={r.overTime.map((b) => [b.label, formatMoney(b.amountMinor, fmt)])}
              />
            }
          />

          <div className="grid gap-5 xl:grid-cols-2">
            <ReportPanel title="Where it went" icon={PieChart} subtitle="Share of spending by category. Click one to see its transactions.">
              <ShareBar parts={shareParts(r.byCategory, colorOf)} total={r.totalMinor} fmt={fmt} />
              <div className="mt-5">
                <RankedBars
                  limit={8}
                  color={SERIES.expenses.color}
                  fmt={fmt}
                  rows={r.byCategory.map((c) => ({
                    id: String(c.categoryId),
                    label: c.name,
                    icon: c.icon,
                    value: c.amountMinor,
                    sharePct: c.sharePct,
                    detail: c.groupName,
                    swatch: colorOf(c.categoryId),
                    onSelect: () => navigate(transactionsLink(r.period, { category: c.categoryId ?? 'none', type: 'expense' }, account)),
                  }))}
                />
              </div>
            </ReportPanel>

            <ReportPanel title="Top payees" icon={Store} subtitle="Who you paid most. Click one to see the transactions.">
              <RankedBars
                limit={8}
                color={SERIES.expenses.color}
                fmt={fmt}
                rows={r.byPayee.map((p) => ({
                  id: String(p.payeeId),
                  label: p.name,
                  value: p.amountMinor,
                  sharePct: p.sharePct,
                  detail: `${p.count} ×`,
                  onSelect: p.payeeId === null ? undefined : () => navigate(transactionsLink(r.period, { payee: p.payeeId, type: 'expense' }, account)),
                }))}
              />
            </ReportPanel>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <ReportPanel title="By account" icon={Landmark}>
              <RankedBars
                color={SERIES.expenses.color}
                fmt={fmt}
                rows={r.byAccount.map((a) => ({ id: String(a.accountId), label: a.name, value: a.amountMinor, sharePct: a.sharePct, detail: `${a.count} ×` }))}
              />
            </ReportPanel>
            <ReportPanel title="Largest expenses" icon={ReceiptText}>
              {r.biggest.length ? (
                <ul className="divide-y divide-line">
                  {r.biggest.map((b) => (
                    <motion.li key={`${b.txId}-${b.category}`} variants={rise} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{b.payee}</p>
                        <p className="truncate text-xs text-muted">
                          {formatDate(b.date, fmt.locale, { day: 'numeric', month: 'short', year: 'numeric' })} · {b.category} · {b.account}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(b.amountMinor, fmt)}</span>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={ReceiptText} title="Nothing here" />
              )}
              <Link to={transactionsLink(r.period, { type: 'expense' }, account)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                All expenses in this period <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            </ReportPanel>
          </div>
          <p className="text-center text-xs text-muted">
            Split transactions count each part in its own category. Biggest category: {r.byCategory[0] ? `${r.byCategory[0].name} (${formatPct(r.byCategory[0].sharePct)})` : '—'}.
          </p>
        </motion.div>
      )}
    </ReportState>
  );
}
