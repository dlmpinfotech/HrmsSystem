import { useQuery } from '@tanstack/react-query';
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

export interface Testimonial {
  quote: string;
  quote_ta?: string;
  name: string;
  role: string;
  company: string;
}

export interface PublicConfig {
  brand: { name: string; support_email: string; support_phone: string; address: string; hrms_login_url: string };
  whatsapp: { number: string; click_to_chat_enabled: boolean };
  demo: { min_lead_hours: number; max_days_ahead: number };
  analytics: { ga4_measurement_id: string };
  testimonials: Testimonial[];
}

export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  brand: { name: env.brandName, support_email: '', support_phone: '', address: 'Tirunelveli, Tamil Nadu, India', hrms_login_url: '' },
  whatsapp: { number: env.whatsappNumber, click_to_chat_enabled: true },
  demo: { min_lead_hours: 4, max_days_ahead: 21 },
  analytics: { ga4_measurement_id: env.gaMeasurementId },
  testimonials: [],
};

async function fetchPublicConfig(): Promise<PublicConfig> {
  if (!supabase) return DEFAULT_PUBLIC_CONFIG;
  const { data, error } = await supabase.from('app_settings').select('key, value').eq('is_public', true);
  if (error || !data) return DEFAULT_PUBLIC_CONFIG;
  const map = Object.fromEntries(data.map((r) => [r.key as string, r.value as unknown]));
  const merged: PublicConfig = {
    brand: { ...DEFAULT_PUBLIC_CONFIG.brand, ...((map.brand as object) ?? {}) },
    whatsapp: { ...DEFAULT_PUBLIC_CONFIG.whatsapp, ...((map.whatsapp as object) ?? {}) },
    demo: { ...DEFAULT_PUBLIC_CONFIG.demo, ...((map.demo as object) ?? {}) },
    analytics: { ...DEFAULT_PUBLIC_CONFIG.analytics, ...((map.analytics as object) ?? {}) },
    testimonials: Array.isArray(map.testimonials) ? (map.testimonials as Testimonial[]) : [],
  };
  // Environment values act as fallbacks when a setting is left blank in the database.
  if (!merged.whatsapp.number) merged.whatsapp.number = env.whatsappNumber;
  if (!merged.analytics.ga4_measurement_id) merged.analytics.ga4_measurement_id = env.gaMeasurementId;
  if (!merged.brand.name) merged.brand.name = env.brandName;
  return merged;
}

/** Public site settings (brand, WhatsApp number, GA id). Never blocks rendering. */
export function usePublicConfig(): PublicConfig {
  const { data } = useQuery({ queryKey: ['public-config'], queryFn: fetchPublicConfig, staleTime: 5 * 60_000 });
  return data ?? DEFAULT_PUBLIC_CONFIG;
}
