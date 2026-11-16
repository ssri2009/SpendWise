import { BellRing, Check, CircleCheck, Pencil, SkipForward, Wallet, Zap } from 'lucide-react';
import { useState } from 'react';
import { useApproveOccurrence, usePostNext, useSkipNext, useSkipOccurrence } from '../../hooks/useSchedules';
import { ApiError } from '../../lib/api';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import type { CalendarEvent } from '../../types/calendar';
import { PayDialog } from '../schedules/ScheduleDialogs';
import { longDate, ScheduleIcon } from '../schedules/parts';

const BTN = 'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/** The words for an event's state, never colour alone. */
export function stateText(e: CalendarEvent): string {
  switch (e.state) {
    case 'posted':
      return e.kind === 'income' ? 'Received' : 'Paid';
    case 'pending':
      return e.overdue ? 'Overdue, needs approval' : 'Needs approval';
    case 'skipped':
      return 'Skipped';
    default:
      return e.mode === 'auto' ? (e.kind === 'income' ? 'Arrives automatically' : 'Pays automatically') : 'Will ask you';
  }
}

export function StateGlyph({ e, className = 'size-3' }: { e: CalendarEvent; className?: string }) {
  if (e.state === 'posted') return <CircleCheck className={`${className} text-income`} aria-hidden />;
  if (e.state === 'pending') return <BellRing className={`${className} text-accent`} aria-hidden />;
  if (e.state === 'skipped') return <SkipForward className={`${className} text-muted`} aria-hidden />;
  return e.mode === 'auto' ? <Zap className={`${className} text-muted`} aria-hidden /> : <BellRing className={`${className} text-muted`} aria-hidden />;
}

/**
 * One scheduled event with what can be done about it:
 * waiting for approval → Approve · Adjust · Skip; the schedule's next date → Pay now · Skip; otherwise no actions.
 */
export function EventRow({
  e,
  isNext,
  today,
  fmt,
  onOpen,
  onMessage,
}: {
  e: CalendarEvent;
  /** This is the schedule's next unhandled date (so it can be paid or skipped early). */
  isNext: boolean;
  today: string;
  fmt: MoneyFormat;
  onOpen: (scheduleId: number) => void;
  onMessage: (tone: 'success' | 'error', message: string) => void;
}) {
  const approve = useApproveOccurrence();
  const skipOcc = useSkipOccurrence();
  const postNext = usePostNext();
  const skipNext = useSkipNext();
  const [dialog, setDialog] = useState<'adjust' | 'pay' | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const busy = approve.isPending || skipOcc.isPending || postNext.isPending || skipNext.isPending;
  const when = longDate(e.date, fmt.locale);
  const income = e.kind === 'income';
  const fail = (err: unknown) => onMessage('error', err instanceof ApiError ? err.message : 'That did not work. Please try again.');
  const meta = [e.payee && e.payee !== e.name ? e.payee : null, e.accountName, e.categoryName].filter(Boolean).join(' · ');
  const pending = e.state === 'pending' && e.occurrenceId !== null;
  const canPayEarly = e.state === 'projected' && isNext;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" aria-label={`${e.name}, ${stateText(e).toLowerCase()}`}>
      <ScheduleIcon icon={e.categoryIcon} kind={e.kind} size="sm" />
      <div className="min-w-0 flex-1 basis-36">
        <button
          type="button"
          onClick={() => onOpen(e.scheduleId)}
          className={`block truncate text-left text-sm font-semibold hover:text-accent hover:underline ${e.state === 'skipped' ? 'text-muted line-through' : ''}`}
        >
          {e.name}
        </button>
        <p className="flex items-center gap-1 truncate text-xs text-muted">
          <StateGlyph e={e} />
          <span className={e.state === 'pending' && e.overdue ? 'font-medium text-warning' : ''}>{stateText(e)}</span>
          {meta && <span className="truncate">· {meta}</span>}
        </p>
        {e.note && <p className="truncate text-xs text-muted">{e.note}</p>}
      </div>
      <span className={`text-sm font-semibold tabular-nums ${income ? 'text-income' : ''} ${e.state === 'skipped' ? 'text-muted line-through' : ''}`}>
        {formatMoney(e.amountMinor, fmt, { signed: true })}
      </span>

      {(pending || canPayEarly) && (
        <div className="flex w-full justify-end gap-1 sm:w-auto">
          {pending ? (
            <>
              <button
                type="button"
                disabled={busy}
                aria-label={`Approve ${e.name} due ${e.date}`}
                onClick={() =>
                  approve.mutate(
                    { id: e.occurrenceId! },
                    { onSuccess: () => onMessage('success', `Approved ${e.name}: ${formatMoney(e.amountMinor, fmt, { signed: true })}.`), onError: fail },
                  )
                }
                className={`${BTN} accent-gradient text-accent-fg`}
              >
                <Check className="size-3.5" aria-hidden /> Approve
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Approve ${e.name} due ${e.date} with a different amount or date`}
                title="Approve with a different amount or date"
                onClick={() => setDialog('adjust')}
                className={`${BTN} border border-line bg-surface hover:bg-subtle`}
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Skip ${e.name} due ${e.date}`}
                title="Skip this one: no transaction is created"
                onClick={() =>
                  skipOcc.mutate(e.occurrenceId!, { onSuccess: () => onMessage('success', `Skipped ${e.name} for ${when}.`), onError: fail })
                }
                className={`${BTN} text-muted hover:bg-subtle hover:text-fg`}
              >
                <SkipForward className="size-3.5" aria-hidden />
              </button>
            </>
          ) : confirmSkip ? (
            <span className="inline-flex items-center gap-1 rounded-lg border border-warning/40 bg-warning/10 p-0.5 text-xs">
              <span className="px-1.5">Skip it?</span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  skipNext.mutate(e.scheduleId, {
                    onSuccess: () => onMessage('success', `Skipped ${e.name} for ${when}.`),
                    onError: fail,
                    onSettled: () => setConfirmSkip(false),
                  })
                }
                className="h-7 rounded-md bg-warning px-2.5 font-semibold text-white disabled:opacity-60"
              >
                Skip
              </button>
              <button type="button" onClick={() => setConfirmSkip(false)} className="h-7 rounded-md px-2 font-semibold text-muted hover:text-fg">
                Keep
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                aria-label={`${income ? 'Record' : 'Pay'} ${e.name} due ${e.date} now`}
                title={`${income ? 'Record it' : 'Pay it'} now; nothing is created again on its date`}
                onClick={() => setDialog('pay')}
                className={`${BTN} border border-line bg-surface hover:border-accent/50 hover:bg-subtle`}
              >
                <Wallet className="size-3.5" aria-hidden /> {income ? 'Record now' : 'Pay now'}
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Skip ${e.name} due ${e.date}`}
                title="Skip this one: no transaction is created"
                onClick={() => setConfirmSkip(true)}
                className={`${BTN} text-muted hover:bg-subtle hover:text-fg`}
              >
                <SkipForward className="size-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>
      )}

      {dialog && (
        <PayDialog
          title={dialog === 'adjust' ? `Approve ${e.name}` : `${income ? 'Record' : 'Pay'} ${e.name} now`}
          description={
            dialog === 'adjust'
              ? `Due ${when}. Enter what you actually ${income ? 'received' : 'paid'}.`
              : `Handles the one due ${when}, so nothing is created again on that date.`
          }
          amountMinor={e.amountMinor}
          date={dialog === 'adjust' || e.date < today ? e.date : today}
          notes=""
          confirmLabel={dialog === 'adjust' ? 'Approve' : income ? 'Record it' : 'Pay it'}
          fmt={fmt}
          pending={dialog === 'adjust' ? approve.isPending : postNext.isPending}
          error={dialog === 'adjust' ? approve.error : postNext.error}
          onClose={() => {
            approve.reset();
            postNext.reset();
            setDialog(null);
          }}
          onConfirm={(o) => {
            const body = { ...o };
            if (!body.notes) delete body.notes;
            const done = () => {
              onMessage('success', `${dialog === 'adjust' ? 'Approved' : income ? 'Recorded' : 'Paid'} ${e.name}: ${formatMoney(body.amountMinor ?? e.amountMinor, fmt, { signed: true })}.`);
              setDialog(null);
            };
            if (dialog === 'adjust') approve.mutate({ id: e.occurrenceId!, overrides: body }, { onSuccess: done });
            else postNext.mutate({ id: e.scheduleId, overrides: body }, { onSuccess: done });
          }}
        />
      )}
    </li>
  );
}
