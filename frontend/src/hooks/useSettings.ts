import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Account, AccountType, CategoriesResponse } from '../types/api';
import { budgetKeys } from './useBudget';
import { dashboardKeys } from './useDashboard';
import { scheduleKeys } from './useSchedules';
import { afterTransactionWrite } from './useTransactions';

/* ---------------------------------------------------------------------
   Settings writes: accounts (server/routes/accounts.js) and the parts of
   categories the budget screen doesn't do (server/routes/categories.js):
   income groups, merge, delete with "move to", delete group, group order.
   --------------------------------------------------------------------- */

/** Account names, balances and on/off budget show up almost everywhere. */
function afterAccountWrite(qc: QueryClient) {
  afterTransactionWrite(qc); // dashboard (accounts), transactions, payees
  void qc.invalidateQueries({ queryKey: budgetKeys.allMonths });
  void qc.invalidateQueries({ queryKey: scheduleKeys.all });
  void qc.invalidateQueries({ queryKey: ['reports'] });
  void qc.invalidateQueries({ queryKey: ['forecast'] });
  void qc.invalidateQueries({ queryKey: ['bills'] });
  void qc.invalidateQueries({ queryKey: ['calendar'] });
  void qc.invalidateQueries({ queryKey: ['reconcile'] });
}

/** Moving transactions between categories changes budgets, reports, payees, rules and schedules. */
function afterCategoryMove(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: budgetKeys.categories });
  void qc.invalidateQueries({ queryKey: budgetKeys.allMonths });
  void qc.invalidateQueries({ queryKey: dashboardKeys.all });
  afterTransactionWrite(qc);
  void qc.invalidateQueries({ queryKey: ['reports'] });
  void qc.invalidateQueries({ queryKey: ['rules'] });
  void qc.invalidateQueries({ queryKey: scheduleKeys.all });
}

export interface AccountInput {
  name: string;
  type: AccountType;
  offbudget: boolean;
  openingBalanceMinor: number;
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountInput) => api.post<{ account: Account }>('/api/accounts', input),
    onSuccess: () => afterAccountWrite(qc),
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<AccountInput> & { closed?: boolean } }) =>
      api.patch<{ account: Account }>(`/api/accounts/${id}`, patch),
    onSuccess: () => afterAccountWrite(qc),
  });
}

/** Only an account with no transactions and no schedules (the server says which, otherwise). */
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/accounts/${id}`),
    onSuccess: () => afterAccountWrite(qc),
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; isIncome: boolean }) => api.post<CategoriesResponse>('/api/category-groups', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: budgetKeys.categories });
      void qc.invalidateQueries({ queryKey: budgetKeys.allMonths });
    },
  });
}

/** Every group id, in the new order. */
export function useReorderGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.post<CategoriesResponse>('/api/category-groups/reorder', { ids }),
    onSuccess: (r) => {
      qc.setQueryData(budgetKeys.categories, r);
      void qc.invalidateQueries({ queryKey: budgetKeys.allMonths });
    },
  });
}

/** Only an empty group. */
export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<CategoriesResponse>(`/api/category-groups/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: budgetKeys.categories });
      void qc.invalidateQueries({ queryKey: budgetKeys.allMonths });
    },
  });
}

/** Everything in the category (transactions, splits, budget money, payee defaults, rules, schedules) moves to the target. */
export function useMergeCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, targetId }: { id: number; targetId: number }) => api.post<CategoriesResponse>(`/api/categories/${id}/merge`, { targetId }),
    onSuccess: () => afterCategoryMove(qc),
  });
}

/** moveTo: a category id, 'none' (leave its transactions uncategorized), or null when it has none. */
export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, moveTo }: { id: number; moveTo: number | 'none' | null }) =>
      api.delete<CategoriesResponse>(`/api/categories/${id}${moveTo === null ? '' : `?moveTo=${moveTo}`}`),
    onSuccess: () => afterCategoryMove(qc),
  });
}
