import type { Config } from '@netlify/functions';
import { timingSafeEqual } from 'node:crypto';
import { defineHandler, HttpError } from '../lib/http';
import { createWaStore } from '../lib/waStore';
import { processWhatsAppWebhook, verifyWebhookSignature, waConfig } from '../lib/whatsapp';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Meta WhatsApp Cloud API webhook.
 *  GET  — subscription verification (hub.challenge echo, guarded by the verify token)
 *  POST — incoming messages + delivery statuses; rejected unless X-Hub-Signature-256
 *         matches an HMAC of the raw body with META_APP_SECRET.
 */
export default defineHandler({ name: 'whatsapp-webhook', methods: ['GET', 'POST'], webhook: true, noDb: true }, async ({ req, url, raw }) => {
  const cfg = waConfig();

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') ?? '';
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    if (mode === 'subscribe' && cfg.verifyToken && safeEqual(token, cfg.verifyToken)) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    throw new HttpError(403, 'verification_failed');
  }

  if (!cfg.appSecret) throw new HttpError(503, 'not_configured', 'META_APP_SECRET is not set.');
  if (!verifyWebhookSignature(raw, req.headers.get('x-hub-signature-256'), cfg.appSecret)) {
    throw new HttpError(401, 'invalid_signature');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }

  const { getAdminClient } = await import('../lib/supabase');
  const result = await processWhatsAppWebhook(payload, createWaStore(getAdminClient()));
  return { ok: true, ...result };
});

export const config: Config = { path: '/api/whatsapp/webhook' };
