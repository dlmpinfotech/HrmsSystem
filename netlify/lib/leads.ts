import type { SupabaseClient } from '@supabase/supabase-js';
import { nationalNumber, toE164Digits } from '../../shared/phone';
import { assertDb } from './http';

export interface PublicLeadData {
  company_name: string;
  contact_person: string;
  phone: string;
  email?: string;
  city?: string;
  industry?: string;
  employee_count?: number;
  existing_hrms?: string;
  interested_features?: string[];
  message?: string;
  source: string;
  consent: boolean;
  whatsapp_opt_in?: boolean;
  utm?: Record<string, string>;
}

const OPEN_STATUSES = ['new', 'contacted', 'qualified', 'demo_scheduled', 'demo_completed', 'trial', 'negotiation'];

/**
 * Creates a lead from a public form, or — when an open lead with the same phone/email
 * already exists — appends the new enquiry to it instead of creating a duplicate.
 */
export async function upsertPublicLead(
  db: SupabaseClient,
  data: PublicLeadData,
  ipHash: string,
): Promise<{ leadId: string; isNew: boolean; assignedTo: string | null }> {
  const phone10 = nationalNumber(data.phone);
  const email = data.email?.toLowerCase();

  const filters: string[] = [];
  if (phone10) filters.push(`phone_normalized.eq.${phone10}`);
  if (email) filters.push(`email_normalized.eq.${email.replace(/[,()]/g, '')}`);

  let existing: { id: string; assigned_to: string | null } | null = null;
  if (filters.length) {
    const { data: rows } = await db
      .from('leads')
      .select('id, assigned_to, status')
      .or(filters.join(','))
      .in('status', OPEN_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1);
    existing = rows?.[0] ?? null;
  }

  let campaignId: string | null = null;
  const utmCampaign = data.utm?.utm_campaign;
  if (utmCampaign) {
    const { data: campaign } = await db.from('marketing_campaigns').select('id').eq('utm_code', utmCampaign).maybeSingle();
    campaignId = campaign?.id ?? null;
  }

  let leadId: string;
  let isNew = false;
  if (existing) {
    leadId = existing.id;
    await db.from('lead_activities').insert({
      lead_id: leadId,
      type: 'system',
      body: `Repeat enquiry via ${data.source}${data.message ? `: ${data.message}` : ''}`,
      metadata: { source: data.source, duplicate_merge: true },
    });
    if (data.consent) await db.from('leads').update({ communication_consent: true }).eq('id', leadId);
  } else {
    const inserted = assertDb(
      await db
        .from('leads')
        .insert({
          company_name: data.company_name,
          contact_person: data.contact_person,
          phone: data.phone,
          email: email ?? null,
          city: data.city ?? null,
          industry: data.industry ?? null,
          employee_count: data.employee_count ?? null,
          existing_hrms: data.existing_hrms ?? null,
          interested_features: data.interested_features ?? [],
          source: data.source,
          campaign_id: campaignId,
          remarks: data.message ?? null,
          communication_consent: data.consent,
          utm: data.utm ?? {},
        })
        .select('id')
        .single(),
      'insert lead',
    );
    leadId = inserted.id;
    isNew = true;
  }

  // Consent audit trail: one row per channel the person agreed to.
  const e164 = toE164Digits(data.phone);
  const consents = [
    { lead_id: leadId, phone: e164, email: email ?? null, channel: 'phone', granted: data.consent, source: data.source, ip_hash: ipHash, wording: 'Agreed to be contacted about the enquiry' },
  ];
  if (email) consents.push({ ...consents[0], channel: 'email' });
  if (data.whatsapp_opt_in) {
    consents.push({ ...consents[0], channel: 'whatsapp', granted: true, wording: 'Opted in to WhatsApp updates' });
  }
  await db.from('communication_consents').insert(consents);

  return { leadId, isNew, assignedTo: existing?.assigned_to ?? null };
}
