import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn(async () => ({ messageId: '<abc@gmail.com>' }));
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const ENV_KEYS = ['EMAIL_PROVIDER', 'EMAIL_FROM', 'EMAIL_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
  sendMail.mockClear();
  createTransport.mockClear();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('email providers', () => {
  it('treats SMTP as configured only with host, user, password and sender', async () => {
    const { emailConfigured } = await import('../../netlify/lib/email');
    Object.assign(process.env, { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'A <a@gmail.com>', SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'a@gmail.com' });
    expect(emailConfigured()).toBe(false);
    process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
    expect(emailConfigured()).toBe(true);
  });

  it('sends through Gmail SMTP with implicit TLS on 465 and strips spaces from the app password', async () => {
    Object.assign(process.env, { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'DLMP <a@gmail.com>', SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'a@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop' });
    const { sendEmail } = await import('../../netlify/lib/email');
    const res = await sendEmail({ to: 'x@test.in', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' });
    expect(res).toEqual({ provider: 'smtp', id: '<abc@gmail.com>' });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'a@gmail.com', pass: 'abcdefghijklmnop' } }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'DLMP <a@gmail.com>', to: 'x@test.in', subject: 'Hi' }));
  });

  it('uses STARTTLS on port 587', async () => {
    Object.assign(process.env, { EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'a@x.in', SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_USER: 'u', SMTP_PASS: 'p' });
    const { sendEmail } = await import('../../netlify/lib/email');
    await sendEmail({ to: 'x@test.in', subject: 's', text: 't', html: 'h' });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false, requireTLS: true }));
  });

  it('refuses to send when nothing is configured', async () => {
    const { sendEmail, emailConfigured } = await import('../../netlify/lib/email');
    expect(emailConfigured()).toBe(false);
    await expect(sendEmail({ to: 'x@test.in', subject: 's', text: 't', html: 'h' })).rejects.toThrow('email_not_configured');
  });
});
