'use strict';
// Regression tests for the "403 Missing or invalid security token" lock-out.
// Two real-world states both used to leave the browser permanently stuck:
//   A) a leftover sw_csrf cookie signed with a DIFFERENT session secret (e.g. app re-installed in a new folder)
//   B) a valid sw_csrf cookie that page JavaScript cannot read, so the header was sent empty
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, Client } = require('./helpers');
const { makeCsrf } = require('../server/security');

const NEW_USER = { email: 'csrf@example.com', displayName: 'C', password: 'correct horse battery' };
const staleToken = () => makeCsrf('a-completely-different-session-secret');

/* ---------------------------- server side ---------------------------- */

test('stale cookie (old secret): rejected with code "csrf" and the bad cookie is replaced', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    const stale = staleToken();
    c.jar.sw_csrf = stale;
    const r = await c.post('/api/auth/register', NEW_USER); // client sends header == cookie, like api.js did
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'csrf');
    assert.notEqual(c.jar.sw_csrf, stale, 'server must replace the unusable cookie');
    // The very next attempt with the replacement now works, with no manual cookie clearing
    const again = await c.post('/api/auth/register', NEW_USER);
    assert.equal(again.status, 201);
  } finally { await s.close(); }
});

test('GET /api/auth/csrf returns the token in the body and it matches the cookie that will be sent', async () => {
  const s = await start();
  try {
    // no cookie -> a new one is issued and echoed in the body
    const c = new Client(s.base);
    const a = await c.get('/api/auth/csrf');
    assert.equal(a.data.csrfToken, c.jar.sw_csrf);

    // valid cookie -> same token returned, cookie untouched (this is what lets an unreadable cookie work)
    const b = await c.get('/api/auth/csrf');
    assert.equal(b.data.csrfToken, a.data.csrfToken);
    assert.equal(c.jar.sw_csrf, a.data.csrfToken);

    // stale cookie -> replaced, and the body carries the replacement
    const d = new Client(s.base);
    const stale = staleToken();
    d.jar.sw_csrf = stale;
    const e = await d.get('/api/auth/csrf');
    assert.notEqual(e.data.csrfToken, stale);
    assert.equal(e.data.csrfToken, d.jar.sw_csrf);
    assert.equal((await d.post('/api/auth/register', NEW_USER)).status, 201);
  } finally { await s.close(); }
});

test('valid cookie the page cannot read: using the body token as the header is accepted', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    const { data } = await c.get('/api/auth/csrf');      // cookie is now in the jar (the "hidden" cookie)
    const res = await c.req('/api/auth/register', {
      method: 'POST', csrf: false, body: NEW_USER, headers: { 'x-csrf-token': data.csrfToken },
    });
    assert.equal(res.status, 201);
  } finally { await s.close(); }
});

test('security is unchanged: wrong, empty, missing and mismatched tokens are still rejected', async () => {
  const s = await start();
  try {
    const c = new Client(s.base);
    const { data } = await c.get('/api/auth/csrf');
    const attempt = async (headers) => (await c.req('/api/auth/register', { method: 'POST', csrf: false, body: NEW_USER, headers })).status;
    assert.equal(await attempt({}), 403);                                        // no header
    assert.equal(await attempt({ 'x-csrf-token': '' }), 403);                    // empty header
    assert.equal(await attempt({ 'x-csrf-token': staleToken() }), 403);          // validly shaped but not equal to the cookie
    assert.equal(await attempt({ 'x-csrf-token': data.csrfToken + 'x' }), 403);  // tampered
    // A forged cookie + matching header (attacker-chosen) fails the signature check
    const forged = new Client(s.base);
    forged.jar.sw_csrf = 'attacker.chosen';
    assert.equal((await forged.post('/api/auth/register', NEW_USER)).status, 403);
    // The Origin check still blocks cross-site posts even with a perfectly valid token, and is NOT marked retryable
    const cross = await c.req('/api/auth/register', { method: 'POST', body: NEW_USER, headers: { origin: 'http://evil.example' } });
    assert.equal(cross.status, 403);
    assert.equal((await cross.json()).code, undefined);
    // And nothing got registered by any of the above
    assert.equal((await c.post('/api/auth/register', NEW_USER)).status, 201);
  } finally { await s.close(); }
});

/* ------------------- the real browser client (public/js/api.js) ------------------- */

// A tiny fake server + fake document so the unmodified api.js can be exercised in Node.
function fakeBrowser({ cookie, serverToken = 'GOOD.tok', knownBad = [] }) {
  const log = { posts: [], gets: 0 };
  globalThis.document = { cookie };
  globalThis.fetch = async (url, init = {}) => {
    const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url === '/api/auth/csrf') {
      log.gets++;
      globalThis.document.cookie = `sw_csrf=${serverToken}`; // server (re)issues a readable cookie
      return reply(200, { csrfToken: serverToken });
    }
    const sent = init.headers && init.headers['X-CSRF-Token'];
    log.posts.push(sent === undefined ? '(no header)' : sent);
    if (sent === serverToken) return reply(200, { ok: true });
    return reply(403, { error: 'Missing or invalid security token.', ...(knownBad === 'noncsrf' ? {} : { code: 'csrf' }) });
  };
  return log;
}

test('client: normal case sends the cookie token once, with no extra round trip', async () => {
  const { api } = await import('../public/js/api.js');
  const log = fakeBrowser({ cookie: 'x=1; sw_csrf=GOOD.tok; y=2' });
  assert.deepEqual(await api('/api/thing', { method: 'POST', body: {} }), { ok: true });
  assert.deepEqual(log.posts, ['GOOD.tok']);
  assert.equal(log.gets, 0);
});

test('client: no cookie -> asks the server, header is the token (never empty)', async () => {
  const { api } = await import('../public/js/api.js');
  const log = fakeBrowser({ cookie: '' });
  await api('/api/thing', { method: 'POST', body: {} });
  assert.deepEqual(log.posts, ['GOOD.tok']);
  assert.equal(log.gets, 1);
});

test('client: cookie the page cannot read (document.cookie stays empty) still sends a real header', async () => {
  const { api } = await import('../public/js/api.js');
  const log = fakeBrowser({ cookie: '' });
  // Simulate HttpOnly: the browser accepts the cookie but document.cookie never exposes it.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...a) => { const r = await realFetch(...a); globalThis.document.cookie = ''; return r; };
  await api('/api/thing', { method: 'POST', body: {} });
  assert.deepEqual(log.posts, ['GOOD.tok'], 'header must carry the server-validated token, not an empty string');
});

test('client: stale readable cookie -> one automatic retry with a fresh token succeeds', async () => {
  const { api } = await import('../public/js/api.js');
  const log = fakeBrowser({ cookie: 'sw_csrf=OLD.stale' });
  assert.deepEqual(await api('/api/thing', { method: 'POST', body: {} }), { ok: true });
  assert.deepEqual(log.posts, ['OLD.stale', 'GOOD.tok']);
  assert.equal(log.gets, 1);
});

test('client: retries only once, then reports the error', async () => {
  const { api } = await import('../public/js/api.js');
  const log = fakeBrowser({ cookie: 'sw_csrf=OLD.stale', serverToken: 'GOOD.tok' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => (url === '/api/auth/csrf' ? realFetch(url, init) : { ok: false, status: 403, json: async () => ({ error: 'nope', code: 'csrf' }) });
  await assert.rejects(api('/api/thing', { method: 'POST', body: {} }), (e) => e.status === 403 && e.message === 'nope');
  assert.equal(log.gets, 1); // exactly one refresh, no loop
});

test('client: a 403 that is not a CSRF problem is never retried; GET never needs a token', async () => {
  const { api } = await import('../public/js/api.js');
  const log = fakeBrowser({ cookie: 'sw_csrf=GOOD.tok', knownBad: 'noncsrf' });
  const realFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = async (url, init) => {
    if (init && init.method === 'POST') { posts++; return { ok: false, status: 403, json: async () => ({ error: 'Cross-origin request blocked.' }) }; }
    return realFetch(url, init);
  };
  await assert.rejects(api('/api/thing', { method: 'POST', body: {} }), /Cross-origin/);
  assert.equal(posts, 1);
  globalThis.fetch = async (url, init) => { assert.equal(init.headers['X-CSRF-Token'], undefined); return { ok: true, status: 200, json: async () => ({ fine: 1 }) }; };
  assert.deepEqual(await api('/api/thing'), { fine: 1 });
  void log;
});
