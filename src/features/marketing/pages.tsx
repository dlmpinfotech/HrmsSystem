import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, CalendarClock, Check, Clock, Globe, Headset, Languages, Mail, MapPin, Phone, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Seo, useWhatsAppLink, WhatsAppButton } from '@/components/shared/brand';
import { TextareaField } from '@/components/shared/Field';
import { ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, Reveal, StatusBadge } from '@/components/shared/widgets';
import { VideoGallery } from '@/features/content/VideoGallery';
import { FEATURE_ICONS, FEATURED_INDUSTRIES, INDUSTRY_ICONS, SERVICE_CITIES } from '@/features/marketing/content';
import { DemoBookingForm, LeadForm, SlotPicker, TrialForm, type BookedDemo } from '@/features/marketing/forms';
import { PricingCards } from '@/features/marketing/PricingCards';
import { CtaBand, CtaButtons, DashboardPreview, FaqList, PageHero, SectionHeading, SuccessPanel, Testimonials } from '@/features/marketing/sections';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { api, errorKey } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { FEATURE_INTERESTS } from '@shared/constants';
import { formatPhone } from '@shared/phone';

// ── Home ──────────────────────────────────────────────────────────────
export function HomePage() {
  const { t } = useTranslation();
  const highlights = [
    { icon: Languages, key: 'bilingual' },
    { icon: Zap, key: 'quickSetup' },
    { icon: Headset, key: 'localSupport' },
    { icon: ShieldCheck, key: 'compliance' },
  ];
  const steps = ['demo', 'trial', 'onboard'] as const;

  return (
    <>
      <Seo title={t('home.seoTitle')} description={t('home.seoDescription')} />
      <section className="relative overflow-hidden">
        <div className="grid-bg absolute inset-0" aria-hidden />
        <div className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" aria-hidden />
        <div className="container relative grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:py-24">
          <div className="space-y-6">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <Badge tone="primary" className="gap-1.5 px-3 py-1"><Sparkles className="size-3.5" aria-hidden />{t('home.badge')}</Badge>
            </motion.div>
            <motion.h1 className="h-display" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.05 }}>
              {t('home.titleLead')} <span className="gradient-text">{t('home.titleAccent')}</span>
            </motion.h1>
            <motion.p className="lead max-w-xl" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.12 }}>
              {t('home.subtitle')}
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, delay: 0.2 }}>
              <CtaButtons />
            </motion.div>
            <motion.ul className="flex flex-wrap gap-x-5 gap-y-2 pt-1 text-sm text-muted-foreground" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              {(['noCard', 'trialDays', 'tamilEnglish'] as const).map((k) => (
                <li key={k} className="flex items-center gap-1.5"><Check className="size-4 text-success" aria-hidden />{t(`home.trust.${k}`)}</li>
              ))}
            </motion.ul>
          </div>
          <DashboardPreview />
        </div>
      </section>

      <section className="border-y bg-card">
        <div className="container grid grid-cols-2 gap-6 py-8 lg:grid-cols-4">
          {highlights.map(({ icon: Icon, key }, i) => (
            <Reveal key={key} delay={i * 0.06} className="flex items-start gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
              <div>
                <p className="text-sm font-semibold">{t(`home.highlights.${key}.title`)}</p>
                <p className="text-xs text-muted-foreground">{t(`home.highlights.${key}.body`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading eyebrow={t('home.featuresEyebrow')} title={t('home.featuresTitle')} description={t('home.featuresDescription')} />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_INTERESTS.slice(0, 6).map((f, i) => {
              const Icon = FEATURE_ICONS[f];
              return (
                <Reveal key={f} delay={(i % 3) * 0.07}>
                  <motion.div whileHover={{ y: -6 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }} className="h-full">
                    <Card className="group h-full p-6 transition-shadow hover:shadow-soft">
                      <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"><Icon className="size-5" aria-hidden /></span>
                      <h3 className="mt-4 text-lg font-semibold">{t(`feature.${f}`)}</h3>
                      <p className="mt-1.5 text-sm text-muted-foreground">{t(`featureDesc.${f}`)}</p>
                    </Card>
                  </motion.div>
                </Reveal>
              );
            })}
          </div>
          <div className="mt-8 text-center">
            <Button variant="outline" asChild><Link to="/features">{t('home.allFeatures')} <ArrowRight /></Link></Button>
          </div>
        </div>
      </section>

      <section className="section bg-muted/40">
        <div className="container">
          <SectionHeading eyebrow={t('home.stepsEyebrow')} title={t('home.stepsTitle')} />
          <ol className="grid gap-5 md:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal as="li" key={s} delay={i * 0.1}>
                <Card className="relative h-full p-6">
                  <span className="text-5xl font-extrabold text-primary/15" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="mt-2 text-lg font-semibold">{t(`home.steps.${s}.title`)}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{t(`home.steps.${s}.body`)}</p>
                </Card>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container grid items-center gap-10 lg:grid-cols-2">
          <Reveal className="space-y-4">
            <p className="eyebrow">{t('home.localEyebrow')}</p>
            <h2 className="h-section">{t('home.localTitle')}</h2>
            <p className="lead">{t('home.localBody')}</p>
            <ul className="flex flex-wrap gap-2 pt-1">
              {SERVICE_CITIES.map((c) => (
                <li key={c}><Badge tone="primary" className="gap-1.5 px-3 py-1.5 text-sm"><MapPin className="size-3.5" aria-hidden />{t(`city.${c}`)}</Badge></li>
              ))}
            </ul>
            <Button variant="link" asChild><Link to="/solutions">{t('home.seeIndustries')} <ArrowRight /></Link></Button>
          </Reveal>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {FEATURED_INDUSTRIES.map((ind, i) => {
              const Icon = INDUSTRY_ICONS[ind];
              return (
                <Reveal key={ind} delay={(i % 4) * 0.05}>
                  <Card className="flex h-full flex-col items-center gap-2 p-4 text-center">
                    <Icon className="size-6 text-primary" aria-hidden />
                    <span className="text-sm font-medium">{t(`industry.${ind}`)}</span>
                  </Card>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section bg-muted/40">
        <div className="container">
          <SectionHeading eyebrow={t('pricing.eyebrow')} title={t('pricing.title')} description={t('pricing.description')} />
          <PricingCards />
        </div>
      </section>

      <Testimonials />

      <section className="section">
        <div className="container">
          <SectionHeading eyebrow={t('faq.eyebrow')} title={t('faq.title')} />
          <FaqList limit={4} />
          <div className="mt-6 text-center"><Button variant="link" asChild><Link to="/faq">{t('faq.viewAll')} <ArrowRight /></Link></Button></div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}

// ── Features ──────────────────────────────────────────────────────────
export function FeaturesPage() {
  const { t } = useTranslation();
  return (
    <>
      <Seo title={t('features.seoTitle')} description={t('features.description')} />
      <PageHero eyebrow={t('nav.features')} title={t('features.title')} description={t('features.description')}><CtaButtons size="default" /></PageHero>
      <section className="section">
        <div className="container grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_INTERESTS.map((f, i) => {
            const Icon = FEATURE_ICONS[f];
            const points = t(`featurePoints.${f}`, { returnObjects: true }) as string[];
            return (
              <Reveal key={f} delay={(i % 3) * 0.07}>
                <Card className="h-full p-6">
                  <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
                  <h2 className="mt-4 text-lg font-semibold">{t(`feature.${f}`)}</h2>
                  <p className="mt-1.5 text-sm text-muted-foreground">{t(`featureDesc.${f}`)}</p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {Array.isArray(points) && points.map((p) => (
                      <li key={p} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{p}</li>
                    ))}
                  </ul>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </section>
      <CtaBand />
    </>
  );
}

// ── Industry solutions ────────────────────────────────────────────────
export function SolutionsPage() {
  const { t } = useTranslation();
  return (
    <>
      <Seo title={t('solutions.seoTitle')} description={t('solutions.description')} />
      <PageHero eyebrow={t('nav.solutions')} title={t('solutions.title')} description={t('solutions.description')} />
      <section className="section">
        <div className="container grid gap-5 md:grid-cols-2">
          {FEATURED_INDUSTRIES.map((ind, i) => {
            const Icon = INDUSTRY_ICONS[ind];
            return (
              <Reveal key={ind} delay={(i % 2) * 0.08}>
                <Card className="flex h-full gap-4 p-6">
                  <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-6" aria-hidden /></span>
                  <div>
                    <h2 className="text-lg font-semibold">{t(`industry.${ind}`)}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{t(`industryDesc.${ind}`)}</p>
                  </div>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </section>
      <section className="section bg-muted/40">
        <div className="container">
          <SectionHeading eyebrow={t('solutions.citiesEyebrow')} title={t('solutions.citiesTitle')} description={t('solutions.citiesBody')} />
          <div className="grid gap-5 md:grid-cols-3">
            {SERVICE_CITIES.map((c, i) => (
              <Reveal key={c} delay={i * 0.08}>
                <Card className="h-full p-6">
                  <MapPin className="size-6 text-primary" aria-hidden />
                  <h3 className="mt-3 text-lg font-semibold">{t(`city.${c}`)}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t(`solutions.cityDesc.${c}`)}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}

// ── Pricing ───────────────────────────────────────────────────────────
export function PricingPage() {
  const { t } = useTranslation();
  return (
    <>
      <Seo title={t('pricing.seoTitle')} description={t('pricing.description')} />
      <PageHero eyebrow={t('pricing.eyebrow')} title={t('pricing.title')} description={t('pricing.description')} />
      <section className="section"><div className="container"><PricingCards /></div></section>
      <section className="section bg-muted/40">
        <div className="container">
          <SectionHeading title={t('faq.title')} />
          <FaqList limit={5} />
        </div>
      </section>
      <CtaBand />
    </>
  );
}

// ── Demo videos ───────────────────────────────────────────────────────
export function VideosPage() {
  const { t } = useTranslation();
  return (
    <>
      <Seo title={t('videos.seoTitle')} description={t('videos.description')} />
      <PageHero eyebrow={t('nav.videos')} title={t('videos.title')} description={t('videos.description')}>
        <Button asChild><Link to="/book-demo">{t('cta.bookDemo')}</Link></Button>
      </PageHero>
      <section className="section"><div className="container"><VideoGallery audience="public" /></div></section>
    </>
  );
}

// ── Book a demo ───────────────────────────────────────────────────────
export function BookDemoPage() {
  const { t, i18n } = useTranslation();
  const [booked, setBooked] = useState<BookedDemo | null>(null);
  const waDemo = useWhatsAppLink('demo_booking');
  const expectations = t('bookDemo.expect', { returnObjects: true }) as string[];
  return (
    <>
      <Seo title={t('bookDemo.seoTitle')} description={t('bookDemo.description')} />
      <section className="section">
        <div className="container grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            <p className="eyebrow">{t('cta.bookDemo')}</p>
            <h1 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">{t('bookDemo.title')}</h1>
            <p className="lead">{t('bookDemo.description')}</p>
            <ul className="space-y-2.5 text-sm">
              {Array.isArray(expectations) && expectations.map((e) => (
                <li key={e} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{e}</li>
              ))}
            </ul>
            {waDemo && (
              <div className="flex flex-wrap items-center gap-3 pt-2 text-sm text-muted-foreground">
                <span>{t('bookDemo.preferChat')}</span>
                <WhatsAppButton intent="demo_booking" size="sm" />
              </div>
            )}
          </div>
          <Card className="p-5 sm:p-7">
            {booked ? (
              <SuccessPanel title={t('bookDemo.successTitle')} description={t('bookDemo.successBody', { date: formatDate(booked.starts_at, i18n.language), time: formatTime(booked.starts_at, i18n.language) })}>
                <Button variant="outline" asChild><Link to={`/demo/manage/${booked.manage_token}`}>{t('bookDemo.manage')}</Link></Button>
              </SuccessPanel>
            ) : (
              <DemoBookingForm onBooked={setBooked} />
            )}
          </Card>
        </div>
      </section>
    </>
  );
}

// ── Manage an existing booking (link from the confirmation message) ───
interface ManagedBooking {
  status: string;
  starts_at: string;
  ends_at: string;
  company_name: string;
  contact_name: string;
  mode: string;
  meeting_url: string | null;
  can_reschedule: boolean;
  can_cancel: boolean;
}

export function ManageDemoPage() {
  const { t, i18n } = useTranslation();
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'view' | 'reschedule'>('view');
  const [slot, setSlot] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const query = useQuery({
    queryKey: ['manage-demo', token],
    queryFn: () => api<{ booking: ManagedBooking }>(`/public/demo-bookings/manage?token=${encodeURIComponent(token)}`, { auth: false }),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (body: object) => api('/public/demo-bookings/manage', { method: 'POST', auth: false, body: { token, ...body } }),
    onSuccess: async () => {
      setMode('view');
      setCancelOpen(false);
      setSlot('');
      toast.success(t('manageDemo.updated'));
      await Promise.all([qc.invalidateQueries({ queryKey: ['manage-demo', token] }), qc.invalidateQueries({ queryKey: ['demo-slots'] })]);
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  const b = query.data?.booking;
  return (
    <>
      <Seo title={t('manageDemo.title')} noindex />
      <section className="section">
        <div className="container max-w-2xl">
          <h1 className="mb-6 text-3xl font-extrabold tracking-tight">{t('manageDemo.title')}</h1>
          {query.isPending && <ListSkeleton rows={4} />}
          {query.isError && <ErrorState error={query.error} />}
          {b && (
            <Card className="space-y-5 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted-foreground">{b.company_name}</p>
                  <p className="mt-1 flex items-center gap-2 text-xl font-bold"><CalendarClock className="size-5 text-primary" aria-hidden />{formatDate(b.starts_at, i18n.language)}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-muted-foreground"><Clock className="size-4" aria-hidden />{formatTime(b.starts_at, i18n.language)} – {formatTime(b.ends_at, i18n.language)} IST</p>
                </div>
                <StatusBadge value={b.status} />
              </div>
              {b.meeting_url && <Button asChild variant="outline"><a href={b.meeting_url} target="_blank" rel="noopener noreferrer">{t('manageDemo.join')}</a></Button>}

              {mode === 'view' && (b.can_reschedule || b.can_cancel) && (
                <div className="flex flex-col gap-2 border-t pt-5 sm:flex-row">
                  {b.can_reschedule && <Button onClick={() => setMode('reschedule')}>{t('manageDemo.reschedule')}</Button>}
                  {b.can_cancel && <Button variant="outline" onClick={() => setCancelOpen(true)}>{t('manageDemo.cancel')}</Button>}
                </div>
              )}
              {mode === 'view' && !b.can_reschedule && !b.can_cancel && (
                <div className="border-t pt-5">
                  <p className="mb-3 text-sm text-muted-foreground">{t('manageDemo.closed')}</p>
                  <Button asChild><Link to="/book-demo">{t('manageDemo.bookAgain')}</Link></Button>
                </div>
              )}
              {mode === 'reschedule' && (
                <div className="space-y-4 border-t pt-5">
                  <h2 className="font-semibold">{t('manageDemo.pickNew')}</h2>
                  <SlotPicker value={slot} onChange={setSlot} />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button disabled={!slot} loading={mutation.isPending} onClick={() => mutation.mutate({ action: 'reschedule', starts_at: slot })}>{t('manageDemo.confirmNew')}</Button>
                    <Button variant="ghost" onClick={() => setMode('view')}>{t('common.back')}</Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      </section>
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title={t('manageDemo.cancelTitle')} description={t('manageDemo.cancelBody')} confirmLabel={t('manageDemo.cancel')} destructive loading={mutation.isPending} onConfirm={() => mutation.mutate({ action: 'cancel', reason })}>
        <TextareaField label={t('manageDemo.reason')} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </ConfirmDialog>
    </>
  );
}

// ── Contact ───────────────────────────────────────────────────────────
export function ContactPage() {
  const { t } = useTranslation();
  const config = usePublicConfig();
  return (
    <>
      <Seo title={t('contact.seoTitle')} description={t('contact.description')} />
      <section className="section">
        <div className="container grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <div className="space-y-5">
            <p className="eyebrow">{t('nav.contact')}</p>
            <h1 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">{t('contact.title')}</h1>
            <p className="lead">{t('contact.description')}</p>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3"><MapPin className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden /><span>{config.brand.address}</span></li>
              {config.brand.support_phone && <li className="flex items-center gap-3"><Phone className="size-5 shrink-0 text-primary" aria-hidden /><a className="font-medium hover:underline" href={`tel:${config.brand.support_phone}`}>{formatPhone(config.brand.support_phone)}</a></li>}
              {config.brand.support_email && <li className="flex items-center gap-3"><Mail className="size-5 shrink-0 text-primary" aria-hidden /><a className="font-medium hover:underline" href={`mailto:${config.brand.support_email}`}>{config.brand.support_email}</a></li>}
              <li className="flex items-center gap-3"><Clock className="size-5 shrink-0 text-primary" aria-hidden /><span>{t('contact.hours')}</span></li>
            </ul>
            <div className="flex flex-wrap gap-3">
              <WhatsAppButton intent="sales_support" />
              <Button variant="outline" asChild><Link to="/book-demo">{t('cta.bookDemo')}</Link></Button>
            </div>
          </div>
          <Card className="p-5 sm:p-7">
            <h2 className="mb-4 text-lg font-semibold">{t('contact.formTitle')}</h2>
            <LeadForm source="contact_form" />
          </Card>
        </div>
      </section>
    </>
  );
}

// ── Free trial ────────────────────────────────────────────────────────
export function FreeTrialPage() {
  const { t } = useTranslation();
  const [done, setDone] = useState<{ confirm: boolean; email: string } | null>(null);
  const perks = t('trial.perks', { returnObjects: true }) as string[];
  return (
    <>
      <Seo title={t('trial.seoTitle')} description={t('trial.description')} />
      <section className="section">
        <div className="container grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            <p className="eyebrow">{t('cta.startTrial')}</p>
            <h1 className="text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">{t('trial.title')}</h1>
            <p className="lead">{t('trial.description')}</p>
            <ul className="space-y-2.5 text-sm">
              {Array.isArray(perks) && perks.map((p) => <li key={p} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />{p}</li>)}
            </ul>
          </div>
          <Card className="p-5 sm:p-7">
            {done ? (
              <SuccessPanel title={t('trial.successTitle')} description={done.confirm ? t('trial.successConfirm', { email: done.email }) : t('trial.successReady')}>
                <Button asChild><Link to="/login">{t('auth.signIn')}</Link></Button>
              </SuccessPanel>
            ) : (
              <TrialForm onDone={(confirm, email) => setDone({ confirm, email })} />
            )}
          </Card>
        </div>
      </section>
    </>
  );
}

// ── About ─────────────────────────────────────────────────────────────
export function AboutPage() {
  const { t } = useTranslation();
  const values = ['local', 'simple', 'honest', 'support'] as const;
  return (
    <>
      <Seo title={t('about.seoTitle')} description={t('about.description')} />
      <PageHero eyebrow={t('nav.about')} title={t('about.title')} description={t('about.description')} />
      <section className="section">
        <div className="container grid gap-10 lg:grid-cols-2">
          <Reveal className="space-y-4">
            <h2 className="h-section">{t('about.storyTitle')}</h2>
            <p className="text-pretty leading-relaxed text-muted-foreground">{t('about.story1')}</p>
            <p className="text-pretty leading-relaxed text-muted-foreground">{t('about.story2')}</p>
            <div className="flex items-center gap-2 pt-2 text-sm font-medium"><Globe className="size-4 text-primary" aria-hidden />{t('about.expansion')}</div>
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {values.map((v, i) => (
              <Reveal key={v} delay={i * 0.07}>
                <Card className="h-full p-5">
                  <h3 className="font-semibold">{t(`about.values.${v}.title`)}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{t(`about.values.${v}.body`)}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}

// ── FAQ ───────────────────────────────────────────────────────────────
export function FaqPage() {
  const { t } = useTranslation();
  return (
    <>
      <Seo title={t('faq.seoTitle')} description={t('faq.description')} />
      <PageHero eyebrow={t('faq.eyebrow')} title={t('faq.title')} description={t('faq.description')} />
      <section className="section">
        <div className="container">
          <FaqList />
          <div className="mt-8 flex flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">{t('faq.stillQuestions')}</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button asChild><Link to="/contact">{t('cta.contactSales')}</Link></Button>
              <WhatsAppButton intent="sales_support" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

// ── Legal ─────────────────────────────────────────────────────────────
function LegalPage({ ns }: { ns: 'privacy' | 'terms' }) {
  const { t } = useTranslation();
  const config = usePublicConfig();
  const sections = t(`${ns}.sections`, { returnObjects: true, brand: config.brand.name }) as { h: string; p: string[] }[];
  return (
    <>
      <Seo title={t(`${ns}.title`)} description={t(`${ns}.intro`, { brand: config.brand.name })} />
      <section className="section">
        <article className="container max-w-3xl">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t(`${ns}.title`)}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('legal.updated')}</p>
          <p className="mt-6 leading-relaxed text-muted-foreground">{t(`${ns}.intro`, { brand: config.brand.name })}</p>
          {Array.isArray(sections) && sections.map((s) => (
            <section key={s.h} className="mt-8">
              <h2 className="text-xl font-bold">{s.h}</h2>
              {s.p.map((p, i) => <p key={i} className="mt-3 leading-relaxed text-muted-foreground">{p}</p>)}
            </section>
          ))}
          <p className="mt-10 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t('legal.reviewNote')}</p>
        </article>
      </section>
    </>
  );
}
export const PrivacyPage = () => <LegalPage ns="privacy" />;
export const TermsPage = () => <LegalPage ns="terms" />;

// ── 404 ───────────────────────────────────────────────────────────────
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <section className="section">
      <Seo title={t('notFound.title')} noindex />
      <div className="container flex flex-col items-center gap-4 text-center">
        <p className="text-7xl font-extrabold text-primary/20">404</p>
        <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
        <p className="max-w-md text-muted-foreground">{t('notFound.body')}</p>
        <Button asChild><Link to="/">{t('notFound.home')}</Link></Button>
      </div>
    </section>
  );
}
