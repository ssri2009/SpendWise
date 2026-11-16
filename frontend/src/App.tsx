import { motion, type Variants } from 'framer-motion';
import { ArrowRight, Compass } from 'lucide-react';
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { AuthSync, PublicOnly, RequireAuth } from './auth/guards';
import { ToastProvider } from './components/ui/Toast';
import { AppLayout } from './layouts/AppLayout';
import { ALL_NAV_ITEMS, type NavItem } from './lib/nav';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Every screen in the nav, loaded on demand (the dashboard and reports pull in Recharts).
const PAGES: Partial<Record<string, LazyExoticComponent<ComponentType>>> = {
  '/dashboard': lazy(() => import('./pages/DashboardPage')),
  '/budget': lazy(() => import('./pages/BudgetPage')),
  '/transactions': lazy(() => import('./pages/TransactionsPage')),
  '/reports': lazy(() => import('./pages/ReportsPage')),
  '/schedules': lazy(() => import('./pages/SchedulesPage')),
  '/bills': lazy(() => import('./pages/BillsPage')),
  '/calendar': lazy(() => import('./pages/CalendarPage')),
  '/forecast': lazy(() => import('./pages/ForecastPage')),
  '/payees': lazy(() => import('./pages/PayeesPage')),
  '/rules': lazy(() => import('./pages/RulesPage')),
  '/reconcile': lazy(() => import('./pages/ReconcilePage')),
  '/import': lazy(() => import('./pages/ImportPage')),
  '/settings': lazy(() => import('./pages/SettingsPage')),
};

/** Shown while a screen's code loads: a thin progress line under the header and a page-shaped skeleton. */
function PageLoading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="sw-route-progress" aria-hidden />
      <div className="space-y-6" aria-hidden>
        <div className="space-y-2.5">
          <div className="sw-skeleton h-7 w-48 rounded-lg" />
          <div className="sw-skeleton h-4 w-72 max-w-full rounded-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass rounded-3xl border border-line p-5">
              <div className="sw-skeleton h-3 w-24 rounded-full" />
              <div className="sw-skeleton mt-4 h-8 w-36 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="glass rounded-3xl border border-line p-6">
          <div className="sw-skeleton h-4 w-40 rounded-full" />
          <div className="sw-skeleton mt-5 h-56 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthSync />
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <LoginPage />
            </PublicOnly>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnly>
              <RegisterPage />
            </PublicOnly>
          }
        />

        {/* Everything else needs a session: GET /api/auth/status decides. */}
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          {ALL_NAV_ITEMS.map((item) => {
            const Page = PAGES[item.path];
            return (
              // "/*" so nested URLs such as /reports/net-worth or /budget/2026-11 land on the same screen.
              <Route
                key={item.path}
                path={`${item.path}/*`}
                element={
                  Page ? (
                    <Suspense fallback={<PageLoading />}>
                      <Page />
                    </Suspense>
                  ) : (
                    <PagePlaceholder item={item} />
                  )
                }
              />
            );
          })}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

/* ---------------------------------------------------------------------
   Fallback for a nav item without a page (none today: every screen is built).
   (Login and register are real now: pages/LoginPage, pages/RegisterPage.)
   --------------------------------------------------------------------- */

const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const rise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } },
};

function PagePlaceholder({ item }: { item: NavItem }) {
  const Icon = item.icon;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <motion.section
        variants={rise}
        className="glass relative overflow-hidden rounded-3xl border border-line p-6 shadow-glass sm:p-8"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full accent-gradient opacity-20 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl accent-gradient text-accent-fg shadow-lg shadow-accent/30">
            <Icon className="size-7" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight">{item.label}</h2>
            <p className="mt-1 text-muted">{item.description}</p>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-2">
          {item.endpoints.map((ep) => (
            <code key={ep} className="rounded-lg border border-line bg-subtle px-2.5 py-1 font-mono text-xs text-muted">
              {ep}
            </code>
          ))}
        </div>
      </motion.section>

      <motion.div variants={rise} className="grid gap-4 sm:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="glass rounded-2xl border border-line p-5">
            <div className="sw-skeleton h-3 w-24 rounded-full" />
            <div className="sw-skeleton mt-4 h-7 w-32 rounded-lg" />
          </div>
        ))}
      </motion.div>

      <motion.div variants={rise} className="glass h-72 rounded-3xl border border-line p-6" aria-hidden>
        <div className="sw-skeleton h-full w-full rounded-2xl" />
      </motion.div>
    </motion.div>
  );
}

function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="glass max-w-md rounded-3xl border border-line p-8 text-center shadow-glass">
        <Compass className="mx-auto size-10 text-accent" aria-hidden />
        <h2 className="mt-4 text-xl font-bold">Page not found</h2>
        <p className="mt-2 text-sm text-muted">That address doesn't match any SpendWise screen.</p>
        <Link
          to="/dashboard"
          className="mt-6 inline-flex items-center gap-2 rounded-xl accent-gradient px-4 py-2 text-sm font-semibold text-accent-fg"
        >
          Go to Dashboard <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
