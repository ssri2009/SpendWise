import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { RotateCw } from 'lucide-react';
import { useMemo } from 'react';
import { BudgetHealthCard } from '../components/dashboard/BudgetHealthCard';
import { HealthScoreCard } from '../components/dashboard/HealthScoreCard';
import { InsightsPanel } from '../components/dashboard/InsightsPanel';
import { ExpensesCard, IncomeCard, NetCashFlowCard, TotalFundsCard } from '../components/dashboard/KpiCards';
import { RecentTransactions } from '../components/dashboard/RecentTransactions';
import { SpendingTrendChart } from '../components/dashboard/SpendingTrendChart';
import { rise, stagger } from '../components/dashboard/ui';
import { dashboardKeys, useAccounts, useMoneyFormat, useMonthlySummary, useNetWorth } from '../hooks/useDashboard';
import { useMe } from '../lib/api';
import { greeting, localToday, monthName } from '../lib/format';

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const fmt = useMoneyFormat();
  const me = useMe();
  const today = useMemo(localToday, []);
  const month = today.slice(0, 7);

  const accounts = useAccounts();
  const summary = useMonthlySummary();
  const netWorth = useNetWorth(6);
  const fetching = useIsFetching({ queryKey: dashboardKeys.all }) > 0;

  const firstName = me.data?.displayName?.trim().split(/\s+/)[0];
  const s = summary.data;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            {greeting()}
            {firstName ? `, ${firstName}` : ''} 👋
          </p>
          <p className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
            {monthName(s?.month ?? month, fmt.locale)}
            {s?.isCurrent && (
              <span className="ml-2 align-middle text-sm font-normal text-muted">
                day {s.daysElapsed} of {s.daysInMonth}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: dashboardKeys.all })}
          disabled={fetching}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-70"
        >
          <RotateCw className={`size-4 ${fetching ? 'animate-spin' : ''}`} aria-hidden />
          {fetching ? 'Updating…' : 'Refresh'}
        </button>
      </motion.div>

      <div className="grid gap-6 xl:grid-cols-3">
        <HealthScoreCard month={month} className="xl:row-span-1" />
        <div className="grid content-start gap-4 sm:grid-cols-2 xl:col-span-2">
          <TotalFundsCard accounts={accounts} netWorth={netWorth} fmt={fmt} />
          <NetCashFlowCard summary={summary} fmt={fmt} />
          <IncomeCard summary={summary} fmt={fmt} />
          <ExpensesCard summary={summary} fmt={fmt} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <SpendingTrendChart className="xl:col-span-2" />
        <BudgetHealthCard month={month} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <RecentTransactions today={today} className="xl:col-span-2" />
        <InsightsPanel />
      </div>
    </motion.div>
  );
}
