import { motion } from 'framer-motion';
import { Archive, Combine, Copy, Plus, Search, SearchX, Users, X } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState, Panel, rise, Skeleton, stagger } from '../components/dashboard/ui';
import { MergeDialog, NewPayeeDialog } from '../components/payees/PayeeDialogs';
import { PayeeRow } from '../components/payees/PayeeRow';
import { CONTROL } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { useMoneyFormat } from '../hooks/useDashboard';
import { findDuplicates, useUpdatePayee } from '../hooks/usePayeeAdmin';
import { useCategoryTree, usePayees } from '../hooks/useTransactions';
import { ApiError } from '../lib/api';
import { localToday } from '../lib/format';
import type { Payee } from '../types/api';

type Tab = 'active' | 'archived' | 'all';
type Sort = 'usage' | 'name' | 'last';
const TABS: { id: Tab; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'archived', label: 'Archived' },
  { id: 'all', label: 'All' },
];
const SORTS: { id: Sort; label: string }[] = [
  { id: 'usage', label: 'Most used' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'last', label: 'Recently used' },
];
const PAGE = 100;

const isTyping = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
  if (t.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((t as HTMLInputElement).type);
};

function Tile({ label, value, hint }: { label: string; value: string | undefined; hint: string }) {
  return (
    <div className="glass rounded-2xl border border-line px-4 py-3.5 shadow-glass" title={hint}>
      <p className="text-xs text-muted">{label}</p>
      {value === undefined ? <Skeleton className="mt-2 h-6 w-16" /> : <p className="mt-1 text-lg font-bold tabular-nums tracking-tight">{value}</p>}
      <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>
    </div>
  );
}

const SearchBox = forwardRef<HTMLInputElement, { value: string; onChange: (q: string) => void }>(function SearchBox({ value, onChange }, ref) {
  const [text, setText] = useState(value);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === latest.current.value) return;
    const t = window.setTimeout(() => latest.current.onChange(text), 150);
    return () => window.clearTimeout(t);
  }, [text]);
  return (
    <div className="relative w-full min-w-0 sm:w-auto sm:max-w-xs sm:flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={ref}
        type="search"
        aria-label="Search payees"
        placeholder="Search payees  /"
        maxLength={60}
        className={`${CONTROL} h-10 pl-9`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text) {
            e.preventDefault();
            setText('');
            onChange('');
          }
        }}
      />
    </div>
  );
});

/**
 * Payees (server/routes/payees.js): who you pay and who pays you. Rename, set a default category,
 * merge duplicates, archive or delete. URL: ?status=archived|all, ?q=, ?sort=name|last.
 */
export default function PayeesPage() {
  const fmt = useMoneyFormat();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const payeesQ = usePayees();
  const groupsQ = useCategoryTree();
  const update = useUpdatePayee();

  const tab: Tab = (['archived', 'all'] as const).find((t) => t === params.get('status')) ?? 'active';
  const sort: Sort = (['name', 'last'] as const).find((s) => s === params.get('sort')) ?? 'usage';
  const q = params.get('q') ?? '';

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState<{ sources: Payee[]; target?: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => payeesQ.data ?? [], [payeesQ.data]);
  const groups = groupsQ.data ?? [];
  const today = localToday();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(window.location.search);
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [setParams],
  );

  const counts = useMemo(() => {
    const active = all.filter((p) => !p.archived);
    return {
      active: active.length,
      archived: all.length - active.length,
      all: all.length,
      noDefault: active.filter((p) => p.defaultCategoryId === null && p.usageCount > 0).length,
      unused: active.filter((p) => p.usageCount === 0).length,
    };
  }, [all]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = all.filter((p) => (tab === 'all' || (tab === 'archived') === p.archived) && (!needle || p.name.toLowerCase().includes(needle)));
    const byName = (a: Payee, b: Payee) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (sort === 'name') rows.sort(byName);
    else if (sort === 'last') rows.sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '') || byName(a, b));
    else rows.sort((a, b) => b.usageCount - a.usageCount || byName(a, b));
    return rows;
  }, [all, tab, q, sort]);

  const dupes = useMemo(
    () => findDuplicates(all.filter((p) => !p.archived)).filter((g) => !dismissed.has(g.map((p) => p.id).join(','))),
    [all, dismissed],
  );

  // Selection only keeps payees that still exist (after merges / deletes).
  useEffect(() => {
    setSelected((s) => {
      const ids = new Set(all.map((p) => p.id));
      const next = new Set([...s].filter((id) => ids.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [all]);
  useEffect(() => setShown(PAGE), [tab, q, sort]);

  const message = useCallback((tone: 'success' | 'error', text: string) => (tone === 'success' ? toast.success(text) : toast.error(text)), [toast]);
  const toggle = useCallback((id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);

  const chosen = all.filter((p) => selected.has(p.id));
  const visible = list.slice(0, shown);
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  async function archiveSelected(archived: boolean) {
    let done = 0;
    for (const p of chosen) {
      if (p.archived === archived) continue;
      try {
        await update.mutateAsync({ id: p.id, patch: { archived } });
        done += 1;
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'That did not work.');
        break;
      }
    }
    if (done) toast.success(`${archived ? 'Archived' : 'Unarchived'} ${done} payee${done === 1 ? '' : 's'}.`);
    setSelected(new Set());
  }

  // Keyboard: N = new payee, / = search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setAdding(true);
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-28">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Who you pay, and who pays you</p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
            {payeesQ.data ? `${counts.active.toLocaleString(fmt.locale)} payee${counts.active === 1 ? '' : 's'}` : 'Payees'}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={groupsQ.isPending}
          className="inline-flex h-11 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          <Plus className="size-4" aria-hidden /> New payee
          <kbd className="hidden rounded bg-white/20 px-1.5 text-[10px] sm:inline">N</kbd>
        </button>
      </motion.div>

      <motion.div variants={rise} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Active" value={payeesQ.data ? String(counts.active) : undefined} hint="Offered in pickers" />
        <Tile label="Archived" value={payeesQ.data ? String(counts.archived) : undefined} hint="Hidden, kept on old transactions" />
        <Tile label="No default category" value={payeesQ.data ? String(counts.noDefault) : undefined} hint="Used, but you pick the category each time" />
        <Tile label="Never used" value={payeesQ.data ? String(counts.unused) : undefined} hint="No transactions yet" />
      </motion.div>

      {dupes.length > 0 && tab !== 'archived' && (
        <Panel title={`Possible duplicates (${dupes.length})`} icon={Copy}>
          <p className="-mt-2 mb-2 text-sm text-muted">These names look like the same payee. Merging puts all their transactions under one name.</p>
          <ul className="divide-y divide-line">
            {dupes.slice(0, 5).map((g) => {
              const key = g.map((p) => p.id).join(',');
              return (
                <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                  <span className="min-w-0 flex-1 text-sm">
                    {g.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && <span className="text-muted"> · </span>}
                        <b className="font-semibold">{p.name}</b> <span className="text-xs text-muted">({p.usageCount})</span>
                      </span>
                    ))}
                  </span>
                  <span className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMerging({ sources: g.slice(1), target: g[0].id })}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold hover:border-accent/50 hover:bg-subtle"
                    >
                      <Combine className="size-3.5" aria-hidden /> Merge into {g[0].name}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDismissed((d) => new Set(d).add(key))}
                      aria-label={`Not duplicates: ${g.map((p) => p.name).join(', ')}`}
                      title="They're different: hide this"
                      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {dupes.length > 5 && <p className="mt-1 text-xs text-muted">And {dupes.length - 5} more. Merge these first and the rest move up.</p>}
        </Panel>
      )}

      <motion.section variants={rise} aria-label="Payees" className="glass rounded-3xl border border-line p-3 shadow-glass sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="flex rounded-xl bg-subtle p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                aria-label={payeesQ.data ? `${t.label} (${counts[t.id]})` : t.label}
                onClick={() => setParam('status', t.id === 'active' ? null : t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === t.id ? 'bg-elevated text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'
                }`}
              >
                {t.label}
                {payeesQ.data && (
                  <span aria-hidden className="tabular-nums text-muted">
                    {counts[t.id]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <SearchBox ref={searchRef} value={q} onChange={(text) => setParam('q', text)} />
          <select
            aria-label="Sort"
            value={sort}
            onChange={(e) => setParam('sort', e.target.value === 'usage' ? null : e.target.value)}
            className={`${CONTROL.replace('w-full', '')} h-10 w-auto`}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id} className="bg-elevated text-fg">
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 hidden grid-cols-[auto_minmax(0,1fr)_14rem_8rem_auto] items-center gap-x-3 border-b border-line pb-2 text-xs text-muted md:grid">
          <input
            type="checkbox"
            aria-label="Select all shown"
            checked={allVisibleSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allVisibleSelected && visible.some((p) => selected.has(p.id));
            }}
            onChange={(e) => setSelected(e.target.checked ? new Set([...selected, ...visible.map((p) => p.id)]) : new Set([...selected].filter((id) => !visible.some((p) => p.id === id))))}
            disabled={!visible.length}
            className="size-4 accent-[var(--sw-accent)]"
          />
          <span>Name</span>
          <span>Default category</span>
          <span>Used</span>
          <span className="w-28" />
        </div>

        {payeesQ.isPending ? (
          <div className="space-y-3 py-3" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : payeesQ.isError ? (
          <ErrorState error={payeesQ.error} onRetry={() => void payeesQ.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState icon={Users} title="No payees yet">
            Payees are added when you enter a transaction, import a CSV or create a schedule. You can also add one now.
          </EmptyState>
        ) : list.length === 0 ? (
          <EmptyState icon={SearchX} title={q ? `No payee matches "${q}"` : tab === 'archived' ? 'Nothing archived' : 'Nothing here'}>
            {q && (
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => setParam('q', null)}>
                Clear search
              </button>
            )}
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-line" aria-label="Payee list">
              {visible.map((p) => (
                <PayeeRow
                  key={p.id}
                  p={p}
                  groups={groups}
                  today={today}
                  locale={fmt.locale}
                  selected={selected.has(p.id)}
                  onToggle={toggle}
                  onMerge={(x) => setMerging({ sources: [x] })}
                  onMessage={message}
                />
              ))}
            </ul>
            {list.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-3 text-sm font-semibold text-accent hover:underline">
                Show more ({list.length - shown} left)
              </button>
            )}
          </>
        )}
      </motion.section>

      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4" role="region" aria-label="Selected payees">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-elevated px-4 py-2.5 shadow-glass">
            <span className="text-sm font-semibold">{chosen.length} selected</span>
            <button
              type="button"
              onClick={() => setMerging({ sources: chosen, target: undefined })}
              disabled={chosen.length < 1}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl accent-gradient px-3 text-sm font-semibold text-accent-fg"
            >
              <Combine className="size-4" aria-hidden /> Merge…
            </button>
            {chosen.some((p) => !p.archived) ? (
              <button type="button" onClick={() => void archiveSelected(true)} disabled={update.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium hover:bg-subtle">
                <Archive className="size-4" aria-hidden /> Archive
              </button>
            ) : (
              <button type="button" onClick={() => void archiveSelected(false)} disabled={update.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium hover:bg-subtle">
                <Archive className="size-4" aria-hidden /> Unarchive
              </button>
            )}
            <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection" className="grid size-9 place-items-center rounded-xl text-muted hover:bg-subtle hover:text-fg">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      {adding && <NewPayeeDialog groups={groups} onClose={() => setAdding(false)} onCreated={(p) => toast.success(`Added "${p.name}".`)} />}
      {merging && (
        <MergeDialog
          sources={merging.sources}
          payees={all}
          suggestedTarget={merging.target}
          onClose={() => setMerging(null)}
          onMerged={(text) => {
            toast.success(text);
            setSelected(new Set());
          }}
        />
      )}
    </motion.div>
  );
}
