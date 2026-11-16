import { motion } from 'framer-motion';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CheckCircle2, Lock, ReceiptText, Split } from 'lucide-react';
import { Link } from 'react-router';
import { useMoneyFormat, useRecentTransactions } from '../../hooks/useDashboard';
import { formatMoney, relativeDay, type MoneyFormat } from '../../lib/format';
import type { Transaction } from '../../types/api';
import { EmptyState, ErrorState, Panel, Skeleton } from './ui';

const LIMIT = 8;

function CategoryLabel({ tx }: { tx: Transaction }) {
  if (tx.isSplit) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <Split className="size-3.5" aria-hidden />
        Split · {tx.splits.length} parts
      </span>
    );
  }
  if (!tx.categoryName) return <span className="italic text-warning">Uncategorised</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {tx.categoryIcon && <span aria-hidden>{tx.categoryIcon}</span>}
      <span className="truncate">{tx.categoryName}</span>
    </span>
  );
}

function TxIcon({ tx }: { tx: Transaction }) {
  const income = tx.amountMinor > 0;
  return (
    <span
      className={`grid size-9 shrink-0 place-items-center rounded-xl text-base ${income ? 'bg-income/12 text-income' : 'bg-expense/10 text-expense'}`}
      aria-hidden
    >
      {!tx.isSplit && tx.categoryIcon ? tx.categoryIcon : income ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
    </span>
  );
}

function Row({ tx, index, today, fmt }: { tx: Transaction; index: number; today: string; fmt: MoneyFormat }) {
  const income = tx.amountMinor > 0;
  return (
    <motion.tr
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 + index * 0.035, duration: 0.3 }}
      className="group transition-colors hover:bg-subtle"
    >
      <td className="w-full max-w-0 py-3 pl-2 pr-3 sm:pl-3">
        <div className="flex min-w-0 items-center gap-3">
          <TxIcon tx={tx} />
          <div className="min-w-0">
            <p className="truncate font-medium">{tx.payee || 'No payee'}</p>
            <p className="truncate text-xs text-muted">
              <span className="sm:hidden">
                <CategoryLabel tx={tx} /> ·{' '}
              </span>
              {tx.notes || tx.accountName}
            </p>
          </div>
        </div>
      </td>
      <td className="hidden max-w-44 py-3 pr-3 text-sm sm:table-cell">
        <CategoryLabel tx={tx} />
      </td>
      <td className="hidden max-w-36 truncate py-3 pr-3 text-sm text-muted lg:table-cell">
        <span>{tx.accountName}</span>
      </td>
      <td className="whitespace-nowrap py-3 pr-3 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          {relativeDay(tx.date, today, fmt.locale)}
          {tx.reconciled ? (
            <Lock className="size-3.5 text-muted" aria-label="Reconciled" />
          ) : tx.cleared ? (
            <CheckCircle2 className="size-3.5 text-income" aria-label="Cleared" />
          ) : null}
        </span>
      </td>
      <td className={`whitespace-nowrap py-3 pr-2 text-right font-semibold tabular-nums sm:pr-3 ${income ? 'text-income' : 'text-fg'}`}>
        {formatMoney(tx.amountMinor, fmt, { signed: true })}
      </td>
    </motion.tr>
  );
}

export function RecentTransactions({ today, className = '' }: { today: string; className?: string }) {
  const fmt = useMoneyFormat();
  const query = useRecentTransactions(LIMIT, today);
  const data = query.data;

  return (
    <Panel
      title="Recent transactions"
      icon={ReceiptText}
      className={className}
      action={
        <Link to="/transactions" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
          View all <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      }
    >
      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !data || data.transactions.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No transactions yet">
          <Link to="/transactions" className="font-medium text-accent hover:underline">
            Add one
          </Link>{' '}
          or{' '}
          <Link to="/import" className="font-medium text-accent hover:underline">
            import a CSV
          </Link>{' '}
          from your bank.
        </EmptyState>
      ) : (
        <>
          <div className="-mx-2 overflow-x-auto sm:-mx-3">
            <table className="w-full text-sm">
              <caption className="sr-only">Your {data.transactions.length} most recent transactions</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="pb-2 pl-2 pr-3 font-medium sm:pl-3">Payee</th>
                  <th scope="col" className="hidden pb-2 pr-3 font-medium sm:table-cell">Category</th>
                  <th scope="col" className="hidden pb-2 pr-3 font-medium lg:table-cell">Account</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Date</th>
                  <th scope="col" className="pb-2 pr-2 text-right font-medium sm:pr-3">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.transactions.map((tx, i) => (
                  <Row key={tx.id} tx={tx} index={i} today={today} fmt={fmt} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            Showing {data.transactions.length} of {data.total.toLocaleString(fmt.locale)} transaction{data.total === 1 ? '' : 's'}
          </p>
        </>
      )}
    </Panel>
  );
}
