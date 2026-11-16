import { ArrowRight, Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useCreatePayee, useMergePayees } from '../../hooks/usePayeeAdmin';
import { ApiError } from '../../lib/api';
import type { CategoryGroupNode, Payee } from '../../types/api';
import { CategorySelect } from '../transactions/pickers';
import { CONTROL, Dialog, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';

const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : err instanceof Error && err.message ? err.message : fallback);

/** POST /api/payees: a name (unique, any capitals) and an optional default category. */
export function NewPayeeDialog({
  groups,
  onClose,
  onCreated,
}: {
  groups: CategoryGroupNode[];
  onClose: () => void;
  onCreated: (p: Payee) => void;
}) {
  const create = useCreatePayee();
  const [name, setName] = useState('');
  const [cat, setCat] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = { name: useId(), cat: useId() };

  function submit() {
    if (create.isPending) return;
    const n = name.trim();
    if (!n) return setProblem('Give the payee a name.');
    if (n.length > 60) return setProblem('Name must be 60 characters or fewer.');
    setProblem(null);
    create.mutate(
      { name: n, defaultCategoryId: cat },
      {
        onSuccess: (r) => {
          onCreated(r.payee);
          onClose();
        },
        onError: (err) => setProblem(errText(err, 'Could not add the payee.')),
      },
    );
  }

  return (
    <Dialog
      title="New payee"
      description="Someone you pay or who pays you. A default category fills itself in on new transactions."
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={create.isPending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={create.isPending}>Add payee</PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        <DialogField label="Name" htmlFor={ids.name} error={problem}>
          <input
            id={ids.name}
            className={CONTROL}
            maxLength={60}
            autoComplete="off"
            placeholder="e.g. Swiggy, Landlord, Employer"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setProblem(null);
            }}
            aria-invalid={problem ? true : undefined}
            autoFocus
          />
        </DialogField>
        <DialogField label="Default category" htmlFor={ids.cat} hint="Optional">
          <CategorySelect id={ids.cat} groups={groups} value={cat} onChange={setCat} noneLabel="No default" />
        </DialogField>
      </div>
    </Dialog>
  );
}

/**
 * Merge one or more payees into another (POST /api/payees/:id/merge for each). Their transactions, rules
 * and schedules move to the target, and they are removed.
 */
export function MergeDialog({
  sources,
  payees,
  suggestedTarget,
  onClose,
  onMerged,
}: {
  sources: Payee[];
  /** Every payee (the target can be any payee that isn't being merged). */
  payees: Payee[];
  suggestedTarget?: number | null;
  onClose: () => void;
  onMerged: (message: string) => void;
}) {
  const merge = useMergePayees();
  const sourceIds = useMemo(() => new Set(sources.map((s) => s.id)), [sources]);
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<number | null>(suggestedTarget ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const searchId = useId();

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return payees
      .filter((p) => !sourceIds.has(p.id) && (!needle || p.name.toLowerCase().includes(needle)))
      .slice(0, 50);
  }, [payees, sourceIds, q]);
  const targetPayee = payees.find((p) => p.id === target) ?? null;
  const moving = sources.reduce((n, s) => n + s.usageCount, 0);
  const names = sources.length === 1 ? `"${sources[0].name}"` : `${sources.length} payees`;

  function submit() {
    if (merge.isPending) return;
    if (!targetPayee) return setProblem('Pick the payee to keep.');
    setProblem(null);
    merge.mutate(
      { sourceIds: sources.map((s) => s.id), targetId: targetPayee.id },
      {
        onSuccess: (r) => {
          onMerged(`Merged ${names} into "${targetPayee.name}". ${r.moved} transaction${r.moved === 1 ? '' : 's'} moved.`);
          onClose();
        },
        onError: (err) => {
          const done = (err as { merged?: number }).merged ?? 0;
          setProblem(`${done ? `${done} merged, then: ` : ''}${errText(err, 'Could not merge.')}`);
        },
      },
    );
  }

  return (
    <Dialog
      title={`Merge ${names}`}
      description="Pick the payee to keep. Everything that used the others moves to it."
      onClose={onClose}
      onSubmit={submit}
      size="lg"
      footer={
        <>
          <GhostButton onClick={onClose} disabled={merge.isPending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={merge.isPending} disabled={!targetPayee}>
            Merge
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        {sources.length > 1 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Payees to merge">
            {sources.map((s) => (
              <li key={s.id} className="rounded-full bg-subtle px-2.5 py-1 text-xs font-medium">
                {s.name} <span className="text-muted">· {s.usageCount}</span>
              </li>
            ))}
          </ul>
        )}

        <div>
          <label htmlFor={searchId} className="mb-1.5 block text-sm font-medium">
            Keep this payee
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input id={searchId} className={`${CONTROL} pl-9`} placeholder="Search payees" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" autoFocus />
          </div>
          <div role="radiogroup" aria-label="Payee to keep" className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-line">
            {options.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted">No other payee matches.</p>
            ) : (
              options.map((p) => (
                <label key={p.id} className={`flex cursor-pointer items-center gap-3 border-b border-line px-3 py-2 text-sm last:border-b-0 ${p.id === target ? 'bg-accent/8' : 'hover:bg-subtle'}`}>
                  <input type="radio" name="sw-merge-target" checked={p.id === target} onChange={() => setTarget(p.id)} className="size-4 accent-[var(--sw-accent)]" />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  {p.archived && <span className="text-[11px] text-muted">archived</span>}
                  <span className="text-xs tabular-nums text-muted">{p.usageCount} used</span>
                </label>
              ))
            )}
          </div>
        </div>

        {targetPayee && (
          <p className="flex items-start gap-2 rounded-xl bg-subtle px-3.5 py-3 text-sm">
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <span>
              {moving} transaction{moving === 1 ? '' : 's'} move to <b>{targetPayee.name}</b>, along with any rules and schedules that use {sources.length === 1 ? 'it' : 'them'}.{' '}
              {targetPayee.defaultCategoryId === null && sources.some((s) => s.defaultCategoryId !== null) ? 'It takes over their default category. ' : ''}
              {sources.length === 1 ? `"${sources[0].name}" is` : 'They are'} then removed. This can't be undone.
            </span>
          </p>
        )}
        {problem && (
          <p role="alert" className="text-sm font-medium text-expense">
            {problem}
          </p>
        )}
      </div>
    </Dialog>
  );
}
