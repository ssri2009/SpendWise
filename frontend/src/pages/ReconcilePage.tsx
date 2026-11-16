import { motion } from 'framer-motion';
import { CircleCheck, Landmark, Lock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { EmptyState, ErrorState, rise, Skeleton, stagger } from '../components/dashboard/ui';
import { ReconHistory } from '../components/reconcile/ReconHistory';
import { ReconTxList } from '../components/reconcile/ReconTxList';
import { StatementPanel } from '../components/reconcile/StatementPanel';
import { CONTROL, Dialog, DialogField, GhostButton, PrimaryButton } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { useMoneyFormat } from '../hooks/useDashboard';
import { useFinishReconcile, useReconHistory, useReconState, useSetCleared } from '../hooks/useReconcile';
import { useAccountList } from '../hooks/useTransactions';
import { ApiError } from '../lib/api';
import { formatDate, formatMoney, localToday, relativeDay, type MoneyFormat } from '../lib/format';
import { parseMoney } from '../lib/money';
import type { Account } from '../types/api';
import type { Reconciliation } from '../types/reconcile';

/**
 * Reconcile (server/routes/reconcile.js): check an account against a bank statement. Tick what's on the
 * statement until the difference is 0, then finish to lock those transactions. URL: ?account=<id>.
 */
export default function ReconcilePage() {
  const fmt = useMoneyFormat();
  const [params, setParams] = useSearchParams();
  const accountsQ = useAccountList();
  const allHistoryQ = useReconHistory(null);

  const accounts = useMemo(() => (accountsQ.data?.accounts ?? []).filter((a) => !a.closed), [accountsQ.data]);
  const raw = params.get('account');
  const picked = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  const accountId = picked !== null && (accountsQ.data?.accounts ?? []).some((a) => a.id === picked) ? picked : (accounts[0]?.id ?? null);

  const lastByAccount = useMemo(() => {
    const m = new Map<number, Reconciliation>();
    for (const r of allHistoryQ.data ?? []) if (!m.has(r.accountId)) m.set(r.accountId, r);
    return m;
  }, [allHistoryQ.data]);

  const choose = (id: number) => {
    const next = new URLSearchParams(window.location.search);
    next.set('account', String(id));
    setParams(next, { replace: true });
  };

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-24">
      <motion.div variants={rise}>
        <p className="text-sm text-muted">Check an account against your bank statement</p>
        <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">Reconcile</h2>
      </motion.div>

      {accountsQ.isPending ? (
        <Skeleton className="h-20 w-full rounded-2xl" />
      ) : accountsQ.isError ? (
        <ErrorState error={accountsQ.error} onRetry={() => void accountsQ.refetch()} />
      ) : accounts.length === 0 ? (
        <motion.div variants={rise} className="glass rounded-3xl border border-line p-5 shadow-glass">
          <EmptyState icon={Landmark} title="No open accounts">
            Add an account on the Dashboard, then reconcile it against its statements here.
          </EmptyState>
        </motion.div>
      ) : (
        <>
          <motion.div variants={rise} role="radiogroup" aria-label="Account" className="flex gap-2 overflow-x-auto pb-1">
            {accounts.map((a) => (
              <AccountChip key={a.id} a={a} on={a.id === accountId} last={lastByAccount.get(a.id)} fmt={fmt} onPick={() => choose(a.id)} />
            ))}
          </motion.div>
          {accountId !== null && <AccountReconcile key={accountId} accountId={accountId} fmt={fmt} />}
        </>
      )}
    </motion.div>
  );
}

function AccountChip({ a, on, last, fmt, onPick }: { a: Account; on: boolean; last: Reconciliation | undefined; fmt: MoneyFormat; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={`min-w-44 shrink-0 rounded-2xl border px-4 py-3 text-left transition-colors ${on ? 'border-accent bg-accent/8 ring-2 ring-accent/20' : 'glass border-line hover:border-accent/40'}`}
    >
      <span className="block text-sm font-semibold">{a.name}</span>
      <span className="block text-sm tabular-nums">{formatMoney(a.balanceMinor, fmt)}</span>
      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
        {last ? (
          <>
            <Lock className="size-3" aria-hidden /> Reconciled to {formatDate(last.statementDate, fmt.locale, { day: 'numeric', month: 'short' })}
          </>
        ) : (
          'Never reconciled'
        )}
      </span>
    </button>
  );
}

function AccountReconcile({ accountId, fmt }: { accountId: number; fmt: MoneyFormat }) {
  const toast = useToast();
  const stateQ = useReconState(accountId);
  const historyQ = useReconHistory(accountId);
  const setCleared = useSetCleared(accountId);
  const finish = useFinishReconcile(accountId);

  const [date, setDate] = useState(localToday());
  const [balanceText, setBalanceText] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [note, setNote] = useState('');
  const [done, setDone] = useState<Reconciliation | null>(null);

  const statementMinor = balanceText.trim() === '' ? null : parseMoney(balanceText.replace('−', '-'), { allowNegative: true });
  const state = stateQ.data;
  const toLock = state?.transactions.filter((t) => t.cleared).length ?? 0;
  const diff = state && statementMinor !== null ? statementMinor - state.clearedBalanceMinor : null;

  const message = (tone: 'success' | 'error', text: string) => (tone === 'success' ? toast.success(text) : toast.error(text));

  function onSet(ids: number[], cleared: boolean) {
    setCleared.mutate(
      { ids, cleared },
      {
        onSuccess: () => {
          if (ids.length > 1) toast.success(`Marked ${ids.length} transactions as cleared.`);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not change that.'),
      },
    );
  }

  function submit(adjust: boolean) {
    if (statementMinor === null) return;
    finish.mutate(
      { statementBalanceMinor: statementMinor, statementDate: date, adjust, note: note.trim() || undefined },
      {
        onSuccess: (r) => {
          setDone(r.reconciliation);
          setAdjusting(false);
          setBalanceText('');
          setNote('');
          toast.success(
            `Reconciled ${r.reconciliation.accountName} to ${formatDate(r.reconciliation.statementDate, fmt.locale)}: ${r.reconciliation.transactionCount} transaction${r.reconciliation.transactionCount === 1 ? '' : 's'} locked.`,
          );
        },
        onError: (e) => {
          setAdjusting(false);
          toast.error(e instanceof ApiError ? e.message : 'Could not finish.');
        },
      },
    );
  }

  if (stateQ.isPending) return <Skeleton className="h-96 w-full rounded-3xl" />;
  if (stateQ.isError || !state) return <ErrorState error={stateQ.error} onRetry={() => void stateQ.refetch()} />;

  const last = state.lastReconciliation;

  return (
    <>
      <motion.div variants={rise} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Cleared balance', value: formatMoney(state.clearedBalanceMinor, fmt), hint: `${state.clearedCount} cleared transactions + opening balance` },
          { label: 'Not cleared yet', value: formatMoney(state.unclearedBalanceMinor, fmt, { signed: true }), hint: `${state.unclearedCount} transaction${state.unclearedCount === 1 ? '' : 's'}` },
          { label: 'Balance', value: formatMoney(state.balanceMinor, fmt), hint: 'Cleared + not cleared' },
          {
            label: 'Last reconciled',
            value: last ? relativeDay(last.statementDate, localToday(), fmt.locale) : 'Never',
            hint: last ? `${formatMoney(last.statementBalanceMinor, fmt)} · ${state.lockedCount} locked` : 'Start with your latest statement',
          },
        ].map((t) => (
          <div key={t.label} className="glass rounded-2xl border border-line px-4 py-3.5 shadow-glass" title={t.hint}>
            <p className="text-xs text-muted">{t.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums tracking-tight">{t.value}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted">{t.hint}</p>
          </div>
        ))}
      </motion.div>

      {done && (
        <motion.p variants={rise} role="status" className="flex items-start gap-2.5 rounded-2xl border border-income/30 bg-income/10 px-4 py-3 text-sm">
          <CircleCheck className="mt-0.5 size-4 shrink-0 text-income" aria-hidden />
          <span>
            <b>Done.</b> {done.accountName} matches the statement of {formatDate(done.statementDate, fmt.locale)} ({formatMoney(done.statementBalanceMinor, fmt)}).{' '}
            {done.transactionCount} transaction{done.transactionCount === 1 ? ' is' : 's are'} locked: amount, date and account can't change unless you undo it below.
            {done.adjustmentMinor !== 0 && ` An adjustment of ${formatMoney(done.adjustmentMinor, fmt, { signed: true })} was added.`}
          </span>
        </motion.p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-24">
          <StatementPanel
            state={state}
            fmt={fmt}
            date={date}
            onDate={setDate}
            balanceText={balanceText}
            onBalanceText={(t) => {
              setBalanceText(t);
              setDone(null);
            }}
            statementMinor={statementMinor}
            toLock={toLock}
            pending={finish.isPending}
            onFinish={() => submit(false)}
            onAdjust={() => setAdjusting(true)}
            onApplyHint={(tx, clear) => onSet([tx.id], clear)}
          />
        </div>
        <ReconTxList transactions={state.transactions} statementDate={date} fmt={fmt} busy={setCleared.isPending} onSet={onSet} />
      </div>

      <ReconHistory items={historyQ.data} loading={historyQ.isPending} error={historyQ.error} fmt={fmt} onMessage={message} />

      {adjusting && diff !== null && (
        <Dialog
          title="Finish with an adjustment?"
          description={`SpendWise adds one cleared transaction of ${formatMoney(diff, fmt, { signed: true })} dated ${formatDate(date, fmt.locale)}, so the account matches the statement.`}
          onClose={() => setAdjusting(false)}
          onSubmit={() => submit(true)}
          footer={
            <>
              <GhostButton onClick={() => setAdjusting(false)} disabled={finish.isPending}>
                Keep looking
              </GhostButton>
              <PrimaryButton pending={finish.isPending}>Add adjustment and finish</PrimaryButton>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p className="text-muted">
              It's called "Reconciliation Balance Adjustment" and has no category, so it {diff > 0 ? 'adds to' : 'comes out of'} To Budget. Undoing this reconciliation later deletes it again.
            </p>
            <DialogField label="Note (optional)" htmlFor="sw-recon-note">
              <input id="sw-recon-note" className={CONTROL} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. bank fee I couldn't find" />
            </DialogField>
          </div>
        </Dialog>
      )}
    </>
  );
}
