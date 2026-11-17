import { useEffect, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { motion } from 'motion/react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LockKeyhole, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Logo, Seo } from '@/components/shared/brand';
import { TextField } from '@/components/shared/Field';
import { FullPageLoader } from '@/components/shared/states';
import { LanguageSwitcher, ThemeToggle } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
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
          <Card className="p-6 shadow-2xl sm:p-8">
            <div className="mb-6 space-y-1.5 text-center">
              <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
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
  const { session, loading, homePath, refresh } = useAuth();
  const invite = params.get('invite') === '1';
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.input<typeof resetPasswordSchema>>({ resolver: zodResolver(resetPasswordSchema) });

  useEffect(() => {
    if (!loading && !session) {
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
