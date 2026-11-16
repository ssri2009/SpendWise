'use strict';
const { newToken, hashToken } = require('./security');

const DAY = 24 * 60 * 60 * 1000;
const RENEW_AFTER = 60 * 60 * 1000; // push expiry forward at most once per hour

function createSession(db, config, userId, userAgent) {
  const token = newToken();
  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions (id_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'
  ).run(hashToken(token), userId, now, now + config.sessionDays * DAY, String(userAgent || '').slice(0, 200));
  return token;
}

/** Returns { idHash, user, renewed } or null. Expired sessions are deleted. */
function lookupSession(db, config, token) {
  if (typeof token !== 'string' || !token || token.length > 100) return null;
  const idHash = hashToken(token);
  const row = db.prepare(
    `SELECT s.expires_at, u.id, u.email, u.display_name, u.currency, u.locale, u.budget_mode
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`
  ).get(idHash);
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
    return null;
  }
  let renewed = false;
  const newExpiry = now + config.sessionDays * DAY;
  if (newExpiry - row.expires_at > RENEW_AFTER) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(newExpiry, idHash);
    renewed = true;
  }
  return { idHash, renewed, user: toPublicUser(row) };
}

function toPublicUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
    currency: row.currency,
    locale: row.locale,
    budgetMode: row.budget_mode,
  };
}

function destroySession(db, token) {
  if (typeof token === 'string' && token) {
    db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hashToken(token));
  }
}

function destroyUserSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function purgeExpired(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

module.exports = { createSession, lookupSession, destroySession, destroyUserSessions, purgeExpired, toPublicUser };
