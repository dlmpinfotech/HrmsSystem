import { useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useForm, type FieldValues, type Path, type UseFormSetError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarX, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { WhatsAppButton } from '@/components/shared/brand';
import { CheckField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { ErrorState } from '@/components/shared/states';
import { SuccessPanel } from '@/features/marketing/sections';
import { usePublicPlans } from '@/features/subscriptions/plans';
import { getUtm, trackEvent } from '@/lib/analytics';
import { api, ApiError, errorKey } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CITIES, DEMO_MODES, EMPLOYEE_RANGES, FEATURE_INTERESTS, INDUSTRIES, type Language, type LeadSource } from '@shared/constants';
import { demoBookingSchema, publicLeadSchema, trialSignupSchema, type DemoBookingInput, type PublicLeadInput, type TrialSignupInput } from '@shared/schemas';
import { istDateString } from '@shared/slots';

/** Timing + honeypot metadata every public form sends for spam protection. */
function useFormMeta() {
  const startedAt = useRef(Date.now());
  return () => ({ elapsed_ms: Date.now() - startedAt.current, utm: getUtm() });
}

/** Maps server-side validation errors back onto the form; returns false when it could not. */
function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): boolean {
  if (err instanceof ApiError && err.fields?.length) {
    for (const field of err.fields) setError(field.path as Path<T>, { message: field.message });
    return true;
  }
  return false;
}

function Honeypot({ register }: { register: () => object }) {
  return (
    <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden>
      <label>
        Website
        <input type="text" tabIndex={-1} autoComplete="off" {...register()} />
      </label>
    </div>
  );
}

function CompanyOptions() {
  const { t } = useTranslation();
  return {
    cities: CITIES.map((c) => <option key={c} value={c}>{t(`city.${c}`)}</option>),
    industries: INDUSTRIES.map((i) => <option key={i} value={i}>{t(`industry.${i}`)}</option>),
    employees: EMPLOYEE_RANGES.map((r) => <option key={r.key} value={r.value}>{r.key}</option>),
  };
}

function ConsentFields({ register, consentError }: { register: (name: 'consent' | 'whatsapp_opt_in') => object; consentError?: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 rounded-lg bg-muted/60 p-3">
      <CheckField
        label={<>{t('form.consent')} <Link to="/privacy" target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">{t('nav.privacy')}</Link></>}
        error={consentError}
        {...register('consent')}
      />
      <CheckField label={t('form.whatsappOptIn')} {...register('whatsapp_opt_in')} />
    </div>
  );
}

// ── Contact / enquiry form ────────────────────────────────────────────
export function LeadForm({ source = 'contact_form', compact = false }: { source?: LeadSource; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const meta = useFormMeta();
  const [done, setDone] = useState(false);
  const options = CompanyOptions();
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<PublicLeadInput>({
    resolver: zodResolver(publicLeadSchema) as never,
    defaultValues: { interested_features: [], source, consent: false as never, whatsapp_opt_in: false },
  });

  const onSubmit = async (values: PublicLeadInput) => {
    try {
      await api('/public/leads', { method: 'POST', auth: false, body: { ...values, source, language: i18n.language as Language, ...meta() } });
      trackEvent('generate_lead', { source });
      setDone(true);
    } catch (err) {
      if (!applyServerErrors(err, setError)) toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    }
  };

  if (done) {
    return (
      <SuccessPanel title={t('contact.successTitle')} description={t('contact.successBody')}>
        <Button asChild><Link to="/book-demo">{t('cta.bookDemo')}</Link></Button>
      </SuccessPanel>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="relative space-y-4">
      <Honeypot register={() => register('website')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('form.contactPerson')} required autoComplete="name" error={errors.contact_person?.message} {...register('contact_person')} />
        <TextField label={t('form.companyName')} required autoComplete="organization" error={errors.company_name?.message} {...register('company_name')} />
        <TextField label={t('form.phone')} required type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" error={errors.phone?.message} {...register('phone')} />
        <TextField label={t('form.email')} type="email" inputMode="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <SelectField label={t('form.city')} error={errors.city?.message} defaultValue="" {...register('city')}>
          <option value="">{t('form.select')}</option>
          {options.cities}
        </SelectField>
        <SelectField label={t('form.employees')} error={errors.employee_count?.message} defaultValue="" {...register('employee_count')}>
          <option value="">{t('form.select')}</option>
          {options.employees}
        </SelectField>
        {!compact && (
          <>
            <SelectField label={t('form.industry')} error={errors.industry?.message} defaultValue="" {...register('industry')}>
              <option value="">{t('form.select')}</option>
              {options.industries}
            </SelectField>
            <TextField label={t('form.existingHrms')} hint={t('form.existingHrmsHint')} error={errors.existing_hrms?.message} {...register('existing_hrms')} />
          </>
        )}
      </div>
      {!compact && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('form.interestedIn')}</legend>
          <div className="flex flex-wrap gap-2">
            {FEATURE_INTERESTS.map((f) => (
              <label key={f} className="cursor-pointer">
                <input type="checkbox" value={f} className="peer sr-only" {...register('interested_features')} />
                <span className="inline-flex min-h-9 items-center rounded-full border px-3 text-sm transition-colors peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                  {t(`feature.${f}`)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <TextareaField label={t('form.message')} rows={compact ? 3 : 4} error={errors.message?.message} {...register('message')} />
      <ConsentFields register={(name) => register(name)} consentError={errors.consent?.message} />
      <Button type="submit" size="lg" className="w-full sm:w-auto" loading={isSubmitting}>{t('form.send')}</Button>
    </form>
  );
}

// ── Slot picker ───────────────────────────────────────────────────────
interface SlotDay {
  date: string;
  slots: { starts_at: string; ends_at: string }[];
}

export function useDemoSlots(days = 14) {
  const from = istDateString(new Date());
  return useQuery({
    queryKey: ['demo-slots', from, days],
    queryFn: () => api<{ days: SlotDay[] }>(`/public/demo-slots?from=${from}&days=${days}`, { auth: false }),
    staleTime: 60_000,
    retry: 1,
  });
}

export function SlotPicker({ value, onChange, error }: { value?: string; onChange: (startsAt: string) => void; error?: string }) {
  const { t, i18n } = useTranslation();
  const query = useDemoSlots();
  const days = useMemo(() => query.data?.days ?? [], [query.data]);
  const firstWithSlots = days.find((d) => d.slots.length > 0)?.date;
  const [picked, setPicked] = useState<string | null>(null);
  const active = picked ?? firstWithSlots ?? days[0]?.date ?? null;
  const locale = i18n.language === 'ta' ? 'ta-IN' : 'en-IN';
  const dayLabel = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    return {
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(d),
      day: new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(d),
      month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(d),
    };
  };

  if (query.isPending) return <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-28" /></div>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const noSlotsAtAll = days.every((d) => d.slots.length === 0);
  if (noSlotsAtAll) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center">
        <CalendarX className="size-7 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{t('bookDemo.noSlots')}</p>
        <WhatsAppButton intent="demo_booking" size="sm" />
      </div>
    );
  }

  const slots = days.find((d) => d.date === active)?.slots ?? [];
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={t('bookDemo.chooseDate')} className="scroll-thin -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map((d) => {
          const label = dayLabel(d.date);
          const disabled = d.slots.length === 0;
          return (
            <button
              key={d.date}
              type="button"
              role="tab"
              aria-selected={d.date === active}
              disabled={disabled}
              onClick={() => setPicked(d.date)}
              className={cn(
                'flex min-w-[68px] shrink-0 flex-col items-center rounded-xl border px-2 py-2 text-xs transition-colors',
                d.date === active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:border-primary/50',
                disabled && 'cursor-not-allowed opacity-40',
              )}
            >
              <span className="font-medium">{label.weekday}</span>
              <span className="text-lg font-bold leading-tight">{label.day}</span>
              <span>{label.month}</span>
            </button>
          );
        })}
      </div>
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="size-3.5" aria-hidden />{t('bookDemo.timezoneNote')}</p>
        <AnimatePresence mode="wait">
          <motion.div key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} role="radiogroup" aria-label={t('bookDemo.chooseTime')} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.length === 0 && <p className="col-span-full text-sm text-muted-foreground">{t('bookDemo.noSlotsDay')}</p>}
            {slots.map((s) => (
              <button
                key={s.starts_at}
                type="button"
                role="radio"
                aria-checked={value === s.starts_at}
                onClick={() => onChange(s.starts_at)}
                className={cn('min-h-11 rounded-lg border text-sm font-semibold transition-all', value === s.starts_at ? 'border-primary bg-primary text-primary-foreground shadow-soft' : 'bg-card hover:border-primary/60')}
              >
                {formatTime(s.starts_at, i18n.language)}
              </button>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
      {error && <p role="alert" className="text-xs font-medium text-destructive">{t(error, { defaultValue: error })}</p>}
    </div>
  );
}

// ── Demo booking form ─────────────────────────────────────────────────
export interface BookedDemo {
  starts_at: string;
  ends_at: string;
  manage_token: string;
  mode: string;
}

export function DemoBookingForm({ onBooked }: { onBooked: (booking: BookedDemo) => void }) {
  const { t, i18n } = useTranslation();
  const meta = useFormMeta();
  const slots = useDemoSlots();
  const { register, handleSubmit, setError, setValue, watch, formState: { errors, isSubmitting } } = useForm<DemoBookingInput>({
    resolver: zodResolver(demoBookingSchema) as never,
    defaultValues: { mode: 'online', consent: false as never, whatsapp_opt_in: false, starts_at: '' },
  });
  const startsAt = watch('starts_at');

  const onSubmit = async (values: DemoBookingInput) => {
    try {
      const res = await api<{ booking: BookedDemo | null }>('/public/demo-bookings', { method: 'POST', auth: false, body: { ...values, language: i18n.language as Language, ...meta() } });
      trackEvent('book_demo');
      if (res.booking) onBooked(res.booking);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'slot_unavailable') {
        setValue('starts_at', '');
        void slots.refetch();
        setError('starts_at', { message: 'errors.slot_unavailable' });
        return;
      }
      if (!applyServerErrors(err, setError)) toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="relative space-y-6">
      <Honeypot register={() => register('website')} />
      <section aria-labelledby="slot-heading" className="space-y-3">
        <h2 id="slot-heading" className="flex items-center gap-2 text-base font-semibold"><span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">1</span>{t('bookDemo.step1')}</h2>
        <SlotPicker value={startsAt} onChange={(v) => setValue('starts_at', v, { shouldValidate: true })} error={errors.starts_at?.message} />
      </section>
      <section aria-labelledby="details-heading" className="space-y-4">
        <h2 id="details-heading" className="flex items-center gap-2 text-base font-semibold"><span className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">2</span>{t('bookDemo.step2')}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={t('form.contactPerson')} required autoComplete="name" error={errors.contact_name?.message} {...register('contact_name')} />
          <TextField label={t('form.companyName')} required autoComplete="organization" error={errors.company_name?.message} {...register('company_name')} />
          <TextField label={t('form.phone')} required type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" error={errors.phone?.message} {...register('phone')} />
          <TextField label={t('form.email')} required type="email" inputMode="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          <SelectField label={t('form.employees')} error={errors.employee_count?.message} defaultValue="" {...register('employee_count')}>
            <option value="">{t('form.select')}</option>
            {EMPLOYEE_RANGES.map((r) => <option key={r.key} value={r.value}>{r.key}</option>)}
          </SelectField>
          <SelectField label={t('bookDemo.mode')} error={errors.mode?.message} {...register('mode')}>
            {DEMO_MODES.map((m) => <option key={m} value={m}>{t(`demoMode.${m}`)}</option>)}
          </SelectField>
        </div>
        <TextareaField label={t('bookDemo.notes')} rows={3} error={errors.notes?.message} {...register('notes')} />
        <ConsentFields register={(name) => register(name)} consentError={errors.consent?.message} />
      </section>
      <div className="sticky bottom-0 -mx-4 border-t bg-background/90 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" size="lg" className="w-full sm:w-auto" loading={isSubmitting}>{t('bookDemo.confirm')}</Button>
      </div>
    </form>
  );
}

// ── Free trial registration ───────────────────────────────────────────
export function TrialForm({ onDone }: { onDone: (needsConfirmation: boolean, email: string) => void }) {
  const { t, i18n } = useTranslation();
  const meta = useFormMeta();
  const [params] = useSearchParams();
  const { data: plans = [] } = usePublicPlans();
  const selectable = plans.filter((p) => p.price_monthly !== null);
  const options = CompanyOptions();
  const requested = params.get('plan') ?? 'business';
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<TrialSignupInput>({
    resolver: zodResolver(trialSignupSchema) as never,
    defaultValues: { plan_key: requested, consent: false as never, whatsapp_opt_in: false },
  });

  const onSubmit = async (values: TrialSignupInput) => {
    try {
      const res = await api<{ needs_confirmation: boolean }>('/public/trial-signup', { method: 'POST', auth: false, body: { ...values, language: i18n.language as Language, ...meta() } });
      trackEvent('sign_up', { method: 'free_trial' });
      onDone(res.needs_confirmation, values.email);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'account_exists') {
        setError('email', { message: 'errors.account_exists' });
        return;
      }
      if (!applyServerErrors(err, setError)) toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="relative space-y-4">
      <Honeypot register={() => register('website')} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('form.companyName')} required autoComplete="organization" error={errors.company_name?.message} {...register('company_name')} />
        <TextField label={t('form.contactPerson')} required autoComplete="name" error={errors.contact_name?.message} {...register('contact_name')} />
        <TextField label={t('form.workEmail')} required type="email" inputMode="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <TextField label={t('form.phone')} required type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" error={errors.phone?.message} {...register('phone')} />
        <TextField label={t('auth.password')} required type="password" autoComplete="new-password" hint={t('auth.passwordHint')} error={errors.password?.message} className="sm:col-span-2" {...register('password')} />
        <SelectField label={t('form.city')} defaultValue="" error={errors.city?.message} {...register('city')}>
          <option value="">{t('form.select')}</option>
          {options.cities}
        </SelectField>
        <SelectField label={t('form.industry')} defaultValue="" error={errors.industry?.message} {...register('industry')}>
          <option value="">{t('form.select')}</option>
          {options.industries}
        </SelectField>
        <SelectField label={t('form.employees')} defaultValue="" error={errors.employee_count?.message} {...register('employee_count')}>
          <option value="">{t('form.select')}</option>
          {options.employees}
        </SelectField>
        <SelectField label={t('trial.plan')} error={errors.plan_key?.message} {...register('plan_key')}>
          {selectable.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </SelectField>
      </div>
      <div className="space-y-2 rounded-lg bg-muted/60 p-3">
        <CheckField
          label={<>{t('trial.agree')} <Link to="/terms" target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">{t('nav.terms')}</Link> · <Link to="/privacy" target="_blank" className="font-medium text-primary underline-offset-4 hover:underline">{t('nav.privacy')}</Link></>}
          error={errors.consent?.message}
          {...register('consent')}
        />
        <CheckField label={t('form.whatsappOptIn')} {...register('whatsapp_opt_in')} />
      </div>
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>{t('trial.submit')}</Button>
      <p className="text-center text-sm text-muted-foreground">{t('auth.haveAccount')} <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">{t('auth.signIn')}</Link></p>
    </form>
  );
}
