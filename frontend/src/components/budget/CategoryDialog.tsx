import { ArrowDownUp, ChevronDown, ChevronUp, HandCoins } from 'lucide-react';
import { useId, useState } from 'react';
import { useAssign, useCarryover, useCategoryWrites, type CategoryPatch } from '../../hooks/useBudget';
import { ApiError } from '../../lib/api';
import { formatMoney, monthName, type MoneyFormat } from '../../lib/format';
import type { BudgetCategory, BudgetGroup } from '../../types/api';
import { CONTROL, Dialog, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';

/** server/validate.js icon(): 1-16 chars, no control characters or < > & " '. */
// eslint-disable-next-line no-control-regex
const iconProblem = (s: string) => (!s || s.length > 16 || /[\u0000-\u001f<>&"']/.test(s) ? 'Pick one emoji for the icon.' : null);

function Toggle({ id, checked, onChange, label, detail }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; detail: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 hover:border-accent/40">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-subtle ring-1 ring-line transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </label>
  );
}

export function CategoryDialog({
  month,
  category,
  group,
  visibleIds,
  toBudgetMinor,
  fmt,
  onClose,
  onDone,
  onMove,
}: {
  month: string;
  category: BudgetCategory;
  group: BudgetGroup;
  /** Categories of this group the user can currently see, in order (moves skip hidden ones). */
  visibleIds: number[];
  toBudgetMinor: number;
  fmt: MoneyFormat;
  onClose: () => void;
  onDone: (message: string) => void;
  onMove: () => void;
}) {
  const { updateCategory, reorderCategories } = useCategoryWrites();
  const carry = useCarryover(month);
  const assign = useAssign(month);

  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon);
  const [hidden, setHidden] = useState(category.hidden);
  const [rollover, setRollover] = useState(category.carryover);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { name: useId(), icon: useId(), hidden: useId(), roll: useId() };

  const position = visibleIds.indexOf(category.id);
  const overspent = category.availableMinor < 0;
  const coverFromPool = overspent && toBudgetMinor > 0 ? Math.min(-category.availableMinor, toBudgetMinor) : 0;
  const busy = saving || reorderCategories.isPending || assign.isPending;

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  async function save() {
    setError(null);
    const n = name.trim();
    const ic = icon.trim();
    if (!n || n.length > 40) return setError('Name must be 1 to 40 characters.');
    const iconErr = iconProblem(ic);
    if (iconErr) return setError(iconErr);

    const patch: CategoryPatch = {};
    if (n !== category.name) patch.name = n;
    if (ic !== category.icon) patch.icon = ic;
    if (hidden !== category.hidden) patch.hidden = hidden;
    const rolloverChanged = rollover !== category.carryover;
    if (!Object.keys(patch).length && !rolloverChanged) return onClose();

    setSaving(true);
    try {
      if (rolloverChanged) await carry.mutateAsync({ categoryId: category.id, carryover: rollover });
      if (Object.keys(patch).length) await updateCategory.mutateAsync({ id: category.id, patch });
      onDone(`Saved ${n}.`);
      onClose();
    } catch (err) {
      fail(err, 'Could not save the category.');
    } finally {
      setSaving(false);
    }
  }

  async function move(dir: -1 | 1) {
    setError(null);
    const neighbour = visibleIds[position + dir];
    if (neighbour === undefined) return;
    // Reorder the full list (hidden ones included) so the category lands next to the visible neighbour.
    const list = group.categories.map((c) => c.id).filter((id) => id !== category.id);
    const at = list.indexOf(neighbour);
    list.splice(dir < 0 ? at : at + 1, 0, category.id);
    try {
      await reorderCategories.mutateAsync(list.map((id, i) => ({ id, groupId: group.id, sortOrder: i })));
      onDone(`Moved ${category.name} ${dir < 0 ? 'up' : 'down'}.`);
      onClose();
    } catch (err) {
      fail(err, 'Could not reorder.');
    }
  }

  async function cover() {
    setError(null);
    try {
      await assign.mutateAsync({ categoryId: category.id, assignedMinor: category.assignedMinor + coverFromPool });
      onDone(`Assigned ${formatMoney(coverFromPool, fmt)} more to ${category.name} from To Budget.`);
      onClose();
    } catch (err) {
      fail(err, 'Could not assign the money.');
    }
  }

  const facts: [string, number][] = [
    ['Rolled in from last month', category.carryInMinor],
    ['Assigned', category.assignedMinor],
    ['Activity', category.activityMinor],
    ['Available', category.availableMinor],
  ];

  return (
    <Dialog
      title={
        <span className="flex items-center gap-2">
          <span aria-hidden>{category.icon}</span> {category.name}
        </span>
      }
      description={`${group.name} · ${monthName(month, fmt.locale)}`}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={busy}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={saving}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
            {error}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-2">
          {facts.map(([label, minor]) => (
            <div key={label} className="rounded-xl bg-subtle px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className={`text-sm font-semibold tabular-nums ${label === 'Available' && minor < 0 ? 'text-expense' : ''}`}>
                {formatMoney(minor, fmt)}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-2">
          {coverFromPool > 0 && (
            <button
              type="button"
              onClick={cover}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg accent-gradient px-3 text-xs font-semibold text-accent-fg disabled:opacity-60"
            >
              <HandCoins className="size-3.5" aria-hidden />
              Cover {formatMoney(coverFromPool, fmt)} from To Budget
            </button>
          )}
          <button
            type="button"
            onClick={onMove}
            disabled={busy}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold hover:bg-subtle disabled:opacity-60"
          >
            <ArrowDownUp className="size-3.5" aria-hidden />
            {overspent ? 'Cover from another category' : 'Move money'}
          </button>
        </div>

        <div className="grid grid-cols-[1fr_5.5rem] gap-3">
          <DialogField label="Name" htmlFor={ids.name}>
            <input id={ids.name} className={CONTROL} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </DialogField>
          <DialogField label="Icon" htmlFor={ids.icon}>
            <input id={ids.icon} className={`${CONTROL} text-center text-lg`} value={icon} maxLength={16} onChange={(e) => setIcon(e.target.value)} autoComplete="off" />
          </DialogField>
        </div>

        <Toggle
          id={ids.roll}
          checked={rollover}
          onChange={setRollover}
          label={`Roll over overspending from ${monthName(month, fmt.locale)} on`}
          detail="Off: overspending at month end comes out of next month’s To Budget and the category starts at zero. On: the negative balance stays in this category."
        />
        <Toggle
          id={ids.hidden}
          checked={hidden}
          onChange={setHidden}
          label="Hide this category"
          detail="Hidden categories keep their money and history; they just stay out of the way. Use “Show hidden” to see them."
        />

        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-xs text-muted">Order in {group.name}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => move(-1)}
              disabled={busy || position <= 0}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs font-medium hover:bg-subtle disabled:opacity-40"
            >
              <ChevronUp className="size-3.5" aria-hidden /> Move up
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              disabled={busy || position < 0 || position >= visibleIds.length - 1}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs font-medium hover:bg-subtle disabled:opacity-40"
            >
              <ChevronDown className="size-3.5" aria-hidden /> Move down
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
