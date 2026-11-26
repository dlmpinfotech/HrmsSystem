import { describe, expect, it } from 'vitest';
import { buildPersonas, personaHome } from '@/features/auth/AuthProvider';

const m = (company_id: string, role: 'customer_admin' | 'hr_manager' | 'customer_user' | 'employee', name = 'Ezofis') => ({ company_id, role, companies: { name } });

describe('account types for one login', () => {
  it('offers HR and Employee when an HR Manager also has an employee record', () => {
    const p = buildPersonas(false, [m('c1', 'hr_manager')], [{ company_id: 'c1', employee_code: 'EMP0002' }]);
    expect(p.map((x) => x.kind)).toEqual(['hr', 'employee']);
    expect(p[1].employeeCode).toBe('EMP0002');
    expect(p.map(personaHome)).toEqual(['/portal', '/portal/attendance']);
  });

  it('offers Admin, HR and Employee to a Company Admin who is also an employee', () => {
    expect(buildPersonas(false, [m('c1', 'customer_admin')], [{ company_id: 'c1', employee_code: 'E1' }]).map((x) => x.kind)).toEqual(['admin', 'hr', 'employee']);
  });

  it('gives a plain employee just one type (no question after sign-in)', () => {
    expect(buildPersonas(false, [m('c1', 'employee')], [{ company_id: 'c1', employee_code: 'E1' }])).toHaveLength(1);
  });

  it('lists the platform team first and ignores employee records from other companies', () => {
    const p = buildPersonas(true, [m('c1', 'hr_manager')], [{ company_id: 'c2', employee_code: 'X' }]);
    expect(p.map((x) => x.key)).toEqual(['staff', 'hr:c1']);
  });
});
