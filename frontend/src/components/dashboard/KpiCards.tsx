import type { UseQueryResult } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowDownCircle, ArrowUpCircle, Landmark, Scale, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { formatMoney, formatPct, type MoneyFormat } from '../../lib/format';
import { CHART_MOTION_LINE } from '../../lib/motion';
import type { AccountsResponse, MonthlySummary, NetWorthReport } from '../../types/api';
import { AnimatedNumber, Delta, ErrorState, rise, Skeleton, svgId } from './ui';

type Tone = 'accent' | 'income' | 'expense' | 'neutral';

const TONE: Record<Tone, { icon: string; glow: string; value: string }> = {
  accent: { icon: 'bg-accent/12 text-accent', glow: 'accent-gradient', value: 'text-fg' },
  income: { icon: 'bg-income/12 text-income', glow: 'bg-income', value: 'text-income' },
  expense: { icon: 'bg-expense/12 text-expense', glow: 'bg-expense', value: 'text-expense' },
  neutral: { icon: 'bg-subtle text-muted', glow: 'bg-muted', value: 'text-fg' },
};

interface StatCardProps {
  label: string;
  icon: LucideIcon;
  tone: Tone;
  valueMinor: number | undefined;
  fmt: MoneyFormat;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  footer?: ReactNode;
  extra?: ReactNode;
  signed?: boolean;
}

function StatCard({ label, icon: Icon, tone, valueMinor, fmt, loading, error, onRetry, footer, extra, signed }: StatCardProps) {
  const t = TONE[tone];
  return (
    <motion.article
      variants={rise}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
      className="glass relative flex min-h-[10.5rem] flex-col overflow-hidden rounded-3xl border border-line p-5 shadow-glass"
    >
      <div className={`pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-20 blur-2xl ${t.glow}`} />
      <div className="relative flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-muted">{label}</h3>
        <span className={`grid size-9 place-items-center rounded-xl ${t.icon}`}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </div>

      <div className="relative mt-3 min-h-10">
        {loading ? (
          <Skeleton className="h-9 w-40" />
        ) : error ? (
          <ErrorState error={error} onRetry={onRetry} compact />
        ) : valueMinor !== undefined ? (
          <p className={`text-[1.75rem] font-bold leading-tight tracking-tight sm:text-3xl ${t.value}`}>
            <AnimatedNumber value={valueMinor} format={(n) => formatMoney(n, fmt, { signed })} />
          </p>
        ) : null}
      </div>

      <div className="relative mt-auto flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 pt-3 text-xs text-muted">
        {loading ? <Skeleton className="h-4 w-32" /> : !error && footer}
      </div>
      {!loading && !error && extra}
    </motion.article>
  );
}

/* ------------------------------------------------------------------ */

function Sparkline({ values }: { values: number[] }) {
  const gradientId = svgId(`spark-${useId()}`);
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 opacity-70" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--sw-accent)', stopOpacity: 0.35 }} />
              <stop offset="100%" style={{ stopColor: 'var(--sw-accent)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area type="monotone" dataKey="v" stroke="var(--sw-accent)" strokeWidth={2} fill={`url(#${gradientId})`} {...CHART_MOTION_LINE} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TotalFundsCard({
  accounts,
  netWorth,
  fmt,
}: {
  accounts: UseQueryResult<AccountsResponse>;
  netWorth: UseQueryResult<NetWorthReport>;
  fmt: MoneyFormat;
}) {
  const open = accounts.data?.accounts.filter((a) => !a.closed).length ?? 0;
  const change = netWorth.data?.change.sinceLastMonthEndMinor ?? null;

  return (
    <StatCard
      label="Total funds"
      icon={Landmark}
      tone="accent"
      valueMinor={accounts.data?.totalFundsMinor}
      fmt={fmt}
      loading={accounts.isPending}
      error={accounts.error}
      onRetry={() => accounts.refetch()}
      footer={
        open === 0 ? (
          <Link to="/settings" className="font-medium text-accent hover:underline">
            Add your first account
          </Link>
        ) : (
          <>
            {change !== null && (
              <Delta value={change} display={formatMoney(change, fmt, { signed: true })} label="since the end of last month" />
            )}
            <span>
              {change !== null ? 'since month end · ' : ''}
              {open} account{open === 1 ? '' : 's'}
            </span>
          </>
        )
      }
      extra={<Sparkline values={netWorth.data?.series.map((p) => p.netWorthMinor) ?? []} />}
    />
  );
}

function compareLabel(s: MonthlySummary) {
  return `vs ${s.comparedWith.sameDays ? 'same days in ' : ''}${s.comparedWith.label}`;
}

export function IncomeCard({ summary, fmt }: { summary: UseQueryResult<MonthlySummary>; fmt: MoneyFormat }) {
  const s = summary.data;
  return (
    <StatCard
      label="Income this month"
      icon={ArrowDownCircle}
      tone="income"
      valueMinor={s?.incomeMinor}
      fmt={fmt}
      loading={summary.isPending}
      error={summary.error}
      onRetry={() => summary.refetch()}
      footer={
        s && (
          <>
            <Delta value={s.changes.incomePct ?? (s.changes.incomeMinor || null)} display={s.changes.incomePct !== null ? formatPct(s.changes.incomePct, { signed: true }) : formatMoney(s.changes.incomeMinor, fmt, { signed: true })} label={compareLabel(s)} />
            <span>{compareLabel(s)}</span>
          </>
        )
      }
    />
  );
}

export function ExpensesCard({ summary, fmt }: { summary: UseQueryResult<MonthlySummary>; fmt: MoneyFormat }) {
  const s = summary.data;
  return (
    <StatCard
      label="Expenses this month"
      icon={ArrowUpCircle}
      tone="expense"
      valueMinor={s?.expensesMinor}
      fmt={fmt}
      loading={summary.isPending}
      error={summary.error}
      onRetry={() => summary.refetch()}
      footer={
        s && (
          <>
            <Delta
              value={s.changes.expensesPct ?? (s.changes.expensesMinor || null)}
              display={s.changes.expensesPct !== null ? formatPct(s.changes.expensesPct, { signed: true }) : formatMoney(s.changes.expensesMinor, fmt, { signed: true })}
              goodWhen="down"
              label={compareLabel(s)}
            />
            <span>
              {compareLabel(s)} · {formatMoney(s.averageDailyExpenseMinor, fmt)}/day
            </span>
          </>
        )
      }
    />
  );
}

export function NetCashFlowCard({ summary, fmt }: { summary: UseQueryResult<MonthlySummary>; fmt: MoneyFormat }) {
  const s = summary.data;
  const tone: Tone = !s || s.netMinor === 0 ? 'neutral' : s.netMinor > 0 ? 'income' : 'expense';
  return (
    <StatCard
      label="Net cash flow"
      icon={Scale}
      tone={tone}
      valueMinor={s?.netMinor}
      signed
      fmt={fmt}
      loading={summary.isPending}
      error={summary.error}
      onRetry={() => summary.refetch()}
      footer={
        s && (
          <>
            <Delta value={s.changes.netMinor || null} display={formatMoney(s.changes.netMinor, fmt, { signed: true })} label={compareLabel(s)} />
            <span>{s.savingsRatePct !== null ? `kept ${formatPct(s.savingsRatePct)} of income` : 'no income yet this month'}</span>
          </>
        )
      }
    />
  );
}
