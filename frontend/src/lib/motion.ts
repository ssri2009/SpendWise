import type { Variants } from 'framer-motion';

/**
 * Shared motion settings, so every screen moves the same way.
 * Reduced motion is handled globally: <MotionConfig reducedMotion="user"> (main.tsx) drops
 * transforms for framer-motion, Recharts' "auto" animation turns itself off, and the CSS
 * layer stops its keyframes (index.css).
 */

/** Calm, decelerating curve used across the app (ease-out-quint-ish). */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Route change: the old screen fades out quickly, the new one settles in from just below. */
export const PAGE_TRANSITION: Variants = {
  enter: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } },
  leave: { opacity: 0, y: -4, transition: { duration: 0.14, ease: 'easeIn' } },
};

/**
 * Recharts entry animation. Bars grow from the baseline and lines draw left to right over
 * the same time and curve on every chart. `isAnimationActive: 'auto'` is Recharts' own
 * reduced-motion check, so it is spelled out here rather than forced on.
 */
export const CHART_MOTION = {
  isAnimationActive: 'auto',
  animationBegin: 80,
  animationDuration: 750,
  animationEasing: 'ease-out',
} as const;

/** Lines start slightly after bars, so a combined chart reads bars first, then the trend. */
export const CHART_MOTION_LINE = { ...CHART_MOTION, animationBegin: 260, animationDuration: 900 } as const;
