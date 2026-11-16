import { motion } from 'framer-motion';
import { BellRing, CalendarDays, CalendarPlus, CircleCheck, List, Plus, SkipForward, Zap } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { MonthNav } from '../components/budget/MonthNav';
import { EventRow } from '../components/calendar/EventRow';
import { MonthGrid } from '../components/calendar/MonthGrid';
import { EmptyState, ErrorState, Panel, rise, Segmented, Skeleton, stagger } from '../components/dashboard/ui';
import { useScheduleManager } from '../components/schedules/useScheduleManager';
import { AccountSelect } from '../components/transactions/pickers';
import { CONTROL } from '../components/ui/Dialog';
import { useMoneyFormat } from '../hooks/useDashboard';
import { useCalendar, useScheduleList } from '../hooks/useSchedules';
import { formatDate, formatMoney, localToday, monthName, type MoneyFormat } from '../lib/format';
import { addMonths, currentMonth, isMonthKey } from '../lib/months';
import type { CalendarDay, CalendarEvent } from '../types/calendar';

const VIEWS = [
  { id: 'month', label: 'Month' },
  { id: 'list', label: 'List' },
] as const;
type View = (typeof VIEWS)[number]['id'];

const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

function Tile({ label, value, hint, tone }: { label: string; value: string | undefined; hint: string; tone?: 'income' | 'expense' | 'accent' }) {
  const color = tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-expense' : tone === 'accent' ? 'text-accent' : '';
  return (
    <div className="glass rounded-2xl border border-line px-4 py-3.5 shadow-glass" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      {value === undefined ? <Skeleton className="mt-2 h-6 w-24" /> : <p className={`mt-1 text-lg font-bold tabular-nums tracking-tight ${color}`}>{value}</p>}
      <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>
    </div>
  );
}

/** /calendar → /calendar/<this month>; anything that isn't a month goes there too. */
export default function CalendarPage() {
  const param = useParams()['*']?.split('/')[0];
  const location = useLocation();
  if (!isMonthKey(param)) return <Navigate to={`/calendar/${currentMonth()}${location.search}`} replace />;
  return <CalendarMonth month={param} />;
}

/**
 * Scheduled income and bills for one month, day by day (GET /api/calendar). URL: /calendar/YYYY-MM,
 * ?day=YYYY-MM-DD (selected day), ?view=list, ?account=<id>, ?open=<schedule id>.
 */
function CalendarMonth({ month }: { month: string }) {
  const fmt = useMoneyFormat();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'list' ? 'list' : 'month';
  const accountRaw = params.get('account');
  const account = accountRaw && /^\d+$/.test(accountRaw) ? Number(accountRaw) : null;

  const q = useCalendar(month, account);
  const schedulesQ = useScheduleList();
  const data = q.data && q.data.month === month ? q.data : undefined; // never show last month's days in this month's grid
  const today = q.data?.today ?? localToday();
  const mgr = useScheduleManager({ today, fmt });

  const from = `${month}-01`;
  const to = lastDay(month);
  const days = useMemo(() => new Map<string, CalendarDay>((data?.days ?? []).map((d) => [d.date, d])), [data]);

  const dayParam = params.get('day');
  const selected =
    dayParam && dayParam.startsWith(`${month}-`) && dayParam <= to
      ? dayParam
      : today.startsWith(month)
        ? today
        : (data?.days[0]?.date ?? from);

  /** Each schedule's next unhandled date: only that one can be paid or skipped early. */
  const nextDates = useMemo(() => new Map((schedulesQ.data?.schedules ?? []).filter((s) => !s.paused && s.nextDate).map((s) => [s.id, s.nextDate!])), [schedulesQ.data]);
  const isNext = (e: CalendarEvent) => e.state === 'projected' && nextDates.get(e.scheduleId) === e.date;

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(window.location.search);
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [setParams],
  );

  const goMonth = useCallback(
    (m: string, day?: string) => {
      const next = new URLSearchParams(window.location.search);
      next.delete('open');
      if (day) next.set('day', day);
      else next.delete('day');
      const qs = next.toString();
      navigate(`/calendar/${m}${qs ? `?${qs}` : ''}`);
    },
    [navigate],
  );

  function select(date: string) {
    const m = date.slice(0, 7);
    if (m === month) setParam('day', date);
    else if (isMonthKey(m)) goMonth(m, date);
  }

  function stepMonth(n: -1 | 1, fromDay: string) {
    const m = addMonths(fromDay.slice(0, 7), n);
    if (!m) return;
    const dom = Math.min(Number(fromDay.slice(8)), Number(lastDay(m).slice(8)));
    goMonth(m, `${m}-${String(dom).padStart(2, '0')}`);
  }

  const pendingCount = data?.days.reduce((n, d) => n + d.events.filter((e) => e.state === 'pending').length, 0) ?? 0;
  const counts = useMemo(() => {
    let inc = 0;
    let out = 0;
    for (const d of data?.days ?? []) for (const e of d.events) if (e.state !== 'skipped') e.kind === 'income' ? inc++ : out++;
    return { inc, out };
  }, [data]);

  const rowProps = { today, fmt, onOpen: mgr.openSchedule, onMessage: mgr.message };
  const selDay = days.get(selected);
  const t = data?.totals;
  const dim = q.isPlaceholderData || (q.isFetching && !data);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-24">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Scheduled income and bills, day by day</p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">{monthName(month, fmt.locale)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountSelect
            accounts={mgr.accounts}
            includeClosed
            value={account}
            onChange={(id) => setParam('account', id === null ? null : String(id))}
            allLabel="All accounts"
            aria-label="Account"
            className={`${CONTROL.replace('w-full', '')} h-10 w-40`}
          />
          <button
            type="button"
            onClick={mgr.newSchedule}
            disabled={!mgr.canCreate}
            title={!mgr.hasOpenAccount && !mgr.accountsLoading ? 'Add an account first' : undefined}
            className="inline-flex h-10 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            <Plus className="size-4" aria-hidden /> New schedule
          </button>
        </div>
      </motion.div>

      <motion.div variants={rise} className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={month} prev={addMonths(month, -1)} next={addMonths(month, 1)} locale={fmt.locale} loading={q.isFetching} onChange={(m) => goMonth(m)} />
        <Segmented options={VIEWS} value={view} onChange={(v) => setParam('view', v === 'month' ? null : v)} label="View" layoutId="sw-cal-view" />
      </motion.div>

      <motion.div variants={rise} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Coming in" value={t ? formatMoney(t.incomeMinor, fmt) : undefined} hint={`${counts.inc} scheduled income this month`} tone="income" />
        <Tile label="Going out" value={t ? formatMoney(t.expenseMinor, fmt) : undefined} hint={`${counts.out} scheduled payments this month`} />
        <Tile
          label="Net"
          value={t ? formatMoney(t.netMinor, fmt, { signed: true }) : undefined}
          hint="Scheduled in − out (skipped ones don't count)"
          tone={t ? (t.netMinor < 0 ? 'expense' : 'income') : undefined}
        />
        <Tile
          label="Needs approval"
          value={data ? String(pendingCount) : undefined}
          hint={pendingCount ? 'Waiting for you this month' : 'Nothing waiting this month'}
          tone={pendingCount ? 'accent' : undefined}
        />
      </motion.div>

      {q.isError ? (
        <motion.div variants={rise} className="glass rounded-3xl border border-line p-5 shadow-glass">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </motion.div>
      ) : view === 'month' ? (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <motion.section variants={rise} aria-label="Month" className={`glass min-w-0 rounded-3xl border border-line p-2.5 shadow-glass transition-opacity sm:p-5 ${dim ? 'opacity-60' : ''}`} aria-busy={dim || undefined}>
            <MonthGrid month={month} from={from} to={to} today={today} days={days} selected={selected} onSelect={select} onMonthStep={stepMonth} fmt={fmt} />
            <Legend />
            {data?.truncated && <p className="mt-2 text-xs text-muted">Showing the first part only: there are a lot of scheduled dates this month.</p>}
          </motion.section>

          <Panel title={formatDate(selected, fmt.locale, { weekday: 'long', day: 'numeric', month: 'long' })} icon={CalendarDays} className="xl:sticky xl:top-24">
            <DayDetail day={selDay} loading={!data} fmt={fmt} isNext={isNext} rowProps={rowProps} canCreate={mgr.canCreate} onNew={mgr.newSchedule} />
          </Panel>
        </div>
      ) : (
        <Panel title={`Everything in ${monthName(month, fmt.locale)}`} icon={List}>
          {!data ? (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : data.days.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Nothing scheduled this month">
              {account !== null ? 'For this account. ' : ''}Add a schedule for rent, salary or a subscription.
            </EmptyState>
          ) : (
            <ol className="space-y-5">
              {data.days.map((d) => (
                <li key={d.date} aria-label={formatDate(d.date, fmt.locale, { weekday: 'long', day: 'numeric', month: 'long' })}>
                  <h3 className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    <span className={d.date === today ? 'text-accent' : ''}>
                      {formatDate(d.date, fmt.locale, { weekday: 'short', day: 'numeric', month: 'short' })}
                      {d.date === today ? ' · Today' : ''}
                    </span>
                    <DayTotals day={d} fmt={fmt} />
                  </h3>
                  <ul className="divide-y divide-line">
                    {d.events.map((e) => (
                      <EventRow key={e.key} e={e} isNext={isNext(e)} {...rowProps} />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}

      {mgr.overlays}
    </motion.div>
  );
}

function DayTotals({ day, fmt }: { day: CalendarDay; fmt: MoneyFormat }) {
  return (
    <span className="font-normal normal-case tracking-normal tabular-nums">
      {day.incomeMinor > 0 && <span className="text-income">{formatMoney(day.incomeMinor, fmt, { signed: true })}</span>}
      {day.incomeMinor > 0 && day.expenseMinor > 0 && ' · '}
      {day.expenseMinor > 0 && <span>{formatMoney(-day.expenseMinor, fmt)}</span>}
    </span>
  );
}

function DayDetail({
  day,
  loading,
  fmt,
  isNext,
  rowProps,
  canCreate,
  onNew,
}: {
  day: CalendarDay | undefined;
  loading: boolean;
  fmt: MoneyFormat;
  isNext: (e: CalendarEvent) => boolean;
  rowProps: Omit<Parameters<typeof EventRow>[0], 'e' | 'isNext'>;
  canCreate: boolean;
  onNew: () => void;
}) {
  if (loading) return <Skeleton className="h-24 w-full" />;
  if (!day || !day.events.length) {
    return (
      <EmptyState icon={CalendarPlus} title="Nothing scheduled">
        {canCreate && (
          <button type="button" onClick={onNew} className="font-semibold text-accent hover:underline">
            Add a schedule
          </button>
        )}
      </EmptyState>
    );
  }
  return (
    <div>
      <p className="-mt-2 text-sm text-muted">
        {day.events.length} scheduled · <DayTotals day={day} fmt={fmt} />
      </p>
      <ul className="divide-y divide-line" aria-label="Scheduled on this day">
        {day.events.map((e) => (
          <EventRow key={e.key} e={e} isNext={isNext(e)} {...rowProps} />
        ))}
      </ul>
    </div>
  );
}

function Legend() {
  const item = 'inline-flex items-center gap-1';
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      <span className={`${item} sm:hidden`}>
        <span className="size-1.5 rounded-full bg-income" aria-hidden /> Money in
      </span>
      <span className={`${item} sm:hidden`}>
        <span className="size-1.5 rounded-full bg-expense" aria-hidden /> Money out
      </span>
      <span className={item}>
        <CircleCheck className="size-3 text-income" aria-hidden /> Paid / received
      </span>
      <span className={item}>
        <BellRing className="size-3 text-accent" aria-hidden /> Needs approval
      </span>
      <span className={item}>
        <Zap className="size-3" aria-hidden /> Happens automatically
      </span>
      <span className={item}>
        <BellRing className="size-3" aria-hidden /> Will ask you
      </span>
      <span className={item}>
        <SkipForward className="size-3" aria-hidden /> Skipped
      </span>
    </p>
  );
}
