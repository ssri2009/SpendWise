import { motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, CheckCircle2, PiggyBank, Tags, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useBudgetMonth, useMoneyFormat } from '../../hooks/useDashboard';
import { formatMoney, monthName } from '../../lib/format';
import type { BudgetMonth } from '../../types/api';
import { EmptyState, ErrorState, Panel, Skeleton } from './ui';

const TOP_ENVELOPES = 5;

interface EnvelopeRow {
  id: number;
  name: string;
  icon: string;
  pool: number;
  spent: number;
  available: number;
  ratio: number;
  overspent: boolean;
}

function envelopes(b: BudgetMonth): EnvelopeRow[] {
  return b.groups
    .filter((g) => !g.hidden)
    .flatMap((g) => g.categories.filter((c) => !c.hidden))
    .filter((c) => c.assignedMinor !== 0 || c.activityMinor !== 0 || c.carryInMinor !== 0)
    .map((c) => {
      const pool = c.carryInMinor + c.assignedMinor;
      const spent = -c.activityMinor; // activity is negative for spending
      return {
        id: c.id,
        name: c.name,
        icon: c.icon,
        pool,
        spent,
        available: c.availableMinor,
        ratio: pool > 0 ? spent / pool : spent > 0 ? Number.POSITIVE_INFINITY : 0,
        overspent: c.overspent,
      };
    })
    .sort((a, b) => Number(b.overspent) - Number(a.overspent) || b.ratio - a.ratio || b.spent - a.spent)
    .slice(0, TOP_ENVELOPES);
}

function barTone(row: EnvelopeRow) {
  if (row.overspent) return 'bg-expense';
  if (row.ratio >= 0.85) return 'bg-warning';
  return 'accent-gradient';
}

export function BudgetHealthCard({ month, className = '' }: { month: string; className?: string }) {
  const fmt = useMoneyFormat();
  const query = useBudgetMonth(month);
  const b = query.data;
  const rows = useMemo(() => (b ? envelopes(b) : []), [b]);

  const pool = b ? b.availableMinor - b.activityMinor : 0;
  const spent = b ? -b.activityMinor : 0;
  const usedPct = pool > 0 ? Math.min(100, Math.max(0, Math.round((spent / pool) * 100))) : 0;
  const isEmpty = b && pool <= 0 && b.activityMinor === 0 && b.overspentCount === 0 && b.toBudgetMinor === 0;

  const status = !b
    ? null
    : b.overspentCount > 0
      ? {
          tone: 'warn' as const,
          text: `${b.overspentCount} envelope${b.overspentCount === 1 ? '' : 's'} overspent by ${formatMoney(b.overspentMinor, fmt)}`,
        }
      : b.toBudgetMinor < 0
        ? { tone: 'warn' as const, text: `Over-assigned by ${formatMoney(-b.toBudgetMinor, fmt)}` }
        : b.toBudgetMinor > 0
          ? { tone: 'info' as const, text: `${formatMoney(b.toBudgetMinor, fmt)} ready to assign` }
          : { tone: 'good' as const, text: 'Every rupee has a job' };

  return (
    <Panel
      title="Budget health"
      icon={PiggyBank}
      className={className}
      action={
        <Link to="/budget" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
          Open budget <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
    >
      {query.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-3" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !b || isEmpty ? (
        <EmptyState icon={Wallet} title={`No budget for ${monthName(month, fmt.locale)} yet`}>
          <Link to="/budget" className="font-medium text-accent hover:underline">
            Assign money to your categories
          </Link>{' '}
          to see how each envelope is doing.
        </EmptyState>
      ) : (
        <>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs text-muted">To budget</p>
              <p className={`text-2xl font-bold tabular-nums ${b.toBudgetMinor < 0 ? 'text-expense' : ''}`}>{formatMoney(b.toBudgetMinor, fmt)}</p>
            </div>
            <div className="text-right text-xs text-muted">
              <p>
                <span className="font-semibold text-fg tabular-nums">{formatMoney(spent, fmt)}</span> spent
              </p>
              <p>
                of <span className="tabular-nums">{formatMoney(pool, fmt)}</span> budgeted
              </p>
            </div>
          </div>

          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-subtle"
            role="meter"
            aria-label="Budget used this month"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usedPct}
          >
            <motion.div
              className={`h-full rounded-full ${b.overspentCount > 0 ? 'bg-expense' : usedPct >= 85 ? 'bg-warning' : 'accent-gradient'}`}
              initial={{ width: 0 }}
              animate={{ width: `${usedPct}%` }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>

          {status && (
            <p
              className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
                status.tone === 'warn' ? 'bg-expense/10 text-expense' : status.tone === 'good' ? 'bg-income/10 text-income' : 'bg-accent/10 text-accent'
              }`}
            >
              {status.tone === 'warn' ? <AlertTriangle className="size-4 shrink-0" aria-hidden /> : <CheckCircle2 className="size-4 shrink-0" aria-hidden />}
              {status.text}
            </p>
          )}

          {rows.length > 0 && (
            <ul className="mt-4 space-y-3">
              {rows.map((r, i) => {
                const width = r.pool > 0 ? Math.min(100, Math.max(0, (r.spent / r.pool) * 100)) : r.spent > 0 ? 100 : 0;
                return (
                  <li key={r.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden>{r.icon}</span>
                        <span className="truncate">{r.name}</span>
                      </span>
                      <span className={`shrink-0 text-xs font-semibold tabular-nums ${r.available < 0 ? 'text-expense' : 'text-muted'}`}>
                        {r.available < 0 ? `${formatMoney(-r.available, fmt)} over` : `${formatMoney(r.available, fmt)} left`}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden>
                      <motion.div
                        className={`h-full rounded-full ${barTone(r)}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${width}%` }}
                        transition={{ duration: 0.7, delay: 0.15 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {b.uncategorizedCount > 0 && (
            <Link
              to="/transactions?category=none"
              className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted transition-colors hover:bg-subtle hover:text-fg"
            >
              <Tags className="size-4 shrink-0" aria-hidden />
              <span>
                {formatMoney(b.uncategorizedSpendMinor, fmt)} spent across {b.uncategorizedCount} uncategorised transaction
                {b.uncategorizedCount === 1 ? '' : 's'}
              </span>
            </Link>
          )}
        </>
      )}
    </Panel>
  );
}
