import { BellRing, CircleCheck, CircleDot, CirclePause, Repeat, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDate, relativeDay } from '../../lib/format';
import { daysBetween } from '../../lib/recurrence';
import type { ScheduleMode, ScheduleStatus } from '../../types/schedules';

/* Small pieces shared by the schedules list, drawers and panels. */

/** Category emoji (or a repeat glyph) on an income/expense tinted tile. */
export function ScheduleIcon({ icon, kind, size = 'md' }: { icon: string | null; kind: 'income' | 'expense'; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'size-12 text-xl rounded-2xl' : size === 'sm' ? 'size-8 text-sm rounded-lg' : 'size-10 text-lg rounded-xl';
  const tint = kind === 'income' ? 'bg-income/12 text-income' : 'bg-expense/10 text-expense';
  return (
    <span className={`grid shrink-0 place-items-center ${box} ${tint}`} aria-hidden>
      {icon ? <span className="leading-none">{icon}</span> : <Repeat className={size === 'lg' ? 'size-5' : 'size-4'} />}
    </span>
  );
}

const STATUS: Record<ScheduleStatus, { label: string; icon: typeof CircleDot; tone: string }> = {
  active: { label: 'Active', icon: CircleDot, tone: 'bg-income/12 text-income' },
  paused: { label: 'Paused', icon: CirclePause, tone: 'bg-warning/14 text-warning' },
  finished: { label: 'Finished', icon: CircleCheck, tone: 'bg-subtle text-muted' },
};

/** Status always shows an icon + a word, never colour alone. */
export function StatusBadge({ status }: { status: ScheduleStatus }) {
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.tone}`}>
      <Icon className="size-3" aria-hidden />
      {s.label}
    </span>
  );
}

export const MODE_LABEL: Record<ScheduleMode, string> = { auto: 'Posts automatically', approval: 'Asks you first' };

export function ModeBadge({ mode, compact = false }: { mode: ScheduleMode; compact?: boolean }) {
  const Icon = mode === 'auto' ? Zap : BellRing;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted" title={MODE_LABEL[mode]}>
      <Icon className="size-3" aria-hidden />
      {compact ? (mode === 'auto' ? 'Auto' : 'Ask first') : MODE_LABEL[mode]}
    </span>
  );
}

export function PendingBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-semibold text-accent">
      <BellRing className="size-3" aria-hidden />
      {count} to approve
    </span>
  );
}

/** "Today", "Tomorrow", "in 5 days", "3 days overdue", otherwise "12 Dec". */
export function dueText(date: string, today: string, locale?: string): string {
  const diff = daysBetween(today, date);
  if (diff < -1) return `${-diff} days ago`;
  if (diff <= 1) return relativeDay(date, today, locale);
  if (diff < 14) return `in ${diff} days`;
  return relativeDay(date, today, locale);
}

/** Full date for titles and screen readers: "Sun, 15 Nov 2026". */
export const longDate = (iso: string, locale?: string) =>
  formatDate(iso, locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Rounded square icon button used in rows (with a visible tooltip title and an accessible name). */
export function IconButton({
  label,
  onClick,
  children,
  tone = 'default',
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`grid size-9 shrink-0 place-items-center rounded-xl border border-transparent text-muted transition-colors disabled:opacity-40 ${
        tone === 'danger' ? 'hover:border-expense/30 hover:bg-expense/10 hover:text-expense' : 'hover:border-line hover:bg-subtle hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}
