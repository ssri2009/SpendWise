import { motion } from 'framer-motion';
import { HeartPulse } from 'lucide-react';
import { useId, useMemo } from 'react';
import { useAccounts, useBudgetMonth, useCashflow, useMoneyFormat, useNetWorth } from '../../hooks/useDashboard';
import { formatMoney } from '../../lib/format';
import { computeHealthScore, GRADE_LABEL, type HealthFactor, type HealthGrade } from '../../lib/healthScore';
import { AnimatedNumber, ErrorState, Panel, Skeleton, svgId } from './ui';

const GRADE_TONE: Record<HealthGrade, string> = {
  excellent: 'text-income',
  good: 'text-accent',
  fair: 'text-warning',
  attention: 'text-expense',
};

const RADIUS = 70;
const STROKE = 12;
const SIZE = (RADIUS + STROKE) * 2;

function Gauge({ score, grade }: { score: number | null; grade: HealthGrade | null }) {
  const gradientId = svgId(`health-${useId()}`);
  const progress = score === null ? 0 : score / 100;

  return (
    <div className="relative mx-auto grid size-44 place-items-center">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--sw-accent)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--sw-accent-2)' }} />
          </linearGradient>
        </defs>
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} style={{ stroke: 'var(--sw-subtle)' }} />
          <motion.circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            stroke={`url(#${gradientId})`}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: progress }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          />
        </g>
      </svg>
      <div className="relative text-center">
        <p className="text-5xl font-extrabold tracking-tight">
          {score === null ? '—' : <AnimatedNumber value={score} format={(n) => String(n)} />}
        </p>
        <p className={`mt-1 text-sm font-semibold ${grade ? GRADE_TONE[grade] : 'text-muted'}`}>
          {grade ? GRADE_LABEL[grade] : 'Not enough data'}
        </p>
      </div>
    </div>
  );
}

function FactorRow({ factor, index }: { factor: HealthFactor; index: number }) {
  const pct = factor.score === null ? 0 : Math.round(factor.score * 100);
  const bar =
    factor.score === null ? '' : factor.score >= 0.8 ? 'bg-income' : factor.score >= 0.5 ? 'accent-gradient' : factor.score >= 0.3 ? 'bg-warning' : 'bg-expense';

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{factor.label}</span>
        <span className={`tabular-nums ${factor.score === null ? 'text-muted' : 'font-semibold'}`}>{factor.value}</span>
      </div>
      <div
        className={`mt-1.5 h-1.5 overflow-hidden rounded-full ${factor.score === null ? 'border border-dashed border-line' : 'bg-subtle'}`}
        role="meter"
        aria-label={`${factor.label} score`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={factor.score === null ? undefined : pct}
        aria-valuetext={factor.score === null ? factor.value : `${pct} out of 100`}
      >
        {factor.score !== null && (
          <motion.div
            className={`h-full rounded-full ${bar}`}
            initial={{ width: 0 }}
            animate={{ width: `${Math.max(pct, 3)}%` }}
            transition={{ duration: 0.8, delay: 0.3 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{factor.hint}</p>
    </li>
  );
}

export function HealthScoreCard({ month, className = '' }: { month: string; className?: string }) {
  const fmt = useMoneyFormat();
  const cashflow = useCashflow('last-6-months');
  const accounts = useAccounts();
  const budget = useBudgetMonth(month);
  const netWorth = useNetWorth(6);

  const queries = [cashflow, accounts, budget, netWorth];
  const loading = queries.some((q) => q.isPending);
  const allFailed = queries.every((q) => q.isError);

  const health = useMemo(
    () =>
      computeHealthScore({
        // Only use the 6-month report here, never data kept from another range.
        cashflow: cashflow.isPlaceholderData ? undefined : cashflow.data,
        accounts: accounts.data,
        budget: budget.data,
        netWorth: netWorth.data,
        currentMonth: month,
        money: (m, signed) => formatMoney(m, fmt, { signed }),
      }),
    [cashflow.data, cashflow.isPlaceholderData, accounts.data, budget.data, netWorth.data, month, fmt],
  );

  return (
    <Panel title="Financial health" icon={HeartPulse} className={className}>
      {loading ? (
        <div className="space-y-5">
          <Skeleton className="mx-auto size-44 rounded-full" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : allFailed ? (
        <ErrorState error={cashflow.error} onRetry={() => queries.forEach((q) => q.refetch())} />
      ) : (
        <>
          <Gauge score={health.score} grade={health.grade} />
          <ul className="mt-6 space-y-4">
            {health.factors.map((f, i) => (
              <FactorRow key={f.id} factor={f} index={i} />
            ))}
          </ul>
          <p className="mt-5 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
            Weighted from your last 3 full months of cash flow, today's balances, this month's budget and 6 months of net worth.
          </p>
        </>
      )}
    </Panel>
  );
}
