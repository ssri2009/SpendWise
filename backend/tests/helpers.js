'use strict';
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

/** Minimal cookie-jar client (behaves like one browser tab). */
class Client {
  constructor(base) { this.base = base; this.jar = {}; }

  async req(path, { method = 'GET', body, rawBody, csrf = true, headers = {} } = {}) {
    const h = { ...headers };
    const cookie = Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    if (body !== undefined || rawBody !== undefined) h['content-type'] = 'application/json';
    if (csrf && method !== 'GET' && this.jar.sw_csrf) h['x-csrf-token'] = this.jar.sw_csrf;
    const res = await fetch(this.base + path, {
      method, headers: h, redirect: 'manual',
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
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

  get(path) { return this.json(path); }
  post(path, body) { return this.json(path, { method: 'POST', body }); }
  patch(path, body) { return this.json(path, { method: 'PATCH', body }); }
  del(path) { return this.json(path, { method: 'DELETE' }); }

  async register(email, name = 'Test User', password = 'correct horse battery') {
    await this.json('/api/auth/csrf');
    return this.json('/api/auth/register', { method: 'POST', body: { email, displayName: name, password } });
  }
}

/** A logged-in client with handy lookups. */
async function newUser(base, email) {
  const c = new Client(base);
  const r = await c.register(email);
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.data)}`);
  c.accountId = (await c.get('/api/accounts')).data.accounts[0].id;
  const groups = (await c.get('/api/categories')).data.groups;
  c.cat = Object.fromEntries(groups.flatMap((g) => g.categories).map((x) => [x.name, x.id]));
  c.groupIds = Object.fromEntries(groups.map((g) => [g.name, g.id]));
  return c;
}

const tx = (c, over = {}) => c.post('/api/transactions', {
  accountId: c.accountId, date: '2026-11-05', amountMinor: -45000, payee: 'Pizza Hut', categoryId: c.cat.Food, ...over,
});

module.exports = { start, Client, newUser, tx };
