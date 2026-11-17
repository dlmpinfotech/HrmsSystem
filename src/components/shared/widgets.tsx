import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useInView, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Check, Languages, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTheme, type ThemeChoice } from '@/features/branding/ThemeProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { SUPPORTED_LANGUAGES, setLanguage } from '@/i18n';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { Language } from '@shared/constants';

// ── Page header ───────────────────────────────────────────────────────
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const { branding } = useTheme();
  // Signed-in pages name the browser tab after the page and the company's display name.
  useEffect(() => {
    document.title = branding?.display_name ? `${title} | ${branding.display_name}` : title;
  }, [title, branding?.display_name]);
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Animated counter ──────────────────────────────────────────────────
export function AnimatedNumber({ value, format = (n) => Math.round(n).toLocaleString('en-IN') }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20px' });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);
  const from = useRef(0);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setDisplay(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
      onComplete: () => {
        from.current = value;
      },
    });
    return () => controls.stop();
  }, [value, inView, reduce]);

  return (
    <span ref={ref} className="tabular">
      {format(display)}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────
export function StatCard({ label, value, format, icon: Icon, hint, tone = 'primary', index = 0 }: { label: string; value: number; format?: (n: number) => string; icon: LucideIcon; hint?: ReactNode; tone?: 'primary' | 'info' | 'success' | 'warning'; index?: number }) {
  const tones = { primary: 'bg-primary/10 text-primary', info: 'bg-brand-2/15 text-foreground', success: 'bg-success/10 text-success', warning: 'bg-warning/10 text-warning' };
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.4) }} whileHover={{ y: -3 }}>
      <Card className="h-full p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
            <Icon className="size-[18px]" aria-hidden />
          </span>
        </div>
        <p className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          <AnimatedNumber value={value} format={format} />
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </Card>
    </motion.div>
  );
}

// ── Reveal on scroll ──────────────────────────────────────────────────
export function Reveal({ children, delay = 0, className, as = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'li' | 'section' }) {
  const Comp = motion[as];
  return (
    <Comp className={className} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </Comp>
  );
}

// ── Status badge ──────────────────────────────────────────────────────
const TONES: Record<string, BadgeTone> = {
  new: 'info', contacted: 'primary', qualified: 'primary', demo_scheduled: 'warning', demo_completed: 'primary', trial: 'info', negotiation: 'warning', won: 'success', lost: 'danger',
  scheduled: 'info', completed: 'success', cancelled: 'neutral', no_show: 'danger',
  onboarding: 'info', active: 'success', suspended: 'danger',
  trialing: 'info', past_due: 'warning', expired: 'danger',
  pending: 'warning', verified: 'success', failed: 'danger', refunded: 'neutral',
  draft: 'neutral', issued: 'info', paid: 'success', void: 'neutral', overdue: 'danger',
  open: 'info', in_progress: 'primary', waiting_customer: 'warning', resolved: 'success', closed: 'neutral',
  queued: 'neutral', sent: 'primary', delivered: 'success', read: 'success', skipped: 'warning', received: 'info',
  low: 'neutral', medium: 'info', high: 'warning', urgent: 'danger',
  done: 'success', paused: 'warning', accepted: 'success', revoked: 'neutral', approved: 'success', rejected: 'danger', inactive: 'neutral', exited: 'outline',
};

/** `group` selects the i18n namespace, e.g. group="leadStatus" → t('leadStatus.new'). */
export function StatusBadge({ value, group = 'status', className }: { value: string | null | undefined; group?: string; className?: string }) {
  const { t } = useTranslation();
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge tone={TONES[value] ?? 'neutral'} className={className}>
      {t(`${group}.${value}`, { defaultValue: value.replace(/_/g, ' ') })}
    </Badge>
  );
}

// ── Language switcher ─────────────────────────────────────────────────
export function LanguageSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const current = SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0];

  const choose = async (code: Language) => {
    await setLanguage(code);
    // Remember the choice on the account so it follows the user across devices.
    if (user && supabase) void supabase.from('profiles').update({ preferred_language: code }).eq('id', user.id);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={compact ? 'icon-sm' : 'sm'} aria-label={t('common.changeLanguage')} className={className}>
          <Languages />
          {!compact && <span>{current.label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {SUPPORTED_LANGUAGES.map((l) => (
          <DropdownMenuItem key={l.code} onSelect={() => void choose(l.code)} lang={l.code}>
            <span className="flex-1">{l.label}</span>
            {l.code === current.code && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Theme toggle ──────────────────────────────────────────────────────
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { theme, setTheme, resolved, themeLocked } = useTheme();
  const options: { value: ThemeChoice; icon: LucideIcon }[] = [
    { value: 'light', icon: Sun },
    { value: 'dark', icon: Moon },
    { value: 'system', icon: Monitor },
  ];
  const Current = resolved === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('common.changeTheme')} className={className} disabled={themeLocked} title={themeLocked ? t('common.themeLocked') : undefined}>
          <Current />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {options.map(({ value, icon: Icon }) => (
          <DropdownMenuItem key={value} onSelect={() => setTheme(value)}>
            <Icon />
            <span className="flex-1">{t(`theme.${value}`)}</span>
            {theme === value && <Check className="text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Confirm dialog ────────────────────────────────────────────────────
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, destructive, loading, onConfirm, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; confirmLabel: string; destructive?: boolean; loading?: boolean; onConfirm: () => void; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children && <DialogBody>{children}</DialogBody>}
        <DialogFooter className={children ? undefined : 'border-t-0'}>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Modal shell used by every form dialog ─────────────────────────────
export function FormDialog({ open, onOpenChange, title, description, size = 'md', children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size} closeLabel={t('common.close')} aria-describedby={description ? undefined : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>{description ?? title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

// ── Definition row ────────────────────────────────────────────────────
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{children ?? '—'}</dd>
    </div>
  );
}
