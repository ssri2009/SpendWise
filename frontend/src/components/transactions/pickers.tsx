import type { SelectHTMLAttributes } from 'react';
import type { Account, CategoryGroupNode } from '../../types/api';
import { CONTROL } from '../ui/Dialog';

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>;

/** Category <select> grouped by category group. '' = Uncategorized. */
export function CategorySelect({
  groups,
  value,
  onChange,
  includeHidden = false,
  keep,
  noneLabel = 'Uncategorized',
  className = CONTROL,
  ...rest
}: SelectProps & {
  groups: CategoryGroupNode[];
  value: number | null;
  onChange: (id: number | null) => void;
  includeHidden?: boolean;
  /** Always offer this id, even if hidden (the value currently saved). */
  keep?: number | null;
  noneLabel?: string;
}) {
  return (
    <select {...rest} className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="" className="bg-elevated text-fg">
        {noneLabel}
      </option>
      {groups.map((g) => {
        const cats = g.categories.filter((c) => includeHidden || (!c.hidden && !g.hidden) || c.id === keep);
        if (!cats.length) return null;
        return (
          <optgroup key={g.id} label={g.isIncome ? `${g.name} (income)` : g.name} className="bg-elevated text-fg">
            {cats.map((c) => (
              <option key={c.id} value={c.id} className="bg-elevated text-fg">
                {c.icon} {c.name}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

/** Account <select>. Closed accounts are only offered when they are the saved value (or for filtering). */
export function AccountSelect({
  accounts,
  value,
  onChange,
  includeClosed = false,
  keep,
  allLabel,
  className = CONTROL,
  ...rest
}: SelectProps & {
  accounts: Account[];
  value: number | null;
  onChange: (id: number | null) => void;
  includeClosed?: boolean;
  keep?: number | null;
  /** When set, an "all" option with this label maps to null. */
  allLabel?: string;
}) {
  const list = accounts.filter((a) => includeClosed || !a.closed || a.id === keep);
  return (
    <select {...rest} className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allLabel !== undefined && (
        <option value="" className="bg-elevated text-fg">
          {allLabel}
        </option>
      )}
      {list.map((a) => (
        <option key={a.id} value={a.id} className="bg-elevated text-fg">
          {a.name}
          {a.closed ? ' (closed)' : a.offbudget ? ' (off budget)' : ''}
        </option>
      ))}
    </select>
  );
}

/** id → category, and whether it is an income category. */
export function categoryIndex(groups: CategoryGroupNode[]) {
  const map = new Map<number, { name: string; icon: string; isIncome: boolean; hidden: boolean }>();
  for (const g of groups) for (const c of g.categories) map.set(c.id, { name: c.name, icon: c.icon, isIncome: g.isIncome, hidden: c.hidden || g.hidden });
  return map;
}
