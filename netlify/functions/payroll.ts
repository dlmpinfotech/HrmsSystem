import type { Config } from '@netlify/functions';
import { payrollEmailSchema } from '../../shared/schemas';
import { defineHandler, HttpError } from '../lib/http';
import { emailConfigured, sendEmail, viaName } from '../lib/email';
import { loadInviter } from '../lib/invite';
import { payslipEmail, type PayslipRow } from '../lib/payslipEmail';
import { audit } from '../lib/settings';

const MAX_PER_CALL = 300;

/**
 * POST /api/payroll — emails finalized payslips (all in the run, or the selected employees)
 * through the app's SMTP, from "<HR name> (via <company>)". Company Admin / HR Manager only.
 */
export default defineHandler(
  { name: 'payroll', methods: ['POST'], auth: 'user', schema: payrollEmailSchema, rateLimit: { max: 20, windowSec: 600 } },
  async ({ db, body, user, siteUrl }) => {
    const { data: run } = await db.from('payroll_runs').select('id, company_id, period, status').eq('id', body.run_id).maybeSingle();
    if (!run) throw new HttpError(404, 'payroll_not_found');
    const { data: member } = await db.from('company_memberships').select('role').eq('company_id', run.company_id).eq('user_id', user!.id).maybeSingle();
    if (member?.role !== 'customer_admin' && member?.role !== 'hr_manager') throw new HttpError(403, 'forbidden');
    if (run.status !== 'finalized') throw new HttpError(409, 'payroll_not_finalized', 'Finalize the month before emailing payslips.');
    if (!emailConfigured()) throw new HttpError(503, 'email_not_configured', 'Email (SMTP) is not set up on the server.');

    let q = db.from('payslips').select('*').eq('run_id', run.id).order('employee_code');
    if (body.employee_ids?.length) q = q.in('employee_id', body.employee_ids);
    const { data: slips, error } = await q;
    if (error) throw new HttpError(500, 'db_error');
    if (!slips?.length) throw new HttpError(404, 'no_payslips');
    if (slips.length > MAX_PER_CALL) throw new HttpError(413, 'too_many', `Send at most ${MAX_PER_CALL} at a time.`);

    const [{ data: company }, { data: emps }, { data: branding }, inviter] = await Promise.all([
      db.from('companies').select('name, default_language').eq('id', run.company_id).maybeSingle(),
      db.from('employees').select('id, email').in('id', slips.map((s) => s.employee_id)),
      db.from('company_branding').select('colors').eq('company_id', run.company_id).maybeSingle(),
      loadInviter(db, user!.id),
    ]);
    const companyName = company?.name ?? 'Payroll';
    const lang = company?.default_language === 'ta' ? 'ta' : 'en';
    const emailOf = new Map((emps ?? []).map((e) => [e.id, e.email as string | null]));

    let sent = 0;
    const failed: { employee_id: string; reason: string }[] = [];
    for (const slip of slips) {
      const to = emailOf.get(slip.employee_id);
      if (!to) {
        failed.push({ employee_id: slip.employee_id, reason: 'no_email' });
        await db.from('payslips').update({ email_error: 'no_email' }).eq('id', slip.id);
        continue;
      }
      const mail = payslipEmail(slip as PayslipRow, { companyName, lang, portalUrl: `${siteUrl}/portal/payslips`, accent: (branding?.colors as { primary?: string } | null)?.primary });
      try {
        await sendEmail({ to, subject: mail.subject, text: mail.text, html: mail.html, fromName: viaName(inviter.name, companyName), replyTo: inviter.email ?? undefined });
        await db.from('payslips').update({ emailed_at: new Date().toISOString(), email_error: null }).eq('id', slip.id);
        sent++;
      } catch (err) {
        const reason = ((err as Error).message ?? 'send_failed').slice(0, 200);
        console.error('[payroll] payslip email failed', reason);
        await db.from('payslips').update({ email_error: reason }).eq('id', slip.id);
        failed.push({ employee_id: slip.employee_id, reason: 'send_failed' });
      }
    }
    await audit(db, { actor: user!.id, action: 'payslips_emailed', entity: 'payroll_runs', entityId: run.id, companyId: run.company_id, metadata: { sent, failed: failed.length } });
    return { ok: true, sent, failed };
  },
);

export const config: Config = { path: '/api/payroll' };
