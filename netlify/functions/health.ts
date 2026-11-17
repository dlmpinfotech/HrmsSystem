import type { Config } from '@netlify/functions';
import { emailConfigured } from '../lib/email';
import { defineHandler } from '../lib/http';

/** GET /api/health — liveness + which integrations are configured (booleans only). */
export default defineHandler({ name: 'health', methods: ['GET'], noDb: true }, async () => ({
  ok: true,
  time: new Date().toISOString(),
  configured: {
    supabase: Boolean((process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY),
    email: emailConfigured(),
    whatsapp_cloud: Boolean(process.env.META_WHATSAPP_ACCESS_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID),
    razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  },
}));

export const config: Config = { path: '/api/health' };
