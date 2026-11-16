/* Financial Health Score: 0–100, worked out in the browser from four real API reports.
   A factor without enough data is left out and the remaining weights are rescaled. */

import type { AccountsResponse, BudgetMonth, CashflowReport, NetWorthReport } from '../types/api';

export type HealthFactorId = 'savings' | 'cushion' | 'budget' | 'networth';
export type HealthGrade = 'excellent' | 'good' | 'fair' | 'attention';

export interface HealthFactor {
  id: HealthFactorId;
  label: string;
  weight: number;
  /** 0..1, or null when there isn't enough data to judge. */
  score: number | null;
  value: string;
  hint: string;
}

export interface HealthScore {
  score: number | null;
  grade: HealthGrade | null;
  factors: HealthFactor[];
}

export interface HealthInputs {
  cashflow?: CashflowReport;
  accounts?: AccountsResponse;
  budget?: BudgetMonth;
  netWorth?: NetWorthReport;
  /** YYYY-MM: months before this one count as "complete". */
  currentMonth: string;
  money: (minor: number, signed?: boolean) => string;
}

export const GRADE_LABEL: Record<HealthGrade, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  attention: 'Needs attention',
};

const TARGET_SAVINGS_RATE = 0.2;
const TARGET_CUSHION_MONTHS = 6;
const RECENT_MONTHS = 3;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function gradeFor(score: number): HealthGrade {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'attention';
}

export function computeHealthScore(input: HealthInputs): HealthScore {
  const { cashflow, accounts, budget, netWorth, currentMonth, money } = input;

  // The last few complete months that had any activity.
  const recent = (cashflow?.periods ?? [])
    .filter((p) => p.key < currentMonth)
    .slice(-RECENT_MONTHS)
    .filter((p) => p.incomeMinor !== 0 || p.expensesMinor !== 0);
  const income = recent.reduce((n, p) => n + p.incomeMinor, 0);
  const expenses = recent.reduce((n, p) => n + p.expensesMinor, 0);
  const span = plural(recent.length, 'full month');

  /* 1. Savings rate: share of income kept over recent full months. Target 20%. */
  const savings: HealthFactor = (() => {
    const base = { id: 'savings', label: 'Savings rate', weight: 30 } as const;
    if (!cashflow) return { ...base, score: null, value: 'Unavailable', hint: 'The cash flow report could not be loaded.' };
    if (income <= 0) return { ...base, score: null, value: 'Not enough data', hint: 'Record income for at least one full month.' };
    const rate = (income - expenses) / income;
    const pct = Math.round(rate * 1000) / 10;
    const hint =
      rate < 0
        ? `Spending was ${money(expenses - income)} more than income over the last ${span}.`
        : rate >= TARGET_SAVINGS_RATE
          ? `At or above the 20% target over the last ${span}.`
          : `Below the 20% target over the last ${span}.`;
    return { ...base, score: clamp01(rate / TARGET_SAVINGS_RATE), value: `${pct}% kept`, hint };
  })();

  /* 2. Cushion: how many months of average spending Total Funds would cover. Target 6. */
  const cushion: HealthFactor = (() => {
    const base = { id: 'cushion', label: 'Emergency cushion', weight: 25 } as const;
    if (!accounts || !cashflow) return { ...base, score: null, value: 'Unavailable', hint: 'Balances or cash flow could not be loaded.' };
    const avgSpend = recent.length ? expenses / recent.length : 0;
    if (avgSpend <= 0) return { ...base, score: null, value: 'Not enough data', hint: 'Record spending for at least one full month.' };
    const months = Math.max(0, accounts.totalFundsMinor) / avgSpend;
    return {
      ...base,
      score: clamp01(months / TARGET_CUSHION_MONTHS),
      value: `${months.toFixed(1)} months`,
      hint: `Total funds cover about ${months.toFixed(1)} months of average spending (${money(Math.round(avgSpend))}/month). Target: 6.`,
    };
  })();

  /* 3. Budget discipline: overspent envelopes and over-assignment this month. */
  const budgetFactor: HealthFactor = (() => {
    const base = { id: 'budget', label: 'Budget discipline', weight: 25 } as const;
    if (!budget) return { ...base, score: null, value: 'Unavailable', hint: 'The budget could not be loaded.' };
    const pool = budget.availableMinor - budget.activityMinor; // carry-in + assigned
    if (pool <= 0 && budget.overspentCount === 0 && budget.toBudgetMinor >= 0) {
      return { ...base, score: null, value: 'No budget yet', hint: 'Assign money to categories on the Budget page.' };
    }
    let score = 1 - 0.15 * budget.overspentCount - (pool > 0 ? budget.overspentMinor / pool : 1);
    if (budget.toBudgetMinor < 0) score = Math.min(score, 0.4);
    const value = budget.overspentCount
      ? `${plural(budget.overspentCount, 'envelope')} over`
      : budget.toBudgetMinor < 0
        ? 'Over-assigned'
        : 'On track';
    const hint = budget.overspentCount
      ? `${money(budget.overspentMinor)} overspent across ${plural(budget.overspentCount, 'envelope')} this month.`
      : budget.toBudgetMinor < 0
        ? `You have assigned ${money(-budget.toBudgetMinor)} more than you have.`
        : 'No envelope is overspent this month.';
    return { ...base, score: clamp01(score), value, hint };
  })();

  /* 4. Net worth trend over the last six months. */
  const trend: HealthFactor = (() => {
    const base = { id: 'networth', label: 'Net worth trend', weight: 20 } as const;
    if (!netWorth) return { ...base, score: null, value: 'Unavailable', hint: 'The net worth report could not be loaded.' };
    if (netWorth.series.length < 2 || netWorth.series.every((p) => p.netWorthMinor === 0)) {
      return { ...base, score: null, value: 'Not enough data', hint: 'Add accounts and transactions to track net worth.' };
    }
    const { overRangeMinor, overRangePct, from } = netWorth.change;
    const score =
      netWorth.trend === 'up' ? 1 : netWorth.trend === 'flat' ? 0.65 : overRangePct === null ? 0.3 : Math.min(0.5, clamp01(0.5 + overRangePct / 40));
    const word = netWorth.trend === 'up' ? 'Up' : netWorth.trend === 'down' ? 'Down' : 'About the same';
    return {
      ...base,
      score,
      value: money(overRangeMinor, true),
      hint: `${word} since the end of ${from}${overRangePct !== null && netWorth.trend !== 'flat' ? ` (${overRangePct > 0 ? '+' : ''}${overRangePct}%)` : ''}.`,
    };
  })();

  const factors = [savings, cushion, budgetFactor, trend];
  const scored = factors.filter((f): f is HealthFactor & { score: number } => f.score !== null);
  if (!scored.length) return { score: null, grade: null, factors };

  const weight = scored.reduce((n, f) => n + f.weight, 0);
  const score = Math.round((scored.reduce((n, f) => n + f.weight * f.score, 0) / weight) * 100);
  return { score, grade: gradeFor(score), factors };
}
