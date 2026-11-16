import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ReprocessOptions, ReprocessResult, Rule, RuleInput, RulesResponse } from '../types/rules';
import { afterTransactionWrite, txKeys } from './useTransactions';

/* ---------------------------------------------------------------------
   Rules data (server/routes/rules.js). Key ['rules'] is also refreshed
   by payee writes (a merge rewrites rules that point at the old payee).
   --------------------------------------------------------------------- */

export const ruleKeys = { all: ['rules'] as const };

/** GET /api/rules: every rule in execution order (position 1 runs first). */
export function useRules() {
  return useQuery({
    queryKey: ruleKeys.all,
    queryFn: ({ signal }) => api.get<RulesResponse>('/api/rules', signal),
    staleTime: 0,
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RuleInput) => api.post<{ rule: Rule }>('/api/rules', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ruleKeys.all });
      void qc.invalidateQueries({ queryKey: txKeys.payees });
    },
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<RuleInput> }) => api.patch<{ rule: Rule }>(`/api/rules/${id}`, patch),
    // Toggling "enabled" shows at once; the server's answer replaces it.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ruleKeys.all });
      const prev = qc.getQueryData<RulesResponse>(ruleKeys.all);
      if (prev && patch.enabled !== undefined && Object.keys(patch).length === 1) {
        qc.setQueryData<RulesResponse>(ruleKeys.all, { ...prev, rules: prev.rules.map((r) => (r.id === id ? { ...r, enabled: patch.enabled! } : r)) });
      }
      return { prev };
    },
    onError: (_e, _v, c) => {
      if (c?.prev) qc.setQueryData(ruleKeys.all, c.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ruleKeys.all });
      void qc.invalidateQueries({ queryKey: txKeys.payees });
    },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/rules/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ruleKeys.all });
      void qc.invalidateQueries({ queryKey: txKeys.payees }); // rule counts on the Payees page
    },
  });
}

/** POST /api/rules/reorder with every rule id, first = runs first. Moves at once; rolls back on error. */
export function useReorderRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) => api.post<{ rules: Rule[] }>('/api/rules/reorder', { ids }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: ruleKeys.all });
      const prev = qc.getQueryData<RulesResponse>(ruleKeys.all);
      if (prev) {
        const byId = new Map(prev.rules.map((r) => [r.id, r]));
        qc.setQueryData<RulesResponse>(ruleKeys.all, { ...prev, rules: ids.map((id, i) => ({ ...byId.get(id)!, position: i + 1 })) });
      }
      return { prev };
    },
    onError: (_e, _v, c) => {
      if (c?.prev) qc.setQueryData(ruleKeys.all, c.prev);
    },
    onSuccess: (r) => {
      const prev = qc.getQueryData<RulesResponse>(ruleKeys.all);
      if (prev) qc.setQueryData<RulesResponse>(ruleKeys.all, { ...prev, rules: r.rules });
    },
  });
}

/** POST /api/rules/reprocess. A preview (dryRun) writes nothing; applying changes transactions. */
export function useReprocess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: ReprocessOptions) => api.post<ReprocessResult>('/api/rules/reprocess', opts),
    onSuccess: (r) => {
      if (!r.dryRun && r.changed) {
        afterTransactionWrite(qc);
        void qc.invalidateQueries({ queryKey: ['reports'] });
      }
    },
  });
}
