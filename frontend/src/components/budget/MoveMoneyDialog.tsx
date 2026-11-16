import { ArrowDown } from 'lucide-react';
import { useId, useState } from 'react';
import { useTransfer } from '../../hooks/useBudget';
import { ApiError } from '../../lib/api';
import { formatMoney, monthName, type MoneyFormat } from '../../lib/format';
import { parseMoney, toInputValue } from '../../lib/money';
import type { BudgetCategory } from '../../types/api';
import { CONTROL, Dialog, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';

export interface MoveIntent {
  fromId?: number;
  toId?: number;
}

/** Pick sensible defaults: cover an overspent target from the fullest envelope. */
function defaults(categories: BudgetCategory[], intent: MoveIntent) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const to = intent.toId ? byId.get(intent.toId) : undefined;
  let from = intent.fromId ? byId.get(intent.fromId) : undefined;
  if (!from) {
    from = categories
      .filter((c) => c.id !== to?.id && c.availableMinor > 0)
      .sort((a, b) => b.availableMinor - a.availableMinor)[0] ?? categories.find((c) => c.id !== to?.id);
  }
  const target = to ?? categories.find((c) => c.id !== from?.id);
  const suggested =
    target && target.availableMinor < 0 && from && from.availableMinor > 0 ? Math.min(-target.availableMinor, from.availableMinor) : 0;
  return { fromId: from?.id ?? 0, toId: target?.id ?? 0, amount: suggested ? toInputValue(suggested) : '' };
}

export function MoveMoneyDialog({
  month,
  categories,
  intent,
  fmt,
  onClose,
  onMoved,
}: {
  month: string;
  /** Budgetable categories, in grid order. */
  categories: BudgetCategory[];
  intent: MoveIntent;
  fmt: MoneyFormat;
  onClose: () => void;
  onMoved: (message: string) => void;
}) {
  const transfer = useTransfer(month);
  const [init] = useState(() => defaults(categories, intent));
  const [fromId, setFromId] = useState(init.fromId);
  const [toId, setToId] = useState(init.toId);
  const [amountText, setAmountText] = useState(init.amount);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ids = { from: useId(), to: useId(), amount: useId(), note: useId() };

  const from = categories.find((c) => c.id === fromId);
  const to = categories.find((c) => c.id === toId);
  const amount = amountText.trim() ? parseMoney(amountText) : null;
  const covering = !!(to && to.availableMinor < 0 && intent.toId === to.id);

  const option = (c: BudgetCategory) => (
    <option key={c.id} value={c.id} className="bg-elevated text-fg">
      {c.icon} {c.name} · {formatMoney(c.availableMinor, fmt)}
    </option>
  );

  function submit() {
    setError(null);
    if (!from || !to) return setError('Pick both categories.');
    if (from.id === to.id) return setError('Pick two different categories.');
    if (amount === null || amount <= 0) return setError('Enter an amount like 500 or 1,250.50.');
    if (amount > from.availableMinor) {
      return setError(
        from.availableMinor > 0 ? `Only ${formatMoney(from.availableMinor, fmt)} is available in ${from.name}.` : `${from.name} has nothing available to move.`,
      );
    }
    transfer.mutate(
      { fromCategoryId: from.id, toCategoryId: to.id, amountMinor: amount, note: note.trim() },
      {
        onSuccess: () => {
          onMoved(`Moved ${formatMoney(amount, fmt)} from ${from.name} to ${to.name}.`);
          onClose();
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not move the money. Please try again.'),
      },
    );
  }

  if (categories.length < 2) {
    return (
      <Dialog title="Move money" onClose={onClose} footer={<GhostButton onClick={onClose}>Close</GhostButton>}>
        <p className="text-sm text-muted">You need at least two categories to move money between them.</p>
      </Dialog>
    );
  }

  const after = (c: BudgetCategory | undefined, delta: number) => (c ? formatMoney(c.availableMinor + delta, fmt) : '');
  const valid = amount !== null && amount > 0;

  return (
    <Dialog
      title={covering && to ? `Cover ${to.icon} ${to.name}` : 'Move money'}
      description={`Between categories in ${monthName(month, fmt.locale)}. Assigned amounts change on both sides.`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={transfer.isPending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={transfer.isPending}>{transfer.isPending ? 'Moving…' : 'Move money'}</PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
            {error}
          </p>
        )}
        <DialogField
          label="From"
          htmlFor={ids.from}
          hint={from && valid ? `${from.name} will have ${after(from, -(amount ?? 0))} left.` : undefined}
        >
          <select id={ids.from} className={CONTROL} value={fromId} onChange={(e) => setFromId(Number(e.target.value))} autoFocus={!covering}>
            {categories.map(option)}
          </select>
        </DialogField>

        <div className="flex justify-center text-muted" aria-hidden>
          <ArrowDown className="size-4" />
        </div>

        <DialogField label="To" htmlFor={ids.to} hint={to && valid ? `${to.name} will have ${after(to, amount ?? 0)}.` : undefined}>
          <select id={ids.to} className={CONTROL} value={toId} onChange={(e) => setToId(Number(e.target.value))}>
            {categories.map(option)}
          </select>
        </DialogField>

        <DialogField label="Amount" htmlFor={ids.amount}>
          <input
            id={ids.amount}
            className={`${CONTROL} text-right tabular-nums`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-invalid={amountText.trim() !== '' && amount === null ? true : undefined}
            autoFocus={covering}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {to && to.availableMinor < 0 && from && from.availableMinor > 0 && (
              <button
                type="button"
                onClick={() => setAmountText(toInputValue(Math.min(-to.availableMinor, from.availableMinor)))}
                className="rounded-lg bg-subtle px-2.5 py-1 text-xs font-medium hover:bg-accent/15"
              >
                Cover overspending ({formatMoney(Math.min(-to.availableMinor, from.availableMinor), fmt)})
              </button>
            )}
            {from && from.availableMinor > 0 && (
              <button
                type="button"
                onClick={() => setAmountText(toInputValue(from.availableMinor))}
                className="rounded-lg bg-subtle px-2.5 py-1 text-xs font-medium hover:bg-accent/15"
              >
                Everything in {from.name} ({formatMoney(from.availableMinor, fmt)})
              </button>
            )}
          </div>
        </DialogField>

        <DialogField label="Note (optional)" htmlFor={ids.note}>
          <input
            id={ids.note}
            className={CONTROL}
            maxLength={200}
            autoComplete="off"
            placeholder="e.g. Cover groceries"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </DialogField>
      </div>
    </Dialog>
  );
}
