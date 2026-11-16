import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, EyeOff, FolderPlus, Loader2, Pencil, Plus, Repeat, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import { parseMoney, toInputValue } from '../../lib/money';
import type { BudgetCategory, BudgetGroup } from '../../types/api';
import { rise } from '../dashboard/ui';

/* Column template shared by the header, group rows and category rows. */
const COLS = 'grid grid-cols-[minmax(0,1fr)_6.75rem_6.5rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_8rem]';

export interface GridHandlers {
  onAssign: (category: BudgetCategory, assignedMinor: number) => Promise<void>;
  onAvailable: (category: BudgetCategory) => void;
  onEditCategory: (category: BudgetCategory) => void;
  onEditGroup: (group: BudgetGroup) => void;
  onAddCategory: (group: BudgetGroup, name: string) => Promise<void>;
  onInvalidAmount: () => void;
}

/* ------------------------------------------------------------------ */
/* Assigned: an inline money input. Enter saves and moves down, Escape   */
/* cancels, blur saves. Shows the formatted amount while not editing.    */
/* ------------------------------------------------------------------ */

function AssignedCell({
  category,
  index,
  fmt,
  onAssign,
  onInvalid,
}: {
  category: BudgetCategory;
  index: number;
  fmt: MoneyFormat;
  onAssign: GridHandlers['onAssign'];
  onInvalid: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const skipBlur = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  const shown = editing ? text : category.assignedMinor ? formatMoney(category.assignedMinor, fmt) : '';

  async function commit(moveDown: boolean) {
    const raw = text.trim();
    const minor = raw === '' ? 0 : parseMoney(raw);
    setEditing(false);
    if (moveDown) {
      // Spreadsheet feel: Enter goes to the next category's Assigned (or leaves the last one).
      const nextInput = document.querySelector<HTMLInputElement>(`[data-assign-index="${index + 1}"]`);
      if (nextInput) nextInput.focus();
      else ref.current?.blur();
    }
    if (minor === null) {
      onInvalid();
      return;
    }
    if (minor === category.assignedMinor) return;
    setSaving(true);
    try {
      await onAssign(category, minor);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      skipBlur.current = true;
      void commit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      skipBlur.current = true;
      setEditing(false);
      ref.current?.blur();
    }
  }

  return (
    <div className="relative">
      <input
        ref={ref}
        data-assign-index={index}
        inputMode="decimal"
        autoComplete="off"
        aria-label={`Assigned to ${category.name}`}
        placeholder={formatMoney(0, fmt)}
        value={shown}
        disabled={saving}
        onFocus={(e) => {
          skipBlur.current = false;
          setText(category.assignedMinor ? toInputValue(category.assignedMinor) : '');
          setEditing(true);
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false;
            return;
          }
          if (editing) void commit(false);
        }}
        className="h-9 w-full rounded-lg border border-transparent bg-transparent px-2.5 text-right text-sm font-medium tabular-nums text-fg outline-none transition-[border-color,background-color,box-shadow] placeholder:text-muted/50 hover:border-line hover:bg-surface focus:border-accent focus:bg-surface focus:ring-4 focus:ring-accent/15 focus-visible:outline-none disabled:opacity-60"
      />
      {saving && <Loader2 className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted" aria-label="Saving" />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AvailablePill({ category, fmt, onClick }: { category: BudgetCategory; fmt: MoneyFormat; onClick: () => void }) {
  const v = category.availableMinor;
  const tone = v < 0 ? 'bg-expense/15 text-expense ring-expense/30' : v > 0 ? 'bg-income/12 text-income ring-income/25' : 'bg-subtle text-muted ring-line';
  const label = v < 0 ? `Cover ${category.name}: overspent by ${formatMoney(-v, fmt)}` : `Move money from ${category.name}`;
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={v < 0 ? 'Overspent: click to cover it' : 'Click to move money'}
        className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ring-1 transition-transform hover:scale-[1.04] ${tone}`}
      >
        {category.carryover && <Repeat className="size-3 shrink-0" aria-label="Rolls overspending over" />}
        {formatMoney(v, fmt)}
      </button>
    </div>
  );
}

/** Thin "spent of budgeted" bar under the category name. */
function SpendBar({ category }: { category: BudgetCategory }) {
  const budgeted = category.carryInMinor + category.assignedMinor;
  const spent = Math.max(0, -category.activityMinor);
  if (budgeted <= 0 && spent === 0) return null;
  const over = category.availableMinor < 0;
  const pct = over ? 100 : budgeted > 0 ? Math.min(100, (spent / budgeted) * 100) : 0;
  return (
    <span className="mt-1.5 block h-1 w-full max-w-48 overflow-hidden rounded-full bg-subtle" aria-hidden>
      <motion.span
        className={`block h-full rounded-full ${over ? 'bg-expense' : pct > 85 ? 'bg-warning' : 'accent-gradient'}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      />
    </span>
  );
}

function CategoryRow({
  category,
  index,
  fmt,
  handlers,
}: {
  category: BudgetCategory;
  index: number;
  fmt: MoneyFormat;
  handlers: GridHandlers;
}) {
  return (
    <div role="row" className={`${COLS} rounded-xl px-2 py-2 transition-colors hover:bg-subtle/70 sm:px-3`}>
      <div role="rowheader" className="min-w-0">
        <button
          type="button"
          onClick={() => handlers.onEditCategory(category)}
          className="group flex max-w-full items-center gap-2.5 text-left"
          aria-label={`Edit ${category.name}`}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-subtle text-base" aria-hidden>
            {category.icon}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{category.name}</span>
              {category.hidden && <EyeOff className="size-3.5 shrink-0 text-muted" aria-label="Hidden" />}
              <Pencil className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
            </span>
          </span>
        </button>
        <SpendBar category={category} />
      </div>
      <div role="cell">
        <AssignedCell category={category} index={index} fmt={fmt} onAssign={handlers.onAssign} onInvalid={handlers.onInvalidAmount} />
      </div>
      <div role="cell" className={`hidden text-right text-sm tabular-nums sm:block ${category.activityMinor < 0 ? 'text-fg' : 'text-muted'}`}>
        {formatMoney(category.activityMinor, fmt)}
      </div>
      <div role="cell">
        <AvailablePill category={category} fmt={fmt} onClick={() => handlers.onAvailable(category)} />
      </div>
    </div>
  );
}

function AddCategoryInline({ group, onAdd }: { group: BudgetGroup; onAdd: GridHandlers['onAddCategory'] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  async function submit() {
    const n = name.trim();
    if (!n) return setOpen(false);
    setBusy(true);
    try {
      await onAdd(group, n);
      setName('');
      ref.current?.focus();
    } catch {
      /* the page shows the error */
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-2 mt-1 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-subtle hover:text-fg sm:ml-3"
      >
        <Plus className="size-3.5" aria-hidden /> Add category
      </button>
    );
  }
  return (
    <form
      className="mx-2 mt-1 flex items-center gap-2 sm:mx-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`add-cat-${group.id}`} className="sr-only">
        New category in {group.name}
      </label>
      <input
        ref={ref}
        id={`add-cat-${group.id}`}
        value={name}
        maxLength={40}
        disabled={busy}
        placeholder={`New category in ${group.name}`}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setName('');
            setOpen(false);
          }
        }}
        className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 focus-visible:outline-none"
      />
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg accent-gradient px-3 text-xs font-semibold text-accent-fg disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
        Add
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg px-2.5 text-xs font-medium text-muted hover:bg-subtle hover:text-fg">
        Cancel
      </button>
    </form>
  );
}

function GroupBlock({
  group,
  categories,
  collapsed,
  onToggle,
  startIndex,
  fmt,
  handlers,
}: {
  group: BudgetGroup;
  categories: BudgetCategory[];
  collapsed: boolean;
  onToggle: () => void;
  startIndex: number;
  fmt: MoneyFormat;
  handlers: GridHandlers;
}) {
  const bodyId = `budget-group-${group.id}`;
  const t = group.totals;
  return (
    <div role="rowgroup" className="border-t border-line pt-2 first:border-t-0 first:pt-0">
      <div role="row" className={`${COLS} rounded-xl px-2 py-2 sm:px-3`}>
        <div role="rowheader" className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            className="-ml-1 flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-subtle"
          >
            <ChevronDown className={`size-4 shrink-0 text-muted transition-transform ${collapsed ? '-rotate-90' : ''}`} aria-hidden />
            <span className="truncate text-xs font-bold uppercase tracking-[0.12em] text-muted">{group.name}</span>
            {group.hidden && <EyeOff className="size-3.5 shrink-0 text-muted" aria-label="Hidden group" />}
            <span className="shrink-0 rounded-md bg-subtle px-1.5 text-[10px] font-semibold text-muted">{categories.length}</span>
          </button>
          <button
            type="button"
            onClick={() => handlers.onEditGroup(group)}
            aria-label={`Edit group ${group.name}`}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            <Settings2 className="size-3.5" aria-hidden />
          </button>
        </div>
        <div role="cell" className="px-2.5 text-right text-xs font-semibold tabular-nums text-muted">
          {formatMoney(t.assignedMinor, fmt)}
        </div>
        <div role="cell" className="hidden text-right text-xs font-semibold tabular-nums text-muted sm:block">
          {formatMoney(t.activityMinor, fmt)}
        </div>
        <div role="cell" className={`pr-2.5 text-right text-xs font-semibold tabular-nums ${t.availableMinor < 0 ? 'text-expense' : 'text-muted'}`}>
          {formatMoney(t.availableMinor, fmt)}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden pb-2"
          >
            {categories.length === 0 && <p className="px-3 py-2 text-sm text-muted">No categories in this group yet.</p>}
            {categories.map((c, i) => (
              <CategoryRow key={c.id} category={c} index={startIndex + i} fmt={fmt} handlers={handlers} />
            ))}
            <AddCategoryInline group={group} onAdd={handlers.onAddCategory} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AddGroupInline({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="flex flex-wrap items-center gap-2 border-t border-line pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        setBusy(true);
        try {
          await onAdd(n);
          setName('');
        } catch {
          /* the page shows the error */
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="new-group" className="sr-only">
        New group
      </label>
      <input
        id="new-group"
        value={name}
        maxLength={40}
        disabled={busy}
        placeholder="New group, e.g. Fun, Savings, Kids"
        onChange={(e) => setName(e.target.value)}
        className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 focus-visible:outline-none sm:max-w-sm"
      />
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition-colors hover:border-accent/60 hover:bg-subtle disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FolderPlus className="size-4" aria-hidden />}
        Add group
      </button>
    </form>
  );
}

/** Groups → categories, with Assigned / Activity / Available columns. */
export function BudgetGrid({
  groups,
  showHidden,
  collapsed,
  onToggleGroup,
  fmt,
  handlers,
  busy,
}: {
  groups: BudgetGroup[];
  showHidden: boolean;
  collapsed: Set<number>;
  onToggleGroup: (id: number) => void;
  fmt: MoneyFormat;
  handlers: GridHandlers;
  busy: boolean;
}) {
  const visible = groups
    .filter((g) => showHidden || !g.hidden)
    .map((g) => ({ group: g, categories: g.categories.filter((c) => showHidden || !c.hidden) }));

  let index = 0;
  return (
    <motion.div variants={rise} role="table" aria-label="Budget categories" aria-busy={busy || undefined} className={busy ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      <div role="row" className={`${COLS} border-b border-line px-2 pb-2 text-xs font-semibold uppercase tracking-wider text-muted sm:px-3`}>
        <div role="columnheader">Category</div>
        <div role="columnheader" className="px-2.5 text-right">
          Assigned
        </div>
        <div role="columnheader" className="hidden text-right sm:block">
          Activity
        </div>
        <div role="columnheader" className="pr-2.5 text-right">
          Available
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {visible.map(({ group, categories }) => {
          const start = index;
          if (!collapsed.has(group.id)) index += categories.length;
          return (
            <GroupBlock
              key={group.id}
              group={group}
              categories={categories}
              collapsed={collapsed.has(group.id)}
              onToggle={() => onToggleGroup(group.id)}
              startIndex={start}
              fmt={fmt}
              handlers={handlers}
            />
          );
        })}
      </div>
    </motion.div>
  );
}
