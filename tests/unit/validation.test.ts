import { describe, expect, it } from 'vitest';
import { companyProfileSchema, demoBookingSchema, leadFormSchema, publicLeadSchema, resetPasswordSchema, trialSignupSchema } from '@shared/schemas';

/** First message per field — the same one react-hook-form's zodResolver shows. */
const messages = (r: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) => {
  const out: Record<string, string> = {};
  for (const i of r.error?.issues ?? []) out[i.path.join('.')] ??= i.message;
  return out;
};

describe('public lead form validation', () => {
  const valid = { company_name: 'Acme Textiles', contact_person: 'Priya', phone: '9876543210', consent: true };

  it('accepts a minimal valid enquiry and applies defaults', () => {
    const r = publicLeadSchema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ source: 'website', language: 'en', interested_features: [], whatsapp_opt_in: false });
  });

  it('returns translatable error keys', () => {
    const r = publicLeadSchema.safeParse({ company_name: '', contact_person: 'x', phone: '123', email: 'nope', consent: false });
    expect(messages(r)).toMatchObject({ company_name: 'validation.required', phone: 'validation.phone', email: 'validation.email', consent: 'validation.consent' });
  });

  it('requires explicit consent', () => {
    expect(publicLeadSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
  });

  it('caps field lengths', () => {
    expect(messages(publicLeadSchema.safeParse({ ...valid, company_name: 'x'.repeat(161) })).company_name).toBe('validation.tooLong');
  });

  it('treats empty optional fields as absent', () => {
    const r = publicLeadSchema.safeParse({ ...valid, email: '', city: '', employee_count: '' });
    expect(r.success && r.data.email).toBeUndefined();
    expect(r.success && r.data.employee_count).toBeUndefined();
  });
});

describe('demo booking validation', () => {
  it('requires an ISO slot and email', () => {
    const r = demoBookingSchema.safeParse({ contact_name: 'A', company_name: 'B', phone: '9876543210', email: '', starts_at: 'tomorrow', consent: true });
    expect(messages(r)).toMatchObject({ email: 'validation.required', starts_at: 'validation.slot' });
  });
});

describe('trial signup validation', () => {
  it('enforces password strength', () => {
    const base = { company_name: 'Acme', contact_name: 'P', email: 'p@acme.in', phone: '9876543210', consent: true };
    expect(messages(trialSignupSchema.safeParse({ ...base, password: 'short1' })).password).toBe('validation.passwordMin');
    expect(messages(trialSignupSchema.safeParse({ ...base, password: 'onlyletters' })).password).toBe('validation.passwordStrength');
    expect(trialSignupSchema.safeParse({ ...base, password: 'Strong123' }).success).toBe(true);
  });

  it('checks matching passwords on reset', () => {
    expect(messages(resetPasswordSchema.safeParse({ password: 'Strong123', confirm: 'Strong124' })).confirm).toBe('validation.passwordMatch');
  });
});

describe('staff lead form', () => {
  it('normalises blanks to null and validates the follow-up date', () => {
    const r = leadFormSchema.safeParse({ company_name: 'A', contact_person: 'B', phone: '9876543210', source: 'website', priority: 'high', status: 'new', assigned_to: '', next_follow_up_at: '', expected_value: '' });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ assigned_to: null, next_follow_up_at: null, expected_value: null });
    expect(leadFormSchema.safeParse({ company_name: 'A', contact_person: 'B', phone: '9876543210', source: 'website', priority: 'high', status: 'nope' }).success).toBe(false);
  });
});

describe('company profile', () => {
  it('validates GSTIN and PIN code formats', () => {
    const base = { name: 'Acme', default_language: 'ta' as const };
    expect(companyProfileSchema.safeParse({ ...base, gst_number: '33AAAAA0000A1Z5', pincode: '627001' }).success).toBe(true);
    const r = companyProfileSchema.safeParse({ ...base, gst_number: 'ABC', pincode: '62700' });
    expect(messages(r)).toMatchObject({ gst_number: 'validation.gst', pincode: 'validation.pincode' });
  });
});
