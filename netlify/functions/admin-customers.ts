import type { Config } from '@netlify/functions';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminCustomerActionSchema } from '../../shared/schemas';
import { formatIst } from '../../shared/slots';
import { defineHandler, HttpError, assertDb } from '../lib/http';
import { hasWhatsAppConsent, notify } from '../lib/notifications';
import { audit } from '../lib/settings';
import { can } from '../../shared/permissions';

async function primaryContact(db: SupabaseClient, companyId: string) {
  const { data } = await db
    .from('customer_contacts')
    .select('name, email, phone')
    .eq('company_id', companyId)
    .order('is_primary', { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

/** POST /api/admin/customers — convert a lead, activate/suspend a tenant, extend a trial. */
export default defineHandler(
  { name: 'admin-customers', methods: ['POST'], auth: 'user', schema: adminCustomerActionSchema },
  async ({ db, body, user, roles, siteUrl }) => {
    if (body.action === 'convert') {
      if (!can(roles, 'leads.write')) throw new HttpError(403, 'forbidden');
      const { data: lead } = await db.from('leads').select('id, assigned_to, converted_company_id').eq('id', body.lead_id).maybeSingle();
      if (!lead) throw new HttpError(404, 'lead_not_found');
      if (!can(roles, 'customers.manage') && lead.assigned_to && lead.assigned_to !== user!.id) throw new HttpError(403, 'forbidden');
      if (lead.converted_company_id) throw new HttpError(409, 'already_converted', 'This lead is already a customer.');

      const { data: companyId, error } = await db.rpc('convert_lead_to_customer', {
        p_lead: body.lead_id,
        p_plan_key: body.plan_key,
        p_actor: user!.id,
      });
      if (error || !companyId) {
        console.error('[admin-customers] convert failed', error?.message);
        throw new HttpError(500, 'conversion_failed', 'Could not convert this lead.');
      }

      const [contact, { data: company }, { data: sub }] = await Promise.all([
        primaryContact(db, companyId),
        db.from('companies').select('name, default_language').eq('id', companyId).single(),
        db.from('subscriptions').select('trial_end, plans(name)').eq('company_id', companyId).maybeSingle(),
      ]);
      const plan = sub?.plans as { name?: string } | { name?: string }[] | null | undefined;
      if (contact) {
        await notify(db, {
          key: 'trial_activation',
          email: contact.email,
          phone: contact.phone,
          whatsappConsent: await hasWhatsAppConsent(db, contact.phone),
          language: company?.default_language ?? 'en',
          vars: {
            name: contact.name,
            company: company?.name ?? '',
            plan: (Array.isArray(plan) ? plan[0]?.name : plan?.name) ?? '',
            trial_end: sub?.trial_end ? formatIst(sub.trial_end).date : '',
            portal_url: `${siteUrl}/login`,
          },
          companyId,
          dedupeKey: `trial-activation:${companyId}`,
        });
      }
      await audit(db, { actor: user!.id, action: 'lead_converted', entity: 'companies', entityId: companyId, companyId, metadata: { lead_id: body.lead_id } });
      return { ok: true, company_id: companyId };
    }

    if (!can(roles, 'customers.manage')) throw new HttpError(403, 'forbidden');
    const { data: company } = await db.from('companies').select('id, status').eq('id', body.company_id).maybeSingle();
    if (!company) throw new HttpError(404, 'company_not_found');

    if (body.action === 'activate') {
      assertDb(await db.from('companies').update({ status: 'active' }).eq('id', company.id).select('id').single(), 'activate company');
      await db
        .from('customers')
        .update({ activated_at: new Date().toISOString(), suspended_at: null, suspension_reason: null })
        .eq('company_id', company.id);
      await audit(db, { actor: user!.id, action: 'company_activated', entity: 'companies', entityId: company.id, companyId: company.id });
      return { ok: true };
    }

    if (body.action === 'suspend') {
      assertDb(await db.from('companies').update({ status: 'suspended' }).eq('id', company.id).select('id').single(), 'suspend company');
      await db.from('customers').update({ suspended_at: new Date().toISOString(), suspension_reason: body.reason }).eq('company_id', company.id);
      await audit(db, { actor: user!.id, action: 'company_suspended', entity: 'companies', entityId: company.id, companyId: company.id, metadata: { reason: body.reason } });
      return { ok: true };
    }

    // extend_trial
    const { data: sub } = await db
      .from('subscriptions')
      .select('id, status, trial_end')
      .eq('company_id', company.id)
      .in('status', ['trialing', 'expired'])
      .order('created_at', { ascending: false })
      .limit(1);
    const current = sub?.[0];
    if (!current) throw new HttpError(409, 'no_trial', 'This customer has no trial to extend.');
    const base = Math.max(Date.now(), current.trial_end ? new Date(current.trial_end).getTime() : 0);
    const trialEnd = new Date(base + body.days * 86_400_000).toISOString();
    assertDb(
      await db.from('subscriptions').update({ status: 'trialing', trial_end: trialEnd, trial_reminder_at: null }).eq('id', current.id).select('id').single(),
      'extend trial',
    );
    if (company.status === 'suspended') {
      await db.from('companies').update({ status: 'trial' }).eq('id', company.id);
      await db.from('customers').update({ suspended_at: null, suspension_reason: null }).eq('company_id', company.id);
    }
    await audit(db, { actor: user!.id, action: 'trial_extended', entity: 'subscriptions', entityId: current.id, companyId: company.id, metadata: { days: body.days } });
    return { ok: true, trial_end: trialEnd };
  },
);

export const config: Config = { path: '/api/admin/customers' };
