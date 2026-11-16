import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, useMe } from '../lib/api';
import { DEFAULT_MONEY_FORMAT, type MoneyFormat } from '../lib/format';
import type {
  AccountsResponse,
  BudgetMonth,
  CashflowReport,
  InsightsResponse,
  MonthlySummary,
  NetWorthReport,
  TransactionsResponse,
} from '../types/api';

export type TrendRange = 'last-6-months' | 'last-12-months' | 'this-year';

/** Every dashboard query lives under ['dashboard'], so one invalidate refreshes the whole page. */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  accounts: () => [...dashboardKeys.all, 'accounts'] as const,
  summary: () => [...dashboardKeys.all, 'monthly-summary'] as const,
  cashflow: (range: TrendRange) => [...dashboardKeys.all, 'cashflow', range] as const,
  budget: (month: string) => [...dashboardKeys.all, 'budget', month] as const,
  recent: (limit: number, to: string) => [...dashboardKeys.all, 'recent-transactions', limit, to] as const,
  insights: () => [...dashboardKeys.all, 'insights'] as const,
  netWorth: (months: number) => [...dashboardKeys.all, 'net-worth', months] as const,
};

const withQuery = (path: string, params: Record<string, string | number>) =>
  `${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`;

/** The signed-in user's currency and locale (falls back to INR / en-IN while loading). */
export function useMoneyFormat(): MoneyFormat {
  const { data } = useMe();
  return useMemo<MoneyFormat>(
    () => (data ? { locale: data.locale || DEFAULT_MONEY_FORMAT.locale, currency: data.currency || DEFAULT_MONEY_FORMAT.currency } : DEFAULT_MONEY_FORMAT),
    [data],
  );
}

/** Accounts with balances, plus Total Funds (every account's balance, all filters ignored). */
export function useAccounts() {
  return useQuery({
    queryKey: dashboardKeys.accounts(),
    queryFn: ({ signal }) => api.get<AccountsResponse>('/api/accounts', signal),
  });
}

/** This month so far, compared with the same days last month. */
export function useMonthlySummary() {
  return useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: ({ signal }) => api.get<MonthlySummary>('/api/reports/monthly-summary', signal),
  });
}

/** Income, expenses and net per month. */
export function useCashflow(range: TrendRange) {
  return useQuery({
    queryKey: dashboardKeys.cashflow(range),
    queryFn: ({ signal }) => api.get<CashflowReport>(withQuery('/api/reports/cashflow', { range, granularity: 'month' }), signal),
    placeholderData: keepPreviousData,
  });
}

/** One month of the envelope budget. */
export function useBudgetMonth(month: string) {
  return useQuery({
    queryKey: dashboardKeys.budget(month),
    queryFn: ({ signal }) => api.get<BudgetMonth>(`/api/budget/${month}`, signal),
  });
}

/** Newest transactions up to and including `to` (so future-dated scheduled items don't crowd the list). */
export function useRecentTransactions(limit: number, to: string) {
  return useQuery({
    queryKey: dashboardKeys.recent(limit, to),
    queryFn: ({ signal }) => api.get<TransactionsResponse>(withQuery('/api/transactions', { limit, to }), signal),
  });
}

/** Plain-language findings, warnings first. */
export function useInsights() {
  return useQuery({
    queryKey: dashboardKeys.insights(),
    queryFn: ({ signal }) => api.get<InsightsResponse>('/api/reports/insights', signal),
  });
}

/** Net worth at the end of each of the last `months` months, then today. */
export function useNetWorth(months: number) {
  return useQuery({
    queryKey: dashboardKeys.netWorth(months),
    queryFn: ({ signal }) => api.get<NetWorthReport>(withQuery('/api/reports/net-worth', { months }), signal),
  });
}
