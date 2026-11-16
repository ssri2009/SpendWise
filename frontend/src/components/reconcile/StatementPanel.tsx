import { CircleCheck, Lightbulb, Lock, Scale } from 'lucide-react';
import { useId } from 'react';
import { formatDate, formatMoney, type MoneyFormat } from '../../lib/format';
import type { ReconState, ReconTransaction } from '../../types/reconcile';
import { CONTROL } from '../ui/Dialog';

/** One uncleared transaction (or one cleared one) that alone explains the difference, if there is one. */
export function closingHint(state: ReconState, diff: number, statementDate: string): { tx: ReconTransaction; clear: boolean } | null {
  if (diff === 0) return null;
  const unc = state.transactions.find((t) => !t.cleared && t.amountMinor === diff && t.date <= statementDate);
  if (unc) return { tx: unc, clear: true };
  const clr = state.transactions.find((t) => t.cleared && t.amountMinor === -diff);
  if (clr) return { tx: clr, clear: false };
  return null;
}

/**
 * The statement side: date + closing balance as printed, against SpendWise's cleared balance.
 * The difference drives everything: 0 → finish; otherwise clear what's missing, or adjust.
 */
export function StatementPanel({
  state,
  fmt,
  date,
  onDate,
  balanceText,
  onBalanceText,
  statementMinor,
  toLock,
  pending,
  onFinish,
  onAdjust,
  onApplyHint,
}: {
  state: ReconState;
  fmt: MoneyFormat;
  date: string;
  onDate: (d: string) => void;
  balanceText: string;
  onBalanceText: (t: string) => void;
  /** Parsed statement balance, null while empty / invalid. */
  statementMinor: number | null;
  /** Cleared transactions that finishing would lock. */
  toLock: number;
  pending: boolean;
  onFinish: () => void;
  onAdjust: () => void;
  onApplyHint: (tx: ReconTransaction, clear: boolean) => void;
}) {
  const ids = { date: useId(), bal: useId() };
  const diff = statementMinor === null ? null : statementMinor - state.clearedBalanceMinor;
  const hint = diff === null ? null : closingHint(state, diff, date);
  const negative = balanceText.trim().startsWith('-') || balanceText.trim().startsWith('−');
  const locale = fmt.locale;

  return (
    <section aria-labelledby="sw-recon-statement" className="glass rounded-3xl border border-line p-5 shadow-glass sm:p-6">
      <h3 id="sw-recon-statement" className="mb-4 flex items-center gap-2.5 text-base font-semibold">
        <span className="grid size-8 place-items-center rounded-xl bg-accent/12 text-accent">
          <Scale className="size-4" aria-hidden />
        </span>
        Your statement
      </h3>

      <div className="space-y-4">
        <div>
          <label htmlFor={ids.date} className="mb-1.5 block text-sm font-medium">
            Statement date
          </label>
          <input id={ids.date} type="date" className={CONTROL} value={date} onChange={(e) => onDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor={ids.bal} className="mb-1.5 block text-sm font-medium">
            Closing balance on the statement
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onBalanceText(negative ? balanceText.trim().replace(/^[-−]\s*/, '') : `-${balanceText.trim()}`)}
              aria-label={negative ? 'Make it positive' : 'Make it negative (money owed)'}
              title="Switch between money you have and money you owe"
              aria-pressed={negative}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border text-lg font-bold ${negative ? 'border-expense/40 bg-expense/10 text-expense' : 'border-line bg-surface text-muted hover:bg-subtle'}`}
            >
              {negative ? '−' : '+'}
            </button>
            <input
              id={ids.bal}
              className={`${CONTROL} text-right text-base font-semibold tabular-nums`}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={balanceText}
              onChange={(e) => onBalanceText(e.target.value)}
              aria-invalid={balanceText.trim() !== '' && statementMinor === null ? true : undefined}
              aria-describedby={`${ids.bal}-hint`}
            />
          </div>
          <p id={`${ids.bal}-hint`} className="pt-1.5 text-xs text-muted">
            {balanceText.trim() !== '' && statementMinor === null ? (
              <span className="font-medium text-expense">Enter an amount like 25,400.50.</span>
            ) : (
              'For a credit card, money you owe is negative.'
            )}
          </p>
        </div>

        <dl className="space-y-2 rounded-2xl bg-subtle px-4 py-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Statement</dt>
            <dd className="font-semibold tabular-nums">{statementMinor === null ? '—' : formatMoney(statementMinor, fmt)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted" title="Opening balance + every cleared transaction">
              Cleared in SpendWise
            </dt>
            <dd className="font-semibold tabular-nums" data-testid="cleared-balance">
              {formatMoney(state.clearedBalanceMinor, fmt)}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-line pt-2">
            <dt className="font-medium">Difference</dt>
            <dd
              data-testid="difference"
              className={`text-lg font-bold tabular-nums ${diff === null ? 'text-muted' : diff === 0 ? 'text-income' : 'text-warning'}`}
            >
              {diff === null ? '—' : formatMoney(diff, fmt, { signed: true })}
            </dd>
          </div>
        </dl>

        {diff === 0 ? (
          <p role="status" className="flex items-start gap-2 text-sm text-income">
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <b>It matches.</b> {toLock ? `Finishing locks ${toLock} cleared transaction${toLock === 1 ? '' : 's'}.` : 'There is nothing new to lock since the last reconciliation.'}
            </span>
          </p>
        ) : diff !== null ? (
          <div role="status" className="space-y-2 text-sm">
            <p className="text-warning">
              <b>Off by {formatMoney(Math.abs(diff), fmt)}.</b> Tick the transactions that appear on the statement, and untick the ones that don't.
            </p>
            {hint && (
              <p className="flex items-start gap-2 rounded-xl border border-accent/30 bg-accent/8 px-3 py-2">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                <span>
                  {hint.clear ? 'Clearing' : 'Un-clearing'} <b>{hint.tx.payee || 'a transaction'}</b> ({formatMoney(hint.tx.amountMinor, fmt, { signed: true })},{' '}
                  {formatDate(hint.tx.date, locale)}) would make it match.{' '}
                  <button type="button" onClick={() => onApplyHint(hint.tx, hint.clear)} className="font-semibold text-accent hover:underline">
                    {hint.clear ? 'Mark it cleared' : 'Un-clear it'}
                  </button>
                </span>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">Type the closing balance from your bank statement to compare.</p>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={onFinish}
            disabled={diff !== 0 || toLock === 0 || pending || !date}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/25 transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Lock className="size-4" aria-hidden /> {pending ? 'Finishing…' : 'Finish reconciling'}
          </button>
          {diff !== null && diff !== 0 && (
            <button
              type="button"
              onClick={onAdjust}
              disabled={pending || !date}
              className="w-full text-center text-xs font-semibold text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-50"
            >
              Can't find it? Finish with a {formatMoney(diff, fmt, { signed: true })} adjustment…
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
