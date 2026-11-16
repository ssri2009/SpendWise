import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CashflowReportFull, CategoriesReport, IncomeReport, SpendingReport } from '../types/reports';

/* Read-only reports (server/routes/reports.js). Keyed by the exact API query string, so a filter
   change is a new cache entry and the previous result stays on screen (dimmed) while it loads. */

export type ReportKind = 'spending' | 'income' | 'cashflow' | 'categories';

export const reportKeys = {
  all: ['reports'] as const,
  one: (kind: ReportKind, qs: string) => ['reports', kind, qs] as const,
};

function useReport<T>(kind: ReportKind, qs: string, enabled: boolean) {
  return useQuery({
    queryKey: reportKeys.one(kind, qs),
    queryFn: ({ signal }) => api.get<T>(`/api/reports/${kind}?${qs}`, signal),
    placeholderData: keepPreviousData,
    // Re-check whenever a report opens: transactions edited elsewhere (or scheduled ones the server
    // posted) change the numbers. The cached copy still shows instantly.
    staleTime: 0,
    enabled,
  });
}

export const useSpendingReport = (qs: string, enabled = true) => useReport<SpendingReport>('spending', qs, enabled);
export const useIncomeReport = (qs: string, enabled = true) => useReport<IncomeReport>('income', qs, enabled);
export const useCashflowReport = (qs: string, enabled = true) => useReport<CashflowReportFull>('cashflow', qs, enabled);

/** `category` (id | 'none') adds the drill-down for that category. */
export function useCategoriesReport(qs: string, category: number | 'none' | null, enabled = true) {
  const full = category === null ? qs : `${qs}&category=${category}`;
  return useReport<CategoriesReport>('categories', full, enabled);
}

/** Same query string + format=csv: the server sends the report as a spreadsheet file. */
export const reportCsvUrl = (kind: ReportKind, qs: string) => `/api/reports/${kind}?${qs}&format=csv`;
