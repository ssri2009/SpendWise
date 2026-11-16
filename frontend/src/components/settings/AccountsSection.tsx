import { ArchiveRestore, Archive, Landmark, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useAccounts } from '../../hooks/useDashboard';
import { useCreateAccount, useDeleteAccount, useUpdateAccount } from '../../hooks/useSettings';
import { ApiError } from '../../lib/api';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import { parseMoney, toInputValue } from '../../lib/money';
import type { Account, AccountType } from '../../types/api';
import { ErrorState, Skeleton } from '../dashboard/ui';
import { IconButton } from '../schedules/parts';
import { CONTROL, Dialog, DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';

export const ACCOUNT_TYPES: { id: AccountType; label: string }[] = [
  { id: 'checking', label: 'Bank (savings / current)' },
  { id: 'savings', label: 'Savings' },
  { id: 'cash', label: 'Cash' },
  { id: 'credit', label: 'Credit card' },
  { id: 'investment', label: 'Investment' },
  { id: 'loan', label: 'Loan' },
  { id: 'other', label: 'Other' },
];
const typeLabel = (t: AccountType) => ACCOUNT_TYPES.find((x) => x.id === t)?.label ?? t;

type Msg = (tone: 'success' | 'error', text: string) => void;
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Accounts (server/routes/accounts.js): add, edit, close / reopen, delete an unused one. */
export function AccountsSection({ fmt, onMessage }: { fmt: MoneyFormat; onMessage: Msg }) {
  const q = useAccounts();
  const update = useUpdateAccount();
  const remove = useDeleteAccount();
  const [editing, setEditing] = useState<{ account: Account | null } | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const accounts = q.data?.accounts ?? [];
  const open = accounts.filter((a) => !a.closed);
  const closed = accounts.filter((a) => a.closed);

  const setClosed = (a: Account, closedNow: boolean) =>
    update.mutate(
      { id: a.id, patch: { closed: closedNow } },
      {
        onSuccess: () => onMessage('success', closedNow ? `Closed ${a.name}. Its history stays; it's hidden from pickers.` : `${a.name} is open again.`),
        onError: (e) => onMessage('error', errText(e, 'Could not change that.')),
      },
    );

  const row = (a: Account) => (
    <li key={a.id} id={`account-row-${a.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
        <Landmark className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{a.name}</span>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{typeLabel(a.type)}</span>
          {a.offbudget && <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted">Off budget</span>}
          {a.closed && <span className="rounded-full bg-subtle px-2 py-0.5 text-[11px] font-medium text-muted">Closed</span>}
        </p>
        <p className="text-xs text-muted">
          {a.transactionCount.toLocaleString(fmt.locale)} transaction{a.transactionCount === 1 ? '' : 's'} · opened with {formatMoney(a.openingBalanceMinor, fmt)}
        </p>
      </div>
      <span className={`text-sm font-semibold tabular-nums ${a.balanceMinor < 0 ? 'text-expense' : ''}`}>{formatMoney(a.balanceMinor, fmt)}</span>
      <div className="flex gap-0.5">
        {!a.closed && (
          <Link to={`/reconcile?account=${a.id}`} aria-label={`Reconcile ${a.name}`} title="Reconcile" className="grid size-9 place-items-center rounded-xl text-muted hover:bg-subtle hover:text-fg">
            <Scale className="size-4" aria-hidden />
          </Link>
        )}
        <IconButton label={`Edit ${a.name}`} onClick={() => setEditing({ account: a })}>
          <Pencil className="size-4" aria-hidden />
        </IconButton>
        <IconButton label={a.closed ? `Reopen ${a.name}` : `Close ${a.name}`} onClick={() => setClosed(a, !a.closed)} disabled={update.isPending}>
          {a.closed ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
        </IconButton>
        <IconButton
          label={a.transactionCount ? `${a.name} has transactions: close it instead` : `Delete ${a.name}`}
          tone="danger"
          disabled={a.transactionCount > 0}
          onClick={() => setDeleting(a)}
        >
          <Trash2 className="size-4" aria-hidden />
        </IconButton>
      </div>
    </li>
  );

  return (
    <section aria-labelledby="sw-set-accounts" className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="sw-set-accounts" className="text-lg font-bold tracking-tight">
            Accounts
          </h3>
          <p className="text-sm text-muted">
            {q.data ? (
              <>
                {open.length} open · total funds <b className="text-fg">{formatMoney(q.data.totalFundsMinor, fmt)}</b>
              </>
            ) : (
              'Bank accounts, cards, cash and loans.'
            )}
          </p>
        </div>
        <PrimaryButton type="button" onClick={() => setEditing({ account: null })}>
          <Plus className="size-4" aria-hidden /> Add account
        </PrimaryButton>
      </header>

      <div className="glass rounded-3xl border border-line px-4 shadow-glass sm:px-5">
        {q.isPending ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <ul className="divide-y divide-line" aria-label="Open accounts">
            {open.map(row)}
          </ul>
        )}
      </div>

      {closed.length > 0 && (
        <details className="glass rounded-3xl border border-line px-4 shadow-glass sm:px-5">
          <summary className="cursor-pointer py-3 text-sm font-semibold">Closed accounts ({closed.length})</summary>
          <ul className="divide-y divide-line border-t border-line" aria-label="Closed accounts">
            {closed.map(row)}
          </ul>
        </details>
      )}

      {editing && <AccountDialog account={editing.account} fmt={fmt} onClose={() => setEditing(null)} onMessage={onMessage} />}

      {deleting && (
        <Dialog
          title={`Delete ${deleting.name}?`}
          description="It has no transactions, so nothing else changes. This can't be undone."
          onClose={() => setDeleting(null)}
          footer={
            <>
              <GhostButton onClick={() => setDeleting(null)} disabled={remove.isPending}>
                Keep it
              </GhostButton>
              <PrimaryButton
                type="button"
                tone="danger"
                pending={remove.isPending}
                onClick={() =>
                  remove.mutate(deleting.id, {
                    onSuccess: () => {
                      onMessage('success', `Deleted ${deleting.name}.`);
                      setDeleting(null);
                    },
                    onError: (e) => {
                      onMessage('error', errText(e, 'Could not delete it.'));
                      setDeleting(null);
                    },
                  })
                }
              >
                Delete account
              </PrimaryButton>
            </>
          }
        >
          <p className="text-sm text-muted">Accounts with transactions can only be closed, so their history stays correct.</p>
        </Dialog>
      )}
    </section>
  );
}

function AccountDialog({ account, fmt, onClose, onMessage }: { account: Account | null; fmt: MoneyFormat; onClose: () => void; onMessage: Msg }) {
  const isNew = account === null;
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking');
  const [offbudget, setOffbudget] = useState(account?.offbudget ?? false);
  const [opening, setOpening] = useState(account ? toInputValue(account.openingBalanceMinor) : '');
  const [problem, setProblem] = useState<string | null>(null);
  const ids = { name: useId(), type: useId(), opening: useId(), off: useId() };
  const pending = create.isPending || update.isPending;
  const owes = type === 'credit' || type === 'loan';

  function submit() {
    if (pending) return;
    const n = name.trim();
    if (!n || n.length > 40) return setProblem('Name must be 1 to 40 characters.');
    const openingMinor = opening.trim() === '' ? 0 : parseMoney(opening.replace('−', '-'), { allowNegative: true });
    if (openingMinor === null) return setProblem('Opening balance must be an amount like 25,000 or -12,500.');
    setProblem(null);
    const input = { name: n, type, offbudget, openingBalanceMinor: openingMinor };
    const fail = (e: unknown) => setProblem(errText(e, 'Could not save.'));
    const done = (text: string) => () => {
      onMessage('success', text);
      onClose();
    };
    if (isNew) create.mutate(input, { onSuccess: done(`Added ${n}.`), onError: fail });
    else update.mutate({ id: account.id, patch: input }, { onSuccess: done(`Saved ${n}.`), onError: fail });
  }

  return (
    <Dialog
      title={isNew ? 'Add account' : `Edit ${account.name}`}
      description={isNew ? 'A bank account, card, cash wallet or loan.' : `${account.transactionCount} transactions · balance ${formatMoney(account.balanceMinor, fmt)}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <GhostButton onClick={onClose} disabled={pending}>
            Cancel
          </GhostButton>
          <PrimaryButton pending={pending}>{isNew ? 'Add account' : 'Save'}</PrimaryButton>
        </>
      }
    >
      <div className="space-y-4">
        {problem && (
          <p role="alert" className="rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
            {problem}
          </p>
        )}
        <DialogField label="Name" htmlFor={ids.name}>
          <input id={ids.name} className={CONTROL} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HDFC Savings" autoFocus autoComplete="off" />
        </DialogField>
        <DialogField label="Type" htmlFor={ids.type}>
          <select id={ids.type} className={CONTROL} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.id} value={t.id} className="bg-elevated text-fg">
                {t.label}
              </option>
            ))}
          </select>
        </DialogField>
        <DialogField
          label="Opening balance"
          htmlFor={ids.opening}
          hint={owes ? 'What you owe is negative, e.g. -12,500.' : isNew ? 'What was in it on the day you start tracking.' : 'Changing it moves every balance of this account.'}
        >
          <input
            id={ids.opening}
            className={`${CONTROL} text-right tabular-nums`}
            inputMode="decimal"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            placeholder="0"
            autoComplete="off"
          />
        </DialogField>
        <label htmlFor={ids.off} className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3.5 text-sm hover:border-accent/40">
          <input id={ids.off} type="checkbox" checked={offbudget} onChange={(e) => setOffbudget(e.target.checked)} className="mt-0.5 size-4 accent-[var(--sw-accent)]" />
          <span>
            <span className="block font-medium">Off budget</span>
            <span className="block text-xs text-muted">For investments, loans and other money you don't budget. It still counts in net worth, not in To Budget.</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}
