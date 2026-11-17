import { describe, expect, it, vi } from 'vitest';
import { buildWhatsAppLink, whatsAppMessage } from '@shared/whatsapp';
import { processWhatsAppWebhook, shouldAdvanceStatus, signPayload, verifyWebhookSignature, type WaStore } from '../../netlify/lib/whatsapp';

describe('WhatsApp click-to-chat links', () => {
  it('builds an official wa.me link with an encoded prefilled message', () => {
    const link = buildWhatsAppLink('98765 43210', 'Hi, I want a demo & pricing?');
    expect(link).toBe('https://wa.me/919876543210?text=Hi%2C%20I%20want%20a%20demo%20%26%20pricing%3F');
  });

  it('normalises +91 / 0-prefixed numbers', () => {
    expect(buildWhatsAppLink('+91-98765-43210')).toBe('https://wa.me/919876543210');
    expect(buildWhatsAppLink('09876543210')).toBe('https://wa.me/919876543210');
  });

  it('returns null when no usable number is configured (button is hidden)', () => {
    expect(buildWhatsAppLink('')).toBeNull();
    expect(buildWhatsAppLink(undefined)).toBeNull();
    expect(buildWhatsAppLink('12')).toBeNull();
  });

  it('encodes Tamil text correctly', () => {
    const msg = whatsAppMessage('demo_booking', 'ta', { brand: 'HRMS Cloud' });
    const link = buildWhatsAppLink('9876543210', msg)!;
    expect(decodeURIComponent(link.split('text=')[1])).toBe(msg);
    expect(msg).toContain('டெமோ');
  });

  it('fills message variables and drops an empty trailing label', () => {
    expect(whatsAppMessage('pricing', 'en', { brand: 'X', plan: 'Business' })).toBe('Hi, I am interested in the Business plan of X.');
    expect(whatsAppMessage('customer_support', 'en', { brand: 'X' })).toBe('Hi, I need help with my X account.');
    expect(whatsAppMessage('customer_support', 'en', { brand: 'X', company: 'Acme' })).toBe('Hi, I need help with my X account. Company: Acme');
  });
});

describe('WhatsApp webhook signature', () => {
  const secret = 'app-secret';
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('accepts a correct X-Hub-Signature-256', () => {
    expect(verifyWebhookSignature(body, signPayload(body, secret), secret)).toBe(true);
  });

  it('rejects tampered bodies, wrong secrets and malformed headers', () => {
    const sig = signPayload(body, secret);
    expect(verifyWebhookSignature(body + ' ', sig, secret)).toBe(false);
    expect(verifyWebhookSignature(body, signPayload(body, 'other'), secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha1=abc', secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=zz', secret)).toBe(false);
    expect(verifyWebhookSignature(body, sig, undefined)).toBe(false);
  });
});

describe('WhatsApp webhook processing', () => {
  function memoryStore() {
    const seen = new Set<string>();
    const statuses: { id: string; status: string }[] = [];
    const optOuts: string[] = [];
    const store: WaStore = {
      saveInbound: vi.fn(async (m) => {
        if (seen.has(m.waMessageId)) return false;
        seen.add(m.waMessageId);
        return true;
      }),
      applyStatus: vi.fn(async (u) => {
        statuses.push({ id: u.waMessageId, status: u.status });
      }),
      recordOptOut: vi.fn(async (p) => {
        optOuts.push(p);
      }),
    };
    return { store, statuses, optOuts };
  }

  const payload = (messages: unknown[], statuses: unknown[] = []) => ({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: '919876543210', profile: { name: 'Priya' } }], messages, statuses } }] }],
  });

  it('stores inbound messages and ignores duplicate deliveries', async () => {
    const { store } = memoryStore();
    const msg = { id: 'wamid.1', from: '919876543210', timestamp: '1700000000', type: 'text', text: { body: 'Hello' } };
    const first = await processWhatsAppWebhook(payload([msg]), store);
    const second = await processWhatsAppWebhook(payload([msg]), store);
    expect(first).toMatchObject({ inbound: 1, duplicates: 0 });
    expect(second).toMatchObject({ inbound: 0, duplicates: 1 });
    expect(store.saveInbound).toHaveBeenCalledWith(expect.objectContaining({ contactName: 'Priya', body: 'Hello' }));
  });

  it('records STOP as an opt-out (English and Tamil)', async () => {
    const { store, optOuts } = memoryStore();
    await processWhatsAppWebhook(payload([{ id: 'a', from: '919876543210', type: 'text', text: { body: 'STOP' } }, { id: 'b', from: '919000000001', type: 'text', text: { body: 'நிறுத்து' } }]), store);
    expect(optOuts).toEqual(['919876543210', '919000000001']);
  });

  it('passes delivery statuses through and ignores unknown objects', async () => {
    const { store, statuses } = memoryStore();
    await processWhatsAppWebhook(payload([], [{ id: 'wamid.9', status: 'delivered' }, { id: 'x', status: 'weird' }]), store);
    expect(statuses).toEqual([{ id: 'wamid.9', status: 'delivered' }]);
    expect(await processWhatsAppWebhook({ object: 'page' }, store)).toMatchObject({ inbound: 0, statuses: 0 });
  });

  it('never moves a message status backwards', () => {
    expect(shouldAdvanceStatus('sent', 'delivered')).toBe(true);
    expect(shouldAdvanceStatus('read', 'delivered')).toBe(false);
    expect(shouldAdvanceStatus('delivered', 'sent')).toBe(false);
    expect(shouldAdvanceStatus('sent', 'failed')).toBe(true);
    expect(shouldAdvanceStatus('read', 'failed')).toBe(false);
  });
});
