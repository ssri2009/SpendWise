/* Response shapes of the SpendWise v2 API (server/routes/*.js, server/reports.js, server/budget.js).
   Every amount is an integer number of paise (…Minor). */

/* ---------- GET /api/accounts ---------- */

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit' | 'investment' | 'loan' | 'other';

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  offbudget: boolean;
  closed: boolean;
  openingBalanceMinor: number;
  balanceMinor: number;
  transactionCount: number;
  sortOrder: number;
}

export interface AccountsResponse {
  accounts: Account[];
  totalFundsMinor: number;
}

/* ---------- GET /api/reports/monthly-summary ---------- */

export interface CategoryShare {
  categoryId: number | null;
  name: string;
  icon: string;
  groupName: string;
  amountMinor: number;
  count: number;
  sharePct: number;
}

export interface PeriodTotals {
  incomeMinor: number;
  expensesMinor: number;
  netMinor: number;
  savingsRatePct: number | null;
}

export interface MonthlySummary extends PeriodTotals {
  month: string;
  from: string;
  to: string;
  isCurrent: boolean;
  daysElapsed: number;
  daysInMonth: number;
  comparedWith: { from: string; to: string; label: string; sameDays: boolean };
  previous: PeriodTotals;
  changes: {
    incomeMinor: number;
    expensesMinor: number;
    netMinor: number;
    incomePct: number | null;
    expensesPct: number | null;
  };
  averageDailyExpenseMinor: number;
  transactionCount: number;
  topCategories: CategoryShare[];
  daily: { date: string; incomeMinor: number; expensesMinor: number; future: boolean }[];
  budget: {
    assignedMinor: number;
    activityMinor: number;
    availableMinor: number;
    toBudgetMinor: number;
    overspentCount: number;
    overspentMinor: number;
    uncategorizedCount: number;
  } | null;
}

/* ---------- GET /api/reports/cashflow ---------- */

export interface CashflowPeriod {
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

export interface CashflowReport {
  period: { range: string; from: string; to: string };
  granularity: 'month' | 'quarter' | 'year';
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
  periods: CashflowPeriod[];
}

/* ---------- GET /api/budget/:month ---------- */

export interface BudgetCategory {
  id: number;
  groupId: number;
  name: string;
  icon: string;
  hidden: boolean;
  carryInMinor: number;
  assignedMinor: number;
  /** Signed: spending is negative, refunds positive. */
  activityMinor: number;
  availableMinor: number;
  overspent: boolean;
  carryover: boolean;
}

export interface BudgetGroup {
  id: number;
  name: string;
  hidden: boolean;
  categories: BudgetCategory[];
  totals: { assignedMinor: number; activityMinor: number; availableMinor: number };
}

export interface BudgetMonth {
  month: string;
  prevMonth: string;
  nextMonth: string;
  toBudgetMinor: number;
  incomeMinor: number;
  openingBalanceMinor: number;
  rolledFromLastMonthMinor: number;
  overspentLastMonthMinor: number;
  assignedMinor: number;
  activityMinor: number;
  availableMinor: number;
  overspentCount: number;
  overspentMinor: number;
  uncategorizedCount: number;
  uncategorizedSpendMinor: number;
  groups: BudgetGroup[];
}

/* ---------- GET /api/transactions ---------- */

export interface TransactionSplit {
  id: number;
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  /** Signed, like the transaction. All splits add up to the transaction's amount. */
  amountMinor: number;
  notes: string | null;
}

export interface Transaction {
  id: number;
  accountId: number;
  accountName: string;
  date: string;
  amountMinor: number;
  payeeId: number | null;
  payee: string;
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  notes: string | null;
  cleared: boolean;
  isSplit: boolean;
  splits: TransactionSplit[];
  reconciled: boolean;
  reconciliationId: number | null;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  total: number;
  summary: { incomeMinor: number; expenseMinor: number; netMinor: number; totalFundsMinor: number };
}

/* ---------- GET /api/reports/insights ---------- */

export type InsightLevel = 'warn' | 'good' | 'info';

export interface Insight {
  id: string;
  level: InsightLevel;
  title: string;
  detail: string;
  link?: string;
}

export interface InsightsResponse {
  asOf: string;
  insights: Insight[];
}

/* ---------- GET /api/reports/net-worth ---------- */

export interface NetWorthPoint {
  date: string;
  label: string;
  assetsMinor: number;
  liabilitiesMinor: number;
  netWorthMinor: number;
}

export interface NetWorthReport {
  asOf: string;
  current: {
    assetsMinor: number;
    liabilitiesMinor: number;
    netWorthMinor: number;
    groups: {
      type: AccountType;
      label: string;
      kind: 'asset' | 'liability';
      balanceMinor: number;
      accounts: { accountId: number; name: string; closed: boolean; balanceMinor: number }[];
    }[];
  };
  series: NetWorthPoint[];
  change: {
    overRangeMinor: number;
    overRangePct: number | null;
    sinceLastMonthEndMinor: number | null;
    from: string;
  };
  trend: 'up' | 'down' | 'flat';
  hasLiabilities: boolean;
}

/* ---------- GET /api/budget-transfers (server/budget.js listTransfers) ---------- */

export interface BudgetTransfer {
  id: number;
  month: string;
  fromCategoryId: number | null;
  toCategoryId: number | null;
  fromName: string;
  toName: string;
  amountMinor: number;
  fromAvailableBeforeMinor: number;
  fromAvailableAfterMinor: number;
  toAvailableBeforeMinor: number;
  toAvailableAfterMinor: number;
  note: string | null;
  /** ISO timestamp (UTC). */
  createdAt: string;
}

/* ---------- GET /api/categories (server/routes/categories.js tree) ---------- */

export interface CategoryNode {
  id: number;
  groupId: number;
  name: string;
  icon: string;
  hidden: boolean;
  sortOrder: number;
  transactionCount: number;
}

export interface CategoryGroupNode {
  id: number;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  sortOrder: number;
  categories: CategoryNode[];
}

export interface CategoriesResponse {
  groups: CategoryGroupNode[];
}

/* ---------- GET /api/payees (server/routes/payees.js) ---------- */

export interface Payee {
  id: number;
  name: string;
  archived: boolean;
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  usageCount: number;
  lastUsed: string | null;
  ruleCount: number;
}

export interface PayeesResponse {
  payees: Payee[];
  total: number;
}

/* ---------- POST /api/transactions, PATCH /api/transactions/:id ---------- */

export interface SplitInput {
  categoryId: number | null;
  amountMinor: number;
  notes?: string;
}

export interface TransactionInput {
  accountId: number;
  date: string;
  amountMinor: number;
  payee: string;
  categoryId?: number | null;
  notes: string;
  cleared: boolean;
  /** Array = split into these parts; null (PATCH only) = unsplit. */
  splits?: SplitInput[] | null;
}

/** server/rules.js runRules(): the rules that changed a new transaction. */
export interface RuleApplied {
  id: number;
  name: string;
}

/* ---------- POST /api/transactions/bulk ---------- */

export interface BulkChanges {
  categoryId?: number | null;
  accountId?: number;
  date?: string;
  cleared?: boolean;
}

/* ---------- POST /api/import/csv/preview | commit (server/routes/csvimport.js) ---------- */

export const CSV_FIELDS = ['date', 'payee', 'category', 'account', 'notes', 'amount', 'debit', 'credit', 'cleared', 'type'] as const;
export type CsvField = (typeof CSV_FIELDS)[number];
export type CsvMapping = Record<CsvField, number | null>;

export interface CsvOptions {
  csv: string;
  accountId: number;
  mapping?: CsvMapping | null;
  hasHeader?: boolean;
  dateFormat?: 'auto' | 'DMY' | 'MDY' | 'YMD';
  amountMode?: 'signed' | 'inverted';
  createAccounts?: boolean;
  duplicates?: 'skip' | 'import';
  decisions?: Record<string, 'import' | 'skip'>;
  applyRules?: boolean;
  onErrors?: 'skip' | 'abort';
}

export interface CsvRow {
  n: number;
  status: 'new' | 'duplicate' | 'error';
  action: 'import' | 'skip' | 'error';
  errors: string[];
  date: string | null;
  amountMinor: number | null;
  payee: string;
  category: string;
  newCategory: boolean;
  account: string;
  newAccount: boolean;
  notes: string;
  cleared: boolean;
  repeat: boolean;
  duplicateOf: { id: number; date: string; amountMinor: number; payee: string; accountName: string } | null;
  raw: string[];
}

export interface CsvPreview {
  delimiter: string;
  headers: string[];
  columnCount: number;
  totalRows: number;
  truncated: boolean;
  mapping: CsvMapping;
  suggestedMapping: CsvMapping;
  sample: string[][];
  needsMapping: boolean;
  summary: {
    totalRows: number;
    newRows: number;
    duplicateRows: number;
    errorRows: number;
    repeatedInFile: number;
    willImport: number;
    willSkip: number;
    newCategories: string[];
    newAccounts: string[];
    clearedRows: number;
  } | null;
  rows: CsvRow[];
}

export interface CsvCommitResult {
  totalRows: number;
  imported: number;
  skippedDuplicates: number;
  importedDuplicates: number;
  skippedByChoice: number;
  errorRows: number;
  repeatedInFile: number;
  clearedImported: number;
  newCategories: string[];
  newAccounts: string[];
  rules: { rowsTouchedByRules: number; category: number; payee: number; notes: number; cleared: number } | null;
  truncated: boolean;
  errors: { n: number; errors: string[]; raw: string[] }[];
}
