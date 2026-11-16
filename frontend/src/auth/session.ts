import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError, queryKeys, type User } from '../lib/api';

/* ---------------------------------------------------------------------
   Session state, read from GET /api/auth/status.

   That endpoint always answers 200 with { user, allowSignup }, signed in
   or not, so it is the right call for deciding where to send a visitor.
   The session itself is the HttpOnly sw_sid cookie (14-day rolling expiry
   on the server), so a reload or a new tab stays signed in with no
   client-side token storage.
   --------------------------------------------------------------------- */

/** Body of GET /api/auth/status (server/app.js). */
export interface AuthStatus {
  user: User | null;
  allowSignup: boolean;
}

/** Why the user is signed out, so the login screen can say so. Client-side only. */
export type SignedOutReason = 'logout' | 'expired';

export type SessionState = AuthStatus & { reason?: SignedOutReason };

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  displayName: string;
  password: string;
}

const isSessionKey = (key: readonly unknown[]) => key[0] === queryKeys.session[0] && key[1] === queryKeys.session[1];

export function useSession() {
  const queryClient = useQueryClient();
  return useQuery<SessionState>({
    queryKey: queryKeys.session,
    queryFn: async ({ signal }) => {
      const status = await api.get<AuthStatus>('/api/auth/status', signal);
      // The header and dashboard read /api/auth/me; seed it so they don't refetch.
      if (status.user) queryClient.setQueryData(queryKeys.me, status.user);
      return status;
    },
    staleTime: 60_000,
    // Coming back to the tab re-checks, so signing out in another tab is noticed.
    refetchOnWindowFocus: true,
  });
}

/** Drop every cached query except the session, so one user's data never shows for another. */
function dropUserData(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (q) => !isSessionKey(q.queryKey) });
}

function allowSignupNow(queryClient: QueryClient) {
  return queryClient.getQueryData<SessionState>(queryKeys.session)?.allowSignup ?? true;
}

export function markSignedIn(queryClient: QueryClient, user: User) {
  const allowSignup = allowSignupNow(queryClient);
  dropUserData(queryClient);
  queryClient.setQueryData(queryKeys.me, user);
  queryClient.setQueryData<SessionState>(queryKeys.session, { user, allowSignup });
}

export function markSignedOut(queryClient: QueryClient, reason: SignedOutReason) {
  const current = queryClient.getQueryData<SessionState>(queryKeys.session);
  if (!current?.user && current?.reason) return; // already handled
  void queryClient.cancelQueries({ predicate: (q) => !isSessionKey(q.queryKey) });
  dropUserData(queryClient);
  queryClient.setQueryData<SessionState>(queryKeys.session, {
    user: null,
    allowSignup: current?.allowSignup ?? true,
    reason,
  });
}

/** POST /api/auth/login { email, password } → 200 { user } | 401 | 429. */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api.post<{ user: User }>('/api/auth/login', input),
    onSuccess: ({ user }) => markSignedIn(queryClient, user),
  });
}

/** POST /api/auth/register { email, displayName, password } → 201 { user } | 400 | 403 | 409 | 429. */
export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post<{ user: User }>('/api/auth/register', input),
    onSuccess: ({ user }) => markSignedIn(queryClient, user),
    onError: (err) => {
      // A 403 can mean sign-ups were turned off since the page loaded; ask the server.
      if (err instanceof ApiError && err.status === 403) void queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

/**
 * POST /api/auth/logout → 200 { ok: true }. The server deletes the session row and
 * clears sw_sid. Only then is the local state cleared; RequireAuth does the redirect.
 */
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/api/auth/logout'),
    onSuccess: () => markSignedOut(queryClient, 'logout'),
  });
}

/* ---------- redirect targets ---------- */

const DEFAULT_HOME = '/dashboard';

/** Same rules as safeNext() in server/app.js: same-site absolute paths only, never back to an auth page. */
export function safeNext(raw: string | null | undefined): string {
  const next = String(raw ?? '');
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/api/')) {
    return DEFAULT_HOME;
  }
  if (/^\/(login|register)(?:[/?#]|$)/.test(next)) return DEFAULT_HOME;
  return next;
}
