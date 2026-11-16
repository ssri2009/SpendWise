import { Archive, ArchiveRestore, Check, Combine, ListFilter, Pencil, Trash2, Workflow, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useDeletePayee, useUpdatePayee, type PayeePatch } from '../../hooks/usePayeeAdmin';
import { ApiError } from '../../lib/api';
import { relativeDay } from '../../lib/format';
import type { CategoryGroupNode, Payee } from '../../types/api';
import { IconButton } from '../schedules/parts';
import { CategorySelect } from '../transactions/pickers';
import { CONTROL } from '../ui/Dialog';

const SELECT = `${CONTROL.replace('h-11', 'h-9')} text-xs`;

/**
 * One payee: select box, name (rename in place), default category (saved on change), how much it is
 * used, and Merge / Archive / Delete. Delete is only offered when nothing uses it.
 */
export function PayeeRow({
  p,
  groups,
  today,
  locale,
  selected,
  onToggle,
  onMerge,
  onMessage,
}: {
  p: Payee;
  groups: CategoryGroupNode[];
  today: string;
  locale: string;
  selected: boolean;
  onToggle: (id: number) => void;
  onMerge: (p: Payee) => void;
  onMessage: (tone: 'success' | 'error', text: string) => void;
}) {
  const update = useUpdatePayee();
  const remove = useDeletePayee();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const deletable = p.usageCount === 0 && p.ruleCount === 0;

  useEffect(() => {
    if (!editing) setName(p.name);
  }, [p.name, editing]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const fail = (err: unknown) => onMessage('error', err instanceof ApiError ? err.message : 'That did not work. Please try again.');

  function save(patch: PayeePatch, message: string, after?: () => void) {
    update.mutate({ id: p.id, patch }, { onSuccess: () => { onMessage('success', message); after?.(); }, onError: fail });
  }

  function commitName() {
    const n = name.trim();
    if (!n || n === p.name) return setEditing(false);
    if (n.length > 60) return onMessage('error', 'Name must be 60 characters or fewer.');
    save({ name: n }, `Renamed "${p.name}" to "${n}".`, () => setEditing(false));
  }

  return (
    <li
      id={`payee-row-${p.id}`}
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3 md:grid-cols-[auto_minmax(0,1fr)_14rem_8rem_auto] ${p.archived ? 'opacity-70' : ''}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggle(p.id)}
        aria-label={`Select ${p.name}`}
        className="size-4 accent-[var(--sw-accent)]"
      />

      <div className="min-w-0">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              ref={inputRef}
              aria-label={`New name for ${p.name}`}
              className={`${CONTROL} h-9`}
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitName();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              disabled={update.isPending}
            />
            <IconButton label="Save name" onClick={commitName} disabled={update.isPending}>
              <Check className="size-4" aria-hidden />
            </IconButton>
            <IconButton label="Cancel rename" onClick={() => setEditing(false)}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </div>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <button type="button" onClick={() => setEditing(true)} className="truncate text-left font-semibold hover:text-accent" title="Rename">
                {p.name}
              </button>
              {p.archived && <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted">Archived</span>}
              {p.ruleCount > 0 && (
                <Link
                  to="/rules"
                  className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted hover:text-fg"
                  title="Used by rules"
                >
                  <Workflow className="size-3" aria-hidden /> {p.ruleCount} rule{p.ruleCount === 1 ? '' : 's'}
                </Link>
              )}
            </p>
            <p className="text-xs text-muted md:hidden">
              {p.usageCount} transaction{p.usageCount === 1 ? '' : 's'}
              {p.lastUsed ? ` · last ${relativeDay(p.lastUsed, today, locale)}` : ''}
            </p>
          </>
        )}
      </div>

      <div className="col-span-2 col-start-2 md:col-span-1 md:col-start-auto">
        <CategorySelect
          groups={groups}
          value={p.defaultCategoryId}
          keep={p.defaultCategoryId}
          noneLabel="No default category"
          aria-label={`Default category for ${p.name}`}
          className={SELECT}
          disabled={update.isPending}
          onChange={(id) => {
            const cat = id === null ? null : groups.flatMap((g) => g.categories).find((c) => c.id === id);
            save({ defaultCategoryId: id }, id === null ? `"${p.name}" has no default category now.` : `New "${p.name}" transactions default to ${cat?.name ?? 'that category'}.`);
          }}
        />
      </div>

      <div className="hidden text-sm md:block">
        {p.usageCount > 0 ? (
          <Link to={`/transactions?payee=${p.id}`} className="font-medium tabular-nums hover:text-accent hover:underline" title="See its transactions">
            {p.usageCount.toLocaleString(locale)} used
          </Link>
        ) : (
          <span className="text-muted">Not used</span>
        )}
        <p className="text-xs text-muted">{p.lastUsed ? `Last ${relativeDay(p.lastUsed, today, locale)}` : '—'}</p>
      </div>

      <div className="col-start-3 row-start-1 flex justify-end gap-0.5 md:col-start-auto md:row-start-auto">
        {confirmDelete ? (
          <span className="inline-flex items-center gap-1 rounded-xl border border-expense/30 bg-expense/10 p-1 text-xs">
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(p.id, {
                  onSuccess: () => onMessage('success', `Deleted "${p.name}".`),
                  onError: (err) => {
                    setConfirmDelete(false);
                    fail(err);
                  },
                })
              }
              className="h-7 rounded-lg bg-expense px-2.5 font-semibold text-white disabled:opacity-60"
            >
              Delete
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="h-7 rounded-lg px-2 font-semibold text-muted hover:text-fg">
              Keep
            </button>
          </span>
        ) : (
          <>
            {p.usageCount > 0 && (
              <span className="md:hidden">
                <Link
                  to={`/transactions?payee=${p.id}`}
                  aria-label={`See ${p.name} transactions`}
                  className="grid size-9 place-items-center rounded-xl text-muted hover:bg-subtle hover:text-fg"
                >
                  <ListFilter className="size-4" aria-hidden />
                </Link>
              </span>
            )}
            <span className="hidden sm:inline">
              <IconButton label={`Rename ${p.name}`} onClick={() => setEditing(true)}>
                <Pencil className="size-4" aria-hidden />
              </IconButton>
            </span>
            <IconButton label={`Merge ${p.name} into another payee`} onClick={() => onMerge(p)}>
              <Combine className="size-4" aria-hidden />
            </IconButton>
            <IconButton
              label={p.archived ? `Unarchive ${p.name}` : `Archive ${p.name}`}
              disabled={update.isPending}
              onClick={() =>
                save(
                  { archived: !p.archived },
                  p.archived ? `"${p.name}" is back in your payee lists.` : `Archived "${p.name}". It's hidden from pickers; old transactions keep it.`,
                )
              }
            >
              {p.archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
            </IconButton>
            <IconButton
              label={deletable ? `Delete ${p.name}` : `${p.name} is in use: merge or archive it instead`}
              tone="danger"
              disabled={!deletable}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
          </>
        )}
      </div>
    </li>
  );
}
