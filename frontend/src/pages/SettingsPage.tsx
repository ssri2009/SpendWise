import { motion } from 'framer-motion';
import { ArrowRight, Database, FileJson, FileSpreadsheet, Landmark, LogOut, Palette, Shapes, Upload, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, NavLink, useParams } from 'react-router';
import { rise, stagger } from '../components/dashboard/ui';
import { AccountsSection } from '../components/settings/AccountsSection';
import { CategoriesSection } from '../components/settings/CategoriesSection';
import { useToast } from '../components/ui/Toast';
import { useLogout } from '../auth/session';
import { useMoneyFormat } from '../hooks/useDashboard';
import { useMe } from '../lib/api';
import { formatMoney } from '../lib/format';
import { ThemePicker } from '../theme/ThemeControls';

const SECTIONS = [
  { id: 'accounts', label: 'Accounts', icon: Landmark },
  { id: 'categories', label: 'Categories', icon: Shapes },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'data', label: 'Your data', icon: Database },
  { id: 'profile', label: 'Profile', icon: UserRound },
] as const;
type Section = (typeof SECTIONS)[number]['id'];

/** /settings → /settings/accounts; each section has its own URL. */
export default function SettingsPage() {
  const param = useParams()['*']?.split('/')[0] ?? '';
  const section = SECTIONS.find((s) => s.id === param)?.id;
  if (!section) return <Navigate to="/settings/accounts" replace />;
  return <Settings section={section} />;
}

function Settings({ section }: { section: Section }) {
  const fmt = useMoneyFormat();
  const toast = useToast();
  const message = (tone: 'success' | 'error', text: string) => (tone === 'success' ? toast.success(text) : toast.error(text));

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-5 pb-24">
      <motion.div variants={rise}>
        <p className="text-sm text-muted">Accounts, categories, look and your data</p>
        <h2 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">Settings</h2>
      </motion.div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <motion.nav variants={rise} aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-24">
          <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <li key={s.id} className="shrink-0">
                  <NavLink
                    to={`/settings/${s.id}`}
                    replace
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                        isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-subtle hover:text-fg'
                      }`
                    }
                  >
                    <Icon className="size-4" aria-hidden />
                    {s.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </motion.nav>

        <motion.div variants={rise} className="min-w-0">
          {section === 'accounts' && <AccountsSection fmt={fmt} onMessage={message} />}
          {section === 'categories' && <CategoriesSection onMessage={message} />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'data' && <DataSection />}
          {section === 'profile' && <ProfileSection />}
        </motion.div>
      </div>
    </motion.div>
  );
}

function Card({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="glass rounded-3xl border border-line p-5 shadow-glass sm:p-6">
      <h3 id={id} className="mb-4 text-lg font-bold tracking-tight">
        {title}
      </h3>
      {children}
    </section>
  );
}

function AppearanceSection() {
  const fmt = useMoneyFormat();
  return (
    <div className="space-y-4">
      <Card title="Appearance" id="sw-set-look">
        <div className="max-w-sm">
          <ThemePicker idPrefix="settings-theme" />
        </div>
        <p className="mt-4 text-xs text-muted">Saved on this device. “System” follows your phone or computer's light / dark setting.</p>
      </Card>
      <Card title="Money format" id="sw-set-money">
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-xl bg-subtle px-3 py-2">
            <dt className="text-xs text-muted">Currency</dt>
            <dd className="font-semibold">{fmt.currency}</dd>
          </div>
          <div className="rounded-xl bg-subtle px-3 py-2">
            <dt className="text-xs text-muted">Number style</dt>
            <dd className="font-semibold">{fmt.locale}</dd>
          </div>
          <div className="rounded-xl bg-subtle px-3 py-2">
            <dt className="text-xs text-muted">Looks like</dt>
            <dd className="font-semibold tabular-nums">{formatMoney(12345678, fmt)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted">Set for your account when it was created. This version of SpendWise can't change it.</p>
      </Card>
    </div>
  );
}

function DataSection() {
  const link = 'inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors';
  return (
    <div className="space-y-4">
      <Card title="Back up" id="sw-set-backup">
        <p className="mb-4 text-sm text-muted">Download everything (accounts, categories and every transaction, splits included) as one file you can import again later.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/api/export/full.json" download className={`${link} accent-gradient text-accent-fg`}>
            <FileJson className="size-4" aria-hidden /> Download full backup
          </a>
          <a href="/api/export/transactions.csv" download className={`${link} border border-line bg-surface hover:bg-subtle`}>
            <FileSpreadsheet className="size-4" aria-hidden /> Transactions as CSV
          </a>
        </div>
      </Card>
      <Card title="Bring data in" id="sw-set-import">
        <p className="mb-4 text-sm text-muted">Import a bank statement CSV, or restore a SpendWise backup.</p>
        <Link to="/import" className={`${link} border border-line bg-surface hover:bg-subtle`}>
          <Upload className="size-4" aria-hidden /> Go to Import <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Card>
    </div>
  );
}

function ProfileSection() {
  const me = useMe();
  const logout = useLogout();
  const u = me.data;
  return (
    <Card title="Profile" id="sw-set-profile">
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-subtle px-3 py-2">
          <dt className="text-xs text-muted">Name</dt>
          <dd className="font-semibold">{u?.displayName || '—'}</dd>
        </div>
        <div className="rounded-xl bg-subtle px-3 py-2">
          <dt className="text-xs text-muted">Email</dt>
          <dd className="truncate font-semibold">{u?.email ?? '—'}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted">Your name, email and password can't be changed from this version of SpendWise yet.</p>
      <div className="mt-5 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold text-expense transition-colors hover:border-expense/40 hover:bg-expense/10 disabled:opacity-60"
        >
          <LogOut className="size-4" aria-hidden /> {logout.isPending ? 'Signing out…' : 'Sign out on this device'}
        </button>
        {logout.isError && (
          <p role="alert" className="mt-2 text-sm text-expense">
            {logout.error.message} You are still signed in.
          </p>
        )}
      </div>
    </Card>
  );
}
