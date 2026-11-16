import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { budgetKeys } from './useBudget';
import { afterTransactionWrite } from './useTransactions';

/* POST /api/import/spendwise-backup (server/routes/dataio.js). */

export interface BackupImportResult {
  added: number;
  duplicates: number;
  invalid: number;
  /** Only present when rules ran. */
  rulesApplied?: number;
  /** Records past the 5,000 limit that were not read. */
  truncated: number;
}

/**
 * Imports a SpendWise backup: v2 ({ version: 2, transactions: [...] } from Export) or the original v1 array.
 * Re-importing the same file adds nothing; accounts and categories named in it are created when missing.
 */
export function useBackupImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { data: unknown; accountId: number | null; applyRules: boolean }) =>
      api.post<BackupImportResult>('/api/import/spendwise-backup', body),
    onSuccess: () => {
      afterTransactionWrite(qc);
      void qc.invalidateQueries({ queryKey: budgetKeys.categories });
      void qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}
