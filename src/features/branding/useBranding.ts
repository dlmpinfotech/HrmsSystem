import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { normalizeBranding, type Branding } from '@shared/branding';
import { setLanguage, storedLanguage } from '@/i18n';
import { sb } from '@/lib/supabase';
import { useTheme } from './ThemeProvider';

export function brandingKey(companyId: string | undefined) {
  return ['branding', companyId] as const;
}

export function useCompanyBranding(companyId: string | undefined, fallbackName?: string) {
  return useQuery({
    queryKey: brandingKey(companyId),
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Branding> => {
      const { data, error } = await sb().from('company_branding').select('*').eq('company_id', companyId!).maybeSingle();
      if (error) throw error;
      return normalizeBranding(data as Partial<Record<keyof Branding, unknown>> | null, fallbackName);
    },
  });
}

/**
 * Applies the signed-in company's branding to the whole app (CSS variables, theme,
 * favicon) and, unless the user picked a language themselves, its default language.
 */
export function useApplyCompanyBranding(companyId: string | undefined, fallbackName: string | undefined, userLanguage: string | null | undefined) {
  const { setBranding } = useTheme();
  const query = useCompanyBranding(companyId, fallbackName);

  useEffect(() => {
    if (query.data) setBranding(query.data);
  }, [query.data, setBranding]);

  // Leaving the portal restores the platform's default look.
  useEffect(() => () => setBranding(null), [setBranding]);

  useEffect(() => {
    if (storedLanguage()) return;
    const lang = userLanguage === 'en' || userLanguage === 'ta' ? userLanguage : query.data?.default_language;
    if (lang) void setLanguage(lang, false);
  }, [query.data?.default_language, userLanguage]);

  return query;
}
