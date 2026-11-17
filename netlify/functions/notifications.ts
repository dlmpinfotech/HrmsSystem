import type { Config } from '@netlify/functions';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { NOTIFICATION_KEYS } from '../../shared/constants';
import { emailSchema } from '../../shared/schemas';
import { defineHandler, HttpError } from '../lib/http';
import { authenticate } from '../lib/auth';
import { emailConfigured, emailProvider } from '../lib/email';
import { runScheduledJobs } from '../lib/jobs';
import { notify, retryNotification } from '../lib/notifications';
import { getSetting } from '../lib/settings';
import { waConfigStatus } from '../lib/whatsapp';
import { can } from '../../shared/permissions';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('retry'), log_id: z.string().uuid() }),
  z.object({ action: z.literal('test_email'), key: z.enum(NOTIFICATION_KEYS), to: emailSchema, language: z.enum(['en', 'ta']).default('en') }),
  z.object({ action: z.literal('run_jobs') }),
]);

/**
 * GET  /api/notifications — delivery channel status for the admin UI
 * POST /api/notifications — retry a failed notification, send a test email, or run the
 *                           scheduled jobs on demand (Super Admin, or CRON_SECRET header).
 */
export default defineHandler({ name: 'notifications', methods: ['GET', 'POST'], rateLimit: { max: 60, windowSec: 300 } }, async ({ db, req, body, siteUrl }) => {
  // External cron services may trigger the jobs with a shared secret instead of a user session.
  const cronSecret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') ?? '';
  if (req.method === 'POST' && cronSecret && given.length === cronSecret.length && timingSafeEqual(Buffer.from(given), Buffer.from(cronSecret))) {
    return { ok: true, summary: await runScheduledJobs(db, siteUrl) };
  }

  const user = await authenticate(req, db);
  if (!can(user.roles, 'notifications.view')) throw new HttpError(403, 'forbidden');

  if (req.method === 'GET') {
    const [emailSettings, cloud] = await Promise.all([
      getSetting(db, 'email', { enabled: true }),
      getSetting(db, 'whatsapp_cloud', { enabled: false }),
    ]);
    return {
      email: { enabled: emailSettings.enabled, configured: emailConfigured(), provider: emailProvider() },
      whatsapp: { enabled: cloud.enabled, configured: waConfigStatus().can_send },
    };
  }

  if (!can(user.roles, 'notifications.manage')) throw new HttpError(403, 'forbidden');
  const input = actionSchema.parse(body);

  if (input.action === 'retry') {
    const result = await retryNotification(db, input.log_id);
    if (!result) throw new HttpError(404, 'log_not_found');
    return { ok: result.status === 'sent', result };
  }

  if (input.action === 'run_jobs') {
    if (!user.roles.includes('super_admin')) throw new HttpError(403, 'forbidden');
    return { ok: true, summary: await runScheduledJobs(db, siteUrl) };
  }

  const sample = {
    name: user.fullName || 'Test User', company: 'Sample Company Pvt Ltd', date: 'Monday, 1 Jan 2030', time: '10:30 AM',
    mode: 'online', meeting_line: 'Link: https://meet.example.com/demo', manage_url: `${siteUrl}/demo/manage/sample`,
    demo_url: `${siteUrl}/book-demo`, when: 'in about an hour', plan: 'Business', trial_end: '15 Jan 2030',
    portal_url: `${siteUrl}/portal`, renewal_date: '1 Feb 2030', amount: '₹2,499', invoice_number: 'INV-203001-00001',
    ticket_number: 'TKT-000001', ticket_subject: 'Sample ticket', status: 'in progress', message: 'This is a test message.',
    contact: 'Sample Contact', phone: '+91 98765 43210', due: '1 Jan 2030, 10:30 AM', lead_url: `${siteUrl}/admin/leads`,
  };
  const [result] = await notify(db, { key: input.key, channels: ['email'], email: input.to, language: input.language, vars: sample });
  return { ok: result?.status === 'sent', result: result ?? null };
});

export const config: Config = { path: '/api/notifications' };
