import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Inbox, Loader2, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { errorKey } from '@/lib/api';
import { cn } from '@/lib/utils';

export function FullPageLoader() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
      <Loader2 className="size-7 animate-spin text-primary" aria-hidden />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label={t('common.loading')}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-xl" />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center', className)}>
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {description && <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center', className)}>
      <TriangleAlert className="size-7 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="font-semibold">{t('errors.loadFailed')}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{t(errorKey(error), { defaultValue: t('errors.generic') })}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

/** Renders loading / error / empty / data for a TanStack query with one consistent look. */
export function QueryState<T>({
  query,
  children,
  skeleton,
  empty,
  isEmpty,
}: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  skeleton?: ReactNode;
  empty?: ReactNode;
  isEmpty?: (data: T) => boolean;
}) {
  if (query.isPending) return <>{skeleton ?? <ListSkeleton />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data as T;
  const emptyNow = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;
  if (emptyNow && empty) return <>{empty}</>;
  return <>{children(data)}</>;
}
