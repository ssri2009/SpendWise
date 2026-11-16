import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { formatDate, formatMoneyCompact, monthName, type MoneyFormat } from '../../lib/format';
import { addMonths as shiftMonth } from '../../lib/months';
import { addDays, daysBetween } from '../../lib/recurrence';
import type { CalendarDay } from '../../types/calendar';
import { StateGlyph } from './EventRow';

const MAX_CHIPS = 3;

/** Monday-first week. 2026-11-01 (a Sunday) → 6. */
const weekdayIndex = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
};

/**
 * Month grid, Monday first. Each day is a button; arrow keys move a day / a week, Home / End jump to the
 * start / end of the week, Page Up / Page Down change month. Wide screens show event chips, phones show dots.
 */
export function MonthGrid({
  month,
  from,
  to,
  today,
  days,
  selected,
  onSelect,
  onMonthStep,
  fmt,
}: {
  month: string;
  from: string;
  to: string;
  today: string;
  days: Map<string, CalendarDay>;
  selected: string;
  /** May be a date outside this month (keyboard): the page then shows that month. */
  onSelect: (date: string) => void;
  /** Page Up / Page Down: `from` is the day the keyboard is on. */
  onMonthStep: (n: -1 | 1, from: string) => void;
  fmt: MoneyFormat;
}) {
  const locale = fmt.locale;
  const lead = weekdayIndex(from);
  const count = daysBetween(from, to) + 1;
  const dates = useMemo(() => Array.from({ length: count }, (_, i) => addDays(from, i)), [from, count]);
  const trail = (7 - ((lead + count) % 7)) % 7;
  const gridRef = useRef<HTMLDivElement>(null);
  /** Where focus should land once it renders: a day (arrow keys) or a month (Page Up / Down). */
  const focusPending = useRef<{ date?: string; month?: string } | null>(null);
  /** The selection as of the last key press: fast repeats must not read a value that hasn't rendered yet. */
  const cur = useRef(selected);
  useEffect(() => {
    cur.current = selected;
  }, [selected]);

  // Week-day names in the user's locale (2024-01-01 was a Monday).
  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => ({ short: formatDate(addDays('2024-01-01', i), locale, { weekday: 'short' }), long: formatDate(addDays('2024-01-01', i), locale, { weekday: 'long' }) })),
    [locale],
  );

  // After a keyboard move, focus follows the selection (also across a month change).
  // Earlier selections that render late are ignored: only the one asked for takes focus.
  useEffect(() => {
    const want = focusPending.current;
    if (!want) return;
    if (want.date ? selected !== want.date : month !== want.month) return;
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${selected}"]`);
    if (el) {
      el.focus();
      focusPending.current = null;
    }
  }, [selected, month]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const base = cur.current;
    let target: string | null = null;
    if (e.key in steps) target = addDays(base, steps[e.key]);
    else if (e.key === 'Home') target = addDays(base, -weekdayIndex(base));
    else if (e.key === 'End') target = addDays(base, 6 - weekdayIndex(base));
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const m = shiftMonth(cur.current.slice(0, 7), e.key === 'PageUp' ? -1 : 1);
      if (!m) return;
      focusPending.current = { month: m };
      onMonthStep(e.key === 'PageUp' ? -1 : 1, cur.current);
      return;
    }
    if (!target) return;
    e.preventDefault();
    cur.current = target;
    // Same month: the button is already there, so focus moves at once; another month focuses after it renders.
    const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${target}"]`);
    if (el) el.focus();
    else focusPending.current = { date: target };
    onSelect(target); // a date in another month makes the page move to that month

  }

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-1.5 sm:gap-1.5" aria-hidden>
        {weekdays.map((w) => (
          <div key={w.long} className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span className="sm:hidden">{w.short.slice(0, 1)}</span>
            <span className="hidden sm:inline">{w.short}</span>
          </div>
        ))}
      </div>
      <div ref={gridRef} role="group" aria-label={`Calendar for ${monthName(month, locale)}. Use the arrow keys to move between days.`} onKeyDown={onKeyDown} className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} className="min-h-14 rounded-xl sm:min-h-28" aria-hidden />
        ))}
        {dates.map((date) => {
          const day = days.get(date);
          const events = day?.events ?? [];
          const isSel = date === selected;
          const isToday = date === today;
          const past = date < today;
          const dayNum = Number(date.slice(8));
          const label = [
            formatDate(date, locale, { weekday: 'long', day: 'numeric', month: 'long' }),
            isToday ? 'today' : null,
            events.length ? `${events.length} scheduled` : 'nothing scheduled',
            day?.incomeMinor ? `in ${formatMoneyCompact(day.incomeMinor, fmt)}` : null,
            day?.expenseMinor ? `out ${formatMoneyCompact(day.expenseMinor, fmt)}` : null,
            events.some((e) => e.state === 'pending') ? 'needs approval' : null,
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              tabIndex={isSel ? 0 : -1}
              aria-pressed={isSel}
              aria-label={label}
              onClick={() => onSelect(date)}
              className={`group relative flex min-h-14 flex-col rounded-xl border p-1 text-left transition-colors sm:min-h-28 sm:p-1.5 ${
                isSel ? 'border-accent bg-accent/8 ring-2 ring-accent/25' : 'border-line hover:border-accent/40 hover:bg-subtle'
              } ${past && !isSel ? 'bg-subtle/40' : ''}`}
            >
              <span className="flex items-center justify-between">
                <span
                  className={`grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums ${
                    isToday ? 'bg-accent text-accent-fg' : past ? 'text-muted' : ''
                  }`}
                >
                  {dayNum}
                </span>
                {events.some((e) => e.state === 'pending') && <span className="size-1.5 rounded-full bg-accent sm:hidden" aria-hidden />}
              </span>

              {/* phones: one dot per event (max 4), green = in, red = out */}
              {events.length > 0 && (
                <span className="mt-auto flex flex-wrap justify-center gap-0.5 pb-0.5 sm:hidden" aria-hidden>
                  {events.slice(0, 4).map((e) => (
                    <span
                      key={e.key}
                      className={`size-1.5 rounded-full ${e.state === 'skipped' ? 'bg-muted/40' : e.kind === 'income' ? 'bg-income' : 'bg-expense'}`}
                    />
                  ))}
                </span>
              )}

              {/* wider screens: chips */}
              <span className="mt-1 hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden>
                {events.slice(0, MAX_CHIPS).map((e) => (
                  <span
                    key={e.key}
                    title={`${e.name}: ${formatMoneyCompact(e.amountMinor, fmt)}`}
                    className={`flex min-w-0 items-center gap-1 rounded-md px-1 py-0.5 text-[11px] leading-tight ${
                      e.state === 'skipped' ? 'text-muted line-through' : e.kind === 'income' ? 'bg-income/10' : 'bg-expense/8'
                    }`}
                  >
                    <StateGlyph e={e} className="size-2.5 shrink-0" />
                    <span className="truncate font-medium">{e.name}</span>
                  </span>
                ))}
                {events.length > MAX_CHIPS && <span className="px-1 text-[10px] font-semibold text-muted">+{events.length - MAX_CHIPS} more</span>}
              </span>
            </button>
          );
        })}
        {Array.from({ length: trail }, (_, i) => (
          <div key={`trail-${i}`} className="min-h-14 rounded-xl sm:min-h-28" aria-hidden />
        ))}
      </div>
    </div>
  );
}
