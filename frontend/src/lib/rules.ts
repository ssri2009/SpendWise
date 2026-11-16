import type { RuleAction, RuleCondition } from '../types/rules';
import { formatMoney, type MoneyFormat } from './format';

/* ---------------------------------------------------------------------
   Plain-language rule text, plus a client copy of the server's matching
   (server/rules.js conditionMatches / applyAction) used ONLY by the
   "try it" box in the rule editor. The server stays the source of truth.
   --------------------------------------------------------------------- */

export interface Names {
  payee: (id: number) => string | undefined;
  category: (id: number) => string | undefined;
  account: (id: number) => string | undefined;
}

const missing = 'a deleted';
const dir = (d: string) => (d === 'expense' ? ' (spending)' : d === 'income' ? ' (income)' : '');

export function describeCondition(c: RuleCondition, n: Names, fmt: MoneyFormat): string {
  switch (c.type) {
    case 'description_contains':
      return `payee or notes contain "${c.value}"`;
    case 'payee_equals':
      return `payee is ${n.payee(c.payeeId) ?? `${missing} payee`}`;
    case 'amount_gt':
      return `amount is over ${formatMoney(c.valueMinor, fmt)}${dir(c.direction)}`;
    case 'amount_lt':
      return `amount is under ${formatMoney(c.valueMinor, fmt)}${dir(c.direction)}`;
    case 'account_equals':
      return `account is ${n.account(c.accountId) ?? `${missing} account`}`;
  }
}

export function describeAction(a: RuleAction, n: Names): string {
  switch (a.type) {
    case 'set_category':
      return `category → ${n.category(a.categoryId) ?? `${missing} category`}`;
    case 'set_payee':
      return `payee → ${n.payee(a.payeeId) ?? `${missing} payee`}`;
    case 'add_note':
      return `add note "${a.text}"`;
    case 'mark_cleared':
      return 'mark cleared';
  }
}

export interface Draft {
  accountId: number | null;
  amountMinor: number;
  payee: string;
  notes: string;
  categoryId: number | null;
  cleared: boolean;
}

export function conditionMatches(c: RuleCondition, d: Draft, n: Names): boolean {
  switch (c.type) {
    case 'description_contains':
      return `${d.payee}\n${d.notes}`.toLowerCase().includes(c.value.toLowerCase());
    case 'payee_equals': {
      const name = n.payee(c.payeeId);
      return name !== undefined && d.payee !== '' && d.payee.toLowerCase() === name.toLowerCase();
    }
    case 'amount_gt':
    case 'amount_lt': {
      if (c.direction === 'expense' && d.amountMinor >= 0) return false;
      if (c.direction === 'income' && d.amountMinor <= 0) return false;
      const abs = Math.abs(d.amountMinor);
      return c.type === 'amount_gt' ? abs > c.valueMinor : abs < c.valueMinor;
    }
    case 'account_equals':
      return d.accountId === c.accountId;
  }
}

/** One rule on its own: does it match, and what would the transaction look like after it. */
export function tryRule(rule: { matchMode: 'all' | 'any'; conditions: RuleCondition[]; actions: RuleAction[] }, draft: Draft, n: Names) {
  const results = rule.conditions.map((c) => conditionMatches(c, draft, n));
  const hit = rule.matchMode === 'any' ? results.some(Boolean) : results.length > 0 && results.every(Boolean);
  const d = { ...draft };
  if (hit) {
    for (const a of rule.actions) {
      if (a.type === 'set_category' && n.category(a.categoryId) !== undefined) d.categoryId = a.categoryId;
      else if (a.type === 'set_payee') {
        const name = n.payee(a.payeeId);
        if (name !== undefined) d.payee = name;
      } else if (a.type === 'add_note' && !d.notes.includes(a.text)) {
        const next = d.notes ? `${d.notes} ${a.text}` : a.text;
        if (next.length <= 200) d.notes = next;
      } else if (a.type === 'mark_cleared') d.cleared = true;
    }
  }
  return { hit, results, after: d };
}
