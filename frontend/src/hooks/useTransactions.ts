import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { api } from '../lib/api';
import { filtersToParams, type TxFilters } from '../lib/txFilters';
import type {
  BulkChanges,
  CategoriesResponse,
  CsvCommitResult,
  CsvOptions,
  CsvPreview,
  PayeesResponse,
  RuleApplied,
  Transaction,
  TransactionInput,
  TransactionsResponse,
} from '../types/api';
import { budgetKeys } from './useBudget';
import { dashboardKeys } from './useDashboard';

/* ---------------------------------------------------------------------
   Transactions data (server/routes/transactions.js, payees.js,
   categories.js, accounts.js, csvimport.js).
   --------------------------------------------------------------------- */

export const PAGE_SIZE = 100;

export const txKeys = {
  all: ['transactions'] as const,
  list: (qs: string) => ['transactions', 'list', qs] as const,
  months: ['transactions', 'months'] as const,
  payees: ['payees'] as const,
};

/** GET /api/transactions?…&limit&offset, newest first, loaded a page at a time. */
export function useTransactionList(filters: TxFilters) {
  const qs = filtersToParams(filters).toString();
  return useInfiniteQuery({
    queryKey: txKeys.list(qs),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams(qs);
      p.set('limit', String(PAGE_SIZE));
      p.set('offset', String(pageParam));
      return api.get<TransactionsResponse>(`/api/transactions?${p}`, signal);
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, pg) => n + pg.transactions.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** Months that have transactions, newest first (GET /api/transactions/months). */
export function useTransactionMonths() {
  return useQuery({
    queryKey: txKeys.months,
    queryFn: ({ signal }) => api.get<{ months: string[] }>('/api/transactions/months', signal),
    select: (d) => d.months,
  });
}

/** Accounts with balances: the same query (and cache entry) as the dashboard's accounts card. */
export { useAccounts as useAccountList } from './useDashboard';

/** Category tree, income groups included. Same key the budget invalidates. */
export function useCategoryTree() {
  return useQuery({
    queryKey: budgetKeys.categories,
    queryFn: ({ signal }) => api.get<CategoriesResponse>('/api/categories', signal),
    select: (d) => d.groups,
  });
}

/** Every payee (active and archived, so old transactions can still be filtered), most used first. */
export function usePayees() {
  return useQuery({
    queryKey: txKeys.payees,
    queryFn: ({ signal }) => api.get<PayeesResponse>('/api/payees?status=all&sort=usage&limit=1000', signal),
    select: (d) => d.payees,
  });
}

/* ---------- writes ---------- */

/** A transaction touches balances, budget, reports, payees and the month list: refresh them all. */
export function afterTransactionWrite(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: txKeys.all });
  void queryClient.invalidateQueries({ queryKey: txKeys.payees });
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
  void queryClient.invalidateQueries({ queryKey: budgetKeys.transfersAll });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TransactionInput) =>
      api.post<{ transaction: Transaction; rulesApplied: RuleApplied[] }>('/api/transactions', input),
    onSuccess: () => afterTransactionWrite(queryClient),
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<TransactionInput> }) =>
      api.patch<{ transaction: Transaction }>(`/api/transactions/${id}`, patch),
    onSuccess: () => afterTransactionWrite(queryClient),
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/transactions/${id}`),
    onSuccess: () => afterTransactionWrite(queryClient),
  });
}

/** POST /api/transactions/bulk: { ids, action: 'delete' } or { ids, action: 'update', changes }. */
export function useBulkTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: number[]; action: 'delete' } | { ids: number[]; action: 'update'; changes: BulkChanges }) =>
      api.post<{ affected: number; skippedSplit?: number }>('/api/transactions/bulk', body),
    onSuccess: () => afterTransactionWrite(queryClient),
  });
}

/** POST /api/import/csv/preview: analyses the file, writes nothing. */
export function useCsvPreview() {
  return useMutation({
    mutationFn: (opts: CsvOptions) => api.post<CsvPreview>('/api/import/csv/preview', opts),
  });
}

/** POST /api/import/csv/commit: same options; imports what the analysis says to. */
export function useCsvCommit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (opts: CsvOptions) => api.post<CsvCommitResult>('/api/import/csv/commit', opts),
    onSuccess: () => {
      afterTransactionWrite(queryClient);
      // The import may have created categories ("Imported" group) or accounts.
      void queryClient.invalidateQueries({ queryKey: budgetKeys.categories });
    },
  });
}
