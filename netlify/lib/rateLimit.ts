import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Fixed-window rate limit backed by Postgres (serverless instances share no memory).
 * Fails open if the limiter itself errors, so an outage of the limiter never blocks real users.
 */
export async function checkRateLimit(db: SupabaseClient, key: string, max: number, windowSec: number): Promise<boolean> {
  const { data, error } = await db.rpc('check_rate_limit', { p_key: key, p_max: max, p_window_seconds: windowSec });
  if (error) {
    console.error('[rate-limit] check failed', error.message);
    return true;
  }
  return data === true;
}

/** Honeypot + minimum fill time. Bots get a fake success so they do not adapt. */
export function looksLikeSpam(input: { website?: string; elapsed_ms?: number }): boolean {
  if (input.website && input.website.trim().length > 0) return true;
  if (typeof input.elapsed_ms === 'number' && input.elapsed_ms >= 0 && input.elapsed_ms < 1500) return true;
  return false;
}
