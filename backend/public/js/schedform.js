// The add / edit schedule fields (used in a dialog). Same look and rules as the transaction form.
import { el, field, option, todayLocal } from '/js/ui.js';
import { parseMoney, toInput } from '/js/money.js';

const REPEATS = [
  ['once', 'Does not repeat (one time)'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'],
  ['quarterly', 'Every 3 months'], ['yearly', 'Every year'], ['custom', 'Custom…'],
];

/**
 * ctx: { groups, accounts, payees }   initial: a schedule from the API, or null for a blank form.
 * Returns { node, read() }. read() returns the JSON body for POST/PATCH, or throws an Error with a friendly message.
 */
export function buildScheduleFields({ groups, accounts, payees = [] }, initial = null) {
  let type = initial ? (initial.amountMinor > 0 ? 'income' : 'expense') : 'expense';

  const toggle = el('div', { className: 'toggle full' },
    el('button', { type: 'button', textContent: 'Expense / bill', dataset: { t: 'expense' } }),
    el('button', { type: 'button', textContent: 'Income', dataset: { t: 'income' } }));
  const paint = () => { for (const b of toggle.children) b.className = b.dataset.t === type ? (type === 'expense' ? 'on-exp' : 'on-inc') : ''; };
  toggle.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { type = b.dataset.t; paint(); } });
  paint();

  const name = el('input', { type: 'text', maxLength: 60, placeholder: 'e.g. Netflix, Rent, Salary', autocomplete: 'off', value: initial ? initial.name : '' });
  const payee = el('input', { type: 'text', maxLength: 60, placeholder: 'Who you pay / who pays you', autocomplete: 'off', value: initial ? initial.payee : '' });
  const listId = `sp-${Math.random().toString(36).slice(2, 8)}`;
  const datalist = el('datalist', { id: listId }, ...payees.map((p) => el('option', { value: p.name })));
  payee.setAttribute('list', listId);

  const amount = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00', autocomplete: 'off', value: initial ? toInput(Math.abs(initial.amountMinor)) : '' });

  const account = el('select');
  for (const a of accounts) {
    if (a.closed && !(initial && initial.accountId === a.id)) continue;
    account.append(option(a.id, a.name + (a.closed ? ' (closed)' : ''), initial ? initial.accountId === a.id : false));
  }
  const category = el('select');
  category.append(option('', 'Uncategorized', !initial || initial.categoryId == null));
  for (const g of groups) {
    const og = el('optgroup', { label: g.name });
    for (const c of g.categories) {
      if (c.hidden && !(initial && initial.categoryId === c.id)) continue;
      og.append(option(c.id, `${c.icon} ${c.name}`, initial ? initial.categoryId === c.id : false));
    }
    if (og.children.length) category.append(og);
  }
  const notes = el('input', { type: 'text', maxLength: 200, placeholder: 'Notes (optional)', autocomplete: 'off', value: initial ? initial.notes : '' });

  const start = el('input', { type: 'date', value: initial ? initial.startDate : todayLocal() });
  const startHint = el('span', { className: 'hint' });
  const repeat = el('select');
  for (const [v, label] of REPEATS) repeat.append(option(v, label, (initial ? initial.frequency : 'monthly') === v));
  const interval = el('input', { type: 'number', min: 1, max: 1000, step: 1, value: initial && initial.frequency === 'custom' ? String(initial.interval) : '2' });
  const unit = el('select');
  for (const u of ['day', 'week', 'month', 'year']) unit.append(option(u, u + 's', initial && initial.frequency === 'custom' ? initial.unit === u : u === 'week'));
  const customRow = el('div', { className: 'custom-repeat full' }, el('span', { textContent: 'Every' }), interval, unit);
  const end = el('input', { type: 'date', value: initial && initial.endDate ? initial.endDate : '' });

  const mode = el('select');
  mode.append(option('approval', 'Ask me first (I approve each one)', !initial || initial.mode === 'approval'));
  mode.append(option('auto', 'Create the transaction automatically', initial ? initial.mode === 'auto' : false));
  const cleared = el('input', { type: 'checkbox', checked: !!(initial && initial.cleared) });

  const syncRepeat = () => {
    customRow.hidden = repeat.value !== 'custom';
    end.disabled = repeat.value === 'once';
    if (end.disabled) end.value = '';
  };
  const syncStart = () => {
    const today = todayLocal();
    startHint.textContent = !initial && start.value && start.value <= today
      ? 'This date has already arrived, so it is created (or queued for approval) right away.' : '';
  };
  repeat.addEventListener('change', syncRepeat);
  start.addEventListener('input', syncStart);
  syncRepeat(); syncStart();

  const node = el('div', { className: 'fields' },
    toggle,
    field('Name', name, { full: true }),
    field('Payee', payee, { full: true }), datalist,
    field('Amount (₹)', amount), field('Account', account),
    field('Category', category, { full: true }),
    field('First date', start, { hint: undefined }),
    field('Repeats', repeat),
    customRow,
    field('Stop after (optional)', end, { full: true, hint: 'Leave empty to repeat until you pause or delete it.' }),
    field('When a date arrives', mode, { full: true, hint: '“Ask me first” puts it in your approval list. Nothing touches your balance until you approve.' }),
    field('Notes', notes, { full: true }),
    el('label', { className: 'field full check-row' }, cleared, el('span', { textContent: 'Mark the created transactions as cleared' })));
  node.querySelector('input[type=date]').parentElement.append(startHint);

  return {
    node,
    read() {
      const paise = parseMoney(amount.value);
      if (paise === null || paise <= 0) throw new Error('Enter an amount greater than 0 (for example 1250.50).');
      if (!start.value) throw new Error('Pick the first date.');
      if (!payee.value.trim() && !name.value.trim()) throw new Error('Give the schedule a name or a payee.');
      const body = {
        name: name.value.trim() || undefined,
        payee: payee.value.trim(),
        accountId: Number(account.value),
        categoryId: category.value ? Number(category.value) : null,
        amountMinor: (type === 'expense' ? -1 : 1) * paise,
        notes: notes.value.trim(),
        cleared: cleared.checked,
        mode: mode.value,
        frequency: repeat.value,
        startDate: start.value,
        endDate: end.value || null,
      };
      if (repeat.value === 'custom') { body.interval = Number(interval.value); body.unit = unit.value; }
      if (initial && !body.name) body.name = body.payee;
      return body;
    },
  };
}
