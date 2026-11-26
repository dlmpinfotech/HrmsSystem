import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface FilterItem {
  /** Visible label in the phone sheet (the inline control keeps its own aria-label). */
  label: string;
  control: ReactNode;
  /** Width of the inline control from the md breakpoint, e.g. 'md:w-48'. */
  className?: string;
}

/**
 * Filters for list pages.
 *  • Tablet / desktop: one inline row — optional search, then each control.
 *  • Phone: search + a "Filters" button (with active count) that opens a bottom sheet.
 * Controls stay controlled by the page, so both views always show the same state.
 */
export function FilterBar({
  search,
  filters,
  activeCount = 0,
  onReset,
  trailing,
  className,
}: {
  search?: ReactNode;
  filters: FilterItem[];
  activeCount?: number;
  onReset?: () => void;
  /** Always-visible extras on the right (summary badges, export button…). */
  trailing?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Tablet / desktop */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {search && <div className="w-full max-w-xs flex-1">{search}</div>}
        {filters.map((f) => (
          <div key={f.label} className={cn('w-44', f.className)}>{f.control}</div>
        ))}
        {onReset && activeCount > 0 && (
          <Button variant="ghost" size="sm" onClick={onReset}><RotateCcw />{t('filters.reset')}</Button>
        )}
        {trailing && <div className="ml-auto flex flex-wrap items-center gap-2">{trailing}</div>}
      </div>

      {/* Phone */}
      <div className="flex items-center gap-2 md:hidden">
        {search && <div className="min-w-0 flex-1">{search}</div>}
        {filters.length > 0 && (
          <Button variant="outline" className={cn('relative shrink-0', !search && 'flex-1')} onClick={() => setOpen(true)} aria-label={t('filters.open', { count: activeCount })}>
            <SlidersHorizontal />
            {t('filters.button')}
            {activeCount > 0 && <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{activeCount}</span>}
          </Button>
        )}
      </div>
      {trailing && <div className="flex flex-wrap items-center gap-2 md:hidden">{trailing}</div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent side="bottom" closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><SlidersHorizontal className="size-5 text-primary" aria-hidden />{t('filters.title')}</DialogTitle>
            <DialogDescription>{t('filters.subtitle')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {filters.map((f) => (
              <div key={f.label} className="space-y-1.5">
                <p className="text-sm font-medium">{f.label}</p>
                <div className="[&_input]:w-full [&_select]:w-full">{f.control}</div>
              </div>
            ))}
          </DialogBody>
          <DialogFooter className="flex-row gap-2 sm:flex-row">
            {onReset && <Button variant="outline" className="flex-1" onClick={onReset} disabled={!activeCount}><RotateCcw />{t('filters.reset')}</Button>}
            <Button className="flex-1" onClick={() => setOpen(false)}>{t('filters.apply')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
