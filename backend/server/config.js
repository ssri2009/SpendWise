'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));

/**
 * Build the validated config. `overrides` win over process.env (used by tests).
 */
function loadConfig(overrides = {}) {
  if (overrides.NODE_ENV !== 'test') loadDotEnv(path.join(ROOT, '.env'));
  const env = { ...process.env, ...overrides };

  if (env.DB_CLIENT && env.DB_CLIENT !== 'sqlite' && env.DB_CLIENT !== 'sqlite3') {
    throw new Error(`DB_CLIENT=${env.DB_CLIENT} is not supported in this build yet (SQLite only). Postgres support is planned.`);
  }

  const production = env.NODE_ENV === 'production';
  const dbFile = env.DB_FILE === ':memory:' ? ':memory:' : path.resolve(ROOT, env.DB_FILE || 'data/spendwise.db');

  let secret = env.SESSION_SECRET;
  if (!secret) {
    if (production) {
      throw new Error('SESSION_SECRET is required when NODE_ENV=production (use 32+ random characters).');
    }
    if (dbFile === ':memory:') {
      secret = crypto.randomBytes(32).toString('hex');
    } else {
      // Development convenience: generate once and keep it next to the database.
      const file = path.join(path.dirname(dbFile), '.session-secret');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) secret = fs.readFileSync(file, 'utf8').trim();
      if (!secret) {
        secret = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(file, secret, { mode: 0o600 });
      }
    }
  }
  if (production && secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  }

  return {
    production,
    host: env.HOST || '127.0.0.1',
    port: env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT),
    dbFile,
    sessionSecret: secret,
    allowSignup: bool(env.ALLOW_SIGNUP, true),
    trustProxy: Math.max(0, Number(env.TRUST_PROXY || 0) | 0),
    sessionDays: Number(env.SESSION_DAYS) > 0 ? Number(env.SESSION_DAYS) : 14,
    secureCookies: bool(env.COOKIE_SECURE, production),
    scryptN: Number(env.SCRYPT_N) > 0 ? Number(env.SCRYPT_N) : 32768,
    // Test-only: pin "today" (YYYY-MM-DD) so schedule tests do not depend on the real date. Ignored outside NODE_ENV=test.
    fixedToday: env.NODE_ENV === 'test' && /^\d{4}-\d{2}-\d{2}$/.test(env.TODAY || '') ? env.TODAY : null,
  };
}

module.exports = { loadConfig, ROOT };
