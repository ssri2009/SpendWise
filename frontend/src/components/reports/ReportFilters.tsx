import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, RotateCcw, Search, Tags } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDate, type MoneyFormat } from '../../lib/format';
import { DEFAULT_REPORT_FILTERS, excludeFor, MAX_EXCLUDE, RANGE_OPTIONS, type ReportFilters } from '../../lib/reportFilters';
import type { Account, CategoryGroupNode } from '../../types/api';
import type { Granularity, ReportPeriod, ReportRange } from '../../types/reports';
import { Segmented } from '../dashboard/ui';
import { CONTROL } from '../ui/Dialog';
import { AccountSelect } from '../transactions/pickers';

const SMALL = `${CONTROL} h-10`;
const GRANS = [
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
] as const satisfies readonly { id: Granularity; label: string }[];

/** "Only these categories" picker. Sent to the API as `exclude=` (everything not picked). */
function CategoryPicker({
  groups,
  value,
  onChange,
}: {
  groups: CategoryGroupNode[];
  value: ReportFilters['cats'];
  onChange: (cats: ReportFilters['cats']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const all = useMemo(() => groups.flatMap((g) => g.categories.map((c) => ({ ...c, group: g.name, isIncome: g.isIncome }))), [groups]);
  const names = new Map(all.map((c) => [c.id, `${c.icon} ${c.name}`]));
  const label = !value.length
    ? 'All categories'
    : value.length === 1
      ? value[0] === 'none'
        ? 'Uncategorized'
        : (names.get(value[0] as number) ?? '1 category')
      : `${value.length} categories`;

  const toggle = (id: number | 'none') => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  const needle = q.trim().toLowerCase();
  const tooMany = excludeFor(draft, groups).length > MAX_EXCLUDE;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`${SMALL} flex min-w-44 items-center justify-between gap-2 text-left ${value.length ? 'border-accent/50 bg-accent/10' : ''}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Tags className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label="Pick categories"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-elevated p-3 shadow-glass"
          >
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Find a category"
                aria-label="Find a category"
                className={`${CONTROL} h-9 pl-9 text-sm`}
              />
            </div>
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {!needle && (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle">
                  <input type="checkbox" checked={draft.includes('none')} onChange={() => toggle('none')} className="size-4 accent-[var(--sw-accent)]" />
                  Uncategorized
                </label>
              )}
              {groups.map((g) => {
                const cats = g.categories.filter((c) => !needle || c.name.toLowerCase().includes(needle));
                if (!cats.length) return null;
                return (
                  <div key={g.id}>
                    <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">
                      {g.name}
                      {g.isIncome ? ' · income' : ''}
                    </p>
                    {cats.map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle">
                        <input type="checkbox" checked={draft.includes(c.id)} onChange={() => toggle(c.id)} className="size-4 accent-[var(--sw-accent)]" />
                        <span aria-hidden>{c.icon}</span>
                        {c.name}
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-[11px] text-muted">
              Only the picked categories count in every report. Pick an income category too if you want income in the results.
            </p>
            {tooMany && <p className="mt-1 px-1 text-[11px] text-expense">Too many categories left out (limit {MAX_EXCLUDE}). Pick more, or none.</p>}
            <div className="mt-3 flex justify-between gap-2">
              <button type="button" onClick={() => setDraft([])} className="h-9 rounded-lg px-3 text-xs font-semibold text-muted hover:bg-subtle hover:text-fg">
                Clear
              </button>
              <button
                type="button"
                disabled={tooMany}
                onClick={() => {
                  onChange(draft);
                  setOpen(false);
                }}
                className="h-9 rounded-lg accent-gradient px-4 text-xs font-semibold text-accent-fg disabled:opacity-50"
              >
                {draft.length ? `Show ${draft.length === 1 ? 'this category' : `these ${draft.length}`}` : 'Show all categories'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** One row of filters above every report. */
export function ReportFilterBar({
  filters,
  onChange,
  accounts,
  groups,
  period,
  fmt,
  extra,
}: {
  filters: ReportFilters;
  onChange: (update: (f: ReportFilters) => ReportFilters) => void;
  accounts: Account[];
  groups: CategoryGroupNode[];
  /** The resolved period from the last response, shown as plain dates. */
  period?: ReportPeriod;
  fmt: MoneyFormat;
  extra?: ReactNode;
}) {
  const ids = { range: useId(), from: useId(), to: useId(), acct: useId() };
  const set = (patch: Partial<ReportFilters>) => onChange((f) => ({ ...f, ...patch }));
  const isDefault =
    filters.range === DEFAULT_REPORT_FILTERS.range && filters.granularity === 'month' && filters.account === null && !filters.cats.length;
  const d = (iso: string) => formatDate(iso, fmt.locale, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="glass rounded-3xl border border-line p-3 shadow-glass sm:p-4">
      <div className="flex flex-wrap items-end gap-2.5">
        <div>
          <label htmlFor={ids.range} className="mb-1 block text-xs font-medium text-muted">
            Period
          </label>
          <select
            id={ids.range}
            className={`${SMALL} min-w-40`}
            value={filters.range}
            onChange={(e) => {
              const range = e.target.value as ReportRange;
              set(range === 'custom' ? { range, from: filters.from ?? period?.from ?? null, to: filters.to ?? period?.to ?? null } : { range, from: null, to: null });
            }}
          >
            {RANGE_OPTIONS.map((r) => (
              <option key={r.id} value={r.id} className="bg-elevated">
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {filters.range === 'custom' && (
          <>
            <div>
              <label htmlFor={ids.from} className="mb-1 block text-xs font-medium text-muted">
                From
              </label>
              <input id={ids.from} type="date" className={SMALL} value={filters.from ?? ''} max={filters.to ?? undefined} onChange={(e) => set({ from: e.target.value || null })} />
            </div>
            <div>
              <label htmlFor={ids.to} className="mb-1 block text-xs font-medium text-muted">
                To
              </label>
              <input id={ids.to} type="date" className={SMALL} value={filters.to ?? ''} min={filters.from ?? undefined} onChange={(e) => set({ to: e.target.value || null })} />
            </div>
          </>
        )}
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Group by</span>
          <Segmented options={GRANS} value={filters.granularity} onChange={(granularity) => set({ granularity })} label="Group by" layoutId="report-gran" />
        </div>
        <div>
          <label htmlFor={ids.acct} className="mb-1 block text-xs font-medium text-muted">
            Account
          </label>
          <AccountSelect id={ids.acct} accounts={accounts} value={filters.account} onChange={(account) => set({ account })} includeClosed allLabel="All accounts" className={`${SMALL} min-w-40`} />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Categories</span>
          <CategoryPicker groups={groups} value={filters.cats} onChange={(cats) => set({ cats })} />
        </div>
        <div className="ml-auto flex items-end gap-2">
          {!isDefault && (
            <button
              type="button"
              onClick={() => onChange(() => DEFAULT_REPORT_FILTERS)}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted hover:bg-subtle hover:text-fg"
            >
              <RotateCcw className="size-4" aria-hidden /> Reset
            </button>
          )}
          {extra}
        </div>
      </div>
      {period && (
        <p className="mt-2.5 px-1 text-xs text-muted" aria-live="polite">
          {d(period.from)} – {d(period.to)}
        </p>
      )}
    </div>
  );
}
