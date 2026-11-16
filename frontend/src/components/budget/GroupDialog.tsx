import { ChevronDown, ChevronUp } from 'lucide-react';
import { useId, useState } from 'react';
import { useCategoryWrites } from '../../hooks/useBudget';
import { ApiError } from '../../lib/api';
import type { BudgetGroup } from '../../types/api';
import { CONTROL, Dialog, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';

export function GroupDialog({
  group,
  visibleIds,
  onClose,
  onDone,
}: {
  group: BudgetGroup;
  /** Budget groups the user can currently see, in order (income groups are never shown). */
  visibleIds: number[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { updateGroup, moveGroup } = useCategoryWrites();
  const [name, setName] = useState(group.name);
  const [hidden, setHidden] = useState(group.hidden);
  const [error, setError] = useState<string | null>(null);
  const nameId = useId();
  const hiddenId = useId();
  const busy = updateGroup.isPending || moveGroup.isPending;
  const index = visibleIds.indexOf(group.id);
  const count = visibleIds.length;

  function save() {
    setError(null);
    const n = name.trim();
    if (!n || n.length > 40) return setError('Name must be 1 to 40 characters.');
    if (n === group.name && hidden === group.hidden) return onClose();
    updateGroup.mutate(
      { id: group.id, patch: { name: n, hidden } },
      {
        onSuccess: () => {
          onDone(`Saved group ${n}.`);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the group.'),
      },
    );
  }

  function move(dir: -1 | 1) {
    setError(null);
    moveGroup.mutate(
      { id: group.id, dir, visibleIds },
      {
        onSuccess: () => {
          onDone(`Moved ${group.name} ${dir < 0 ? 'up' : 'down'}.`);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not reorder the groups.'),
      },
    );
  }

  return (
    <Dialog
      title="Edit group"
      description={`${group.categories.length} ${group.categories.length === 1 ? 'category' : 'categories'}`}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={busy}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={updateGroup.isPending}>{updateGroup.isPending ? 'Saving…' : 'Save'}</PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
            {error}
          </p>
        )}
        <DialogField label="Name" htmlFor={nameId}>
          <input id={nameId} className={CONTROL} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
        </DialogField>
        <label htmlFor={hiddenId} className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            id={hiddenId}
            type="checkbox"
            checked={hidden}
            onChange={(e) => setHidden(e.target.checked)}
            className="size-4 rounded accent-[var(--sw-accent)]"
          />
          Hide this group and its categories
        </label>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-xs text-muted">Order</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => move(-1)}
              disabled={busy || index <= 0}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs font-medium hover:bg-subtle disabled:opacity-40"
            >
              <ChevronUp className="size-3.5" aria-hidden /> Move up
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              disabled={busy || index < 0 || index >= count - 1}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 text-xs font-medium hover:bg-subtle disabled:opacity-40"
            >
              <ChevronDown className="size-3.5" aria-hidden /> Move down
            </button>
          </div>
        </div>
        <p className="text-xs text-muted">Add categories with “Add category” under the group.</p>
      </div>
    </Dialog>
  );
}
