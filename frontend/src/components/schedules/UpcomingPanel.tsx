import { BellRing, CalendarClock, Zap } from 'lucide-react';
import { useMemo } from 'react';
import { useUpcoming } from '../../hooks/useSchedules';
import { formatDate, formatMoney, relativeDay, type MoneyFormat } from '../../lib/format';
import type { ScheduleEvent } from '../../types/schedules';
import { EmptyState, ErrorState, Panel, Segmented, Skeleton } from '../dashboard/ui';
import { longDate, ScheduleIcon } from './parts';

export const UPCOMING_RANGES = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
] as const;
export type UpcomingRange = (typeof UPCOMING_RANGES)[number]['id'];

/**
 * Every scheduled execution coming up across all schedules, grouped by day (GET /api/forecast,
 * schedule events only). Items waiting for approval are listed on today.
 */
export function UpcomingPanel({
  range,
  onRange,
  fmt,
  onOpenSchedule,
}: {
  range: UpcomingRange;
  onRange: (r: UpcomingRange) => void;
  fmt: MoneyFormat;
  onOpenSchedule: (id: number) => void;
}) {
  const q = useUpcoming(Number(range));
  const data = q.data;

  const { days, income, expense } = useMemo(() => {
    const byDay = new Map<string, ScheduleEvent[]>();
    let inc = 0;
    let exp = 0;
    for (const e of data?.events ?? []) {
      if (!byDay.has(e.date)) byDay.set(e.date, []);
      byDay.get(e.date)!.push(e);
      if (e.amountMinor > 0) inc += e.amountMinor;
      else exp -= e.amountMinor;
    }
    return { days: [...byDay.entries()], income: inc, expense: exp };
  }, [data]);

  return (
    <Panel
      title="Upcoming"
      icon={CalendarClock}
      action={<Segmented options={UPCOMING_RANGES} value={range} onChange={onRange} label="Upcoming range" layoutId="sw-sched-upcoming" />}
    >
      {q.isPending ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className={`transition-opacity ${q.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={q.isPlaceholderData || undefined}>
          <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-subtle px-3 py-2">
              <dt className="text-xs text-muted">Coming in</dt>
              <dd className="font-semibold tabular-nums text-income">{formatMoney(income, fmt, { signed: true })}</dd>
            </div>
            <div className="rounded-xl bg-subtle px-3 py-2">
              <dt className="text-xs text-muted">Going out</dt>
              <dd className="font-semibold tabular-nums">{formatMoney(-expense, fmt)}</dd>
            </div>
          </dl>

          {days.length === 0 ? (
            <EmptyState icon={CalendarClock} title={`Nothing scheduled in the next ${range} days`}>
              Paused and finished schedules don't show here.
            </EmptyState>
          ) : (
            <ol className="space-y-4" aria-label={`Scheduled in the next ${range} days`}>
              {days.map(([date, events]) => (
                <li key={date}>
                  <h3 className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    <span title={longDate(date, fmt.locale)}>{data && relativeDay(date, data.asOf, fmt.locale)}</span>
                    <span className="font-normal normal-case tracking-normal">{formatDate(date, fmt.locale, { weekday: 'long' })}</span>
                  </h3>
                  <ul className="space-y-1">
                    {events.map((e) => (
                      <li key={e.key}>
                        <button
                          type="button"
                          onClick={() => e.scheduleId && onOpenSchedule(e.scheduleId)}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-subtle"
                        >
                          <ScheduleIcon icon={e.categoryIcon} kind={e.kind} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{e.name}</span>
                            <span className="flex items-center gap-1 truncate text-xs text-muted">
                              {e.state === 'pending' ? (
                                <>
                                  <BellRing className="size-3 shrink-0 text-accent" aria-hidden />
                                  {e.overdue ? `Overdue, was due ${relativeDay(e.dueDate, data!.asOf, fmt.locale)}` : 'Waiting for approval'}
                                </>
                              ) : e.mode === 'auto' ? (
                                <>
                                  <Zap className="size-3 shrink-0" aria-hidden /> Posts automatically
                                </>
                              ) : (
                                <>
                                  <BellRing className="size-3 shrink-0" aria-hidden /> Will ask you
                                </>
                              )}
                              <span aria-hidden>·</span>
                              <span className="truncate">{e.accountName}</span>
                            </span>
                          </span>
                          <span className={`text-sm font-semibold tabular-nums ${e.kind === 'income' ? 'text-income' : ''}`}>
                            {formatMoney(e.amountMinor, fmt, { signed: true })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
          {data?.truncated && <p className="mt-3 text-xs text-muted">Showing the first part only: there are a lot of scheduled dates in this range.</p>}
        </div>
      )}
    </Panel>
  );
}
