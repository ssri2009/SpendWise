import { History, Lock, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useReconDetail, useUndoReconcile } from '../../hooks/useReconcile';
import { ApiError } from '../../lib/api';
import { formatDate, formatMoney, type MoneyFormat } from '../../lib/format';
import type { Reconciliation } from '../../types/reconcile';
import { EmptyState, ErrorState, Panel, Skeleton } from '../dashboard/ui';
import { Dialog, GhostButton, PrimaryButton } from '../ui/Dialog';
import { Drawer } from '../ui/Drawer';

const when = (iso: string, locale: string) => formatDate(iso.slice(0, 10), locale, { day: 'numeric', month: 'short', year: 'numeric' });

/** Past reconciliations of the account, newest first. Only the newest can be undone. */
export function ReconHistory({
  items,
  loading,
  error,
  fmt,
  onMessage,
}: {
  items: Reconciliation[] | undefined;
  loading: boolean;
  error: unknown;
  fmt: MoneyFormat;
  onMessage: (tone: 'success' | 'error', text: string) => void;
}) {
  const undo = useUndoReconcile();
  const [open, setOpen] = useState<number | null>(null);
  const [undoing, setUndoing] = useState<Reconciliation | null>(null);
  const locale = fmt.locale;

  return (
    <Panel title="History" icon={History}>
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : error ? (
        <ErrorState error={error} compact />
      ) : !items?.length ? (
        <EmptyState icon={History} title="Not reconciled yet">
          Each time you finish, it's kept here with the statement balance and what was locked.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line" aria-label="Past reconciliations">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-subtle text-muted">
                <Lock className="size-3.5" aria-hidden />
              </span>
              <button type="button" onClick={() => setOpen(r.id)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-semibold hover:text-accent">Statement of {when(r.statementDate, locale)}</span>
                <span className="block text-xs text-muted">
                  {r.transactionCount} transaction{r.transactionCount === 1 ? '' : 's'} locked · done {when(r.reconciledAt, locale)}
                  {r.adjustmentMinor !== 0 && ` · adjusted ${formatMoney(r.adjustmentMinor, fmt, { signed: true })}`}
                </span>
              </button>
              <span className="text-sm font-semibold tabular-nums">{formatMoney(r.statementBalanceMinor, fmt)}</span>
              {r.canUndo && (
                <button
                  type="button"
                  onClick={() => setUndoing(r)}
                  aria-label={`Undo the reconciliation of ${r.statementDate}`}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-semibold text-muted hover:bg-subtle hover:text-fg"
                >
                  <Undo2 className="size-3.5" aria-hidden /> Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open !== null && <ReconDetailDrawer id={open} fmt={fmt} onClose={() => setOpen(null)} />}

      {undoing && (
        <Dialog
          title="Undo this reconciliation?"
          description={`Statement of ${when(undoing.statementDate, locale)} (${formatMoney(undoing.statementBalanceMinor, fmt)}).`}
          onClose={() => setUndoing(null)}
          footer={
            <>
              <GhostButton onClick={() => setUndoing(null)} disabled={undo.isPending}>
                Keep it
              </GhostButton>
              <PrimaryButton
                type="button"
                tone="danger"
                pending={undo.isPending}
                onClick={() =>
                  undo.mutate(undoing.id, {
                    onSuccess: () => {
                      onMessage('success', `Undone. ${undoing.transactionCount} transaction${undoing.transactionCount === 1 ? ' is' : 's are'} unlocked.`);
                      setUndoing(null);
                    },
                    onError: (e) => {
                      onMessage('error', e instanceof ApiError ? e.message : 'Could not undo it.');
                      setUndoing(null);
                    },
                  })
                }
              >
                Undo reconciliation
              </PrimaryButton>
            </>
          }
        >
          <p className="text-sm text-muted">
            Its {undoing.transactionCount} transaction{undoing.transactionCount === 1 ? '' : 's'} become editable again (they stay cleared).
            {undoing.adjustmentTransactionId !== null && <> The {formatMoney(undoing.adjustmentMinor, fmt, { signed: true })} adjustment it added is deleted.</>}
          </p>
        </Dialog>
      )}
    </Panel>
  );
}

function ReconDetailDrawer({ id, fmt, onClose }: { id: number; fmt: MoneyFormat; onClose: () => void }) {
  const q = useReconDetail(id);
  const r = q.data?.reconciliation;
  const locale = fmt.locale;
  return (
    <Drawer title={r ? `Statement of ${when(r.statementDate, locale)}` : 'Reconciliation'} description={r ? `${r.accountName} · done ${when(r.reconciledAt, locale)}` : undefined} onClose={onClose} width="lg">
      {q.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError || !r ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {[
              ['Statement balance', formatMoney(r.statementBalanceMinor, fmt)],
              ['Cleared in SpendWise', formatMoney(r.clearedBalanceMinor, fmt)],
              ['Difference', formatMoney(r.differenceMinor, fmt, { signed: true })],
              ['Adjustment added', r.adjustmentMinor ? formatMoney(r.adjustmentMinor, fmt, { signed: true }) : 'None'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-subtle px-3 py-2">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {r.note && <p className="text-sm text-muted">Note: {r.note}</p>}
          <h3 className="text-sm font-semibold">
            {q.data.transactions.length} locked transaction{q.data.transactions.length === 1 ? '' : 's'}
          </h3>
          <ul className="divide-y divide-line rounded-2xl border border-line" aria-label="Locked transactions">
            {q.data.transactions.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-16 shrink-0 text-xs tabular-nums text-muted">{formatDate(t.date, locale, { day: 'numeric', month: 'short' })}</span>
                <span className="min-w-0 flex-1 truncate">{t.payee || '(no payee)'}</span>
                <span className={`font-semibold tabular-nums ${t.amountMinor > 0 ? 'text-income' : ''}`}>{formatMoney(t.amountMinor, fmt, { signed: true })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}
