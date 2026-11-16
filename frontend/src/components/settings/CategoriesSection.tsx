import { ArrowDown, ArrowUp, Combine, EyeOff, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useCategoryWrites } from '../../hooks/useBudget';
import { useCreateGroup, useDeleteCategory, useDeleteGroup, useMergeCategory, useReorderGroups } from '../../hooks/useSettings';
import { useCategoryTree } from '../../hooks/useTransactions';
import { ApiError } from '../../lib/api';
import type { CategoryGroupNode, CategoryNode } from '../../types/api';
import { ErrorState, Skeleton } from '../dashboard/ui';
import { IconButton } from '../schedules/parts';
import { CategorySelect } from '../transactions/pickers';
import { CONTROL, Dialog, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';

type Msg = (tone: 'success' | 'error', text: string) => void;
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
// server/validate.js icon(): 1-16 chars, no control characters or < > & " '.
// eslint-disable-next-line no-control-regex
const badIcon = (s: string) => !s.trim() || s.trim().length > 16 || /[\u0000-\u001f<>&"']/.test(s);

type DialogState =
  | { kind: 'group'; group: CategoryGroupNode | null }
  | { kind: 'category'; category: CategoryNode | null; groupId: number }
  | { kind: 'merge'; category: CategoryNode }
  | { kind: 'delete'; category: CategoryNode }
  | null;

/** Category groups and categories (server/routes/categories.js), income groups included. */
export function CategoriesSection({ onMessage }: { onMessage: Msg }) {
  const q = useCategoryTree();
  const { reorderCategories, updateGroup } = useCategoryWrites();
  const reorderGroups = useReorderGroups();
  const deleteGroup = useDeleteGroup();
  const [dialog, setDialog] = useState<DialogState>(null);
  const groups = q.data ?? [];
  const fail = (e: unknown) => onMessage('error', errText(e, 'That did not work.'));

  function moveGroup(i: number, by: -1 | 1) {
    const ids = groups.map((g) => g.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    reorderGroups.mutate(ids, { onError: fail });
  }

  function moveCategory(g: CategoryGroupNode, i: number, by: -1 | 1) {
    const list = [...g.categories];
    [list[i], list[i + by]] = [list[i + by], list[i]];
    reorderCategories.mutate(
      list.map((c, k) => ({ id: c.id, groupId: g.id, sortOrder: k })),
      { onError: fail },
    );
  }

  return (
    <section aria-labelledby="sw-set-cats" className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="sw-set-cats" className="text-lg font-bold tracking-tight">
            Categories
          </h3>
          <p className="text-sm text-muted">Groups and categories for spending and income. Hidden ones stay on old transactions but leave pickers and the budget.</p>
        </div>
        <PrimaryButton type="button" onClick={() => setDialog({ kind: 'group', group: null })}>
          <FolderPlus className="size-4" aria-hidden /> Add group
        </PrimaryButton>
      </header>

      {q.isPending ? (
        <Skeleton className="h-64 w-full rounded-3xl" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <ol className="space-y-3">
          {groups.map((g, gi) => (
            <li key={g.id} id={`group-${g.id}`} aria-label={`Group ${g.name}`} className={`glass rounded-3xl border border-line px-4 pb-2 pt-3 shadow-glass sm:px-5 ${g.hidden ? 'opacity-75' : ''}`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="truncate font-semibold">{g.name}</span>
                  {g.isIncome && <span className="rounded-full bg-income/12 px-2 py-0.5 text-[11px] font-semibold text-income">Income</span>}
                  {g.hidden && <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted">Hidden</span>}
                  <span className="text-xs text-muted">{g.categories.length} categor{g.categories.length === 1 ? 'y' : 'ies'}</span>
                </span>
                <span className="flex gap-0.5">
                  <IconButton label={`Move group ${g.name} up`} onClick={() => moveGroup(gi, -1)} disabled={gi === 0 || reorderGroups.isPending}>
                    <ArrowUp className="size-4" aria-hidden />
                  </IconButton>
                  <IconButton label={`Move group ${g.name} down`} onClick={() => moveGroup(gi, 1)} disabled={gi === groups.length - 1 || reorderGroups.isPending}>
                    <ArrowDown className="size-4" aria-hidden />
                  </IconButton>
                  <IconButton label={`Add a category to ${g.name}`} onClick={() => setDialog({ kind: 'category', category: null, groupId: g.id })}>
                    <Plus className="size-4" aria-hidden />
                  </IconButton>
                  <IconButton label={`Edit group ${g.name}`} onClick={() => setDialog({ kind: 'group', group: g })}>
                    <Pencil className="size-4" aria-hidden />
                  </IconButton>
                  <IconButton
                    label={g.categories.length ? `Group ${g.name} isn't empty: move or delete its categories first` : `Delete group ${g.name}`}
                    tone="danger"
                    disabled={g.categories.length > 0 || deleteGroup.isPending}
                    onClick={() => deleteGroup.mutate(g.id, { onSuccess: () => onMessage('success', `Deleted group ${g.name}.`), onError: fail })}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </IconButton>
                </span>
              </div>
              {g.categories.length === 0 ? (
                <p className="py-3 text-sm text-muted">
                  No categories yet.{' '}
                  <button type="button" className="font-semibold text-accent hover:underline" onClick={() => setDialog({ kind: 'category', category: null, groupId: g.id })}>
                    Add one
                  </button>
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {g.categories.map((c, ci) => (
                    <li key={c.id} id={`category-row-${c.id}`} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 ${c.hidden ? 'opacity-60' : ''}`}>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-subtle text-base" aria-hidden>
                        {c.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">{c.name}</span>
                          {c.hidden && <EyeOff className="size-3.5 text-muted" aria-label="hidden" />}
                        </span>
                        <span className="block text-xs text-muted">
                          {c.transactionCount ? `${c.transactionCount} transaction${c.transactionCount === 1 ? '' : 's'}` : 'Not used yet'}
                        </span>
                      </span>
                      <span className="flex gap-0.5">
                        <IconButton label={`Move ${c.name} up`} onClick={() => moveCategory(g, ci, -1)} disabled={ci === 0 || reorderCategories.isPending}>
                          <ArrowUp className="size-4" aria-hidden />
                        </IconButton>
                        <IconButton label={`Move ${c.name} down`} onClick={() => moveCategory(g, ci, 1)} disabled={ci === g.categories.length - 1 || reorderCategories.isPending}>
                          <ArrowDown className="size-4" aria-hidden />
                        </IconButton>
                        <IconButton label={`Edit ${c.name}`} onClick={() => setDialog({ kind: 'category', category: c, groupId: g.id })}>
                          <Pencil className="size-4" aria-hidden />
                        </IconButton>
                        <IconButton label={`Merge ${c.name} into another category`} onClick={() => setDialog({ kind: 'merge', category: c })}>
                          <Combine className="size-4" aria-hidden />
                        </IconButton>
                        <IconButton label={`Delete ${c.name}`} tone="danger" onClick={() => setDialog({ kind: 'delete', category: c })}>
                          <Trash2 className="size-4" aria-hidden />
                        </IconButton>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {g.hidden && (
                <p className="pb-1 pt-2 text-xs text-muted">
                  Hidden group.{' '}
                  <button type="button" className="font-semibold text-accent hover:underline" onClick={() => updateGroup.mutate({ id: g.id, patch: { hidden: false } }, { onSuccess: () => onMessage('success', `${g.name} is visible again.`), onError: fail })}>
                    Show it
                  </button>
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {dialog?.kind === 'group' && <GroupDialog group={dialog.group} onClose={() => setDialog(null)} onMessage={onMessage} />}
      {dialog?.kind === 'category' && <CategoryDialog category={dialog.category} groupId={dialog.groupId} groups={groups} onClose={() => setDialog(null)} onMessage={onMessage} />}
      {dialog?.kind === 'merge' && <MergeDialog category={dialog.category} groups={groups} onClose={() => setDialog(null)} onMessage={onMessage} />}
      {dialog?.kind === 'delete' && <DeleteDialog category={dialog.category} groups={groups} onClose={() => setDialog(null)} onMessage={onMessage} />}
    </section>
  );
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
      {text}
    </p>
  );
}

function GroupDialog({ group, onClose, onMessage }: { group: CategoryGroupNode | null; onClose: () => void; onMessage: Msg }) {
  const create = useCreateGroup();
  const { updateGroup } = useCategoryWrites();
  const [name, setName] = useState(group?.name ?? '');
  const [isIncome, setIsIncome] = useState(false);
  const [hidden, setHidden] = useState(group?.hidden ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = { name: useId(), inc: useId(), hid: useId() };
  const pending = create.isPending || updateGroup.isPending;

  function submit() {
    const n = name.trim();
    if (!n || n.length > 40) return setProblem('Name must be 1 to 40 characters.');
    const fail = (e: unknown) => setProblem(errText(e, 'Could not save.'));
    if (!group)
      create.mutate(
        { name: n, isIncome },
        {
          onSuccess: () => {
            onMessage('success', `Added group ${n}.`);
            onClose();
          },
          onError: fail,
        },
      );
    else
      updateGroup.mutate(
        { id: group.id, patch: { name: n, hidden } },
        {
          onSuccess: () => {
            onMessage('success', `Saved group ${n}.`);
            onClose();
          },
          onError: fail,
        },
      );
  }

  return (
    <Dialog
      title={group ? `Edit ${group.name}` : 'Add group'}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={pending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={pending}>{group ? 'Save' : 'Add group'}</PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <Problem text={problem} />
        <DialogField label="Name" htmlFor={ids.name}>
          <input id={ids.name} className={CONTROL} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" placeholder="e.g. Home" />
        </DialogField>
        {!group ? (
          <label htmlFor={ids.inc} className="flex cursor-pointer items-start gap-3 text-sm">
            <input id={ids.inc} type="checkbox" checked={isIncome} onChange={(e) => setIsIncome(e.target.checked)} className="mt-0.5 size-4 accent-[var(--sw-accent)]" />
            <span>
              Income group
              <span className="block text-xs text-muted">Money in these categories goes to To Budget instead of being spent. This can't be changed later.</span>
            </span>
          </label>
        ) : (
          <label htmlFor={ids.hid} className="flex cursor-pointer items-start gap-3 text-sm">
            <input id={ids.hid} type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="mt-0.5 size-4 accent-[var(--sw-accent)]" />
            <span>
              Hide this group
              <span className="block text-xs text-muted">Its categories leave the budget and pickers; old transactions keep them.</span>
            </span>
          </label>
        )}
      </div>
    </Dialog>
  );
}

function CategoryDialog({
  category,
  groupId,
  groups,
  onClose,
  onMessage,
}: {
  category: CategoryNode | null;
  groupId: number;
  groups: CategoryGroupNode[];
  onClose: () => void;
  onMessage: Msg;
}) {
  const { createCategory, updateCategory } = useCategoryWrites();
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '📦');
  const [group, setGroup] = useState(groupId);
  const [hidden, setHidden] = useState(category?.hidden ?? false);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = { name: useId(), icon: useId(), group: useId(), hid: useId() };
  const pending = createCategory.isPending || updateCategory.isPending;

  function submit() {
    const n = name.trim();
    if (!n || n.length > 40) return setProblem('Name must be 1 to 40 characters.');
    if (badIcon(icon)) return setProblem('Pick one emoji for the icon.');
    const fail = (e: unknown) => setProblem(errText(e, 'Could not save.'));
    const done = (text: string) => () => {
      onMessage('success', text);
      onClose();
    };
    if (!category) createCategory.mutate({ groupId: group, name: n, icon: icon.trim() }, { onSuccess: done(`Added ${n}.`), onError: fail });
    else updateCategory.mutate({ id: category.id, patch: { name: n, icon: icon.trim(), hidden, groupId: group } }, { onSuccess: done(`Saved ${n}.`), onError: fail });
  }

  return (
    <Dialog
      title={category ? `Edit ${category.name}` : 'Add category'}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={pending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={pending}>{category ? 'Save' : 'Add category'}</PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <Problem text={problem} />
        <div className="grid grid-cols-[5rem_1fr] gap-3">
          <DialogField label="Icon" htmlFor={ids.icon}>
            <input id={ids.icon} className={`${CONTROL} text-center text-lg`} maxLength={16} value={icon} onChange={(e) => setIcon(e.target.value)} autoComplete="off" />
          </DialogField>
          <DialogField label="Name" htmlFor={ids.name}>
            <input id={ids.name} className={CONTROL} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" placeholder="e.g. Groceries" />
          </DialogField>
        </div>
        <DialogField label="Group" htmlFor={ids.group}>
          <select id={ids.group} className={CONTROL} value={group} onChange={(e) => setGroup(Number(e.target.value))}>
            {groups.map((g) => (
              <option key={g.id} value={g.id} className="bg-elevated text-fg">
                {g.name}
                {g.isIncome ? ' (income)' : ''}
              </option>
            ))}
          </select>
        </DialogField>
        {category && (
          <label htmlFor={ids.hid} className="flex cursor-pointer items-start gap-3 text-sm">
            <input id={ids.hid} type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="mt-0.5 size-4 accent-[var(--sw-accent)]" />
            <span>
              Hide this category
              <span className="block text-xs text-muted">It leaves the budget and pickers; old transactions keep it.</span>
            </span>
          </label>
        )}
      </div>
    </Dialog>
  );
}

function MergeDialog({ category, groups, onClose, onMessage }: { category: CategoryNode; groups: CategoryGroupNode[]; onClose: () => void; onMessage: Msg }) {
  const merge = useMergeCategory();
  const [target, setTarget] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const others = groups.map((g) => ({ ...g, categories: g.categories.filter((c) => c.id !== category.id) }));
  const targetName = groups.flatMap((g) => g.categories).find((c) => c.id === target)?.name;

  return (
    <Dialog
      title={`Merge ${category.name}`}
      description="Everything in it moves to the category you pick, then it is removed."
      onClose={onClose}
      onSubmit={() => {
        if (target === null) return setProblem('Pick the category to keep.');
        merge.mutate(
          { id: category.id, targetId: target },
          {
            onSuccess: () => {
              onMessage('success', `Merged ${category.name} into ${targetName}.`);
              onClose();
            },
            onError: (e) => setProblem(errText(e, 'Could not merge.')),
          },
        );
      }}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={merge.isPending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={merge.isPending} disabled={target === null}>
            Merge
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <Problem text={problem} />
        <DialogField label="Keep this category" htmlFor={id}>
          <CategorySelect id={id} groups={others} includeHidden value={target} onChange={setTarget} noneLabel="Pick a category" />
        </DialogField>
        {targetName && (
          <p className="rounded-xl bg-subtle px-3.5 py-3 text-sm">
            {category.transactionCount} transaction{category.transactionCount === 1 ? '' : 's'}, the money assigned to it in your budget, payee defaults, rules and schedules move to{' '}
            <b>{targetName}</b>. This can't be undone.
          </p>
        )}
      </div>
    </Dialog>
  );
}

function DeleteDialog({ category, groups, onClose, onMessage }: { category: CategoryNode; groups: CategoryGroupNode[]; onClose: () => void; onMessage: Msg }) {
  const remove = useDeleteCategory();
  const used = category.transactionCount > 0;
  const [target, setTarget] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const others = groups.map((g) => ({ ...g, categories: g.categories.filter((c) => c.id !== category.id) }));

  return (
    <Dialog
      title={`Delete ${category.name}?`}
      description={used ? `It has ${category.transactionCount} transaction${category.transactionCount === 1 ? '' : 's'}. Choose where they go.` : 'Nothing uses it.'}
      onClose={onClose}
      onSubmit={() =>
        remove.mutate(
          { id: category.id, moveTo: used ? (target ?? 'none') : target },
          {
            onSuccess: () => {
              onMessage('success', `Deleted ${category.name}.`);
              onClose();
            },
            onError: (e) => setProblem(errText(e, 'Could not delete it.')),
          },
        )
      }
      footer={
        <>
          <GhostButton onClick={onClose} disabled={remove.isPending}>
            Keep it
          </GhostButton>
          <PrimaryButton tone="danger" pending={remove.isPending}>
            Delete category
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <Problem text={problem} />
        <DialogField label={used ? 'Move its transactions to' : 'Move any budget money to (optional)'} htmlFor={id}>
          <CategorySelect id={id} groups={others} value={target} onChange={setTarget} noneLabel={used ? 'Uncategorized' : 'Nowhere'} />
        </DialogField>
        <p className="text-xs text-muted">Rules, payee defaults and schedules that use it follow {used ? 'the transactions' : 'your choice'}. This can't be undone.</p>
      </div>
    </Dialog>
  );
}
