import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, CircleDollarSign, HandCoins, PiggyBank, Receipt, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { formatMoney, monthName, type MoneyFormat } from '../../lib/format';
import type { BudgetMonth } from '../../types/api';
import { AnimatedNumber, rise } from '../dashboard/ui';

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  fmt,
}: {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  tone: 'accent' | 'income' | 'expense' | 'muted';
  fmt: MoneyFormat;
}) {
  const chip = {
    accent: 'bg-accent/12 text-accent',
    income: 'bg-income/12 text-income',
    expense: 'bg-expense/12 text-expense',
    muted: 'bg-subtle text-muted',
  }[tone];
  return (
    <motion.div variants={rise} className="glass sw-lift rounded-3xl border border-line p-5 shadow-glass">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{label}</p>
        <span className={`grid size-9 place-items-center rounded-xl ${chip}`}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight">
        <AnimatedNumber value={value} format={(n) => formatMoney(n, fmt)} />
      </p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </motion.div>
  );
}

/** To Budget hero + Assigned / Activity / Available, and how To Budget was worked out. */
export function BudgetSummary({ view, fmt }: { view: BudgetMonth; fmt: MoneyFormat }) {
  const [open, setOpen] = useState(false);
  const tb = view.toBudgetMinor;
  const state = tb > 0 ? 'ready' : tb === 0 ? 'done' : 'over';
  const heroTone = {
    ready: 'from-accent/25 to-accent-2/15 border-accent/40',
    done: 'from-income/20 to-income/5 border-income/40',
    over: 'from-expense/25 to-expense/5 border-expense/50',
  }[state];
  const heroText = { ready: 'text-fg', done: 'text-income', over: 'text-expense' }[state];
  const heroHint = {
    ready: 'Ready to assign. Give it a job below.',
    done: 'Every rupee has a job. Nice work!',
    over: 'Overbudgeted: assign less or add income.',
  }[state];

  const lines: { label: string; minor: number; sign: '' | '+' | '−' }[] = [
    { label: 'Left over from last month', minor: view.rolledFromLastMonthMinor, sign: '' },
    { label: `Income in ${monthName(view.month, fmt.locale)}`, minor: view.incomeMinor, sign: '+' },
  ];
  if (view.openingBalanceMinor) lines.push({ label: 'Opening balances (on-budget accounts)', minor: view.openingBalanceMinor, sign: '+' });
  if (view.uncategorizedSpendMinor) lines.push({ label: 'Spent with no category', minor: view.uncategorizedSpendMinor, sign: '−' });
  if (view.overspentLastMonthMinor) lines.push({ label: 'Overspent last month', minor: view.overspentLastMonthMinor, sign: '−' });
  lines.push({ label: 'Assigned to categories', minor: view.assignedMinor, sign: '−' });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <motion.div
          variants={rise}
          className={`glass sw-lift relative overflow-hidden rounded-3xl border bg-gradient-to-br p-5 shadow-glass sm:col-span-2 xl:col-span-1 ${heroTone}`}
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">To Budget</p>
            <span className="grid size-9 place-items-center rounded-xl accent-gradient text-accent-fg">
              <CircleDollarSign className="size-4" aria-hidden />
            </span>
          </div>
          <p className={`mt-3 text-3xl font-extrabold tracking-tight ${heroText}`}>
            <AnimatedNumber value={tb} format={(n) => formatMoney(n, fmt)} />
          </p>
          <p className="mt-1 text-xs text-muted">{heroHint}</p>
        </motion.div>
        <StatCard label="Assigned" value={view.assignedMinor} hint="Given to categories this month" icon={HandCoins} tone="accent" fmt={fmt} />
        <StatCard
          label="Activity"
          value={view.activityMinor}
          hint="Spent in categories (refunds add back)"
          icon={Receipt}
          tone={view.activityMinor < 0 ? 'expense' : 'muted'}
          fmt={fmt}
        />
        <StatCard
          label="Available"
          value={view.availableMinor}
          hint="Left in all categories"
          icon={PiggyBank}
          tone={view.availableMinor < 0 ? 'expense' : 'income'}
          fmt={fmt}
        />
      </div>

      <motion.div variants={rise} className="glass rounded-2xl border border-line">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="tb-breakdown"
          className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left text-sm font-medium"
        >
          How is To Budget worked out?
          <ChevronDown className={`size-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id="tb-breakdown"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
            >
              <dl className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
                {lines.map((l) => (
                  <div key={l.label} className="flex items-center justify-between gap-4">
                    <dt className="text-muted">{l.label}</dt>
                    <dd className="font-medium tabular-nums">
                      {l.sign && `${l.sign} `}
                      {l.sign ? formatMoney(l.minor, fmt).replace('−', '') : formatMoney(l.minor, fmt)}
                    </dd>
                  </div>
                ))}
                <div className="mt-2 flex items-center justify-between gap-4 border-t border-line pt-2.5 font-semibold">
                  <dt>To Budget</dt>
                  <dd className={`tabular-nums ${tb < 0 ? 'text-expense' : ''}`}>{formatMoney(tb, fmt)}</dd>
                </div>
              </dl>
              <p className="px-5 pb-4 text-xs text-muted">
                Unspent money in a category rolls over to next month by itself. Money spent with no category comes straight out of
                To Budget until you categorize it.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
