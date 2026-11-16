import { motion } from 'framer-motion';
import { ArrowDownUp, Eye, EyeOff, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { AddGroupInline, BudgetGrid, type GridHandlers } from '../components/budget/BudgetGrid';
import { BudgetNotices } from '../components/budget/BudgetNotices';
import { BudgetSummary } from '../components/budget/BudgetSummary';
import { CategoryDialog } from '../components/budget/CategoryDialog';
import { GroupDialog } from '../components/budget/GroupDialog';
import { MonthNav } from '../components/budget/MonthNav';
import { MoveMoneyDialog, type MoveIntent } from '../components/budget/MoveMoneyDialog';
import { TransferHistory } from '../components/budget/TransferHistory';
import { EmptyState, ErrorState, rise, Skeleton, stagger } from '../components/dashboard/ui';
import { useToast } from '../components/ui/Toast';
import { useAssign, useBudgetView, useCategoryWrites } from '../hooks/useBudget';
import { useMoneyFormat } from '../hooks/useDashboard';
import { ApiError } from '../lib/api';
import { monthName } from '../lib/format';
import { addMonths, currentMonth, isMonthKey } from '../lib/months';
import type { BudgetCategory } from '../types/api';

const COLLAPSE_KEY = 'spendwise-ui:budget-collapsed';
const HIDDEN_KEY = 'spendwise-ui:budget-show-hidden';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked */
  }
}

type DialogState = { kind: 'move'; intent: MoveIntent } | { kind: 'category'; id: number } | { kind: 'group'; id: number } | null;

/** /budget → /budget/<this month>; /budget/2026-11 → that month. */
export default function BudgetPage() {
  const param = useParams()['*']?.split('/')[0];
  if (!isMonthKey(param)) return <Navigate to={`/budget/${currentMonth()}`} replace />;
  return <BudgetMonthScreen month={param} />;
}

function BudgetMonthScreen({ month }: { month: string }) {
  const navigate = useNavigate();
  const fmt = useMoneyFormat();
  const toast = useToast();
  const budget = useBudgetView(month);
  const assign = useAssign(month);
  const { createCategory, createGroup } = useCategoryWrites();

  const [showHidden, setShowHidden] = useState(() => readJson<boolean>(HIDDEN_KEY, false));
  const [collapsed, setCollapsed] = useState(() => new Set(readJson<number[]>(COLLAPSE_KEY, [])));
  const [dialog, setDialog] = useState<DialogState>(null);

  useEffect(() => writeJson(HIDDEN_KEY, showHidden), [showHidden]);
  useEffect(() => writeJson(COLLAPSE_KEY, [...collapsed]), [collapsed]);

  const view = budget.data;
  // While the next month loads, keep showing the last one (dimmed) instead of a blank page.
  const stale = budget.isPlaceholderData;

  const allCategories = useMemo(() => view?.groups.flatMap((g) => g.categories) ?? [], [view]);
  const hiddenCount = useMemo(
    () => (view ? view.groups.reduce((n, g) => n + (g.hidden ? g.categories.length : g.categories.filter((c) => c.hidden).length), 0) : 0),
    [view],
  );
  const isShown = useCallback(
    (c: BudgetCategory) => showHidden || (!c.hidden && !view?.groups.find((g) => g.id === c.groupId)?.hidden),
    [showHidden, view],
  );

  const goTo = (m: string) => navigate(`/budget/${m}`);
  const toggleGroup = (id: number) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

  const handlers: GridHandlers = {
    onAssign: async (category, assignedMinor) => {
      try {
        await assign.mutateAsync({ categoryId: category.id, assignedMinor });
      } catch (err) {
        toast.error(errorText(err, `Could not update ${category.name}.`));
      }
    },
    onAvailable: (c) => setDialog({ kind: 'move', intent: c.availableMinor > 0 ? { fromId: c.id } : { toId: c.id } }),
    onEditCategory: (c) => setDialog({ kind: 'category', id: c.id }),
    onEditGroup: (g) => setDialog({ kind: 'group', id: g.id }),
    onAddCategory: async (group, name) => {
      try {
        await createCategory.mutateAsync({ groupId: group.id, name });
        toast.success(`Added ${name} to ${group.name}.`);
      } catch (err) {
        toast.error(errorText(err, 'Could not add the category.'));
        throw err;
      }
    },
    onInvalidAmount: () => toast.error('Enter an amount like 1500 or 1,500.50.'),
  };

  async function addGroup(name: string) {
    try {
      await createGroup.mutateAsync(name);
      toast.success(`Added group ${name}.`);
    } catch (err) {
      toast.error(errorText(err, 'Could not add the group.'));
      throw err;
    }
  }

  function coverFirst() {
    const worst = allCategories.filter((c) => c.availableMinor < 0 && isShown(c)).sort((a, b) => a.availableMinor - b.availableMinor)[0]
      ?? allCategories.filter((c) => c.availableMinor < 0).sort((a, b) => a.availableMinor - b.availableMinor)[0];
    if (worst) setDialog({ kind: 'move', intent: { toId: worst.id } });
  }

  /* ---------- header (always visible) ---------- */

  const header = (
    <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm text-muted">Give every rupee a job</p>
        <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">{monthName(month, fmt.locale)}</h2>
      </div>
      <MonthNav
        month={month}
        prev={view && !stale ? view.prevMonth : addMonths(month, -1)}
        next={view && !stale ? view.nextMonth : addMonths(month, 1)}
        locale={fmt.locale}
        loading={budget.isFetching}
        onChange={goTo}
      />
    </motion.div>
  );

  if (!view) {
    return (
      <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
        {header}
        {budget.isError ? (
          <div className="glass rounded-3xl border border-line p-6 shadow-glass">
            <ErrorState error={budget.error} onRetry={() => budget.refetch()} />
          </div>
        ) : (
          <div aria-busy="true" aria-label="Loading budget" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-3xl" />
              ))}
            </div>
            <Skeleton className="h-[28rem] rounded-3xl" />
          </div>
        )}
      </motion.div>
    );
  }

  const budgetable = view.groups;
  const moveCategories = (keep?: number) => allCategories.filter((c) => isShown(c) || c.id === keep);
  const dialogCategory = dialog?.kind === 'category' ? allCategories.find((c) => c.id === dialog.id) : undefined;
  const dialogCategoryGroup = dialogCategory ? budgetable.find((g) => g.id === dialogCategory.groupId) : undefined;
  const dialogGroupIndex = dialog?.kind === 'group' ? budgetable.findIndex((g) => g.id === dialog.id) : -1;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      {header}

      <div className={stale ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}>
        <motion.div variants={stagger} className="space-y-6">
          <BudgetSummary view={view} fmt={fmt} />
          <BudgetNotices view={view} fmt={fmt} onCoverFirst={coverFirst} />

          <motion.section variants={rise} className="glass rounded-3xl border border-line p-4 shadow-glass sm:p-6" aria-label="Categories">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Type in <b className="text-fg">Assigned</b> and press Enter. Click an <b className="text-fg">Available</b> amount to move
                money.
              </p>
              <div className="flex flex-wrap gap-2">
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowHidden((s) => !s)}
                    aria-pressed={showHidden}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-medium transition-colors hover:bg-subtle"
                  >
                    {showHidden ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                    {showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'move', intent: {} })}
                  disabled={allCategories.length < 2}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl accent-gradient px-3.5 text-xs font-semibold text-accent-fg shadow-lg shadow-accent/25 disabled:opacity-50"
                >
                  <ArrowDownUp className="size-3.5" aria-hidden /> Move money
                </button>
              </div>
            </div>

            {budgetable.length === 0 ? (
              <EmptyState icon={Wallet} title="No budget categories yet">
                Add a group (like Bills or Everyday), then add categories to it and start assigning money.
              </EmptyState>
            ) : (
              <BudgetGrid
                groups={budgetable}
                showHidden={showHidden}
                collapsed={collapsed}
                onToggleGroup={toggleGroup}
                fmt={fmt}
                handlers={handlers}
                busy={stale}
              />
            )}

            <div className="mt-4">
              <AddGroupInline onAdd={addGroup} />
            </div>
          </motion.section>

          <TransferHistory month={month} fmt={fmt} />
        </motion.div>
      </div>

      {dialog?.kind === 'move' && (
        <MoveMoneyDialog
          month={month}
          categories={moveCategories(dialog.intent.toId ?? dialog.intent.fromId)}
          intent={dialog.intent}
          fmt={fmt}
          onClose={() => setDialog(null)}
          onMoved={toast.success}
        />
      )}
      {dialogCategory && dialogCategoryGroup && (
        <CategoryDialog
          month={month}
          category={dialogCategory}
          group={dialogCategoryGroup}
          visibleIds={dialogCategoryGroup.categories.filter((c) => isShown(c) || c.id === dialogCategory.id).map((c) => c.id)}
          toBudgetMinor={view.toBudgetMinor}
          fmt={fmt}
          onClose={() => setDialog(null)}
          onDone={toast.success}
          onMove={() => setDialog({ kind: 'move', intent: dialogCategory.availableMinor > 0 ? { fromId: dialogCategory.id } : { toId: dialogCategory.id } })}
        />
      )}
      {dialog?.kind === 'group' && dialogGroupIndex >= 0 && (
        <GroupDialog
          group={budgetable[dialogGroupIndex]}
          visibleIds={budgetable.filter((g) => showHidden || !g.hidden || g.id === dialog.id).map((g) => g.id)}
          onClose={() => setDialog(null)}
          onDone={toast.success}
        />
      )}
    </motion.div>
  );
}
