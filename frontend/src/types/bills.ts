/* ---------------------------------------------------------------------
   GET /api/bills (server/routes/forecast.js → server/forecast.js bills()).
   Bills are scheduled EXPENSES only: amounts are negative.
   --------------------------------------------------------------------- */

import type { ScheduleMode } from './schedules';

export interface DueBill {
  scheduleId: number;
  /** Set when it is waiting for approval; null for one that will happen on its date. */
  occurrenceId: number | null;
  name: string;
  payee: string;
  categoryName: string | null;
  categoryIcon: string | null;
  accountName: string;
  dueDate: string;
  amountMinor: number;
  status: 'overdue' | 'due' | 'upcoming';
  awaitingApproval: boolean;
  mode: ScheduleMode;
  /** Negative when overdue. */
  daysFromToday: number;
  note?: string;
}

export interface PaidBill {
  scheduleId: number;
  occurrenceId: number;
  name: string;
  payee: string;
  categoryName: string | null;
  categoryIcon: string | null;
  accountName: string;
  dueDate: string;
  paidDate: string;
  amountMinor: number;
  transactionId: number | null;
  status: 'paid';
}

export interface SkippedBill {
  scheduleId: number;
  occurrenceId: number;
  name: string;
  dueDate: string;
  amountMinor: number;
  accountName: string;
  status: 'skipped';
}

export interface BillsResponse {
  asOf: string;
  upcomingDays: number;
  paidDays: number;
  accountId: number | null;
  overdue: DueBill[];
  upcoming: DueBill[];
  paid: PaidBill[];
  skipped: SkippedBill[];
  totals: {
    overdueMinor: number;
    overdueCount: number;
    upcomingMinor: number;
    upcomingCount: number;
    paidMinor: number;
    paidCount: number;
    subscriptionsMonthlyMinor: number;
    subscriptionCount: number;
  };
  truncated: boolean;
}
