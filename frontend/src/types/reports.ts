/* Response shapes of the Phase 7 reports API (server/routes/reports.js → server/reports.js).
   Every amount is integer paise. Percentages are numbers with one decimal, or null when there
   is nothing to compare against. */

export type Granularity = 'month' | 'quarter' | 'year';
export type ReportRange =
  | 'this-month' | 'last-month' | 'last-3-months' | 'last-6-months' | 'last-12-months' | 'this-year' | 'last-year' | 'all' | 'custom';

export interface ReportPeriod {
  range: ReportRange;
  from: string;
  to: string;
}

export interface Bucket {
  key: string;
  label: string;
  from: string;
  to: string;
  amountMinor: number;
}

export interface Extreme {
  key: string;
  label: string;
  amountMinor: number;
}

export interface CategoryRow {
  categoryId: number | null;
  name: string;
  icon: string;
  groupName: string;
  amountMinor: number;
  count: number;
  sharePct: number;
}

export interface PayeeRow {
  payeeId: number | null;
  name: string;
  amountMinor: number;
  count: number;
  sharePct: number;
}

export interface AccountRow {
  accountId: number;
  name: string;
  amountMinor: number;
  count: number;
  sharePct: number;
}

/* GET /api/reports/spending */
export interface SpendingReport {
  period: ReportPeriod;
  granularity: Granularity;
  totalMinor: number;
  transactionCount: number;
  averagePerDayMinor: number;
  averagePerPeriodMinor: number;
  byCategory: CategoryRow[];
  byPayee: PayeeRow[];
  byAccount: AccountRow[];
  overTime: Bucket[];
  highest: Extreme | null;
  biggest: { txId: number; date: string; payee: string; category: string; account: string; amountMinor: number }[];
}

/* GET /api/reports/income */
export interface IncomeMonth {
  key: string;
  label: string;
  partial: boolean;
  incomeMinor: number;
  changeMinor: number | null;
  changePct: number | null;
}

export interface IncomeYear {
  year: number;
  incomeMinor: number;
  changeMinor: number | null;
  changePct: number | null;
  partial: boolean;
  previousSamePeriodMinor?: number;
  samePeriodChangeMinor?: number;
  samePeriodChangePct?: number | null;
}

export interface IncomeReport {
  period: ReportPeriod;
  granularity: Granularity;
  totalMinor: number;
  transactionCount: number;
  averagePerPeriodMinor: number;
  sources: PayeeRow[];
  byCategory: CategoryRow[];
  overTime: Bucket[];
  highest: Extreme | null;
  lowest: Extreme | null;
  trend: { direction: 'up' | 'down' | 'flat'; changePct: number | null };
  monthly: IncomeMonth[];
  yearly: IncomeYear[];
}

/* GET /api/reports/cashflow */
export interface CashflowPeriodRow {
  key: string;
  label: string;
  from: string;
  to: string;
  incomeMinor: number;
  expensesMinor: number;
  netMinor: number;
  savedMinor: number;
  savingsRatePct: number | null;
}

export interface CashflowReportFull {
  period: ReportPeriod;
  granularity: Granularity;
  totals: {
    incomeMinor: number;
    expensesMinor: number;
    netMinor: number;
    savedMinor: number;
    savingsRatePct: number | null;
    averageNetPerPeriodMinor: number;
  };
  savingsAccounts: number;
  best: { key: string; label: string; net: number } | null;
  worst: { key: string; label: string; net: number } | null;
  periods: CashflowPeriodRow[];
}

/* GET /api/reports/categories */
export interface CategoryCompareRow extends CategoryRow {
  previousMinor: number;
  changeMinor: number;
  changePct: number | null;
  averagePerMonthMinor: number;
}

export interface CategorySide {
  totalMinor: number;
  previousTotalMinor: number;
  rows: CategoryCompareRow[];
}

export interface CategoryDetail {
  categoryId: number | null;
  name: string;
  icon: string;
  kind: 'income' | 'expense';
  totalMinor: number;
  overTime: { key: string; label: string; amountMinor: number }[];
  topPayees: { payeeId: number | null; name: string; amountMinor: number; count: number }[];
  largest: { txId: number; date: string; payee: string; account: string; amountMinor: number; notes: string }[];
}

export interface CategoriesReport {
  period: ReportPeriod;
  granularity: Granularity;
  previous: { from: string; to: string };
  months: number;
  expense: CategorySide;
  income: CategorySide;
  detail: CategoryDetail | null;
}
