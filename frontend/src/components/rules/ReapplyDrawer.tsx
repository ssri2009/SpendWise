import { ArrowRight, Eye, Loader2, Play } from 'lucide-react';
import { useId, useState } from 'react';
import { useReprocess } from '../../hooks/useRules';
import { useTransactionMonths } from '../../hooks/useTransactions';
import { ApiError } from '../../lib/api';
import { monthName } from '../../lib/format';
import type { Account } from '../../types/api';
import type { ReprocessResult, ReprocessSide, Rule } from '../../types/rules';
import { AccountSelect } from '../transactions/pickers';
import { CONTROL, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';
import { Drawer } from '../ui/Drawer';

/** What changed between before and after, as short "field: old → new" lines. */
function diff(b: ReprocessSide, a: ReprocessSide): { field: string; from: string; to: string }[] {
  const out: { field: string; from: string; to: string }[] = [];
  if (b.payee !== a.payee) out.push({ field: 'Payee', from: b.payee || '—', to: a.payee || '—' });
  if (b.category !== a.category) out.push({ field: 'Category', from: b.category, to: a.category });
  if (b.notes !== a.notes) out.push({ field: 'Notes', from: b.notes || '—', to: a.notes || '—' });
  if (b.cleared !== a.cleared) out.push({ field: 'Cleared', from: b.cleared ? 'yes' : 'no', to: a.cleared ? 'yes' : 'no' });
  return out;
}

/**
 * Re-apply rules to transactions you already have (POST /api/rules/reprocess). Always previews first
 * (dryRun); nothing changes until you confirm. Can run one rule, even a disabled one, to try it out.
 */
export function ReapplyDrawer({
  rules,
  accounts,
  initialRuleId,
  locale,
  onClose,
  onApplied,
}: {
  rules: Rule[];
  accounts: Account[];
  /** Open with just this rule picked ("Try on my transactions"). */
  initialRuleId: number | null;
  locale: string;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const run = useReprocess();
  const monthsQ = useTransactionMonths();
  const [ruleId, setRuleId] = useState<number | null>(initialRuleId);
  const [month, setMonth] = useState<string>('all');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [preview, setPreview] = useState<ReprocessResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = { rule: useId(), month: useId(), account: useId(), unc: useId() };
  const enabledCount = rules.filter((r) => r.enabled).length;

  const opts = { month, accountId, onlyUncategorized, ruleIds: ruleId === null ? null : [ruleId] };
  const changeOpt = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
    setProblem(null);
  };

  function doPreview() {
    setProblem(null);
    run.mutate({ dryRun: true, ...opts }, { onSuccess: setPreview, onError: (e) => setProblem(e instanceof ApiError ? e.message : 'Could not run the preview.') });
  }

  function apply() {
    run.mutate(
      { dryRun: false, ...opts },
      {
        onSuccess: (r) => {
          onApplied(r.changed ? `Updated ${r.changed} transaction${r.changed === 1 ? '' : 's'}.` : 'Nothing needed changing.');
          onClose();
        },
        onError: (e) => setProblem(e instanceof ApiError ? e.message : 'Could not apply the changes.'),
      },
    );
  }

  return (
    <Drawer
      title="Re-apply rules"
      description="Run your rules over transactions you already have. You see every change before anything is saved."
      onClose={onClose}
      width="xl"
      footer={
        <>
          <GhostButton onClick={onClose} disabled={run.isPending}>
            Done
          </GhostButton>
          {preview && preview.changed > 0 ? (
            <PrimaryButton type="button" pending={run.isPending} onClick={apply}>
              <Play className="size-4" aria-hidden /> Apply {preview.changed} change{preview.changed === 1 ? '' : 's'}
            </PrimaryButton>
          ) : (
            <PrimaryButton type="button" pending={run.isPending} onClick={doPreview} disabled={ruleId === null && enabledCount === 0}>
              <Eye className="size-4" aria-hidden /> Preview changes
            </PrimaryButton>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <DialogField label="Rules" htmlFor={ids.rule} hint={ruleId === null ? `All ${enabledCount} enabled rules, in order.` : 'Just this one, even if it is turned off.'}>
            <select id={ids.rule} className={CONTROL} value={ruleId ?? ''} onChange={(e) => changeOpt(setRuleId)(e.target.value ? Number(e.target.value) : null)}>
              <option value="" className="bg-elevated text-fg">
                All enabled rules
              </option>
              {rules.map((r) => (
                <option key={r.id} value={r.id} className="bg-elevated text-fg">
                  {r.position}. {r.name}
                  {r.enabled ? '' : ' (off)'}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Transactions from" htmlFor={ids.month}>
            <select id={ids.month} className={CONTROL} value={month} onChange={(e) => changeOpt(setMonth)(e.target.value)}>
              <option value="all" className="bg-elevated text-fg">
                Any date
              </option>
              {(monthsQ.data ?? []).map((m) => (
                <option key={m} value={m} className="bg-elevated text-fg">
                  {monthName(m, locale)}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField label="Account" htmlFor={ids.account}>
            <AccountSelect id={ids.account} accounts={accounts} includeClosed allLabel="All accounts" value={accountId} onChange={changeOpt(setAccountId)} />
          </DialogField>
          <label htmlFor={ids.unc} className="flex cursor-pointer items-center gap-2.5 self-end pb-3 text-sm">
            <input id={ids.unc} type="checkbox" checked={onlyUncategorized} onChange={(e) => changeOpt(setOnlyUncategorized)(e.target.checked)} className="size-4 accent-[var(--sw-accent)]" />
            Only uncategorized transactions
          </label>
        </div>

        {problem && (
          <p role="alert" className="rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
            {problem}
          </p>
        )}

        {run.isPending && !preview && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Checking your transactions…
          </p>
        )}

        {preview && (
          <section aria-label="Preview" className="space-y-3">
            <p role="status" className="rounded-xl bg-subtle px-3.5 py-2.5 text-sm">
              {preview.note ? (
                preview.note
              ) : (
                <>
                  Looked at <b>{preview.scanned.toLocaleString(locale)}</b> transaction{preview.scanned === 1 ? '' : 's'}.{' '}
                  {preview.changed ? (
                    <>
                      <b>{preview.changed.toLocaleString(locale)}</b> would change.
                    </>
                  ) : (
                    'None would change.'
                  )}
                  {preview.truncated && ' Only the first 5,000 were checked; narrow it to a month or an account for the rest.'}
                </>
              )}
            </p>
            {preview.samples.length > 0 && (
              <div className="max-h-[50vh] overflow-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <caption className="sr-only">Transactions that would change</caption>
                  <thead className="sticky top-0 bg-elevated text-xs text-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Transaction
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">
                        Change
                      </th>
                      <th scope="col" className="hidden px-3 py-2 text-left font-medium sm:table-cell">
                        By
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.samples.map((s) => (
                      <tr key={s.id}>
                        <th scope="row" className="px-3 py-2 text-left align-top font-medium">
                          {s.before.payee || '(no payee)'}
                          <span className="block text-xs font-normal text-muted">{s.before.category}</span>
                        </th>
                        <td className="px-3 py-2 align-top">
                          {diff(s.before, s.after).map((d) => (
                            <span key={d.field} className="flex flex-wrap items-center gap-1 text-xs">
                              <span className="text-muted">{d.field}:</span>
                              <span className="line-through decoration-muted/60">{d.from}</span>
                              <ArrowRight className="size-3 text-muted" aria-label="becomes" />
                              <b>{d.to}</b>
                            </span>
                          ))}
                        </td>
                        <td className="hidden px-3 py-2 align-top text-xs text-muted sm:table-cell">{s.rules.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {preview.changed > preview.samples.length && <p className="text-xs text-muted">Showing the first {preview.samples.length} of {preview.changed}.</p>}
            {preview.changed > 0 && (
              <p className="text-xs text-muted">Applying changes payee, category, notes and cleared only. Amounts, dates and splits are never touched.</p>
            )}
          </section>
        )}
      </div>
    </Drawer>
  );
}
