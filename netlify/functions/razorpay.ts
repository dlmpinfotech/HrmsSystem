import type { Config } from '@netlify/functions';
import { z } from 'zod';
import { defineHandler, HttpError, assertDb } from '../lib/http';
import { authenticate, isCompanyAdmin } from '../lib/auth';
import { createRazorpayOrder, razorpayConfigured, verifyRazorpaySignature } from '../lib/razorpay';
import { getAdminClient } from '../lib/supabase';

const orderSchema = z.object({ invoice_id: z.string().uuid() });

interface RazorpayEvent {
  event?: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } } };
}

/**
 * Razorpay integration (optional — inactive until RAZORPAY_* variables are set).
 *  GET  /api/razorpay          → { configured }
 *  POST /api/razorpay          → customer admin creates an order for an unpaid invoice
 *  POST /api/razorpay?webhook=1 → signed webhook; the only path that verifies an online payment
 */
export default defineHandler({ name: 'razorpay', methods: ['GET', 'POST'], webhook: true, noDb: true }, async ({ req, url, raw }) => {
  if (req.method === 'GET') return { configured: razorpayConfigured(), key_id: razorpayConfigured() ? process.env.RAZORPAY_KEY_ID : null };
  if (!razorpayConfigured()) throw new HttpError(503, 'not_configured', 'Online payments are not enabled.');
  const db = getAdminClient();

  if (url.searchParams.get('webhook') === '1') {
    if (!verifyRazorpaySignature(raw, req.headers.get('x-razorpay-signature'), process.env.RAZORPAY_WEBHOOK_SECRET)) {
      throw new HttpError(401, 'invalid_signature');
    }
    const event = JSON.parse(raw) as RazorpayEvent;
    const entity = event.payload?.payment?.entity;
    if (event.event !== 'payment.captured' || !entity?.id || !entity.order_id) return { ok: true, ignored: true };

    const { data: payment } = await db.from('payments').select('id, amount, status').eq('razorpay_order_id', entity.order_id).maybeSingle();
    if (!payment) return { ok: true, ignored: true };
    if (payment.status !== 'pending') return { ok: true, duplicate: true }; // webhook redelivery
    if (Math.round(Number(payment.amount) * 100) !== entity.amount) {
      console.error('[razorpay] amount mismatch for order', entity.order_id);
      await db.from('payments').update({ status: 'failed', notes: 'Amount mismatch reported by gateway' }).eq('id', payment.id);
      return { ok: true, mismatch: true };
    }
    await db.from('payments').update({ razorpay_payment_id: entity.id }).eq('id', payment.id);
    const { error } = await db.rpc('verify_payment', { p_payment: payment.id, p_actor: null, p_source: 'razorpay_webhook' });
    if (error) {
      console.error('[razorpay] verify_payment failed', error.message);
      throw new HttpError(500, 'verification_failed');
    }
    return { ok: true, verified: true };
  }

  // Order creation — browser-initiated, so it needs a real session.
  const user = await authenticate(req, db);
  const { invoice_id } = orderSchema.parse(raw ? JSON.parse(raw) : {});
  const { data: invoice } = await db.from('invoices').select('id, company_id, subscription_id, total, status, invoice_number').eq('id', invoice_id).maybeSingle();
  if (!invoice || !(await isCompanyAdmin(db, user.id, invoice.company_id))) throw new HttpError(404, 'invoice_not_found');
  if (!['issued', 'overdue'].includes(invoice.status)) throw new HttpError(409, 'invoice_closed', 'This invoice cannot be paid.');

  const order = await createRazorpayOrder(Number(invoice.total), invoice.invoice_number, { invoice_id: invoice.id });
  assertDb(
    await db
      .from('payments')
      .insert({
        company_id: invoice.company_id,
        invoice_id: invoice.id,
        subscription_id: invoice.subscription_id,
        amount: invoice.total,
        method: 'razorpay',
        status: 'pending',
        razorpay_order_id: order.id,
        recorded_by: user.id,
        paid_on: new Date().toISOString().slice(0, 10),
      })
      .select('id')
      .single(),
    'create razorpay payment',
  );
  return { ok: true, order_id: order.id, amount: order.amount, currency: order.currency, key_id: process.env.RAZORPAY_KEY_ID };
});

export const config: Config = { path: '/api/razorpay' };
