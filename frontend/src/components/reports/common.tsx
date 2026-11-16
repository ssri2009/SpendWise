import { AnimatePresence, motion } from 'framer-motion';
import { BarChart3, Download, Table2, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { rise } from '../dashboard/ui';

/** Glass card with a title, optional chart⇄table switch, and actions. */
export function ReportPanel({
  title,
  icon: Icon,
  subtitle,
  action,
  chart,
  table,
  children,
  className = '',
}: {
  title: ReactNode;
  icon?: LucideIcon;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** With both chart and table, the panel offers a table view (exact figures, screen-reader friendly). */
  chart?: ReactNode;
  table?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const switchable = chart !== undefined && table !== undefined;
  return (
    <motion.section variants={rise} className={`glass flex min-w-0 flex-col rounded-3xl border border-line p-5 shadow-glass sm:p-6 ${className}`}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2.5 text-base font-semibold">
            {Icon && (
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
                <Icon className="size-4" aria-hidden />
              </span>
            )}
            {title}
          </h3>
          {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          {switchable && (
            <button
              type="button"
              onClick={() => setAsTable((t) => !t)}
              aria-pressed={asTable}
              aria-label={asTable ? 'Show as chart' : 'Show as table'}
              title={asTable ? 'Show as chart' : 'Show as table'}
              className="grid size-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:bg-subtle hover:text-fg"
            >
              {asTable ? <BarChart3 className="size-4" aria-hidden /> : <Table2 className="size-4" aria-hidden />}
            </button>
          )}
        </div>
      </header>
      {switchable ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={asTable ? 'table' : 'chart'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {asTable ? <div className="max-h-96 overflow-auto">{table}</div> : chart}
          </motion.div>
        </AnimatePresence>
      ) : (
        children
      )}
      {switchable && children}
    </motion.section>
  );
}

export function StatTile({ label, value, hint, tone }: { label: string; value: string; hint?: ReactNode; tone?: 'income' | 'expense' | 'accent' }) {
  const color = tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-expense' : tone === 'accent' ? 'text-accent' : '';
  return (
    <motion.div variants={rise} className="glass min-w-0 rounded-2xl border border-line px-4 py-3.5 shadow-glass">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 truncate text-xl font-bold tracking-tight ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>}
    </motion.div>
  );
}

export function TileRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/** Plain table used by every table view. */
export function DataTable({ caption, head, rows }: { caption: string; head: { label: string; align?: 'right' }[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="sticky top-0 bg-elevated text-xs text-muted">
        <tr>
          {head.map((h, i) => (
            <th key={i} scope="col" className={`py-2 font-medium ${h.align === 'right' ? 'text-right' : 'text-left'} ${i > 0 ? 'pl-3' : ''}`}>
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line tabular-nums">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) =>
              j === 0 ? (
                <th key={j} scope="row" className="py-2 text-left font-medium">
                  {cell}
                </th>
              ) : (
                <td key={j} className={`py-2 pl-3 ${head[j]?.align === 'right' ? 'text-right' : ''}`}>
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Download the current report as CSV (GET ?format=csv; the session cookie goes with it). */
export function CsvButton({ href, label = 'CSV' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-medium transition-colors hover:border-accent/60 hover:bg-subtle"
    >
      <Download className="size-4 text-muted" aria-hidden />
      {label}
    </a>
  );
}
