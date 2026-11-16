/* ---------------------------------------------------------------------
   Rules (server/rules.js, server/routes/rules.js).
   A rule is "if <conditions> then <actions>". Enabled rules run top to
   bottom on every NEW or IMPORTED transaction; every matching rule runs,
   the last one to set a single value wins, notes add up, and "stop after"
   ends processing. Existing transactions change only through re-apply.
   --------------------------------------------------------------------- */

export type AmountDirection = 'any' | 'expense' | 'income';

export type RuleCondition =
  | { type: 'description_contains'; value: string }
  | { type: 'payee_equals'; payeeId: number }
  | { type: 'amount_gt' | 'amount_lt'; valueMinor: number; direction: AmountDirection }
  | { type: 'account_equals'; accountId: number };

export type RuleAction =
  | { type: 'set_category'; categoryId: number }
  | { type: 'set_payee'; payeeId: number }
  | { type: 'add_note'; text: string }
  | { type: 'mark_cleared' };

export interface Rule {
  id: number;
  name: string;
  enabled: boolean;
  matchMode: 'all' | 'any';
  stopAfter: boolean;
  /** 1 = runs first. */
  position: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** Things it points at that were deleted. */
  problems: string[];
}

export interface RulesResponse {
  rules: Rule[];
  maxRules: number;
}

export interface RuleInput {
  name: string;
  enabled: boolean;
  matchMode: 'all' | 'any';
  stopAfter: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

export interface ReprocessOptions {
  dryRun: boolean;
  month?: string | 'all';
  accountId?: number | null;
  onlyUncategorized?: boolean;
  /** Only these rules (even disabled ones). Omit for all enabled rules. */
  ruleIds?: number[] | null;
}

export interface ReprocessSide {
  payee: string;
  category: string;
  notes: string;
  cleared: boolean;
}

export interface ReprocessResult {
  dryRun: boolean;
  scanned: number;
  changed: number;
  truncated: boolean;
  /** First 50 changes. */
  samples: { id: number; rules: string[]; before: ReprocessSide; after: ReprocessSide }[];
  note?: string;
}

export const MAX_CONDITIONS = 10;
export const MAX_ACTIONS = 10;
