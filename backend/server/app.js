'use strict';
const http = require('node:http');
const path = require('node:path');

const { openDb, inTransaction } = require('./db');
const { runAllDue, runDue } = require('./schedules');
const { localToday } = require('./recurrence');
const { seedUser } = require('./seed');
const { RateLimiter } = require('./ratelimit');
const {
  httpError, parseCookies, serializeCookie, addSetCookie, readJson, sendJson, sendText,
  redirect, getClientIp, serveFile, resolveInside,
} = require('./http');
const {
  hashPassword, verifyPassword, dummyHash, passwordProblem, makeCsrf, csrfSigned, csrfValid,
} = require('./security');
const {
  createSession, lookupSession, destroySession, purgeExpired, toPublicUser,
} = require('./sessions');

const PUBLIC_ROOT = path.resolve(__dirname, '..', 'public');
const PAGES_DIR = path.join(PUBLIC_ROOT, 'pages');
const SID = 'sw_sid';
const CSRF = 'sw_csrf';

const PUBLIC_PAGES = { '/': 'index.html', '/login': 'login.html', '/register': 'register.html' };
const APP_PAGES = {
  '/budget': 'budget.html',
  '/transactions': 'transactions.html',
  '/reports': 'reports.html',
  '/schedules': 'schedules.html',
  '/bills': 'bills.html',
  '/calendar': 'calendar.html',
  '/forecast': 'forecast.html',
  '/payees': 'payees.html',
  '/rules': 'rules.html',
  '/reconcile': 'reconcile.html',
  '/import': 'import.html',
  '/settings': 'settings.html',
};
// These two accept one extra path segment, e.g. /budget/2026-11 or /reports/42.
const SUBPATH_PAGES = new Set(['/budget', '/reports']);

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/* ---------- helpers ---------- */

function setSecurityHeaders(res, config) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:", "connect-src 'self'", "object-src 'none'",
    "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
}

/** Only allow same-site absolute paths as post-login targets. */
function safeNext(value) {
  const n = String(value || '');
  if (!n.startsWith('/') || n.startsWith('//') || n.startsWith('/\\') || n.startsWith('/api/')) return '/budget';
  return n;
}

function resolvePage(pathname) {
  let p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (PUBLIC_PAGES[p]) return { file: PUBLIC_PAGES[p], protected: false, authRedirect: p !== '/' };
  if (APP_PAGES[p]) return { file: APP_PAGES[p], protected: true };
  const m = p.match(/^(\/[a-z]+)\/[\w-]{1,40}$/);
  if (m && SUBPATH_PAGES.has(m[1])) return { file: APP_PAGES[m[1]], protected: true };
  return null;
}

const normEmail = (v) => String(v ?? '').trim().toLowerCase();

/* ---------- app factory ---------- */

function createApp(config) {
  const db = openDb(config.dbFile);
  const loginByEmail = new RateLimiter(5, 15 * 60 * 1000);
  const loginByIp = new RateLimiter(30, 15 * 60 * 1000);
  const registerByIp = new RateLimiter(10, 60 * 60 * 1000);

  // "Today" for schedules. Real date in the server's local time zone (set TZ to change it); tests can pin it.
  const clock = { fixed: config.fixedToday || null, today() { return this.fixed || localToday(); } };

  purgeExpired(db);
  const purgeTimer = setInterval(() => { try { purgeExpired(db); } catch { /* ignore */ } }, 60 * 60 * 1000);
  purgeTimer.unref();

  const cookieOpts = (httpOnly) => ({
    maxAge: config.sessionDays * 86400, httpOnly, secure: config.secureCookies, sameSite: 'Lax',
  });
  const setSid = (res, token) => addSetCookie(res, serializeCookie(SID, token, cookieOpts(true)));
  const clearSid = (res) => addSetCookie(res, serializeCookie(SID, '', {
    maxAge: 0, httpOnly: true, secure: config.secureCookies, sameSite: 'Lax',
  }));
  const issueCsrf = (res) => {
    const token = makeCsrf(config.sessionSecret);
    addSetCookie(res, serializeCookie(CSRF, token, cookieOpts(false)));
    return token;
  };

  const signupOpen = () => config.allowSignup || db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;

  /** New session + fresh CSRF token. Any old session is destroyed first (no fixation). */
  function startSession(ctx, userId) {
    destroySession(db, ctx.cookies[SID]);
    const token = createSession(db, config, userId, ctx.req.headers['user-agent']);
    setSid(ctx.res, token);
    issueCsrf(ctx.res);
  }

  const tooMany = (seconds) => {
    const e = httpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    e.headers = { 'Retry-After': String(seconds) };
    return e;
  };

  /* ---------- API routes ---------- */

  const ROUTES = {
    'GET /api/health': { handler: (ctx) => sendJson(ctx.res, 200, { ok: true, time: new Date().toISOString() }) },

    'GET /api/auth/config': { handler: (ctx) => sendJson(ctx.res, 200, { allowSignup: signupOpen() }) },

    'GET /api/auth/csrf': {
      handler: (ctx) => {
        const existing = ctx.cookies[CSRF];
        const token = csrfSigned(config.sessionSecret, existing) ? existing : issueCsrf(ctx.res);
        sendJson(ctx.res, 200, { csrfToken: token });
      },
    },

    // For public pages: always 200, so logged-out visitors don't trigger console errors.
    'GET /api/auth/status': {
      handler: (ctx) => sendJson(ctx.res, 200, { user: ctx.user, allowSignup: signupOpen() }),
    },

    'GET /api/auth/me': { auth: true, handler: (ctx) => sendJson(ctx.res, 200, { user: ctx.user }) },

    'POST /api/auth/register': {
      body: true,
      handler: async (ctx) => {
        if (!signupOpen()) throw httpError(403, 'Sign-ups are disabled on this server.');
        const wait = registerByIp.retryAfter(ctx.ip);
        if (wait) throw tooMany(wait);
        registerByIp.hit(ctx.ip);

        const email = normEmail(ctx.body.email);
        const name = String(ctx.body.displayName ?? '').trim();
        const password = ctx.body.password;
        if (!EMAIL_RE.test(email) || email.length > 254) throw httpError(400, 'Enter a valid email address.');
        if (!name || name.length > 40) throw httpError(400, 'Name must be 1 to 40 characters.');
        const problem = passwordProblem(password, email);
        if (problem) throw httpError(400, problem);
        if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
          throw httpError(409, 'An account with that email already exists.');
        }

        const hash = await hashPassword(password, config.scryptN);
        let id;
        try {
          // User and their starting account/categories are created together or not at all.
          id = inTransaction(db, () => {
            const uid = Number(db.prepare('INSERT INTO users (email, display_name, password_hash) VALUES (?, ?, ?)')
              .run(email, name, hash).lastInsertRowid);
            seedUser(db, uid);
            return uid;
          });
        } catch (err) {
          if (/UNIQUE/i.test(err.message)) throw httpError(409, 'An account with that email already exists.');
          throw err;
        }
        startSession(ctx, id);
        const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        sendJson(ctx.res, 201, { user: toPublicUser(row) });
      },
    },

    'POST /api/auth/login': {
      body: true,
      handler: async (ctx) => {
        const email = normEmail(ctx.body.email);
        const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
        const emailKey = `${ctx.ip}|${email}`;
        const wait = Math.max(loginByEmail.retryAfter(emailKey), loginByIp.retryAfter(ctx.ip));
        if (wait) throw tooMany(wait);

        const row = email && password.length <= 200
          ? db.prepare('SELECT * FROM users WHERE email = ?').get(email) : null;
        // Always run one scrypt verification so timing does not reveal whether the email exists.
        const ok = await verifyPassword(password.slice(0, 200), row ? row.password_hash : await dummyHash(config.scryptN));
        if (!row || !ok) {
          loginByEmail.hit(emailKey);
          loginByIp.hit(ctx.ip);
          throw httpError(401, 'Incorrect email or password.');
        }
        loginByEmail.reset(emailKey);
        startSession(ctx, Number(row.id));
        db.prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
        sendJson(ctx.res, 200, { user: toPublicUser(row) });
      },
    },

    'POST /api/auth/logout': {
      handler: (ctx) => {
        destroySession(db, ctx.cookies[SID]);
        clearSid(ctx.res);
        sendJson(ctx.res, 200, { ok: true });
      },
    },
  };

  // Data routes (Phase 2+). Keys look like 'GET /api/accounts/:id'.
  Object.assign(ROUTES,
    require('./routes/accounts')({ db }),
    require('./routes/categories')({ db }),
    require('./routes/transactions')({ db }),
    require('./routes/budget')({ db }),
    require('./routes/payees')({ db }),
    require('./routes/rules')({ db }),
    require('./routes/dataio')({ db }),
    require('./routes/reconcile')({ db }),
    require('./routes/csvimport')({ db }),
    require('./routes/reports')({ db, clock }),
    require('./routes/schedules')({ db, clock }),
    require('./routes/forecast')({ db, clock }));

  // Compile once: exact routes by key, parameterised routes by regex.
  const PARAM_ROUTES = [];
  for (const [key, def] of Object.entries(ROUTES)) {
    const [method, p] = key.split(' ');
    if (!p.includes(':')) continue;
    const names = [];
    const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '$');
    PARAM_ROUTES.push({ method, re, names, def });
  }

  function matchRoute(method, pathname) {
    const exact = ROUTES[`${method} ${pathname}`];
    if (exact) return { def: exact, params: {} };
    for (const r of PARAM_ROUTES) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { def: r.def, params: Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]])) };
    }
    return null;
  }

  function pathKnown(pathname) {
    if (Object.keys(ROUTES).some((k) => k.endsWith(` ${pathname}`))) return true;
    return PARAM_ROUTES.some((r) => r.re.test(pathname));
  }

  function checkCsrf(ctx) {
    const origin = ctx.req.headers.origin;
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === ctx.req.headers.host; } catch { /* invalid origin */ }
      if (!ok) return { message: 'Cross-origin request blocked.' };
    }
    if (!csrfValid(config.sessionSecret, ctx.cookies[CSRF], ctx.req.headers['x-csrf-token'])) {
      return { message: 'Missing or invalid security token. Please try again.', csrf: true };
    }
    return null;
  }

  async function handleApi(ctx) {
    const { req, res, pathname } = ctx;
    const hit = matchRoute(req.method, pathname);
    if (!hit) {
      const known = pathKnown(pathname);
      return sendJson(res, known ? 405 : 404, { error: known ? 'Method not allowed.' : 'Not found.' });
    }
    const route = hit.def;
    if (route.auth && !ctx.user) return sendJson(res, 401, { error: 'Please log in.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const problem = checkCsrf(ctx);
      if (problem && problem.csrf) {
        // Mark it so the client knows a retry with a fresh token can succeed, and replace a cookie
        // that is not validly signed (e.g. left over from a run with a different SESSION_SECRET)
        // so that a plain page refresh also heals it.
        if (!csrfSigned(config.sessionSecret, ctx.cookies[CSRF])) issueCsrf(res);
        return sendJson(res, 403, { error: problem.message, code: 'csrf' });
      }
      if (problem) return sendJson(res, 403, { error: problem.message });
    }
    ctx.params = hit.params;
    ctx.query = ctx.url.searchParams;
    // Anything scheduled that has come due is handled before a signed-in user's page data is read, so the numbers are current.
    if (ctx.user && req.method === 'GET') catchUp(ctx.user.id);
    if (route.body) ctx.body = await readJson(req, route.bodyLimit);
    await route.handler(ctx);
  }

  /* ---------- pages + static files ---------- */

  function handlePage(ctx) {
    const { req, res, pathname } = ctx;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

    if (/^\/(css|js|img)\//.test(pathname)) {
      const file = resolveInside(PUBLIC_ROOT, pathname.slice(1));
      if (!file) return sendText(res, 404, 'Not found');
      return serveFile(req, res, file, config.production ? 'public, max-age=300' : 'no-cache');
    }

    const page = resolvePage(pathname);
    if (!page) return sendText(res, 404, 'Page not found');
    if (page.protected && !ctx.user) {
      return redirect(res, `/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
    }
    if (page.authRedirect && ctx.user) return redirect(res, safeNext(ctx.url.searchParams.get('next')));
    serveFile(req, res, path.join(PAGES_DIR, page.file), 'no-store');
  }

  /* ---------- request entry ---------- */

  async function handle(req, res) {
    setSecurityHeaders(res, config);
    let url;
    let pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendText(res, 400, 'Bad request');
    }
    if (pathname.includes('\0')) return sendText(res, 400, 'Bad request');

    const ctx = {
      req, res, url, pathname, cookies: parseCookies(req.headers.cookie),
      ip: getClientIp(req, config.trustProxy), user: null,
    };
    const sid = ctx.cookies[SID];
    if (sid) {
      const s = lookupSession(db, config, sid);
      if (s) {
        ctx.user = s.user;
        if (s.renewed) setSid(res, sid);
      } else {
        clearSid(res);
      }
    }

    if (pathname.startsWith('/api/')) return handleApi(ctx);
    return handlePage(ctx);
  }

  // Scheduled transactions that fell due (also while the server was off) are handled at start-up, every 15 minutes, and
  // before each signed-in GET request (at most once a minute per user). A failure here must never break a page.
  const lastCatchUp = new Map();
  function catchUp(userId) {
    const now = Date.now();
    const day = clock.today();
    const last = lastCatchUp.get(userId);
    if (last && last.day === day && now - last.at < 60 * 1000) return;     // a new day always re-checks
    lastCatchUp.set(userId, { day, at: now });
    try { runDue(db, userId, day); } catch (err) { console.error('[schedules]', err); }
  }
  const runEverything = () => { try { runAllDue(db, clock.today()); } catch (err) { console.error('[schedules]', err); } };
  runEverything();
  const scheduleTimer = setInterval(runEverything, 15 * 60 * 1000);
  scheduleTimer.unref();

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.destroy();
      if (err && err.status) return sendJson(res, err.status, { error: err.message }, err.headers || {});
      console.error('[error]', err);
      sendJson(res, 500, { error: 'Something went wrong on the server.' });
    });
  });
  server.on('close', () => {
    clearInterval(purgeTimer);
    clearInterval(scheduleTimer);
    try { db.close(); } catch { /* already closed */ }
  });
  server.db = db;
  server.clock = clock;
  return server;
}

module.exports = { createApp };
