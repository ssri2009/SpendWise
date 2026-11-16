import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { RotateCw, WifiOff } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { BrandMark } from '../components/auth/AuthShell';
import { Backdrop } from '../components/ambient/Backdrop';
import { ApiError, setUnauthorizedHandler } from '../lib/api';
import { markSignedOut, safeNext, useSession, type SignedOutReason } from './session';

/** What the login screen shows after a redirect (router location.state). */
export interface LoginLocationState {
  notice?: SignedOutReason;
}

/* ---------------------------------------------------------------------
   Full-screen states while the session is being checked
   --------------------------------------------------------------------- */

export function SessionSplash({ label = 'Opening your books…' }: { label?: string }) {
  return (
    <div className="relative grid min-h-dvh place-items-center px-4 text-fg" role="status" aria-live="polite">
      <Backdrop />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center gap-5"
      >
        <motion.span animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
          <BrandMark size="lg" />
        </motion.span>
        <span className="h-1 w-40 overflow-hidden rounded-full bg-subtle">
          <motion.span
            className="block h-full w-1/3 rounded-full accent-gradient"
            animate={{ x: ['-100%', '300%'] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </span>
        <p className="text-sm text-muted">{label}</p>
      </motion.div>
    </div>
  );
}

function SessionError({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  const offline = error instanceof ApiError && error.isNetwork;
  return (
    <div className="relative grid min-h-dvh place-items-center px-4 text-fg">
      <Backdrop />
      <div role="alert" className="glass w-full max-w-md rounded-3xl border border-line p-8 text-center shadow-glass">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-warning/10 text-warning">
          <WifiOff className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-bold">{offline ? 'Can’t reach SpendWise' : 'Couldn’t check your session'}</h1>
        <p className="mt-2 text-sm text-muted">
          {offline
            ? 'The SpendWise server isn’t answering. Start the backend (npm start, port 3000), then try again.'
            : error instanceof Error
              ? error.message
              : 'Something went wrong while checking your session.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mx-auto mt-6 inline-flex items-center gap-2 rounded-xl accent-gradient px-5 py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-60"
        >
          <RotateCw className={`size-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden />
          {retrying ? 'Checking…' : 'Try again'}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
   Guards
   --------------------------------------------------------------------- */

/** Signed-in only. Anyone else goes to /login?next=<where they were going>. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <SessionSplash />;
  if (!session.data) {
    return <SessionError error={session.error} retrying={session.isFetching} onRetry={() => session.refetch()} />;
  }

  const { user, reason } = session.data;
  if (!user) {
    const here = location.pathname + location.search + location.hash;
    // A deliberate sign-out starts fresh at the dashboard next time; anything else returns here.
    const to = reason === 'logout' || here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`;
    const state: LoginLocationState = { notice: reason };
    return <Navigate to={to} replace state={state} />;
  }
  return children;
}

/** Login / register: a signed-in visitor is sent on to ?next= (or the dashboard). */
export function PublicOnly({ children }: { children: ReactNode }) {
  const session = useSession();
  const [params] = useSearchParams();

  if (session.isPending) return <SessionSplash label="Checking your session…" />;
  if (session.data?.user) return <Navigate to={safeNext(params.get('next'))} replace />;
  return children;
}

/**
 * Any signed-in request that comes back 401 (session expired, revoked by a password
 * reset, or signed out in another tab) ends the session here too.
 */
export function AuthSync() {
  const queryClient = useQueryClient();
  useEffect(() => setUnauthorizedHandler(() => markSignedOut(queryClient, 'expired')), [queryClient]);
  return null;
}
