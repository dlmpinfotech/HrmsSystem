import type { Config } from '@netlify/functions';
import { publicLeadSchema } from '../../shared/schemas';
import { defineHandler } from '../lib/http';
import { upsertPublicLead } from '../lib/leads';
import { notify } from '../lib/notifications';
import { looksLikeSpam } from '../lib/rateLimit';

/** POST /api/public/leads — contact, enquiry and pricing forms on the public website. */
export default defineHandler(
  { name: 'public-lead', methods: ['POST'], schema: publicLeadSchema, rateLimit: { max: 5, windowSec: 600 } },
  async ({ db, body, ipHash, siteUrl }) => {
    if (looksLikeSpam(body)) return { ok: true };

    const { leadId, isNew } = await upsertPublicLead(
      db,
      {
        company_name: body.company_name,
        contact_person: body.contact_person,
        phone: body.phone,
        email: body.email,
        city: body.city,
        industry: body.industry,
        employee_count: body.employee_count,
        existing_hrms: body.existing_hrms,
        interested_features: body.interested_features,
        message: body.message,
        source: body.source,
        consent: body.consent,
        whatsapp_opt_in: body.whatsapp_opt_in,
        utm: body.utm,
      },
      ipHash,
    );

    if (isNew && body.email) {
      await notify(db, {
        key: 'lead_acknowledgement',
        channels: ['email'],
        email: body.email,
        language: body.language,
        vars: { name: body.contact_person, demo_url: `${siteUrl}/book-demo` },
        leadId,
        dedupeKey: `lead-ack:${leadId}`,
      });
    }
    return { ok: true };
  },
);

export const config: Config = { path: '/api/public/leads' };
