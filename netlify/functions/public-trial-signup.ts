import type { Config } from '@netlify/functions';
import { trialSignupSchema } from '../../shared/schemas';
import { toE164Digits } from '../../shared/phone';
import { formatIst } from '../../shared/slots';
import { defineHandler, HttpError } from '../lib/http';
import { notify } from '../lib/notifications';
import { looksLikeSpam } from '../lib/rateLimit';
import { audit } from '../lib/settings';
import { getAnonClient } from '../lib/supabase';

/**
 * POST /api/public/trial-signup — self-service registration.
 * Creates the auth user (Supabase sends the email-confirmation message), then
 * provisions the tenant, membership, trial subscription and onboarding checklist
 * in one database transaction (public.provision_trial).
 */
export default defineHandler(
  { name: 'public-trial-signup', methods: ['POST'], schema: trialSignupSchema, rateLimit: { max: 3, windowSec: 3600 } },
  async ({ db, body, ipHash, siteUrl }) => {
    if (looksLikeSpam(body)) return { ok: true, needs_confirmation: true };

    const { data: existing } = await db.from('profiles').select('id').eq('email', body.email).maybeSingle();
    if (existing) throw new HttpError(409, 'account_exists', 'An account with this email already exists. Please sign in.');

    const { data: signUp, error: signUpError } = await getAnonClient().auth.signUp({
      email: body.email,
      password: body.password,
      options: {
        data: { full_name: body.contact_name, phone: body.phone, language: body.language },
        emailRedirectTo: `${siteUrl}/login?confirmed=1`,
      },
    });
    if (signUpError || !signUp.user) {
      console.error('[trial-signup] signUp failed', signUpError?.message);
      if (signUpError?.status === 429) throw new HttpError(429, 'rate_limited', 'Too many sign-up attempts. Please try again later.');
      throw new HttpError(400, 'signup_failed', signUpError?.message ?? 'Could not create the account.');
    }
    const userId = signUp.user.id;

    const { data: companyId, error: provisionError } = await db.rpc('provision_trial', {
      p_user: userId,
      p_company_name: body.company_name,
      p_contact_name: body.contact_name,
      p_phone: body.phone,
      p_email: body.email,
      p_city: body.city ?? null,
      p_industry: body.industry ?? null,
      p_employee_count: body.employee_count ?? null,
      p_plan_key: body.plan_key,
      p_language: body.language,
      p_consent: body.consent,
    });
    if (provisionError || !companyId) {
      console.error('[trial-signup] provisioning failed', provisionError?.message);
      // Do not leave an orphaned login behind.
      await db.auth.admin.deleteUser(userId).catch(() => undefined);
      throw new HttpError(500, 'provisioning_failed', 'We could not set up your trial. Please try again or contact us.');
    }

    if (body.whatsapp_opt_in) {
      await db.from('communication_consents').insert({
        phone: toE164Digits(body.phone),
        email: body.email,
        channel: 'whatsapp',
        granted: true,
        source: 'free_trial',
        ip_hash: ipHash,
        wording: 'Opted in to WhatsApp updates',
      });
    }

    const { data: sub } = await db.from('subscriptions').select('trial_end, plans(name)').eq('company_id', companyId).maybeSingle();
    const plan = sub?.plans as { name?: string } | { name?: string }[] | null | undefined;
    await notify(db, {
      key: 'trial_activation',
      email: body.email,
      phone: body.phone,
      whatsappConsent: body.whatsapp_opt_in,
      language: body.language,
      vars: {
        name: body.contact_name,
        company: body.company_name,
        plan: (Array.isArray(plan) ? plan[0]?.name : plan?.name) ?? '',
        trial_end: sub?.trial_end ? formatIst(sub.trial_end, body.language === 'ta' ? 'ta-IN' : 'en-IN').date : '',
        portal_url: `${siteUrl}/login`,
      },
      companyId,
      dedupeKey: `trial-activation:${companyId}`,
    });
    await audit(db, { actor: userId, action: 'trial_signup', entity: 'companies', entityId: companyId, companyId, ipHash });

    // With email confirmation enabled (recommended) there is no session until the link is clicked.
    return { ok: true, needs_confirmation: !signUp.session };
  },
);

export const config: Config = { path: '/api/public/trial-signup' };
