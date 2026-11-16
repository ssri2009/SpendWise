import { animate, motion, useReducedMotion, type Variants } from 'framer-motion';
import { AlertCircle, ArrowDownRight, ArrowUpRight, Minus, RotateCw, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};

export const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
};

/** Glass card with a titled header. */
export function Panel({
  title,
  icon: Icon,
  action,
  children,
  className = '',
}: {
  title: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <motion.section
      variants={rise}
      aria-labelledby={headingId}
      className={`glass flex min-w-0 flex-col rounded-3xl border border-line p-5 shadow-glass sm:p-6 ${className}`}
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="flex items-center gap-2.5 text-base font-semibold">
          {Icon && (
            <span className="grid size-8 place-items-center rounded-xl bg-accent/12 text-accent">
              <Icon className="size-4" aria-hidden />
            </span>
          )}
          {title}
        </h2>
        {action}
      </header>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </motion.section>
  );
}

/** Placeholder block with a soft light sweep (static under reduced motion). Size it with `className`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`sw-skeleton rounded-lg ${className}`} aria-hidden />;
}

export function ErrorState({ error, onRetry, compact = false }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const message = error instanceof Error && error.message ? error.message : 'Something went wrong.';
  return (
    <div role="alert" className={`flex flex-col items-center justify-center gap-2.5 text-center ${compact ? 'py-1' : 'flex-1 py-10'}`}>
      <span className="flex items-center gap-1.5 text-sm text-expense">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        <span className={compact ? 'line-clamp-1' : ''}>{compact ? 'Could not load' : message}</span>
      </span>
      {!compact && <span className="sr-only">{message}</span>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          title={message}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:bg-subtle"
        >
          <RotateCw className="size-3.5" aria-hidden />
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-subtle text-muted">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-xs text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Up/down chip. `goodWhen` decides whether a rise is green or red. */
export function Delta({
  value,
  display,
  goodWhen = 'up',
  label,
}: {
  value: number | null;
  display: string;
  goodWhen?: 'up' | 'down';
  label?: string;
}) {
  if (value === null) {
    return <span className="inline-flex items-center rounded-full bg-subtle px-2 py-0.5 text-xs font-semibold text-muted">—</span>;
  }
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const good = dir === 'flat' ? null : dir === goodWhen;
  const tone = good === null ? 'bg-subtle text-muted' : good ? 'bg-income/12 text-income' : 'bg-expense/12 text-expense';
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`} title={label}>
      <Icon className="size-3.5" aria-hidden />
      {display}
      {label && <span className="sr-only"> {label}</span>}
    </span>
  );
}

/** Counts up to `value` (paise or any integer); screen readers get the final value only. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const current = useRef(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      current.current = value;
      setShown(value);
      return;
    }
    const controls = animate(current.current, value, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        current.current = v;
        setShown(v);
      },
    });
    return () => controls.stop();
  }, [value, reduce]);

  // While moving, snap to whole rupees when the target is whole, so decimals don't flicker.
  const step = value % 100 === 0 ? 100 : 1;
  const display = shown === value ? value : Math.round(shown / step) * step;

  return (
    <>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden className="tabular-nums">
        {format(display)}
      </span>
    </>
  );
}

/** Two- or three-way pill switch. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  layoutId,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  layoutId: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl bg-subtle p-1">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            className={`relative rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-lg bg-elevated shadow-sm ring-1 ring-line"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Makes an id safe for SVG url(#id) references. */
export const svgId = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '');
