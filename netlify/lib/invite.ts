import type { SupabaseClient } from '@supabase/supabase-js';
import { textToHtml } from '../../shared/templates';
import { emailConfigured, sendEmail, viaName } from './email';
import { getBrand } from './settings';

export interface Inviter {
  name: string | null;
  email: string | null;
}

interface InviteInput {
  email: string;
  fullName: string;
  companyId: string | null;
  /** The app's own address, e.g. https://hrms.example.com — links never point at the database host. */
  siteUrl: string;
  inviter: Inviter;
  /** Access emails only: also include a one-time "set a new password" link. */
  withPasswordLink?: boolean;
}

/** The signed-in person's name and email, for "Muthu (via Ezofis)" and Reply-To. */
export async function loadInviter(db: SupabaseClient, userId: string): Promise<Inviter> {
  const { data } = await db.from('profiles').select('full_name, email').eq('id', userId).maybeSingle();
  return { name: data?.full_name || data?.email?.split('@')[0] || null, email: data?.email ?? null };
}

async function context(db: SupabaseClient, companyId: string | null) {
  const [brand, company] = await Promise.all([
    getBrand(db),
    companyId ? db.from('companies').select('name, default_language').eq('id', companyId).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  return { brand, companyName: company?.name ?? brand.name, ta: company?.default_language === 'ta' };
}

async function deliver(
  db: SupabaseClient,
  input: InviteInput,
  ctx: Awaited<ReturnType<typeof context>>,
  templateKey: string,
  subject: string,
  text: string,
  hideFromLog?: string,
) {
  const sent = await sendEmail({
    to: input.email,
    subject,
    text,
    html: textToHtml(text, ctx.companyName),
    fromName: viaName(input.inviter.name, ctx.companyName),
    replyTo: input.inviter.email ?? undefined,
  });
  await db.from('notification_logs').insert({
    template_key: templateKey, channel: 'email', recipient: input.email, language: ctx.ta ? 'ta' : 'en', subject,
    body: hideFromLog ? text.replace(hideFromLog, '[link]') : text, status: 'sent', provider: sent.provider, provider_message_id: sent.id,
    attempts: 1, sent_at: new Date().toISOString(), company_id: input.companyId,
  });
  return sent;
}

/**
 * Invites a new person. Supabase only *generates* the secure token; the email goes out
 * through the app's own mailer (SMTP), from "<inviter> (via <company>)", with a link to
 * this site — never Supabase's mailer or its URL. The `handle_new_user` trigger applies
 * the pending invitation (role + company membership) when the account is created.
 */
export async function sendInvitation(db: SupabaseClient, input: InviteInput): Promise<{ via: string }> {
  if (!emailConfigured()) throw new Error('email_not_configured');

  const { data, error } = await db.auth.admin.generateLink({
    type: 'invite',
    email: input.email,
    options: { data: { full_name: input.fullName }, redirectTo: `${input.siteUrl}/reset-password?invite=1` },
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash || !data.user) throw new Error(error?.message ?? 'could not create invite link');

  const ctx = await context(db, input.companyId);
  const link = `${input.siteUrl}/reset-password?invite=1&type=invite&token_hash=${encodeURIComponent(tokenHash)}`;
  const who = input.inviter.name ?? ctx.companyName;
  const subject = ctx.ta ? `${who} உங்களை ${ctx.companyName} போர்ட்டலுக்கு அழைத்துள்ளார்` : `${who} invited you to ${ctx.companyName}`;
  const text = ctx.ta
    ? `வணக்கம் ${input.fullName},\n\n${who} உங்களை ${ctx.companyName} நிறுவனத்தின் ${ctx.brand.name} போர்ட்டலுக்கு அழைத்துள்ளார்.\n\nகீழே உள்ள இணைப்பைத் திறந்து உங்கள் கடவுச்சொல்லை அமைக்கவும்:\n${link}\n\nஇந்த இணைப்பு 24 மணி நேரம் செல்லுபடியாகும். நீங்கள் இதை எதிர்பார்க்கவில்லை என்றால், இந்த மின்னஞ்சலைப் புறக்கணிக்கலாம்.\n\nநன்றி,\n${who}\n${ctx.companyName}`
    : `Hi ${input.fullName},\n\n${who} has invited you to the ${ctx.companyName} portal on ${ctx.brand.name}.\n\nOpen the link below to set your password and sign in:\n${link}\n\nThe link is valid for 24 hours. If you weren't expecting this, you can ignore this email.\n\nRegards,\n${who}\n${ctx.companyName}`;

  try {
    const sent = await deliver(db, input, ctx, 'user_invitation', subject, text, link);
    return { via: sent.provider };
  } catch (err) {
    // No email went out, so remove the half-created login; the caller revokes the invitation.
    await db.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw err;
  }
}

/** Tells someone who already has a login that they now have access to this company. */
export async function sendAccessEmail(db: SupabaseClient, input: InviteInput): Promise<{ via: string }> {
  if (!emailConfigured()) throw new Error('email_not_configured');
  const ctx = await context(db, input.companyId);
  const link = `${input.siteUrl}/login`;
  let resetLink: string | null = null;
  if (input.withPasswordLink) {
    const { data } = await db.auth.admin.generateLink({ type: 'recovery', email: input.email, options: { redirectTo: `${input.siteUrl}/reset-password` } });
    const hash = data?.properties?.hashed_token;
    if (hash) resetLink = `${input.siteUrl}/reset-password?type=recovery&token_hash=${encodeURIComponent(hash)}`;
  }
  const who = input.inviter.name ?? ctx.companyName;
  const subject = ctx.ta ? `${ctx.companyName} போர்ட்டல் அணுகல் வழங்கப்பட்டது` : `You now have access to ${ctx.companyName}`;
  const text = ctx.ta
    ? `வணக்கம் ${input.fullName},\n\n${who} உங்களுக்கு ${ctx.companyName} நிறுவனத்தின் ${ctx.brand.name} போர்ட்டல் அணுகலை வழங்கியுள்ளார்.\n\nஉங்கள் தற்போதைய மின்னஞ்சல் மற்றும் கடவுச்சொல்லுடன் உள்நுழையவும்:\n${link}\n\nகடவுச்சொல் நினைவில்லை என்றால், உள்நுழைவு பக்கத்தில் “கடவுச்சொல் மறந்துவிட்டதா?” என்பதைப் பயன்படுத்தவும்.\n\nநன்றி,\n${who}\n${ctx.companyName}`
    : `Hi ${input.fullName},\n\n${who} has given you access to the ${ctx.companyName} portal on ${ctx.brand.name}.\n\nSign in with your existing email and password:\n${link}\n\nForgot your password? Use “Forgot password?” on the sign-in page.\n\nRegards,\n${who}\n${ctx.companyName}`;
  const full = resetLink
    ? text.replace(
        ctx.ta ? `கடவுச்சொல் நினைவில்லை என்றால், உள்நுழைவு பக்கத்தில் “கடவுச்சொல் மறந்துவிட்டதா?” என்பதைப் பயன்படுத்தவும்.` : `Forgot your password? Use “Forgot password?” on the sign-in page.`,
        ctx.ta ? `கடவுச்சொல் இல்லை அல்லது நினைவில்லையா? இங்கே புதிய கடவுச்சொல்லை அமைக்கவும் (24 மணி நேரம் செல்லுபடியாகும்):
${resetLink}` : `No password yet, or forgot it? Set a new one here (valid for 24 hours):
${resetLink}`,
      )
    : text;
  const sent = await deliver(db, input, ctx, 'access_granted', subject, full, resetLink ?? undefined);
  return { via: sent.provider };
}
