import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Payee } from '../types/api';
import { scheduleKeys } from './useSchedules';
import { afterTransactionWrite } from './useTransactions';

/* ---------------------------------------------------------------------
   Payee writes (server/routes/payees.js). The list itself is the shared
   usePayees() query (GET /api/payees?status=all&sort=usage&limit=1000),
   so the transaction form, filters and this page stay in step.
   --------------------------------------------------------------------- */

/** A payee's name shows up on transactions, schedules, rules and reports: refresh them all. */
export function afterPayeeWrite(queryClient: QueryClient) {
  afterTransactionWrite(queryClient); // transactions + payees + dashboard
  void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
  void queryClient.invalidateQueries({ queryKey: ['bills'] });
  void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  void queryClient.invalidateQueries({ queryKey: ['forecast'] });
  void queryClient.invalidateQueries({ queryKey: ['reports'] });
  void queryClient.invalidateQueries({ queryKey: ['rules'] });
}

export interface PayeePatch {
  name?: string;
  /** null clears it. */
  defaultCategoryId?: number | null;
  archived?: boolean;
}

export function useCreatePayee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; defaultCategoryId: number | null }) => api.post<{ payee: Payee }>('/api/payees', body),
    onSuccess: () => afterPayeeWrite(queryClient),
  });
}

export function useUpdatePayee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: PayeePatch }) => api.patch<{ payee: Payee }>(`/api/payees/${id}`, patch),
    onSuccess: () => afterPayeeWrite(queryClient),
  });
}

/**
 * Merge several payees into one, one request each (POST /api/payees/:id/merge). Transactions, rules and
 * schedules move to the target; the merged payees are removed. Stops at the first failure and reports how far it got.
 */
export function useMergePayees() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sourceIds, targetId }: { sourceIds: number[]; targetId: number }) => {
      let moved = 0;
      let merged = 0;
      try {
        for (const id of sourceIds) {
          const r = await api.post<{ payee: Payee; moved: number }>(`/api/payees/${id}/merge`, { targetId });
          moved += r.moved;
          merged += 1;
        }
      } catch (err) {
        if (merged > 0) afterPayeeWrite(queryClient);
        throw Object.assign(err instanceof Error ? err : new Error(String(err)), { merged });
      }
      return { moved, merged };
    },
    onSuccess: () => afterPayeeWrite(queryClient),
  });
}

/** Only works for a payee nothing uses (no transactions, rules or schedules); the server says why otherwise. */
export function useDeletePayee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/payees/${id}`),
    onSuccess: () => afterPayeeWrite(queryClient),
  });
}

/* ---------- duplicate finder ---------- */

const NOISE = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'co', 'company', 'corp', 'the', 'india', 'in', 'www', 'com', 'online', 'store', 'payments', 'pay']);

/** "SWIGGY*Bangalore 4521" and "Swiggy" → "swiggy": lower case, no punctuation, no numbers, no company suffixes. */
export function payeeKey(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^\d+$/.test(w) && !NOISE.has(w));
  return words.slice(0, 2).join(' ');
}

/** Groups of two or more payees whose names look like the same business. Most used first in each group. */
export function findDuplicates(payees: Payee[]): Payee[][] {
  const groups = new Map<string, Payee[]>();
  for (const p of payees) {
    const k = payeeKey(p.name);
    if (k.length < 3) continue;
    const first = k.split(' ')[0];
    // Group on the first word when it is distinctive enough ("swiggy", "amazon"), else on the first two.
    const key = first.length >= 5 ? first : k;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name)))
    .sort((a, b) => b.length - a.length || b[0].usageCount - a[0].usageCount);
}
