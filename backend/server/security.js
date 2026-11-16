'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 512 * 1024 * 1024;

/* ---------- Passwords (scrypt, params stored in the hash string) ---------- */

async function hashPassword(password, N) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  try {
    const key = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
    });
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Verifying against this for unknown emails keeps login timing the same.
const dummyCache = new Map();
async function dummyHash(N) {
  if (!dummyCache.has(N)) dummyCache.set(N, await hashPassword(crypto.randomBytes(12).toString('hex'), N));
  return dummyCache.get(N);
}

const COMMON = new Set([
  'password123', 'password1234', 'password12345', '1234567890', '12345678910', 'qwertyuiop',
  'qwerty12345', '0123456789', '9876543210', 'letmein1234', 'welcome1234', 'admin12345',
  'iloveyou123', 'abcdefghij', '1q2w3e4r5t', 'passw0rd123', 'changeme123', 'spendwise123',
  '1234512345', 'administrator', 'qwertyuiop123', 'password!23', 'abcd123456', 'football123',
]);

function passwordProblem(password, email) {
  if (typeof password !== 'string' || !password) return 'Password is required.';
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'Password is too long (max 200 characters).';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Pick something harder to guess.';
  if (/^(.)\1+$/.test(password)) return 'Password cannot be one repeated character.';
  const local = String(email || '').split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'Password should not contain your email name.';
  return null;
}

/* ---------- Session tokens ---------- */

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

/* ---------- CSRF (signed double-submit cookie) ---------- */

const mac = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex');

function makeCsrf(secret) {
  const rand = crypto.randomBytes(16).toString('hex');
  return `${rand}.${mac(secret, rand)}`;
}

function csrfSigned(secret, token) {
  if (typeof token !== 'string') return false;
  const [rand, sig, extra] = token.split('.');
  if (!rand || !sig || extra !== undefined) return false;
  const want = mac(secret, rand);
  if (sig.length !== want.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  } catch {
    return false;
  }
}

function csrfValid(secret, cookieToken, headerToken) {
  if (typeof cookieToken !== 'string' || typeof headerToken !== 'string') return false;
  if (!cookieToken || cookieToken.length !== headerToken.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) return false;
  } catch {
    return false;
  }
  return csrfSigned(secret, cookieToken);
}

module.exports = {
  hashPassword, verifyPassword, dummyHash, passwordProblem,
  newToken, hashToken, makeCsrf, csrfSigned, csrfValid,
};
