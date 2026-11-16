import type { UseQueryResult } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState, ErrorState, Skeleton } from '../dashboard/ui';

/** Loading / error / empty wrapper. While new filters load, the last result stays (dimmed). */
export function ReportState<T>({
  query,
  isEmpty,
  emptyTitle,
  emptyText = 'Try a longer period, another account, or more categories.',
  children,
}: {
  query: UseQueryResult<T>;
  isEmpty: (d: T) => boolean;
  emptyTitle: string;
  emptyText?: string;
  children: ReactNode;
}) {
  if (query.isPending) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading report">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-3xl" />
        <div className="grid gap-5 xl:grid-cols-2">
          <Skeleton className="h-72 rounded-3xl" />
          <Skeleton className="h-72 rounded-3xl" />
        </div>
      </div>
    );
  }
  if (query.isError && !query.data) {
    return (
      <div className="glass rounded-3xl border border-line p-6 shadow-glass">
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      </div>
    );
  }
  if (query.data && isEmpty(query.data)) {
    return (
      <div className="glass rounded-3xl border border-line p-6 shadow-glass">
        <EmptyState icon={BarChart3} title={emptyTitle}>
          {emptyText}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className={`transition-opacity ${query.isPlaceholderData ? 'pointer-events-none opacity-60' : ''}`} aria-busy={query.isFetching || undefined}>
      {children}
    </div>
  );
}
