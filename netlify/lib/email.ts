import nodemailer from 'nodemailer';

/**
 * Transactional email through a configurable provider.
 *  EMAIL_PROVIDER = resend | sendgrid | brevo  → EMAIL_API_KEY (HTTPS API)
 *  EMAIL_PROVIDER = smtp                       → SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *                                                (works with Gmail + App Password: free, ~500/day)
 *  EMAIL_FROM="Name <addr@domain>" — for Gmail this must be the Gmail address itself.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Display name shown to the recipient, e.g. "Muthu (via Ezofis)". The address stays EMAIL_FROM's. */
  fromName?: string;
  /** Where replies go (e.g. the person who sent the invitation). */
  replyTo?: string;
}

export interface EmailResult {
  provider: string;
  id: string | null;
}

export function emailProvider(): string {
  return (process.env.EMAIL_PROVIDER ?? 'resend').toLowerCase();
}

export function emailConfigured(): boolean {
  if (!process.env.EMAIL_FROM) return false;
  if (emailProvider() === 'smtp') return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  return Boolean(process.env.EMAIL_API_KEY);
}

let transport: nodemailer.Transporter | null = null;

/** Reused SMTP connection (port 465 = implicit TLS, 587 = STARTTLS). */
function smtpTransport(): nodemailer.Transporter {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT ?? 465);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: (process.env.SMTP_PASS ?? '').replace(/\s+/g, '') },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
  return transport;
}

function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: from.trim() };
}

/** Display names cannot carry quotes, angle brackets or line breaks (header injection). */
export function cleanDisplayName(name: string | null | undefined): string | undefined {
  const v = (name ?? '').replace(/[\r\n"<>\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return v || undefined;
}

/** "Muthu (via Ezofis)" — or just the company when the sender has no name. */
export function viaName(person: string | null | undefined, company: string | null | undefined): string | undefined {
  const p = cleanDisplayName(person);
  const c = cleanDisplayName(company);
  if (p && c) return `${p} (via ${c})`;
  return p ?? c;
}

/** EMAIL_FROM's address with an optional per-message display name. */
export function senderFor(message: Pick<EmailMessage, 'fromName'>, from = process.env.EMAIL_FROM ?? ''): { name?: string; email: string; header: string } {
  const base = parseFrom(from);
  const name = cleanDisplayName(message.fromName) ?? base.name;
  return { name, email: base.email, header: name ? `"${name}" <${base.email}>` : base.email };
}

const cleanReplyTo = (v: string | undefined) => (v && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) ? v : undefined);

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  if (!emailConfigured()) throw new Error('email_not_configured');
  const provider = emailProvider();
  const s = senderFor(message);
  const from = s.header;
  const sender = { name: s.name, email: s.email };
  const replyTo = cleanReplyTo(message.replyTo);

  if (provider === 'smtp') {
    const info = await smtpTransport().sendMail({ from, to: message.to, replyTo, subject: message.subject, text: message.text, html: message.html });
    return { provider: 'smtp', id: info.messageId ?? null };
  }

  const apiKey = process.env.EMAIL_API_KEY as string;

  let res: Response;
  if (provider === 'resend') {
    res = await post('https://api.resend.com/emails', { Authorization: `Bearer ${apiKey}` }, {
      from,
      to: [message.to],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } else if (provider === 'sendgrid') {
    res = await post('https://api.sendgrid.com/v3/mail/send', { Authorization: `Bearer ${apiKey}` }, {
      personalizations: [{ to: [{ email: message.to }] }],
      from: sender,
      ...(replyTo ? { reply_to: { email: replyTo } } : {}),
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        { type: 'text/html', value: message.html },
      ],
    });
  } else if (provider === 'brevo') {
    res = await post('https://api.brevo.com/v3/smtp/email', { 'api-key': apiKey }, {
      sender,
      to: [{ email: message.to }],
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      subject: message.subject,
      textContent: message.text,
      htmlContent: message.html,
    });
  } else {
    throw new Error(`unsupported_email_provider:${provider}`);
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`${provider}_error_${res.status}: ${detail}`);
  }
  let id: string | null = res.headers.get('x-message-id');
  try {
    const data = (await res.json()) as { id?: string; messageId?: string };
    id = data.id ?? data.messageId ?? id;
  } catch {
    // SendGrid returns 202 with an empty body.
  }
  return { provider, id };
}
