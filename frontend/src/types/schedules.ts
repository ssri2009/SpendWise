/* ---------------------------------------------------------------------
   Scheduled / recurring transactions: server/schedules.js toJson(),
   occToJson() and server/routes/schedules.js. Forecast events come from
   server/forecast.js makeEvent().
   --------------------------------------------------------------------- */

export type ScheduleFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type ScheduleUnit = 'day' | 'week' | 'month' | 'year';
export type ScheduleMode = 'auto' | 'approval';
export type ScheduleStatus = 'active' | 'paused' | 'finished';
export type OccurrenceStatus = 'pending' | 'posted' | 'skipped';

export interface Schedule {
  id: number;
  name: string;
  accountId: number;
  accountName: string;
  accountClosed: boolean;
  payeeId: number | null;
  payee: string;
  categoryId: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  /** Negative = expense, positive = income. Never zero. */
  amountMinor: number;
  kind: 'expense' | 'income';
  notes: string;
  cleared: boolean;
  mode: ScheduleMode;
  frequency: ScheduleFrequency;
  interval: number;
  unit: ScheduleUnit;
  /** "Monthly", "Every 3 months", "One time". */
  frequencyLabel: string;
  /** Average per month, always positive. 0 for one-time schedules. */
  monthlyEquivalentMinor: number;
  startDate: string;
  endDate: string | null;
  /** The next occurrence not handled yet; null once finished. */
  nextDate: string | null;
  status: ScheduleStatus;
  paused: boolean;
  /** Occurrences waiting for approval. */
  pendingCount: number;
}

export interface Occurrence {
  id: number;
  scheduleId: number;
  scheduleName: string;
  accountId: number;
  accountName: string;
  payee: string;
  categoryName: string | null;
  categoryIcon: string | null;
  dueDate: string;
  status: OccurrenceStatus;
  amountMinor: number;
  transactionId: number | null;
  paidDate: string | null;
  paidAmountMinor: number | null;
  note: string;
  resolvedAt: string | null;
  overdue: boolean;
}

/** What runDue() did as a side effect of a write. */
export interface GeneratedSummary {
  posted: number;
  pending: number;
  duplicates: number;
  more: boolean;
}

export interface SchedulesResponse {
  schedules: Schedule[];
  /** The server's today (its own time zone), YYYY-MM-DD. */
  today: string;
}

export interface ScheduleDetailResponse {
  schedule: Schedule;
  /** Up to 6 dates still to come (empty while paused). */
  upcomingDates: string[];
  /** Latest 60, newest first. */
  occurrences: Occurrence[];
}

export interface OccurrencesResponse {
  occurrences: Occurrence[];
  today: string;
}

export interface ScheduleWriteResponse {
  schedule: Schedule;
  generated: GeneratedSummary;
}

export interface ResumeResponse extends ScheduleWriteResponse {
  skipped: number;
}

export interface HandleNextResponse {
  schedule: Schedule;
  dueDate: string;
  transactionId?: number;
}

/** Body for POST /api/schedules and PATCH /api/schedules/:id. */
export interface ScheduleInput {
  name: string;
  accountId: number;
  amountMinor: number;
  payee: string;
  categoryId: number | null;
  notes: string;
  cleared: boolean;
  mode: ScheduleMode;
  frequency: ScheduleFrequency;
  interval?: number;
  unit?: ScheduleUnit;
  startDate: string;
  endDate: string | null;
}

/** Optional overrides when approving / paying early: { amountMinor, date, notes, cleared }. */
export interface PayOverrides {
  amountMinor?: number;
  date?: string;
  notes?: string;
  cleared?: boolean;
}

/** One scheduled event from GET /api/forecast (source === 'schedule'). */
export interface ScheduleEvent {
  key: string;
  source: 'schedule' | 'transaction' | string;
  scheduleId?: number;
  occurrenceId: number | null;
  /** When it hits the balance: overdue pending items are moved to today. */
  date: string;
  /** The date it was actually due. */
  dueDate: string;
  name: string;
  payee: string;
  categoryName: string | null;
  categoryIcon: string | null;
  accountId: number;
  accountName: string;
  amountMinor: number;
  kind: 'expense' | 'income';
  /** pending = waiting for approval; projected = will happen on its date. */
  state: 'pending' | 'projected' | 'posted' | 'skipped' | string;
  overdue: boolean;
  mode?: ScheduleMode;
  note?: string;
}

export interface ForecastResponse {
  forecast: {
    asOf: string;
    days: number;
    endDate: string;
    upcomingIncomeMinor: number;
    upcomingExpensesMinor: number;
    events: ScheduleEvent[];
    truncated: boolean;
  };
}
