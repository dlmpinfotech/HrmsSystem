import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from './http';

let admin: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS, so it must only ever be used inside
 * Netlify Functions after the caller has been authenticated and authorised.
 */
export function getAdminClient(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(503, 'not_configured', 'The server is not configured yet (missing Supabase credentials).');
  }
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Anonymous client used server-side for auth.signUp (sends Supabase's confirmation email). */
export function getAnonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new HttpError(503, 'not_configured', 'The server is not configured yet (missing Supabase credentials).');
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
