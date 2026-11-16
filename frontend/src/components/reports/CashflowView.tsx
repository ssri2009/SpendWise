import { motion } from 'framer-motion';
import { ArrowLeftRight, PiggyBank } from 'lucide-react';
import { useCashflowReport } from '../../hooks/useReports';
import { formatMoney, formatPct, type MoneyFormat } from '../../lib/format';
import { stagger } from '../dashboard/ui';
import { CashflowChart, ColumnChart, SERIES } from './charts';
import { DataTable, ReportPanel, StatTile, TileRow } from './common';
import { ReportState } from './ReportState';

const PER = { month: 'month', quarter: 'quarter', year: 'year' } as const;

export function CashflowView({ qs, fmt }: { qs: string; fmt: MoneyFormat }) {
  const q = useCashflowReport(qs);
  const r = q.data;

  return (
    <ReportState query={q} isEmpty={(d) => d.totals.incomeMinor === 0 && d.totals.expensesMinor === 0} emptyTitle="No money in or out in this period">
      {r && (
        <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
          <TileRow>
            <StatTile label="Income" value={formatMoney(r.totals.incomeMinor, fmt)} tone="income" />
            <StatTile label="Expenses" value={formatMoney(r.totals.expensesMinor, fmt)} tone="expense" />
            <StatTile
              label="Net cash flow"
              value={formatMoney(r.totals.netMinor, fmt, { signed: true })}
              hint={`Average ${formatMoney(r.totals.averageNetPerPeriodMinor, fmt, { signed: true })} per ${PER[r.granularity]}`}
              tone={r.totals.netMinor < 0 ? 'expense' : 'income'}
            />
            <StatTile label="Savings rate" value={formatPct(r.totals.savingsRatePct)} hint="Net ÷ income" tone="accent" />
          </TileRow>

          <ReportPanel
            title="Money in vs money out"
            icon={ArrowLeftRight}
            subtitle={
              r.best && r.worst
                ? `Best ${PER[r.granularity]}: ${r.best.label} (${formatMoney(r.best.net, fmt, { signed: true })}). Weakest: ${r.worst.label} (${formatMoney(r.worst.net, fmt, { signed: true })}).`
                : undefined
            }
            chart={
              <CashflowChart
                fmt={fmt}
                data={r.periods.map((p) => ({ key: p.key, label: p.label, income: p.incomeMinor, expenses: p.expensesMinor, net: p.netMinor, rate: p.savingsRatePct }))}
              />
            }
            table={
              <DataTable
                caption="Income, expenses, net cash flow and savings rate per period"
                head={[
                  { label: 'Period' },
                  { label: 'Income', align: 'right' },
                  { label: 'Expenses', align: 'right' },
                  { label: 'Net', align: 'right' },
                  { label: 'Savings rate', align: 'right' },
                ]}
                rows={r.periods.map((p) => [
                  p.label,
                  formatMoney(p.incomeMinor, fmt),
                  formatMoney(p.expensesMinor, fmt),
                  <span key="n" className={`font-semibold ${p.netMinor < 0 ? 'text-expense' : p.netMinor > 0 ? 'text-income' : ''}`}>
                    {formatMoney(p.netMinor, fmt, { signed: true })}
                  </span>,
                  formatPct(p.savingsRatePct),
                ])}
              />
            }
          />

          <ReportPanel
            title="Added to savings"
            icon={PiggyBank}
            subtitle={
              r.savingsAccounts > 0
                ? `Change in your ${r.savingsAccounts} savings / investment account${r.savingsAccounts === 1 ? '' : 's'}: ${formatMoney(r.totals.savedMinor, fmt, { signed: true })} in this period.`
                : 'You have no savings or investment accounts yet. Add one in Settings to track what you put aside.'
            }
            chart={
              r.savingsAccounts > 0 ? (
                <ColumnChart
                  data={r.periods.map((p) => ({ key: p.key, label: p.label, value: p.savedMinor }))}
                  color={SERIES.net.color}
                  name="Saved"
                  fmt={fmt}
                  height={220}
                  ariaLabel={`Money added to savings per ${PER[r.granularity]}. Use the table view for exact figures.`}
                />
              ) : (
                <p className="text-sm text-muted">Nothing to show.</p>
              )
            }
            table={
              <DataTable
                caption="Money added to savings and investment accounts per period"
                head={[{ label: 'Period' }, { label: 'Saved', align: 'right' }]}
                rows={r.periods.map((p) => [p.label, formatMoney(p.savedMinor, fmt, { signed: true })])}
              />
            }
          />
        </motion.div>
      )}
    </ReportState>
  );
}
