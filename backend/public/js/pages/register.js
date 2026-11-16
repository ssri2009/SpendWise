import { api } from '/js/api.js';
import { ready } from '/js/layout.js';

const form = document.getElementById('form');
const err = document.getElementById('err');
const btn = document.getElementById('submit');
const closed = document.getElementById('closed');

ready.then(({ allowSignup }) => {
  if (allowSignup === false) {
    form.hidden = true;
    closed.hidden = false;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  if (form.password.value !== form.confirm.value) {
    err.textContent = 'Passwords do not match.';
    return;
  }
  btn.disabled = true;
  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: { displayName: form.displayName.value, email: form.email.value, password: form.password.value },
    });
    location.href = '/budget';
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false;
  }
});
