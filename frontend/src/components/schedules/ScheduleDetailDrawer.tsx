import { Banknote, CalendarClock, CircleCheck, History, Pause, Pencil, Play, SkipForward, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { usePostNext, useScheduleDetail, useSkipNext } from '../../hooks/useSchedules';
import { ApiError } from '../../lib/api';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import { daysBetween } from '../../lib/recurrence';
import type { Occurrence, Schedule } from '../../types/schedules';
import { ErrorState, Skeleton } from '../dashboard/ui';
import { Drawer } from '../ui/Drawer';
import { ApprovalQueue } from './ApprovalQueue';
import { PayDialog } from './ScheduleDialogs';
import { Fact, longDate, MODE_LABEL, PendingBadge, ScheduleIcon, StatusBadge } from './parts';

const ACTION =
  'inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium transition-colors hover:border-accent/50 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50';

/** One schedule in full (GET /api/schedules/:id): facts, next dates, approval queue, history, and every action. */
export function ScheduleDetailDrawer({
  id,
  today,
  fmt,
  pausing,
  onClose,
  onEdit,
  onDelete,
  onPause,
  onResume,
  onMessage,
}: {
  id: number;
  today: string;
  fmt: MoneyFormat;
  /** Pause / resume in flight for this schedule. */
  pausing: boolean;
  onClose: () => void;
  onEdit: (s: Schedule) => void;
  onDelete: (s: Schedule) => void;
  onPause: (s: Schedule) => void;
  onResume: (s: Schedule) => void;
  onMessage: (tone: 'success' | 'error', message: string) => void;
}) {
  const q = useScheduleDetail(id);
  const postNext = usePostNext();
  const skipNext = useSkipNext();
  const [paying, setPaying] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const s = q.data?.schedule;
  const locale = fmt.locale;

  const fail = (err: unknown) => onMessage('error', err instanceof ApiError ? err.message : 'That did not work. Please try again.');

  const pending = q.data?.occurrences.filter((o) => o.status === 'pending').sort((a, b) => a.dueDate.localeCompare(b.dueDate)) ?? [];
  const history = q.data?.occurrences.filter((o) => o.status !== 'pending') ?? [];
  const canHandleNext = !!s && s.status === 'active' && !!s.nextDate;

  return (
    <Drawer
      title={s ? s.name : 'Schedule'}
      description={s ? `${s.frequencyLabel} · ${s.accountName}` : undefined}
      onClose={onClose}
      width="lg"
    >
      {q.isPending ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : q.isError || !s ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-6">
          {/* ---------- hero ---------- */}
          <section className="flex items-start gap-4">
            <ScheduleIcon icon={s.categoryIcon} kind={s.kind} size="lg" />
            <div className="min-w-0 flex-1">
              <p className={`text-2xl font-bold tabular-nums tracking-tight ${s.kind === 'income' ? 'text-income' : ''}`}>
                {formatMoney(s.amountMinor, fmt, { signed: true })}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={s.status} />
                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">{MODE_LABEL[s.mode]}</span>
                <PendingBadge count={s.pendingCount} />
              </div>
            </div>
          </section>

          {s.accountClosed && (
            <p className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
              {s.accountName} is closed, so nothing can be posted. Edit the schedule to use an open account.
            </p>
          )}

          {/* ---------- actions ---------- */}
          <div className="flex flex-wrap gap-2">
            {s.status === 'paused' ? (
              <button type="button" className={ACTION} onClick={() => onResume(s)} disabled={pausing}>
                <Play className="size-4 text-income" aria-hidden /> Resume
              </button>
            ) : (
              <button type="button" className={ACTION} onClick={() => onPause(s)} disabled={pausing || s.status === 'finished'}>
                <Pause className="size-4 text-warning" aria-hidden /> Pause
              </button>
            )}
            <button type="button" className={ACTION} onClick={() => setPaying(true)} disabled={!canHandleNext || s.accountClosed}>
              <Banknote className="size-4 text-muted" aria-hidden /> {s.kind === 'income' ? 'Record next now' : 'Pay next now'}
            </button>
            {confirmSkip ? (
              <span className="inline-flex items-center gap-1 rounded-xl border border-warning/40 bg-warning/10 p-1 text-sm">
                <span className="px-2">Skip {s.nextDate && longDate(s.nextDate, locale)}?</span>
                <button
                  type="button"
                  className="h-8 rounded-lg bg-warning px-3 text-xs font-semibold text-white disabled:opacity-60"
                  disabled={skipNext.isPending}
                  onClick={() =>
                    skipNext.mutate(s.id, {
                      onSuccess: (r) => onMessage('success', `Skipped ${s.name} for ${longDate(r.dueDate, locale)}.`),
                      onError: fail,
                      onSettled: () => setConfirmSkip(false),
                    })
                  }
                >
                  Skip it
                </button>
                <button type="button" className="h-8 rounded-lg px-2 text-xs font-semibold text-muted hover:text-fg" onClick={() => setConfirmSkip(false)}>
                  <Undo2 className="size-3.5" aria-label="Don't skip" />
                </button>
              </span>
            ) : (
              <button type="button" className={ACTION} onClick={() => setConfirmSkip(true)} disabled={!canHandleNext}>
                <SkipForward className="size-4 text-muted" aria-hidden /> Skip next
              </button>
            )}
            <button type="button" className={ACTION} onClick={() => onEdit(s)}>
              <Pencil className="size-4 text-muted" aria-hidden /> Edit
            </button>
            <button
              type="button"
              className={`${ACTION} text-expense hover:border-expense/40 hover:bg-expense/10`}
              onClick={() => onDelete(s)}
            >
              <Trash2 className="size-4" aria-hidden /> Delete
            </button>
          </div>

          {/* ---------- facts ---------- */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl border border-line p-4 sm:grid-cols-3">
            <Fact label="Repeats">{s.frequencyLabel}</Fact>
            <Fact label={s.paused ? 'Was next' : 'Next'}>
              {s.nextDate ? <span title={longDate(s.nextDate, locale)}>{longDate(s.nextDate, locale)}</span> : 'No more dates'}
            </Fact>
            <Fact label="Per month">{s.frequency === 'once' ? 'One time' : `≈ ${formatMoney(s.monthlyEquivalentMinor, fmt)}`}</Fact>
            <Fact label="Account">{s.accountName}</Fact>
            <Fact label="Payee">{s.payee || '—'}</Fact>
            <Fact label="Category">{s.categoryName ? `${s.categoryIcon ?? ''} ${s.categoryName}`.trim() : 'From payee / rules'}</Fact>
            <Fact label="Started">{longDate(s.startDate, locale)}</Fact>
            <Fact label="Ends">{s.frequency === 'once' ? 'After one' : s.endDate ? longDate(s.endDate, locale) : 'Never'}</Fact>
            <Fact label="Created as">{s.cleared ? 'Cleared' : 'Uncleared'}</Fact>
            {s.notes && (
              <div className="col-span-full">
                <dt className="text-xs text-muted">Notes</dt>
                <dd className="mt-0.5 text-sm">{s.notes}</dd>
              </div>
            )}
          </dl>

          {/* ---------- waiting ---------- */}
          {pending.length > 0 && (
            <section aria-labelledby="sw-sd-pending">
              <h3 id="sw-sd-pending" className="mb-1 text-sm font-semibold">
                Waiting for your approval
              </h3>
              <ApprovalQueue items={pending} today={today} fmt={fmt} onMessage={onMessage} compact />
            </section>
          )}

          {/* ---------- next dates ---------- */}
          <section aria-labelledby="sw-sd-next">
            <h3 id="sw-sd-next" className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="size-4 text-accent" aria-hidden /> Next dates
            </h3>
            {s.paused ? (
              <p className="text-sm text-muted">Paused: nothing will happen until you resume it.</p>
            ) : q.data.upcomingDates.length === 0 ? (
              <p className="text-sm text-muted">No more dates. Edit the end date to bring it back.</p>
            ) : (
              <ol className="grid gap-1.5 sm:grid-cols-2">
                {q.data.upcomingDates.map((d, i) => (
                  <li key={d} className="flex items-center justify-between gap-3 rounded-xl bg-subtle px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{longDate(d, locale)}</span>
                      {i === 0 && d <= today && <span className="ml-1.5 text-xs text-warning">due now</span>}
                    </span>
                    <span className="text-xs text-muted tabular-nums">{inDays(daysBetween(today, d))}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ---------- history ---------- */}
          <section aria-labelledby="sw-sd-history">
            <h3 id="sw-sd-history" className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <History className="size-4 text-accent" aria-hidden /> History
            </h3>
            {history.length === 0 ? (
              <p className="text-sm text-muted">Nothing has run yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {history.map((o) => (
                  <HistoryRow key={o.id} o={o} fmt={fmt} />
                ))}
              </ul>
            )}
            {history.length >= 60 && <p className="mt-2 text-xs text-muted">Showing the latest 60.</p>}
          </section>
        </div>
      )}

      {paying && s && s.nextDate && (
        <PayDialog
          title={s.kind === 'income' ? `Record ${s.name} now` : `Pay ${s.name} now`}
          description={`Handles the one due ${longDate(s.nextDate, locale)}, so nothing is created again on that date.`}
          amountMinor={s.amountMinor}
          date={s.nextDate < today ? s.nextDate : today}
          notes={s.notes}
          confirmLabel={s.kind === 'income' ? 'Record it' : 'Pay it'}
          fmt={fmt}
          pending={postNext.isPending}
          error={postNext.error}
          onClose={() => {
            postNext.reset();
            setPaying(false);
          }}
          onConfirm={(overrides) =>
            postNext.mutate(
              { id: s.id, overrides },
              {
                onSuccess: (r) => {
                  onMessage('success', `${s.kind === 'income' ? 'Recorded' : 'Paid'} ${s.name} (due ${longDate(r.dueDate, locale)}).`);
                  setPaying(false);
                },
              },
            )
          }
        />
      )}
    </Drawer>
  );
}

function HistoryRow({ o, fmt }: { o: Occurrence; fmt: MoneyFormat }) {
  const posted = o.status === 'posted';
  const amount = posted && o.paidAmountMinor !== null ? o.paidAmountMinor : o.amountMinor;
  const paidOther = posted && o.paidDate && o.paidDate !== o.dueDate;
  // The transaction it created was deleted later (the occurrence keeps its record).
  const gone = posted && o.paidDate === null;
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
      <span
        className={`inline-flex w-20 shrink-0 items-center gap-1 text-xs font-semibold ${posted ? 'text-income' : 'text-muted'}`}
      >
        {posted ? <CircleCheck className="size-3.5" aria-hidden /> : <SkipForward className="size-3.5" aria-hidden />}
        {posted ? 'Posted' : 'Skipped'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block">{longDate(o.dueDate, fmt.locale)}</span>
        {(paidOther || gone || o.note) && (
          <span className="block truncate text-xs text-muted">
            {paidOther ? `Paid ${longDate(o.paidDate!, fmt.locale)}` : ''}
            {gone ? 'Its transaction was deleted' : ''}
            {o.note ? `${paidOther || gone ? ' · ' : ''}${o.note}` : ''}
          </span>
        )}
      </span>
      <span className={`tabular-nums ${posted ? 'font-semibold' : 'text-muted line-through'} ${posted && amount > 0 ? 'text-income' : ''}`}>
        {formatMoney(amount, fmt, { signed: true })}
      </span>
    </li>
  );
}

/** 0 → "Today", 1 → "Tomorrow", 33 → "in 33 days" (past dates: nothing). */
function inDays(n: number): string {
  if (n < 0) return '';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return `in ${n.toLocaleString()} days`;
}
