import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  Info,
  Loader2,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import type { PasswordCheck } from '../../auth/validation';

/* ---------------------------------------------------------------------
   Text field
   --------------------------------------------------------------------- */

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'>;

interface TextFieldProps extends InputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  icon: LucideIcon;
  error?: ReactNode;
  hint?: ReactNode;
  type?: 'text' | 'email' | 'password';
  /** Extra content under the input (e.g. the password checklist). */
  below?: ReactNode;
}

const INPUT_BASE =
  'h-12 w-full rounded-xl border bg-surface pl-11 text-sm text-fg outline-none transition-[border-color,box-shadow] placeholder:text-muted/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, value, onChange, icon: Icon, error, hint, type = 'text', below, className, ...rest },
  ref,
) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <Icon
          aria-hidden
          className={`pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 ${error ? 'text-expense' : 'text-muted'}`}
        />
        <input
          ref={ref}
          id={id}
          type={isPassword && reveal ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`${INPUT_BASE} ${isPassword ? 'pr-12' : 'pr-4'} ${
            error
              ? 'border-expense/70 focus:border-expense focus:ring-4 focus:ring-expense/15'
              : 'border-line hover:border-accent/40 focus:border-accent focus:ring-4 focus:ring-accent/15'
          }`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
            disabled={rest.disabled}
            className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg disabled:opacity-50"
          >
            {reveal ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key="error"
            id={`${id}-error`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden pt-1.5 text-xs font-medium text-expense"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      {hint && !error && (
        <p id={`${id}-hint`} className="pt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
      {below}
    </div>
  );
});

/* ---------------------------------------------------------------------
   Password checklist (mirrors server/security.js)
   --------------------------------------------------------------------- */

export function PasswordChecklist({ checks, show }: { checks: PasswordCheck[]; show: boolean }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.ul
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2 space-y-1 overflow-hidden"
          aria-label="Password requirements"
        >
          {checks.map((c) => (
            <li key={c.id} className={`flex items-center gap-2 text-xs ${c.ok ? 'text-income' : 'text-muted'}`}>
              {c.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
              <span>
                {c.label}
                <span className="sr-only">{c.ok ? ' (met)' : ' (not met yet)'}</span>
              </span>
            </li>
          ))}
        </motion.ul>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------------
   Alerts
   --------------------------------------------------------------------- */

export type AlertTone = 'error' | 'warning' | 'info' | 'success' | 'offline';

const TONES: Record<AlertTone, { icon: LucideIcon; box: string; role: 'alert' | 'status' }> = {
  error: { icon: AlertCircle, box: 'border-expense/30 bg-expense/10 text-expense', role: 'alert' },
  offline: { icon: WifiOff, box: 'border-warning/30 bg-warning/10 text-warning', role: 'alert' },
  warning: { icon: AlertCircle, box: 'border-warning/30 bg-warning/10 text-warning', role: 'alert' },
  info: { icon: Info, box: 'border-accent/30 bg-accent/10 text-fg', role: 'status' },
  success: { icon: CheckCircle2, box: 'border-income/30 bg-income/10 text-income', role: 'status' },
};

export function FormAlert({ tone, children }: { tone: AlertTone; children: ReactNode }) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <motion.div
      role={t.role}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2 }}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${t.box}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------------
   Submit button with loading state
   --------------------------------------------------------------------- */

export function SubmitButton({
  pending,
  pendingLabel,
  disabled,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className="group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl accent-gradient px-4 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/30 transition-[transform,box-shadow,opacity] hover:-translate-y-0.5 hover:shadow-xl hover:shadow-accent/40 active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
    >
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {pendingLabel}
        </>
      ) : (
        <>
          {children}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </>
      )}
    </button>
  );
}

/** "m:ss" for rate-limit countdowns. */
export function formatWait(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}
