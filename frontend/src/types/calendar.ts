/* ---------------------------------------------------------------------
   GET /api/calendar?month=YYYY-MM&account=<id> (server/forecast.js
   calendar(), events from makeEvent()).
   --------------------------------------------------------------------- */

import type { ScheduleMode } from './schedules';

/** posted: a transaction was created · pending: waiting for approval · skipped · projected: still to come. */
export type CalendarEventState = 'posted' | 'pending' | 'skipped' | 'projected';

export interface CalendarEvent {
  key: string;
  source: 'schedule';
  scheduleId: number;
  occurrenceId: number | null;
  transactionId: number | null;
  date: string;
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
  state: CalendarEventState;
  overdue: boolean;
  mode: ScheduleMode;
  note: string;
}

export interface CalendarDay {
  date: string;
  events: CalendarEvent[];
  incomeMinor: number;
  expenseMinor: number;
}

export interface CalendarResponse {
  month: string;
  today: string;
  from: string;
  to: string;
  accountId: number | null;
  prevMonth: string;
  nextMonth: string;
  /** Only days that have something on them. */
  days: CalendarDay[];
  totals: { incomeMinor: number; expenseMinor: number; netMinor: number };
  truncated: boolean;
}
