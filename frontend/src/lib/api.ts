import { useQuery } from '@tanstack/react-query';

/* ---------------------------------------------------------------------
   Fetch wrapper for the SpendWise Phase 7 API (server/app.js).

   Session: an HttpOnly `sw_sid` cookie set by POST /api/auth/login or
   /register. Same-origin /api/* (Vite proxies it in dev), so the browser
   sends it automatically.

   CSRF (server/security.js, signed double-submit cookie):
   - The server sets `sw_csrf` (readable, NOT HttpOnly) and requires the
     `X-CSRF-Token` header to equal it on every non-GET request, including
     login, register and logout.
   - Login and register issue a NEW `sw_csrf`, so the token is read from the
     cookie on every write and never cached.
   - No cookie yet: GET /api/auth/csrf → { csrfToken } (also sets the cookie).
   - 403 { code: "csrf" } (e.g. a cookie signed with an old SESSION_SECRET):
     the server has already replaced the cookie, so fetch a fresh token and
     retry exactly once.
   - The server also rejects writes whose Origin host differs from Host.

   Errors are { error: string, code?: string }. 429 carries Retry-After (s).
   --------------------------------------------------------------------- */
const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const CSRF_COOKIE = 'sw_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const CSRF_ENDPOINT = '/api/auth/csrf';

/** A 401 from these means "wrong credentials", not "session ended". */
const CREDENTIAL_ENDPOINTS = new Set(['/api/auth/login', '/api/auth/register']);

export class ApiError extends Error {
  /** HTTP status, or 0 when the server could not be reached. */
  readonly status: number;
  readonly code?: string;
  readonly body: unknown;
  /** Seconds to wait, from the Retry-After header (429 responses). */
  readonly retryAfter?: number;

  constructor(status: number, message: string, code?: string, body?: unknown, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryAfter = retryAfter;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

const NETWORK_MESSAGE = 'Could not reach the SpendWise server. Check that it is running, then try again.';

/* ---------- session-ended hook (wired up by auth/AuthSync) ---------- */

let unauthorizedHandler: (() => void) | null = null;

/** Called whenever a signed-in request comes back 401 (session expired or revoked). */
export function setUnauthorizedHandler(fn: () => void): () => void {
  unauthorizedHandler = fn;
  return () => {
    if (unauthorizedHandler === fn) unauthorizedHandler = null;
  };
}

/* ---------- CSRF ---------- */

function readCookie(name: string): string {
  const hit = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  if (!hit) return '';
  try {
    return decodeURIComponent(hit.slice(name.length + 1));
  } catch {
    return '';
  }
}

async function fetchCsrf(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${CSRF_ENDPOINT}`, { credentials: 'include', headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE);
  }
  const data = (await res.json().catch(() => null)) as { csrfToken?: unknown } | null;
  if (!res.ok || typeof data?.csrfToken !== 'string' || !data.csrfToken) {
    throw new ApiError(res.status || 0, 'Could not get a security token from the server. Reload the page and try again.');
  }
  return data.csrfToken;
}

/* ---------- request ---------- */

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function send(method: Method, path: string, body: unknown, token: string, signal?: AbortSignal) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers[CSRF_HEADER] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

const fullUrl = `${API_BASE_URL}${path}`;

let res: Response;
try {
  res = await fetch(fullUrl, {
     method,
     headers,
     body: body === undefined ? undefined : JSON.stringify(body),
     credentials: 'include',
     signal,
   });
  } catch (err) {
    if (signal?.aborted) throw err; // let React Query see its own cancellation
    throw new ApiError(0, NETWORK_MESSAGE);
  }

  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data: unknown =
    res.status === 204 ? undefined : isJson ? await res.json().catch(() => null) : await res.text().catch(() => '');
  return { res, data };
}

function errorFrom(res: Response, data: unknown): ApiError {
  let message = '';
  let code: string | undefined;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.error === 'string') message = d.error;
    if (typeof d.code === 'string') code = d.code;
  } else if (typeof data === 'string' && data.trim()) {
    message = data.trim().slice(0, 200);
  }

  const header = Number(res.headers.get('Retry-After'));
  const retryAfter = Number.isFinite(header) && header > 0 ? Math.ceil(header) : undefined;

  if (!message) {
    if (res.status === 429) message = 'Too many attempts. Please wait a few minutes and try again.';
    else if (res.status >= 500) message = 'Something went wrong on the server. Please try again.';
    else message = `Request failed (${res.status}).`;
  }
  return new ApiError(res.status, message, code, data, retryAfter);
}

async function request<T>(method: Method, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const isWrite = method !== 'GET';
  const token = isWrite ? readCookie(CSRF_COOKIE) || (await fetchCsrf()) : '';

  let { res, data } = await send(method, path, body, token, signal);

  if (isWrite && res.status === 403 && (data as { code?: unknown } | null)?.code === 'csrf') {
    ({ res, data } = await send(method, path, body, await fetchCsrf(), signal));
  }

  if (!res.ok) {
    if (res.status === 401 && !CREDENTIAL_ENDPOINTS.has(path.split('?')[0])) unauthorizedHandler?.();
    throw errorFrom(res, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

/* ---------------------------------------------------------------------
   Shared queries used by the shell
   --------------------------------------------------------------------- */

/** server/sessions.js toPublicUser(). */
export interface User {
  id: number;
  email: string;
  displayName: string | null;
  currency: string;
  locale: string;
  budgetMode?: string;
}

export const queryKeys = {
  session: ['auth', 'status'] as const,
  me: ['auth', 'me'] as const,
  health: ['health'] as const,
};

/** GET /api/auth/me → { user }. Seeded from the session check, so it rarely hits the network. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async ({ signal }) => (await api.get<{ user: User }>('/api/auth/me', signal)).user,
    staleTime: 5 * 60_000,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.get<unknown>('/api/health', signal),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
  });
}
