import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck, Check, ChevronDown, Fingerprint, Quote, TrendingUp, Users, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { WhatsAppButton } from '@/components/shared/brand';
import { AnimatedNumber, Reveal } from '@/components/shared/widgets';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { cn } from '@/lib/utils';

export function SectionHeading({ eyebrow, title, description, center = true }: { eyebrow?: string; title: string; description?: string; center?: boolean }) {
  return (
    <Reveal className={cn('mb-10 max-w-2xl space-y-3 sm:mb-14', center && 'mx-auto text-center')}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 className="h-section">{title}</h2>
      {description && <p className="lead">{description}</p>}
    </Reveal>
  );
}

export function PageHero({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description: string; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="grid-bg absolute inset-0" aria-hidden />
      <div className="container relative py-14 text-center sm:py-20">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mx-auto max-w-3xl space-y-4">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className="text-balance text-4xl font-extrabold tracking-tight sm:text-5xl">{title}</h1>
          <p className="lead mx-auto max-w-2xl">{description}</p>
          {children && <div className="flex flex-wrap justify-center gap-3 pt-2">{children}</div>}
        </motion.div>
      </div>
    </section>
  );
}

/** The four primary calls to action, reused across pages. */
export function CtaButtons({ className, size = 'lg' }: { className?: string; size?: 'default' | 'lg' }) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:flex-wrap', className)}>
      <Button size={size} asChild>
        <Link to="/book-demo">{t('cta.bookDemo')} <ArrowRight /></Link>
      </Button>
      <Button size={size} variant="outline" asChild>
        <Link to="/free-trial">{t('cta.startTrial')}</Link>
      </Button>
      <WhatsAppButton intent="product_enquiry" size={size} />
    </div>
  );
}

export function CtaBand() {
  const { t } = useTranslation();
  return (
    <section className="section">
      <div className="container">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-12 text-center text-primary-foreground sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
            <div className="pointer-events-none absolute -bottom-24 -left-10 size-72 rounded-full bg-black/10 blur-2xl" aria-hidden />
            <div className="relative mx-auto max-w-2xl space-y-4">
              <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">{t('ctaBand.title')}</h2>
              <p className="text-pretty text-base opacity-90 sm:text-lg">{t('ctaBand.description')}</p>
              <div className="flex flex-col justify-center gap-3 pt-2 sm:flex-row">
                <Button size="lg" asChild className="bg-white text-slate-900 hover:bg-white/90">
                  <Link to="/book-demo">{t('cta.bookDemo')} <ArrowRight /></Link>
                </Button>
                <Button size="lg" variant="outline" asChild className="border-white/40 bg-transparent text-inherit hover:bg-white/10">
                  <Link to="/contact">{t('cta.contactSales')}</Link>
                </Button>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * Illustrative product dashboard built from live UI tokens (not a screenshot),
 * so it follows the current theme. Values are sample data for illustration.
 */
export function DashboardPreview() {
  const { t } = useTranslation();
  const bars = [42, 58, 51, 70, 64, 82, 76];
  const stats = [
    { icon: Users, label: t('preview.employees'), value: 248 },
    { icon: Fingerprint, label: t('preview.present'), value: 231 },
    { icon: CalendarCheck, label: t('preview.onLeave'), value: 12 },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 40, rotateX: 8 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformPerspective: 1200 }}
      className="relative"
      role="img"
      aria-label={t('preview.alt')}
    >
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-primary/25 via-brand-2/15 to-brand-3/20 blur-3xl" aria-hidden />
      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center gap-1.5 border-b bg-muted/60 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-destructive/60" />
          <span className="size-2.5 rounded-full bg-warning/60" />
          <span className="size-2.5 rounded-full bg-success/60" />
          <span className="ml-3 truncate text-xs text-muted-foreground">{t('preview.title')}</span>
          <Badge tone="outline" className="ml-auto text-[10px]">{t('preview.sample')}</Badge>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {stats.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 + i * 0.1 }} className="rounded-xl border bg-background p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><s.icon className="size-3.5 text-primary" aria-hidden />{s.label}</div>
              <p className="mt-1 text-2xl font-bold"><AnimatedNumber value={s.value} /></p>
            </motion.div>
          ))}
          <div className="rounded-xl border bg-background p-3 sm:col-span-2">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="font-semibold">{t('preview.attendanceTrend')}</span>
              <span className="inline-flex items-center gap-1 text-success"><TrendingUp className="size-3.5" aria-hidden />93%</span>
            </div>
            <div className="flex h-24 items-end gap-2">
              {bars.map((h, i) => (
                <motion.div key={i} className="flex-1 rounded-t-md bg-primary/80" initial={{ height: 0 }} animate={{ height: `${h}%` }} transition={{ delay: 0.7 + i * 0.06, duration: 0.5, ease: 'easeOut' }} />
              ))}
            </div>
          </div>
          <div className="rounded-xl border bg-background p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="size-3.5 text-primary" aria-hidden />{t('preview.payroll')}</div>
            <p className="mt-1 text-xl font-bold">₹18.4L</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full rounded-full bg-success" initial={{ width: 0 }} animate={{ width: '78%' }} transition={{ delay: 1, duration: 0.8 }} />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{t('preview.processed')}</p>
          </div>
        </div>
      </div>
      <motion.div className="glass absolute -bottom-5 -left-3 hidden items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium shadow-lg sm:flex" animate={{ y: [0, -8, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-success/15 text-success"><Check className="size-3.5" /></span>
        {t('preview.payslipsSent')}
      </motion.div>
    </motion.div>
  );
}

export function Testimonials() {
  const { t, i18n } = useTranslation();
  const { testimonials } = usePublicConfig();
  const placeholders = testimonials.length === 0;
  const items = placeholders
    ? [1, 2, 3].map((n) => ({ quote: t('testimonials.placeholderQuote'), name: t('testimonials.placeholderName', { n }), role: t('testimonials.placeholderRole'), company: '' }))
    : testimonials.map((x) => ({ ...x, quote: (i18n.language === 'ta' && x.quote_ta) || x.quote }));

  return (
    <section className="section bg-muted/40">
      <div className="container">
        <SectionHeading eyebrow={t('testimonials.eyebrow')} title={t('testimonials.title')} description={placeholders ? t('testimonials.placeholderNote') : undefined} />
        <div className="grid gap-5 md:grid-cols-3">
          {items.map((item, i) => (
            <Reveal key={i} delay={i * 0.08}>
              <Card className={cn('flex h-full flex-col gap-4 p-6', placeholders && 'border-dashed bg-card/60')}>
                <div className="flex items-center justify-between">
                  <Quote className="size-6 text-primary/60" aria-hidden />
                  {placeholders && <Badge tone="warning">{t('testimonials.placeholderBadge')}</Badge>}
                </div>
                <p className={cn('flex-1 text-pretty text-sm leading-relaxed', placeholders && 'italic text-muted-foreground')}>{item.quote}</p>
                <div className="text-sm">
                  <p className="font-semibold">{item.name}</p>
                  <p className="text-muted-foreground">{[item.role, item.company].filter(Boolean).join(' · ')}</p>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FaqList({ limit }: { limit?: number }) {
  const { t } = useTranslation();
  const items = t('faq.items', { returnObjects: true }) as { q: string; a: string }[];
  const [open, setOpen] = useState<number | null>(0);
  const list = Array.isArray(items) ? items.slice(0, limit ?? items.length) : [];
  return (
    <div className="mx-auto max-w-3xl divide-y rounded-2xl border bg-card">
      {list.map((item, i) => {
        const expanded = open === i;
        return (
          <div key={i}>
            <h3>
              <button
                className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold"
                aria-expanded={expanded}
                aria-controls={`faq-panel-${i}`}
                id={`faq-button-${i}`}
                onClick={() => setOpen(expanded ? null : i)}
              >
                <span>{item.q}</span>
                <ChevronDown className={cn('size-5 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-180')} aria-hidden />
              </button>
            </h3>
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div id={`faq-panel-${i}`} role="region" aria-labelledby={`faq-button-${i}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
                  <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

export function SuccessPanel({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-4 rounded-2xl border bg-card p-8 text-center" role="status" aria-live="polite">
      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }} className="inline-flex size-16 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="size-8" strokeWidth={3} aria-hidden />
      </motion.span>
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </motion.div>
  );
}
