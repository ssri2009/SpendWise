import { CalendarCheck, ListChecks } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatDate, formatMoney, type MoneyFormat } from '../../lib/format';
import type { ReconTransaction } from '../../types/reconcile';
import { EmptyState } from '../dashboard/ui';

type Show = 'all' | 'uncleared' | 'cleared';

/**
 * The account's transactions that aren't locked yet. The checkbox is "cleared" (it's on the statement).
 * Ones dated after the statement are listed apart, since they can't be on it.
 */
export function ReconTxList({
  transactions,
  statementDate,
  fmt,
  busy,
  onSet,
}: {
  transactions: ReconTransaction[];
  statementDate: string;
  fmt: MoneyFormat;
  busy: boolean;
  onSet: (ids: number[], cleared: boolean) => void;
}) {
  const [show, setShow] = useState<Show>('all');
  // A tick shows at once (before the shared cache updates), and is dropped once the request has settled.
  const [ticks, setTicks] = useState<Map<number, boolean>>(new Map());
  useEffect(() => {
    if (!busy) setTicks((m) => (m.size ? new Map() : m));
  }, [busy]);
  const isCleared = (t: ReconTransaction) => ticks.get(t.id) ?? t.cleared;
  const set = (ids: number[], cleared: boolean) => {
    setTicks((m) => {
      const n = new Map(m);
      for (const id of ids) n.set(id, cleared);
      return n;
    });
    onSet(ids, cleared);
  };
  const locale = fmt.locale;

  const { onOrBefore, after } = useMemo(() => {
    const keep = (t: ReconTransaction) => show === 'all' || (show === 'cleared') === t.cleared;
    const list = transactions.filter(keep);
    return { onOrBefore: list.filter((t) => !statementDate || t.date <= statementDate), after: list.filter((t) => statementDate && t.date > statementDate) };
  }, [transactions, statementDate, show]);

  const unclearedUpTo = transactions.filter((t) => !t.cleared && (!statementDate || t.date <= statementDate));
  const counts = { all: transactions.length, uncleared: transactions.filter((t) => !t.cleared).length, cleared: transactions.filter((t) => t.cleared).length };

  const row = (t: ReconTransaction) => (
    <li key={t.id}>
      <label className="flex cursor-pointer items-center gap-3 px-1 py-2.5 transition-colors hover:bg-subtle">
        <input
          type="checkbox"
          checked={isCleared(t)}
          onChange={(e) => set([t.id], e.target.checked)}
          aria-label={`${t.payee || 'Transaction'} ${formatMoney(t.amountMinor, fmt, { signed: true })} on ${t.date}: cleared`}
          className="size-4 shrink-0 accent-[var(--sw-accent)]"
        />
        <span className="w-16 shrink-0 text-xs tabular-nums text-muted">{formatDate(t.date, locale, { day: 'numeric', month: 'short' })}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{t.payee || '(no payee)'}</span>
          <span className="block truncate text-xs text-muted">{t.isSplit ? 'Split' : (t.categoryName ?? 'Uncategorized')}</span>
        </span>
        <span className={`text-sm font-semibold tabular-nums ${t.amountMinor > 0 ? 'text-income' : ''}`}>{formatMoney(t.amountMinor, fmt, { signed: true })}</span>
        <span className={`hidden w-20 text-right text-[11px] font-semibold sm:block ${isCleared(t) ? 'text-income' : 'text-muted'}`}>{isCleared(t) ? 'Cleared' : 'Not cleared'}</span>
      </label>
    </li>
  );

  return (
    <section aria-labelledby="sw-recon-tx" className="glass min-w-0 rounded-3xl border border-line p-4 shadow-glass sm:p-6">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 id="sw-recon-tx" className="flex items-center gap-2.5 text-base font-semibold">
          <span className="grid size-8 place-items-center rounded-xl bg-accent/12 text-accent">
            <ListChecks className="size-4" aria-hidden />
          </span>
          Tick what's on the statement
        </h3>
        <div role="group" aria-label="Show" className="flex rounded-xl bg-subtle p-1">
          {(['all', 'uncleared', 'cleared'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={show === s}
              aria-label={`${s === 'all' ? 'All' : s === 'uncleared' ? 'Not cleared' : 'Cleared'} (${counts[s]})`}
              onClick={() => setShow(s)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${show === s ? 'bg-elevated text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'}`}
            >
              {s === 'all' ? 'All' : s === 'uncleared' ? 'Not cleared' : 'Cleared'}
              <span aria-hidden className="tabular-nums text-muted">
                {counts[s]}
              </span>
            </button>
          ))}
        </div>
      </header>

      {unclearedUpTo.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => set(unclearedUpTo.map((t) => t.id), true)}
          className="mb-2 inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-semibold hover:border-accent/50 hover:bg-subtle disabled:opacity-50"
        >
          <CalendarCheck className="size-3.5 text-muted" aria-hidden />
          Mark all {unclearedUpTo.length} up to {statementDate ? formatDate(statementDate, locale) : 'today'} as cleared
        </button>
      )}

      {transactions.length === 0 ? (
        <EmptyState icon={ListChecks} title="Everything here is already reconciled">
          New transactions in this account will show up here.
        </EmptyState>
      ) : onOrBefore.length + after.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing to show with this filter.</p>
      ) : (
        <>
          {onOrBefore.length > 0 && (
            <ul className="divide-y divide-line" aria-label="On or before the statement date">
              {onOrBefore.map(row)}
            </ul>
          )}
          {after.length > 0 && (
            <>
              <h4 className="mt-4 border-b border-line pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                After the statement date ({after.length}): can't be on this statement
              </h4>
              <ul className="divide-y divide-line opacity-70" aria-label="After the statement date">
                {after.map(row)}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
