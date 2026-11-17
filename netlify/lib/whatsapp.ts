import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Official Meta WhatsApp Cloud API client (Graph API over HTTPS).
 * Secrets are read from server-side environment variables only.
 * Meta may charge per conversation/template message — sending stays disabled until a
 * Super Admin switches it on in Settings (app_settings.whatsapp_cloud.enabled).
 */
const GRAPH_VERSION = 'v21.0';

export interface WaConfig {
  accessToken: string | undefined;
  phoneNumberId: string | undefined;
  businessAccountId: string | undefined;
  verifyToken: string | undefined;
  appSecret: string | undefined;
}

export function waConfig(): WaConfig {
  return {
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID,
    verifyToken: process.env.META_WHATSAPP_VERIFY_TOKEN,
    appSecret: process.env.META_APP_SECRET,
  };
}

/** Which pieces are present — safe to return to the admin UI (never the values). */
export function waConfigStatus() {
  const c = waConfig();
  return {
    access_token: Boolean(c.accessToken),
    phone_number_id: Boolean(c.phoneNumberId),
    business_account_id: Boolean(c.businessAccountId),
    verify_token: Boolean(c.verifyToken),
    app_secret: Boolean(c.appSecret),
    can_send: Boolean(c.accessToken && c.phoneNumberId),
    can_receive: Boolean(c.verifyToken && c.appSecret),
    phone_number_id_hint: c.phoneNumberId ? `…${c.phoneNumberId.slice(-4)}` : null,
  };
}

/** Validates X-Hub-Signature-256 against the raw request body (constant-time). */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const given = header.slice('sha256='.length);
  if (given.length !== expected.length || !/^[0-9a-f]+$/i.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

export function signPayload(rawBody: string, appSecret: string): string {
  return 'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
}

async function graphSend(payload: Record<string, unknown>): Promise<{ id: string }> {
  const { accessToken, phoneNumberId } = waConfig();
  if (!accessToken || !phoneNumberId) throw new Error('whatsapp_not_configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      error?: { message?: string; code?: number };
    };
    if (!res.ok || !data.messages?.[0]?.id) {
      throw new Error(`whatsapp_error_${data.error?.code ?? res.status}: ${data.error?.message ?? 'send failed'}`);
    }
    return { id: data.messages[0].id };
  } finally {
    clearTimeout(timer);
  }
}

/** Free-form text — only permitted inside the 24-hour customer-service window. */
export function sendWhatsAppText(to: string, body: string) {
  return graphSend({ to, type: 'text', text: { preview_url: false, body } });
}

/** Pre-approved template message (required for business-initiated conversations). */
export function sendWhatsAppTemplate(to: string, name: string, languageCode: string, params: string[]) {
  return graphSend({
    to,
    type: 'template',
    template: {
      name,
      language: { code: languageCode },
      components: params.length
        ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: text || '-' })) }]
        : [],
    },
  });
}

// ── Webhook processing (store-agnostic so it can be unit-tested) ───────
export type WaStatus = 'sent' | 'delivered' | 'read' | 'failed';
const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

/** Status webhooks can arrive out of order; never move a message backwards. */
export function shouldAdvanceStatus(current: string, next: string): boolean {
  if (next === 'failed') return current !== 'read' && current !== 'delivered' && current !== 'failed';
  return (STATUS_RANK[next] ?? -1) > (STATUS_RANK[current] ?? -1) && current !== 'failed';
}

export interface InboundMessage {
  waMessageId: string;
  from: string;
  contactName: string | null;
  type: string;
  body: string | null;
  timestamp: string;
  raw: unknown;
}

export interface StatusUpdate {
  waMessageId: string;
  status: WaStatus;
  error: string | null;
}

export interface WaStore {
  /** Returns false when the message id was already stored (webhook redelivery). */
  saveInbound(message: InboundMessage): Promise<boolean>;
  applyStatus(update: StatusUpdate): Promise<void>;
  recordOptOut(phone: string): Promise<void>;
}

const OPT_OUT_WORDS = new Set(['stop', 'unsubscribe', 'நிறுத்து', 'நிறுத்தவும்']);

interface WebhookPayload {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          id: string;
          from: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
        }[];
        statuses?: { id: string; status: string; errors?: { title?: string; message?: string; code?: number }[] }[];
      };
    }[];
  }[];
}

export async function processWhatsAppWebhook(payload: unknown, store: WaStore) {
  const result = { inbound: 0, duplicates: 0, statuses: 0, optOuts: 0 };
  const body = payload as WebhookPayload;
  if (body?.object !== 'whatsapp_business_account') return result;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id ?? '', c.profile?.name ?? null]));

      for (const m of value.messages ?? []) {
        if (!m?.id || !m.from) continue;
        const text =
          m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
        const stored = await store.saveInbound({
          waMessageId: m.id,
          from: m.from.replace(/\D/g, ''),
          contactName: names.get(m.from) ?? null,
          type: m.type ?? 'text',
          body: text,
          timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString(),
          raw: m,
        });
        if (!stored) {
          result.duplicates++;
          continue;
        }
        result.inbound++;
        if (text && OPT_OUT_WORDS.has(text.trim().toLowerCase())) {
          await store.recordOptOut(m.from.replace(/\D/g, ''));
          result.optOuts++;
        }
      }

      for (const s of value.statuses ?? []) {
        if (!s?.id || !['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
        const err = s.errors?.[0];
        await store.applyStatus({
          waMessageId: s.id,
          status: s.status as WaStatus,
          error: err ? `${err.code ?? ''} ${err.title ?? err.message ?? ''}`.trim() : null,
        });
        result.statuses++;
      }
    }
  }
  return result;
}
