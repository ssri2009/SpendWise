// Tiny fetch wrapper: JSON in/out, CSRF header on writes, readable errors.
//
// CSRF token rules (the server compares the sw_csrf cookie with the X-CSRF-Token header and
// checks the token's signature):
//   1. Normally the token is the sw_csrf cookie, which is always the freshest value.
//   2. If the page cannot read that cookie, or it is missing, ask the server (GET /api/auth/csrf).
//      The server returns the token in the JSON body; it re-issues the cookie if the old one is bad.
//   3. If a write is still rejected as a CSRF failure (e.g. a leftover cookie signed with an old
//      secret), ask the server for a fresh token and retry exactly once.

function getCookie(name) {
  const hit = document.cookie.split('; ').find((c) => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}

function networkError() {
  const err = new Error('Could not reach the server. Check your connection.');
  err.status = 0;
  return err;
}

/** Asks the server for a token it has validated (and, if our cookie was bad, already replaced). */
async function fetchCsrf() {
  let res;
  try {
    res = await fetch('/api/auth/csrf', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    throw networkError();
  }
  let data = null;
  try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !data || !data.csrfToken) {
    const err = new Error('Could not get a security token from the server. Reload the page and try again.');
    err.status = res.status;
    throw err;
  }
  return data.csrfToken;
}

async function send(path, method, body, token) {
  const headers = { Accept: 'application/json' };
  if (token) headers['X-CSRF-Token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(path, {
      method, headers, credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw networkError();
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  return { res, data };
}

export async function api(path, { method = 'GET', body } = {}) {
  const isWrite = method !== 'GET';
  const token = isWrite ? (getCookie('sw_csrf') || await fetchCsrf()) : '';
  let { res, data } = await send(path, method, body, token);

  if (isWrite && res.status === 403 && data && data.code === 'csrf') {
    ({ res, data } = await send(path, method, body, await fetchCsrf()));
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
