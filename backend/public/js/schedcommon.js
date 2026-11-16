// Shared by the Schedules, Bills, Calendar and Forecast pages: the tab bar, date helpers and the "approve / pay" dialogs.
// No innerHTML anywhere: every piece of user text goes through textContent (the el() helper).
import { api } from '/js/api.js';
import { el, field, openModal } from '/js/ui.js';
import { parseMoney, toInput } from '/js/money.js';

const TABS = [['Schedules', '/schedules'], ['Bills', '/bills'], ['Calendar', '/calendar'], ['Forecast', '/forecast']];

/** The four sibling views, shown under the page title. */
export function mountTabs(activeHref) {
  const bar = el('div', { className: 'tabs sched-tabs', role: 'navigation', ariaLabel: 'Schedules sections' },
    ...TABS.map(([label, href]) => el('a', { href, className: 'small-btn' + (href === activeHref ? ' active' : ''), textContent: label })));
  const head = document.querySelector('.page-head') || document.querySelector('.dash-head');
  head.insertAdjacentElement('afterend', bar);
}

const parts = (iso) => iso.split('-').map(Number);
export const toDate = (iso) => { const [y, m, d] = parts(iso); return new Date(y, m - 1, d); };
export const dateText = (iso, locale) => toDate(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
export const shortDate = (iso, locale) => toDate(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
export function daysBetween(a, b) {
  const [y1, m1, d1] = parts(a); const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relative(iso, today) {
  const n = daysBetween(today, iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
export const kindIcon = (amountMinor) => (amountMinor < 0 ? '🧾' : '💰');

/** A small coloured badge. */
export const pill = (text, kind = '') => el('span', { className: 'pill' + (kind ? ' ' + kind : ''), textContent: text });

/** Rupee text field that always means "this much", the sign comes from the schedule. */
function amountInput(minor) {
  return el('input', { type: 'text', inputMode: 'decimal', autocomplete: 'off', placeholder: '0.00', value: toInput(Math.abs(minor)) });
}

function readAmount(input, sign) {
  const paise = parseMoney(input.value);
  if (paise === null || paise <= 0) throw new Error('Enter an amount greater than 0 (for example 1250.50).');
  return sign * paise;
}

/**
 * Approve a bill that is waiting (an occurrence). item = { occurrenceId, name, dueDate, amountMinor }.
 * You can change the amount (a variable bill) and the date it is recorded on.
 */
export function approveDialog({ item, money, today, onDone, income = false }) {
  const amount = amountInput(item.amountMinor);
  const date = el('input', { type: 'date', value: item.dueDate });
  const sign = item.amountMinor < 0 ? -1 : 1;
  openModal({
    title: `${sign < 0 ? 'Pay' : 'Receive'} ${item.name}`,
    content: el('div', { className: 'fields' },
      el('p', { className: 'modal-text full', textContent: `Due ${item.dueDate}. This creates the transaction now (your rules run on it). Change the amount if the real bill was different.` }),
      field('Amount', amount), field('Date', date)),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      { label: sign < 0 ? 'Mark paid' : 'Mark received', kind: 'primary', onClick: async () => {
        const body = { amountMinor: readAmount(amount, sign) };
        if (date.value) body.date = date.value;
        const r = await api(`/api/schedule-occurrences/${item.occurrenceId}/approve`, { method: 'POST', body });
        await onDone(r);
      } },
    ],
  });
}

/** Pay the next (not yet due) occurrence of a schedule now. item = { scheduleId, name, dueDate, amountMinor }. */
export function payNextDialog({ item, today, onDone }) {
  const amount = amountInput(item.amountMinor);
  const date = el('input', { type: 'date', value: today });
  const sign = item.amountMinor < 0 ? -1 : 1;
  openModal({
    title: `${sign < 0 ? 'Pay' : 'Receive'} ${item.name} early`,
    content: el('div', { className: 'fields' },
      el('p', { className: 'modal-text full', textContent: `It is due ${item.dueDate}. Paying now creates the transaction today and nothing is created again on the due date.` }),
      field('Amount', amount), field('Date', date)),
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Create transaction', kind: 'primary', onClick: async () => {
        const body = { amountMinor: readAmount(amount, sign) };
        if (date.value) body.date = date.value;
        const r = await api(`/api/schedules/${item.scheduleId}/post-next`, { method: 'POST', body });
        await onDone(r);
      } },
    ],
  });
}
