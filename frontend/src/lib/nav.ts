import {
  ArrowLeftRight,
  LayoutDashboard,
  CalendarDays,
  Receipt,
  Repeat,
  Scale,
  Settings,
  Telescope,
  TrendingUp,
  Upload,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Backend endpoints this screen will use. */
  endpoints: string[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        path: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        description: 'Your money at a glance: balances, cash flow, budget and insights.',
        endpoints: ['GET /api/accounts', 'GET /api/reports/monthly-summary', 'GET /api/reports/cashflow', 'GET /api/reports/insights'],
      },
      {
        path: '/budget',
        label: 'Budget',
        icon: Wallet,
        description: 'Give every rupee a job: assign, roll over and move money between categories.',
        endpoints: ['GET /api/budget/:month', 'PATCH /api/budget/:month/categories/:id', 'POST /api/budget/:month/transfers'],
      },
      {
        path: '/transactions',
        label: 'Transactions',
        icon: ArrowLeftRight,
        description: 'Every account in one list, with filters, splits and bulk edits.',
        endpoints: ['GET /api/transactions', 'POST /api/transactions', 'POST /api/transactions/bulk'],
      },
      {
        path: '/reports',
        label: 'Reports',
        icon: TrendingUp,
        description: 'Spending, income, cash flow, net worth and plain-language insights.',
        endpoints: ['GET /api/reports/spending', 'GET /api/reports/cashflow', 'GET /api/reports/net-worth', 'GET /api/reports/insights'],
      },
    ],
  },
  {
    title: 'Planning',
    items: [
      {
        path: '/schedules',
        label: 'Schedules',
        icon: Repeat,
        description: 'Recurring transactions that post themselves or wait for your approval.',
        endpoints: ['GET /api/schedules', 'POST /api/schedules', 'GET /api/schedule-occurrences'],
      },
      {
        path: '/bills',
        label: 'Bills',
        icon: Receipt,
        description: "What's due, what's overdue and what's already paid.",
        endpoints: ['GET /api/bills'],
      },
      {
        path: '/calendar',
        label: 'Calendar',
        icon: CalendarDays,
        description: 'Scheduled income and bills, day by day.',
        endpoints: ['GET /api/calendar'],
      },
      {
        path: '/forecast',
        label: 'Forecast',
        icon: Telescope,
        description: 'Projected balances from your schedules and their impact on the budget.',
        endpoints: ['GET /api/forecast'],
      },
    ],
  },
  {
    title: 'Manage',
    items: [
      {
        path: '/payees',
        label: 'Payees',
        icon: Users,
        description: 'Merge duplicates, archive old ones and set default categories.',
        endpoints: ['GET /api/payees', 'POST /api/payees/:id/merge'],
      },
      {
        path: '/rules',
        label: 'Rules',
        icon: Workflow,
        description: 'Categorise and tidy transactions automatically as they arrive.',
        endpoints: ['GET /api/rules', 'POST /api/rules/reorder', 'POST /api/rules/reprocess'],
      },
      {
        path: '/reconcile',
        label: 'Reconcile',
        icon: Scale,
        description: 'Match an account against your bank statement.',
        endpoints: ['GET /api/accounts/:id/reconciliation', 'POST /api/accounts/:id/reconcile'],
      },
      {
        path: '/import',
        label: 'Import',
        icon: Upload,
        description: 'Bring in a CSV from your bank or an old SpendWise backup.',
        endpoints: ['POST /api/import/csv/preview', 'POST /api/import/csv/commit', 'POST /api/import/spendwise-backup'],
      },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = {
  path: '/settings',
  label: 'Settings',
  icon: Settings,
  description: 'Accounts, categories, exports and preferences.',
  endpoints: ['GET /api/accounts', 'GET /api/categories', 'GET /api/export/full.json'],
};

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_SECTIONS.flatMap((s) => s.items), SETTINGS_ITEM];

/** The nav item for a URL, including nested paths such as /reports/net-worth. */
export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
}
