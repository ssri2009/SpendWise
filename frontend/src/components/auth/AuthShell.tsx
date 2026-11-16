import { motion } from 'framer-motion';
import { LineChart, ShieldCheck, Wallet } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Backdrop } from '../ambient/Backdrop';
import { ThemeToggle } from '../../theme/ThemeControls';

export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden
        className={`grid place-items-center rounded-xl accent-gradient font-bold text-accent-fg shadow-lg shadow-accent/30 ${
          size === 'lg' ? 'size-12 text-2xl' : 'size-10 text-lg'
        }`}
      >
        ₹
      </span>
      <span className={`font-extrabold tracking-tight ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>
        Spend<span className="gradient-text">Wise</span>
      </span>
    </span>
  );
}

const HIGHLIGHTS = [
  { icon: Wallet, title: 'Envelope budgets', text: 'Give every rupee a job, month by month.' },
  { icon: LineChart, title: 'Reports that add up', text: 'Computed from your transactions, never stored twice.' },
  { icon: ShieldCheck, title: 'Private to you', text: 'Your books are only visible to your account.' },
] as const;

/**
 * Full-screen frame for the sign-in and sign-up screens: animated backdrop,
 * a short product panel on wide screens, and the glass form card.
 */
export function AuthShell({
  title,
  subtitle,
  documentTitle,
  children,
  footer,
}: {
  title: string;
  subtitle: ReactNode;
  documentTitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    document.title = `${documentTitle} · SpendWise`;
  }, [documentTitle]);

  return (
    <div className="relative min-h-dvh text-fg">
      <Backdrop />

      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-10">
        <motion.section
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="hidden lg:block"
          aria-hidden
        >
          <BrandMark size="lg" />
          <h2 className="mt-10 text-5xl font-extrabold leading-[1.05] tracking-tight">
            Take control of
            <br />
            your <span className="gradient-text">money flow</span>
          </h2>
          <p className="mt-4 max-w-md text-lg text-muted">
            Budgets, transactions, bills and reports, all in one place.
          </p>
          <ul className="mt-10 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, title: t, text }) => (
              <li key={t} className="glass flex max-w-md items-start gap-4 rounded-2xl border border-line p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-subtle text-accent">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{t}</span>
                  <span className="block text-sm text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </motion.section>

        <motion.main
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="glass mx-auto w-full max-w-md rounded-3xl border border-line p-6 shadow-glass sm:p-8"
        >
          <div className="lg:hidden">
            <BrandMark />
          </div>
          <h1 className="mt-6 text-2xl font-bold tracking-tight lg:mt-0">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">{footer}</div>}
        </motion.main>
      </div>
    </div>
  );
}
