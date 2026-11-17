import type { Config } from '@netlify/functions';
import { whatsappSendSchema } from '../../shared/schemas';
import { can } from '../../shared/permissions';
import { defineHandler, HttpError } from '../lib/http';
import { recordOutboundWhatsApp } from '../lib/notifications';
import { getSetting } from '../lib/settings';
import { sendWhatsAppText, waConfigStatus } from '../lib/whatsapp';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * GET  /api/whatsapp — Cloud API configuration status (booleans only, never secret values)
 * POST /api/whatsapp — staff reply inside the 24-hour customer-service window
 */
export default defineHandler({ name: 'whatsapp', methods: ['GET', 'POST'], permission: 'whatsapp.view' }, async ({ db, req, body, user, roles, siteUrl }) => {
  const cloud = await getSetting(db, 'whatsapp_cloud', { enabled: false });
  const status = waConfigStatus();

  if (req.method === 'GET') {
    return { enabled: cloud.enabled, config: status, webhook_url: `${siteUrl}/api/whatsapp/webhook` };
  }

  if (!can(roles, 'whatsapp.send')) throw new HttpError(403, 'forbidden');
  const input = whatsappSendSchema.parse(body);
  if (!cloud.enabled) throw new HttpError(409, 'whatsapp_cloud_disabled', 'WhatsApp Cloud API messaging is switched off in Settings.');
  if (!status.can_send) throw new HttpError(503, 'not_configured', 'WhatsApp Cloud API credentials are not configured on the server.');

  const { data: conv } = await db.from('whatsapp_conversations').select('id, wa_phone, last_inbound_at').eq('id', input.conversation_id).maybeSingle();
  if (!conv) throw new HttpError(404, 'conversation_not_found');
  // Meta only allows free-form messages within 24h of the customer's last message.
  if (!conv.last_inbound_at || Date.now() - new Date(conv.last_inbound_at).getTime() > WINDOW_MS) {
    throw new HttpError(409, 'outside_service_window', 'The 24-hour reply window has closed. Only approved template messages can be sent now.');
  }

  try {
    const sent = await sendWhatsAppText(conv.wa_phone, input.body);
    await recordOutboundWhatsApp(db, conv.wa_phone, sent.id, input.body, null, user!.id);
    return { ok: true, wa_message_id: sent.id };
  } catch (err) {
    console.error('[whatsapp] send failed', (err as Error).message);
    await db.from('whatsapp_messages').insert({ conversation_id: conv.id, direction: 'outbound', body: input.body, status: 'failed', error: (err as Error).message.slice(0, 300), sent_by: user!.id });
    throw new HttpError(502, 'send_failed', 'WhatsApp did not accept the message.');
  }
});

export const config: Config = { path: '/api/whatsapp' };
