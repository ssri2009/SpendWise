import { CheckCircle2, FileJson, Upload } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useBackupImport, type BackupImportResult } from '../../hooks/useImport';
import { ApiError } from '../../lib/api';
import { formatDate, formatMoney, type MoneyFormat } from '../../lib/format';
import type { Account } from '../../types/api';
import { AccountSelect } from '../transactions/pickers';
import { DialogField, GhostButton, PrimaryButton } from '../ui/Dialog';
import { ImportError } from './csvImport';

const MAX_BYTES = 3 * 1024 * 1024; // server/routes/dataio.js
const MAX_RECORDS = 5000;

interface Summary {
  version: 1 | 2;
  count: number;
  from: string | null;
  to: string | null;
  accounts: string[];
  categories: string[];
  income: number;
  expense: number;
  exportedAt: string | null;
}

/** "Nov 2026", or "Jan 2025 – Nov 2026". */
function dateRange(from: string | null, to: string | null, locale: string): string {
  if (!from || !to) return '—';
  const f = formatDate(from, locale, { month: 'short', year: 'numeric' });
  const t = formatDate(to, locale, { month: 'short', year: 'numeric' });
  return f === t ? f : `${f} – ${t}`;
}

/** Reads the file the way the server will, to show what's in it before anything is sent. */
function summarize(data: unknown): Summary | null {
  let list: unknown[] | null = null;
  let version: 1 | 2 = 1;
  let exportedAt: string | null = null;
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object' && Array.isArray((data as { transactions?: unknown }).transactions)) {
    const d = data as { transactions: unknown[]; version?: unknown; exportedAt?: unknown };
    list = d.transactions;
    if (d.version === 2) version = 2;
    if (typeof d.exportedAt === 'string') exportedAt = d.exportedAt;
  }
  if (!list) return null;
  const accounts = new Set<string>();
  const categories = new Set<string>();
  let from: string | null = null;
  let to: string | null = null;
  let income = 0;
  let expense = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    if (date) {
      if (!from || date < from) from = date;
      if (!to || date > to) to = date;
    }
    if (version === 2) {
      if (typeof r.account === 'string' && r.account.trim()) accounts.add(r.account.trim());
      if (typeof r.category === 'string' && r.category.trim()) categories.add(r.category.trim());
      const a = Number(r.amountMinor);
      if (Number.isFinite(a)) {
        if (a > 0) income += a;
        else expense -= a;
      }
    } else {
      if (typeof r.cat === 'string' && r.cat.trim()) categories.add(r.cat.trim());
      const a = Math.round(Number(r.amount) * 100);
      if (Number.isFinite(a)) {
        if (r.type === 'income') income += a;
        else if (r.type === 'expense') expense += a;
      }
    }
  }
  return { version, count: list.length, from, to, accounts: [...accounts], categories: [...categories], income, expense, exportedAt };
}

/** Restore or merge a SpendWise backup (.json from Export, or the original app's file). */
export function BackupImport({ accounts, fmt, onImported }: { accounts: Account[]; fmt: MoneyFormat; onImported: (message: string) => void }) {
  const run = useBackupImport();
  const ids = { file: useId(), account: useId(), rules: useId() };
  const [fileName, setFileName] = useState('');
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [applyRules, setApplyRules] = useState(false);
  const [result, setResult] = useState<BackupImportResult | null>(null);
  const summary = useMemo(() => (data === null ? null : summarize(data)), [data]);
  const fallback = accountId ?? accounts.find((a) => !a.closed)?.id ?? null;
  const locale = fmt.locale;

  async function onFile(file: File | undefined) {
    setError(null);
    setResult(null);
    setData(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setError('That file is too big (3 MB limit).');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return setError("That file isn't valid JSON. Pick the .json file that SpendWise exported.");
    }
    if (!summarize(parsed)) return setError("That file isn't a SpendWise backup.");
    setFileName(file.name);
    setData(parsed);
  }

  function doImport() {
    if (!summary) return;
    setError(null);
    run.mutate(
      { data, accountId: fallback, applyRules },
      {
        onSuccess: (r) => {
          setResult(r);
          onImported(`Imported ${r.added} transaction${r.added === 1 ? '' : 's'} from ${fileName}.`);
        },
        onError: (e) => setError(e instanceof ApiError ? e.message : 'The import failed. Nothing was imported.'),
      },
    );
  }

  if (result) {
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm font-medium text-income">
          <CheckCircle2 className="size-5" aria-hidden /> {result.added} transaction{result.added === 1 ? '' : 's'} added from {fileName}.
        </p>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ['Added', result.added],
              ['Already had (skipped)', result.duplicates],
              ['Not valid (skipped)', result.invalid],
              ['Changed by rules', result.rulesApplied ?? 0],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-xl bg-subtle px-3 py-2">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="text-lg font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {result.truncated > 0 && <p className="text-sm text-warning">{result.truncated} records past the first 5,000 were not read. Split the file and import the rest.</p>}
        <div className="flex flex-wrap gap-2">
          <GhostButton
            onClick={() => {
              setResult(null);
              setData(null);
              setFileName('');
            }}
          >
            Import another backup
          </GhostButton>
          <Link to="/transactions" className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-accent hover:underline">
            See them in Transactions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ImportError error={error} />
      <label
        htmlFor={ids.file}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-surface px-4 py-8 text-center transition-colors hover:border-accent/60"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFile(e.dataTransfer.files[0]);
        }}
      >
        <FileJson className="size-7 text-accent" aria-hidden />
        <span className="text-sm font-medium">{fileName || 'Choose a SpendWise backup (.json), or drop it here'}</span>
        <span className="text-xs text-muted">From “Download full backup”, or the original SpendWise app. Up to 3 MB and 5,000 transactions.</span>
      </label>
      <input
        id={ids.file}
        type="file"
        accept=".json,application/json"
        aria-label="Backup file"
        className="sr-only"
        onChange={(e) => {
          void onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {summary && (
        <>
          <section aria-label="What's in the backup" className="rounded-2xl border border-line p-4">
            <h3 className="mb-3 text-sm font-semibold">What's in it</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-xl bg-subtle px-3 py-2">
                <dt className="text-xs text-muted">Transactions</dt>
                <dd className="font-semibold tabular-nums">{summary.count.toLocaleString(locale)}</dd>
              </div>
              <div className="rounded-xl bg-subtle px-3 py-2">
                <dt className="text-xs text-muted">Dates</dt>
                <dd className="font-semibold">
                  {dateRange(summary.from, summary.to, locale)}
                </dd>
              </div>
              <div className="rounded-xl bg-subtle px-3 py-2">
                <dt className="text-xs text-muted">Money in</dt>
                <dd className="font-semibold tabular-nums text-income">{formatMoney(summary.income, fmt)}</dd>
              </div>
              <div className="rounded-xl bg-subtle px-3 py-2">
                <dt className="text-xs text-muted">Money out</dt>
                <dd className="font-semibold tabular-nums">{formatMoney(summary.expense, fmt)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">
              {summary.version === 2 ? 'SpendWise backup' : 'Original SpendWise app file'}
              {summary.exportedAt ? `, exported ${formatDate(summary.exportedAt.slice(0, 10), locale, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.{' '}
              {summary.accounts.length > 0 && <>Accounts: {summary.accounts.slice(0, 6).join(', ')}{summary.accounts.length > 6 ? '…' : ''}. </>}
              {summary.categories.length > 0 && <>Categories: {summary.categories.slice(0, 8).join(', ')}{summary.categories.length > 8 ? '…' : ''}. </>}
              Missing accounts and categories are created; ones you have are matched by name.
            </p>
            {summary.count > MAX_RECORDS && <p className="mt-2 text-sm text-warning">Only the first 5,000 transactions are read.</p>}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <DialogField
              label={summary.version === 2 && summary.accounts.length ? 'For rows without an account' : 'Import into'}
              htmlFor={ids.account}
              hint={summary.version === 2 && summary.accounts.length ? 'Rows that name an account go to that account.' : undefined}
            >
              <AccountSelect id={ids.account} accounts={accounts} value={fallback} onChange={setAccountId} />
            </DialogField>
            <label htmlFor={ids.rules} className="flex cursor-pointer items-start gap-2.5 self-end pb-2 text-sm">
              <input id={ids.rules} type="checkbox" checked={applyRules} onChange={(e) => setApplyRules(e.target.checked)} className="mt-0.5 size-4 accent-[var(--sw-accent)]" />
              <span>
                Run my rules on these
                <span className="block text-xs text-muted">Off keeps the backup exactly as it was.</span>
              </span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <p className="mr-auto text-xs text-muted">Anything you already have is skipped, so importing the same backup twice adds nothing.</p>
            <PrimaryButton type="button" onClick={doImport} pending={run.isPending} disabled={fallback === null}>
              <Upload className="size-4" aria-hidden /> {run.isPending ? 'Importing…' : `Import ${Math.min(summary.count, MAX_RECORDS).toLocaleString(locale)} transaction${summary.count === 1 ? '' : 's'}`}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}
