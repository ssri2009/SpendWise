import { Loader2, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import type { Schedule } from '../../types/schedules';
import { dueText, IconButton, longDate, ModeBadge, PendingBadge, ScheduleIcon, StatusBadge } from './parts';

export interface ScheduleRowHandlers {
  onOpen: (s: Schedule) => void;
  onEdit: (s: Schedule) => void;
  onPause: (s: Schedule) => void;
  onResume: (s: Schedule) => void;
  onDelete: (s: Schedule) => void;
}

/** The schedules, one row each: what, how often, when next, how much, and quick actions. */
export function ScheduleList({
  schedules,
  today,
  fmt,
  busyId,
  handlers,
}: {
  schedules: Schedule[];
  today: string;
  fmt: MoneyFormat;
  /** A pause / resume in flight for this id. */
  busyId: number | null;
  handlers: ScheduleRowHandlers;
}) {
  return (
    <ul className="divide-y divide-line" aria-label="Schedules">
      {schedules.map((s) => (
        <ScheduleRow key={s.id} s={s} today={today} fmt={fmt} busy={busyId === s.id} handlers={handlers} />
      ))}
    </ul>
  );
}

function NextCell({ s, today, fmt }: { s: Schedule; today: string; fmt: MoneyFormat }) {
  if (s.status === 'finished') return <span className="text-muted">No more dates</span>;
  if (!s.nextDate) return <span className="text-muted">—</span>;
  const overdue = s.nextDate < today;
  return (
    <span title={longDate(s.nextDate, fmt.locale)} className={s.paused ? 'text-muted line-through decoration-muted/50' : overdue ? 'text-warning' : ''}>
      {dueText(s.nextDate, today, fmt.locale)}
    </span>
  );
}

function ScheduleRow({
  s,
  today,
  fmt,
  busy,
  handlers,
}: {
  s: Schedule;
  today: string;
  fmt: MoneyFormat;
  busy: boolean;
  handlers: ScheduleRowHandlers;
}) {
  const meta = [s.payee && s.payee !== s.name ? s.payee : null, s.accountName + (s.accountClosed ? ' (closed)' : ''), s.categoryName].filter(Boolean).join(' · ');
  const dim = s.status !== 'active';
  return (
    <li
      id={`schedule-row-${s.id}`}
      className="group grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_6.5rem_8.5rem_auto] sm:gap-x-4"
    >
      <div className={dim ? 'opacity-60' : ''}>
        <ScheduleIcon icon={s.categoryIcon} kind={s.kind} />
      </div>

      <button
        type="button"
        onClick={() => handlers.onOpen(s)}
        className="min-w-0 rounded-lg text-left outline-offset-4"
        aria-label={`${s.name}: ${s.frequencyLabel}, ${formatMoney(s.amountMinor, fmt, { signed: true })}, ${s.status}. Open details`}
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-semibold group-hover:text-accent">{s.name}</span>
          <StatusBadge status={s.status} />
          <PendingBadge count={s.pendingCount} />
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{s.frequencyLabel}</span>
          <ModeBadge mode={s.mode} compact />
          {meta && <span className="truncate">{meta}</span>}
        </span>
      </button>

      {/* phones: amount on the right of the name; next date and actions on a second line */}
      <div className="text-right sm:hidden">
        <p className={`font-semibold tabular-nums ${s.kind === 'income' ? 'text-income' : ''}`}>{formatMoney(s.amountMinor, fmt, { signed: true })}</p>
        <p className="text-xs text-muted">
          <NextCell s={s} today={today} fmt={fmt} />
        </p>
      </div>

      <div className="hidden text-sm sm:block">
        <p className="text-xs text-muted">{s.paused ? 'Was next' : 'Next'}</p>
        <p className="font-medium">
          <NextCell s={s} today={today} fmt={fmt} />
        </p>
      </div>

      <div className="hidden text-right sm:block">
        <p className={`font-semibold tabular-nums ${s.kind === 'income' ? 'text-income' : ''}`}>{formatMoney(s.amountMinor, fmt, { signed: true })}</p>
        <p className="text-xs text-muted tabular-nums">
          {s.frequency === 'once' ? 'One time' : `≈ ${formatMoney(s.monthlyEquivalentMinor, fmt)}/mo`}
        </p>
      </div>

      <div className="col-span-3 -mt-1 flex justify-end gap-1 sm:col-span-1 sm:mt-0">
        {s.status === 'paused' ? (
          <IconButton label={`Resume ${s.name}`} onClick={() => handlers.onResume(s)} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          </IconButton>
        ) : (
          <IconButton label={`Pause ${s.name}`} onClick={() => handlers.onPause(s)} disabled={busy || s.status === 'finished'}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Pause className="size-4" aria-hidden />}
          </IconButton>
        )}
        <IconButton label={`Edit ${s.name}`} onClick={() => handlers.onEdit(s)}>
          <Pencil className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={`Delete ${s.name}`} tone="danger" onClick={() => handlers.onDelete(s)}>
          <Trash2 className="size-4" aria-hidden />
        </IconButton>
      </div>
    </li>
  );
}
