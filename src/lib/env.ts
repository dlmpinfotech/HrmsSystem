/** Public, browser-safe configuration. Secrets never belong here. */
export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '',
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '',
  brandName: (import.meta.env.VITE_BRAND_NAME as string | undefined) || 'HRMS Cloud',
  whatsappNumber: (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined) ?? '',
  gaMeasurementId: (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) ?? '',
  siteUrl: ((import.meta.env.VITE_SITE_URL as string | undefined) ?? '').replace(/\/$/, ''),
};

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
