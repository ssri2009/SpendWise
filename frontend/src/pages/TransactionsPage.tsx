import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeftRight, Download, Keyboard, Loader2, Plus, SearchX, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState, rise, Skeleton, stagger } from '../components/dashboard/ui';
import { BulkBar, SHORTCUTS } from '../components/transactions/BulkBar';
import { ImportDrawer } from '../components/transactions/ImportDrawer';
import { TransactionDrawer } from '../components/transactions/TransactionDrawer';
import { FilterChips, FiltersToggle, SearchBox, TxFilterPanel } from '../components/transactions/TxFilterBar';
import { TxList, type RowHandlers } from '../components/transactions/TxList';
import { Dialog, GhostButton, PrimaryButton } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { useMoneyFormat } from '../hooks/useDashboard';
import {
  afterTransactionWrite,
  useAccountList,
  useBulkTransactions,
  useCategoryTree,
  usePayees,
  useTransactionList,
  useTransactionMonths,
  useUpdateTransaction,
} from '../hooks/useTransactions';
import { ApiError } from '../lib/api';
import { formatMoney, localToday, type MoneyFormat } from '../lib/format';
import { activeFilterCount, EMPTY_FILTERS, filtersToParams, readFilters, type TxFilters } from '../lib/txFilters';
import type { BulkChanges, Transaction, TransactionsResponse } from '../types/api';

type DrawerState = { kind: 'new' } | { kind: 'edit'; tx: Transaction } | { kind: 'import' } | null;

/** True while the user is typing in a field (checkboxes and buttons don't count, so shortcuts still work there). */
const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
  if (t.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((t as HTMLInputElement).type);
};

function SummaryTile({ label, value, hint, tone, fmt }: { label: string; value: number | undefined; hint: string; tone?: 'income' | 'expense'; fmt: MoneyFormat }) {
  const color = tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-expense' : '';
  return (
    <div className="glass rounded-2xl border border-line px-4 py-3.5 shadow-glass" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-2 h-6 w-24" />
      ) : (
        <p className={`mt-1 text-lg font-bold tabular-nums tracking-tight ${color}`}>{formatMoney(value, fmt)}</p>
      )}
      <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>
    </div>
  );
}

export default function TransactionsPage() {
  const fmt = useMoneyFormat();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const qs = filtersToParams(filters).toString();
  // Updates are applied to the URL as it is *now*, not to this render's copy: URL changes render as a
  // transition, so two quick changes in a row would otherwise undo each other.
  const updateFilters = useCallback(
    (update: (f: TxFilters) => TxFilters) =>
      setParams(filtersToParams(update(readFilters(new URLSearchParams(window.location.search)))), { replace: true }),
    [setParams],
  );

  const list = useTransactionList(filters);
  const accountsQ = useAccountList();
  const groupsQ = useCategoryTree();
  const payeesQ = usePayees();
  const monthsQ = useTransactionMonths();
  const bulk = useBulkTransactions();
  const update = useUpdateTransaction();

  const accounts = accountsQ.data?.accounts ?? [];
  const groups = groupsQ.data ?? [];
  const payees = payeesQ.data ?? [];
  const txs = useMemo(() => list.data?.pages.flatMap((p) => p.transactions) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const total = first?.total ?? 0;
  const today = useMemo(localToday, []);

  const [filtersOpen, setFiltersOpen] = useState(() => activeFilterCount({ ...filters, q: '' }) > 0);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [confirmIds, setConfirmIds] = useState<number[] | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activeIndex, setActiveIndexState] = useState(-1);
  // Mirrors activeIndex synchronously, so fast or held-down keys never read a stale highlight.
  const activeRef = useRef(-1);
  const setActiveIndex = useCallback((i: number | ((prev: number) => number)) => {
    const next = typeof i === 'function' ? i(activeRef.current) : i;
    activeRef.current = next;
    setActiveIndexState(next);
  }, []);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [clearingIds, setClearingIds] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // New filters → new list: start the selection and highlight over.
  useEffect(() => {
    setSelected(new Set());
    setActiveIndex(-1);
    anchor.current = null;
  }, [qs]);

  // Load the next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !list.hasNextPage) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !list.isFetchingNextPage) void list.fetchNextPage();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]);

  const defaultAccountId = (filters.account !== null && accounts.some((a) => a.id === filters.account && !a.closed) ? filters.account : null)
    ?? accounts.find((a) => !a.closed)?.id ?? null;

  /* ---------- actions ---------- */

  const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

  const toggleCleared = useCallback(
    (tx: Transaction) => {
      if (tx.reconciled) {
        toast.info('Reconciled transactions stay cleared. Undo the reconciliation to change it.');
        return;
      }
      const cleared = !tx.cleared;
      // Optimistic: flip it in every cached page right away.
      queryClient.setQueriesData<InfiniteData<TransactionsResponse>>({ queryKey: ['transactions', 'list'] }, (data) =>
        data && {
          ...data,
          pages: data.pages.map((p) => ({ ...p, transactions: p.transactions.map((t) => (t.id === tx.id ? { ...t, cleared } : t)) })),
        },
      );
      setClearingIds((s) => new Set(s).add(tx.id));
      update.mutate(
        { id: tx.id, patch: { cleared } },
        {
          onError: (err) => {
            toast.error(errorText(err, 'Could not change cleared status.'));
            afterTransactionWrite(queryClient);
          },
          onSettled: () =>
            setClearingIds((s) => {
              const n = new Set(s);
              n.delete(tx.id);
              return n;
            }),
        },
      );
    },
    [queryClient, toast, update],
  );

  const toggleSelect = useCallback(
    (tx: Transaction, index: number, range: boolean) => {
      // Read the anchor now: the updater below may run later, after the anchor has moved.
      const from = anchor.current;
      const rangeIds = range && from !== null ? txs.slice(Math.min(from, index), Math.max(from, index) + 1).map((t) => t.id) : null;
      setSelected((prev) => {
        const next = new Set(prev);
        if (rangeIds) rangeIds.forEach((id) => next.add(id));
        else if (next.has(tx.id)) next.delete(tx.id);
        else next.add(tx.id);
        return next;
      });
      anchor.current = index;
      setActiveIndex(index);
    },
    [txs, setActiveIndex],
  );

  const handlers = useMemo<RowHandlers>(
    () => ({
      onActivate: setActiveIndex,
      onOpen: (tx) => setDrawer({ kind: 'edit', tx }),
      onToggleSelect: toggleSelect,
      onToggleCleared: toggleCleared,
    }),
    [toggleSelect, toggleCleared, setActiveIndex],
  );

  function runBulk(changes: BulkChanges, label: string) {
    const ids = [...selected];
    bulk.mutate(
      { ids, action: 'update', changes },
      {
        onSuccess: (r) => {
          const skipped = r.skippedSplit ? ` (${r.skippedSplit} split transaction${r.skippedSplit === 1 ? '' : 's'} kept their splits)` : '';
          toast.success(`${label} on ${r.affected} transaction${r.affected === 1 ? '' : 's'}${skipped}.`);
          setSelected(new Set());
        },
        onError: (err) => toast.error(errorText(err, 'Bulk change failed. Nothing was changed.')),
      },
    );
  }

  function runDelete(ids: number[]) {
    bulk.mutate(
      { ids, action: 'delete' },
      {
        onSuccess: (r) => {
          toast.success(`Deleted ${r.affected} transaction${r.affected === 1 ? '' : 's'}.`);
          setSelected(new Set());
          setConfirmIds(null);
          setActiveIndex((i) => Math.min(i, Math.max(0, txs.length - 1 - ids.length)));
        },
        onError: (err) => {
          setConfirmIds(null);
          toast.error(errorText(err, 'Could not delete. Nothing was deleted.'));
        },
      },
    );
  }

  /* ---------- keyboard ---------- */

  const focusRow = useCallback(
    (index: number) => {
      const tx = txs[index];
      if (!tx) return;
      setActiveIndex(index);
      // Focus right away when the row is on screen (no one-frame lag on fast key presses);
      // a row that is still rendering (just loaded) gets focus on the next frame.
      const focus = () => {
        const el = document.getElementById(`tx-row-${tx.id}`);
        if (!el) return false;
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'nearest' });
        return true;
      };
      if (!focus()) requestAnimationFrame(focus);
    },
    [txs, setActiveIndex],
  );

  const keyState = useRef({ txs, activeIndex, selected, drawer, confirmIds, helpOpen, list, focusRow, toggleCleared, toggleSelect });
  keyState.current = { txs, activeIndex, selected, drawer, confirmIds, helpOpen, list, focusRow, toggleCleared, toggleSelect };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = { ...keyState.current, activeIndex: activeRef.current };
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (s.drawer || s.confirmIds || s.helpOpen || document.querySelector('dialog[open]')) return;
      if (isTyping(e.target)) return;
      // Let a focused button or link handle its own Enter / Space.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if ((tag === 'BUTTON' || tag === 'A') && (e.key === 'Enter' || e.key === ' ')) return;
      const tx = s.txs[s.activeIndex];
      const key = e.key;

      const handled = (() => {
        switch (key) {
          case 'j':
          case 'ArrowDown': {
            const next = Math.min(s.activeIndex + 1, s.txs.length - 1);
            s.focusRow(next < 0 ? 0 : next);
            if (s.activeIndex >= s.txs.length - 5 && s.list.hasNextPage && !s.list.isFetchingNextPage) void s.list.fetchNextPage();
            return true;
          }
          case 'k':
          case 'ArrowUp':
            s.focusRow(Math.max(s.activeIndex - 1, 0));
            return true;
          case 'Home':
            s.focusRow(0);
            return true;
          case 'End':
            s.focusRow(s.txs.length - 1);
            return true;
          case 'Enter':
          case 'e':
            if (tx) setDrawer({ kind: 'edit', tx });
            return !!tx;
          case 'x':
          case 'X':
          case ' ':
            if (tx) s.toggleSelect(tx, s.activeIndex, e.shiftKey);
            return !!tx;
          case 'a':
            setSelected((prev) => (prev.size === s.txs.length ? new Set() : new Set(s.txs.map((t) => t.id))));
            return true;
          case 'c':
            if (tx) s.toggleCleared(tx);
            return !!tx;
          case 'Delete':
          case 'Backspace': {
            const ids = s.selected.size ? [...s.selected] : tx ? [tx.id] : [];
            if (ids.length) setConfirmIds(ids);
            return ids.length > 0;
          }
          case 'n':
            setDrawer({ kind: 'new' });
            return true;
          case 'i':
            setDrawer({ kind: 'import' });
            return true;
          case 'f':
            setFiltersOpen((o) => !o);
            return true;
          case '/':
            searchRef.current?.focus();
            return true;
          case '?':
            setHelpOpen(true);
            return true;
          case 'Escape':
            if (s.selected.size) {
              setSelected(new Set());
              return true;
            }
            return false;
          default:
            return false;
        }
      })();
      if (handled) e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- render ---------- */

  const hasFilters = activeFilterCount(filters) > 0;
  const lookupsLoading = accountsQ.isPending || groupsQ.isPending;
  const exportHref = `/api/export/transactions.csv${qs ? `?${qs}` : ''}`;
  const btn = 'inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium transition-colors hover:border-accent/60 hover:bg-subtle';

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-24">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Every account, day by day</p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
            {first ? `${total.toLocaleString(fmt.locale)} transaction${total === 1 ? '' : 's'}` : 'Transactions'}
            {hasFilters && first && <span className="ml-2 text-sm font-medium text-muted">matching your filters</span>}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts (?)">
            <Keyboard className="size-4 text-muted" aria-hidden />
          </button>
          <a className={btn} href={exportHref} download>
            <Download className="size-4 text-muted" aria-hidden />
            <span className="hidden sm:inline">Export</span>
          </a>
          <button type="button" className={btn} onClick={() => setDrawer({ kind: 'import' })} disabled={lookupsLoading}>
            <Upload className="size-4 text-muted" aria-hidden />
            <span className="hidden sm:inline">Import CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setDrawer({ kind: 'new' })}
            disabled={lookupsLoading}
            className="inline-flex h-11 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            <Plus className="size-4" aria-hidden /> Add
            <kbd className="hidden rounded bg-white/20 px-1.5 text-[10px] sm:inline">N</kbd>
          </button>
        </div>
      </motion.div>

      <motion.div variants={rise} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Total funds" value={first?.summary.totalFundsMinor} hint="All accounts right now (ignores filters)" fmt={fmt} />
        <SummaryTile label="Net this period" value={first?.summary.netMinor} hint="Income − expenses, filtered" tone={first && first.summary.netMinor < 0 ? 'expense' : 'income'} fmt={fmt} />
        <SummaryTile label="Income" value={first?.summary.incomeMinor} hint="Filtered" tone="income" fmt={fmt} />
        <SummaryTile label="Expenses" value={first?.summary.expenseMinor} hint="Filtered" fmt={fmt} />
      </motion.div>

      <motion.section variants={rise} className="glass rounded-3xl border border-line p-3 shadow-glass sm:p-5">
        <div className="flex gap-2">
          <SearchBox ref={searchRef} value={filters.q} onChange={(q) => updateFilters((f) => ({ ...f, q }))} />
          <FiltersToggle open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} filters={filters} />
        </div>
        <TxFilterPanel
          open={filtersOpen}
          filters={filters}
          onChange={updateFilters}
          accounts={accounts}
          groups={groups}
          payees={payees}
          months={monthsQ.data ?? []}
          fmt={fmt}
        />
        <FilterChips filters={filters} onChange={updateFilters} accounts={accounts} groups={groups} payees={payees} fmt={fmt} />

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line px-1 pt-3 text-xs text-muted">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={txs.length > 0 && selected.size === txs.length}
              ref={(el) => {
                if (el) el.indeterminate = selected.size > 0 && selected.size < txs.length;
              }}
              onChange={(e) => setSelected(e.target.checked ? new Set(txs.map((t) => t.id)) : new Set())}
              disabled={!txs.length}
              className="size-4 accent-[var(--sw-accent)]"
            />
            Select all loaded
          </label>
          <span aria-live="polite">
            {list.isFetching && !list.isFetchingNextPage ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Updating…
              </span>
            ) : first ? (
              `Showing ${txs.length.toLocaleString(fmt.locale)} of ${total.toLocaleString(fmt.locale)}`
            ) : null}
          </span>
        </div>

        <div className={`mt-2 ${list.isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
          {list.isPending ? (
            <div className="space-y-2 py-2" aria-busy="true" aria-label="Loading transactions">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-14 rounded-2xl" />
              ))}
            </div>
          ) : list.isError && !txs.length ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : txs.length === 0 ? (
            hasFilters ? (
              <EmptyState icon={SearchX} title="Nothing matches these filters">
                <button type="button" onClick={() => updateFilters(() => EMPTY_FILTERS)} className="font-semibold text-accent hover:underline">
                  Clear all filters
                </button>
              </EmptyState>
            ) : (
              <EmptyState icon={ArrowLeftRight} title="No transactions yet">
                Press <kbd className="rounded border border-line px-1">N</kbd> to add one, or{' '}
                <button type="button" onClick={() => setDrawer({ kind: 'import' })} className="font-semibold text-accent hover:underline">
                  import a CSV
                </button>{' '}
                from your bank.
              </EmptyState>
            )
          ) : (
            <TxList
              transactions={txs}
              activeIndex={activeIndex}
              selected={selected}
              clearingIds={clearingIds}
              fmt={fmt}
              today={today}
              handlers={handlers}
            />
          )}
          <div ref={sentinel} />
          {list.hasNextPage && (
            <div className="flex justify-center pt-4">
              <button
                type="button"
                onClick={() => list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-medium hover:bg-subtle disabled:opacity-60"
              >
                {list.isFetchingNextPage && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {list.isFetchingNextPage ? 'Loading…' : `Load more (${(total - txs.length).toLocaleString(fmt.locale)} left)`}
              </button>
            </div>
          )}
        </div>
      </motion.section>

      <BulkBar
        count={selected.size}
        accounts={accounts}
        groups={groups}
        busy={bulk.isPending}
        onUpdate={runBulk}
        onDelete={() => setConfirmIds([...selected])}
        onClear={() => setSelected(new Set())}
      />

      {drawer?.kind === 'new' || drawer?.kind === 'edit' ? (
        <TransactionDrawer
          key={drawer.kind === 'edit' ? drawer.tx.id : 'new'}
          transaction={drawer.kind === 'edit' ? drawer.tx : null}
          accounts={accounts}
          groups={groups}
          payees={payees}
          defaultAccountId={defaultAccountId}
          fmt={fmt}
          onClose={() => setDrawer(null)}
          onSaved={(msg, detail) => {
            toast.success(msg);
            if (detail) toast.info(detail);
          }}
          onDeleted={toast.success}
        />
      ) : null}

      {drawer?.kind === 'import' && (
        <ImportDrawer accounts={accounts} defaultAccountId={defaultAccountId} fmt={fmt} onClose={() => setDrawer(null)} onImported={toast.success} />
      )}

      {confirmIds && (
        <Dialog
          title={`Delete ${confirmIds.length} transaction${confirmIds.length === 1 ? '' : 's'}?`}
          description="This cannot be undone. Splits are deleted with them. Reconciled transactions are refused."
          onClose={() => setConfirmIds(null)}
          onSubmit={() => runDelete(confirmIds)}
          footer={
            <>
              <GhostButton onClick={() => setConfirmIds(null)} disabled={bulk.isPending}>
                Cancel
              </GhostButton>
              <PrimaryButton tone="danger" pending={bulk.isPending}>
                {bulk.isPending ? 'Deleting…' : 'Delete'}
              </PrimaryButton>
            </>
          }
        >
          <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
            {confirmIds.slice(0, 8).map((id) => {
              const t = txs.find((x) => x.id === id);
              return t ? (
                <li key={id} className="flex justify-between gap-3">
                  <span className="truncate">
                    {t.date} · {t.payee || 'No payee'}
                  </span>
                  <span className="tabular-nums">{formatMoney(t.amountMinor, fmt, { signed: true })}</span>
                </li>
              ) : null;
            })}
            {confirmIds.length > 8 && <li className="text-muted">…and {confirmIds.length - 8} more</li>}
          </ul>
        </Dialog>
      )}

      {helpOpen && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelpOpen(false)} footer={<GhostButton onClick={() => setHelpOpen(false)}>Close</GhostButton>}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {SHORTCUTS.map(([k, label]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="rounded-md border border-line bg-subtle px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
                </dt>
                <dd className="text-muted">{label}</dd>
              </div>
            ))}
          </dl>
        </Dialog>
      )}
    </motion.div>
  );
}
