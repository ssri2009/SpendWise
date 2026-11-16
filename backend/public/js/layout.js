// Shared shell for every page: nav, theme toggle, toast, session check.
// Pages import { ready } to get { user, allowSignup } once the shell is up.
import { api } from '/js/api.js';
import { el } from '/js/ui.js';

const APP_LINKS = [
  ['Budget', '/budget'],
  ['Transactions', '/transactions'],
  ['Reconcile', '/reconcile'],
  ['Import', '/import'],
  ['Reports', '/reports'],
  ['Schedules', '/schedules', ['/bills', '/calendar', '/forecast']],
  ['Payees', '/payees'],
  ['Rules', '/rules'],
];

export function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = el('div', { id: 'toast', className: 'toast' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

const isLight = () => { try { return localStorage.getItem('sw_theme') === 'light'; } catch { return false; } };

function applyTheme(light) {
  document.body.classList.toggle('light', light);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = light ? '☀️' : '🌙';
  try { localStorage.setItem('sw_theme', light ? 'light' : 'dark'); } catch { /* storage blocked */ }
}

function isActive(href) {
  const p = location.pathname.replace(/\/+$/, '') || '/';
  return p === href || p.startsWith(href + '/');
}

function buildNav({ isApp, user, allowSignup }) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.className = isApp ? 'app-nav' : 'public-nav';
  nav.textContent = '';

  const logo = el('a', { className: 'logo', href: user ? '/budget' : '/' }, '💸 Spend', el('span', { textContent: 'Wise' }));
  const right = el('div', { className: 'nav-right' });

  if (isApp) {
    for (const [label, href, also = []] of APP_LINKS) {
      right.append(el('a', { href, textContent: label, className: [href, ...also].some(isActive) ? 'active' : '' }));
    }
    right.append(el('a', {
      href: '/settings', className: 'nav-user' + (isActive('/settings') ? ' active' : ''),
      textContent: '⚙️ ' + (user ? user.displayName : 'Settings'),
    }));
    right.append(el('button', { className: 'small-btn', id: 'logoutBtn', type: 'button', textContent: 'Log out' }));
  } else {
    right.append(el('a', { href: '/', textContent: 'Home' }));
    if (location.pathname === '/') right.append(el('a', { href: '/#features', textContent: 'Features' }));
    if (user) {
      right.append(el('a', { href: '/budget', className: 'nav-cta', textContent: 'Open app' }));
    } else {
      right.append(el('a', { href: '/login', textContent: 'Log in' }));
      if (allowSignup !== false) right.append(el('a', { href: '/register', className: 'nav-cta', textContent: 'Sign up' }));
    }
  }

  right.append(el('button', {
    className: 'icon-btn', id: 'themeBtn', type: 'button', title: 'Toggle theme',
    attrs: { 'aria-label': 'Toggle theme' },
  }));
  nav.append(logo, right);

  document.getElementById('themeBtn').onclick = () => applyTheme(!document.body.classList.contains('light'));
  applyTheme(isLight());

  const out = document.getElementById('logoutBtn');
  if (out) {
    out.onclick = async () => {
      out.disabled = true;
      try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* leave anyway */ }
      location.href = '/login';
    };
  }
}

function fillUserFields(user) {
  if (!user) return;
  const map = { name: user.displayName, email: user.email, currency: user.currency, mode: user.budgetMode };
  for (const [key, value] of Object.entries(map)) {
    document.querySelectorAll(`[data-user-${key}]`).forEach((n) => { n.textContent = value; });
  }
}

async function init() {
  const isApp = document.body.dataset.app === '1';
  buildNav({ isApp, user: null, allowSignup: undefined });

  let user = null;
  let allowSignup;
  try {
    if (isApp) {
      try {
        ({ user } = await api('/api/auth/me'));
      } catch (err) {
        if (err.status === 401) {
          location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
          return { user: null };
        }
        throw err;
      }
    } else {
      const status = await api('/api/auth/status');
      user = status.user;
      allowSignup = status.allowSignup;
    }
  } catch (err) {
    toast(err.message);
  }

  buildNav({ isApp, user, allowSignup });
  fillUserFields(user);
  return { user, allowSignup };
}

export const ready = init();
