import { motion } from 'framer-motion';
import { CalendarRange, Coins, Tags, TrendingUp, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useIncomeReport } from '../../hooks/useReports';
import { formatMoney, formatPct, type MoneyFormat } from '../../lib/format';
import { transactionsLink } from '../../lib/reportFilters';
import { Delta, stagger } from '../dashboard/ui';
import { ColumnChart, RankedBars, SERIES } from './charts';
import { DataTable, ReportPanel, StatTile, TileRow } from './common';
import { ReportState } from './ReportState';

const PER = { month: 'month', quarter: 'quarter', year: 'year' } as const;
const TREND = { up: 'Rising', down: 'Falling', flat: 'Steady' } as const;

export function IncomeView({ qs, fmt, account, colorOf }: { qs: string; fmt: MoneyFormat; account: number | null; colorOf: (id: number | null) => string }) {
  const q = useIncomeReport(qs);
  const navigate = useNavigate();
  const r = q.data;
  const thisYear = r?.yearly.find((y) => y.partial);

  return (
    <ReportState query={q} isEmpty={(d) => d.totalMinor === 0 && d.transactionCount === 0} emptyTitle="No income in this period">
      {r && (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
          <TileRow>
            <StatTile label="Total income" value={formatMoney(r.totalMinor, fmt)} hint={`${r.transactionCount.toLocaleString(fmt.locale)} transactions`} tone="income" />
            <StatTile label={`Average per ${PER[r.granularity]}`} value={formatMoney(r.averagePerPeriodMinor, fmt)} hint={`${r.overTime.length} ${PER[r.granularity]}s`} />
            <StatTile
              label="Trend"
              value={`${TREND[r.trend.direction]}${r.trend.changePct !== null ? ` ${formatPct(r.trend.changePct, { signed: true })}` : ''}`}
              hint={r.overTime.length >= 4 ? 'Second half vs first half' : 'Needs 4+ periods'}
              tone={r.trend.direction === 'up' ? 'income' : r.trend.direction === 'down' ? 'expense' : undefined}
            />
            <StatTile
              label={`Best / lowest ${PER[r.granularity]}`}
              value={r.highest ? formatMoney(r.highest.amountMinor, fmt) : '—'}
              hint={r.highest && r.lowest ? `${r.highest.label} · lowest ${r.lowest.label} (${formatMoney(r.lowest.amountMinor, fmt)})` : undefined}
            />
          </TileRow>

          <ReportPanel
            title="Income over time"
            icon={TrendingUp}
            subtitle={`Per ${PER[r.granularity]}. The line marks the average.`}
            chart={
              <ColumnChart
                data={r.overTime.map((b) => ({ key: b.key, label: b.label, value: b.amountMinor }))}
                color={SERIES.income.color}
                name="Income"
                fmt={fmt}
                average={r.averagePerPeriodMinor}
                ariaLabel={`Income per ${PER[r.granularity]}, ${r.overTime.length} columns. Use the table view for exact figures.`}
              />
            }
            table={
              <DataTable
                caption="Income per period"
                head={[{ label: 'Period' }, { label: 'Income', align: 'right' }]}
                rows={r.overTime.map((b) => [b.label, formatMoney(b.amountMinor, fmt)])}
              />
            }
          />

          <div className="grid gap-5 xl:grid-cols-2">
            <ReportPanel title="Income sources" icon={Wallet} subtitle="By payee. Click one to see its transactions.">
              <RankedBars
                limit={8}
                color={SERIES.income.color}
                fmt={fmt}
                rows={r.sources.map((s) => ({
                  id: String(s.payeeId),
                  label: s.name,
                  value: s.amountMinor,
                  sharePct: s.sharePct,
                  detail: `${s.count} ×`,
                  onSelect: s.payeeId === null ? undefined : () => navigate(transactionsLink(r.period, { payee: s.payeeId, type: 'income' }, account)),
                }))}
              />
            </ReportPanel>
            <ReportPanel title="By category" icon={Tags}>
              <RankedBars
                limit={8}
                color={SERIES.income.color}
                fmt={fmt}
                rows={r.byCategory.map((c) => ({
                  id: String(c.categoryId),
                  label: c.name,
                  icon: c.icon,
                  value: c.amountMinor,
                  sharePct: c.sharePct,
                  swatch: colorOf(c.categoryId),
                  onSelect: () => navigate(transactionsLink(r.period, { category: c.categoryId ?? 'none', type: 'income' }, account)),
                }))}
              />
            </ReportPanel>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <ReportPanel title="Month by month" icon={CalendarRange} subtitle="Calendar months, compared with the month before.">
              <div className="max-h-96 overflow-auto">
                <DataTable
                  caption="Income per calendar month and change from the month before"
                  head={[{ label: 'Month' }, { label: 'Income', align: 'right' }, { label: 'Change', align: 'right' }]}
                  rows={[...r.monthly].reverse().map((m) => [
                    <span key="m">
                      {m.label}
                      {m.partial && <span className="ml-1 text-xs font-normal text-muted">(so far)</span>}
                    </span>,
                    formatMoney(m.incomeMinor, fmt),
                    <Delta key="d" value={m.changePct} display={m.changePct === null ? '—' : formatPct(m.changePct, { signed: true })} label="vs the month before" />,
                  ])}
                />
              </div>
            </ReportPanel>
            <ReportPanel
              title="Year by year"
              icon={Coins}
              subtitle={
                thisYear && thisYear.previousSamePeriodMinor !== undefined
                  ? `${thisYear.year} so far: ${formatMoney(thisYear.incomeMinor, fmt)} vs ${formatMoney(thisYear.previousSamePeriodMinor, fmt)} by this date last year (${formatPct(thisYear.samePeriodChangePct ?? null, { signed: true })}).`
                  : 'Whole calendar years (up to the last ten).'
              }
              chart={
                <ColumnChart
                  data={r.yearly.map((y) => ({ key: String(y.year), label: `${y.year}${y.partial ? ' (so far)' : ''}`, value: y.incomeMinor }))}
                  color={SERIES.income.color}
                  name="Income"
                  fmt={fmt}
                  height={220}
                  ariaLabel={`Income per year for ${r.yearly.length} years. Use the table view for exact figures.`}
                />
              }
              table={
                <DataTable
                  caption="Income per year"
                  head={[{ label: 'Year' }, { label: 'Income', align: 'right' }, { label: 'Change', align: 'right' }]}
                  rows={r.yearly.map((y) => [
                    `${y.year}${y.partial ? ' (so far)' : ''}`,
                    formatMoney(y.incomeMinor, fmt),
                    y.changePct === null ? '—' : formatPct(y.changePct, { signed: true }),
                  ])}
                />
              }
            />
          </div>
        </motion.div>
      )}
    </ReportState>
  );
}
