import { Check, FlaskConical, Plus, Trash2, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { useCreateRule, useUpdateRule } from '../../hooks/useRules';
import { api, ApiError } from '../../lib/api';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import { parseMoney, toInputValue } from '../../lib/money';
import { tryRule, type Names } from '../../lib/rules';
import type { Account, CategoryGroupNode, Payee } from '../../types/api';
import { MAX_ACTIONS, MAX_CONDITIONS, type AmountDirection, type Rule, type RuleAction, type RuleCondition, type RuleInput } from '../../types/rules';
import { AccountSelect, CategorySelect } from '../transactions/pickers';
import { CONTROL, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';
import { Drawer } from '../ui/Drawer';

/* ---------- drafts: what the form edits (payees by NAME, so a new one can be typed) ---------- */

type CondType = RuleCondition['type'];
type ActType = RuleAction['type'];

type CondDraft =
  | { key: number; type: 'description_contains'; value: string }
  | { key: number; type: 'payee_equals'; payee: string }
  | { key: number; type: 'amount_gt' | 'amount_lt'; amount: string; direction: AmountDirection }
  | { key: number; type: 'account_equals'; accountId: number | null };

type ActDraft =
  | { key: number; type: 'set_category'; categoryId: number | null }
  | { key: number; type: 'set_payee'; payee: string }
  | { key: number; type: 'add_note'; text: string }
  | { key: number; type: 'mark_cleared' };

const COND_TYPES: { id: CondType; label: string }[] = [
  { id: 'description_contains', label: 'Payee or notes contain' },
  { id: 'payee_equals', label: 'Payee is' },
  { id: 'amount_gt', label: 'Amount is over' },
  { id: 'amount_lt', label: 'Amount is under' },
  { id: 'account_equals', label: 'Account is' },
];
const ACT_TYPES: { id: ActType; label: string }[] = [
  { id: 'set_category', label: 'Set category' },
  { id: 'set_payee', label: 'Rename payee to' },
  { id: 'add_note', label: 'Add a note' },
  { id: 'mark_cleared', label: 'Mark as cleared' },
];

let seq = 1;
const nextKey = () => seq++;

function newCond(type: CondType, accounts: Account[]): CondDraft {
  const key = nextKey();
  switch (type) {
    case 'description_contains':
      return { key, type, value: '' };
    case 'payee_equals':
      return { key, type, payee: '' };
    case 'amount_gt':
    case 'amount_lt':
      return { key, type, amount: '', direction: 'expense' };
    case 'account_equals':
      return { key, type, accountId: accounts.find((a) => !a.closed)?.id ?? null };
  }
}

function newAct(type: ActType): ActDraft {
  const key = nextKey();
  switch (type) {
    case 'set_category':
      return { key, type, categoryId: null };
    case 'set_payee':
      return { key, type, payee: '' };
    case 'add_note':
      return { key, type, text: '' };
    case 'mark_cleared':
      return { key, type };
  }
}

function fromRule(r: Rule, payeeName: (id: number) => string): { conds: CondDraft[]; acts: ActDraft[] } {
  const conds = r.conditions.map((c): CondDraft => {
    const key = nextKey();
    switch (c.type) {
      case 'description_contains':
        return { key, type: c.type, value: c.value };
      case 'payee_equals':
        return { key, type: c.type, payee: payeeName(c.payeeId) };
      case 'amount_gt':
      case 'amount_lt':
        return { key, type: c.type, amount: toInputValue(c.valueMinor), direction: c.direction };
      case 'account_equals':
        return { key, type: c.type, accountId: c.accountId };
    }
  });
  const acts = r.actions.map((a): ActDraft => {
    const key = nextKey();
    switch (a.type) {
      case 'set_category':
        return { key, type: a.type, categoryId: a.categoryId };
      case 'set_payee':
        return { key, type: a.type, payee: payeeName(a.payeeId) };
      case 'add_note':
        return { key, type: a.type, text: a.text };
      case 'mark_cleared':
        return { key, type: a.type };
    }
  });
  return { conds, acts };
}

/** Form control without a fixed width: each use says how wide it is. */
const SMALL = CONTROL.replace('h-11', 'h-10').replace('w-full', '');

/**
 * Create (POST /api/rules) or edit (PATCH /api/rules/:id) a rule. Payees are typed by name: a name you
 * don't have yet is created as a payee when you save (rules can only point at payees that exist).
 */
export function RuleEditor({
  rule,
  accounts,
  groups,
  payees,
  fmt,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  accounts: Account[];
  groups: CategoryGroupNode[];
  payees: Payee[];
  fmt: MoneyFormat;
  onClose: () => void;
  onSaved: (rule: Rule, isNew: boolean) => void;
}) {
  const isNew = rule === null;
  const create = useCreateRule();
  const update = useUpdateRule();
  const payeeById = useMemo(() => new Map(payees.map((p) => [p.id, p.name])), [payees]);
  const payeeByName = useMemo(() => new Map(payees.map((p) => [p.name.toLowerCase(), p])), [payees]);
  const catName = useMemo(() => new Map(groups.flatMap((g) => g.categories).map((c) => [c.id, c.name])), [groups]);

  const initial = useMemo(
    () => (rule ? fromRule(rule, (id) => payeeById.get(id) ?? '') : { conds: [newCond('description_contains', accounts)], acts: [newAct('set_category')] }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [name, setName] = useState(rule?.name ?? '');
  const [matchMode, setMatchMode] = useState<'all' | 'any'>(rule?.matchMode ?? 'all');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [stopAfter, setStopAfter] = useState(rule?.stopAfter ?? false);
  const [conds, setConds] = useState<CondDraft[]>(initial.conds);
  const [acts, setActs] = useState<ActDraft[]>(initial.acts);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const ids = { name: useId(), list: useId(), stop: useId(), enabled: useId() };

  const setCond = (key: number, next: CondDraft) => setConds((l) => l.map((c) => (c.key === key ? next : c)));
  const setAct = (key: number, next: ActDraft) => setActs((l) => l.map((a) => (a.key === key ? next : a)));

  /** Payee names typed in the form that you don't have yet. */
  const newPayees = useMemo(() => {
    const names = [...conds.flatMap((c) => (c.type === 'payee_equals' ? [c.payee] : [])), ...acts.flatMap((a) => (a.type === 'set_payee' ? [a.payee] : []))]
      .map((s) => s.trim())
      .filter((s) => s && !payeeByName.has(s.toLowerCase()));
    return [...new Map(names.map((n) => [n.toLowerCase(), n])).values()];
  }, [conds, acts, payeeByName]);

  function problemOf(): string | null {
    if (!name.trim()) return 'Give the rule a name.';
    if (name.trim().length > 60) return 'The name must be 60 characters or fewer.';
    for (const [i, c] of conds.entries()) {
      const at = `Condition ${i + 1}`;
      if (c.type === 'description_contains' && !c.value.trim()) return `${at}: type the text to look for.`;
      if (c.type === 'description_contains' && c.value.trim().length > 100) return `${at}: 100 characters at most.`;
      if (c.type === 'payee_equals' && !c.payee.trim()) return `${at}: pick a payee.`;
      if ((c.type === 'amount_gt' || c.type === 'amount_lt') && parseMoney(c.amount) === null) return `${at}: enter an amount like 500.`;
      if (c.type === 'account_equals' && c.accountId === null) return `${at}: pick an account.`;
    }
    for (const [i, a] of acts.entries()) {
      const at = `Action ${i + 1}`;
      if (a.type === 'set_category' && a.categoryId === null) return `${at}: pick a category.`;
      if (a.type === 'set_payee' && !a.payee.trim()) return `${at}: type the payee name.`;
      if (a.type === 'add_note' && !a.text.trim()) return `${at}: type the note.`;
      if (a.type === 'add_note' && a.text.trim().length > 200) return `${at}: notes are 200 characters at most.`;
    }
    if (!conds.length) return 'Add at least one condition.';
    if (!acts.length) return 'Add at least one action.';
    return null;
  }

  async function payeeId(nameText: string, made: Map<string, number>): Promise<number> {
    const k = nameText.trim().toLowerCase();
    const hit = payeeByName.get(k);
    if (hit) return hit.id;
    if (made.has(k)) return made.get(k)!;
    const r = await api.post<{ payee: Payee }>('/api/payees', { name: nameText.trim() });
    made.set(k, r.payee.id);
    return r.payee.id;
  }

  async function submit() {
    if (saving) return;
    const p = problemOf();
    setProblem(p);
    if (p) {
      if (p.startsWith('Give')) nameRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const made = new Map<string, number>();
      const conditions: RuleCondition[] = [];
      for (const c of conds) {
        if (c.type === 'description_contains') conditions.push({ type: c.type, value: c.value.trim() });
        else if (c.type === 'payee_equals') conditions.push({ type: c.type, payeeId: await payeeId(c.payee, made) });
        else if (c.type === 'amount_gt' || c.type === 'amount_lt') conditions.push({ type: c.type, valueMinor: parseMoney(c.amount)!, direction: c.direction });
        else if (c.type === 'account_equals') conditions.push({ type: c.type, accountId: c.accountId! });
      }
      const actions: RuleAction[] = [];
      for (const a of acts) {
        if (a.type === 'set_category') actions.push({ type: a.type, categoryId: a.categoryId! });
        else if (a.type === 'set_payee') actions.push({ type: a.type, payeeId: await payeeId(a.payee, made) });
        else if (a.type === 'add_note') actions.push({ type: a.type, text: a.text.trim() });
        else actions.push({ type: a.type });
      }
      const input: RuleInput = { name: name.trim(), enabled, matchMode, stopAfter, conditions, actions };
      const r = isNew ? await create.mutateAsync(input) : await update.mutateAsync({ id: rule.id, patch: input });
      onSaved(r.rule, isNew);
      onClose();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : 'Could not save the rule. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const payeeOptions = payees.filter((p) => !p.archived).slice(0, 500);

  return (
    <Drawer
      title={isNew ? 'New rule' : 'Edit rule'}
      description="Runs on new and imported transactions. Ctrl + Enter saves."
      onClose={onClose}
      onSubmit={() => void submit()}
      width="lg"
      footer={
        <>
          <label htmlFor={ids.enabled} className="mr-auto flex cursor-pointer items-center gap-2 text-sm">
            <input id={ids.enabled} type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-[var(--sw-accent)]" />
            Enabled
          </label>
          <GhostButton onClick={onClose} disabled={saving}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={saving}>{saving ? 'Saving…' : isNew ? 'Create rule' : 'Save rule'}</PrimaryButton>
        </>
      }
    >
      <datalist id={ids.list}>
        {payeeOptions.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>

      <div className="space-y-5">
        {problem && (
          <p role="alert" className="rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
            {problem}
          </p>
        )}

        <DialogField label="Name" htmlFor={ids.name}>
          <input
            ref={nameRef}
            id={ids.name}
            className={CONTROL}
            maxLength={60}
            placeholder="e.g. Food delivery"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoComplete="off"
          />
        </DialogField>

        {/* ---------- if ---------- */}
        <fieldset className="space-y-3 rounded-2xl border border-line p-4">
          <legend className="px-1.5 text-sm font-semibold">If</legend>
          {conds.length > 1 && (
            <div role="group" aria-label="Match" className="flex w-fit rounded-xl bg-subtle p-1 text-xs">
              {(
                [
                  { id: 'all', label: 'All of these match' },
                  { id: 'any', label: 'Any of these matches' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={matchMode === m.id}
                  onClick={() => setMatchMode(m.id)}
                  className={`rounded-lg px-3 py-1.5 font-semibold ${matchMode === m.id ? 'bg-elevated text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <ol className="space-y-2">
            {conds.map((c, i) => (
              <li key={c.key} className="flex flex-wrap items-center gap-2 rounded-xl bg-subtle/60 p-2" aria-label={`Condition ${i + 1}`}>
                <select
                  aria-label={`Condition ${i + 1} type`}
                  className={`${SMALL} w-full sm:w-48`}
                  value={c.type}
                  onChange={(e) => setCond(c.key, { ...newCond(e.target.value as CondType, accounts), key: c.key })}
                >
                  {COND_TYPES.map((t) => (
                    <option key={t.id} value={t.id} className="bg-elevated text-fg">
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="flex min-w-40 flex-1 gap-2">
                  {c.type === 'description_contains' && (
                    <input aria-label={`Condition ${i + 1} text`} className={`${SMALL} min-w-0 flex-1`} maxLength={100} placeholder="e.g. swiggy" value={c.value} onChange={(e) => setCond(c.key, { ...c, value: e.target.value })} />
                  )}
                  {c.type === 'payee_equals' && (
                    <input aria-label={`Condition ${i + 1} payee`} className={`${SMALL} min-w-0 flex-1`} list={ids.list} maxLength={60} placeholder="Payee" value={c.payee} onChange={(e) => setCond(c.key, { ...c, payee: e.target.value })} />
                  )}
                  {(c.type === 'amount_gt' || c.type === 'amount_lt') && (
                    <>
                      <input
                        aria-label={`Condition ${i + 1} amount`}
                        className={`${SMALL} w-28 text-right tabular-nums`}
                        inputMode="decimal"
                        placeholder="500"
                        value={c.amount}
                        onChange={(e) => setCond(c.key, { ...c, amount: e.target.value })}
                      />
                      <select aria-label={`Condition ${i + 1} direction`} className={`${SMALL} min-w-0 flex-1`} value={c.direction} onChange={(e) => setCond(c.key, { ...c, direction: e.target.value as AmountDirection })}>
                        <option value="expense" className="bg-elevated text-fg">spending</option>
                        <option value="income" className="bg-elevated text-fg">income</option>
                        <option value="any" className="bg-elevated text-fg">either</option>
                      </select>
                    </>
                  )}
                  {c.type === 'account_equals' && (
                    <AccountSelect aria-label={`Condition ${i + 1} account`} accounts={accounts} includeClosed value={c.accountId} onChange={(id) => setCond(c.key, { ...c, accountId: id })} className={`${SMALL} min-w-0 flex-1`} />
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove condition ${i + 1}`}
                  disabled={conds.length === 1}
                  onClick={() => setConds((l) => l.filter((x) => x.key !== c.key))}
                  className="grid size-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-expense disabled:opacity-30"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
          {conds.length < MAX_CONDITIONS && (
            <button type="button" onClick={() => setConds((l) => [...l, newCond('description_contains', accounts)])} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
              <Plus className="size-4" aria-hidden /> Add condition
            </button>
          )}
        </fieldset>

        {/* ---------- then ---------- */}
        <fieldset className="space-y-3 rounded-2xl border border-line p-4">
          <legend className="px-1.5 text-sm font-semibold">Then</legend>
          <ol className="space-y-2">
            {acts.map((a, i) => (
              <li key={a.key} className="flex flex-wrap items-center gap-2 rounded-xl bg-subtle/60 p-2" aria-label={`Action ${i + 1}`}>
                <select aria-label={`Action ${i + 1} type`} className={`${SMALL} w-full sm:w-48`} value={a.type} onChange={(e) => setAct(a.key, { ...newAct(e.target.value as ActType), key: a.key })}>
                  {ACT_TYPES.map((t) => (
                    <option key={t.id} value={t.id} className="bg-elevated text-fg">
                      {t.label}
                    </option>
                  ))}
                </select>
                <div className="flex min-w-40 flex-1 gap-2">
                  {a.type === 'set_category' && (
                    <CategorySelect aria-label={`Action ${i + 1} category`} groups={groups} value={a.categoryId} keep={a.categoryId} noneLabel="Pick a category" onChange={(id) => setAct(a.key, { ...a, categoryId: id })} className={`${SMALL} min-w-0 flex-1`} />
                  )}
                  {a.type === 'set_payee' && (
                    <input aria-label={`Action ${i + 1} payee`} className={`${SMALL} min-w-0 flex-1`} list={ids.list} maxLength={60} placeholder="Clean payee name" value={a.payee} onChange={(e) => setAct(a.key, { ...a, payee: e.target.value })} />
                  )}
                  {a.type === 'add_note' && (
                    <input aria-label={`Action ${i + 1} note`} className={`${SMALL} min-w-0 flex-1`} maxLength={200} placeholder="e.g. #work" value={a.text} onChange={(e) => setAct(a.key, { ...a, text: e.target.value })} />
                  )}
                  {a.type === 'mark_cleared' && <span className="self-center text-sm text-muted">The transaction is marked cleared.</span>}
                </div>
                <button
                  type="button"
                  aria-label={`Remove action ${i + 1}`}
                  disabled={acts.length === 1}
                  onClick={() => setActs((l) => l.filter((x) => x.key !== a.key))}
                  className="grid size-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-expense disabled:opacity-30"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ol>
          {acts.length < MAX_ACTIONS && (
            <button type="button" onClick={() => setActs((l) => [...l, newAct('set_category')])} className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
              <Plus className="size-4" aria-hidden /> Add action
            </button>
          )}
          <label htmlFor={ids.stop} className="flex cursor-pointer items-start gap-2.5 border-t border-line pt-3 text-sm">
            <input id={ids.stop} type="checkbox" checked={stopAfter} onChange={(e) => setStopAfter(e.target.checked)} className="mt-0.5 size-4 accent-[var(--sw-accent)]" />
            <span>
              Stop after this rule
              <span className="block text-xs text-muted">When it matches, rules below it don't run.</span>
            </span>
          </label>
        </fieldset>

        {newPayees.length > 0 && (
          <p className="text-xs text-muted">
            New payee{newPayees.length === 1 ? '' : 's'} {newPayees.map((n) => `"${n}"`).join(', ')} will be created when you save.
          </p>
        )}

        <Tester
          matchMode={matchMode}
          conds={conds}
          acts={acts}
          accounts={accounts}
          payeeById={payeeById}
          catName={catName}
          fmt={fmt}
        />
      </div>
    </Drawer>
  );
}

/* ---------- "try it": run THIS rule (unsaved) on a made-up transaction ---------- */

function Tester({
  matchMode,
  conds,
  acts,
  accounts,
  payeeById,
  catName,
  fmt,
}: {
  matchMode: 'all' | 'any';
  conds: CondDraft[];
  acts: ActDraft[];
  accounts: Account[];
  payeeById: Map<number, string>;
  catName: Map<number, string>;
  fmt: MoneyFormat;
}) {
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [accountId, setAccountId] = useState<number | null>(accounts.find((a) => !a.closed)?.id ?? null);
  const parsed = parseMoney(amount);

  // Typed payee names get temporary negative ids, so the shared matcher can look them up like real ones.
  const result = useMemo(() => {
    if (!payee.trim() && parsed === null) return null;
    const temp = new Map<number, string>();
    const idFor = (name: string) => {
      const id = -(temp.size + 1);
      temp.set(id, name.trim());
      return id;
    };
    const names: Names = {
      payee: (id) => (id < 0 ? temp.get(id) : payeeById.get(id)),
      category: (id) => catName.get(id),
      account: (id) => accounts.find((a) => a.id === id)?.name,
    };
    const conditions: RuleCondition[] = conds.flatMap((c): RuleCondition[] => {
      if (c.type === 'description_contains') return c.value.trim() ? [{ type: c.type, value: c.value.trim() }] : [];
      if (c.type === 'payee_equals') return c.payee.trim() ? [{ type: c.type, payeeId: idFor(c.payee) }] : [];
      if (c.type === 'account_equals') return c.accountId !== null ? [{ type: c.type, accountId: c.accountId }] : [];
      const v = parseMoney(c.amount);
      return v !== null ? [{ type: c.type, valueMinor: v, direction: c.direction }] : [];
    });
    const actions: RuleAction[] = acts.flatMap((a): RuleAction[] => {
      if (a.type === 'set_category') return a.categoryId !== null ? [{ type: a.type, categoryId: a.categoryId }] : [];
      if (a.type === 'set_payee') return a.payee.trim() ? [{ type: a.type, payeeId: idFor(a.payee) }] : [];
      if (a.type === 'add_note') return a.text.trim() ? [{ type: a.type, text: a.text.trim() }] : [];
      return [{ type: 'mark_cleared' }];
    });
    const draft = { accountId, amountMinor: (kind === 'expense' ? -1 : 1) * (parsed ?? 0), payee: payee.trim(), notes: '', categoryId: null, cleared: false };
    const r = tryRule({ matchMode, conditions, actions }, draft, names);
    const changes: string[] = [];
    if (r.hit) {
      if (r.after.payee !== draft.payee) changes.push(`payee → ${r.after.payee}`);
      if (r.after.categoryId !== null) changes.push(`category → ${catName.get(r.after.categoryId)}`);
      if (r.after.notes) changes.push(`notes → "${r.after.notes}"`);
      if (r.after.cleared) changes.push('cleared');
    }
    return { hit: r.hit, changes };
  }, [payee, parsed, kind, accountId, matchMode, conds, acts, payeeById, catName, accounts]);

  return (
    <section aria-label="Try this rule" className="rounded-2xl border border-dashed border-line p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="size-4 text-accent" aria-hidden /> Try it
        <span className="font-normal text-muted">on a made-up transaction (nothing is saved)</span>
      </h3>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Test payee" className={`${SMALL} min-w-36 flex-1`} placeholder="Payee, e.g. SWIGGY ORDER 123" value={payee} onChange={(e) => setPayee(e.target.value)} />
        <select aria-label="Test direction" className={`${SMALL} w-auto`} value={kind} onChange={(e) => setKind(e.target.value as 'expense' | 'income')}>
          <option value="expense" className="bg-elevated text-fg">Spent</option>
          <option value="income" className="bg-elevated text-fg">Received</option>
        </select>
        <input aria-label="Test amount" className={`${SMALL} w-28 text-right tabular-nums`} inputMode="decimal" placeholder="450" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <AccountSelect aria-label="Test account" accounts={accounts} value={accountId} onChange={setAccountId} className={`${SMALL} w-auto`} />
      </div>
      {result && (
        <p role="status" className={`mt-3 flex items-start gap-2 text-sm ${result.hit ? 'text-income' : 'text-muted'}`}>
          {result.hit ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <span>
            {result.hit ? (
              <>
                <b>Matches.</b> {result.changes.length ? <span className="text-fg">{result.changes.join(' · ')}</span> : 'Nothing would change.'}
              </>
            ) : (
              <>
                <b>Doesn't match</b>
                {parsed !== null ? ` a ${formatMoney((kind === 'expense' ? -1 : 1) * parsed, fmt)} transaction` : ''}
                {payee.trim() ? ` from "${payee.trim()}"` : ''}.
              </>
            )}
          </span>
        </p>
      )}
    </section>
  );
}
