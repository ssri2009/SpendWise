import { RefreshCw, Upload } from 'lucide-react';
import type { MoneyFormat } from '../../lib/format';
import type { Account } from '../../types/api';
import {
  CsvFilePicker,
  CsvMappingFields,
  CsvOptionsFields,
  CsvResultView,
  CsvRowsTable,
  CsvSummary,
  ImportError,
  useCsvImport,
} from '../import/csvImport';
import { GhostButton, PrimaryButton } from '../ui/Dialog';
import { Drawer } from '../ui/Drawer';

/**
 * CSV import from the Transactions page: POST /api/import/csv/preview (writes nothing)
 * until it looks right, then POST /api/import/csv/commit with the same options.
 * The same importer (components/import/csvImport) is used full-page on the Import page.
 */
export function ImportDrawer({
  accounts,
  defaultAccountId,
  fmt,
  onClose,
  onImported,
}: {
  accounts: Account[];
  defaultAccountId: number | null;
  fmt: MoneyFormat;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const s = useCsvImport({ accounts, defaultAccountId, onImported: (m) => onImported(m) });

  if (s.result) {
    return (
      <Drawer
        title="Import finished"
        description={s.fileName}
        onClose={onClose}
        width="lg"
        footer={
          <PrimaryButton type="button" onClick={onClose}>
            Done
          </PrimaryButton>
        }
      >
        <CsvResultView result={s.result} />
      </Drawer>
    );
  }

  const sum = s.data?.summary;
  return (
    <Drawer
      title="Import a CSV"
      description="Preview first: nothing is saved until you press Import."
      onClose={onClose}
      width="xl"
      footer={
        <>
          {s.checking && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-muted">
              <RefreshCw className="size-3.5 animate-spin" aria-hidden /> Checking the file…
            </span>
          )}
          <GhostButton onClick={onClose} disabled={s.importing}>
            Cancel
          </GhostButton>
          <PrimaryButton type="button" onClick={s.doImport} pending={s.importing} disabled={!s.canImport}>
            <Upload className="size-4" aria-hidden />
            {s.importing ? 'Importing…' : sum ? `Import ${sum.willImport} row${sum.willImport === 1 ? '' : 's'}` : 'Import'}
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-5">
        <ImportError error={s.error} />
        <CsvFilePicker s={s} accounts={accounts} />
        <CsvOptionsFields s={s} />
        <CsvMappingFields s={s} />
        <CsvSummary s={s} />
        <CsvRowsTable s={s} fmt={fmt} />
      </div>
    </Drawer>
  );
}
