'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { loadConfig } = require('../server/config');

async function start(overrides = {}) {
  const config = loadConfig({ NODE_ENV: 'test', DB_FILE: ':memory:', SCRYPT_N: '1024', ...overrides });
  const server = createApp(config);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((r) => { server.close(r); server.closeAllConnections(); });
  return { server, base, close };
}

/** Minimal cookie-jar client (behaves like a browser tab). */
class Client {
  constructor(base) { this.base = base; this.jar = {}; }

  async req(path, { method = 'GET', body, csrf = true, headers = {} } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    if (csrf && method !== 'GET' && this.jar.sw_csrf) h['x-csrf-token'] = this.jar.sw_csrf;
    const res = await fetch(this.base + path, {
      method, headers: h, redirect: 'manual',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      const k = pair.slice(0, i);
      const v = pair.slice(i + 1);
      if (/Max-Age=0/i.test(c)) delete this.jar[k]; else this.jar[k] = v;
    }
    return res;
  }

  async json(path, opts) {
    const res = await this.req(path, opts);
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    return { status: res.status, data, res };
  }

  async register(email, name = 'Test User', password = 'correct horse battery') {
    await this.json('/api/auth/csrf');
    return this.json('/api/auth/register', { method: 'POST', body: { email, displayName: name, password } });
  }
}

test('health check is public', async () => {
  const s = await start();
  try {
    const { status, data } = await new Client(s.base).json('/api/health');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
  } finally { await s.close(); }
});

test('status endpoint answers 200 for logged-out and logged-in visitors', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    const out = await c.json('/api/auth/status');
    assert.equal(out.status, 200);
    assert.equal(out.data.user, null);
    assert.equal(out.data.allowSignup, true);
    await c.register('status@example.com', 'Stat');
    const inn = await c.json('/api/auth/status');
    assert.equal(inn.status, 200);
    assert.equal(inn.data.user.email, 'status@example.com');
  } finally { await s.close(); }
});

test('security headers are set', async () => {
  const s = await start();
  try {
    const res = await new Client(s.base).req('/login');
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  } finally { await s.close(); }
});

test('every protected page redirects to login when logged out', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    for (const p of ['/budget', '/transactions', '/reports', '/schedules', '/payees', '/rules', '/settings', '/budget/2026-11']) {
      const res = await c.req(p);
      assert.equal(res.status, 302, p);
      assert.equal(res.headers.get('location'), `/login?next=${encodeURIComponent(p)}`, p);
    }
    for (const p of ['/', '/login', '/register']) {
      assert.equal((await c.req(p)).status, 200, p);
    }
    assert.equal((await c.json('/api/auth/me')).status, 401);
  } finally { await s.close(); }
});

test('register requires a CSRF token', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    const r = await c.json('/api/auth/register', {
      method: 'POST', csrf: false,
      body: { email: 'a@example.com', displayName: 'A', password: 'correct horse battery' },
    });
    assert.equal(r.status, 403);
  } finally { await s.close(); }
});

test('cross-origin POST is blocked even with a valid token', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    await c.json('/api/auth/csrf');
    const r = await c.json('/api/auth/register', {
      method: 'POST', headers: { origin: 'http://evil.example' },
      body: { email: 'a@example.com', displayName: 'A', password: 'correct horse battery' },
    });
    assert.equal(r.status, 403);
  } finally { await s.close(); }
});

test('forged CSRF token (not signed by the server) is rejected', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    c.jar.sw_csrf = 'deadbeef.cafebabe';
    const r = await c.json('/api/auth/register', {
      method: 'POST',
      body: { email: 'a@example.com', displayName: 'A', password: 'correct horse battery' },
    });
    assert.equal(r.status, 403);
  } finally { await s.close(); }
});

test('register validates email, name and password', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    await c.json('/api/auth/csrf');
    const post = (body) => c.json('/api/auth/register', { method: 'POST', body });
    assert.equal((await post({ email: 'nope', displayName: 'A', password: 'correct horse battery' })).status, 400);
    assert.equal((await post({ email: 'a@example.com', displayName: '', password: 'correct horse battery' })).status, 400);
    assert.equal((await post({ email: 'a@example.com', displayName: 'A', password: 'short' })).status, 400);
    assert.equal((await post({ email: 'a@example.com', displayName: 'A', password: 'password123' })).status, 400);
    assert.equal((await post({ email: 'alexander@example.com', displayName: 'A', password: 'alexander-is-cool' })).status, 400);
  } finally { await s.close(); }
});

test('register, use the app, log out, log back in', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    const reg = await c.register('Me@Example.com', 'Sri');
    assert.equal(reg.status, 201);
    assert.equal(reg.data.user.email, 'me@example.com'); // normalized
    assert.equal(reg.data.user.currency, 'INR');
    assert.equal('password_hash' in reg.data.user, false);

    const sidCookie = (await c.req('/api/auth/health')).status; // unknown route should 404 not crash
    assert.equal(sidCookie, 404);

    const me = await c.json('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.displayName, 'Sri');

    assert.equal((await c.req('/budget')).status, 200);
    assert.equal((await c.req('/budget/2026-11')).status, 200);
    assert.equal((await c.req('/login')).status, 302); // already logged in
    assert.equal((await c.req('/login')).headers.get('location'), '/budget');

    const oldSid = c.jar.sw_sid;
    assert.equal((await c.json('/api/auth/logout', { method: 'POST' })).status, 200);
    assert.equal((await c.json('/api/auth/me')).status, 401);

    // The old session cookie must be dead on the server, not just cleared in the browser.
    c.jar.sw_sid = oldSid;
    assert.equal((await c.json('/api/auth/me')).status, 401);
    delete c.jar.sw_sid;

    await c.json('/api/auth/csrf');
    const login = await c.json('/api/auth/login', { method: 'POST', body: { email: 'ME@example.com', password: 'correct horse battery' } });
    assert.equal(login.status, 200);
    assert.equal((await c.json('/api/auth/me')).status, 200);
  } finally { await s.close(); }
});

test('session cookie is HttpOnly + SameSite; CSRF cookie is readable', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    await c.json('/api/auth/csrf');
    const { res } = await c.json('/api/auth/register', {
      method: 'POST', body: { email: 'a@example.com', displayName: 'A', password: 'correct horse battery' },
    });
    const cookies = res.headers.getSetCookie();
    const sid = cookies.find((x) => x.startsWith('sw_sid='));
    const csrf = cookies.find((x) => x.startsWith('sw_csrf='));
    assert.match(sid, /HttpOnly/);
    assert.match(sid, /SameSite=Lax/);
    assert.doesNotMatch(csrf, /HttpOnly/);
  } finally { await s.close(); }
});

test('duplicate email is rejected', async () => {
  const s = await start();
  try {
    assert.equal((await new Client(s.base).register('dup@example.com')).status, 201);
    assert.equal((await new Client(s.base).register('DUP@example.com')).status, 409);
  } finally { await s.close(); }
});

test('wrong password and unknown email give the same error', async () => {
  const s = await start();
  try {
    await new Client(s.base).register('real@example.com');
    const c = new Client(s.base);
    await c.json('/api/auth/csrf');
    const a = await c.json('/api/auth/login', { method: 'POST', body: { email: 'real@example.com', password: 'wrong password!!' } });
    const b = await c.json('/api/auth/login', { method: 'POST', body: { email: 'ghost@example.com', password: 'wrong password!!' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.data.error, b.data.error);
  } finally { await s.close(); }
});

test('login is rate limited after 5 failures', async () => {
  const s = await start();
  try {
    await new Client(s.base).register('victim@example.com');
    const c = new Client(s.base);
    await c.json('/api/auth/csrf');
    const attempt = () => c.json('/api/auth/login', { method: 'POST', body: { email: 'victim@example.com', password: 'wrong password!!' } });
    for (let i = 0; i < 5; i++) assert.equal((await attempt()).status, 401);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.res.headers.get('retry-after')) > 0);
    // Even the correct password is refused while blocked.
    const right = await c.json('/api/auth/login', { method: 'POST', body: { email: 'victim@example.com', password: 'correct horse battery' } });
    assert.equal(right.status, 429);
  } finally { await s.close(); }
});

test('two users only ever see their own account', async () => {
  const s = await start();
  try {
    const a = new Client(s.base);
    const b = new Client(s.base);
    await a.register('alice@example.com', 'Alice');
    await b.register('bob@example.com', 'Bob');
    assert.equal((await a.json('/api/auth/me')).data.user.email, 'alice@example.com');
    assert.equal((await b.json('/api/auth/me')).data.user.email, 'bob@example.com');
    // Using Alice's CSRF cookie with Bob's session still can't cross accounts.
    assert.notEqual(a.jar.sw_sid, b.jar.sw_sid);
  } finally { await s.close(); }
});

test('sign-ups can be disabled; the very first account is still allowed', async () => {
  const s = await start({ ALLOW_SIGNUP: 'false' });
  try {
    const cfg1 = await new Client(s.base).json('/api/auth/config');
    assert.equal(cfg1.data.allowSignup, true); // bootstrap: no users yet
    assert.equal((await new Client(s.base).register('owner@example.com')).status, 201);
    const cfg2 = await new Client(s.base).json('/api/auth/config');
    assert.equal(cfg2.data.allowSignup, false);
    assert.equal((await new Client(s.base).register('intruder@example.com')).status, 403);
  } finally { await s.close(); }
});

test('only public assets are served; no path traversal', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    assert.equal((await c.req('/css/style.css')).status, 200);
    assert.equal((await c.req('/css/app.css')).status, 200);
    assert.equal((await c.req('/js/layout.js')).status, 200);
    for (const p of [
      '/pages/budget.html', '/server/config.js', '/.env', '/package.json', '/data/spendwise.db',
      '/css/..%2f..%2fserver%2fconfig.js', '/js/..%2f..%2fpackage.json', '/css/%2e%2e/%2e%2e/package.json',
    ]) {
      assert.equal((await c.req(p)).status, 404, p);
    }
  } finally { await s.close(); }
});

test('malformed requests do not crash the server', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    assert.equal((await c.req('/%E0%A4%A')).status, 400); // bad percent-encoding
    await c.json('/api/auth/csrf');
    const res = await fetch(s.base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sw_csrf=${c.jar.sw_csrf}`, 'x-csrf-token': c.jar.sw_csrf },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    const wrongType = await fetch(s.base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', cookie: `sw_csrf=${c.jar.sw_csrf}`, 'x-csrf-token': c.jar.sw_csrf },
      body: 'x',
    });
    assert.equal(wrongType.status, 415);
    assert.equal((await c.json('/api/health')).status, 200); // still alive
  } finally { await s.close(); }
});

test('production refuses to start without a strong SESSION_SECRET', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DB_FILE: ':memory:', SESSION_SECRET: '' }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DB_FILE: ':memory:', SESSION_SECRET: 'short' }), /32/);
  assert.doesNotThrow(() => loadConfig({ NODE_ENV: 'production', DB_FILE: ':memory:', SESSION_SECRET: 'x'.repeat(40) }));
});
