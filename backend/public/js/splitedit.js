// The "split this transaction" dialog. Used by the Add form, the Edit dialog and the list's "Edit split…" button.
//
// You type each part as a normal positive amount (a discount or refund inside the split can be typed with a minus).
// The dialog keeps a running "left to assign" line and only lets you save when the parts add up to the transaction, to the paisa.
import { el, option, openModal } from '/js/ui.js';
import { parseMoney, toInput } from '/js/money.js';

/**
 * totalMinor : the transaction's SIGNED amount in paise (expense = negative)
 * splits     : existing parts [{categoryId, amountMinor (signed), notes}] or null for a first split
 * categoryId : when splitting a normal transaction, its current category (becomes the first part)
 * onSave(list): called with [{categoryId|null, amountMinor (signed), notes}] ; may throw to keep the dialog open
 */
export function openSplitEditor({ groups, totalMinor, splits = null, categoryId = null, money, title = 'Split transaction', onSave }) {
  const dir = totalMinor < 0 ? -1 : 1;
  const target = Math.abs(totalMinor);          // the parts, typed as positive amounts, must add up to this
  const rows = [];
  const list = el('div', { className: 'split-rows' });
  const sum = el('div', { className: 'split-sum', attrs: { role: 'status', 'aria-live': 'polite' } });

  function categorySelect(selectedId) {
    const sel = el('select', { attrs: { 'aria-label': 'Category' } });
    sel.append(option('', 'Uncategorized', selectedId == null));
    for (const g of groups) {
      const cats = g.categories.filter((c) => !c.hidden || c.id === selectedId);
      if (!cats.length) continue;
      const og = el('optgroup', { label: g.name });
      for (const c of cats) og.append(option(c.id, `${c.icon} ${c.name}`, c.id === selectedId));
      sel.append(og);
    }
    return sel;
  }

  const relOf = (row) => {                       // null = blank, NaN-like = invalid
    const t = row.amt.value.trim();
    if (t === '') return 0;
    return parseMoney(t, { allowNegative: true });
  };

  function paint() {
    let total = 0, invalid = false;
    for (const r of rows) {
      const m = relOf(r);
      if (m === null) invalid = true; else total += m;
      r.remove.disabled = rows.length <= 2;
    }
    const left = target - total;
    sum.className = 'split-sum ' + (!invalid && left === 0 ? 'ok' : 'bad');
    sum.textContent = '';
    sum.append(
      el('span', { textContent: `Transaction ${money.fmt(target)}` }),
      el('span', { textContent: `Assigned ${money.fmt(total)}` }),
      invalid ? el('span', { className: 'left', textContent: 'Check the amounts typed in red boxes' })
        : left === 0 ? el('span', { textContent: '✓ Fully split' })
          : el('span', { className: 'left', textContent: left > 0 ? `Left to assign ${money.fmt(left)}` : `Over by ${money.fmt(-left)}` }));
    for (const r of rows) r.amt.style.borderColor = relOf(r) === null ? 'var(--expense)' : '';
  }

  function addRow(init, { auto = false } = {}) {
    const row = { touched: !auto };
    row.cat = categorySelect(init.categoryId);
    row.amt = el('input', { type: 'text', inputMode: 'decimal', placeholder: '0.00', autocomplete: 'off', value: init.rel ? toInput(init.rel) : '', attrs: { 'aria-label': 'Amount' } });
    row.notes = el('input', { type: 'text', maxLength: 200, placeholder: 'Note (optional)', autocomplete: 'off', value: init.notes || '', attrs: { 'aria-label': 'Note' } });
    row.fill = el('button', { type: 'button', className: 'mini-btn', textContent: '⇥ Rest', title: 'Put whatever is left into this part' });
    row.remove = el('button', { type: 'button', className: 'mini-btn', textContent: '✕', title: 'Remove this part', attrs: { 'aria-label': 'Remove this part' } });
    row.node = el('div', { className: 'split-row' }, row.cat, row.amt, row.notes, row.fill, row.remove);

    row.amt.addEventListener('input', () => {
      row.touched = true;
      // Two parts and the other one untouched: it simply takes the rest (the usual "2000 + whatever is left").
      if (rows.length === 2) {
        const other = rows.find((x) => x !== row);
        const mine = relOf(row);
        if (other && !other.touched && mine !== null) {
          const rest = target - mine;
          other.amt.value = rest > 0 ? toInput(rest) : '';
        }
      }
      paint();
    });
    row.fill.onclick = () => {
      let others = 0;
      for (const r of rows) if (r !== row) others += relOf(r) || 0;
      const rest = target - others;
      row.amt.value = rest > 0 ? toInput(rest) : '';
      row.touched = true;
      paint();
    };
    row.remove.onclick = () => {
      if (rows.length <= 2) return;
      rows.splice(rows.indexOf(row), 1);
      row.node.remove();
      paint();
    };
    rows.push(row);
    list.append(row.node);
    return row;
  }

  if (splits && splits.length) {
    for (const s of splits) addRow({ categoryId: s.categoryId, rel: s.amountMinor * dir, notes: s.notes });
  } else {
    addRow({ categoryId, rel: target });
    addRow({ categoryId: null, rel: 0 }, { auto: true });
  }

  const add = el('button', { type: 'button', className: 'small-btn', textContent: '➕ Add another part' });
  add.onclick = () => {
    if (rows.length >= 30) return;
    const r = addRow({ categoryId: null, rel: 0 });
    paint();
    r.amt.focus();
  };

  const content = el('div', {},
    el('p', { className: 'modal-text', textContent: 'Share this transaction across categories. The parts must add up to the full amount.' }),
    list, el('div', { className: 'split-foot' }, add), el('div', { style: 'height:10px' }), sum);

  const dlg = openModal({
    title,
    content,
    buttons: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save split', kind: 'primary',
        onClick: async () => {
          let total = 0;
          const out = rows.map((r, i) => {
            const m = relOf(r);
            if (m === null || r.amt.value.trim() === '') throw new Error(`Part ${i + 1}: enter an amount like 450 or 450.50.`);
            if (m === 0) throw new Error(`Part ${i + 1}: an amount can't be zero. Remove the part instead.`);
            total += m;
            return { categoryId: r.cat.value ? Number(r.cat.value) : null, amountMinor: m * dir, notes: r.notes.value.trim() };
          });
          if (total !== target) {
            const d = target - total;
            throw new Error(d > 0 ? `${money.fmt(d)} is still left to assign.` : `The parts are over by ${money.fmt(-d)}.`);
          }
          await onSave(out);
        },
      },
    ],
  });
  dlg.dialog.classList.add('wide');
  paint();
  rows[0].amt.focus();
  rows[0].amt.select();
  return dlg;
}

