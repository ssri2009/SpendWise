// Small DOM helpers shared by every page. No innerHTML anywhere: user text always goes through textContent.

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'attrs') for (const [a, b] of Object.entries(v)) n.setAttribute(a, b);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n[k] = v;
  }
  n.append(...kids);
  return n;
}

export const $ = (id) => document.getElementById(id);

/* ---------- dates (always the user's LOCAL day, never UTC) ---------- */

const pad = (n) => String(n).padStart(2, '0');

export function todayLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayLabel(iso, locale) {
  const today = todayLocal();
  if (iso === today) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === todayLocal(y)) return 'Yesterday';
  return parseIso(iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function monthLabel(ym, locale) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/* ---------- modal (native <dialog>: focus trap + Esc for free) ---------- */

/**
 * buttons: [{ label, kind: 'primary'|'danger'|'ghost', onClick: async () => void, keepOpen?: bool }]
 * If onClick throws, the message is shown in the dialog and it stays open.
 */
export function openModal({ title, content, buttons = [] }) {
  const dlg = el('dialog', { className: 'modal' });
  const err = el('p', { className: 'err modal-err', role: 'alert' });
  const actions = el('div', { className: 'modal-actions' });
  const close = () => { if (dlg.open) dlg.close(); };

  let primary = null;
  for (const b of buttons) {
    const btn = el('button', {
      type: 'button', textContent: b.label,
      // 'warn' = a red-text secondary button (never the Enter-key default, so Enter can't delete by accident)
      className: 'btn btn-sm ' + (b.kind === 'primary' ? 'btn-primary' : b.kind === 'danger' ? 'btn-danger'
        : b.kind === 'warn' ? 'btn-ghost warn-text' : 'btn-ghost'),
    });
    if (b.kind === 'primary' || b.kind === 'danger') primary = primary || btn;
    btn.onclick = async () => {
      err.textContent = '';
      btn.disabled = true;
      try {
        if (b.onClick) await b.onClick();
        if (!b.keepOpen) close();
      } catch (e) {
        err.textContent = e.message || 'Something went wrong.';
      } finally {
        btn.disabled = false;
      }
    };
    actions.append(btn);
  }

  dlg.append(el('h3', { textContent: title }), content, err, actions);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); }); // click on the backdrop
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && primary) {
      e.preventDefault();
      primary.click();
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  return { close, dialog: dlg };
}

export function confirmModal({ title, message, confirmLabel = 'Delete', danger = true, onConfirm }) {
  return openModal({
    title,
    content: el('p', { className: 'modal-text', textContent: message }),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: onConfirm },
    ],
  });
}

/** Labelled form row for modals and forms. */
export function field(label, input, { full = false, hint } = {}) {
  const id = input.id || `f${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  const wrap = el('div', { className: 'field' + (full ? ' full' : '') },
    el('label', { htmlFor: id, textContent: label }), input);
  if (hint) wrap.append(el('span', { className: 'hint', textContent: hint }));
  return wrap;
}

export function option(value, label, selected = false) {
  const o = el('option', { value: String(value), textContent: label });
  o.selected = selected;
  return o;
}
