import { motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import type { BudgetMonth } from '../../types/api';
import { rise } from '../dashboard/ui';

function Notice({ tone, icon: Icon, children }: { tone: 'danger' | 'warn' | 'info'; icon: LucideIcon; children: ReactNode }) {
  const box = {
    danger: 'border-expense/35 bg-expense/10',
    warn: 'border-warning/35 bg-warning/10',
    info: 'border-accent/25 bg-accent/8',
  }[tone];
  const ic = { danger: 'text-expense', warn: 'text-warning', info: 'text-accent' }[tone];
  return (
    <div role={tone === 'info' ? 'status' : 'alert'} className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${box}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${ic}`} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const ACTION = 'inline-flex items-center gap-1 font-semibold text-accent hover:underline';

export function BudgetNotices({
  view,
  fmt,
  onCoverFirst,
}: {
  view: BudgetMonth;
  fmt: MoneyFormat;
  /** Opens "Cover overspending" for the most overspent visible category. */
  onCoverFirst: () => void;
}) {
  const items: ReactNode[] = [];
  const tb = view.toBudgetMinor;

  if (tb < 0) {
    items.push(
      <Notice key="over" tone="danger" icon={AlertTriangle}>
        <b>Overbudgeted by {formatMoney(-tb, fmt)}.</b> You have assigned more than you have. Lower an Assigned amount, or add
        income.
      </Notice>,
    );
  }
  if (view.overspentCount > 0) {
    items.push(
      <Notice key="overspent" tone="warn" icon={AlertTriangle}>
        <b>
          {view.overspentCount} {view.overspentCount === 1 ? 'category is' : 'categories are'} overspent by{' '}
          {formatMoney(view.overspentMinor, fmt)}.
        </b>{' '}
        Cover it from another category, or it comes out of next month’s To Budget (unless that category rolls overspending over).{' '}
        <button type="button" onClick={onCoverFirst} className={ACTION}>
          Cover now <ArrowRight className="size-3.5" aria-hidden />
        </button>
      </Notice>,
    );
  }
  if (view.overspentLastMonthMinor > 0) {
    items.push(
      <Notice key="last" tone="info" icon={Info}>
        Last month’s overspending of {formatMoney(view.overspentLastMonthMinor, fmt)} was taken out of this month’s To Budget.
      </Notice>,
    );
  }
  if (view.uncategorizedCount > 0) {
    items.push(
      <Notice key="uncat" tone="info" icon={Info}>
        {view.uncategorizedCount} {view.uncategorizedCount === 1 ? 'transaction' : 'transactions'} with no category (
        {formatMoney(view.uncategorizedSpendMinor, fmt)} spent) came straight out of To Budget.{' '}
        <Link to={`/transactions?month=${view.month}&category=none`} className={ACTION}>
          Categorize them <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </Notice>,
    );
  }

  if (!items.length) return null;
  return (
    <motion.div variants={rise} className="space-y-2.5">
      {items}
    </motion.div>
  );
}
