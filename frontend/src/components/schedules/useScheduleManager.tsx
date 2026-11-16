import { useCallback, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { describeGenerated, usePauseSchedule, useResumeSchedule } from '../../hooks/useSchedules';
import { useAccountList, useCategoryTree, usePayees } from '../../hooks/useTransactions';
import { ApiError } from '../../lib/api';
import type { MoneyFormat } from '../../lib/format';
import type { Schedule } from '../../types/schedules';
import { useToast } from '../ui/Toast';
import { DeleteScheduleDialog, missedWhilePaused, ResumeDialog } from './ScheduleDialogs';
import { ScheduleDetailDrawer } from './ScheduleDetailDrawer';
import { ScheduleFormDrawer } from './ScheduleFormDrawer';

/**
 * Everything needed to act on schedules from any page (Schedules, Bills…): the details drawer
 * (URL ?open=<id>), the create / edit form, delete and resume dialogs, and pause / resume.
 * Render `overlays` once in the page.
 */
export function useScheduleManager({ today, fmt }: { today: string; fmt: MoneyFormat }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const accountsQ = useAccountList();
  const groupsQ = useCategoryTree();
  const payeesQ = usePayees();
  const pause = usePauseSchedule();
  const resume = useResumeSchedule();

  const [form, setForm] = useState<{ schedule: Schedule | null } | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [resuming, setResuming] = useState<{ schedule: Schedule; missed: string[] } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const openRaw = params.get('open');
  const openId = openRaw && /^\d+$/.test(openRaw) ? Number(openRaw) : null;

  const accounts = accountsQ.data?.accounts ?? [];
  const hasOpenAccount = accounts.some((a) => !a.closed);
  const canCreate = hasOpenAccount && !accountsQ.isPending && !groupsQ.isPending;

  /** Reads the live URL so it never writes back a stale value. */
  const setOpen = useCallback(
    (id: number | null) => {
      const next = new URLSearchParams(window.location.search);
      if (id === null) next.delete('open');
      else next.set('open', String(id));
      setParams(next, { replace: id === null });
    },
    [setParams],
  );

  const message = useCallback((tone: 'success' | 'error', text: string) => (tone === 'success' ? toast.success(text) : toast.error(text)), [toast]);
  const fail = useCallback((err: unknown) => toast.error(err instanceof ApiError ? err.message : 'That did not work. Please try again.'), [toast]);

  const doPause = useCallback(
    (s: Schedule) => {
      setBusyId(s.id);
      pause.mutate(s.id, {
        onSuccess: () => toast.success(`Paused "${s.name}". Nothing is created until you resume it.`),
        onError: fail,
        onSettled: () => setBusyId(null),
      });
    },
    [pause, toast, fail],
  );

  const doResume = useCallback(
    (s: Schedule) => {
      const missed = missedWhilePaused(s, today);
      if (missed.length) {
        setResuming({ schedule: s, missed });
        return;
      }
      setBusyId(s.id);
      resume.mutate(
        { id: s.id, catchUp: false },
        {
          onSuccess: (r) => {
            const extra = describeGenerated(r.generated);
            toast.success(`Resumed "${s.name}".${extra ? ` ${extra}` : ''}`);
          },
          onError: fail,
          onSettled: () => setBusyId(null),
        },
      );
    },
    [resume, toast, fail, today],
  );

  const newSchedule = useCallback(() => {
    if (canCreate) setForm({ schedule: null });
  }, [canCreate]);

  const overlays: ReactNode = (
    <>
      {openId !== null && (
        <ScheduleDetailDrawer
          key={`detail-${openId}`}
          id={openId}
          today={today}
          fmt={fmt}
          pausing={busyId === openId}
          onClose={() => setOpen(null)}
          onEdit={(s) => setForm({ schedule: s })}
          onDelete={(s) => setDeleting(s)}
          onPause={doPause}
          onResume={doResume}
          onMessage={message}
        />
      )}

      {form && (
        <ScheduleFormDrawer
          key={`form-${form.schedule?.id ?? 'new'}`}
          schedule={form.schedule}
          accounts={accounts}
          groups={groupsQ.data ?? []}
          payees={payeesQ.data ?? []}
          today={today}
          fmt={fmt}
          onClose={() => setForm(null)}
          onSaved={(text) => toast.success(text)}
        />
      )}

      {deleting && (
        <DeleteScheduleDialog
          schedule={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(text) => {
            toast.success(text);
            if (openId === deleting.id) setOpen(null);
          }}
        />
      )}

      {resuming && (
        <ResumeDialog
          schedule={resuming.schedule}
          missed={resuming.missed}
          fmt={fmt}
          onClose={() => setResuming(null)}
          onResumed={(text) => toast.success(text)}
        />
      )}
    </>
  );

  return {
    overlays,
    busyId,
    canCreate,
    hasOpenAccount,
    accountsLoading: accountsQ.isPending,
    accounts,
    openSchedule: (id: number) => setOpen(id),
    newSchedule,
    editSchedule: (s: Schedule) => setForm({ schedule: s }),
    deleteSchedule: (s: Schedule) => setDeleting(s),
    pauseSchedule: doPause,
    resumeSchedule: doResume,
    message,
    fail,
  };
}
