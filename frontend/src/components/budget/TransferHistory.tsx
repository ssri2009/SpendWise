import { ArrowRight, ChevronDown, History } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { useTransfers } from '../../hooks/useBudget';
import { formatMoney, monthName, type MoneyFormat } from '../../lib/format';
import { EmptyState, ErrorState, rise, Segmented, Skeleton } from '../dashboard/ui';

type Scope = 'month' | 'all';
const SCOPES = [
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All months' },
] as const;

/** GET /api/budget-transfers: every "move money", newest first. Loads only when opened. */
export function TransferHistory({ month, fmt }: { month: string; fmt: MoneyFormat }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>('month');
  const transfers = useTransfers(scope === 'month' ? month : null, open);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(fmt.locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  return (
    <motion.section variants={rise} className="glass rounded-3xl border border-line shadow-glass">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="transfer-history"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
      >
        <span className="flex items-center gap-2.5 text-base font-semibold">
          <span className="grid size-8 place-items-center rounded-xl bg-accent/12 text-accent">
            <History className="size-4" aria-hidden />
          </span>
          Move-money history
        </span>
        <ChevronDown className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="transfer-history"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-5 pb-5 pt-4 sm:px-6">
              <div className="mb-4">
                <Segmented options={SCOPES} value={scope} onChange={setScope} label="History range" layoutId="transfer-scope" />
              </div>

              {transfers.isPending ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-14" />
                  ))}
                </div>
              ) : transfers.isError ? (
                <ErrorState error={transfers.error} onRetry={() => transfers.refetch()} />
              ) : transfers.data.length === 0 ? (
                <EmptyState icon={History} title="No money moved yet">
                  {scope === 'month' ? `Nothing was moved between categories in ${monthName(month, fmt.locale)}.` : 'Click an Available amount to move money.'}
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {transfers.data.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          <span className="truncate">{t.fromName}</span>
                          <ArrowRight className="size-3.5 shrink-0 text-muted" aria-label="to" />
                          <span className="truncate">{t.toName}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {when(t.createdAt)}
                          {scope === 'all' && ` · ${monthName(t.month, fmt.locale)}`}
                          {t.note && ` · “${t.note}”`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">{formatMoney(t.amountMinor, fmt)}</p>
                        <p className="text-[11px] tabular-nums text-muted">
                          {formatMoney(t.fromAvailableBeforeMinor, fmt)} → {formatMoney(t.fromAvailableAfterMinor, fmt)} left
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
