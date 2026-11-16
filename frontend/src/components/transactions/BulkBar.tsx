import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, CheckCircle2, Circle, FolderInput, Tags, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { localToday } from '../../lib/format';
import type { Account, BulkChanges, CategoryGroupNode } from '../../types/api';
import { CONTROL } from '../ui/Dialog';
import { AccountSelect, CategorySelect } from './pickers';

type Mode = null | 'category' | 'account' | 'date';

const BTN =
  'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/** Sticky bar for POST /api/transactions/bulk on the selected rows. */
export function BulkBar({
  count,
  accounts,
  groups,
  busy,
  onUpdate,
  onDelete,
  onClear,
}: {
  count: number;
  accounts: Account[];
  groups: CategoryGroupNode[];
  busy: boolean;
  onUpdate: (changes: BulkChanges, label: string) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(accounts.find((a) => !a.closed)?.id ?? null);
  const [date, setDate] = useState(localToday());

  const apply = () => {
    if (mode === 'category') onUpdate({ categoryId }, 'Category set');
    if (mode === 'account' && accountId !== null) onUpdate({ accountId }, 'Moved');
    if (mode === 'date' && date) onUpdate({ date }, 'Date set');
    setMode(null);
  };

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          role="toolbar"
          aria-label={`${count} selected`}
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
          className="fixed inset-x-3 bottom-4 z-40 mx-auto max-w-4xl rounded-2xl border border-line bg-elevated p-2.5 shadow-glass sm:inset-x-6"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-2 pl-1.5 pr-1 text-sm font-semibold">
              <span className="grid h-6 min-w-6 place-items-center rounded-full accent-gradient px-1.5 text-xs text-accent-fg">{count}</span>
              selected
            </span>

            {mode === null ? (
              <>
                <button type="button" className={`${BTN} hover:bg-subtle`} onClick={() => setMode('category')} disabled={busy}>
                  <Tags className="size-3.5" aria-hidden /> Category
                </button>
                <button type="button" className={`${BTN} hover:bg-subtle`} onClick={() => setMode('account')} disabled={busy}>
                  <FolderInput className="size-3.5" aria-hidden /> Account
                </button>
                <button type="button" className={`${BTN} hover:bg-subtle`} onClick={() => setMode('date')} disabled={busy}>
                  <CalendarDays className="size-3.5" aria-hidden /> Date
                </button>
                <button type="button" className={`${BTN} hover:bg-subtle`} onClick={() => onUpdate({ cleared: true }, 'Marked cleared')} disabled={busy}>
                  <CheckCircle2 className="size-3.5 text-income" aria-hidden /> Cleared
                </button>
                <button type="button" className={`${BTN} hover:bg-subtle`} onClick={() => onUpdate({ cleared: false }, 'Marked not cleared')} disabled={busy}>
                  <Circle className="size-3.5" aria-hidden /> Not cleared
                </button>
                <button type="button" className={`${BTN} text-expense hover:bg-expense/10`} onClick={onDelete} disabled={busy}>
                  <Trash2 className="size-3.5" aria-hidden /> Delete
                </button>
              </>
            ) : (
              <form
                className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  apply();
                }}
              >
                {mode === 'category' && (
                  <CategorySelect groups={groups} value={categoryId} onChange={setCategoryId} aria-label="Category for the selected" className={`${CONTROL} h-9 max-w-64 text-xs`} autoFocus />
                )}
                {mode === 'account' && (
                  <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} aria-label="Account for the selected" className={`${CONTROL} h-9 max-w-64 text-xs`} autoFocus />
                )}
                {mode === 'date' && (
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date for the selected" className={`${CONTROL} h-9 max-w-48 text-xs`} autoFocus />
                )}
                <button type="submit" className={`${BTN} accent-gradient text-accent-fg`} disabled={busy}>
                  Apply to {count}
                </button>
                <button type="button" className={`${BTN} hover:bg-subtle`} onClick={() => setMode(null)}>
                  Back
                </button>
                {mode === 'category' && <span className="text-[11px] text-muted">Split transactions keep their splits.</span>}
              </form>
            )}

            <button type="button" onClick={onClear} aria-label="Clear selection (Esc)" className="ml-auto grid size-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['j / ↓', 'Next transaction'],
  ['k / ↑', 'Previous transaction'],
  ['Home / End', 'First / last loaded'],
  ['Enter or e', 'Edit the highlighted one'],
  ['x or Space', 'Select / deselect it'],
  ['Shift + x', 'Select a range up to it'],
  ['a', 'Select all loaded (again to clear)'],
  ['c', 'Toggle cleared'],
  ['Delete', 'Delete the selection (or the highlighted one)'],
  ['n', 'New transaction'],
  ['i', 'Import a CSV'],
  ['f', 'Show / hide filters'],
  ['/', 'Search'],
  ['Esc', 'Clear selection'],
  ['Ctrl + Enter', 'Save (in the editor)'],
  ['?', 'This list'],
];
