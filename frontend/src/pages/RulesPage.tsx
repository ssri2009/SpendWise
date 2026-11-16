import { motion } from 'framer-motion';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, CircleStop, FlaskConical, Info, Pencil, Plus, RefreshCw, Trash2, Workflow } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, ErrorState, rise, Skeleton, stagger } from '../components/dashboard/ui';
import { ReapplyDrawer } from '../components/rules/ReapplyDrawer';
import { RuleEditor } from '../components/rules/RuleEditor';
import { IconButton } from '../components/schedules/parts';
import { useToast } from '../components/ui/Toast';
import { useMoneyFormat } from '../hooks/useDashboard';
import { useDeleteRule, useReorderRules, useRules, useUpdateRule } from '../hooks/useRules';
import { useAccountList, useCategoryTree, usePayees } from '../hooks/useTransactions';
import { ApiError } from '../lib/api';
import type { MoneyFormat } from '../lib/format';
import { describeAction, describeCondition, type Names } from '../lib/rules';
import type { Rule } from '../types/rules';

const isTyping = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
  if (t.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes((t as HTMLInputElement).type);
};

/** On/off switch (a checkbox with role="switch"). */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center" title={checked ? 'On' : 'Off'}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="h-6 w-10 rounded-full bg-subtle ring-1 ring-line transition-colors peer-checked:bg-accent peer-focus-visible:ring-4 peer-focus-visible:ring-accent/25" />
      <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-elevated shadow transition-transform peer-checked:translate-x-4" />
    </label>
  );
}

/**
 * Rules (server/routes/rules.js): automatic categories, payee clean-up, notes and cleared flags for new and
 * imported transactions. Order matters, so rules can be moved up and down; "Re-apply" runs them over
 * existing transactions after a preview.
 */
export default function RulesPage() {
  const fmt = useMoneyFormat();
  const toast = useToast();
  const rulesQ = useRules();
  const accountsQ = useAccountList();
  const groupsQ = useCategoryTree();
  const payeesQ = usePayees();
  const update = useUpdateRule();
  const remove = useDeleteRule();
  const reorder = useReorderRules();

  const [editing, setEditing] = useState<{ rule: Rule | null } | null>(null);
  const [reapply, setReapply] = useState<{ ruleId: number | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [howOpen, setHowOpen] = useState(false);

  const rules = useMemo(() => rulesQ.data?.rules ?? [], [rulesQ.data]);
  const max = rulesQ.data?.maxRules ?? 200;
  const accounts = accountsQ.data?.accounts ?? [];
  const groups = groupsQ.data ?? [];
  const payees = payeesQ.data ?? [];
  const ready = !groupsQ.isPending && !payeesQ.isPending && !accountsQ.isPending;

  const names: Names = useMemo(() => {
    const p = new Map(payees.map((x) => [x.id, x.name]));
    const c = new Map(groups.flatMap((g) => g.categories).map((x) => [x.id, `${x.icon} ${x.name}`.trim()]));
    const a = new Map(accounts.map((x) => [x.id, x.name]));
    return { payee: (id) => p.get(id), category: (id) => c.get(id), account: (id) => a.get(id) };
  }, [payees, groups, accounts]);

  const fail = useCallback((err: unknown) => toast.error(err instanceof ApiError ? err.message : 'That did not work. Please try again.'), [toast]);

  function move(rule: Rule, by: -1 | 1) {
    const ids = rules.map((r) => r.id);
    const i = ids.indexOf(rule.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids, {
      onError: fail,
      // Keep focus on the rule that moved: the same arrow, or the other one if it reached the top / bottom.
      onSuccess: () =>
        requestAnimationFrame(() => {
          const same = document.getElementById(`rule-${rule.id}-${by < 0 ? 'up' : 'down'}`) as HTMLButtonElement | null;
          const other = document.getElementById(`rule-${rule.id}-${by < 0 ? 'down' : 'up'}`) as HTMLButtonElement | null;
          (same && !same.disabled ? same : other)?.focus();
        }),
    });
  }

  const newRule = useCallback(() => {
    if (ready && rules.length < max) setEditing({ rule: null });
  }, [ready, rules.length, max]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        newRule();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newRule]);

  const enabled = rules.filter((r) => r.enabled).length;
  const broken = rules.filter((r) => r.problems.length).length;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-24">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Categorise, clean up and tag new transactions automatically</p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">
            {rulesQ.data ? `${rules.length} rule${rules.length === 1 ? '' : 's'}` : 'Rules'}
            {rulesQ.data && rules.length > 0 && <span className="ml-2 text-sm font-medium text-muted">{enabled} on</span>}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setReapply({ ruleId: null })}
            disabled={!rules.length || !ready}
            className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium transition-colors hover:border-accent/60 hover:bg-subtle disabled:opacity-50"
          >
            <RefreshCw className="size-4 text-muted" aria-hidden /> Re-apply to existing
          </button>
          <button
            type="button"
            onClick={newRule}
            disabled={!ready || rules.length >= max}
            title={rules.length >= max ? `You can have at most ${max} rules.` : undefined}
            className="inline-flex h-11 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            <Plus className="size-4" aria-hidden /> New rule
            <kbd className="hidden rounded bg-white/20 px-1.5 text-[10px] sm:inline">N</kbd>
          </button>
        </div>
      </motion.div>

      <motion.section variants={rise} className="glass rounded-2xl border border-line shadow-glass">
        <button
          type="button"
          aria-expanded={howOpen}
          onClick={() => setHowOpen((o) => !o)}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold"
        >
          <Info className="size-4 text-accent" aria-hidden /> How rules run
          <ChevronDown className={`ml-auto size-4 text-muted transition-transform ${howOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {howOpen && (
          <ol className="list-decimal space-y-1 px-4 pb-4 pl-9 text-sm text-muted">
            <li>Rules run when a transaction is added or imported, top to bottom. Editing a transaction never runs them.</li>
            <li>Every rule that matches runs, not just the first, and each sees what the ones above it changed.</li>
            <li>For category, payee and cleared, the last matching rule wins. Notes add up.</li>
            <li>"Stop after this rule" ends the run when that rule matches.</li>
            <li>To change transactions you already have, use Re-apply: it shows every change before saving.</li>
          </ol>
        )}
      </motion.section>

      {broken > 0 && (
        <motion.p variants={rise} role="status" className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {broken} rule{broken === 1 ? ' points' : 's point'} at something that was deleted. Edit {broken === 1 ? 'it' : 'them'} to fix the marked parts.
        </motion.p>
      )}

      <motion.section variants={rise} aria-label="Rules in the order they run" className="glass rounded-3xl border border-line p-3 shadow-glass sm:p-5">
        {rulesQ.isPending ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : rulesQ.isError ? (
          <ErrorState error={rulesQ.error} onRetry={() => void rulesQ.refetch()} />
        ) : rules.length === 0 ? (
          <EmptyState icon={Workflow} title="No rules yet">
            <p>For example: if the payee contains "swiggy", set the category to Food and rename the payee to Swiggy.</p>
            <button type="button" onClick={newRule} disabled={!ready} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg">
              <Plus className="size-4" aria-hidden /> Create your first rule
            </button>
          </EmptyState>
        ) : (
          <ol className="space-y-2">
            {rules.map((r, i) => (
              <RuleCard
                key={r.id}
                r={r}
                first={i === 0}
                last={i === rules.length - 1}
                names={names}
                fmt={fmt}
                busy={reorder.isPending}
                confirming={confirmDelete === r.id}
                onToggle={(on) =>
                  update.mutate(
                    { id: r.id, patch: { enabled: on } },
                    { onSuccess: () => toast.success(`"${r.name}" is ${on ? 'on' : 'off'}.`), onError: fail },
                  )
                }
                onMove={(by) => move(r, by)}
                onEdit={() => setEditing({ rule: r })}
                onTry={() => setReapply({ ruleId: r.id })}
                onAskDelete={() => setConfirmDelete(r.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                onDelete={() =>
                  remove.mutate(r.id, {
                    onSuccess: () => toast.success(`Deleted "${r.name}". Transactions it already changed stay as they are.`),
                    onError: fail,
                    onSettled: () => setConfirmDelete(null),
                  })
                }
              />
            ))}
          </ol>
        )}
      </motion.section>

      {editing && (
        <RuleEditor
          key={editing.rule?.id ?? 'new'}
          rule={editing.rule}
          accounts={accounts}
          groups={groups}
          payees={payees}
          fmt={fmt}
          onClose={() => setEditing(null)}
          onSaved={(rule, isNew) => toast.success(isNew ? `Created "${rule.name}". It runs on new transactions from now on.` : `Saved "${rule.name}".`)}
        />
      )}
      {reapply && (
        <ReapplyDrawer
          rules={rules}
          accounts={accounts}
          initialRuleId={reapply.ruleId}
          locale={fmt.locale}
          onClose={() => setReapply(null)}
          onApplied={(text) => toast.success(text)}
        />
      )}
    </motion.div>
  );
}

function RuleCard({
  r,
  first,
  last,
  names,
  fmt,
  busy,
  confirming,
  onToggle,
  onMove,
  onEdit,
  onTry,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  r: Rule;
  first: boolean;
  last: boolean;
  names: Names;
  fmt: MoneyFormat;
  busy: boolean;
  confirming: boolean;
  onToggle: (on: boolean) => void;
  onMove: (by: -1 | 1) => void;
  onEdit: () => void;
  onTry: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const joiner = r.matchMode === 'any' ? ' or ' : ' and ';
  return (
    <li
      id={`rule-row-${r.id}`}
      aria-label={`Rule ${r.position}: ${r.name}${r.enabled ? '' : ' (off)'}`}
      className={`flex flex-wrap items-start gap-3 rounded-2xl border border-line p-3 sm:flex-nowrap sm:p-4 ${r.enabled ? 'bg-surface' : 'bg-subtle/50'}`}
    >
      <div className="flex shrink-0 flex-col items-center gap-0.5">
        <button
          id={`rule-${r.id}-up`}
          type="button"
          aria-label={`Move ${r.name} up`}
          disabled={first || busy}
          onClick={() => onMove(-1)}
          className="grid size-7 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg disabled:opacity-25"
        >
          <ArrowUp className="size-3.5" aria-hidden />
        </button>
        <span className="grid size-7 place-items-center rounded-lg bg-accent/12 text-xs font-bold tabular-nums text-accent" title="Runs in this order">
          {r.position}
        </span>
        <button
          id={`rule-${r.id}-down`}
          type="button"
          aria-label={`Move ${r.name} down`}
          disabled={last || busy}
          onClick={() => onMove(1)}
          className="grid size-7 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg disabled:opacity-25"
        >
          <ArrowDown className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className={`min-w-0 flex-1 ${r.enabled ? '' : 'opacity-60'}`}>
        <p className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onEdit} className="truncate text-left font-semibold hover:text-accent">
            {r.name}
          </button>
          {!r.enabled && <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted">Off</span>}
          {r.stopAfter && (
            <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-muted">
              <CircleStop className="size-3" aria-hidden /> Stops here
            </span>
          )}
        </p>
        <p className="mt-1 text-sm">
          <span className="font-semibold text-muted">If </span>
          {r.conditions.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="font-semibold text-muted">{joiner}</span>}
              {describeCondition(c, names, fmt)}
            </span>
          ))}
        </p>
        <p className="mt-0.5 text-sm">
          <span className="font-semibold text-muted">Then </span>
          {r.actions.map((a, i) => (
            <span key={i}>
              {i > 0 && <span className="text-muted">, </span>}
              <span className="font-medium">{describeAction(a, names)}</span>
            </span>
          ))}
        </p>
        {r.problems.map((p) => (
          <p key={p} className="mt-1 flex items-start gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden /> {p}
          </p>
        ))}
      </div>

      <div className="flex w-full items-center justify-end gap-1 sm:w-auto">
        {confirming ? (
          <span className="inline-flex items-center gap-1 rounded-xl border border-expense/30 bg-expense/10 p-1 text-xs">
            <span className="px-1.5">Delete this rule?</span>
            <button type="button" onClick={onDelete} className="h-7 rounded-lg bg-expense px-2.5 font-semibold text-white">
              Delete
            </button>
            <button type="button" onClick={onCancelDelete} className="h-7 rounded-lg px-2 font-semibold text-muted hover:text-fg">
              Keep
            </button>
          </span>
        ) : (
          <>
            <Switch checked={r.enabled} onChange={onToggle} label={`${r.name} is on`} />
            <IconButton label={`Try ${r.name} on existing transactions`} onClick={onTry}>
              <FlaskConical className="size-4" aria-hidden />
            </IconButton>
            <IconButton label={`Edit ${r.name}`} onClick={onEdit}>
              <Pencil className="size-4" aria-hidden />
            </IconButton>
            <IconButton label={`Delete ${r.name}`} tone="danger" onClick={onAskDelete}>
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
          </>
        )}
      </div>
    </li>
  );
}
