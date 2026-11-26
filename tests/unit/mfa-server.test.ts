import { describe, expect, it } from 'vitest';
import { needsSecondStep } from '../../netlify/lib/auth';

const token = (aal: string) => `x.${Buffer.from(JSON.stringify({ aal })).toString('base64url')}.y`;
const on = [{ status: 'verified' }];

describe('two-step sign-in on server functions', () => {
  it('is not asked of people without a confirmed authenticator', () => {
    expect(needsSecondStep(token('aal1'), undefined)).toBe(false);
    expect(needsSecondStep(token('aal1'), [{ status: 'unverified' }])).toBe(false);
  });

  it('refuses a password-only or unreadable token once it is on', () => {
    expect(needsSecondStep(token('aal1'), on)).toBe(true);
    expect(needsSecondStep('garbage', on)).toBe(true);
    expect(needsSecondStep(token('aal2'), on)).toBe(false);
  });
});
