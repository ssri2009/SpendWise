import { api } from '/js/api.js';
import { ready } from '/js/layout.js';

const form = document.getElementById('form');
const err = document.getElementById('err');
const btn = document.getElementById('submit');
const signupLine = document.getElementById('signupLine');

function nextUrl() {
  const n = new URLSearchParams(location.search).get('next') || '';
  const ok = n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') && !n.startsWith('/api/');
  return ok ? n : '/budget';
}

ready.then(({ allowSignup }) => { if (allowSignup === false) signupLine.hidden = true; });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  btn.disabled = true;
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: { email: form.email.value, password: form.password.value },
    });
    location.href = nextUrl();
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});
