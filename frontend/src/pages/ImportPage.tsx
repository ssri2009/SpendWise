import { motion } from 'framer-motion';
import { ArrowRight, DatabaseBackup, Download, FileJson, FileSpreadsheet, HardDriveDownload, Lightbulb, RefreshCw, Upload } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { rise, Segmented, Skeleton, stagger } from '../components/dashboard/ui';
import { BackupImport } from '../components/import/BackupImport';
import {
  CsvFilePicker,
  CsvMappingFields,
  CsvOptionsFields,
  CsvResultView,
  CsvRowsTable,
  CsvSummary,
  ImportError,
  useCsvImport,
} from '../components/import/csvImport';
import { GhostButton, PrimaryButton } from '../components/ui/Dialog';
import { useToast } from '../components/ui/Toast';
import { useMoneyFormat } from '../hooks/useDashboard';
import { useAccountList } from '../hooks/useTransactions';
import type { MoneyFormat } from '../lib/format';
import type { Account } from '../types/api';

const TABS = [
  { id: 'csv', label: 'Bank CSV' },
  { id: 'backup', label: 'SpendWise backup' },
  { id: 'export', label: 'Export' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const SAMPLE = [
  'Date,Description,Category,Amount',
  '01/11/2026,Salary November,Salary,85000',
  '03/11/2026,SWIGGY ORDER 4521,Food,-450',
  '05/11/2026,Electricity bill,Bills,-2100.50',
  '07/11/2026,Uber trip,Travel,-320',
].join('\r\n');

function downloadSample() {
  const url = URL.createObjectURL(new Blob([SAMPLE], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'spendwise-sample.csv' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Card({ title, icon: Icon, children, className = '' }: { title: string; icon: typeof Upload; children: ReactNode; className?: string }) {
  return (
    <section className={`glass min-w-0 rounded-3xl border border-line p-5 shadow-glass sm:p-6 ${className}`} aria-label={title}>
      <h3 className="mb-4 flex items-center gap-2.5 text-base font-semibold">
        <span className="grid size-8 place-items-center rounded-xl bg-accent/12 text-accent">
          <Icon className="size-4" aria-hidden />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Step({ n, title, children, done }: { n: number; title: string; children: ReactNode; done?: boolean }) {
  return (
    <li className="relative pl-10">
      <span className={`absolute left-0 top-0 grid size-7 place-items-center rounded-full text-xs font-bold ${done ? 'bg-income/15 text-income' : 'bg-accent/12 text-accent'}`} aria-hidden>
        {n}
      </span>
      <h4 className="mb-3 pt-0.5 text-sm font-semibold">{title}</h4>
      {children}
    </li>
  );
}

/**
 * Import (server/routes/csvimport.js, dataio.js): a bank CSV with preview, a SpendWise backup, and exports.
 * URL: ?tab=csv|backup|export.
 */
export default function ImportPage() {
  const fmt = useMoneyFormat();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const accountsQ = useAccountList();
  const tab: Tab = (['backup', 'export'] as const).find((t) => t === params.get('tab')) ?? 'csv';
  const accounts = accountsQ.data?.accounts ?? [];
  const hasOpen = accounts.some((a) => !a.closed);

  const setTab = useCallback(
    (t: Tab) => {
      const next = new URLSearchParams(window.location.search);
      if (t === 'csv') next.delete('tab');
      else next.set('tab', t);
      setParams(next, { replace: true });
    },
    [setParams],
  );

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-28">
      <motion.div variants={rise} className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Bring transactions in, or take everything out</p>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">Import</h2>
        </div>
        <div className="max-w-full overflow-x-auto [&_button]:whitespace-nowrap">
          <Segmented options={TABS} value={tab} onChange={setTab} label="Import from" layoutId="sw-import-tab" />
        </div>
      </motion.div>

      {accountsQ.isPending ? (
        <Skeleton className="h-64 w-full rounded-3xl" />
      ) : tab === 'export' ? (
        <ExportTab />
      ) : !hasOpen ? (
        <motion.div variants={rise} className="glass rounded-3xl border border-line p-6 text-sm shadow-glass">
          You need an open account to import into. Add one on the{' '}
          <Link to="/dashboard" className="font-semibold text-accent hover:underline">
            Dashboard
          </Link>{' '}
          first.
        </motion.div>
      ) : tab === 'csv' ? (
        <CsvTab key="csv" accounts={accounts} fmt={fmt} onImported={(m) => toast.success(m)} />
      ) : (
        <motion.div variants={rise} className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Card title="Restore or merge a SpendWise backup" icon={DatabaseBackup}>
            <BackupImport accounts={accounts} fmt={fmt} onImported={(m) => toast.success(m)} />
          </Card>
          <Card title="Good to know" icon={Lightbulb}>
            <ul className="list-disc space-y-2 pl-4 text-sm text-muted">
              <li>Works with the file from “Download full backup” and with the original SpendWise app's file.</li>
              <li>It adds to what you have. Nothing is deleted or overwritten.</li>
              <li>Split transactions come back split, with their categories.</li>
              <li>Moving to a new account? Export there, then import here.</li>
            </ul>
          </Card>
        </motion.div>
      )}
    </motion.div>
  );
}

function CsvTab({ accounts, fmt, onImported }: { accounts: Account[]; fmt: MoneyFormat; onImported: (m: string) => void }) {
  const s = useCsvImport({ accounts, defaultAccountId: null, onImported });
  const sum = s.data?.summary;

  if (s.result) {
    return (
      <motion.div variants={rise}>
        <Card title={`Imported ${s.fileName}`} icon={FileSpreadsheet}>
          <CsvResultView result={s.result} />
          <div className="mt-5 flex flex-wrap gap-2">
            <GhostButton onClick={s.reset}>Import another file</GhostButton>
            <Link
              to={`/transactions${s.accountId !== null ? `?account=${s.accountId}` : ''}`}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-accent hover:underline"
            >
              See them in Transactions <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </Card>
      </motion.div>
    );
  }

  return (
    <>
      <motion.div variants={rise} className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card title="Import a bank CSV" icon={FileSpreadsheet}>
          <ol className="space-y-6">
            <Step n={1} title="Choose the file and the account" done={!!s.csv}>
              <ImportError error={s.error} />
              <div className={s.error ? 'mt-3' : ''}>
                <CsvFilePicker s={s} accounts={accounts} />
              </div>
            </Step>
            {s.csv && (
              <Step n={2} title="Tell SpendWise how to read it" done={!!s.data && !s.data.needsMapping}>
                <div className="space-y-4">
                  <CsvOptionsFields s={s} />
                  <CsvMappingFields s={s} />
                </div>
              </Step>
            )}
            {sum && (
              <Step n={3} title="Check the rows">
                <div className="space-y-3">
                  <CsvSummary s={s} />
                  <CsvRowsTable s={s} fmt={fmt} />
                </div>
              </Step>
            )}
          </ol>
        </Card>
        <Card title="Tips" icon={Lightbulb}>
            <ul className="list-disc space-y-2 pl-4 text-sm text-muted">
              <li>Download the statement from your bank's website as CSV (sometimes called “Excel / comma separated”).</li>
              <li>Columns are recognised automatically. You only need a date and an amount (or debit and credit columns).</li>
              <li>Rows you already have are flagged as duplicates and skipped, so overlapping statements are fine.</li>
              <li>Your rules run on every row, so categories and payee names come out tidy.</li>
            </ul>
            <button type="button" onClick={downloadSample} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
              <Download className="size-4" aria-hidden /> Download a sample CSV
            </button>
        </Card>
      </motion.div>

      {s.csv && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4" role="region" aria-label="Import">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-elevated px-4 py-2.5 shadow-glass">
            <span className="text-sm" aria-live="polite">
              {s.checking ? (
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <RefreshCw className="size-3.5 animate-spin" aria-hidden /> Checking the file…
                </span>
              ) : s.data?.needsMapping ? (
                <span className="text-warning">Pick the Date and Amount columns</span>
              ) : sum ? (
                <>
                  <b>{sum.willImport}</b> of {sum.totalRows} rows will be imported
                </>
              ) : null}
            </span>
            <GhostButton onClick={s.reset} disabled={s.importing}>
              Start over
            </GhostButton>
            <PrimaryButton type="button" onClick={s.doImport} pending={s.importing} disabled={!s.canImport}>
              <Upload className="size-4" aria-hidden />
              {s.importing ? 'Importing…' : sum ? `Import ${sum.willImport} row${sum.willImport === 1 ? '' : 's'}` : 'Import'}
            </PrimaryButton>
          </div>
        </div>
      )}
    </>
  );
}

function ExportTab() {
  const link =
    'inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-transform hover:-translate-y-0.5';
  return (
    <motion.div variants={rise} className="grid items-start gap-5 md:grid-cols-2">
      <Card title="Full backup" icon={HardDriveDownload}>
        <p className="mb-4 text-sm text-muted">
          Every account, category and transaction (splits included) in one .json file. Keep it somewhere safe, or import it into another SpendWise.
        </p>
        <a href="/api/export/full.json" download className={`${link} accent-gradient text-accent-fg shadow-lg shadow-accent/25`}>
          <FileJson className="size-4" aria-hidden /> Download full backup
        </a>
      </Card>
      <Card title="Transactions for a spreadsheet" icon={FileSpreadsheet}>
        <p className="mb-4 text-sm text-muted">
          All transactions as a .csv that opens in Excel or Google Sheets. Split transactions get one row per part, so category totals add up.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export/transactions.csv" download className={`${link} border border-line bg-surface hover:bg-subtle`}>
            <Download className="size-4" aria-hidden /> Download all transactions
          </a>
          <Link to="/transactions" className="inline-flex h-11 items-center gap-1.5 px-2 text-sm font-semibold text-accent hover:underline">
            Filter first, then export <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </Card>
    </motion.div>
  );
}
