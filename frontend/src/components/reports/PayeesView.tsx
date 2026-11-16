import { motion } from 'framer-motion';
import { Search, Store } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useIncomeReport, useSpendingReport } from '../../hooks/useReports';
import { formatMoney, formatPct, type MoneyFormat } from '../../lib/format';
import { transactionsLink } from '../../lib/reportFilters';
import type { PayeeRow } from '../../types/reports';
import { Segmented, stagger } from '../dashboard/ui';
import { CONTROL } from '../ui/Dialog';
import { RankedBars, SERIES } from './charts';
import { DataTable, ReportPanel, StatTile, TileRow } from './common';
import { ReportState } from './ReportState';

export type PayeeSide = 'expense' | 'income';
const SIDES = [
  { id: 'expense', label: 'Who I pay' },
  { id: 'income', label: 'Who pays me' },
] as const;

function Breakdown({ rows, total, side, fmt, onOpen }: { rows: PayeeRow[]; total: number; side: PayeeSide; fmt: MoneyFormat; onOpen: (p: PayeeRow) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => (needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows), [rows, needle]);
  const top3 = rows.slice(0, 3).reduce((n, r) => n + r.amountMinor, 0);
  const color = side === 'expense' ? SERIES.expenses.color : SERIES.income.color;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <TileRow>
        <StatTile label={side === 'expense' ? 'Paid out' : 'Received'} value={formatMoney(total, fmt)} tone={side === 'expense' ? 'expense' : 'income'} />
        <StatTile label="Payees" value={rows.length.toLocaleString(fmt.locale)} />
        <StatTile label="Top payee" value={rows[0] ? rows[0].name : '—'} hint={rows[0] ? `${formatMoney(rows[0].amountMinor, fmt)} · ${formatPct(rows[0].sharePct)}` : undefined} />
        <StatTile label="Top 3 share" value={total > 0 ? formatPct(Math.round((top3 * 1000) / total) / 10) : '—'} hint="How concentrated it is" />
      </TileRow>

      <ReportPanel
        title={side === 'expense' ? 'Payee breakdown' : 'Income sources'}
        icon={Store}
        subtitle="Click a payee to see its transactions in this period."
        action={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a payee" aria-label="Find a payee" className={`${CONTROL} h-9 w-44 pl-9 text-sm`} />
          </div>
        }
        chart={
          <RankedBars
            limit={15}
            color={color}
            fmt={fmt}
            empty={<p className="py-6 text-center text-sm text-muted">No payee matches “{q}”.</p>}
            rows={shown.map((p) => ({
              id: String(p.payeeId),
              label: p.name,
              value: p.amountMinor,
              sharePct: p.sharePct,
              detail: `${p.count} × · avg ${formatMoney(Math.round(p.amountMinor / Math.max(1, p.count)), fmt)}`,
              onSelect: p.payeeId === null ? undefined : () => onOpen(p),
            }))}
          />
        }
        table={
          <DataTable
            caption="Payees with amount, share, number of transactions and average"
            head={[{ label: 'Payee' }, { label: 'Amount', align: 'right' }, { label: 'Share', align: 'right' }, { label: 'Count', align: 'right' }, { label: 'Average', align: 'right' }]}
            rows={shown.map((p) => [
              p.name,
              formatMoney(p.amountMinor, fmt),
              formatPct(p.sharePct),
              p.count.toLocaleString(fmt.locale),
              formatMoney(Math.round(p.amountMinor / Math.max(1, p.count)), fmt),
            ])}
          />
        }
      />
    </motion.div>
  );
}

export function PayeesView({ qs, fmt, account, side, onSide }: { qs: string; fmt: MoneyFormat; account: number | null; side: PayeeSide; onSide: (s: PayeeSide) => void }) {
  const spending = useSpendingReport(qs, side === 'expense');
  const income = useIncomeReport(qs, side === 'income');
  const navigate = useNavigate();

  return (
    <div className="space-y-5">
      <Segmented options={SIDES} value={side} onChange={onSide} label="Payments out or in" layoutId="payee-side" />
      {side === 'expense' ? (
        <ReportState query={spending} isEmpty={(d) => !d.byPayee.length} emptyTitle="No spending in this period">
          {spending.data && (
            <Breakdown
              rows={spending.data.byPayee}
              total={spending.data.totalMinor}
              side="expense"
              fmt={fmt}
              onOpen={(p) => navigate(transactionsLink(spending.data!.period, { payee: p.payeeId, type: 'expense' }, account))}
            />
          )}
        </ReportState>
      ) : (
        <ReportState query={income} isEmpty={(d) => !d.sources.length} emptyTitle="No income in this period">
          {income.data && (
            <Breakdown
              rows={income.data.sources}
              total={income.data.totalMinor}
              side="income"
              fmt={fmt}
              onOpen={(p) => navigate(transactionsLink(income.data!.period, { payee: p.payeeId, type: 'income' }, account))}
            />
          )}
        </ReportState>
      )}
    </div>
  );
}
