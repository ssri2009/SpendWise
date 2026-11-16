import { BellRing, Check, Clock, Pencil, SkipForward, Wallet, Zap } from 'lucide-react';
import { useState } from 'react';
import { useApproveOccurrence, usePostNext, useSkipNext, useSkipOccurrence } from '../../hooks/useSchedules';
import { ApiError } from '../../lib/api';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import type { DueBill } from '../../types/bills';
import { PayDialog } from '../schedules/ScheduleDialogs';
import { longDate, ScheduleIcon } from '../schedules/parts';

/** "Overdue by 12 days", "Due today", "Due tomorrow", "Due in 5 days". */
export function dueLabel(days: number): string {
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

const BTN = 'inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/**
 * One bill that is overdue, due or coming up.
 * - Waiting for approval (has an occurrence): Approve · Adjust · Skip.
 * - The schedule's next one (not yet due): Pay now (post-next) · Skip (skip-next).
 * - Later ones of the same schedule: no actions (pay the earlier one first).
 */
export function BillRow({
  bill,
  isNext,
  today,
  fmt,
  onOpen,
  onMessage,
}: {
  bill: DueBill;
  /** This is the schedule's next unhandled date, so it can be paid or skipped early. */
  isNext: boolean;
  /** The server's today. */
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
  const locale = fmt.locale;
  const when = longDate(bill.dueDate, locale);
  const fail = (err: unknown) => onMessage('error', err instanceof ApiError ? err.message : 'That did not work. Please try again.');

  const meta = [bill.payee && bill.payee !== bill.name ? bill.payee : null, bill.accountName, bill.categoryName].filter(Boolean).join(' · ');
  const tone = bill.status === 'overdue' ? 'text-warning' : bill.status === 'due' ? 'text-accent' : 'text-muted';

  function doSkip() {
    if (bill.awaitingApproval && bill.occurrenceId !== null) {
      skipOcc.mutate(bill.occurrenceId, {
        onSuccess: () => onMessage('success', `Skipped ${bill.name} for ${when}.`),
        onError: fail,
      });
    } else {
      skipNext.mutate(bill.scheduleId, {
        onSuccess: () => onMessage('success', `Skipped ${bill.name} for ${when}.`),
        onError: fail,
        onSettled: () => setConfirmSkip(false),
      });
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" aria-label={`${bill.name}, ${dueLabel(bill.daysFromToday).toLowerCase()}`}>
      <ScheduleIcon icon={bill.categoryIcon} kind="expense" />
      <div className="min-w-0 flex-1 basis-44">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <button type="button" onClick={() => onOpen(bill.scheduleId)} className="truncate text-left font-semibold hover:text-accent hover:underline">
            {bill.name}
          </button>
          {bill.awaitingApproval ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-semibold text-accent">
              <BellRing className="size-3" aria-hidden /> Needs approval
            </span>
          ) : bill.mode === 'auto' ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
              <Zap className="size-3" aria-hidden /> Auto-pays
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
              <BellRing className="size-3" aria-hidden /> Will ask you
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted">
          <span className={`font-medium ${tone}`} title={when}>
            {bill.status === 'overdue' && <Clock className="mr-1 inline size-3 align-[-2px]" aria-hidden />}
            {dueLabel(bill.daysFromToday)}
          </span>
          <span> · {when}</span>
          {meta && <span> · {meta}</span>}
          {bill.note && <span> · {bill.note}</span>}
        </p>
      </div>

      <span className="text-sm font-semibold tabular-nums">{formatMoney(bill.amountMinor, fmt, { signed: true })}</span>

      <div className="flex w-full justify-end gap-1.5 sm:w-auto">
        {bill.awaitingApproval && bill.occurrenceId !== null ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                approve.mutate(
                  { id: bill.occurrenceId! },
                  { onSuccess: () => onMessage('success', `Paid ${bill.name}: ${formatMoney(bill.amountMinor, fmt, { signed: true })} on ${when}.`), onError: fail },
                )
              }
              aria-label={`Approve ${bill.name} due ${bill.dueDate}`}
              className={`${BTN} accent-gradient text-accent-fg shadow-sm shadow-accent/25`}
            >
              <Check className="size-3.5" aria-hidden /> {approve.isPending ? 'Approving…' : 'Approve'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setDialog('adjust')}
              aria-label={`Approve ${bill.name} due ${bill.dueDate} with a different amount or date`}
              title="Approve with the amount or date you actually paid"
              className={`${BTN} border border-line bg-surface hover:bg-subtle`}
            >
              <Pencil className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Adjust</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={doSkip}
              aria-label={`Skip ${bill.name} due ${bill.dueDate}`}
              title="Skip this one: no transaction is created"
              className={`${BTN} text-muted hover:bg-subtle hover:text-fg`}
            >
              <SkipForward className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Skip</span>
            </button>
          </>
        ) : isNext ? (
          confirmSkip ? (
            <span className="inline-flex items-center gap-1 rounded-xl border border-warning/40 bg-warning/10 p-1 text-xs">
              <span className="px-1.5">Skip this one?</span>
              <button type="button" disabled={busy} onClick={doSkip} className="h-7 rounded-lg bg-warning px-2.5 font-semibold text-white disabled:opacity-60">
                Skip it
              </button>
              <button type="button" onClick={() => setConfirmSkip(false)} className="h-7 rounded-lg px-2 font-semibold text-muted hover:text-fg">
                Keep
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDialog('pay')}
                aria-label={`Pay ${bill.name} due ${bill.dueDate} now`}
                title="Record it as paid now; nothing is created again on its due date"
                className={`${BTN} border border-line bg-surface hover:border-accent/50 hover:bg-subtle`}
              >
                <Wallet className="size-3.5" aria-hidden /> Pay now
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmSkip(true)}
                aria-label={`Skip ${bill.name} due ${bill.dueDate}`}
                title="Skip this one: no transaction is created"
                className={`${BTN} text-muted hover:bg-subtle hover:text-fg`}
              >
                <SkipForward className="size-3.5" aria-hidden /> <span className="hidden sm:inline">Skip</span>
              </button>
            </>
          )
        ) : (
          <span className="px-1 text-[11px] text-muted" title="Pay or skip the earlier one of this bill first">
            Later
          </span>
        )}
      </div>

      {dialog === 'adjust' && bill.occurrenceId !== null && (
        <PayDialog
          title={`Approve ${bill.name}`}
          description={`Due ${when}. Enter what you actually paid.`}
          amountMinor={bill.amountMinor}
          date={bill.dueDate}
          notes=""
          confirmLabel="Approve"
          fmt={fmt}
          pending={approve.isPending}
          error={approve.error}
          onClose={() => {
            approve.reset();
            setDialog(null);
          }}
          onConfirm={(o) => {
            const body = { ...o };
            if (!body.notes) delete body.notes;
            approve.mutate(
              { id: bill.occurrenceId!, overrides: body },
              {
                onSuccess: () => {
                  onMessage('success', `Paid ${bill.name}: ${formatMoney(body.amountMinor ?? bill.amountMinor, fmt, { signed: true })}.`);
                  setDialog(null);
                },
              },
            );
          }}
        />
      )}

      {dialog === 'pay' && (
        <PayDialog
          title={`Pay ${bill.name} now`}
          description={`Handles the one due ${when}, so nothing is created again on that date.`}
          amountMinor={bill.amountMinor}
          date={bill.dueDate < today ? bill.dueDate : today}
          notes=""
          confirmLabel="Pay it"
          fmt={fmt}
          pending={postNext.isPending}
          error={postNext.error}
          onClose={() => {
            postNext.reset();
            setDialog(null);
          }}
          onConfirm={(o) => {
            const body = { ...o };
            if (!body.notes) delete body.notes;
            postNext.mutate(
              { id: bill.scheduleId, overrides: body },
              {
                onSuccess: () => {
                  onMessage('success', `Paid ${bill.name} early (due ${when}).`);
                  setDialog(null);
                },
              },
            );
          }}
        />
      )}
    </li>
  );
}
