import { CircleCheck, ExternalLink, History, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import { daysBetween } from '../../lib/recurrence';
import type { PaidBill, SkippedBill } from '../../types/bills';
import { EmptyState, Panel, Segmented } from '../dashboard/ui';
import { longDate, ScheduleIcon } from '../schedules/parts';

export const PAID_RANGES = [
  { id: '30', label: '30 days' },
  { id: '60', label: '60 days' },
  { id: '90', label: '90 days' },
  { id: '365', label: 'Year' },
] as const;
export type PaidRange = (typeof PAID_RANGES)[number]['id'];

/** Early / late / on time, from the due date and the date of the transaction that paid it. */
function timing(b: PaidBill): { text: string; tone: string } | null {
  const d = daysBetween(b.dueDate, b.paidDate);
  if (d === 0) return { text: 'On time', tone: 'text-income' };
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} early`, tone: 'text-income' };
  return { text: `${d} day${d === 1 ? '' : 's'} late`, tone: 'text-warning' };
}

/** What was paid or skipped in the last N days (GET /api/bills paid / skipped). */
export function PaidPanel({
  paid,
  skipped,
  range,
  onRange,
  fmt,
  onOpen,
  dim,
}: {
  paid: PaidBill[];
  skipped: SkippedBill[];
  range: PaidRange;
  onRange: (r: PaidRange) => void;
  fmt: MoneyFormat;
  onOpen: (scheduleId: number) => void;
  dim: boolean;
}) {
  const [tab, setTab] = useState<'paid' | 'skipped'>('paid');
  const locale = fmt.locale;
  const rangeLabel = range === '365' ? 'the last year' : `the last ${range} days`;

  return (
    <Panel
      title="History"
      icon={History}
      action={<Segmented options={PAID_RANGES} value={range} onChange={onRange} label="History range" layoutId="sw-bills-paid-range" />}
    >
      <div className={`transition-opacity ${dim ? 'opacity-60' : ''}`}>
        <div role="group" aria-label="Show" className="mb-2 flex w-fit rounded-xl bg-subtle p-1">
          {(
            [
              { id: 'paid', label: 'Paid', n: paid.length },
              { id: 'skipped', label: 'Skipped', n: skipped.length },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              aria-label={`${t.label} (${t.n})`}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                tab === t.id ? 'bg-elevated text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'
              }`}
            >
              {t.label}
              <span aria-hidden className="tabular-nums text-muted">
                {t.n}
              </span>
            </button>
          ))}
        </div>

        {tab === 'paid' ? (
          paid.length === 0 ? (
            <EmptyState icon={CircleCheck} title={`Nothing paid in ${rangeLabel}`} />
          ) : (
            <ul className="divide-y divide-line" aria-label="Paid bills">
              {paid.map((b) => {
                const t = timing(b);
                const href = `/transactions?from=${b.paidDate}&to=${b.paidDate}${b.payee ? `&q=${encodeURIComponent(b.payee)}` : ''}`;
                return (
                  <li key={b.occurrenceId} className="flex items-center gap-3 py-2.5">
                    <ScheduleIcon icon={b.categoryIcon} kind="expense" size="sm" />
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => onOpen(b.scheduleId)} className="block truncate text-left text-sm font-medium hover:text-accent hover:underline">
                        {b.name}
                      </button>
                      <p className="truncate text-xs text-muted">
                        Paid {longDate(b.paidDate, locale)}
                        {t && <span className={`font-medium ${t.tone}`}> · {t.text}</span>}
                        {b.paidDate !== b.dueDate && <span> · due {longDate(b.dueDate, locale)}</span>}
                        <span> · {b.accountName}</span>
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{formatMoney(b.amountMinor, fmt, { signed: true })}</span>
                    {b.transactionId !== null && (
                      <Link
                        to={href}
                        aria-label={`See the ${b.name} transaction in Transactions`}
                        title="See it in Transactions"
                        className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : skipped.length === 0 ? (
          <EmptyState icon={SkipForward} title={`Nothing skipped in ${rangeLabel}`} />
        ) : (
          <ul className="divide-y divide-line" aria-label="Skipped bills">
            {skipped.map((b) => (
              <li key={b.occurrenceId} className="flex items-center gap-3 py-2.5">
                <ScheduleIcon icon={null} kind="expense" size="sm" />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpen(b.scheduleId)} className="block truncate text-left text-sm font-medium hover:text-accent hover:underline">
                    {b.name}
                  </button>
                  <p className="truncate text-xs text-muted">
                    Skipped · was due {longDate(b.dueDate, locale)} · {b.accountName}
                  </p>
                </div>
                <span className="text-sm tabular-nums text-muted line-through">{formatMoney(b.amountMinor, fmt, { signed: true })}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
