import { ready } from '/js/layout.js';

const $ = (id) => document.getElementById(id);
const inr = (n) => '₹' + Math.abs(n).toLocaleString('en-IN');

// Call-to-action reflects login state and whether sign-ups are open
ready.then(({ user, allowSignup }) => {
  const primary = $('ctaPrimary');
  const secondary = $('ctaSecondary');
  if (user) {
    primary.textContent = 'Open Dashboard →';
    primary.href = '/budget';
    secondary.hidden = true;
  } else if (allowSignup === false) {
    primary.textContent = 'Log in →';
    primary.href = '/login';
    secondary.hidden = true;
  }
});

// Typing text
const phrases = ['Track every rupee effortlessly.', 'See where your money goes.', 'Save smarter, spend wiser.'];
let pi = 0, ci = 0, del = false;
(function type() {
  const w = phrases[pi];
  $('typed').textContent = w.slice(0, ci);
  if (!del && ci === w.length) { del = true; return setTimeout(type, 1500); }
  if (del && ci === 0) { del = false; pi = (pi + 1) % phrases.length; }
  ci += del ? -1 : 1;
  setTimeout(type, del ? 30 : 65);
})();

// Hero stats + sample balance count-up
document.querySelectorAll('.count').forEach((el) => {
  const to = +el.dataset.to, start = performance.now();
  (function s(now) {
    const p = Math.min((now - start) / 1600, 1);
    el.textContent = Math.round(to * p);
    if (p < 1) requestAnimationFrame(s);
  })(start);
});
(function () {
  const el = $('heroBal'), to = 48250, start = performance.now() + 500;
  (function s(now) {
    const p = Math.max(0, Math.min((now - start) / 1800, 1));
    el.textContent = inr(Math.round(to * (1 - Math.pow(1 - p, 3))));
    if (p < 1) requestAnimationFrame(s);
  })(performance.now());
})();

// 3D tilt on the hero card
const tilt = $('tilt');
tilt.parentElement.addEventListener('mousemove', (e) => {
  const r = tilt.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
  tilt.style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 18}deg)`;
});
tilt.parentElement.addEventListener('mouseleave', () => { tilt.style.transform = ''; });

// Reveal on scroll
const io = new IntersectionObserver(
  (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('show')),
  { threshold: 0.12 },
);
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
