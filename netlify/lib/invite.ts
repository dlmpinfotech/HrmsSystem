import type { SupabaseClient } from '@supabase/supabase-js';
import { textToHtml } from '../../shared/templates';
import { emailConfigured, emailProvider, sendEmail } from './email';
import { getBrand } from './settings';

interface InviteInput {
  email: string;
  fullName: string;
  companyId: string | null;
  redirectTo: string;
}

/**
 * Sends a portal invitation.
 *
 * When the app's own email is configured (e.g. Gmail SMTP), Supabase only *generates*
 * the secure invite link and we deliver it ourselves — this avoids Supabase's built-in
 * mailer, which allows just a few emails per hour on the free plan. Otherwise we fall
 * back to Supabase sending the invite. The `handle_new_user` trigger applies the
 * pending invitation (role + company membership) as soon as the auth user exists.
 */
export async function sendInvitation(db: SupabaseClient, input: InviteInput): Promise<{ via: string }> {
  if (!emailConfigured()) {
    const { error } = await db.auth.admin.inviteUserByEmail(input.email, { data: { full_name: input.fullName }, redirectTo: input.redirectTo });
    if (error) throw new Error(error.message);
    return { via: 'supabase' };
  }

  const { data, error } = await db.auth.admin.generateLink({
    type: 'invite',
    email: input.email,
    options: { data: { full_name: input.fullName }, redirectTo: input.redirectTo },
  });
  if (error || !data?.properties?.action_link || !data.user) throw new Error(error?.message ?? 'could not create invite link');

  const [brand, company] = await Promise.all([
    getBrand(db),
    input.companyId ? db.from('companies').select('name, default_language').eq('id', input.companyId).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  const ta = company?.default_language === 'ta';
  const companyName = company?.name ?? brand.name;
  const link = data.properties.action_link;
  const subject = ta ? `${companyName} — ${brand.name} போர்ட்டலுக்கு உங்களை அழைக்கிறோம்` : `You're invited to the ${companyName} portal on ${brand.name}`;
  const text = ta
    ? `வணக்கம் ${input.fullName},\n\n${companyName} நிறுவனம் உங்களை ${brand.name} போர்ட்டலுக்கு அழைத்துள்ளது.\n\nகீழே உள்ள இணைப்பைத் திறந்து உங்கள் கடவுச்சொல்லை அமைக்கவும்:\n${link}\n\nஇந்த இணைப்பு 24 மணி நேரம் செல்லுபடியாகும். நீங்கள் இதை எதிர்பார்க்கவில்லை என்றால், இந்த மின்னஞ்சலைப் புறக்கணிக்கலாம்.\n\nநன்றி,\n${brand.name} குழு`
    : `Hi ${input.fullName},\n\n${companyName} has invited you to their ${brand.name} portal.\n\nOpen the link below to set your password and sign in:\n${link}\n\nThe link is valid for 24 hours. If you weren't expecting this, you can ignore this email.\n\nRegards,\n${brand.name} Team`;

  try {
    const sent = await sendEmail({ to: input.email, subject, text, html: textToHtml(text, brand.name) });
    await db.from('notification_logs').insert({
      template_key: 'user_invitation', channel: 'email', recipient: input.email, language: ta ? 'ta' : 'en', subject,
      body: text.replace(link, '[invite link]'), status: 'sent', provider: sent.provider, provider_message_id: sent.id,
      attempts: 1, sent_at: new Date().toISOString(), company_id: input.companyId,
    });
  } catch (err) {
    // No email went out, so remove the half-created login; the caller revokes the invitation.
    await db.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw err;
  }
  return { via: emailProvider() };
}
