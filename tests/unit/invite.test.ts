import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn();
let configured = true;
vi.mock('../../netlify/lib/email', () => ({
  emailConfigured: () => configured,
  emailProvider: () => 'smtp',
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));
vi.mock('../../netlify/lib/settings', () => ({ getBrand: async () => ({ name: 'HRMS Cloud' }) }));

import { sendInvitation } from '../../netlify/lib/invite';

function fakeDb() {
  const inserted: unknown[] = [];
  const auth = {
    admin: {
      generateLink: vi.fn(async () => ({ data: { user: { id: 'u1' }, properties: { action_link: 'https://x.supabase.co/auth/v1/verify?token=abc' } }, error: null })),
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

const input = { email: 'hr@ezofis.com', fullName: 'Dhana', companyId: 'c1', redirectTo: 'https://site/reset-password?invite=1' };

beforeEach(() => {
  sendEmail.mockReset();
  configured = true;
});

describe('portal invitations', () => {
  it("sends the invite link through the app's own email (not Supabase's rate-limited mailer)", async () => {
    sendEmail.mockResolvedValue({ provider: 'smtp', id: 'm1' });
    const { db, auth, inserted } = fakeDb();
    const res = await sendInvitation(db, input);
    expect(res.via).toBe('smtp');
    expect(auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
    expect(auth.admin.generateLink).toHaveBeenCalledWith(expect.objectContaining({ type: 'invite', email: 'hr@ezofis.com' }));
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('hr@ezofis.com');
    expect(mail.text).toContain('https://x.supabase.co/auth/v1/verify?token=abc');
    expect(mail.subject).toContain('Ezofis');
    // The log keeps a record but never stores the secret link.
    expect(JSON.stringify(inserted)).not.toContain('token=abc');
  });

  it('removes the half-created login if the email cannot be sent', async () => {
    sendEmail.mockRejectedValue(new Error('smtp down'));
    const { db, auth } = fakeDb();
    await expect(sendInvitation(db, input)).rejects.toThrow('smtp down');
    expect(auth.admin.deleteUser).toHaveBeenCalledWith('u1');
  });

  it("falls back to Supabase's mailer when no app email is configured", async () => {
    configured = false;
    const { db, auth } = fakeDb();
    expect((await sendInvitation(db, input)).via).toBe('supabase');
    expect(auth.admin.inviteUserByEmail).toHaveBeenCalled();
  });
});
