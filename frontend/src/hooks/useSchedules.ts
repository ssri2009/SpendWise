import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  ForecastResponse,
  GeneratedSummary,
  HandleNextResponse,
  Occurrence,
  OccurrencesResponse,
  PayOverrides,
  ResumeResponse,
  ScheduleDetailResponse,
  ScheduleEvent,
  ScheduleInput,
  SchedulesResponse,
  ScheduleWriteResponse,
} from '../types/schedules';
import type { BillsResponse } from '../types/bills';
import type { CalendarResponse } from '../types/calendar';
import type { ForecastFullResponse } from '../types/forecast';
import { afterTransactionWrite } from './useTransactions';

/* ---------------------------------------------------------------------
   Schedules data (server/routes/schedules.js; upcoming dates across all
   schedules come from GET /api/forecast in server/routes/forecast.js).

   Every schedules read on the server first runs what is due, so reads
   can create transactions too: they are never cached for long.
   --------------------------------------------------------------------- */

export const scheduleKeys = {
  all: ['schedules'] as const,
  list: ['schedules', 'list'] as const,
  detail: (id: number) => ['schedules', 'detail', id] as const,
  queue: ['schedules', 'queue'] as const,
  upcoming: (days: number) => ['schedules', 'upcoming', days] as const,
};

/** GET /api/schedules?status=all – filtering by status happens on the page so every tab has a count. */
export function useScheduleList() {
  return useQuery({
    queryKey: scheduleKeys.list,
    queryFn: ({ signal }) => api.get<SchedulesResponse>('/api/schedules?status=all', signal),
    staleTime: 0,
  });
}

/** GET /api/schedules/:id: the schedule, its next 6 dates and its last 60 occurrences. */
export function useScheduleDetail(id: number | null) {
  return useQuery({
    queryKey: scheduleKeys.detail(id ?? 0),
    queryFn: ({ signal }) => api.get<ScheduleDetailResponse>(`/api/schedules/${id}`, signal),
    enabled: id !== null,
    staleTime: 0,
  });
}

/** GET /api/schedule-occurrences?status=pending: the approval queue, oldest first. */
export function useApprovalQueue() {
  return useQuery({
    queryKey: scheduleKeys.queue,
    queryFn: ({ signal }) => api.get<OccurrencesResponse>('/api/schedule-occurrences?status=pending&limit=500', signal),
    select: (d) => d.occurrences,
    staleTime: 0,
  });
}

/**
 * Every scheduled event in the next `days` days, income and expenses, across all schedules:
 * GET /api/forecast?days=N, keeping only events whose source is a schedule. Waiting-for-approval
 * items are included (moved to today when overdue, with the real due date in dueDate).
 */
export function useUpcoming(days: number) {
  return useQuery({
    queryKey: scheduleKeys.upcoming(days),
    queryFn: ({ signal }) => api.get<ForecastResponse>(`/api/forecast?days=${days}`, signal),
    select: (d): { events: ScheduleEvent[]; truncated: boolean; asOf: string } => ({
      events: d.forecast.events.filter((e) => e.source === 'schedule'),
      truncated: d.forecast.truncated,
      asOf: d.forecast.asOf,
    }),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/**
 * GET /api/bills?upcomingDays&paidDays&account: overdue, due and upcoming scheduled expenses, plus
 * what was paid or skipped recently. Invalidated by every schedule write (key starts with 'bills').
 */
export function useBills({ upcomingDays, paidDays, account }: { upcomingDays: number; paidDays: number; account: number | null }) {
  const p = new URLSearchParams({ upcomingDays: String(upcomingDays), paidDays: String(paidDays) });
  if (account !== null) p.set('account', String(account));
  const qs = p.toString();
  return useQuery({
    queryKey: ['bills', qs] as const,
    queryFn: ({ signal }) => api.get<BillsResponse>(`/api/bills?${qs}`, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** GET /api/calendar?month&account: every scheduled event in a month, by day (key starts with 'calendar'). */
export function useCalendar(month: string, account: number | null) {
  const p = new URLSearchParams({ month });
  if (account !== null) p.set('account', String(account));
  const qs = p.toString();
  return useQuery({
    queryKey: ['calendar', qs] as const,
    queryFn: ({ signal }) => api.get<CalendarResponse>(`/api/calendar?${qs}`, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** GET /api/forecast?days&account: the whole forecast (key starts with 'forecast', so schedule writes refresh it). */
export function useForecast(days: number, account: number | null) {
  const p = new URLSearchParams({ days: String(days) });
  if (account !== null) p.set('account', String(account));
  const qs = p.toString();
  return useQuery({
    queryKey: ['forecast', qs] as const,
    queryFn: ({ signal }) => api.get<ForecastFullResponse>(`/api/forecast?${qs}`, signal),
    select: (d) => d.forecast,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/* ---------- writes ---------- */

/** Refresh what a schedule write touches. `ledger`: it may have created transactions or payees (anything due runs straight away). */
export function afterScheduleWrite(queryClient: QueryClient, { ledger }: { ledger: boolean }) {
  void queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
  void queryClient.invalidateQueries({ queryKey: ['forecast'] });
  void queryClient.invalidateQueries({ queryKey: ['bills'] });
  void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  // Transactions (and payees: a schedule can create one) may have changed.
  if (ledger) {
    afterTransactionWrite(queryClient);
    void queryClient.invalidateQueries({ queryKey: ['reports'] });
  }
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduleInput) => api.post<ScheduleWriteResponse>('/api/schedules', input),
    onSuccess: () => afterScheduleWrite(queryClient, { ledger: true }),
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ScheduleInput> }) =>
      api.patch<ScheduleWriteResponse>(`/api/schedules/${id}`, patch),
    onSuccess: () => afterScheduleWrite(queryClient, { ledger: true }),
  });
}

/** Removes the rule and its queue. Transactions it already created stay. */
export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<{ ok: true }>(`/api/schedules/${id}`),
    onSuccess: (_r, id) => {
      queryClient.removeQueries({ queryKey: scheduleKeys.detail(id) });
      afterScheduleWrite(queryClient, { ledger: false });
    },
  });
}

export function usePauseSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<{ schedule: ScheduleWriteResponse['schedule'] }>(`/api/schedules/${id}/pause`),
    onSuccess: () => afterScheduleWrite(queryClient, { ledger: false }),
  });
}

/** { catchUp: true } also creates / queues what fell due while paused; by default those are skipped. */
export function useResumeSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, catchUp }: { id: number; catchUp: boolean }) =>
      api.post<ResumeResponse>(`/api/schedules/${id}/resume`, { catchUp }),
    onSuccess: () => afterScheduleWrite(queryClient, { ledger: true }),
  });
}

/** Pay the next one now ("I paid it early"); nothing is created again on its due date. */
export function usePostNext() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, overrides }: { id: number; overrides: PayOverrides }) =>
      api.post<HandleNextResponse>(`/api/schedules/${id}/post-next`, overrides),
    onSuccess: () => afterScheduleWrite(queryClient, { ledger: true }),
  });
}

export function useSkipNext() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<HandleNextResponse>(`/api/schedules/${id}/skip-next`),
    onSuccess: () => afterScheduleWrite(queryClient, { ledger: false }),
  });
}

/** POST /api/schedules/run: run everything due right now. */
export function useRunDue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ generated: GeneratedSummary }>('/api/schedules/run'),
    onSuccess: () => afterScheduleWrite(queryClient, { ledger: true }),
  });
}

export function useApproveOccurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, overrides = {} }: { id: number; overrides?: PayOverrides }) =>
      api.post<{ occurrence: Occurrence; transactionId: number }>(`/api/schedule-occurrences/${id}/approve`, overrides),
    onSuccess: () => afterScheduleWrite(queryClient, { ledger: true }),
  });
}

export function useSkipOccurrence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<{ occurrence: Occurrence }>(`/api/schedule-occurrences/${id}/skip`),
    onSuccess: () => afterScheduleWrite(queryClient, { ledger: false }),
  });
}

/** "2 transactions created, 1 waiting for your approval." – or '' when nothing happened. */
export function describeGenerated(g: Partial<GeneratedSummary> | null | undefined): string {
  if (!g) return '';
  const bits: string[] = [];
  if (g.posted) bits.push(`${g.posted} transaction${g.posted === 1 ? '' : 's'} created`);
  if (g.pending) bits.push(`${g.pending} waiting for your approval`);
  let s = bits.join(', ');
  if (s) s = s[0].toUpperCase() + s.slice(1) + '.';
  if (g.more) s += ' More are still catching up and will follow on the next run.';
  return s.trim();
}
