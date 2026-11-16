import { AlertTriangle, ArrowRight, CircleCheck, PiggyBank } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatDate, formatMoney, monthName, type MoneyFormat } from '../../lib/format';
import type { BudgetImpact } from '../../types/forecast';
import { EmptyState, Panel } from '../dashboard/ui';

/**
 * What the scheduled money does to the envelope budget, month by month (forecast.categoryImpact). The server
 * runs the real budget engine with and without the scheduled events, so carry-over and overspending behave
 * exactly as they will once the transactions exist.
 */
export function BudgetImpactPanel({ impact, fmt }: { impact: BudgetImpact; fmt: MoneyFormat }) {
  const months = impact.months;
  const firstProblem = months.find((m) => m.categories.some((c) => c.overspent))?.month;
  const [picked, setPicked] = useState<string | null>(null);
  const month = months.find((m) => m.month === picked) ?? months.find((m) => m.month === firstProblem) ?? months[0];
  const locale = fmt.locale;
  const shortNames = [...new Set(months.flatMap((m) => m.categories.filter((c) => c.overspent).map((c) => c.name)))];
  const shortMonths = months.filter((m) => m.categories.some((c) => c.overspent)).length;

  return (
    <Panel title="Budget impact" icon={PiggyBank}>
      {!month ? (
        <EmptyState icon={PiggyBank} title="Nothing scheduled touches your budget">
          {impact.offBudgetEvents > 0 ? `${impact.offBudgetEvents} scheduled item${impact.offBudgetEvents === 1 ? ' is' : 's are'} in off-budget accounts.` : null}
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {impact.overspentCategories > 0 ? (
            <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <b>{listNames(shortNames)}</b> won't have enough for what's scheduled
                {shortMonths > 1 ? ` in ${shortMonths} months` : ''}. Assign more money before the bills arrive.
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-xl border border-income/30 bg-income/10 px-3.5 py-2.5 text-sm text-income">
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              Your budget covers everything scheduled.
            </p>
          )}

          {months.length > 1 && (
            <div role="group" aria-label="Month" className="flex gap-1 overflow-x-auto rounded-xl bg-subtle p-1">
              {months.map((m) => {
                const bad = m.categories.some((c) => c.overspent);
                const on = m.month === month.month;
                return (
                  <button
                    key={m.month}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(m.month)}
                    className={`flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                      on ? 'bg-elevated text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg'
                    }`}
                  >
                    {formatDate(`${m.month}-01`, locale, m.month.slice(0, 4) === months[0].month.slice(0, 4) ? { month: 'short' } : { month: 'short', year: 'numeric' })}
                    {bad && <AlertTriangle className="size-3 text-warning" aria-label="overspent" />}
                  </button>
                );
              })}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-subtle px-3 py-2">
              <dt className="text-xs text-muted">To Budget now</dt>
              <dd className={`font-semibold tabular-nums ${month.toBudgetMinor < 0 ? 'text-expense' : ''}`}>{formatMoney(month.toBudgetMinor, fmt)}</dd>
            </div>
            <div className="rounded-xl bg-subtle px-3 py-2">
              <dt className="text-xs text-muted">After what's scheduled</dt>
              <dd className={`font-semibold tabular-nums ${month.projectedToBudgetMinor < 0 ? 'text-expense' : ''}`}>{formatMoney(month.projectedToBudgetMinor, fmt)}</dd>
            </div>
          </dl>
          {(month.scheduledIncomeMinor > 0 || month.scheduledUncategorizedExpenseMinor > 0) && (
            <p className="text-xs text-muted">
              {month.scheduledIncomeMinor > 0 && <>Scheduled income adds {formatMoney(month.scheduledIncomeMinor, fmt)} to To Budget. </>}
              {month.scheduledUncategorizedExpenseMinor > 0 && <>{formatMoney(month.scheduledUncategorizedExpenseMinor, fmt)} of bills have no category, so they come out of To Budget.</>}
            </p>
          )}

          {month.categories.length === 0 ? (
            <p className="text-sm text-muted">No scheduled spending in a budget category this month.</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Scheduled spending by category in {monthName(month.month, locale)}</caption>
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1.5 text-left font-medium">
                    Category
                  </th>
                  <th scope="col" className="py-1.5 pl-2 text-right font-medium">
                    Scheduled
                  </th>
                  <th scope="col" className="py-1.5 pl-2 text-right font-medium">
                    Left after
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {month.categories.map((c) => (
                  <tr key={c.categoryId}>
                    <th scope="row" className="py-2 text-left font-medium">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span aria-hidden>{c.icon}</span>
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="block text-[11px] font-normal text-muted">Available now {formatMoney(c.availableMinor, fmt)}</span>
                    </th>
                    <td className="py-2 pl-2 text-right">{formatMoney(c.scheduledMinor, fmt)}</td>
                    <td className="py-2 pl-2 text-right">
                      <span className={`font-semibold ${c.overspent ? 'text-expense' : ''}`}>{formatMoney(c.projectedAvailableMinor, fmt)}</span>
                      {c.overspent && (
                        <span className="flex items-center justify-end gap-1 text-[11px] font-medium text-warning">
                          <AlertTriangle className="size-3" aria-hidden /> short {formatMoney(c.shortfallMinor, fmt)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>{impact.offBudgetEvents > 0 ? `${impact.offBudgetEvents} off-budget item${impact.offBudgetEvents === 1 ? '' : 's'} not counted.` : ''}</span>
            <Link to={`/budget/${month.month}`} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
              Open {monthName(month.month, locale)} budget <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** "Bills", "Bills and Food", "Bills, Food and 2 more". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}
