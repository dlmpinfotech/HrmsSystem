import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn();
let configured = true;
vi.mock('../../netlify/lib/email', async (orig) => {
  const real = await orig<typeof import('../../netlify/lib/email')>();
  return {
    viaName: real.viaName,
    senderFor: real.senderFor,
    emailConfigured: () => configured,
    emailProvider: () => 'smtp',
    sendEmail: (...args: unknown[]) => sendEmail(...args),
  };
});
vi.mock('../../netlify/lib/settings', () => ({ getBrand: async () => ({ name: 'HRMS Cloud' }) }));

import { senderFor, viaName } from '../../netlify/lib/email';
import { sendAccessEmail, sendInvitation } from '../../netlify/lib/invite';

function fakeDb() {
  const inserted: unknown[] = [];
  const auth = {
    admin: {
      generateLink: vi.fn(async () => ({ data: { user: { id: 'u1' }, properties: { action_link: 'https://x.supabase.co/auth/v1/verify?token=abc', hashed_token: 'hash123' } }, error: null })),
      inviteUserByEmail: vi.fn(async () => ({ data: {}, error: null })),
      deleteUser: vi.fn(async () => ({ error: null })),
    },
  };
  const from = vi.fn((table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: table === 'companies' ? { name: 'Ezofis', default_language: 'en' } : null }) }) }),
    insert: (row: unknown) => {
      inserted.push(row);
      return Promise.resolve({ error: null });
    },
  }));
  return { db: { auth, from } as never, auth, inserted };
}

const input = { email: 'hr@ezofis.com', fullName: 'Dhana', companyId: 'c1', siteUrl: 'https://app.example.com', inviter: { name: 'Muthu', email: 'muthu@ezofis.com' } };

beforeEach(() => {
  sendEmail.mockReset();
  configured = true;
});

describe('portal invitations', () => {
  it('sends from "Muthu (via Ezofis)" over SMTP with a link to this site, not the database host', async () => {
    sendEmail.mockResolvedValue({ provider: 'smtp', id: 'm1' });
    const { db, auth, inserted } = fakeDb();
    const res = await sendInvitation(db, input);
    expect(res.via).toBe('smtp');
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.admin.generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite', email: 'hr@ezofis.com' }));
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('hr@ezofis.com');
    expect(mail.fromName).toBe('Muthu (via Ezofis)');
    expect(mail.replyTo).toBe('muthu@ezofis.com');
    expect(mail.text).toContain('https://app.example.com/reset-password?invite=1&type=invite&token_hash=hash123');
    expect(mail.text).not.toContain('supabase.co');
    expect(mail.subject).toBe('Muthu invited you to Ezofis');
    // The log keeps a record but never stores the secret link.
    expect(JSON.stringify(inserted)).not.toContain('hash123');
  });

  it('removes the half-created login if the email cannot be sent', async () => {
    sendEmail.mockRejectedValue(new Error('smtp down'));
    const { db, auth } = fakeDb();
    await expect(sendInvitation(db, input)).rejects.toThrow('smtp down');
    expect(auth.admin.deleteUser).toHaveBeenCalledWith('u1');
  });

  it("never uses Supabase's own mailer — fails clearly when SMTP is not set up", async () => {
    configured = false;
    const { db, auth } = fakeDb();
    await expect(sendInvitation(db, input)).rejects.toThrow('email_not_configured');
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('emails people who already have a login that they now have access', async () => {
    sendEmail.mockResolvedValue({ provider: 'smtp', id: 'm2' });
    const { db } = fakeDb();
    await sendAccessEmail(db, input);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.fromName).toBe('Muthu (via Ezofis)');
    expect(mail.text).toContain('https://app.example.com/login');
  });
});

describe('sender name', () => {
  it('keeps the SMTP address and only changes the display name', () => {
    expect(viaName('Muthu', 'Ezofis')).toBe('Muthu (via Ezofis)');
    expect(viaName(null, 'Ezofis')).toBe('Ezofis');
    expect(senderFor({ fromName: 'Muthu (via Ezofis)' }, 'DLMP HRMS <hr@gmail.com>').header).toBe('"Muthu (via Ezofis)" <hr@gmail.com>');
    expect(senderFor({}, 'DLMP HRMS <hr@gmail.com>').header).toBe('"DLMP HRMS" <hr@gmail.com>');
    // No header injection through a name.
    expect(senderFor({ fromName: 'Evil"\r\nBcc: x@y.z <a>' }, 'hr@gmail.com').header).toBe('"Evil Bcc: x@y.z a" <hr@gmail.com>');
  });
});
