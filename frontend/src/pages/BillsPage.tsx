import { motion } from 'framer-motion';
import { AlertTriangle, CalendarClock, CalendarPlus, Plus, Receipt, Repeat } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BillRow } from '../components/bills/BillRow';
import { PAID_RANGES, PaidPanel, type PaidRange } from '../components/bills/PaidPanel';
import { EmptyState, ErrorState, Panel, rise, Segmented, Skeleton, stagger } from '../components/dashboard/ui';
import { useScheduleManager } from '../components/schedules/useScheduleManager';
import { AccountSelect } from '../components/transactions/pickers';
import { CONTROL } from '../components/ui/Dialog';
import { useMoneyFormat } from '../hooks/useDashboard';
import { useBills } from '../hooks/useSchedules';
import { formatMoney, localToday } from '../lib/format';
import type { DueBill } from '../types/bills';

const DUE_RANGES = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
] as const;
type DueRange = (typeof DUE_RANGES)[number]['id'];
const isDue = (v: string | null): v is DueRange => DUE_RANGES.some((r) => r.id === v);
const isPaid = (v: string | null): v is PaidRange => PAID_RANGES.some((r) => r.id === v);

function Tile({ label, value, hint, tone }: { label: string; value: string | undefined; hint: string; tone?: 'warning' }) {
  const color = tone === 'warning' ? 'text-warning' : '';
  return (
    <div className="glass rounded-2xl border border-line px-4 py-3.5 shadow-glass" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      {value === undefined ? <Skeleton className="mt-2 h-6 w-24" /> : <p className={`mt-1 text-lg font-bold tabular-nums tracking-tight ${color}`}>{value}</p>}
      <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Groups the not-yet-paid bills: today, the next 7 days, later. */
function groupUpcoming(list: DueBill[]) {
  const groups: { id: string; title: string; bills: DueBill[] }[] = [
    { id: 'today', title: 'Due today', bills: [] },
    { id: 'week', title: 'Next 7 days', bills: [] },
    { id: 'later', title: 'Later', bills: [] },
  ];
  for (const b of list) groups[b.daysFromToday <= 0 ? 0 : b.daysFromToday <= 7 ? 1 : 2].bills.push(b);
  return groups.filter((g) => g.bills.length);
}

/**
 * Bills: scheduled expenses that are overdue, due or coming up, and what was paid or skipped
 * (GET /api/bills). Acting on a bill uses the schedule APIs. URL: ?days=7|30|90, ?paid=30|60|90|365,
 * ?account=<id>, ?open=<schedule id>.
 */
export default function BillsPage() {
  const fmt = useMoneyFormat();
  const [params, setParams] = useSearchParams();

  const days: DueRange = isDue(params.get('days')) ? (params.get('days') as DueRange) : '30';
  const paidDays: PaidRange = isPaid(params.get('paid')) ? (params.get('paid') as PaidRange) : '60';
  const accountRaw = params.get('account');
  const account = accountRaw && /^\d+$/.test(accountRaw) ? Number(accountRaw) : null;

  const q = useBills({ upcomingDays: Number(days), paidDays: Number(paidDays), account });
  const data = q.data;
  const today = data?.asOf ?? localToday();
  const mgr = useScheduleManager({ today, fmt });

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(window.location.search);
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [setParams],
  );

  /** The first not-yet-due row of each schedule is its next date: only that one can be paid or skipped early. */
  const nextKeys = useMemo(() => {
    const seen = new Set<number>();
    const keys = new Set<string>();
    for (const b of data?.upcoming ?? []) {
      if (b.awaitingApproval || seen.has(b.scheduleId)) continue;
      seen.add(b.scheduleId);
      keys.add(`${b.scheduleId}|${b.dueDate}`);
    }
    return keys;
  }, [data]);

  const groups = useMemo(() => groupUpcoming(data?.upcoming ?? []), [data]);
  const t = data?.totals;
  const nothingAtAll = data && !data.overdue.length && !data.upcoming.length && !data.paid.length && !data.skipped.length;

  const rowProps = { today, fmt, onOpen: mgr.openSchedule, onMessage: mgr.message };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-24">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">What's due, what's overdue and what's paid</p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
            {t ? (t.overdueCount ? `${plural(t.overdueCount, 'bill')} overdue` : t.upcomingCount ? `${plural(t.upcomingCount, 'bill')} coming up` : 'All caught up') : 'Bills'}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountSelect
            accounts={mgr.accounts}
            includeClosed
            value={account}
            onChange={(id) => setParam('account', id === null ? null : String(id))}
            allLabel="All accounts"
            aria-label="Account"
            className={`${CONTROL.replace('w-full', '')} h-11 w-44`}
          />
          <Link
            to="/schedules"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium transition-colors hover:border-accent/60 hover:bg-subtle"
          >
            <Repeat className="size-4 text-muted" aria-hidden />
            <span className="hidden sm:inline">All schedules</span>
            <span className="sr-only sm:hidden">All schedules</span>
          </Link>
          <button
            type="button"
            onClick={mgr.newSchedule}
            disabled={!mgr.canCreate}
            title={!mgr.hasOpenAccount && !mgr.accountsLoading ? 'Add an account first' : undefined}
            className="inline-flex h-11 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            <Plus className="size-4" aria-hidden /> New bill
          </button>
        </div>
      </motion.div>

      <motion.div variants={rise} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Overdue"
          value={t ? formatMoney(t.overdueMinor, fmt) : undefined}
          hint={t ? (t.overdueCount ? `${plural(t.overdueCount, 'bill')} waiting for you` : 'Nothing overdue') : 'Past due, not approved'}
          tone={t?.overdueCount ? 'warning' : undefined}
        />
        <Tile
          label={`Due in the next ${days} days`}
          value={t ? formatMoney(t.upcomingMinor, fmt) : undefined}
          hint={t ? plural(t.upcomingCount, 'bill') : 'Coming up'}
        />
        <Tile
          label={`Paid in the last ${paidDays === '365' ? 'year' : `${paidDays} days`}`}
          value={t ? formatMoney(t.paidMinor, fmt) : undefined}
          hint={t ? plural(t.paidCount, 'bill') : 'From your schedules'}
        />
        <Tile
          label="Repeating bills per month"
          value={t ? formatMoney(t.subscriptionsMonthlyMinor, fmt) : undefined}
          hint={t ? `${plural(t.subscriptionCount, 'active repeating bill')}, monthly average` : 'Subscriptions and regular bills'}
        />
      </motion.div>

      {q.isPending ? (
        <motion.div variants={rise} className="glass space-y-3 rounded-3xl border border-line p-5 shadow-glass" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </motion.div>
      ) : q.isError ? (
        <motion.div variants={rise} className="glass rounded-3xl border border-line p-5 shadow-glass">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </motion.div>
      ) : nothingAtAll && !account ? (
        <motion.div variants={rise} className="glass rounded-3xl border border-line p-5 shadow-glass">
          <EmptyState icon={Receipt} title="No bills yet">
            <p>Add rent, electricity or a subscription as a schedule, and it shows up here when it's due.</p>
            {mgr.hasOpenAccount ? (
              <button
                type="button"
                onClick={mgr.newSchedule}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg"
              >
                <CalendarPlus className="size-4" aria-hidden /> Add your first bill
              </button>
            ) : (
              !mgr.accountsLoading && <p className="mt-3 font-medium text-fg">Add an account on the Dashboard first.</p>
            )}
          </EmptyState>
        </motion.div>
      ) : (
        <div className={`space-y-5 transition-opacity ${q.isPlaceholderData ? 'opacity-60' : ''}`} aria-busy={q.isPlaceholderData || undefined}>
          {data!.overdue.length > 0 && (
            <Panel title={`Overdue (${data!.overdue.length})`} icon={AlertTriangle}>
              <p className="-mt-2 mb-1 text-sm text-muted">
                These came due on bills set to ask you first. Approve what you paid, or skip what you didn't.
              </p>
              <ul className="divide-y divide-line" aria-label="Overdue bills">
                {data!.overdue.map((b) => (
                  <BillRow key={`${b.scheduleId}|${b.dueDate}`} bill={b} isNext={false} {...rowProps} />
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <Panel
              title="Coming up"
              icon={CalendarClock}
              action={
                <Segmented
                  options={DUE_RANGES}
                  value={days}
                  onChange={(r) => setParam('days', r === '30' ? null : r)}
                  label="Coming up range"
                  layoutId="sw-bills-due-range"
                />
              }
            >
              {groups.length === 0 ? (
                <EmptyState icon={CalendarClock} title={`No bills in the next ${days} days`}>
                  {account !== null ? 'For this account. ' : ''}Paused schedules don't show here.
                </EmptyState>
              ) : (
                <div className="space-y-4">
                  {groups.map((g) => (
                    <section key={g.id} aria-label={g.title}>
                      <h3 className="flex items-baseline justify-between text-xs font-semibold uppercase tracking-wide text-muted">
                        <span>{g.title}</span>
                        <span className="font-normal normal-case tracking-normal tabular-nums">
                          {formatMoney(
                            g.bills.reduce((n, b) => n + b.amountMinor, 0),
                            fmt,
                          )}
                        </span>
                      </h3>
                      <ul className="divide-y divide-line">
                        {g.bills.map((b) => (
                          <BillRow key={`${b.scheduleId}|${b.dueDate}`} bill={b} isNext={nextKeys.has(`${b.scheduleId}|${b.dueDate}`)} {...rowProps} />
                        ))}
                      </ul>
                    </section>
                  ))}
                  {data!.truncated && <p className="text-xs text-muted">Showing the first part only: there are a lot of bills in this range.</p>}
                </div>
              )}
            </Panel>

            <PaidPanel
              paid={data!.paid}
              skipped={data!.skipped}
              range={paidDays}
              onRange={(r) => setParam('paid', r === '60' ? null : r)}
              fmt={fmt}
              onOpen={mgr.openSchedule}
              dim={q.isPlaceholderData}
            />
          </div>
        </div>
      )}

      {mgr.overlays}
    </motion.div>
  );
}
