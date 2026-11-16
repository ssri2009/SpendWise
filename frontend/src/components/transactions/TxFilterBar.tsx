import { AnimatePresence, motion } from 'framer-motion';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatDate, formatMoney, monthName, type MoneyFormat } from '../../lib/format';
import { parseMoney, toInputValue } from '../../lib/money';
import { activeFilterCount, applyPreset, DATE_PRESETS, EMPTY_FILTERS, presetOf, type DatePreset, type TxFilters } from '../../lib/txFilters';
import type { Account, CategoryGroupNode, Payee } from '../../types/api';
import { CONTROL } from '../ui/Dialog';
import { AccountSelect } from './pickers';

const SMALL = `${CONTROL} h-10`;

/** Search box that writes to the filters 300 ms after typing stops. "/" focuses it (see the page). */
export const SearchBox = forwardRef<HTMLInputElement, { value: string; onChange: (q: string) => void }>(function SearchBox(
  { value, onChange },
  ref,
) {
  const [text, setText] = useState(value);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === latest.current.value) return;
    const t = window.setTimeout(() => latest.current.onChange(text), 300);
    return () => window.clearTimeout(t);
  }, [text]);

  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={ref}
        type="search"
        aria-label="Search transactions"
        placeholder="Search payee, category or notes…"
        maxLength={80}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange(text);
          if (e.key === 'Escape') {
            if (text) {
              e.stopPropagation();
              setText('');
              onChange('');
            } else (e.target as HTMLInputElement).blur();
          }
        }}
        className={`${CONTROL} pl-10 pr-12`}
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line px-1.5 text-[10px] font-semibold text-muted sm:block">
        /
      </kbd>
    </div>
  );
});

function AmountInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : toInputValue(value));
  useEffect(() => setText(value === null ? '' : toInputValue(value)), [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) return onChange(null);
    const m = parseMoney(t);
    if (m === null) setText(value === null ? '' : toInputValue(value));
    else onChange(m);
  };
  return (
    <input
      aria-label={label}
      placeholder={label}
      inputMode="decimal"
      className={`${SMALL} text-right tabular-nums`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

export function TxFilterPanel({
  filters,
  onChange,
  open,
  accounts,
  groups,
  payees,
  months,
  fmt,
}: {
  filters: TxFilters;
  /** Receives an updater: it is applied to the filters as they are in the URL at that moment. */
  onChange: (update: (f: TxFilters) => TxFilters) => void;
  open: boolean;
  accounts: Account[];
  groups: CategoryGroupNode[];
  payees: Payee[];
  months: string[];
  fmt: MoneyFormat;
}) {
  const preset = presetOf(filters);
  const ids = { preset: useId(), month: useId(), from: useId(), to: useId(), acct: useId(), cat: useId(), payee: useId(), cleared: useId(), type: useId() };
  const set = (patch: Partial<TxFilters>) => onChange((f) => ({ ...f, ...patch }));
  const payeeList = [...payees].sort((a, b) => a.name.localeCompare(b.name));
  const monthList = filters.month && !months.includes(filters.month) ? [filters.month, ...months] : months;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          id="tx-filters"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <Labeled id={ids.preset} label="Date">
              <select id={ids.preset} className={SMALL} value={preset} onChange={(e) => {
                const preset = e.target.value as DatePreset;
                onChange((f) => applyPreset(f, preset));
              }}>
                {DATE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id} className="bg-elevated">
                    {p.label}
                  </option>
                ))}
              </select>
            </Labeled>
            {(preset === 'month' || preset === 'this-month' || preset === 'last-month') && filters.month && (
              <Labeled id={ids.month} label="Month">
                <select id={ids.month} className={SMALL} value={filters.month} onChange={(e) => set({ month: e.target.value })}>
                  {(monthList.length ? monthList : [filters.month]).map((m) => (
                    <option key={m} value={m} className="bg-elevated">
                      {monthName(m, fmt.locale)}
                    </option>
                  ))}
                </select>
              </Labeled>
            )}
            {(preset === 'custom' || preset === 'last-30' || preset === 'last-90' || preset === 'this-year') && (
              <div className="grid grid-cols-2 gap-2 sm:col-span-1">
                <Labeled id={ids.from} label="From">
                  <input id={ids.from} type="date" className={SMALL} value={filters.from ?? ''} max={filters.to ?? undefined} onChange={(e) => set({ month: null, from: e.target.value || null })} />
                </Labeled>
                <Labeled id={ids.to} label="To">
                  <input id={ids.to} type="date" className={SMALL} value={filters.to ?? ''} min={filters.from ?? undefined} onChange={(e) => set({ month: null, to: e.target.value || null })} />
                </Labeled>
              </div>
            )}
            <Labeled id={ids.acct} label="Account">
              <AccountSelect id={ids.acct} accounts={accounts} value={filters.account} onChange={(account) => set({ account })} includeClosed allLabel="All accounts" className={SMALL} />
            </Labeled>
            <Labeled id={ids.cat} label="Category">
              <select
                id={ids.cat}
                className={SMALL}
                value={filters.category ?? ''}
                onChange={(e) => set({ category: e.target.value === '' ? null : e.target.value === 'none' ? 'none' : Number(e.target.value) })}
              >
                <option value="" className="bg-elevated">All categories</option>
                <option value="none" className="bg-elevated">Uncategorized</option>
                {groups.map((g) => (
                  <optgroup key={g.id} label={g.name} className="bg-elevated">
                    {g.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Labeled>
            <Labeled id={ids.payee} label="Payee">
              <select id={ids.payee} className={SMALL} value={filters.payee ?? ''} onChange={(e) => set({ payee: e.target.value ? Number(e.target.value) : null })}>
                <option value="" className="bg-elevated">All payees</option>
                {payeeList.map((p) => (
                  <option key={p.id} value={p.id} className="bg-elevated">
                    {p.name}
                    {p.archived ? ' (archived)' : ''}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled id={ids.cleared} label="Cleared">
              <select id={ids.cleared} className={SMALL} value={filters.cleared ?? ''} onChange={(e) => set({ cleared: (e.target.value || null) as TxFilters['cleared'] })}>
                <option value="" className="bg-elevated">Cleared + uncleared</option>
                <option value="yes" className="bg-elevated">Cleared only</option>
                <option value="no" className="bg-elevated">Not cleared yet</option>
              </select>
            </Labeled>
            <Labeled id={ids.type} label="Type">
              <select id={ids.type} className={SMALL} value={filters.type ?? ''} onChange={(e) => set({ type: (e.target.value || null) as TxFilters['type'] })}>
                <option value="" className="bg-elevated">Income + expenses</option>
                <option value="income" className="bg-elevated">Income</option>
                <option value="expense" className="bg-elevated">Expenses</option>
              </select>
            </Labeled>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted">Amount (either direction)</span>
              <div className="grid grid-cols-2 gap-2">
                <AmountInput label="Min" value={filters.min} onChange={(min) => set({ min })} />
                <AmountInput label="Max" value={filters.max} onChange={(max) => set({ max })} />
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Labeled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Removable chips for every active filter. */
export function FilterChips({
  filters,
  onChange,
  accounts,
  groups,
  payees,
  fmt,
}: {
  filters: TxFilters;
  onChange: (update: (f: TxFilters) => TxFilters) => void;
  accounts: Account[];
  groups: CategoryGroupNode[];
  payees: Payee[];
  fmt: MoneyFormat;
}) {
  const chips: { key: string; label: string; clear: Partial<TxFilters> }[] = [];
  const cat = typeof filters.category === 'number' ? groups.flatMap((g) => g.categories).find((c) => c.id === filters.category) : null;
  const d = (iso: string) => formatDate(iso, fmt.locale, { day: 'numeric', month: 'short', year: 'numeric' });

  if (filters.q.trim()) chips.push({ key: 'q', label: `“${filters.q.trim()}”`, clear: { q: '' } });
  if (filters.month) chips.push({ key: 'month', label: monthName(filters.month, fmt.locale), clear: { month: null } });
  else if (filters.from || filters.to) {
    chips.push({ key: 'dates', label: `${filters.from ? d(filters.from) : '…'} – ${filters.to ? d(filters.to) : '…'}`, clear: { from: null, to: null } });
  }
  if (filters.account !== null) chips.push({ key: 'account', label: accounts.find((a) => a.id === filters.account)?.name ?? 'Account', clear: { account: null } });
  if (filters.category === 'none') chips.push({ key: 'cat', label: 'Uncategorized', clear: { category: null } });
  else if (cat) chips.push({ key: 'cat', label: `${cat.icon} ${cat.name}`, clear: { category: null } });
  if (filters.payee !== null) chips.push({ key: 'payee', label: payees.find((p) => p.id === filters.payee)?.name ?? 'Payee', clear: { payee: null } });
  if (filters.cleared) chips.push({ key: 'cleared', label: filters.cleared === 'yes' ? 'Cleared' : 'Not cleared', clear: { cleared: null } });
  if (filters.type) chips.push({ key: 'type', label: filters.type === 'income' ? 'Income' : 'Expenses', clear: { type: null } });
  if (filters.min !== null || filters.max !== null) {
    const lo = filters.min !== null ? formatMoney(filters.min, fmt) : '0';
    const hi = filters.max !== null ? formatMoney(filters.max, fmt) : '∞';
    chips.push({ key: 'amt', label: `${lo} – ${hi}`, clear: { min: null, max: null } });
  }
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-3" aria-label="Active filters">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onChange((f) => ({ ...f, ...c.clear }))}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 py-1 pl-3 pr-2 text-xs font-medium transition-colors hover:bg-accent/20"
          aria-label={`Remove filter ${c.label}`}
        >
          {c.label}
          <X className="size-3.5 text-muted" aria-hidden />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" onClick={() => onChange(() => EMPTY_FILTERS)} className="text-xs font-semibold text-accent hover:underline">
          Clear all
        </button>
      )}
    </div>
  );
}

export function FiltersToggle({ open, onToggle, filters }: { open: boolean; onToggle: () => void; filters: TxFilters }) {
  const count = activeFilterCount({ ...filters, q: '' });
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="tx-filters"
      className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors ${
        open || count ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface hover:bg-subtle'
      }`}
    >
      <SlidersHorizontal className="size-4" aria-hidden />
      <span className="hidden sm:inline">Filters</span>
      {count > 0 && <span className="grid size-5 place-items-center rounded-full accent-gradient text-[10px] font-bold text-accent-fg">{count}</span>}
    </button>
  );
}
