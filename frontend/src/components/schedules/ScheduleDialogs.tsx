import { useId, useMemo, useState } from 'react';
import { describeGenerated, useDeleteSchedule, useResumeSchedule } from '../../hooks/useSchedules';
import { ApiError } from '../../lib/api';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import { parseMoney, toInputValue } from '../../lib/money';
import { datesBetween, isIsoDate, makeRule } from '../../lib/recurrence';
import type { PayOverrides, Schedule } from '../../types/schedules';
import { CONTROL, Dialog, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';
import { longDate } from './parts';

const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** DELETE /api/schedules/:id. Transactions it already created are kept. */
export function DeleteScheduleDialog({
  schedule,
  onClose,
  onDeleted,
}: {
  schedule: Schedule;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const remove = useDeleteSchedule();
  return (
    <Dialog
      title={`Delete "${schedule.name}"?`}
      description="The schedule and its approval queue go away. Transactions it already created stay in your accounts."
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={remove.isPending}>
            Keep it
          </GhostButton>
          <PrimaryButton
            type="button"
            tone="danger"
            pending={remove.isPending}
            onClick={() =>
              remove.mutate(schedule.id, {
                onSuccess: () => {
                  onDeleted(`Deleted "${schedule.name}".`);
                  onClose();
                },
              })
            }
          >
            Delete schedule
          </PrimaryButton>
        </>
      }
    >
      {schedule.pendingCount > 0 && (
        <p className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
          {schedule.pendingCount} item{schedule.pendingCount === 1 ? ' is' : 's are'} still waiting for approval. Deleting removes {schedule.pendingCount === 1 ? 'it' : 'them'} without creating transactions.
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="mt-3 text-sm text-expense">
          {errText(remove.error, 'Could not delete. Please try again.')}
        </p>
      )}
      {!schedule.pendingCount && !remove.isError && <p className="text-sm text-muted">This cannot be undone.</p>}
    </Dialog>
  );
}

/** What fell due while paused, worked out like the server does. */
export function missedWhilePaused(s: Schedule, today: string): string[] {
  if (!s.paused || !s.nextDate || s.nextDate >= today) return [];
  const rule = makeRule(s.frequency, s.interval, s.unit);
  if (!rule) return [];
  return datesBetween(s.startDate, rule, s.endDate, s.nextDate, today, 400);
}

/**
 * POST /api/schedules/:id/resume. Only shown when dates were missed while paused: the user chooses to skip them
 * (the default, like a paused subscription) or catch up (create / queue them now).
 */
export function ResumeDialog({
  schedule,
  missed,
  fmt,
  onClose,
  onResumed,
}: {
  schedule: Schedule;
  missed: string[];
  fmt: MoneyFormat;
  onClose: () => void;
  onResumed: (message: string) => void;
}) {
  const resume = useResumeSchedule();
  const [catchUp, setCatchUp] = useState(false);
  const n = missed.length;
  const many = n >= 400 ? '400+' : String(n);
  const range = n === 1 ? longDate(missed[0], fmt.locale) : `${longDate(missed[0], fmt.locale)} – ${longDate(missed[n - 1], fmt.locale)}`;

  function go() {
    resume.mutate(
      { id: schedule.id, catchUp },
      {
        onSuccess: (r) => {
          const extra = catchUp ? describeGenerated(r.generated) : r.skipped ? `Skipped ${r.skipped} missed date${r.skipped === 1 ? '' : 's'}.` : '';
          onResumed(`Resumed "${schedule.name}".${extra ? ` ${extra}` : ''}`);
          onClose();
        },
      },
    );
  }

  const option = (value: boolean, title: string, text: string) => (
    <label
      className={`flex cursor-pointer gap-3 rounded-2xl border p-3.5 transition-colors ${
        catchUp === value ? 'border-accent bg-accent/8 ring-2 ring-accent/20' : 'border-line hover:bg-subtle'
      }`}
    >
      <input type="radio" name="sw-resume" checked={catchUp === value} onChange={() => setCatchUp(value)} className="mt-1 size-4 accent-[var(--sw-accent)]" />
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
    </label>
  );

  return (
    <Dialog
      title={`Resume "${schedule.name}"`}
      description={`${many} date${n === 1 ? '' : 's'} came and went while it was paused (${range}).`}
      onClose={onClose}
      onSubmit={go}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={resume.isPending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={resume.isPending}>Resume</PrimaryButton>
        </>
      }
    >
      <div className="space-y-2.5">
        {option(false, 'Skip the missed ones', 'Carry on from the next date. Nothing is back-billed.')}
        {option(
          true,
          `Catch up on ${many}`,
          schedule.mode === 'auto'
            ? `Create ${n === 1 ? 'that transaction' : 'those transactions'} now (${formatMoney(schedule.amountMinor, fmt, { signed: true })} each).`
            : `Put ${n === 1 ? 'it' : 'them'} in your approval queue, so you can approve or skip each one.`,
        )}
        {resume.isError && (
          <p role="alert" className="text-sm text-expense">
            {errText(resume.error, 'Could not resume. Please try again.')}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Amount + date (+ notes) before creating a scheduled transaction: "Pay next now" (post-next)
 * and "Approve with changes" (approve). The amount keeps the schedule's direction.
 */
export function PayDialog({
  title,
  description,
  amountMinor,
  date,
  notes,
  confirmLabel,
  fmt,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  /** Signed default. */
  amountMinor: number;
  date: string;
  notes: string;
  confirmLabel: string;
  fmt: MoneyFormat;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (overrides: PayOverrides) => void;
}) {
  const sign = amountMinor < 0 ? -1 : 1;
  const [amountText, setAmountText] = useState(toInputValue(Math.abs(amountMinor)));
  const [day, setDay] = useState(date);
  const [note, setNote] = useState(notes);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = { amount: useId(), date: useId(), notes: useId() };
  const parsed = useMemo(() => parseMoney(amountText), [amountText]);

  function submit() {
    if (pending) return;
    if (parsed === null || parsed === 0) return setProblem('Enter an amount like 499 or 1,250.50.');
    if (!isIsoDate(day)) return setProblem('Pick a date.');
    if (note.trim().length > 200) return setProblem('Notes must be 200 characters or fewer.');
    setProblem(null);
    onConfirm({ amountMinor: sign * parsed, date: day, notes: note.trim() });
  }

  const shown = problem ?? (error ? errText(error, 'Could not save. Please try again.') : null);

  return (
    <Dialog
      title={title}
      description={description}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={pending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={pending}>{confirmLabel}</PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField label={sign < 0 ? 'Amount paid' : 'Amount received'} htmlFor={ids.amount} hint={sign < 0 ? 'Expense' : 'Income'}>
            <input
              id={ids.amount}
              className={`${CONTROL} text-right font-semibold tabular-nums`}
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              autoFocus
            />
          </DialogField>
          <DialogField label="Transaction date" htmlFor={ids.date}>
            <input id={ids.date} type="date" className={CONTROL} value={day} onChange={(e) => setDay(e.target.value)} />
          </DialogField>
        </div>
        <DialogField label="Notes" htmlFor={ids.notes}>
          <input id={ids.notes} className={CONTROL} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </DialogField>
        {parsed !== null && parsed !== 0 && (
          <p className="text-sm text-muted">
            Creates a transaction of <span className="font-semibold text-fg tabular-nums">{formatMoney(sign * parsed, fmt, { signed: true })}</span>.
          </p>
        )}
        {shown && (
          <p role="alert" className="text-sm font-medium text-expense">
            {shown}
          </p>
        )}
      </div>
    </Dialog>
  );
}
