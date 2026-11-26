import { describe, expect, it } from 'vitest';
import { hrmsTarget } from '@shared/hrmsLink';

describe('Open HRMS', () => {
  it('opens the built-in HRMS when the company has no address of its own', () => {
    expect(hrmsTarget(null, true)).toEqual({ external: false, href: '/portal/hr' });
    expect(hrmsTarget('', false)).toEqual({ external: false, href: '/portal/attendance' });
  });

  it("uses a company's own web address, but nothing that is not a web address", () => {
    expect(hrmsTarget(' https://hr.customer.in/login ', true)).toEqual({ external: true, href: 'https://hr.customer.in/login' });
    expect(hrmsTarget('javascript:alert(1)', true)).toEqual({ external: false, href: '/portal/hr' });
  });
});
