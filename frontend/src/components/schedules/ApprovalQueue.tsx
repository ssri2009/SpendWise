import { AnimatePresence, motion } from 'framer-motion';
import { Check, Pencil, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { useApproveOccurrence, useSkipOccurrence } from '../../hooks/useSchedules';
import { ApiError } from '../../lib/api';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import type { Occurrence } from '../../types/schedules';
import { PayDialog } from './ScheduleDialogs';
import { dueText, longDate, ScheduleIcon } from './parts';

/**
 * Pending occurrences (GET /api/schedule-occurrences?status=pending): approve as scheduled,
 * approve with the real amount / date, or skip.
 */
export function ApprovalQueue({
  items,
  today,
  fmt,
  onOpenSchedule,
  onMessage,
  compact = false,
}: {
  items: Occurrence[];
  today: string;
  fmt: MoneyFormat;
  onOpenSchedule?: (id: number) => void;
  onMessage: (tone: 'success' | 'error', message: string) => void;
  /** Inside a schedule's drawer: no schedule names. */
  compact?: boolean;
}) {
  const approve = useApproveOccurrence();
  const skip = useSkipOccurrence();
  const [busy, setBusy] = useState<number | null>(null);
  const [adjusting, setAdjusting] = useState<Occurrence | null>(null);

  const fail = (err: unknown) => onMessage('error', err instanceof ApiError ? err.message : 'That did not work. Please try again.');

  function doApprove(o: Occurrence) {
    setBusy(o.id);
    approve.mutate(
      { id: o.id },
      {
        onSuccess: () => onMessage('success', `Approved ${o.scheduleName}: ${formatMoney(o.amountMinor, fmt, { signed: true })} on ${longDate(o.dueDate, fmt.locale)}.`),
        onError: fail,
        onSettled: () => setBusy(null),
      },
    );
  }

  function doSkip(o: Occurrence) {
    setBusy(o.id);
    skip.mutate(o.id, {
      onSuccess: () => onMessage('success', `Skipped ${o.scheduleName} for ${longDate(o.dueDate, fmt.locale)}.`),
      onError: fail,
      onSettled: () => setBusy(null),
    });
  }

  const btn =
    'inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <>
      <ul className="divide-y divide-line">
        <AnimatePresence initial={false}>
          {items.map((o) => {
            const kind = o.amountMinor < 0 ? 'expense' : 'income';
            const isBusy = busy === o.id;
            return (
              <motion.li
                key={o.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
                aria-label={`${o.scheduleName}, due ${longDate(o.dueDate, fmt.locale)}`}
              >
                <ScheduleIcon icon={o.categoryIcon} kind={kind} size="sm" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                    {compact || !onOpenSchedule ? (
                      <span className="truncate">{compact ? longDate(o.dueDate, fmt.locale) : o.scheduleName}</span>
                    ) : (
                      <button type="button" onClick={() => onOpenSchedule(o.scheduleId)} className="truncate text-left hover:text-accent hover:underline">
                        {o.scheduleName}
                      </button>
                    )}
                    {o.overdue && (
                      <span className="rounded-full bg-warning/14 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-warning">Overdue</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted" title={longDate(o.dueDate, fmt.locale)}>
                    {compact ? o.accountName : `Due ${dueText(o.dueDate, today, fmt.locale)} · ${o.accountName}`}
                    {o.note ? ` · ${o.note}` : ''}
                  </p>
                </div>
                <span className={`text-sm font-semibold tabular-nums ${kind === 'income' ? 'text-income' : ''}`}>
                  {formatMoney(o.amountMinor, fmt, { signed: true })}
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => doApprove(o)}
                    disabled={busy !== null}
                    aria-label={`Approve ${o.scheduleName} due ${o.dueDate}`}
                    className={`${btn} accent-gradient text-accent-fg shadow-sm shadow-accent/25`}
                  >
                    <Check className="size-3.5" aria-hidden />
                    {isBusy && approve.isPending ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjusting(o)}
                    disabled={busy !== null}
                    aria-label={`Approve ${o.scheduleName} due ${o.dueDate} with a different amount or date`}
                    title="Approve with a different amount or date"
                    className={`${btn} border border-line bg-surface hover:bg-subtle`}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">Adjust</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => doSkip(o)}
                    disabled={busy !== null}
                    aria-label={`Skip ${o.scheduleName} due ${o.dueDate}`}
                    title="Skip this one: no transaction is created"
                    className={`${btn} text-muted hover:bg-subtle hover:text-fg`}
                  >
                    <SkipForward className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">Skip</span>
                  </button>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {adjusting && (
        <PayDialog
          title={`Approve ${adjusting.scheduleName}`}
          description={`Due ${longDate(adjusting.dueDate, fmt.locale)}. Enter what you actually ${adjusting.amountMinor < 0 ? 'paid' : 'received'}.`}
          amountMinor={adjusting.amountMinor}
          date={adjusting.dueDate}
          notes=""
          confirmLabel="Approve"
          fmt={fmt}
          pending={approve.isPending}
          error={approve.error}
          onClose={() => {
            approve.reset();
            setAdjusting(null);
          }}
          onConfirm={(overrides) => {
            const o = adjusting;
            // Notes left empty keep the schedule's own notes.
            const body = { ...overrides };
            if (!body.notes) delete body.notes;
            approve.mutate(
              { id: o.id, overrides: body },
              {
                onSuccess: () => {
                  onMessage('success', `Approved ${o.scheduleName}: ${formatMoney(body.amountMinor ?? o.amountMinor, fmt, { signed: true })}.`);
                  setAdjusting(null);
                },
              },
            );
          }}
        />
      )}
    </>
  );
}
