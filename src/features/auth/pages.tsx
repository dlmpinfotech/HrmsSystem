import { useEffect, useRef, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Building2, CheckCircle2, ChevronRight, LockKeyhole, ShieldCheck, ShieldOff, UserRound, Users, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AnimatedLogoMark, Logo, Seo } from '@/components/shared/brand';
import { TextField } from '@/components/shared/Field';
import { FullPageLoader } from '@/components/shared/states';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/widgets';
import { personaHome, useAuth, type PersonaKind } from '@/features/auth/AuthProvider';
import { SocialLogin } from '@/features/auth/SocialLogin';
import { isSupabaseConfigured } from '@/lib/env';
import { sb } from '@/lib/supabase';
import { forgotPasswordSchema, loginSchema, resetPasswordSchema } from '@shared/schemas';
import type { z } from 'zod';

function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="grid-bg absolute inset-0" aria-hidden />
      <div className="pointer-events-none absolute -top-32 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" aria-hidden />
      <header className="container relative flex h-16 items-center justify-between">
        <Logo />
        <div className="flex items-center gap-1"><LanguageSwitcher compact /><ThemeToggle /></div>
      </header>
      <main id="main" className="relative flex flex-1 items-center justify-center px-4 py-10">
        <motion.div initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} className="w-full max-w-md">
          <Card className="border-border/70 bg-card/95 p-6 shadow-2xl backdrop-blur sm:p-8">
            <div className="mb-6 flex flex-col items-center space-y-1.5 text-center">
              <AnimatedLogoMark className="mb-3 size-12" />
              <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {!isSupabaseConfigured && <p role="alert" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{t('errors.notConfigured')}</p>}
            {children}
          </Card>
        </motion.div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.input<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (values: z.input<typeof loginSchema>) => {
    setError(null);
    try {
      const { error: authError } = await sb().auth.signInWithPassword({ email: values.email.trim().toLowerCase(), password: values.password });
      if (authError) setError(authError.message.toLowerCase().includes('confirm') ? 'auth.emailNotConfirmed' : 'auth.invalidCredentials');
      // On success the RedirectIfAuthed guard sends the user to their home area.
    } catch (err) {
      setError((err as Error).message.startsWith('errors.') ? (err as Error).message : 'errors.generic');
    }
  };

  return (
    <AuthFrame title={t('auth.welcomeBack')} subtitle={t('auth.signInSubtitle')}>
      <Seo title={t('auth.signIn')} noindex />
      {params.get('confirmed') && <p className="mb-4 flex items-center gap-2 rounded-lg bg-success/10 p-3 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden />{t('auth.confirmed')}</p>}
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <TextField label={t('form.email')} type="email" autoComplete="email" inputMode="email" error={errors.email?.message} {...register('email')} />
        <TextField label={t('auth.password')} type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        <div className="flex justify-end"><Link to="/forgot-password" className="text-sm font-medium text-primary hover:underline">{t('auth.forgot')}</Link></div>
        {error && <motion.p initial={{ x: -8 }} animate={{ x: [0, -6, 6, -3, 3, 0] }} role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive">{t(error, { defaultValue: error })}</motion.p>}
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}><LockKeyhole />{t('auth.signIn')}</Button>
      </form>
      <div className="mt-5">
        <SocialLogin onError={(message) => setError(message)} />
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">{t('auth.noAccount')} <Link to="/free-trial" className="font-medium text-primary hover:underline">{t('cta.startTrial')}</Link></p>
    </AuthFrame>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.input<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema) });
  const onSubmit = async ({ email }: z.input<typeof forgotPasswordSchema>) => {
    try {
      // Same response whether or not the account exists (no user enumeration).
      await sb().auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/reset-password` });
      setSent(true);
    } catch {
      toast.error(t('errors.generic'));
    }
  };
  return (
    <AuthFrame title={t('auth.forgotTitle')} subtitle={sent ? undefined : t('auth.forgotSubtitle')}>
      <Seo title={t('auth.forgotTitle')} noindex />
      {sent ? (
        <p role="status" className="rounded-lg bg-success/10 p-4 text-center text-sm">{t('auth.resetSent')}</p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <TextField label={t('form.email')} type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>{t('auth.sendReset')}</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/login" className="font-medium text-primary hover:underline">{t('auth.backToLogin')}</Link></p>
    </AuthFrame>
  );
}

/** Used for password recovery links and for accepting invitations (first password). */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { session, loading, homePath, refresh, mfaPending } = useAuth();
  const invite = params.get('invite') === '1';
  const tokenHash = params.get('token_hash');
  const otpType = params.get('type') === 'recovery' ? 'recovery' : 'invite';
  const [verifying, setVerifying] = useState(Boolean(tokenHash));
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.input<typeof resetPasswordSchema>>({ resolver: zodResolver(resetPasswordSchema) });

  // Invitation emails link to this site with a one-time token (never the database host).
  const verifyStarted = useRef(false);
  useEffect(() => {
    if (!tokenHash || verifyStarted.current) return; // the token works once — never verify twice
    verifyStarted.current = true;
    void sb()
      .auth.verifyOtp({ token_hash: tokenHash, type: otpType })
      .then(async ({ error }) => {
        window.history.replaceState(null, '', `${window.location.pathname}${invite ? '?invite=1' : ''}`);
        if (error) toast.error(t('auth.linkExpired'));
        else await refresh();
        setVerifying(false);
      });
  }, [tokenHash, otpType, invite, refresh, t]);

  useEffect(() => {
    if (!loading && !session && !verifying && !tokenHash) {
      const timer = setTimeout(() => toast.error(t('auth.linkExpired')), 1500);
      return () => clearTimeout(timer);
    }
  }, [loading, session, t]);

  const onSubmit = async ({ password }: z.input<typeof resetPasswordSchema>) => {
    const { error } = await sb().auth.updateUser({ password });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('auth.passwordUpdated'));
    await refresh();
    navigate(homePath === '/login' ? '/login' : homePath, { replace: true });
  };

  if (mfaPending && !verifying) return <Navigate to="/mfa" replace state={{ from: '/reset-password' }} />;
  return (
    <AuthFrame title={invite ? t('auth.inviteTitle') : t('auth.resetTitle')} subtitle={invite ? t('auth.inviteSubtitle') : t('auth.resetSubtitle')}>
      <Seo title={t('auth.resetTitle')} noindex />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <TextField label={t('auth.newPassword')} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} error={errors.password?.message} {...register('password')} />
        <TextField label={t('auth.confirmPassword')} type="password" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
        <Button type="submit" size="lg" className="w-full" loading={isSubmitting} disabled={!session}>{t('auth.savePassword')}</Button>
      </form>
    </AuthFrame>
  );
}

export function NoAccessPage() {
  const { t } = useTranslation();
  const { signOut, profile, loading, homePath } = useAuth();
  const navigate = useNavigate();
  if (loading) return <FullPageLoader />;
  if (homePath !== '/no-access') return <Navigate to={homePath} replace />;
  return (
    <AuthFrame title={t('auth.noAccessTitle')}>
      <div className="flex flex-col items-center gap-4 text-center">
        <ShieldOff className="size-10 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{profile && !profile.is_active ? t('auth.disabled') : t('auth.noAccessBody')}</p>
        <Button variant="outline" onClick={() => void signOut().then(() => navigate('/login'))}>{t('auth.signOut')}</Button>
      </div>
    </AuthFrame>
  );
}

const PERSONA_ICON: Record<PersonaKind, LucideIcon> = { staff: ShieldCheck, admin: Building2, hr: Users, member: UserRound, employee: BadgeCheck };

/** Shown after sign-in when one login has several account types (e.g. HR Manager and Employee). */
export function ChooseAccountPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loading, session, personas, persona, choosePersona, signOut, profile } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!session) return <Navigate to="/login" replace />;
  if (personas.length <= 1) return <Navigate to="/" replace />;
  return (
    <AuthFrame title={t('persona.title')} subtitle={t('persona.subtitle', { email: profile?.email ?? '' })}>
      <ul className="space-y-2.5">
        {personas.map((p) => {
          const Icon = PERSONA_ICON[p.kind];
          const current = persona?.key === p.key;
          return (
            <li key={p.key}>
              <button
                type="button"
                onClick={() => {
                  choosePersona(p.key);
                  navigate(personaHome(p), { replace: true });
                }}
                className="group flex min-h-[4.25rem] w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-all hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] sm:gap-4 sm:p-4"
              >
                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{t(`persona.kind.${p.kind}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.companyName ?? t('persona.platform')}
                    {p.employeeCode ? ` · ${p.employeeCode}` : ''}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t(`persona.desc.${p.kind}`)}</span>
                </span>
                {current ? <CheckCircle2 className="size-5 shrink-0 text-primary" aria-label={t('persona.current')} /> : <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-center text-xs text-muted-foreground">{t('persona.switchLater')}</p>
      <Button variant="ghost" className="mt-2 w-full" onClick={() => void signOut().then(() => navigate('/login'))}>{t('auth.signOut')}</Button>
    </AuthFrame>
  );
}
