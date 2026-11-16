import { CalendarCheck, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { monthName } from '../../lib/format';
import { currentMonth, monthRange } from '../../lib/months';

const ICON_BTN =
  'grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-fg transition-colors hover:border-accent/60 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40';

/** ◀ [month] ▶ · This month. Keyboard: the select works with arrow keys. */
export function MonthNav({
  month,
  prev,
  next,
  locale,
  loading,
  onChange,
}: {
  month: string;
  prev: string | null;
  next: string | null;
  locale: string;
  loading: boolean;
  onChange: (month: string) => void;
}) {
  const today = currentMonth();
  const options = useMemo(() => {
    const list = monthRange(today, 24, 12);
    if (!list.includes(month)) list.push(month);
    return list.sort().reverse();
  }, [today, month]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={ICON_BTN} onClick={() => prev && onChange(prev)} disabled={!prev} aria-label="Previous month">
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      <div className="relative">
        <label htmlFor="budget-month" className="sr-only">
          Month
        </label>
        <select
          id="budget-month"
          value={month}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 appearance-none rounded-xl border border-line bg-surface pl-4 pr-10 text-sm font-semibold text-fg outline-none transition-colors hover:border-accent/60 focus:border-accent focus:ring-4 focus:ring-accent/15 focus-visible:outline-none"
        >
          {options.map((m) => (
            <option key={m} value={m} className="bg-elevated text-fg">
              {monthName(m, locale)}
              {m === today ? ' (this month)' : ''}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">
          {loading ? <Loader2 className="size-4 animate-spin" aria-label="Loading" /> : <ChevronRight className="size-4 rotate-90" aria-hidden />}
        </span>
      </div>
      <button type="button" className={ICON_BTN} onClick={() => next && onChange(next)} disabled={!next} aria-label="Next month">
        <ChevronRight className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onChange(today)}
        disabled={month === today}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium text-fg transition-colors hover:border-accent/60 hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
      >
        <CalendarCheck className="size-4 text-muted" aria-hidden />
        This month
      </button>
    </div>
  );
}
