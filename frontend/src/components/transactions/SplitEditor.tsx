import { Plus, Trash2, Wand2 } from 'lucide-react';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import { parseMoney, toInputValue } from '../../lib/money';
import type { CategoryGroupNode } from '../../types/api';
import { CONTROL } from '../ui/Dialog';
import { CategorySelect } from './pickers';

export interface SplitDraft {
  key: number;
  categoryId: number | null;
  /** Typed in the transaction's direction; a leading "-" makes this part go the other way. */
  amountText: string;
  notes: string;
}

export const MIN_SPLITS = 2;
export const MAX_SPLITS = 30;

let nextKey = 1;
export const newSplit = (partial: Partial<SplitDraft> = {}): SplitDraft => ({ key: nextKey++, categoryId: null, amountText: '', notes: '', ...partial });

/** Parts typed as positive numbers in the transaction's direction → signed paise. null = unreadable. */
export function signedParts(parts: SplitDraft[], sign: 1 | -1): (number | null)[] {
  return parts.map((p) => {
    const m = parseMoney(p.amountText, { allowNegative: true });
    return m === null ? null : sign * m;
  });
}

/** Signed paise of a saved split → text in the transaction's direction. */
export const partText = (minor: number, sign: 1 | -1) => toInputValue(minor * sign);

/** server/splits.js checkSplits(), checked before sending. */
export function splitProblem(parts: SplitDraft[], totalMinor: number | null, sign: 1 | -1): string | null {
  if (parts.length < MIN_SPLITS) return `A split needs at least ${MIN_SPLITS} parts.`;
  if (parts.length > MAX_SPLITS) return `A transaction can have at most ${MAX_SPLITS} parts.`;
  const amounts = signedParts(parts, sign);
  const bad = amounts.findIndex((a) => a === null || a === 0);
  if (bad >= 0) return `Part ${bad + 1}: enter an amount (not zero).`;
  if (parts.some((p) => p.notes.trim().length > 200)) return 'Split notes must be 200 characters or fewer.';
  if (totalMinor === null) return null;
  const sum = (amounts as number[]).reduce((a, b) => a + b, 0);
  if (sum !== totalMinor) return 'The parts must add up to the amount.';
  return null;
}

export function SplitEditor({
  parts,
  onChange,
  totalMinor,
  sign,
  groups,
  fmt,
  disabled,
  error,
}: {
  parts: SplitDraft[];
  onChange: (parts: SplitDraft[]) => void;
  /** Signed amount of the transaction, or null while the amount field is empty/invalid. */
  totalMinor: number | null;
  sign: 1 | -1;
  groups: CategoryGroupNode[];
  fmt: MoneyFormat;
  disabled?: boolean;
  error?: string | null;
}) {
  const amounts = signedParts(parts, sign);
  const sum = amounts.reduce<number>((a, b) => a + (b ?? 0), 0);
  const remaining = totalMinor === null ? null : totalMinor - sum;

  const update = (key: number, patch: Partial<SplitDraft>) => onChange(parts.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const remove = (key: number) => onChange(parts.filter((p) => p.key !== key));
  const fillRemaining = (key: number) => {
    if (remaining === null) return;
    const i = parts.findIndex((p) => p.key === key);
    const current = amounts[i] ?? 0;
    const next = current + remaining;
    update(key, { amountText: next === 0 ? '' : partText(next, sign) });
  };

  const tone = remaining === null ? 'text-muted' : remaining === 0 ? 'text-income' : 'text-warning';

  return (
    <div className="space-y-3" role="group" aria-label="Split parts">
      <div className="space-y-2">
        {parts.map((p, i) => {
          const invalid = p.amountText.trim() !== '' && amounts[i] === null;
          return (
            <div key={p.key} className="rounded-2xl border border-line bg-surface p-3">
              <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-center gap-2">
                <CategorySelect
                  groups={groups}
                  value={p.categoryId}
                  onChange={(id) => update(p.key, { categoryId: id })}
                  keep={p.categoryId}
                  aria-label={`Part ${i + 1} category`}
                  disabled={disabled}
                  className={`${CONTROL} h-10`}
                />
                <input
                  aria-label={`Part ${i + 1} amount`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={p.amountText}
                  disabled={disabled}
                  onChange={(e) => update(p.key, { amountText: e.target.value })}
                  aria-invalid={invalid || undefined}
                  className={`${CONTROL} h-10 text-right tabular-nums`}
                />
                <button
                  type="button"
                  onClick={() => remove(p.key)}
                  disabled={disabled || parts.length <= MIN_SPLITS}
                  aria-label={`Remove part ${i + 1}`}
                  className="grid size-10 place-items-center rounded-xl text-muted transition-colors hover:bg-expense/10 hover:text-expense disabled:opacity-30"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  aria-label={`Part ${i + 1} note`}
                  placeholder="Note for this part (optional)"
                  maxLength={200}
                  value={p.notes}
                  disabled={disabled}
                  onChange={(e) => update(p.key, { notes: e.target.value })}
                  className={`${CONTROL} h-9 text-xs`}
                />
                {remaining !== null && remaining !== 0 && (
                  <button
                    type="button"
                    onClick={() => fillRemaining(p.key)}
                    disabled={disabled}
                    className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-subtle px-2.5 text-xs font-medium hover:bg-accent/15"
                    title="Put the remaining amount on this part"
                  >
                    <Wand2 className="size-3.5" aria-hidden /> Fill
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange([...parts, newSplit()])}
          disabled={disabled || parts.length >= MAX_SPLITS}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold hover:bg-subtle disabled:opacity-40"
        >
          <Plus className="size-3.5" aria-hidden /> Add part
        </button>
        <p className={`text-xs font-semibold tabular-nums ${tone}`} aria-live="polite">
          {remaining === null
            ? 'Enter the amount first'
            : remaining === 0
              ? `Adds up to ${formatMoney(Math.abs(totalMinor ?? 0), fmt)} ✓`
              : `${formatMoney(Math.abs(remaining), fmt)} ${remaining * sign > 0 ? 'left to split' : 'too much'}`}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-expense">
          {error}
        </p>
      )}
    </div>
  );
}
