'use strict';
const { httpError } = require('./http');

const bad = (msg) => httpError(400, msg);
const MAX_MINOR = 1e12; // 10,000,000,000.00 in major units: far beyond any real budget

function reqString(v, field, max, min = 1) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw bad(`${field} is required.`);
  if (s.length > max) throw bad(`${field} must be ${max} characters or fewer.`);
  return s;
}

function optString(v, field, max) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') throw bad(`${field} must be text.`);
  const s = v.trim();
  if (s.length > max) throw bad(`${field} must be ${max} characters or fewer.`);
  return s;
}

function intId(v, field) {
  const n = typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n <= 0) throw bad(`${field} is invalid.`);
  return n;
}

const optId = (v, field) => (v === undefined || v === null || v === '' ? null : intId(v, field));

function isoDate(v, field = 'Date') {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`${field} must look like 2026-11-08.`);
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1970 || y > 2200) {
    throw bad(`${field} is not a real date.`);
  }
  return v;
}

/** Money is always whole paise (integer). Sign is meaningful for transactions. */
function minor(v, field = 'Amount', { allowZero = false } = {}) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw bad(`${field} must be a whole number of paise.`);
  if (!allowZero && v === 0) throw bad(`${field} cannot be zero.`);
  if (Math.abs(v) > MAX_MINOR) throw bad(`${field} is too large.`);
  return v;
}

function boolish(v, field) {
  if (typeof v !== 'boolean') throw bad(`${field} must be true or false.`);
  return v ? 1 : 0;
}

function icon(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > 16 || /[\u0000-\u001f<>&"']/.test(s)) throw bad('Pick a valid emoji for the icon.');
  return s;
}

/** Route param like /api/accounts/:id -> positive integer, else 404. */
function paramId(ctx, name = 'id') {
  const raw = ctx.params[name];
  if (!/^\d{1,15}$/.test(raw) || Number(raw) <= 0) throw httpError(404, 'Not found.');
  return Number(raw);
}

function clampInt(raw, min, max, dflt) {
  if (raw === null || raw === undefined || raw === '') return dflt;
  if (!/^\d{1,10}$/.test(raw)) throw bad('Invalid number in query.');
  return Math.min(max, Math.max(min, Number(raw)));
}

module.exports = {
  bad, MAX_MINOR, reqString, optString, intId, optId, isoDate, minor, boolish, icon, paramId, clampInt,
};
