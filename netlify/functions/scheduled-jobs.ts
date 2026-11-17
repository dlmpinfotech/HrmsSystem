import type { Config } from '@netlify/functions';
import { runScheduledJobs } from '../lib/jobs';
import { getAdminClient } from '../lib/supabase';

/** Hourly Netlify Scheduled Function: reminders, subscription lifecycle and notification retries. */
export default async () => {
  try {
    const site = (process.env.URL ?? '').replace(/\/$/, '');
    const summary = await runScheduledJobs(getAdminClient(), site);
    console.log('[scheduled-jobs]', JSON.stringify(summary));
  } catch (err) {
    console.error('[scheduled-jobs] failed', err);
  }
  return new Response(null, { status: 204 });
};

export const config: Config = { schedule: '@hourly' };
