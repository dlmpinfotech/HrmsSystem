import type { SupabaseClient } from '@supabase/supabase-js';
import type { Language, NotificationKey } from '../../shared/constants';
import { toE164Digits } from '../../shared/phone';
import { renderTemplate, textToHtml } from '../../shared/templates';
import { emailConfigured, sendEmail } from './email';
import { getBrand, getSetting } from './settings';
import { sendWhatsAppTemplate, waConfigStatus } from './whatsapp';

export type Channel = 'email' | 'whatsapp';
type Vars = Record<string, string | number | null | undefined>;

export interface NotifyInput {
  key: NotificationKey;
  channels?: Channel[];
  email?: string | null;
  phone?: string | null;
  /** WhatsApp is only attempted when the recipient explicitly opted in. */
  whatsappConsent?: boolean;
  language?: Language;
  vars: Vars;
  leadId?: string | null;
  companyId?: string | null;
  /** Same key ⇒ the notification is sent at most once per channel (idempotency). */
  dedupeKey?: string;
}

export interface NotifyResult {
  channel: Channel;
  status: 'sent' | 'failed' | 'skipped' | 'duplicate' | 'no_template' | 'no_recipient';
  logId?: string;
  error?: string;
}

interface LogRow {
  id: string;
  template_key: string;
  channel: Channel;
  recipient: string;
  language: string;
  subject: string | null;
  body: string | null;
  payload: { params?: string[]; template_name?: string | null; whatsapp_consent?: boolean };
  status: string;
  attempts: number;
}

export const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [5, 30, 120, 720];

export function nextRetryAt(attempts: number, now = new Date()): string | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 5;
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

async function findTemplate(db: SupabaseClient, key: string, channel: Channel, language: string) {
  const { data } = await db
    .from('notification_templates')
    .select('key, channel, language, subject, body, whatsapp_template_name, variables, is_active')
    .eq('key', key)
    .eq('channel', channel)
    .in('language', [language, 'en']);
  const rows = (data ?? []).filter((t) => t.is_active);
  return rows.find((t) => t.language === language) ?? rows.find((t) => t.language === 'en') ?? null;
}

/** Latest recorded WhatsApp consent for a phone number (opt-in required, opt-out respected). */
export async function hasWhatsAppConsent(db: SupabaseClient, phone: string | null | undefined): Promise<boolean> {
  const digits = phone ? toE164Digits(phone) : null;
  if (!digits) return false;
  const { data } = await db
    .from('communication_consents')
    .select('granted, revoked_at')
    .eq('phone', digits)
    .eq('channel', 'whatsapp')
    .order('created_at', { ascending: false })
    .limit(1);
  const latest = data?.[0];
  return Boolean(latest && latest.granted && !latest.revoked_at);
}

async function deliver(db: SupabaseClient, log: LogRow): Promise<NotifyResult> {
  const attempts = log.attempts + 1;
  const finish = async (patch: Record<string, unknown>, result: Omit<NotifyResult, 'channel' | 'logId'>): Promise<NotifyResult> => {
    await db.from('notification_logs').update(patch).eq('id', log.id);
    return { channel: log.channel, logId: log.id, ...result };
  };

  try {
    if (log.channel === 'email') {
      const settings = await getSetting(db, 'email', { enabled: true });
      if (!settings.enabled || !emailConfigured()) {
        return finish({ status: 'skipped', error: 'email_not_configured' }, { status: 'skipped', error: 'email_not_configured' });
      }
      const brand = await getBrand(db);
      const sent = await sendEmail({
        to: log.recipient,
        subject: log.subject ?? brand.name,
        text: log.body ?? '',
        html: textToHtml(log.body ?? '', brand.name),
      });
      return finish(
        { status: 'sent', provider: sent.provider, provider_message_id: sent.id, attempts, sent_at: new Date().toISOString(), error: null, next_retry_at: null },
        { status: 'sent' },
      );
    }

    // WhatsApp — every gate must pass before a (potentially chargeable) message is sent.
    const cloud = await getSetting(db, 'whatsapp_cloud', { enabled: false });
    if (!cloud.enabled || !waConfigStatus().can_send) {
      return finish({ status: 'skipped', error: 'whatsapp_cloud_disabled' }, { status: 'skipped', error: 'whatsapp_cloud_disabled' });
    }
    if (!log.payload.whatsapp_consent) {
      return finish({ status: 'skipped', error: 'no_consent' }, { status: 'skipped', error: 'no_consent' });
    }
    if (!log.payload.template_name) {
      return finish({ status: 'skipped', error: 'no_approved_template' }, { status: 'skipped', error: 'no_approved_template' });
    }
    const sent = await sendWhatsAppTemplate(log.recipient, log.payload.template_name, log.language, log.payload.params ?? []);
    await recordOutboundWhatsApp(db, log.recipient, sent.id, log.body, log.payload.template_name);
    return finish(
      { status: 'sent', provider: 'meta_cloud_api', provider_message_id: sent.id, attempts, sent_at: new Date().toISOString(), error: null, next_retry_at: null },
      { status: 'sent' },
    );
  } catch (err) {
    const message = (err as Error).message?.slice(0, 500) ?? 'send_failed';
    return finish({ status: 'failed', attempts, error: message, next_retry_at: nextRetryAt(attempts) }, { status: 'failed', error: message });
  }
}

/** Mirrors an outbound API message into the WhatsApp inbox tables. */
export async function recordOutboundWhatsApp(
  db: SupabaseClient,
  phone: string,
  waMessageId: string,
  body: string | null,
  templateName: string | null,
  sentBy: string | null = null,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: conv } = await db
    .from('whatsapp_conversations')
    .upsert({ wa_phone: phone, last_message_at: now }, { onConflict: 'wa_phone' })
    .select('id')
    .single();
  if (!conv) return;
  await db.from('whatsapp_messages').insert({
    conversation_id: conv.id,
    direction: 'outbound',
    wa_message_id: waMessageId,
    type: templateName ? 'template' : 'text',
    body,
    template_name: templateName,
    status: 'sent',
    sent_by: sentBy,
  });
}

/**
 * Renders the stored template for each requested channel, writes a notification log
 * and attempts delivery. Never throws — a notification failure must not break the
 * business operation that triggered it.
 */
export async function notify(db: SupabaseClient, input: NotifyInput): Promise<NotifyResult[]> {
  const results: NotifyResult[] = [];
  const language = input.language ?? 'en';
  const channels = input.channels ?? ['email', 'whatsapp'];

  try {
    const brand = await getBrand(db);
    const vars: Vars = { brand: brand.name, ...input.vars };

    for (const channel of channels) {
      const recipient = channel === 'email' ? input.email?.trim().toLowerCase() : input.phone ? toE164Digits(input.phone) : null;
      if (!recipient) {
        results.push({ channel, status: 'no_recipient' });
        continue;
      }
      const template = await findTemplate(db, input.key, channel, language);
      if (!template) {
        results.push({ channel, status: 'no_template' });
        continue;
      }

      const body = renderTemplate(template.body, vars);
      const subject = template.subject ? renderTemplate(template.subject, vars) : null;
      const params = (template.variables as string[]).map((v) => String(vars[v] ?? ''));

      const { data: log, error } = await db
        .from('notification_logs')
        .insert({
          template_key: input.key,
          channel,
          recipient,
          language: template.language,
          subject,
          body,
          payload: { params, template_name: template.whatsapp_template_name, whatsapp_consent: Boolean(input.whatsappConsent) },
          status: 'queued',
          dedupe_key: input.dedupeKey ? `${input.dedupeKey}:${channel}` : null,
          lead_id: input.leadId ?? null,
          company_id: input.companyId ?? null,
        })
        .select('*')
        .single();

      if (error) {
        if (error.code === '23505') results.push({ channel, status: 'duplicate' });
        else {
          console.error('[notify] could not write log', error.message);
          results.push({ channel, status: 'failed', error: 'log_write_failed' });
        }
        continue;
      }
      results.push(await deliver(db, log as LogRow));
    }
  } catch (err) {
    console.error('[notify] unexpected failure', err);
  }
  return results;
}

/** Manual or scheduled retry of one failed/skipped notification. */
export async function retryNotification(db: SupabaseClient, logId: string): Promise<NotifyResult | null> {
  const { data: log } = await db.from('notification_logs').select('*').eq('id', logId).maybeSingle();
  if (!log) return null;
  if (!['failed', 'skipped'].includes(log.status)) return { channel: log.channel, logId, status: 'duplicate' };
  if (log.attempts >= MAX_ATTEMPTS) return { channel: log.channel, logId, status: 'failed', error: 'max_attempts_reached' };
  return deliver(db, log as LogRow);
}

/** Retries failed notifications whose backoff has elapsed. */
export async function retryDueNotifications(db: SupabaseClient, limit = 25): Promise<number> {
  const { data } = await db
    .from('notification_logs')
    .select('*')
    .eq('status', 'failed')
    .lt('attempts', MAX_ATTEMPTS)
    .lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at')
    .limit(limit);
  let retried = 0;
  for (const log of data ?? []) {
    await deliver(db, log as LogRow);
    retried++;
  }
  return retried;
}
