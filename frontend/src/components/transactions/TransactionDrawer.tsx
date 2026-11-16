import { Lock, Split, Trash2 } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { useCreateTransaction, useDeleteTransaction, useUpdateTransaction } from '../../hooks/useTransactions';
import { ApiError } from '../../lib/api';
import { formatMoney, localToday, type MoneyFormat } from '../../lib/format';
import { parseMoney, toInputValue } from '../../lib/money';
import type { Account, CategoryGroupNode, Payee, Transaction, TransactionInput } from '../../types/api';
import { CONTROL, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';
import { Drawer } from '../ui/Drawer';
import { AccountSelect, CategorySelect, categoryIndex } from './pickers';
import { newSplit, partText, signedParts, SplitEditor, splitProblem, type SplitDraft } from './SplitEditor';

type Kind = 'expense' | 'income';

interface FormState {
  kind: Kind;
  amountText: string;
  date: string;
  accountId: number | null;
  payee: string;
  categoryId: number | null;
  notes: string;
  cleared: boolean;
  splits: SplitDraft[] | null;
}

type Errors = Partial<Record<'amount' | 'date' | 'account' | 'payee' | 'notes' | 'splits' | 'form', string>>;

function initialState(tx: Transaction | null, defaults: { accountId: number | null; date?: string; kind?: Kind }): FormState {
  if (!tx) {
    return {
      kind: defaults.kind ?? 'expense', amountText: '', date: defaults.date ?? localToday(), accountId: defaults.accountId,
      payee: '', categoryId: null, notes: '', cleared: false, splits: null,
    };
  }
  const sign = tx.amountMinor < 0 ? -1 : 1;
  return {
    kind: sign < 0 ? 'expense' : 'income',
    amountText: toInputValue(Math.abs(tx.amountMinor)),
    date: tx.date,
    accountId: tx.accountId,
    payee: tx.payee,
    categoryId: tx.categoryId,
    notes: tx.notes ?? '',
    cleared: tx.cleared,
    splits: tx.isSplit
      ? tx.splits.map((s) => newSplit({ categoryId: s.categoryId, amountText: partText(s.amountMinor, sign), notes: s.notes ?? '' }))
      : null,
  };
}

const KIND_BTN = 'relative flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed';

/**
 * Add or edit one transaction (POST /api/transactions, PATCH /api/transactions/:id),
 * including splitting it across categories.
 */
export function TransactionDrawer({
  transaction,
  accounts,
  groups,
  payees,
  defaultAccountId,
  fmt,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** null = new transaction. */
  transaction: Transaction | null;
  accounts: Account[];
  groups: CategoryGroupNode[];
  payees: Payee[];
  defaultAccountId: number | null;
  fmt: MoneyFormat;
  onClose: () => void;
  onSaved: (message: string, detail?: string) => void;
  onDeleted: (message: string) => void;
}) {
  const isNew = transaction === null;
  const locked = !!transaction?.reconciled;
  const create = useCreateTransaction();
  const update = useUpdateTransaction();
  const remove = useDeleteTransaction();

  const [form, setForm] = useState<FormState>(() => initialState(transaction, { accountId: defaultAccountId }));
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addAnother, setAddAnother] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const payeeRef = useRef<HTMLInputElement>(null);
  const ids = { amount: useId(), date: useId(), account: useId(), payee: useId(), cat: useId(), notes: useId(), cleared: useId(), list: useId() };

  const cats = useMemo(() => categoryIndex(groups), [groups]);
  const payeeByName = useMemo(() => new Map(payees.map((p) => [p.name.toLowerCase(), p])), [payees]);
  const sign: 1 | -1 = form.kind === 'income' ? 1 : -1;
  const parsedAmount = parseMoney(form.amountText);
  const signedAmount = parsedAmount === null || parsedAmount === 0 ? null : sign * parsedAmount;
  const pending = create.isPending || update.isPending || remove.isPending;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (Object.keys(e).length ? {} : e));
  };

  /** A known payee with a default category fills the category while it is still empty. */
  function onPayeeCommit(name: string) {
    const hit = payeeByName.get(name.trim().toLowerCase());
    if (!hit || !hit.defaultCategoryId || form.splits || form.categoryId !== null || !cats.has(hit.defaultCategoryId)) return;
    const c = cats.get(hit.defaultCategoryId)!;
    setForm((f) => ({ ...f, categoryId: hit.defaultCategoryId, kind: c.isIncome ? 'income' : f.kind }));
  }

  function onCategory(id: number | null) {
    // Picking an income category on an expense is almost always a slip: switch to Income.
    // (A positive amount in an expense category is a refund, so the other way round is left alone.)
    setForm((f) => ({ ...f, categoryId: id, kind: id !== null && cats.get(id)?.isIncome ? 'income' : f.kind }));
  }

  function startSplit() {
    const amount = parsedAmount && parsedAmount > 0 ? toInputValue(parsedAmount) : '';
    set('splits', [newSplit({ categoryId: form.categoryId, amountText: amount }), newSplit()]);
  }

  function unsplit() {
    const first = form.splits?.find((s) => s.categoryId !== null)?.categoryId ?? null;
    setForm((f) => ({ ...f, splits: null, categoryId: first }));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (!locked) {
      if (parsedAmount === null || parsedAmount === 0) e.amount = 'Enter an amount like 450 or 1,250.50.';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) e.date = 'Pick a date.';
      if (form.accountId === null) e.account = 'Pick an account.';
    }
    if (form.payee.trim().length > 60) e.payee = 'Payee must be 60 characters or fewer.';
    if (form.notes.trim().length > 200) e.notes = 'Notes must be 200 characters or fewer.';
    if (form.splits) {
      const p = splitProblem(form.splits, signedAmount, sign);
      if (p) e.splits = p;
    }
    return e;
  }

  function buildInput(): TransactionInput {
    const input: TransactionInput = {
      accountId: form.accountId!,
      date: form.date,
      amountMinor: signedAmount!,
      payee: form.payee.trim(),
      notes: form.notes.trim(),
      cleared: form.cleared,
    };
    if (form.splits) {
      const amounts = signedParts(form.splits, sign) as number[];
      input.splits = form.splits.map((s, i) => ({ categoryId: s.categoryId, amountMinor: amounts[i], notes: s.notes.trim() }));
    } else {
      input.categoryId = form.categoryId;
      if (transaction?.isSplit) input.splits = null; // was split → turn it back into one category
    }
    return input;
  }

  function fail(err: unknown) {
    setErrors({ form: err instanceof ApiError ? err.message : 'Could not save. Please try again.' });
  }

  function submit() {
    if (pending) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      if (e.amount) amountRef.current?.focus();
      return;
    }
    const input = buildInput();
    const label = `${formatMoney(input.amountMinor, fmt, { signed: true })}${input.payee ? ` · ${input.payee}` : ''}`;

    if (isNew) {
      create.mutate(input, {
        onSuccess: ({ rulesApplied }) => {
          const detail = rulesApplied.length ? `Rules applied: ${rulesApplied.map((r) => r.name).join(', ')}` : undefined;
          onSaved(`Added ${label}.`, detail);
          if (addAnother) {
            // Keep account, date and direction for the next one.
            setForm((f) => ({ ...initialState(null, { accountId: f.accountId, date: f.date, kind: f.kind }) }));
            setErrors({});
            requestAnimationFrame(() => payeeRef.current?.focus());
          } else onClose();
        },
        onError: fail,
      });
    } else {
      // Locked (reconciled): the server refuses changes to these, so only send what may change.
      const patch: Partial<TransactionInput> = { ...input };
      if (locked) {
        delete patch.accountId;
        delete patch.date;
        delete patch.amountMinor;
        delete patch.cleared;
      }
      update.mutate(
        { id: transaction.id, patch },
        {
          onSuccess: () => {
            onSaved(`Saved ${label}.`);
            onClose();
          },
          onError: fail,
        },
      );
    }
  }

  function doDelete() {
    if (!transaction) return;
    remove.mutate(transaction.id, {
      onSuccess: () => {
        onDeleted(`Deleted ${formatMoney(transaction.amountMinor, fmt, { signed: true })}${transaction.payee ? ` · ${transaction.payee}` : ''}.`);
        onClose();
      },
      onError: (err) => {
        setConfirmDelete(false);
        fail(err);
      },
    });
  }

  const payeeOptions = payees.filter((p) => !p.archived).slice(0, 400);

  return (
    <Drawer
      title={isNew ? 'Add transaction' : 'Edit transaction'}
      description={isNew ? 'Ctrl + Enter saves.' : `${transaction.accountName} · ${transaction.date}`}
      onClose={onClose}
      onSubmit={submit}
      width="lg"
      footer={
        <>
          {!isNew && (
            <div className="mr-auto">
              {confirmDelete ? (
                <span className="flex items-center gap-2">
                  <PrimaryButton type="button" tone="danger" pending={remove.isPending} onClick={doDelete}>
                    Delete it
                  </PrimaryButton>
                  <GhostButton onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
                    Keep
                  </GhostButton>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={locked || pending}
                  title={locked ? 'Reconciled transactions cannot be deleted' : undefined}
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-expense hover:bg-expense/10 disabled:opacity-40"
                >
                  <Trash2 className="size-4" aria-hidden /> Delete
                </button>
              )}
            </div>
          )}
          {isNew && (
            <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={addAnother} onChange={(e) => setAddAnother(e.target.checked)} className="size-4 accent-[var(--sw-accent)]" />
              Add another after saving
            </label>
          )}
          <GhostButton onClick={onClose} disabled={pending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? 'Saving…' : isNew ? 'Add' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form && (
          <p role="alert" className="rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
            {errors.form}
          </p>
        )}
        {locked && (
          <p className="flex items-start gap-2.5 rounded-xl border border-line bg-subtle px-3.5 py-2.5 text-sm text-muted">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            Reconciled: amount, date, account and cleared status are locked. Category, payee, notes and splits can still change.
          </p>
        )}

        <div role="group" aria-label="Direction" className="flex rounded-xl bg-subtle p-1">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              type="button"
              disabled={locked}
              aria-pressed={form.kind === k}
              onClick={() => set('kind', k)}
              className={`${KIND_BTN} ${
                form.kind === k ? (k === 'expense' ? 'bg-expense text-white shadow-sm' : 'bg-income text-[#04301f] shadow-sm') : 'text-muted hover:text-fg'
              }`}
            >
              {k === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField label="Amount" htmlFor={ids.amount} error={errors.amount}>
            <input
              ref={amountRef}
              id={ids.amount}
              className={`${CONTROL} text-right text-base font-semibold tabular-nums`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={form.amountText}
              disabled={locked}
              onChange={(e) => set('amountText', e.target.value)}
              aria-invalid={errors.amount ? true : undefined}
              autoFocus={isNew}
            />
          </DialogField>
          <DialogField label="Date" htmlFor={ids.date} error={errors.date}>
            <input
              id={ids.date}
              type="date"
              className={CONTROL}
              value={form.date}
              disabled={locked}
              onChange={(e) => set('date', e.target.value)}
              aria-invalid={errors.date ? true : undefined}
            />
          </DialogField>
        </div>

        <DialogField label="Account" htmlFor={ids.account} error={errors.account}>
          <AccountSelect
            id={ids.account}
            accounts={accounts}
            value={form.accountId}
            onChange={(id) => set('accountId', id)}
            keep={transaction?.accountId}
            disabled={locked}
          />
        </DialogField>

        <DialogField label="Payee" htmlFor={ids.payee} error={errors.payee}>
          <input
            ref={payeeRef}
            id={ids.payee}
            list={ids.list}
            className={CONTROL}
            maxLength={60}
            autoComplete="off"
            placeholder="e.g. Swiggy, Landlord, Employer"
            value={form.payee}
            onChange={(e) => set('payee', e.target.value)}
            onBlur={(e) => onPayeeCommit(e.target.value)}
            autoFocus={!isNew}
          />
          <datalist id={ids.list}>
            {payeeOptions.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </DialogField>

        {form.splits ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Split across categories</span>
              <button type="button" onClick={unsplit} className="text-xs font-semibold text-accent hover:underline">
                Use one category
              </button>
            </div>
            <SplitEditor
              parts={form.splits}
              onChange={(parts) => set('splits', parts)}
              totalMinor={signedAmount}
              sign={sign}
              groups={groups}
              fmt={fmt}
              error={errors.splits}
            />
          </div>
        ) : (
          <DialogField label="Category" htmlFor={ids.cat}>
            <div className="flex gap-2">
              <CategorySelect id={ids.cat} groups={groups} value={form.categoryId} onChange={onCategory} keep={form.categoryId} />
              <button
                type="button"
                onClick={startSplit}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-medium hover:bg-subtle"
                title="Split this transaction across several categories"
              >
                <Split className="size-4" aria-hidden /> Split
              </button>
            </div>
          </DialogField>
        )}

        <DialogField label="Notes" htmlFor={ids.notes} error={errors.notes}>
          <textarea
            id={ids.notes}
            rows={2}
            maxLength={200}
            className={`${CONTROL} h-auto py-2.5`}
            placeholder="Optional"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </DialogField>

        <label htmlFor={ids.cleared} className={`flex items-center gap-3 text-sm ${locked ? 'opacity-60' : 'cursor-pointer'}`}>
          <input
            id={ids.cleared}
            type="checkbox"
            checked={form.cleared}
            disabled={locked}
            onChange={(e) => set('cleared', e.target.checked)}
            className="size-4 accent-[var(--sw-accent)]"
          />
          Cleared (it shows on your bank statement)
        </label>
      </div>
    </Drawer>
  );
}
