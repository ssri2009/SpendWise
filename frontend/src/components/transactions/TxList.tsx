import { CheckCircle2, Circle, Lock, Split } from 'lucide-react';
import { memo, type MouseEvent } from 'react';
import { formatMoney, relativeDay, type MoneyFormat } from '../../lib/format';
import type { Transaction } from '../../types/api';

export interface RowHandlers {
  onActivate: (index: number) => void;
  onOpen: (tx: Transaction) => void;
  onToggleSelect: (tx: Transaction, index: number, range: boolean) => void;
  onToggleCleared: (tx: Transaction) => void;
}

const stop = (e: MouseEvent) => e.stopPropagation();

const TxRow = memo(function TxRow({
  tx,
  index,
  active,
  selected,
  fmt,
  handlers,
  clearing,
}: {
  tx: Transaction;
  index: number;
  active: boolean;
  selected: boolean;
  fmt: MoneyFormat;
  handlers: RowHandlers;
  clearing: boolean;
}) {
  const income = tx.amountMinor > 0;
  const category = tx.isSplit ? null : tx.categoryName;
  const icon = tx.isSplit ? null : tx.categoryIcon;
  const splitNames = tx.isSplit ? tx.splits.map((s) => s.categoryName ?? 'Uncategorized').join(' · ') : '';

  return (
    <li
      id={`tx-row-${tx.id}`}
      data-index={index}
      tabIndex={active ? 0 : -1}
      aria-selected={selected}
      aria-label={`${tx.payee || 'No payee'}, ${formatMoney(tx.amountMinor, fmt, { signed: true })}, ${tx.date}${tx.cleared ? ', cleared' : ''}`}
      onClick={() => handlers.onOpen(tx)}
      onFocus={() => handlers.onActivate(index)}
      className={`group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-2.5 py-2.5 outline-none transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-3 ${
        selected ? 'bg-accent/12' : active ? 'bg-subtle' : 'hover:bg-subtle/70'
      } ${active ? 'ring-2 ring-accent/50' : ''}`}
    >
      <div className="flex items-center gap-2.5" onClick={stop}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${tx.payee || 'transaction'}`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            handlers.onToggleSelect(tx, index, e.shiftKey);
          }}
          onChange={() => {}}
          className="size-4 shrink-0 accent-[var(--sw-accent)]"
        />
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-subtle text-base" aria-hidden>
          {tx.isSplit ? <Split className="size-4 text-accent" /> : icon || (income ? '💰' : '🧾')}
        </span>
      </div>

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          <span className="truncate">{tx.payee || <span className="text-muted">No payee</span>}</span>
          {tx.reconciled && <Lock className="size-3 shrink-0 text-muted" aria-label="Reconciled" />}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {tx.isSplit ? (
            <span className="truncate font-medium text-accent" title={splitNames}>
              Split · {tx.splits.length} parts
            </span>
          ) : category ? (
            <span className="truncate">{category}</span>
          ) : (
            <span className="font-medium text-warning">Uncategorized</span>
          )}
          <span aria-hidden>·</span>
          <span className="truncate">{tx.accountName}</span>
          {tx.notes && (
            <>
              <span aria-hidden className="hidden sm:inline">·</span>
              <span className="hidden max-w-[18rem] truncate italic sm:inline">{tx.notes}</span>
            </>
          )}
        </p>
      </div>

      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          handlers.onToggleCleared(tx);
        }}
        disabled={tx.reconciled || clearing}
        aria-pressed={tx.cleared}
        aria-label={tx.cleared ? 'Cleared. Mark as not cleared' : 'Not cleared. Mark as cleared'}
        title={tx.reconciled ? 'Reconciled (locked)' : tx.cleared ? 'Cleared (c to toggle)' : 'Not cleared (c to toggle)'}
        className={`hidden size-8 place-items-center rounded-lg transition-colors hover:bg-subtle disabled:cursor-default disabled:hover:bg-transparent sm:grid ${
          tx.cleared ? 'text-income' : 'text-muted/60'
        } ${clearing ? 'animate-pulse' : ''}`}
      >
        {tx.cleared ? <CheckCircle2 className="size-4" aria-hidden /> : <Circle className="size-4" aria-hidden />}
      </button>

      <p className={`text-right text-sm font-semibold tabular-nums ${income ? 'text-income' : ''}`}>{formatMoney(tx.amountMinor, fmt, { signed: true })}</p>
    </li>
  );
});

/** Transactions grouped by day (newest first, as the API returns them). */
export function TxList({
  transactions,
  activeIndex,
  selected,
  clearingIds,
  fmt,
  today,
  handlers,
}: {
  transactions: Transaction[];
  activeIndex: number;
  selected: Set<number>;
  clearingIds: Set<number>;
  fmt: MoneyFormat;
  today: string;
  handlers: RowHandlers;
}) {
  const days: { date: string; items: { tx: Transaction; index: number }[]; net: number }[] = [];
  transactions.forEach((tx, index) => {
    const last = days[days.length - 1];
    if (last && last.date === tx.date) {
      last.items.push({ tx, index });
      last.net += tx.amountMinor;
    } else days.push({ date: tx.date, items: [{ tx, index }], net: tx.amountMinor });
  });

  return (
    <div className="space-y-4" aria-label="Transactions" role="region">
      {days.map((d) => (
        <section key={d.date} aria-label={relativeDay(d.date, today, fmt.locale)}>
          <header className="sticky top-16 z-[5] -mx-1 mb-1 flex items-center justify-between rounded-lg bg-bg/80 px-3 py-1.5 text-xs backdrop-blur">
            <h3 className="font-semibold text-muted">
              {relativeDay(d.date, today, fmt.locale)}
              <span className="ml-2 font-normal">{d.date}</span>
            </h3>
            <span className={`font-semibold tabular-nums ${d.net > 0 ? 'text-income' : 'text-muted'}`}>{formatMoney(d.net, fmt, { signed: true })}</span>
          </header>
          <ul className="space-y-0.5">
            {d.items.map(({ tx, index }) => (
              <TxRow
                key={tx.id}
                tx={tx}
                index={index}
                active={index === activeIndex}
                selected={selected.has(tx.id)}
                clearing={clearingIds.has(tx.id)}
                fmt={fmt}
                handlers={handlers}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
