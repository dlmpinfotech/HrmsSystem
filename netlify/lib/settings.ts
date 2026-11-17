import type { SupabaseClient } from '@supabase/supabase-js';

export interface BrandSettings {
  name: string;
  support_email?: string;
  support_phone?: string;
  address?: string;
  hrms_login_url?: string;
}

export interface DemoSettings {
  min_lead_hours: number;
  max_days_ahead: number;
  default_meeting_url?: string;
}

export async function getSetting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from('app_settings').select('value').eq('key', key).maybeSingle();
  if (!data || data.value === null || data.value === undefined) return fallback;
  if (typeof fallback === 'object' && fallback !== null && !Array.isArray(fallback)) {
    return { ...fallback, ...(data.value as object) } as T;
  }
  return data.value as T;
}

export const getBrand = (db: SupabaseClient) => getSetting<BrandSettings>(db, 'brand', { name: 'HRMS Cloud' });

export const getDemoSettings = (db: SupabaseClient) =>
  getSetting<DemoSettings>(db, 'demo', { min_lead_hours: 4, max_days_ahead: 21, default_meeting_url: '' });

export async function audit(
  db: SupabaseClient,
  entry: { actor?: string | null; action: string; entity: string; entityId?: string | null; companyId?: string | null; metadata?: Record<string, unknown>; ipHash?: string },
): Promise<void> {
  const { error } = await db.from('audit_logs').insert({
    actor_id: entry.actor ?? null,
    action: entry.action,
    entity_type: entry.entity,
    entity_id: entry.entityId ?? null,
    company_id: entry.companyId ?? null,
    metadata: entry.metadata ?? {},
    ip_hash: entry.ipHash ?? null,
  });
  if (error) console.error('[audit] failed to write', error.message);
}
