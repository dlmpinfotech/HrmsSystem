import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Exercises Netlify Function handlers end-to-end (routing guard, CORS/origin checks,
 * validation, spam handling, webhook verification) with the database client mocked.
 */
const rpc = vi.fn(async () => ({ data: true, error: null }));
const from = vi.fn(() => {
  throw new Error('database should not be touched in this test');
});
vi.mock('../../netlify/lib/supabase', () => ({
  getAdminClient: () => ({ rpc, from, auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'bad jwt' } })) } }),
  getAnonClient: () => ({}),
}));

const SITE = 'https://hrms.example.test';

function req(path: string, init: RequestInit & { origin?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.origin) headers.set('origin', init.origin);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Request(`${SITE}${path}`, { ...init, headers });
}

beforeEach(() => {
  rpc.mockClear();
  from.mockClear();
  process.env.URL = SITE;
  process.env.META_WHATSAPP_VERIFY_TOKEN = 'verify-me';
  process.env.META_APP_SECRET = 'app-secret';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'super-secret-service-key';
});

describe('public lead endpoint', () => {
  const valid = { company_name: 'Acme', contact_person: 'Priya', phone: '9876543210', consent: true, elapsed_ms: 5000 };

  it('rejects other HTTP methods', async () => {
    const { default: handler } = await import('../../netlify/functions/public-lead');
    const res = await handler(req('/api/public/leads', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('blocks browser requests from foreign origins', async () => {
    const { default: handler } = await import('../../netlify/functions/public-lead');
    const res = await handler(req('/api/public/leads', { method: 'POST', origin: 'https://evil.test', body: JSON.stringify(valid) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'origin_not_allowed' } });
  });

  it('returns field-level validation errors as i18n keys', async () => {
    const { default: handler } = await import('../../netlify/functions/public-lead');
    const res = await handler(req('/api/public/leads', { method: 'POST', origin: SITE, body: JSON.stringify({ ...valid, phone: '123', consent: false }) }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.fields).toEqual(expect.arrayContaining([{ path: 'phone', message: 'validation.phone' }, { path: 'consent', message: 'validation.consent' }]));
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
  });

  it('silently accepts honeypot submissions without saving them', async () => {
    const { default: handler } = await import('../../netlify/functions/public-lead');
    const res = await handler(req('/api/public/leads', { method: 'POST', origin: SITE, body: JSON.stringify({ ...valid, website: 'http://spam.test' }) }));
    expect(res.status).toBe(200);
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('check_rate_limit', expect.objectContaining({ p_max: 5 }));
  });

  it('returns 429 when the rate limit is exceeded', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    const { default: handler } = await import('../../netlify/functions/public-lead');
    const res = await handler(req('/api/public/leads', { method: 'POST', origin: SITE, body: JSON.stringify(valid) }));
    expect(res.status).toBe(429);
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const { default: handler } = await import('../../netlify/functions/public-lead');
    expect((await handler(req('/api/public/leads', { method: 'POST', origin: SITE, body: '{nope' }))).status).toBe(400);
    expect((await handler(req('/api/public/leads', { method: 'POST', origin: SITE, body: JSON.stringify({ x: 'a'.repeat(200_000) }) }))).status).toBe(413);
  });
});

describe('authenticated endpoints', () => {
  it('require a valid session', async () => {
    const { default: handler } = await import('../../netlify/functions/admin-payments');
    const noToken = await handler(req('/api/admin/payments', { method: 'POST', origin: SITE, body: '{}' }));
    expect(noToken.status).toBe(401);
    const badToken = await handler(req('/api/admin/payments', { method: 'POST', origin: SITE, body: '{}', headers: { authorization: 'Bearer forged' } }));
    expect(badToken.status).toBe(401);
  });
});

describe('WhatsApp webhook', () => {
  it('answers Meta verification only with the right token', async () => {
    const { default: handler } = await import('../../netlify/functions/whatsapp-webhook');
    const ok = await handler(req('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345'));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('12345');
    const bad = await handler(req('/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1'));
    expect(bad.status).toBe(403);
  });

  it('rejects unsigned or wrongly signed events', async () => {
    const { default: handler } = await import('../../netlify/functions/whatsapp-webhook');
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    expect((await handler(req('/api/whatsapp/webhook', { method: 'POST', body }))).status).toBe(401);
    expect((await handler(req('/api/whatsapp/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } }))).status).toBe(401);
  });

  it('accepts correctly signed events', async () => {
    const { default: handler } = await import('../../netlify/functions/whatsapp-webhook');
    const { signPayload } = await import('../../netlify/lib/whatsapp');
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    const res = await handler(req('/api/whatsapp/webhook', { method: 'POST', body, headers: { 'x-hub-signature-256': signPayload(body, 'app-secret') } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, inbound: 0 });
  });
});

describe('health endpoint', () => {
  it('reports configuration as booleans and never leaks secret values', async () => {
    const { default: handler } = await import('../../netlify/functions/health');
    const res = await handler(req('/api/health'));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain('super-secret-service-key');
    expect(JSON.parse(text).configured).toMatchObject({ email: expect.any(Boolean), whatsapp_cloud: expect.any(Boolean) });
  });
});
