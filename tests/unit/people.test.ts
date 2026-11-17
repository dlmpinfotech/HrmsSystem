import { describe, expect, it } from 'vitest';
import { mergePeople } from '@/features/customers/people';
import { companyPersonSchema } from '@shared/schemas';

const contact = (id: string, name: string, email: string | null, primary = false) =>
  ({ id, company_id: 'c', name, designation: null, email, phone: null, is_primary: primary, whatsapp_opt_in: false }) as never;
const member = (userId: string, email: string, role: 'customer_admin' | 'customer_user', name = '') =>
  ({ id: `m${userId}`, company_id: 'c', user_id: userId, role, created_at: '', profiles: { id: userId, full_name: name, email, is_active: true } }) as never;
const invite = (id: string, email: string) => ({ id, email, role_key: 'customer_user', company_id: 'c', status: 'pending', created_at: '' }) as never;

describe('combined Users list', () => {
  it('matches contacts to portal accounts and invitations by email (case-insensitive)', () => {
    const rows = mergePeople(
      [contact('1', 'Muthu', 'Muthu@Ezofis.com', true), contact('2', 'Priya', 'priya@ezofis.com'), contact('3', 'Ravi', null)],
      [member('u1', 'muthu@ezofis.com', 'customer_admin')],
      [invite('i1', 'PRIYA@ezofis.com')],
    );
    expect(rows.map((r) => [r.name, r.member?.role ?? null, r.invite ? 'invited' : null])).toEqual([
      ['Muthu', 'customer_admin', null],
      ['Priya', null, 'invited'],
      ['Ravi', null, null],
    ]);
  });

  it('lists portal users and invitations that have no contact record', () => {
    const rows = mergePeople([], [member('u2', 'kumar@ezofis.com', 'customer_user', 'Kumar')], [invite('i2', 'new@ezofis.com')]);
    expect(rows.map((r) => r.name)).toEqual(['Kumar', 'new@ezofis.com']);
    expect(rows[0].contactId).toBeNull();
  });

  it('puts the primary contact first', () => {
    const rows = mergePeople([contact('1', 'Anbu', null), contact('2', 'Zara', null, true)], [], []);
    expect(rows[0].name).toBe('Zara');
  });
});

describe('Add user form validation', () => {
  it('requires an email only when portal access is given', () => {
    expect(companyPersonSchema.safeParse({ name: 'Ravi', portal_access: false }).success).toBe(true);
    const r = companyPersonSchema.safeParse({ name: 'Ravi', portal_access: true, email: '' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ path: ['email'], message: 'validation.emailForAccess' });
  });

  it('validates an optional phone number', () => {
    expect(companyPersonSchema.safeParse({ name: 'Ravi', phone: '' }).success).toBe(true);
    expect(companyPersonSchema.safeParse({ name: 'Ravi', phone: '12345' }).success).toBe(false);
    expect(companyPersonSchema.safeParse({ name: 'Ravi', phone: '98765 43210' }).success).toBe(true);
  });
});
