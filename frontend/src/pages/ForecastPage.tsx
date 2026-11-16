import { motion } from 'framer-motion';
import { AlertTriangle, CalendarClock, CircleCheck, LineChart, PenLine, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { EventRow } from '../components/calendar/EventRow';
import { EmptyState, ErrorState, Panel, rise, Segmented, Skeleton, stagger } from '../components/dashboard/ui';
import { BalanceChart, BalanceTable } from '../components/forecast/BalanceChart';
import { BudgetImpactPanel } from '../components/forecast/BudgetImpactPanel';
import { ReportPanel } from '../components/reports/common';
import { ScheduleIcon } from '../components/schedules/parts';
import { useScheduleManager } from '../components/schedules/useScheduleManager';
import { AccountSelect } from '../components/transactions/pickers';
import { CONTROL } from '../components/ui/Dialog';
import { useMoneyFormat } from '../hooks/useDashboard';
import { useForecast, useScheduleList } from '../hooks/useSchedules';
import { formatDate, formatMoney, localToday, relativeDay, type MoneyFormat } from '../lib/format';
import type { CalendarEvent } from '../types/calendar';
import type { ForecastEvent, ForecastHorizon } from '../types/forecast';

const RANGES = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
  { id: '180', label: '6 months' },
  { id: '365', label: '1 year' },
] as const;
type Range = (typeof RANGES)[number]['id'];
const isRange = (v: string | null): v is Range => RANGES.some((r) => r.id === v);
const EVENTS_SHOWN = 40;

function Tile({ label, value, hint, tone }: { label: string; value: string | undefined; hint: string; tone?: 'income' | 'expense' }) {
  const color = tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-expense' : '';
  return (
    <div className="glass rounded-2xl border border-line px-4 py-3.5 shadow-glass" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      {value === undefined ? <Skeleton className="mt-2 h-6 w-24" /> : <p className={`mt-1 text-lg font-bold tabular-nums tracking-tight ${color}`}>{value}</p>}
      <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>
    </div>
  );
}

/** A forecast event from a schedule, in the shape the calendar's event row understands (dated by its due date). */
const asCalendarEvent = (e: ForecastEvent): CalendarEvent => ({
  ...e,
  source: 'schedule',
  scheduleId: e.scheduleId!,
  date: e.dueDate,
  state: e.state === 'pending' ? 'pending' : 'projected',
  mode: e.mode ?? 'approval',
});

/**
 * Forecast: projected balance from today's funds plus everything scheduled and every future-dated
 * transaction (GET /api/forecast), and what the scheduled money does to the budget.
 * URL: ?days=7|30|90|180|365, ?account=<id>, ?open=<schedule id>.
 */
export default function ForecastPage() {
  const fmt = useMoneyFormat();
  const [params, setParams] = useSearchParams();
  const days: Range = isRange(params.get('days')) ? (params.get('days') as Range) : '30';
  const accountRaw = params.get('account');
  const account = accountRaw && /^\d+$/.test(accountRaw) ? Number(accountRaw) : null;

  const q = useForecast(Number(days), account);
  const schedulesQ = useScheduleList();
  const f = q.data;
  const today = f?.asOf ?? localToday();
  const mgr = useScheduleManager({ today, fmt });
  const [showAll, setShowAll] = useState(false);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(window.location.search);
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [setParams],
  );

  const nextDates = useMemo(() => new Map((schedulesQ.data?.schedules ?? []).filter((s) => !s.paused && s.nextDate).map((s) => [s.id, s.nextDate!])), [schedulesQ.data]);
  const balanceOn = useMemo(() => new Map((f?.timeline ?? []).map((p) => [p.date, p.balanceMinor])), [f]);

  const groups = useMemo(() => {
    const out: { date: string; events: ForecastEvent[] }[] = [];
    let n = 0;
    for (const e of f?.events ?? []) {
      if (!showAll && n >= EVENTS_SHOWN) break;
      n += 1;
      const g = out[out.length - 1];
      if (g && g.date === e.date) g.events.push(e);
      else out.push({ date: e.date, events: [e] });
    }
    return out;
  }, [f, showAll]);

  const rowProps = { today, fmt, onOpen: mgr.openSchedule, onMessage: mgr.message };
  const rangeLabel = RANGES.find((r) => r.id === days)!.label;
  const endLabel = f ? formatDate(f.endDate, fmt.locale, { day: 'numeric', month: 'short', year: f.endDate.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' }) : '';

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-24">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Where your balance is heading</p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">Forecast · next {rangeLabel}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
            <Segmented options={RANGES} value={days} onChange={(r) => setParam('days', r === '30' ? null : r)} label="Forecast range" layoutId="sw-fc-range" />
          </div>
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
            className="inline-flex h-10 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            <Plus className="size-4" aria-hidden /> New schedule
          </button>
        </div>
      </motion.div>

      <motion.div variants={rise} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Today" value={f ? formatMoney(f.currentFundsMinor, fmt) : undefined} hint={account === null ? 'All accounts right now' : 'This account right now'} />
        <Tile label="Coming in" value={f ? formatMoney(f.upcomingIncomeMinor, fmt, { signed: true }) : undefined} hint={`Next ${rangeLabel}`} tone="income" />
        <Tile label="Going out" value={f ? formatMoney(-f.upcomingExpensesMinor, fmt) : undefined} hint={`Next ${rangeLabel}`} />
        <Tile
          label={f ? `On ${endLabel}` : 'At the end'}
          value={f ? formatMoney(f.estimatedBalanceMinor, fmt) : undefined}
          hint="Estimated balance"
          tone={f && f.estimatedBalanceMinor < 0 ? 'expense' : undefined}
        />
      </motion.div>

      {f && <Outlook f={f} fmt={fmt} today={today} />}

      {q.isError ? (
        <motion.div variants={rise} className="glass rounded-3xl border border-line p-5 shadow-glass">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </motion.div>
      ) : (
        <>
          <ReportPanel
            title="Projected balance"
            icon={LineChart}
            subtitle={account === null ? 'All accounts, end of each day' : 'This account, end of each day'}
            chart={
              f ? (
                <div className={`transition-opacity ${q.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={q.isPlaceholderData || undefined}>
                  <BalanceChart timeline={f.timeline} lowestDate={f.lowestDate} fmt={fmt} />
                </div>
              ) : (
                <Skeleton className="h-[300px] w-full" />
              )
            }
            table={f ? <BalanceTable timeline={f.timeline} fmt={fmt} /> : <Skeleton className="h-40 w-full" />}
          >
            {f && (
              <div className="mt-4 grid gap-2 sm:grid-cols-3" role="group" aria-label="At a glance">
                {f.horizons.map((h) => (
                  <HorizonCard key={h.days} h={h} fmt={fmt} active={String(h.days) === days} onPick={() => setParam('days', h.days === 30 ? null : String(h.days))} />
                ))}
              </div>
            )}
          </ReportPanel>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <Panel title="What's coming" icon={CalendarClock}>
              {!f ? (
                <div className="space-y-3" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : f.events.length === 0 ? (
                <EmptyState icon={CalendarClock} title={`Nothing coming in the next ${rangeLabel}`}>
                  Add schedules for your salary, rent and subscriptions, and the forecast fills in.
                </EmptyState>
              ) : (
                <>
                  <ol className="space-y-4" aria-label="Coming up, by day">
                    {groups.map((g) => (
                      <li key={g.date}>
                        <h3 className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                          <span className={g.date === today ? 'text-accent' : ''}>
                            {relativeDay(g.date, today, fmt.locale)}
                            {g.date !== today && <span className="font-normal normal-case tracking-normal"> · {formatDate(g.date, fmt.locale, { weekday: 'short' })}</span>}
                          </span>
                          {balanceOn.has(g.date) && (
                            <span className={`font-normal normal-case tracking-normal tabular-nums ${balanceOn.get(g.date)! < 0 ? 'font-semibold text-expense' : ''}`}>
                              Balance after {formatMoney(balanceOn.get(g.date)!, fmt)}
                            </span>
                          )}
                        </h3>
                        <ul className="divide-y divide-line">
                          {g.events.map((e) =>
                            e.source === 'schedule' && e.scheduleId !== null ? (
                              <EventRow
                                key={e.key}
                                e={asCalendarEvent(e)}
                                isNext={e.state === 'projected' && nextDates.get(e.scheduleId) === e.dueDate}
                                {...rowProps}
                              />
                            ) : (
                              <LedgerRow key={e.key} e={e} fmt={fmt} />
                            ),
                          )}
                        </ul>
                      </li>
                    ))}
                  </ol>
                  {f.events.length > EVENTS_SHOWN && (
                    <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-4 text-sm font-semibold text-accent hover:underline">
                      {showAll ? 'Show fewer' : `Show all ${f.events.length}`}
                    </button>
                  )}
                  {f.truncated && <p className="mt-2 text-xs text-muted">Very busy range: only the first part of the scheduled dates is counted.</p>}
                </>
              )}
            </Panel>

            {f ? <BudgetImpactPanel impact={f.categoryImpact} fmt={fmt} /> : <Skeleton className="h-64 w-full rounded-3xl" />}
          </div>
        </>
      )}

      {mgr.overlays}
    </motion.div>
  );
}

/** The headline: does the money last? Status in words + icon, never colour alone. */
function Outlook({ f, fmt, today }: { f: NonNullable<ReturnType<typeof useForecast>['data']>; fmt: MoneyFormat; today: string }) {
  const d = (iso: string) => formatDate(iso, fmt.locale, { weekday: 'short', day: 'numeric', month: 'short' });
  if (f.firstNegativeDate) {
    return (
      <motion.p variants={rise} role="status" className="flex items-start gap-2.5 rounded-2xl border border-expense/30 bg-expense/10 px-4 py-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-expense" aria-hidden />
        <span>
          <b className="text-expense">Your balance goes below zero {f.firstNegativeDate === today ? 'today' : `on ${d(f.firstNegativeDate)}`}.</b> The lowest point is{' '}
          <b>{formatMoney(f.lowestBalanceMinor, fmt)}</b> on {d(f.lowestDate)}. Move a bill, add income, or keep more in this account.
        </span>
      </motion.p>
    );
  }
  return (
    <motion.p variants={rise} role="status" className="flex items-start gap-2.5 rounded-2xl border border-income/30 bg-income/10 px-4 py-3 text-sm">
      <CircleCheck className="mt-0.5 size-4 shrink-0 text-income" aria-hidden />
      <span>
        <b>You stay above zero.</b> The lowest point is <b>{formatMoney(f.lowestBalanceMinor, fmt)}</b>
        {f.lowestDate === today ? ' today' : ` on ${d(f.lowestDate)}`}.
      </span>
    </motion.p>
  );
}

function HorizonCard({ h, fmt, active, onPick }: { h: ForecastHorizon; fmt: MoneyFormat; active: boolean; onPick: () => void }) {
  const neg = h.firstNegativeDate !== null;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPick}
      className={`rounded-2xl border px-3.5 py-2.5 text-left transition-colors ${active ? 'border-accent bg-accent/8 ring-2 ring-accent/20' : 'border-line hover:border-accent/40 hover:bg-subtle'}`}
    >
      <span className="block text-xs text-muted">In {h.days} days</span>
      <span className={`block font-semibold tabular-nums ${h.estimatedBalanceMinor < 0 ? 'text-expense' : ''}`}>{formatMoney(h.estimatedBalanceMinor, fmt)}</span>
      <span className={`flex items-center gap-1 text-[11px] ${neg ? 'font-medium text-expense' : 'text-muted'}`}>
        {neg && <AlertTriangle className="size-3" aria-hidden />}
        Lowest {formatMoney(h.lowestBalanceMinor, fmt)}
      </span>
    </button>
  );
}

/** A transaction already entered with a future date (not from a schedule). */
function LedgerRow({ e, fmt }: { e: ForecastEvent; fmt: MoneyFormat }) {
  return (
    <li className="flex items-center gap-3 py-3" aria-label={`${e.name}, already entered`}>
      <ScheduleIcon icon={e.categoryIcon} kind={e.kind} size="sm" />
      <div className="min-w-0 flex-1">
        <Link to={`/transactions?from=${e.date}&to=${e.date}`} className="block truncate text-sm font-semibold hover:text-accent hover:underline">
          {e.name}
        </Link>
        <p className="flex items-center gap-1 truncate text-xs text-muted">
          <PenLine className="size-3" aria-hidden /> Already entered · {[e.accountName, e.categoryName].filter(Boolean).join(' · ')}
        </p>
      </div>
      <span className={`text-sm font-semibold tabular-nums ${e.kind === 'income' ? 'text-income' : ''}`}>{formatMoney(e.amountMinor, fmt, { signed: true })}</span>
    </li>
  );
}
