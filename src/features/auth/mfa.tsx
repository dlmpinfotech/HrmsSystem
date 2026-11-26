import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TextField } from '@/components/shared/Field';
import { ErrorState, FullPageLoader, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, LanguageSwitcher, ThemeToggle } from '@/components/shared/widgets';
import { Logo, Seo } from '@/components/shared/brand';
import { useAuth } from '@/features/auth/AuthProvider';
import { sb } from '@/lib/supabase';

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="container flex h-16 items-center justify-between">
        <Logo />
        <div className="flex items-center gap-1"><LanguageSwitcher compact /><ThemeToggle /></div>
      </header>
      <main id="main" className="mx-auto w-full max-w-lg flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

function CodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return <TextField label={t('mfa.code')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} inputClassName="text-center text-2xl tracking-[0.4em]" />;
}

async function verifiedFactors() {
  const { data, error } = await sb().auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return data.totp.filter((f) => f.status === 'verified');
}

/** Second step after the password, for people who have turned two-step sign-in on. */
export function MfaChallengePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { loading, session, mfaPending, homePath, refresh, signOut } = useAuth();
  const [code, setCode] = useState('');
  const back = (location.state as { from?: string } | null)?.from;
  const verify = useMutation({
    mutationFn: async () => {
      const factor = (await verifiedFactors())[0];
      if (!factor) throw new Error('no_factor');
      const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await refresh();
      if (back) navigate(back, { replace: true });
    },
    onError: () => {
      setCode('');
      toast.error(t('mfa.wrongCode'));
    },
  });
  if (loading) return <FullPageLoader />;
  if (!session) return <Navigate to="/login" replace />;
  if (!mfaPending && !verify.isPending) return <Navigate to={back ?? homePath} replace />;
  return (
    <Frame>
      <Seo title={t('mfa.challengeTitle')} description={t('mfa.challengeHint')} noindex />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Smartphone className="size-6" aria-hidden /></span>
            <h1 className="text-2xl font-extrabold">{t('mfa.challengeTitle')}</h1>
            <p className="text-sm text-muted-foreground">{t('mfa.challengeHint')}</p>
          </div>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) verify.mutate(); }}>
            <CodeField value={code} onChange={setCode} />
            <Button type="submit" size="lg" className="w-full" loading={verify.isPending} disabled={code.length !== 6}>{t('mfa.verify')}</Button>
          </form>
          <p className="text-xs text-muted-foreground">{t('mfa.lostPhone')}</p>
          <Button variant="ghost" className="w-full" onClick={() => void signOut().then(() => navigate('/login'))}>{t('auth.signOut')}</Button>
        </CardContent>
      </Card>
    </Frame>
  );
}

/** Turn two-step sign-in on or off, and sign out other devices. */
export function SecurityPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { loading, session, mfaPending, homePath, signOut } = useAuth();
  const [setup, setSetup] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [turningOff, setTurningOff] = useState(false);
  const factors = useQuery({ queryKey: ['mfa-factors', session?.user.id], enabled: Boolean(session) && !mfaPending, queryFn: verifiedFactors });
  const on = (factors.data?.length ?? 0) > 0;

  const start = useMutation({
    mutationFn: async () => {
      // Clear half-finished set-ups, which would otherwise block a new one with the same name.
      const { data: all } = await sb().auth.mfa.listFactors();
      for (const f of all?.all ?? []) if (f.status !== 'verified') await sb().auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' });
      if (error) throw new Error(error.message);
      return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    },
    onSuccess: setSetup,
    onError: () => toast.error(t('mfa.setupFailed')),
  });
  const confirm = useMutation({
    mutationFn: async () => {
      const { error } = await sb().auth.mfa.challengeAndVerify({ factorId: setup!.id, code });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      setSetup(null);
      setCode('');
      toast.success(t('mfa.turnedOn'));
      await factors.refetch();
    },
    onError: () => {
      setCode('');
      toast.error(t('mfa.wrongCode'));
    },
  });
  const turnOff = useMutation({
    mutationFn: async () => {
      for (const f of factors.data ?? []) {
        const { error } = await sb().auth.mfa.unenroll({ factorId: f.id });
        if (error) throw new Error(error.message);
      }
      await sb().auth.refreshSession();
    },
    onSuccess: async () => {
      setTurningOff(false);
      toast.success(t('mfa.turnedOff'));
      await factors.refetch();
    },
    onError: () => toast.error(t('errors.generic')),
  });
  const others = useMutation({
    mutationFn: async () => {
      const { error } = await sb().auth.signOut({ scope: 'others' });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => toast.success(t('mfa.othersSignedOut')),
    onError: () => toast.error(t('errors.generic')),
  });

  if (loading) return <FullPageLoader />;
  if (!session) return <Navigate to="/login" replace state={{ from: '/security' }} />;
  if (mfaPending) return <Navigate to="/mfa" replace state={{ from: '/security' }} />;
  return (
    <Frame>
      <Seo title={t('mfa.title')} description={t('mfa.subtitle')} noindex />
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={homePath}><ArrowLeft />{t('mfa.back')}</Link></Button>
      <h1 className="text-2xl font-extrabold">{t('mfa.title')}</h1>
      <p className="mb-5 text-sm text-muted-foreground">{t('mfa.subtitle')}</p>
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle>{t('mfa.twoStep')}</CardTitle>
            {factors.data && <Badge tone={on ? 'success' : 'neutral'}>{on ? t('mfa.on') : t('mfa.off')}</Badge>}
          </CardHeader>
          <CardContent className="space-y-4">
            {factors.isPending ? <ListSkeleton rows={2} /> : factors.isError ? <ErrorState error={factors.error} onRetry={() => void factors.refetch()} /> : on ? (
              <>
                <p className="text-sm text-muted-foreground">{t('mfa.onBody')}</p>
                <Button variant="outline" onClick={() => setTurningOff(true)}><ShieldOff />{t('mfa.turnOff')}</Button>
              </>
            ) : setup ? (
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) confirm.mutate(); }}>
                <p className="text-sm">{t('mfa.scan')}</p>
                <img src={setup.qr} alt={t('mfa.qrAlt')} className="mx-auto size-48 rounded-lg bg-white p-2" />
                <p className="text-xs text-muted-foreground">{t('mfa.manual')}</p>
                <code className="block break-all rounded-lg bg-muted p-2 text-center text-sm">{setup.secret}</code>
                <CodeField value={code} onChange={setCode} />
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="outline" onClick={() => { void sb().auth.mfa.unenroll({ factorId: setup.id }); setSetup(null); setCode(''); }}>{t('common.cancel')}</Button>
                  <Button type="submit" loading={confirm.isPending} disabled={code.length !== 6}>{t('mfa.verify')}</Button>
                </div>
              </form>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t('mfa.offBody')}</p>
                <Button loading={start.isPending} onClick={() => start.mutate()}><ShieldCheck />{t('mfa.turnOn')}</Button>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('mfa.devices')}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">{t('mfa.devicesBody')}</p>
            <Button variant="outline" className="self-start" loading={others.isPending} onClick={() => others.mutate()}>{t('mfa.signOutOthers')}</Button>
            <Button variant="ghost" className="self-start" onClick={() => void signOut().then(() => navigate('/login'))}>{t('auth.signOut')}</Button>
          </CardContent>
        </Card>
      </div>
      <ConfirmDialog open={turningOff} onOpenChange={setTurningOff} title={t('mfa.turnOff')} description={t('mfa.turnOffConfirm')} confirmLabel={t('mfa.turnOff')} destructive loading={turnOff.isPending} onConfirm={() => turnOff.mutate()} />
    </Frame>
  );
}
