// The add/edit transaction fields. Used by the "Add" panel and the "Edit" dialog so they behave identically.
import { el, field, option, todayLocal } from '/js/ui.js';
import { parseMoney, toInput, makeMoney } from '/js/money.js';
import { openSplitEditor } from '/js/splitedit.js';

/**
 * ctx: { groups, accounts, payees? }  (from /api/categories, /api/accounts, /api/payees)
 * initial: a transaction from the API, or null for a blank form.
 */
export function buildTxFields({ groups, accounts, payees = [], money = makeMoney() }, initial = null, { accountId = null } = {}) {
  let type = initial ? (initial.amountMinor > 0 ? 'income' : 'expense') : 'expense';
  // Splits: null = one category; an array = the parts (signed paise, like the transaction itself).
  let splits = initial && initial.isSplit ? initial.splits.map((x) => ({ categoryId: x.categoryId, amountMinor: x.amountMinor, notes: x.notes })) : null;
  // A reconciled transaction is part of a signed-off statement: what changes the balance is locked.
  const locked = !!(initial && initial.reconciled);

  const toggle = el('div', { className: 'toggle full' },
    el('button', { type: 'button', textContent: 'Expense', dataset: { t: 'expense' } }),
    el('button', { type: 'button', textContent: 'Income', dataset: { t: 'income' } }));

  const payee = el('input', { type: 'text', maxLength: 60, placeholder: 'Payee or title (e.g. Swiggy)', autocomplete: 'off' });
  // Suggestions from the person's own active payees. Typing a brand-new name is still fine.
  const listId = `payees-${Math.random().toString(36).slice(2, 8)}`;
  const datalist = el('datalist', { id: listId });
  const byName = new Map();
  for (const p of payees) { byName.set(p.name.toLowerCase(), p); datalist.append(el('option', { value: p.name })); }
  payee.setAttribute('list', listId);
  const amount = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00', autocomplete: 'off' });
  const category = el('select');
  const account = el('select');
  const date = el('input', { type: 'date' });
  const notes = el('input', { type: 'text', maxLength: 200, placeholder: 'Notes (optional)', autocomplete: 'off' });
  const cleared = el('input', { type: 'checkbox' });

  const kindOf = new Map(); // category id -> isIncome
  function fillCategories(selectedId) {
    category.textContent = '';
    category.append(option('', 'Uncategorized', selectedId == null));
    for (const g of groups) {
      const cats = g.categories.filter((c) => !c.hidden || c.id === selectedId);
      if (!cats.length) continue;
      const og = el('optgroup', { label: g.name });
      for (const c of cats) {
        kindOf.set(c.id, g.isIncome);
        og.append(option(c.id, `${c.icon} ${c.name}`, c.id === selectedId));
      }
      category.append(og);
    }
  }

  function paint() {
    for (const b of toggle.children) {
      b.className = b.dataset.t === type ? (type === 'expense' ? 'on-exp' : 'on-inc') : '';
    }
  }

  toggle.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || locked) return;
    const before = type;
    type = b.dataset.t;
    paint();
    // The parts follow the sign of the transaction: flipping Expense/Income flips them all.
    if (splits && before !== type) { splits = splits.map((x) => ({ ...x, amountMinor: -x.amountMinor })); paintSplit(); }
    if (splits) return;
    // Keep category and type consistent: Salary on an expense (or Food on income) is almost always a slip.
    const id = Number(category.value);
    if (id && kindOf.get(id) !== (type === 'income')) {
      const first = groups.filter((g) => g.isIncome === (type === 'income')).flatMap((g) => g.categories).find((c) => !c.hidden);
      category.value = first ? String(first.id) : '';
    }
  });

  // A payee with a default category pre-fills it, but only while the category is still Uncategorized.
  payee.addEventListener('change', () => {
    if (initial || category.value) return;
    const hit = byName.get(payee.value.trim().toLowerCase());
    if (hit && hit.defaultCategoryId && kindOf.has(hit.defaultCategoryId)) {
      category.value = String(hit.defaultCategoryId);
      category.dispatchEvent(new Event('change'));
    }
  });

  category.addEventListener('change', () => {
    const id = Number(category.value);
    if (!id) return;
    const wantsIncome = kindOf.get(id);
    if (wantsIncome !== (type === 'income')) { type = wantsIncome ? 'income' : 'expense'; paint(); }
  });

  // Accounts: open ones, plus the transaction's own account if it was closed since.
  for (const a of accounts) {
    if (!a.closed || (initial && initial.accountId === a.id)) account.append(option(a.id, a.name + (a.closed ? ' (closed)' : '')));
  }

  fillCategories(initial ? initial.categoryId : null);
  if (initial) {
    payee.value = initial.payee;
    amount.value = toInput(Math.abs(initial.amountMinor));
    date.value = initial.date;
    notes.value = initial.notes;
    cleared.checked = initial.cleared;
    account.value = String(initial.accountId);
  } else {
    date.value = todayLocal();
    if (accountId && [...account.options].some((o) => o.value === String(accountId))) account.value = String(accountId);
  }
  paint();

  /* ----- splitting ----- */
  const splitNote = el('div', { className: 'split-note full', attrs: { role: 'status' } });
  const splitBtn = el('button', { type: 'button', className: 'small-btn' });
  const unsplitBtn = el('button', { type: 'button', className: 'small-btn', textContent: 'Unsplit' });
  const splitActions = el('div', { className: 'split-actions full' }, splitBtn, unsplitBtn);
  const catName = (id) => {
    for (const g of groups) for (const c of g.categories) if (c.id === id) return `${c.icon} ${c.name}`;
    return 'Uncategorized';
  };
  const signedAmount = () => {
    const m = parseMoney(amount.value);
    return m === null || m === 0 ? null : (type === 'income' ? m : -m);
  };
  function paintSplit() {
    const on = !!splits;
    category.disabled = on;
    splitBtn.textContent = on ? '✂ Edit split…' : '✂ Split across categories…';
    unsplitBtn.hidden = !on;
    splitNote.hidden = !on;
    if (!on) return;
    const total = signedAmount();
    const sum = splits.reduce((n, x) => n + x.amountMinor, 0);
    const mismatch = total !== null && sum !== total;
    splitNote.classList.toggle('warn', mismatch);
    splitNote.textContent = `✂ Split into ${splits.length} parts: ${splits.map((x) => `${catName(x.categoryId)} ${money.fmt(x.amountMinor)}`).join(' · ')}`
      + (mismatch ? ` ⚠ The parts add up to ${money.fmt(sum)} but the amount is ${money.fmt(total)}. Choose "Edit split…" to fix it.` : '');
  }
  splitBtn.onclick = () => {
    const total = signedAmount();
    if (total === null) {
      splitNote.hidden = false; splitNote.classList.add('warn');
      splitNote.textContent = 'Type the amount first, then split it.';
      return;
    }
    openSplitEditor({
      groups, totalMinor: total, splits, money,
      categoryId: category.value ? Number(category.value) : null,
      onSave: (list) => { splits = list; paintSplit(); },
    });
  };
  unsplitBtn.onclick = () => { splits = null; paintSplit(); category.focus(); };
  amount.addEventListener('input', () => { if (splits) paintSplit(); });

  const node = el('div', { className: 'fields' },
    toggle,
    field('Payee', payee, { full: true }), datalist,
    field('Amount', amount),
    field('Date', date),
    field('Category', category, { full: true }),
    splitActions, splitNote,
    field('Account', account, { full: true }),
    field('Notes', notes, { full: true }));

  node.append(el('label', { className: 'check full' }, cleared, ' Cleared (matches my bank)'));
  if (locked) {
    for (const x of [amount, date, account, cleared]) x.disabled = true;
    node.append(el('div', { className: 'lock-note full', textContent: '🔒 Reconciled: its amount, date, account and cleared status are locked. Category, payee, notes and splits can still be changed. To change the rest, undo the reconciliation first.' }));
  }
  paintSplit();

  return {
    node,
    /** Returns the API payload, or throws an Error with a message fit to show the user. */
    read() {
      const minor = parseMoney(amount.value);
      if (minor === null) throw new Error('Enter an amount like 450 or 450.50.');
      if (minor === 0) throw new Error('Enter an amount greater than 0.');
      if (!date.value) throw new Error('Please pick a date.');
      if (!account.value) throw new Error('Please pick an account.');
      const signed = type === 'income' ? minor : -minor;
      const payload = {
        accountId: Number(account.value),
        date: date.value,
        amountMinor: signed,
        payee: payee.value.trim(),
        categoryId: splits ? null : (category.value ? Number(category.value) : null),
        notes: notes.value.trim(),
        cleared: cleared.checked,
      };
      if (splits) {
        const sum = splits.reduce((n, x) => n + x.amountMinor, 0);
        if (sum !== signed) throw new Error(`The split parts add up to ${money.fmt(sum)} but the amount is ${money.fmt(signed)}. Choose "Edit split…" to fix it.`);
        payload.splits = splits;
      } else if (initial && initial.isSplit) {
        payload.splits = null;          // the person pressed Unsplit: the single category above applies
      }
      return payload;
    },
    /** After a successful add: clear the typing fields but keep date/account/category for quick entry. */
    afterAdd() {
      payee.value = ''; amount.value = ''; notes.value = ''; cleared.checked = false;
      splits = null; paintSplit();
      payee.focus();
    },
    setCategories(g) { groups = g; fillCategories(null); },
  };
}
