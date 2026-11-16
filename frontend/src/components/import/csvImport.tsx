import { AlertCircle, CheckCircle2, Copy, FileUp } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useCsvCommit, useCsvPreview } from '../../hooks/useTransactions';
import { ApiError } from '../../lib/api';
import { formatMoney, type MoneyFormat } from '../../lib/format';
import { CSV_FIELDS, type Account, type CsvCommitResult, type CsvField, type CsvMapping, type CsvOptions, type CsvPreview } from '../../types/api';
import { AccountSelect } from '../transactions/pickers';
import { CONTROL, DialogField } from '../ui/Dialog';

/* ---------------------------------------------------------------------
   Bank CSV import, shared by the Import page and the Transactions page's
   drawer: POST /api/import/csv/preview (writes nothing) re-runs whenever
   an option changes, then POST /api/import/csv/commit with the very same
   options. The server analyses again inside the commit, so a second click
   never imports anything twice.
   --------------------------------------------------------------------- */

export const MAX_CSV_BYTES = 3 * 1024 * 1024; // server/routes/csvimport.js
const SHOWN_ROWS = 300;

const FIELD_LABEL: Record<CsvField, string> = {
  date: 'Date *', amount: 'Amount', debit: 'Debit (money out)', credit: 'Credit (money in)', payee: 'Payee / description',
  category: 'Category', account: 'Account', notes: 'Notes', cleared: 'Cleared', type: 'Type (income / expense)',
};

const STATUS: Record<string, string> = {
  new: 'bg-income/12 text-income',
  duplicate: 'bg-warning/15 text-warning',
  error: 'bg-expense/12 text-expense',
};

/** All the state of one CSV import. */
export function useCsvImport({
  accounts,
  defaultAccountId,
  onImported,
}: {
  accounts: Account[];
  defaultAccountId: number | null;
  onImported: (message: string, result: CsvCommitResult) => void;
}) {
  const preview = useCsvPreview();
  const commit = useCsvCommit();
  const open = accounts.filter((a) => !a.closed);
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [accountId, setAccountId] = useState<number | null>(open.some((a) => a.id === defaultAccountId) ? defaultAccountId : (open[0]?.id ?? null));
  const [hasHeader, setHasHeader] = useState(true);
  const [dateFormat, setDateFormat] = useState<NonNullable<CsvOptions['dateFormat']>>('auto');
  const [amountMode, setAmountMode] = useState<NonNullable<CsvOptions['amountMode']>>('signed');
  const [duplicates, setDuplicates] = useState<'skip' | 'import'>('skip');
  const [createAccounts, setCreateAccounts] = useState(false);
  const [applyRules, setApplyRules] = useState(true);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [decisions, setDecisions] = useState<Record<string, 'import' | 'skip'>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CsvCommitResult | null>(null);

  // The accounts list can arrive after the importer opens.
  useEffect(() => {
    if (accountId === null && open.length) setAccountId(open.some((a) => a.id === defaultAccountId) ? defaultAccountId : open[0].id);
  }, [open.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const data: CsvPreview | undefined = preview.data;

  const options = (): CsvOptions => ({
    csv, accountId: accountId!, hasHeader, dateFormat, amountMode, duplicates, createAccounts, mapping, decisions, applyRules, onErrors: 'skip',
  });

  // Re-analyse whenever an option changes (debounced), once a file is loaded.
  const signature = JSON.stringify([csv.length, fileName, accountId, hasHeader, dateFormat, amountMode, duplicates, createAccounts, mapping, decisions]);
  useEffect(() => {
    if (!csv || accountId === null || result) return;
    const t = window.setTimeout(() => {
      setError(null);
      preview.mutate(options(), {
        onSuccess: (d) => {
          if (!mapping) setMapping(d.mapping);
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not read that file.'),
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onFile(file: File | undefined) {
    setError(null);
    setResult(null);
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) return setError('That file is too big (3 MB limit).');
    const text = await file.text();
    if (!text.trim()) return setError('That file is empty.');
    setFileName(file.name);
    setMapping(null);
    setDecisions({});
    setCsv(text);
  }

  function doImport() {
    if (!data || data.needsMapping || !data.summary?.willImport) return;
    setError(null);
    commit.mutate(options(), {
      onSuccess: (r) => {
        setResult(r);
        onImported(`Imported ${r.imported} transaction${r.imported === 1 ? '' : 's'} from ${fileName}.`, r);
      },
      onError: (err) => setError(err instanceof ApiError ? err.message : 'The import failed. Nothing was imported.'),
    });
  }

  /** Start over with another file (keeps the account and options). */
  function reset() {
    setCsv('');
    setFileName('');
    setMapping(null);
    setDecisions({});
    setResult(null);
    setError(null);
    preview.reset();
  }

  return {
    fileName, csv, accountId, setAccountId, hasHeader, setHasHeader, dateFormat, setDateFormat, amountMode, setAmountMode,
    duplicates, setDuplicates, createAccounts, setCreateAccounts, applyRules, setApplyRules, mapping, setMapping,
    decisions, setDecisions, error, result, data, onFile, doImport, reset,
    checking: preview.isPending,
    importing: commit.isPending,
    canImport: !!data && !data.needsMapping && !!data.summary?.willImport && !preview.isPending,
  };
}

export type CsvImportState = ReturnType<typeof useCsvImport>;

export function ImportError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-expense/30 bg-expense/10 px-3.5 py-2.5 text-sm text-expense">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
    </p>
  );
}

/** Drop zone + "Import into" account + header checkbox. */
export function CsvFilePicker({ s, accounts }: { s: CsvImportState; accounts: Account[] }) {
  const ids = { file: useId(), account: useId() };
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div>
        <label
          htmlFor={ids.file}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-surface px-4 py-6 text-center transition-colors hover:border-accent/60"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void s.onFile(e.dataTransfer.files[0]);
          }}
        >
          <FileUp className="size-6 text-accent" aria-hidden />
          <span className="text-sm font-medium">{s.fileName || 'Choose a CSV file, or drop it here'}</span>
          <span className="text-xs text-muted">Up to 3 MB and 5,000 rows. Comma, semicolon or tab separated.</span>
        </label>
        <input
          id={ids.file}
          type="file"
          accept=".csv,text/csv,.tsv,.txt"
          className="sr-only"
          onChange={(e) => {
            void s.onFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      <div className="space-y-3">
        <DialogField label="Import into" htmlFor={ids.account}>
          <AccountSelect id={ids.account} accounts={accounts} value={s.accountId} onChange={s.setAccountId} />
        </DialogField>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={s.hasHeader}
            onChange={(e) => {
              s.setHasHeader(e.target.checked);
              s.setMapping(null);
            }}
            className="size-4 accent-[var(--sw-accent)]"
          />
          First row is a header
        </label>
      </div>
    </div>
  );
}

/** Date format, amount sign, duplicates, rules, new accounts. */
export function CsvOptionsFields({ s }: { s: CsvImportState }) {
  const ids = { date: useId(), amount: useId(), dup: useId() };
  if (!s.csv) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <DialogField label="Dates look like" htmlFor={ids.date}>
        <select id={ids.date} className={CONTROL} value={s.dateFormat} onChange={(e) => s.setDateFormat(e.target.value as typeof s.dateFormat)}>
          <option value="auto">Detect automatically</option>
          <option value="DMY">31/12/2026 (day first)</option>
          <option value="MDY">12/31/2026 (month first)</option>
          <option value="YMD">2026-12-31</option>
        </select>
      </DialogField>
      <DialogField label="Amount sign" htmlFor={ids.amount}>
        <select id={ids.amount} className={CONTROL} value={s.amountMode} onChange={(e) => s.setAmountMode(e.target.value as typeof s.amountMode)}>
          <option value="signed">Negative = money out</option>
          <option value="inverted">Positive = money out</option>
        </select>
      </DialogField>
      <DialogField label="Possible duplicates" htmlFor={ids.dup}>
        <select
          id={ids.dup}
          className={CONTROL}
          value={s.duplicates}
          onChange={(e) => {
            s.setDuplicates(e.target.value as typeof s.duplicates);
            s.setDecisions({});
          }}
        >
          <option value="skip">Skip them</option>
          <option value="import">Import them anyway</option>
        </select>
      </DialogField>
      <label className="flex items-center gap-2 text-sm sm:col-span-3">
        <input type="checkbox" checked={s.applyRules} onChange={(e) => s.setApplyRules(e.target.checked)} className="size-4 accent-[var(--sw-accent)]" />
        Run my rules on imported rows
      </label>
      {s.data?.mapping.account !== null && s.data?.mapping.account !== undefined && (
        <label className="flex items-center gap-2 text-sm sm:col-span-3">
          <input type="checkbox" checked={s.createAccounts} onChange={(e) => s.setCreateAccounts(e.target.checked)} className="size-4 accent-[var(--sw-accent)]" />
          Create accounts named in the file that don’t exist yet
        </label>
      )}
    </div>
  );
}

/** "Which column is which?" */
export function CsvMappingFields({ s }: { s: CsvImportState }) {
  const { data, mapping } = s;
  if (!data || !mapping) return null;
  const columnLabel = (i: number) => {
    const h = data.headers[i];
    return s.hasHeader && h ? `${i + 1}: ${h}` : `Column ${i + 1}${data.sample[0]?.[i] ? ` (e.g. ${data.sample[0][i].slice(0, 24)})` : ''}`;
  };
  return (
    <section aria-label="Column mapping" className="rounded-2xl border border-line p-4">
      <h3 className="mb-3 text-sm font-semibold">Which column is which?</h3>
      {data.needsMapping && <p className="mb-3 text-sm text-warning">Pick the Date column and either Amount or Debit/Credit to continue.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {CSV_FIELDS.map((f) => (
          <label key={f} className="block text-xs">
            <span className="mb-1 block font-medium text-muted">{FIELD_LABEL[f]}</span>
            <select
              className={`${CONTROL} h-9 text-xs`}
              value={mapping[f] ?? ''}
              onChange={(e) => s.setMapping({ ...mapping, [f]: e.target.value === '' ? null : Number(e.target.value) })}
            >
              <option value="">Not in file</option>
              {Array.from({ length: data.columnCount }, (_, i) => (
                <option key={i} value={i}>
                  {columnLabel(i)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

/** Counts: rows, new, duplicates, errors, will import. */
export function CsvSummary({ s }: { s: CsvImportState }) {
  const sum = s.data?.summary;
  if (!sum) return null;
  return (
    <div className="flex flex-wrap gap-2 text-xs font-semibold" aria-live="polite">
      <span className="rounded-full bg-subtle px-3 py-1">{sum.totalRows} rows</span>
      <span className="rounded-full bg-income/12 px-3 py-1 text-income">{sum.newRows} new</span>
      <span className="rounded-full bg-warning/15 px-3 py-1 text-warning">{sum.duplicateRows} possible duplicates</span>
      {sum.errorRows > 0 && <span className="rounded-full bg-expense/12 px-3 py-1 text-expense">{sum.errorRows} with errors</span>}
      <span className="rounded-full accent-gradient px-3 py-1 text-accent-fg">{sum.willImport} will be imported</span>
      {sum.newCategories.length > 0 && <span className="rounded-full bg-subtle px-3 py-1">New categories: {sum.newCategories.join(', ')}</span>}
      {s.data?.truncated ? <span className="rounded-full bg-expense/12 px-3 py-1 text-expense">Only the first 5,000 rows are read</span> : null}
    </div>
  );
}

/** Every row with its parsed values, status and a checkbox to include / skip it. */
export function CsvRowsTable({ s, fmt }: { s: CsvImportState; fmt: MoneyFormat }) {
  const rows = useMemo(() => s.data?.rows.slice(0, SHOWN_ROWS) ?? [], [s.data]);
  if (!s.data?.summary || rows.length === 0) return null;
  const toggle = (n: number, include: boolean) => s.setDecisions((d) => ({ ...d, [n]: include ? 'import' : 'skip' }));
  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[44rem] text-left text-xs">
        <thead className="bg-subtle text-muted">
          <tr>
            <th className="w-10 px-3 py-2">
              <span className="sr-only">Import</span>
            </th>
            <th className="px-3 py-2">Row</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Payee</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            // Your choice shows at once; the server's re-analysis then confirms it.
            const included = r.status !== 'error' && (s.decisions[r.n] ? s.decisions[r.n] === 'import' : r.action === 'import');
            return (
              <tr key={r.n} className={!included ? 'opacity-60' : ''}>
                <td className="px-3 py-2">
                  {r.status !== 'error' && (
                    <input type="checkbox" aria-label={`Import row ${r.n}`} checked={included} onChange={(e) => toggle(r.n, e.target.checked)} className="size-4 accent-[var(--sw-accent)]" />
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted">{r.n}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{r.date ?? '—'}</td>
                <td className="max-w-48 truncate px-3 py-2">{r.payee || <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2">
                  {r.category || <span className="text-muted">—</span>}
                  {r.newCategory && <span className="ml-1 text-[10px] text-accent">new</span>}
                </td>
                <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${(r.amountMinor ?? 0) > 0 ? 'text-income' : ''}`}>
                  {r.amountMinor === null ? '—' : formatMoney(r.amountMinor, fmt, { signed: true })}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${STATUS[r.status]}`}>
                    {r.status === 'duplicate' && <Copy className="size-3" aria-hidden />}
                    {r.status === 'new' ? 'New' : r.status === 'duplicate' ? 'Duplicate' : 'Error'}
                  </span>
                  {r.errors.length > 0 && <p className="mt-1 text-expense">{r.errors.join(' ')}</p>}
                  {r.duplicateOf && (
                    <p className="mt-1 text-muted">
                      Matches {r.duplicateOf.date} · {r.duplicateOf.payee || 'no payee'}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {s.data.rows.length > SHOWN_ROWS && (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">
          Showing the first {SHOWN_ROWS} of {s.data.rows.length} rows. All of them follow the options above.
        </p>
      )}
    </div>
  );
}

/** What the import did. */
export function CsvResultView({ result }: { result: CsvCommitResult }) {
  const lines: [string, number][] = [
    ['Imported', result.imported],
    ['Skipped as duplicates', result.skippedDuplicates],
    ['Imported although duplicate', result.importedDuplicates],
    ['Skipped by you', result.skippedByChoice],
    ['Rows with errors (not imported)', result.errorRows],
  ];
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-medium text-income">
        <CheckCircle2 className="size-5" aria-hidden /> {result.imported} new transaction{result.imported === 1 ? '' : 's'} added.
      </p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {lines.map(([label, n]) => (
          <div key={label} className="rounded-xl bg-subtle px-3 py-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      {result.rules && result.rules.rowsTouchedByRules > 0 && (
        <p className="text-sm text-muted">
          Your rules changed {result.rules.rowsTouchedByRules} row(s): {result.rules.category} categories, {result.rules.payee} payees, {result.rules.notes} notes,{' '}
          {result.rules.cleared} cleared flags.
        </p>
      )}
      {result.newCategories.length > 0 && <p className="text-sm text-muted">New categories (in the “Imported” group): {result.newCategories.join(', ')}</p>}
      {result.newAccounts.length > 0 && <p className="text-sm text-muted">New accounts: {result.newAccounts.join(', ')}</p>}
      {result.errors.length > 0 && (
        <div className="rounded-xl border border-expense/30 bg-expense/5 p-3 text-xs">
          <p className="mb-1.5 font-semibold text-expense">Rows not imported</p>
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {result.errors.map((e) => (
              <li key={e.n}>
                Row {e.n}: {e.errors.join(' ')}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
