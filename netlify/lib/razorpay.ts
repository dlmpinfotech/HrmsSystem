import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay adapter (optional). Online payments are verified ONLY by the signed
 * webhook — a browser "success" callback is never trusted on its own.
 */
export function razorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET);
}

export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature || !/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export async function createRazorpayOrder(amountInr: number, receipt: string, notes: Record<string, string>): Promise<{ id: string; amount: number; currency: string }> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error('razorpay_not_configured');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: Math.round(amountInr * 100), currency: 'INR', receipt: receipt.slice(0, 40), notes }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
  if (!res.ok || !data.id) throw new Error(`razorpay_error_${res.status}: ${data.error?.description ?? 'order failed'}`);
  return { id: data.id, amount: data.amount ?? 0, currency: data.currency ?? 'INR' };
}
