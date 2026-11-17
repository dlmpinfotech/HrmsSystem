import type { Config } from '@netlify/functions';
import { adminPaymentActionSchema } from '../../shared/schemas';
import { defineHandler, HttpError, assertDb } from '../lib/http';
import { hasWhatsAppConsent, notify } from '../lib/notifications';
import { audit } from '../lib/settings';

const inr = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount);

/**
 * POST /api/admin/payments — manual payment tracking.
 * A payment is always recorded as "pending". It becomes "verified" only through the
 * verify_payment() database function (a DB trigger rejects any other path), which also
 * marks the invoice paid and activates/extends the subscription atomically.
 */
export default defineHandler(
  { name: 'admin-payments', methods: ['POST'], permission: 'payments.verify', schema: adminPaymentActionSchema },
  async ({ db, body, user }) => {
    if (body.action === 'record') {
      let subscriptionId: string | null = null;
      if (body.invoice_id) {
        const { data: invoice } = await db.from('invoices').select('id, company_id, subscription_id, status').eq('id', body.invoice_id).maybeSingle();
        if (!invoice || invoice.company_id !== body.company_id) throw new HttpError(422, 'invoice_mismatch', 'The invoice does not belong to this customer.');
        if (invoice.status === 'paid' || invoice.status === 'void') throw new HttpError(409, 'invoice_closed', 'This invoice is already settled.');
        subscriptionId = invoice.subscription_id;
      }
      const payment = assertDb(
        await db
          .from('payments')
          .insert({
            company_id: body.company_id,
            invoice_id: body.invoice_id,
            subscription_id: subscriptionId,
            amount: body.amount,
            method: body.method,
            reference: body.reference ?? null,
            paid_on: body.paid_on,
            notes: body.notes ?? null,
            status: 'pending',
            recorded_by: user!.id,
          })
          .select('*')
          .single(),
        'record payment',
      );
      return { ok: true, payment };
    }

    if (body.action === 'reject') {
      const { data, error } = await db
        .from('payments')
        .update({ status: 'failed', notes: body.reason ?? null })
        .eq('id', body.payment_id)
        .eq('status', 'pending')
        .select('id, company_id')
        .maybeSingle();
      if (error) throw new HttpError(500, 'database_error');
      if (!data) throw new HttpError(409, 'not_pending', 'Only pending payments can be rejected.');
      await audit(db, { actor: user!.id, action: 'payment_rejected', entity: 'payments', entityId: data.id, companyId: data.company_id });
      return { ok: true };
    }

    // verify
    const { data: payment, error } = await db.rpc('verify_payment', { p_payment: body.payment_id, p_actor: user!.id, p_source: 'manual' });
    if (error) {
      console.error('[admin-payments] verify failed', error.code, error.message);
      if (error.code === 'P0002') throw new HttpError(404, 'payment_not_found');
      if (error.code === '22023') throw new HttpError(409, 'not_pending', 'Only pending payments can be verified.');
      throw new HttpError(500, 'verification_failed', 'Could not verify this payment.');
    }

    const [{ data: company }, { data: contacts }, { data: invoice }] = await Promise.all([
      db.from('companies').select('name, default_language').eq('id', payment.company_id).single(),
      db.from('customer_contacts').select('name, email, phone').eq('company_id', payment.company_id).order('is_primary', { ascending: false }).limit(1),
      payment.invoice_id
        ? db.from('invoices').select('invoice_number').eq('id', payment.invoice_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const contact = contacts?.[0];
    if (contact) {
      await notify(db, {
        key: 'payment_confirmation',
        email: contact.email,
        phone: contact.phone,
        whatsappConsent: await hasWhatsAppConsent(db, contact.phone),
        language: company?.default_language ?? 'en',
        vars: {
          name: contact.name,
          company: company?.name ?? '',
          amount: inr(Number(payment.amount)),
          invoice_number: invoice?.invoice_number ?? payment.reference ?? '-',
        },
        companyId: payment.company_id,
        dedupeKey: `payment-confirm:${payment.id}`,
      });
    }
    return { ok: true, payment };
  },
);

export const config: Config = { path: '/api/admin/payments' };
