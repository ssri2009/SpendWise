/* ---------------------------------------------------------------------
   Reconciliation (server/routes/reconcile.js).
   Cleared balance = opening balance + every CLEARED transaction.
   Difference = statement − cleared balance. Finishing at 0 locks every
   cleared, not-yet-locked transaction; otherwise it needs an adjustment
   (one cleared "Reconciliation Balance Adjustment" for the difference).
   Only the newest reconciliation of an account can be undone.
   --------------------------------------------------------------------- */

export interface Reconciliation {
  id: number;
  accountId: number;
  accountName: string;
  statementDate: string;
  statementBalanceMinor: number;
  /** SpendWise's cleared balance before any adjustment. */
  clearedBalanceMinor: number;
  differenceMinor: number;
  adjustmentMinor: number;
  adjustmentTransactionId: number | null;
  transactionCount: number;
  note: string;
  /** ISO timestamp. */
  reconciledAt: string;
  canUndo: boolean;
}

export interface ReconTransaction {
  id: number;
  date: string;
  amountMinor: number;
  cleared: boolean;
  isSplit: boolean;
  reconciled: boolean;
  payee: string;
  categoryName: string | null;
}

export interface ReconBalances {
  openingBalanceMinor: number;
  clearedBalanceMinor: number;
  unclearedBalanceMinor: number;
  balanceMinor: number;
  clearedCount: number;
  unclearedCount: number;
  lockedCount: number;
}

export interface ReconState extends ReconBalances {
  account: { id: number; name: string; closed: boolean };
  lastReconciliation: Reconciliation | null;
  /** Not locked yet, newest first (max 1000). */
  transactions: ReconTransaction[];
}

export interface ReconcileInput {
  statementBalanceMinor: number;
  statementDate: string;
  adjust?: boolean;
  note?: string;
}
