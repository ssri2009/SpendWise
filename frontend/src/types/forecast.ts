/* ---------------------------------------------------------------------
   GET /api/forecast?days=1..365&account=<id> (server/forecast.js forecast()).
   Money in the forecast = what is NOT in your balance yet: scheduled
   occurrences (projected or waiting for approval) and transactions you
   entered with a future date. Nothing is counted twice.
   --------------------------------------------------------------------- */

import type { ScheduleMode } from './schedules';

export interface ForecastEvent {
  key: string;
  /** schedule: from a schedule · ledger: a transaction you entered with a future date. */
  source: 'schedule' | 'ledger';
  scheduleId: number | null;
  occurrenceId: number | null;
  transactionId: number | null;
  /** When it hits the balance (overdue approvals are moved to today). */
  date: string;
  /** When it was due. */
  dueDate: string;
  name: string;
  payee: string;
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  accountId: number;
  accountName: string;
  offBudget: boolean;
  amountMinor: number;
  kind: 'expense' | 'income';
  /** projected · pending (waiting for approval) · entered (ledger). */
  state: 'projected' | 'pending' | 'entered';
  overdue: boolean;
  mode: ScheduleMode | null;
  note: string;
}

export interface ForecastPoint {
  date: string;
  /** Balance at the end of the day. */
  balanceMinor: number;
  incomeMinor: number;
  expenseMinor: number;
}

export interface ForecastHorizon {
  days: number;
  endDate: string;
  currentFundsMinor: number;
  upcomingIncomeMinor: number;
  upcomingExpensesMinor: number;
  estimatedBalanceMinor: number;
  lowestBalanceMinor: number;
  lowestDate: string;
  firstNegativeDate: string | null;
}

export interface ImpactCategory {
  categoryId: number;
  name: string;
  icon: string;
  groupName: string;
  /** Negative (spending). */
  scheduledMinor: number;
  count: number;
  assignedMinor: number;
  availableMinor: number;
  projectedAvailableMinor: number;
  overspent: boolean;
  shortfallMinor: number;
}

export interface ImpactMonth {
  month: string;
  toBudgetMinor: number;
  scheduledIncomeMinor: number;
  scheduledUncategorizedExpenseMinor: number;
  projectedToBudgetMinor: number;
  categories: ImpactCategory[];
}

export interface BudgetImpact {
  months: ImpactMonth[];
  categories: { categoryId: number; name: string; icon: string; groupName: string; scheduledMinor: number; count: number }[];
  /** Scheduled events in off-budget accounts: they never touch the budget. */
  offBudgetEvents: number;
  overspentCategories: number;
}

export interface Forecast extends ForecastHorizon {
  asOf: string;
  accountId: number | null;
  events: ForecastEvent[];
  timeline: ForecastPoint[];
  /** Always the 7 / 30 / 90-day summaries. */
  horizons: ForecastHorizon[];
  categoryImpact: BudgetImpact;
  truncated: boolean;
}

export interface ForecastFullResponse {
  forecast: Forecast;
}
