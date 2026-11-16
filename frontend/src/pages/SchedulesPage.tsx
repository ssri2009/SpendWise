import { motion } from 'framer-motion';
import { BellRing, CalendarPlus, Loader2, Plus, Repeat, RefreshCw, Search, SearchX, X } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState, Panel, rise, Skeleton, stagger } from '../components/dashboard/ui';
import { ApprovalQueue } from '../components/schedules/ApprovalQueue';
import { ScheduleList, type ScheduleRowHandlers } from '../components/schedules/ScheduleList';
import { UPCOMING_RANGES, UpcomingPanel, type UpcomingRange } from '../components/schedules/UpcomingPanel';
import { useScheduleManager } from '../components/schedules/useScheduleManager';
import { CONTROL } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { useMoneyFormat } from '../hooks/useDashboard';
import { describeGenerated, useApprovalQueue, useRunDue, useScheduleList } from '../hooks/useSchedules';
import { formatMoney, localToday } from '../lib/format';
import type { Schedule, ScheduleStatus } from '../types/schedules';

type StatusTab = 'all' | ScheduleStatus;
const TABS: { id: StatusTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'finished', label: 'Finished' },
];
const isTab = (v: string | null): v is StatusTab => TABS.some((t) => t.id === v);
const isRange = (v: string | null): v is UpcomingRange => UPCOMING_RANGES.some((r) => r.id === v);

const isTyping = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
  if (t.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((t as HTMLInputElement).type);
};

function SummaryTile({ label, value, hint, tone }: { label: string; value: string | undefined; hint: string; tone?: 'income' | 'accent' }) {
  const color = tone === 'income' ? 'text-income' : tone === 'accent' ? 'text-accent' : '';
  return (
    <div className="glass rounded-2xl border border-line px-4 py-3.5 shadow-glass" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      {value === undefined ? <Skeleton className="mt-2 h-6 w-24" /> : <p className={`mt-1 text-lg font-bold tabular-nums tracking-tight ${color}`}>{value}</p>}
      <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>
    </div>
  );
}

/** Search box with its own text state (the URL updates a moment later), so fast typing never loses characters. */
const ScheduleSearch = forwardRef<HTMLInputElement, { value: string; onChange: (q: string) => void }>(function ScheduleSearch({ value, onChange }, ref) {
  const [text, setText] = useState(value);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === latest.current.value) return;
    const t = window.setTimeout(() => latest.current.onChange(text), 150);
    return () => window.clearTimeout(t);
  }, [text]);
  const clear = () => {
    setText('');
    onChange('');
  };
  return (
    <div className="relative sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={ref}
        type="search"
        aria-label="Search schedules"
        placeholder="Search  /"
        maxLength={80}
        className={`${CONTROL} h-10 pl-9 pr-9`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange(text);
          if (e.key === 'Escape') {
            if (text) {
              e.preventDefault();
              clear();
            } else (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={clear}
          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
});

function matches(s: Schedule, q: string) {
  if (!q) return true;
  const hay = `${s.name} ${s.payee} ${s.accountName} ${s.categoryName ?? ''} ${s.notes} ${s.frequencyLabel}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

/**
 * Schedules: recurring and one-time scheduled transactions (server/routes/schedules.js).
 * URL: ?status=active|paused|finished, ?q=search, ?days=7|30|90 for Upcoming, ?open=<id> for a schedule's details.
 */
export default function SchedulesPage() {
  const fmt = useMoneyFormat();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const listQ = useScheduleList();
  const queueQ = useApprovalQueue();
  const runDue = useRunDue();

  const status: StatusTab = isTab(params.get('status')) ? (params.get('status') as StatusTab) : 'all';
  const q = params.get('q') ?? '';
  const range: UpcomingRange = isRange(params.get('days')) ? (params.get('days') as UpcomingRange) : '30';

  /** Updaters read the live URL, so quick successive changes never write back a stale value. */
  const setParam = useCallback(
    (key: string, value: string | null, { replace = true } = {}) => {
      const next = new URLSearchParams(window.location.search);
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      setParams(next, { replace });
    },
    [setParams],
  );

  const searchRef = useRef<HTMLInputElement>(null);

  const data = listQ.data;
  const today = data?.today ?? localToday();
  const schedules = useMemo(() => data?.schedules ?? [], [data]);
  const queue = queueQ.data ?? [];
  const mgr = useScheduleManager({ today, fmt });
  const { busyId, canCreate, hasOpenAccount, newSchedule, openSchedule, message, fail } = mgr;

  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { all: schedules.length, active: 0, paused: 0, finished: 0 };
    for (const s of schedules) c[s.status] += 1;
    return c;
  }, [schedules]);

  const shown = useMemo(() => schedules.filter((s) => (status === 'all' || s.status === status) && matches(s, q.trim())), [schedules, status, q]);

  const totals = useMemo(() => {
    let out = 0;
    let inc = 0;
    for (const s of schedules) {
      if (s.status !== 'active') continue;
      if (s.kind === 'expense') out += s.monthlyEquivalentMinor;
      else inc += s.monthlyEquivalentMinor;
    }
    const waiting = queue.reduce((n, o) => n + o.amountMinor, 0);
    return { out, inc, waiting };
  }, [schedules, queue]);

  /* ---------- actions ---------- */

  const handlers: ScheduleRowHandlers = {
    onOpen: (s) => openSchedule(s.id),
    onEdit: mgr.editSchedule,
    onPause: mgr.pauseSchedule,
    onResume: mgr.resumeSchedule,
    onDelete: mgr.deleteSchedule,
  };

  function runNow() {
    runDue.mutate(undefined, {
      onSuccess: (r) => {
        const text = describeGenerated(r.generated);
        if (text) toast.success(text);
        else toast.info('Everything is up to date: nothing was due.');
      },
      onError: fail,
    });
  }

  // Keyboard: N = new schedule, / = search. Not while typing or while a dialog / drawer is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        newSchedule();
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newSchedule]);

  /* ---------- render ---------- */

  const btn =
    'inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium transition-colors hover:border-accent/60 hover:bg-subtle disabled:opacity-60';

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-24">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Bills, subscriptions and salary on repeat</p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
            {data ? `${counts.all.toLocaleString(fmt.locale)} schedule${counts.all === 1 ? '' : 's'}` : 'Schedules'}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btn}
            onClick={runNow}
            disabled={runDue.isPending}
            aria-label="Run due now"
            title="Create or queue everything that is due today"
          >
            {runDue.isPending ? <Loader2 className="size-4 animate-spin text-muted" aria-hidden /> : <RefreshCw className="size-4 text-muted" aria-hidden />}
            <span className="hidden sm:inline">Run due now</span>
          </button>
          <button
            type="button"
            onClick={newSchedule}
            disabled={!canCreate}
            title={!hasOpenAccount && !mgr.accountsLoading ? 'Add an account first' : undefined}
            className="inline-flex h-11 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            <Plus className="size-4" aria-hidden /> New schedule
            <kbd className="hidden rounded bg-white/20 px-1.5 text-[10px] sm:inline">N</kbd>
          </button>
        </div>
      </motion.div>

      <motion.div variants={rise} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          label="Active"
          value={data ? String(counts.active) : undefined}
          hint={data ? `${counts.paused} paused · ${counts.finished} finished` : 'Schedules running'}
        />
        <SummaryTile label="Going out per month" value={data ? formatMoney(totals.out, fmt) : undefined} hint="Active expenses, monthly average" />
        <SummaryTile label="Coming in per month" value={data ? formatMoney(totals.inc, fmt) : undefined} hint="Active income, monthly average" tone="income" />
        <SummaryTile
          label="Waiting for approval"
          value={queueQ.data ? String(queue.length) : undefined}
          hint={queue.length ? `${formatMoney(totals.waiting, fmt, { signed: true })} in total` : 'Nothing to approve'}
          tone={queue.length ? 'accent' : undefined}
        />
      </motion.div>

      {queue.length > 0 && (
        <Panel title={`Waiting for your approval (${queue.length})`} icon={BellRing}>
          <p className="-mt-2 mb-1 text-sm text-muted">These came due on schedules set to ask first. Nothing touches your balance until you approve.</p>
          <ApprovalQueue items={queue} today={today} fmt={fmt} onOpenSchedule={openSchedule} onMessage={message} />
        </Panel>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <motion.section variants={rise} aria-label="Your schedules" className="glass min-w-0 rounded-3xl border border-line p-3 shadow-glass sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label="Show" className="flex overflow-x-auto rounded-xl bg-subtle p-1">
              {TABS.map((t) => {
                const active = t.id === status;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={active}
                    aria-label={data ? `${t.label} (${counts[t.id]})` : t.label}
                    onClick={() => setParam('status', t.id === 'all' ? null : t.id)}
                    className={`relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active ? 'bg-elevated text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'
                    }`}
                  >
                    {t.label}
                    {data && (
                      <span aria-hidden className={`tabular-nums ${active ? 'text-muted' : 'text-muted/70'}`}>
                        {counts[t.id]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <ScheduleSearch ref={searchRef} value={q} onChange={(text) => setParam('q', text)} />
          </div>

          <div className="mt-3">
            {listQ.isPending ? (
              <div className="space-y-3 py-2" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : listQ.isError ? (
              <ErrorState error={listQ.error} onRetry={() => void listQ.refetch()} />
            ) : schedules.length === 0 ? (
              <EmptyState icon={Repeat} title="No schedules yet">
                <p>Add rent, a subscription or your salary once, and SpendWise creates it every time it's due, or asks you first.</p>
                {hasOpenAccount ? (
                  <button
                    type="button"
                    onClick={newSchedule}
                    className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg"
                  >
                    <CalendarPlus className="size-4" aria-hidden /> Create your first schedule
                  </button>
                ) : (
                  !mgr.accountsLoading && <p className="mt-3 font-medium text-fg">Add an account on the Dashboard first.</p>
                )}
              </EmptyState>
            ) : shown.length === 0 ? (
              <EmptyState icon={SearchX} title="Nothing matches">
                <button
                  type="button"
                  className="font-semibold text-accent hover:underline"
                  onClick={() => {
                    const next = new URLSearchParams(window.location.search);
                    next.delete('q');
                    next.delete('status');
                    setParams(next, { replace: true });
                  }}
                >
                  Show all schedules
                </button>
              </EmptyState>
            ) : (
              <ScheduleList schedules={shown} today={today} fmt={fmt} busyId={busyId} handlers={handlers} />
            )}
          </div>
        </motion.section>

        <UpcomingPanel range={range} onRange={(r) => setParam('days', r === '30' ? null : r)} fmt={fmt} onOpenSchedule={openSchedule} />
      </div>

      {mgr.overlays}
    </motion.div>
  );
}
