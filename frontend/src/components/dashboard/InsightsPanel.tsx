import { motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, CheckCircle2, Lightbulb, Sparkles, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useInsights } from '../../hooks/useDashboard';
import type { InsightLevel } from '../../types/api';
import { EmptyState, ErrorState, Panel, Skeleton } from './ui';

const LEVEL: Record<InsightLevel, { icon: LucideIcon; tone: string; label: string }> = {
  warn: { icon: AlertTriangle, tone: 'bg-expense/12 text-expense', label: 'Warning' },
  good: { icon: CheckCircle2, tone: 'bg-income/12 text-income', label: 'Good news' },
  info: { icon: Lightbulb, tone: 'bg-accent/12 text-accent', label: 'Note' },
};

/** Backend links point at the old multi-page app (e.g. /reports#spending); keep the path and query. */
function toRoute(link: string): string {
  return link.split('#')[0] || '/';
}

export function InsightsPanel({ className = '' }: { className?: string }) {
  const query = useInsights();
  const items = query.data?.insights ?? [];
  const warnings = items.filter((i) => i.level === 'warn').length;

  return (
    <Panel
      title="Insights"
      icon={Sparkles}
      className={className}
      action={
        warnings > 0 ? (
          <span className="rounded-full bg-expense/12 px-2.5 py-0.5 text-xs font-semibold text-expense">
            {warnings} to look at
          </span>
        ) : undefined
      }
    >
      {query.isPending ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={Sparkles} title="Nothing to flag">
          Your spending looks steady. New findings appear here as your data changes.
        </EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {items.map((insight, i) => {
            const level = LEVEL[insight.level] ?? LEVEL.info;
            const Icon = level.icon;
            const body = (
              <>
                <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${level.tone}`}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{level.label}: </span>
                  <span className="block text-sm font-semibold leading-snug">{insight.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{insight.detail}</span>
                </span>
                {insight.link && (
                  <ArrowRight
                    className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-fg"
                    aria-hidden
                  />
                )}
              </>
            );
            return (
              <motion.li
                key={insight.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05, duration: 0.3 }}
              >
                {insight.link ? (
                  <Link
                    to={toRoute(insight.link)}
                    className="group flex gap-3 rounded-2xl border border-transparent p-3 transition-colors hover:border-line hover:bg-subtle"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="flex gap-3 rounded-2xl p-3">{body}</div>
                )}
              </motion.li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
