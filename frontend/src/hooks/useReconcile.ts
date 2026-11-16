import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ReconBalances, ReconcileInput, ReconState, ReconTransaction, Reconciliation } from '../types/reconcile';
import { afterTransactionWrite } from './useTransactions';

/* ---------------------------------------------------------------------
   Reconcile data (server/routes/reconcile.js). Clearing uses the normal
   bulk endpoint (POST /api/transactions/bulk, cleared only).
   --------------------------------------------------------------------- */

export const reconKeys = {
  all: ['reconcile'] as const,
  state: (accountId: number) => ['reconcile', 'state', accountId] as const,
  history: (accountId: number | null) => ['reconcile', 'history', accountId ?? 'all'] as const,
  detail: (id: number) => ['reconcile', 'detail', id] as const,
};

/** GET /api/accounts/:id/reconciliation: balances + the transactions not locked yet. */
export function useReconState(accountId: number | null) {
  return useQuery({
    queryKey: reconKeys.state(accountId ?? 0),
    queryFn: ({ signal }) => api.get<ReconState>(`/api/accounts/${accountId}/reconciliation`, signal),
    enabled: accountId !== null,
    staleTime: 0,
  });
}

/** GET /api/reconciliations[?account=]: history, newest first. */
export function useReconHistory(accountId: number | null) {
  return useQuery({
    queryKey: reconKeys.history(accountId),
    queryFn: ({ signal }) => api.get<{ reconciliations: Reconciliation[] }>(`/api/reconciliations${accountId === null ? '' : `?account=${accountId}`}`, signal),
    select: (d) => d.reconciliations,
    staleTime: 0,
  });
}

/** GET /api/reconciliations/:id: one reconciliation and the transactions it locked. */
export function useReconDetail(id: number | null) {
  return useQuery({
    queryKey: reconKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<{ reconciliation: Reconciliation; transactions: ReconTransaction[] }>(`/api/reconciliations/${id}`, signal),
    enabled: id !== null,
  });
}

/**
 * Mark transactions cleared / uncleared (500 per request). The list and the cleared balance move at once;
 * the server's numbers replace them when it answers.
 */
export function useSetCleared(accountId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, cleared }: { ids: number[]; cleared: boolean }) => {
      for (let i = 0; i < ids.length; i += 500) {
        await api.post('/api/transactions/bulk', { ids: ids.slice(i, i + 500), action: 'update', changes: { cleared } });
      }
    },
    onMutate: async ({ ids, cleared }) => {
      const key = reconKeys.state(accountId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ReconState>(key);
      if (prev) {
        const set = new Set(ids);
        let delta = 0;
        const transactions = prev.transactions.map((t) => {
          if (!set.has(t.id) || t.cleared === cleared) return t;
          delta += cleared ? t.amountMinor : -t.amountMinor;
          return { ...t, cleared };
        });
        qc.setQueryData<ReconState>(key, {
          ...prev,
          transactions,
          clearedBalanceMinor: prev.clearedBalanceMinor + delta,
          unclearedBalanceMinor: prev.unclearedBalanceMinor - delta,
        });
      }
      return { prev };
    },
    onError: (_e, _v, c) => {
      if (c?.prev) qc.setQueryData(reconKeys.state(accountId), c.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: reconKeys.state(accountId) });
      afterTransactionWrite(qc);
    },
  });
}

/** POST /api/accounts/:id/reconcile. 409 code "discrepancy" when it doesn't match and adjust is false. */
export function useFinishReconcile(accountId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReconcileInput) =>
      api.post<{ reconciliation: Reconciliation } & ReconBalances>(`/api/accounts/${accountId}/reconcile`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reconKeys.all });
      afterTransactionWrite(qc); // locks + maybe an adjustment transaction
    },
  });
}

/** DELETE /api/reconciliations/:id (newest of its account only): unlocks and removes the adjustment. */
export function useUndoReconcile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/reconciliations/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reconKeys.all });
      afterTransactionWrite(qc);
    },
  });
}
