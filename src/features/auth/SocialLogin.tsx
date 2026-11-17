import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';
import { sb } from '@/lib/supabase';

export type SocialProvider = 'google' | 'azure';

/** Which external sign-in providers are switched on in Supabase (public endpoint, no secrets). */
export function useEnabledProviders() {
  return useQuery({
    queryKey: ['auth-providers'],
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<Record<SocialProvider, boolean>> => {
      const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey } });
      if (!res.ok) return { google: false, azure: false };
      const data = (await res.json()) as { external?: Record<string, boolean> };
      return { google: Boolean(data.external?.google), azure: Boolean(data.external?.azure) };
    },
  });
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.28 6.62l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
      <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
      <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
      <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
    </svg>
  );
}

/** Reads an OAuth error Supabase appended to the redirect URL (query or hash). */
function oauthErrorFromUrl(): string | null {
  const read = (s: string) => new URLSearchParams(s.replace(/^[#?]/, ''));
  const q = read(window.location.search);
  const h = read(window.location.hash);
  return q.get('error_description') ?? h.get('error_description') ?? q.get('error') ?? h.get('error');
}

/**
 * "Continue with Google / Microsoft". The person must already be invited to (or own) a company
 * with the same email — a brand-new social login with no invitation lands on "No access yet".
 */
export function SocialLogin({ onError }: { onError: (message: string) => void }) {
  const { t } = useTranslation();
  const providers = useEnabledProviders();
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  useEffect(() => {
    const err = oauthErrorFromUrl();
    if (err) onError(t('auth.oauthFailed', { reason: err.replace(/\+/g, ' ') }));
    // Only on first render: the error belongs to the redirect we just came back from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (provider: SocialProvider) => {
    const name = provider === 'google' ? 'Google' : 'Microsoft';
    if (providers.data && !providers.data[provider]) {
      onError(t('auth.providerNotEnabled', { provider: name }));
      return;
    }
    setBusy(provider);
    const { error } = await sb().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/login`,
        // Microsoft needs the email scope to return the address used to match invitations.
        scopes: provider === 'azure' ? 'openid email profile' : undefined,
        // Always show the account picker so people with several accounts choose the right one.
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) {
      setBusy(null);
      onError(error.message.toLowerCase().includes('not enabled') ? t('auth.providerNotEnabled', { provider: name }) : t('auth.oauthFailed', { reason: error.message }));
    }
    // On success the browser leaves for the provider's sign-in page.
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t('auth.or')}
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="lg" className="w-full" aria-label={t('auth.continueGoogle')} loading={busy === 'google'} disabled={Boolean(busy)} onClick={() => void start('google')}>
          {busy !== 'google' && <GoogleIcon />}
          Google
        </Button>
        <Button type="button" variant="outline" size="lg" className="w-full" aria-label={t('auth.continueMicrosoft')} loading={busy === 'azure'} disabled={Boolean(busy)} onClick={() => void start('azure')}>
          {busy !== 'azure' && <MicrosoftIcon />}
          Microsoft
        </Button>
      </div>
    </div>
  );
}
