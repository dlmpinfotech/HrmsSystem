import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Inbox, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { AnimatedLogoMark } from '@/components/shared/brand';
import { useTheme } from '@/features/branding/ThemeProvider';
import { env } from '@/lib/env';
import { errorKey } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Slim indeterminate bar, e.g. while a page's code is downloading. */
export function TopProgress({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-primary/15', className)} aria-hidden>
      <div className="h-full w-2/5 animate-progress-slide rounded-full bg-primary" />
    </div>
  );
}

/** Branded loading screen (sign-in check, first load of an area). */
export function FullPageLoader() {
  const { t } = useTranslation();
  const { branding } = useTheme();
  const name = branding?.display_name || env.brandName;
  return (
    <div className="app-canvas flex min-h-dvh flex-col items-center justify-center gap-5" role="status" aria-live="polite">
      <AnimatedLogoMark loop />
      <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.4 }} className="font-display text-lg font-bold tracking-tight">
        {name}
      </motion.p>
      <div className="h-[3px] w-36 overflow-hidden rounded-full bg-primary/15" aria-hidden>
        <div className="h-full w-2/5 animate-progress-slide rounded-full bg-primary" />
      </div>
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

/** In-app page placeholder shaped like a typical page: title, stat cards, list. */
export function PageSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="space-y-5 py-1" role="status" aria-label={t('common.loading')}>
      <TopProgress />
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
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
    <div className={cn('flex animate-fade-up flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-card/50 px-6 py-14 text-center', className)}>
      <span className="relative inline-flex size-16 items-center justify-center">
        <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/20 to-brand-2/10 blur-md" aria-hidden />
        <span className="relative inline-flex size-14 animate-float-slow items-center justify-center rounded-2xl border bg-card text-primary shadow-card">
          <Icon className="size-6" aria-hidden />
        </span>
      </span>
      <div className="space-y-1">
        <p className="font-display text-base font-semibold">{title}</p>
        {description && <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className={cn('flex animate-fade-up flex-col items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center', className)}>
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><TriangleAlert className="size-6" aria-hidden /></span>
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
