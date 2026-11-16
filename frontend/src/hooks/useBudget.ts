import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { BudgetMonth, BudgetTransfer, CategoriesResponse } from '../types/api';
import { dashboardKeys } from './useDashboard';

/* ---------------------------------------------------------------------
   Budget data (server/routes/budget.js, server/routes/categories.js).
   The month view shares its cache key with the dashboard, so an edit here
   shows up on the dashboard's budget card without a refetch.
   --------------------------------------------------------------------- */

export const budgetKeys = {
  month: (month: string) => dashboardKeys.budget(month),
  allMonths: [...dashboardKeys.all, 'budget'] as const,
  transfers: (scope: string) => ['budget-transfers', scope] as const,
  transfersAll: ['budget-transfers'] as const,
  categories: ['categories'] as const,
};

/** GET /api/budget/:month. Keeps the previous month on screen while the next one loads. */
export function useBudgetView(month: string) {
  return useQuery({
    queryKey: budgetKeys.month(month),
    queryFn: ({ signal }) => api.get<BudgetMonth>(`/api/budget/${month}`, signal),
    placeholderData: keepPreviousData,
    // Always re-check when the page opens: the server posts due scheduled transactions on its own,
    // so a copy cached by the dashboard may be behind. The cached copy still shows instantly.
    staleTime: 0,
  });
}

/** GET /api/budget-transfers[?month=]: the move-money audit trail, newest first. */
export function useTransfers(month: string | null, enabled: boolean) {
  return useQuery({
    queryKey: budgetKeys.transfers(month ?? 'all'),
    queryFn: ({ signal }) =>
      api.get<{ transfers: BudgetTransfer[] }>(`/api/budget-transfers${month ? `?month=${month}` : '?limit=200'}`, signal),
    enabled,
    select: (d) => d.transfers,
  });
}

/**
 * After any budget write: keep the month the server just returned, and refresh everything
 * it can ripple into (later months' To Budget, the dashboard summary and insights).
 */
function afterBudgetWrite(queryClient: QueryClient, month: string, view?: BudgetMonth) {
  if (view) queryClient.setQueryData(budgetKeys.month(month), view);
  void queryClient.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey;
      if (k[0] === 'budget-transfers') return true;
      if (k[0] !== dashboardKeys.all[0]) return false;
      return !(view && k[1] === 'budget' && k[2] === month);
    },
  });
}

/** After a category/group change: every budget month and the category tree are stale. */
function afterCategoryWrite(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: budgetKeys.allMonths });
  void queryClient.invalidateQueries({ queryKey: budgetKeys.categories });
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
}

/* ---------- envelope writes ---------- */

/** PATCH /api/budget/:month/categories/:id { assignedMinor } → the whole month. */
export function useAssign(month: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, assignedMinor }: { categoryId: number; assignedMinor: number }) =>
      api.patch<BudgetMonth>(`/api/budget/${month}/categories/${categoryId}`, { assignedMinor }),
    onSuccess: (view) => afterBudgetWrite(queryClient, month, view),
  });
}

/** PATCH /api/budget/:month/categories/:id { carryover }: roll overspending forward from this month on. */
export function useCarryover(month: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, carryover }: { categoryId: number; carryover: boolean }) =>
      api.patch<BudgetMonth>(`/api/budget/${month}/categories/${categoryId}`, { carryover }),
    onSuccess: (view) => afterBudgetWrite(queryClient, month, view),
  });
}

export interface TransferInput {
  fromCategoryId: number;
  toCategoryId: number;
  amountMinor: number;
  note: string;
}

/** POST /api/budget/:month/transfers → 201 { transferId, budget }. */
export function useTransfer(month: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TransferInput) =>
      api.post<{ transferId: number; budget: BudgetMonth }>(`/api/budget/${month}/transfers`, input),
    onSuccess: (r) => afterBudgetWrite(queryClient, month, r.budget),
  });
}

/* ---------- categories and groups ---------- */

export interface CategoryPatch {
  name?: string;
  icon?: string;
  hidden?: boolean;
  groupId?: number;
}

export function useCategoryWrites() {
  const queryClient = useQueryClient();
  const done = () => afterCategoryWrite(queryClient);

  const createCategory = useMutation({
    mutationFn: (input: { groupId: number; name: string; icon?: string }) =>
      api.post<CategoriesResponse & { category: { id: number } }>('/api/categories', input),
    onSuccess: done,
  });
  const updateCategory = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: CategoryPatch }) => api.patch<CategoriesResponse>(`/api/categories/${id}`, patch),
    onSuccess: done,
  });
  const createGroup = useMutation({
    mutationFn: (name: string) => api.post<CategoriesResponse>('/api/category-groups', { name }),
    onSuccess: done,
  });
  const updateGroup = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { name?: string; hidden?: boolean } }) =>
      api.patch<CategoriesResponse>(`/api/category-groups/${id}`, patch),
    onSuccess: done,
  });
  /** POST /api/categories/reorder { items: [{ id, groupId, sortOrder }] }. */
  const reorderCategories = useMutation({
    mutationFn: (items: { id: number; groupId: number; sortOrder: number }[]) =>
      api.post<CategoriesResponse>('/api/categories/reorder', { items }),
    onSuccess: done,
  });
  /**
   * POST /api/category-groups/reorder { ids } must list EVERY group, income groups included,
   * and the budget view leaves income groups out, so read the full tree first.
   */
  const moveGroup = useMutation({
    mutationFn: async ({ id, dir, visibleIds }: { id: number; dir: -1 | 1; visibleIds: number[] }) => {
      const { groups } = await api.get<CategoriesResponse>('/api/categories');
      const neighbour = visibleIds[visibleIds.indexOf(id) + dir];
      if (neighbour === undefined || !groups.some((g) => g.id === id)) return { groups };
      // Place it next to the visible neighbour; income and hidden groups keep their relative spots.
      const ids = groups.map((g) => g.id).filter((g) => g !== id);
      const at = ids.indexOf(neighbour);
      ids.splice(dir < 0 ? at : at + 1, 0, id);
      return api.post<CategoriesResponse>('/api/category-groups/reorder', { ids });
    },
    onSuccess: done,
  });

  return { createCategory, updateCategory, createGroup, updateGroup, reorderCategories, moveGroup };
}
