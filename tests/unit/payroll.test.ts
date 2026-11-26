import { describe, expect, it } from 'vitest';
import { computeSlip, DEFAULT_PAYROLL_SETTINGS, ptForHalfYear, rupeesInWords, TN_PT_SLABS, type StructureLite } from '@shared/payroll';

const s = (x: Partial<StructureLite>): StructureLite => ({
  basic: 0, hra: 0, conveyance: 0, special_allowance: 0, other_allowance: 0, other_deduction: 0, tds_monthly: 0,
  pf_applicable: true, esi_applicable: true, pt_applicable: true, ...x,
});

describe('payroll maths (mirrors generate_payroll)', () => {
  it('pro-rates for LOP and caps PF at the wage ceiling', () => {
    const slip = computeSlip(s({ basic: 20000, hra: 8000, special_allowance: 2000 }), DEFAULT_PAYROLL_SETTINGS, 27.5, 31, 10);
    expect(slip).toMatchObject({ basic: 17742, hra: 7097, special_allowance: 1774, gross: 26613, pf_employee: 1800, esi_employee: 0, professional_tax: 0, net_pay: 24813 });
  });

  it('applies ESI below the wage limit, rounding up', () => {
    const slip = computeSlip(s({ basic: 10000, hra: 4000, conveyance: 1600 }), DEFAULT_PAYROLL_SETTINGS, 16, 31, 10);
    expect(slip).toMatchObject({ gross: 8052, pf_employee: 619, esi_employee: 61, esi_employer: 262, net_pay: 7372 });
  });

  it('charges Tamil Nadu PT in March and September (half-yearly) or every month', () => {
    const st = s({ basic: 20000, hra: 10000 });
    expect(computeSlip(st, DEFAULT_PAYROLL_SETTINGS, 30, 30, 9).professional_tax).toBe(1250);
    expect(computeSlip(st, DEFAULT_PAYROLL_SETTINGS, 31, 31, 10).professional_tax).toBe(0);
    expect(computeSlip(st, { ...DEFAULT_PAYROLL_SETTINGS, pt_frequency: 'monthly' }, 31, 31, 10).professional_tax).toBe(208);
  });

  it('looks up PT slabs by half-yearly income', () => {
    expect(ptForHalfYear(TN_PT_SLABS, 21000)).toBe(0);
    expect(ptForHalfYear(TN_PT_SLABS, 21001)).toBe(180);
    expect(ptForHalfYear(TN_PT_SLABS, 60000)).toBe(930);
    expect(ptForHalfYear(TN_PT_SLABS, 1_000_000)).toBe(1250);
  });

  it('respects per-employee opt-outs, TDS and other deductions', () => {
    const slip = computeSlip(s({ basic: 12000, tds_monthly: 500, other_deduction: 300, pf_applicable: false, esi_applicable: false, pt_applicable: false }), DEFAULT_PAYROLL_SETTINGS, 30, 30, 9);
    expect(slip).toMatchObject({ gross: 12000, pf_employee: 0, esi_employee: 0, professional_tax: 0, total_deductions: 800, net_pay: 11200 });
  });

  it('adds leave encashment to gross without ESI on it', () => {
    const slip = computeSlip(s({ basic: 13000 }), { ...DEFAULT_PAYROLL_SETTINGS, pt_enabled: false }, 31, 31, 12, 5000);
    expect(slip).toMatchObject({ leave_encashment: 5000, gross: 18000, pf_employee: 1560, esi_employee: 98, net_pay: 16342 });
  });

  it('writes amounts in Indian words', () => {
    expect(rupeesInWords(24813)).toBe('Twenty-Four Thousand Eight Hundred Thirteen');
    expect(rupeesInWords(1250000)).toBe('Twelve Lakh Fifty Thousand');
    expect(rupeesInWords(0)).toBe('Zero');
  });
});
