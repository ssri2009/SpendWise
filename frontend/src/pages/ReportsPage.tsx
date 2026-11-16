import { motion } from 'framer-motion';
import { ArrowLeftRight, Layers, Store, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { NavLink, Navigate, useParams, useSearchParams } from 'react-router';
import { CashflowView } from '../components/reports/CashflowView';
import { CategoriesView } from '../components/reports/CategoriesView';
import { useCategoryColors } from '../components/reports/charts';
import { CsvButton } from '../components/reports/common';
import { IncomeView } from '../components/reports/IncomeView';
import { PayeesView, type PayeeSide } from '../components/reports/PayeesView';
import { ReportFilterBar } from '../components/reports/ReportFilters';
import { SpendingView } from '../components/reports/SpendingView';
import { rise, Skeleton, stagger } from '../components/dashboard/ui';
import { useMoneyFormat } from '../hooks/useDashboard';
import {
  reportCsvUrl,
  useCashflowReport,
  useCategoriesReport,
  useIncomeReport,
  useSpendingReport,
  type ReportKind,
} from '../hooks/useReports';
import { useAccountList, useCategoryTree } from '../hooks/useTransactions';
import { readReportFilters, reportApiParams, reportFiltersToUrl, type ReportFilters } from '../lib/reportFilters';
import type { ReportPeriod } from '../types/reports';

type Tab = 'spending' | 'income' | 'cash-flow' | 'categories' | 'payees';

const TABS: { id: Tab; label: string; icon: LucideIcon; blurb: string }[] = [
  { id: 'spending', label: 'Spending', icon: TrendingDown, blurb: 'Where your money went, and when.' },
  { id: 'income', label: 'Income', icon: TrendingUp, blurb: 'What came in, from whom, and the trend.' },
  { id: 'cash-flow', label: 'Cash flow', icon: ArrowLeftRight, blurb: 'Money in against money out, and what you kept.' },
  { id: 'categories', label: 'Categories', icon: Layers, blurb: 'Every category against the period before.' },
  { id: 'payees', label: 'Payees', icon: Store, blurb: 'Who you pay most, and who pays you.' },
];
const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

/** /reports → Spending; /reports/<tab>?range=…&granularity=…&account=…&cats=… */
export default function ReportsPage() {
  const tab = useParams()['*']?.split('/')[0] || 'spending';
  const [params] = useSearchParams();
  if (!TAB_IDS.has(tab)) return <Navigate to={`/reports${params.toString() ? `?${params}` : ''}`} replace />;
  return <ReportsScreen tab={tab as Tab} />;
}

function ReportsScreen({ tab }: { tab: Tab }) {
  const fmt = useMoneyFormat();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readReportFilters(params), [params]);
  const accountsQ = useAccountList();
  const groupsQ = useCategoryTree();
  const colorOf = useCategoryColors();
  const [catSide, setCatSide] = useState<'expense' | 'income'>('expense');
  const [payeeSide, setPayeeSide] = useState<PayeeSide>('expense');

  // Applied to the URL as it is now (URL changes render as a transition; see TransactionsPage).
  const updateFilters = useCallback(
    (update: (f: ReportFilters) => ReportFilters) =>
      setParams(reportFiltersToUrl(update(readReportFilters(new URLSearchParams(window.location.search)))), { replace: true }),
    [setParams],
  );

  const groups = groupsQ.data ?? [];
  // "Only these categories" is sent as exclude=<every other category>, so it needs the category list first.
  const ready = !filters.cats.length || groupsQ.isSuccess;
  const qs = ready ? reportApiParams(filters, groups).toString() : '';

  // Subscribe to the active tab's report (same cache entry as the view) for its resolved period.
  const sp = useSpendingReport(qs, ready && (tab === 'spending' || (tab === 'payees' && payeeSide === 'expense')));
  const inc = useIncomeReport(qs, ready && (tab === 'income' || (tab === 'payees' && payeeSide === 'income')));
  const cf = useCashflowReport(qs, ready && tab === 'cash-flow');
  const cat = useCategoriesReport(qs, null, ready && tab === 'categories');
  const period: ReportPeriod | undefined = (
    tab === 'spending' ? sp.data : tab === 'income' ? inc.data : tab === 'cash-flow' ? cf.data : tab === 'categories' ? cat.data : payeeSide === 'expense' ? sp.data : inc.data
  )?.period;

  const csvKind: ReportKind =
    tab === 'cash-flow' ? 'cashflow' : tab === 'payees' ? (payeeSide === 'expense' ? 'spending' : 'income') : (tab as ReportKind);
  const info = TABS.find((t) => t.id === tab)!;
  const search = params.toString() ? `?${params}` : '';

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={rise}>
        <p className="text-sm text-muted">{info.blurb}</p>
        <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">{info.label} report</h2>
      </motion.div>

      <motion.nav variants={rise} aria-label="Reports" className="-mx-1 overflow-x-auto px-1 pb-1">
        <div role="tablist" className="flex w-max gap-1 rounded-2xl bg-subtle p-1">
          {TABS.map((t) => (
            <NavLink
              key={t.id}
              role="tab"
              aria-selected={t.id === tab}
              to={t.id === 'spending' ? `/reports${search}` : `/reports/${t.id}${search}`}
              className={`relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
                t.id === tab ? 'text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {t.id === tab && (
                <motion.span
                  layoutId="report-tab"
                  className="absolute inset-0 rounded-xl bg-elevated shadow-sm ring-1 ring-line"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
                />
              )}
              <t.icon className="relative size-4" aria-hidden />
              <span className="relative">{t.label}</span>
            </NavLink>
          ))}
        </div>
      </motion.nav>

      <motion.div variants={rise}>
        <ReportFilterBar
          filters={filters}
          onChange={updateFilters}
          accounts={accountsQ.data?.accounts ?? []}
          groups={groups}
          period={period}
          fmt={fmt}
          extra={ready && <CsvButton href={reportCsvUrl(csvKind, qs)} label="Export CSV" />}
        />
      </motion.div>

      <div role="tabpanel" aria-label={info.label}>
        {!ready ? (
          <Skeleton className="h-96 rounded-3xl" />
        ) : tab === 'spending' ? (
          <SpendingView qs={qs} fmt={fmt} account={filters.account} colorOf={colorOf} />
        ) : tab === 'income' ? (
          <IncomeView qs={qs} fmt={fmt} account={filters.account} colorOf={colorOf} />
        ) : tab === 'cash-flow' ? (
          <CashflowView qs={qs} fmt={fmt} />
        ) : tab === 'categories' ? (
          <CategoriesView qs={qs} fmt={fmt} account={filters.account} colorOf={colorOf} side={catSide} onSide={setCatSide} />
        ) : (
          <PayeesView qs={qs} fmt={fmt} account={filters.account} side={payeeSide} onSide={setPayeeSide} />
        )}
      </div>
    </motion.div>
  );
}
