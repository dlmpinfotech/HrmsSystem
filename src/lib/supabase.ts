import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from './env';

export const AUTH_STORAGE_KEY = 'hrms-sales-auth';

/**
 * Browser client using the public anon key. All access is constrained by
 * Row Level Security; the service-role key exists only in Netlify Functions.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_STORAGE_KEY },
    })
  : null;

export class NotConfiguredError extends Error {
  constructor() {
    super('errors.notConfigured');
  }
}

/** Returns the client or throws a translatable error when env vars are missing. */
export function sb(): SupabaseClient {
  if (!supabase) throw new NotConfiguredError();
  return supabase;
}

/** Unwraps a PostgREST response, turning errors into exceptions for TanStack Query. */
export function unwrap<T>(result: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (result.error) {
    const err = new Error(result.error.message) as Error & { code?: string };
    err.code = result.error.code;
    throw err;
  }
  return result.data as T;
}

export function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path || !supabase) return null;
  return supabase.storage.from('branding').getPublicUrl(path).data.publicUrl;
}
