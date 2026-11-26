import { describe, expect, it } from 'vitest';
import { payslipEmail } from '../../netlify/lib/payslipEmail';

const slip = {
  id: 's1', period: '2026-10-01', employee_code: 'A1', employee_name: 'Anbu <script>', department: 'Weaving', designation: null,
  days_in_month: 31, paid_days: '27.5', lop_days: '3.5', basic: '17742', hra: '7097', conveyance: '0', special_allowance: '1774', other_allowance: '0',
  gross: '26613', pf_employee: '1800', esi_employee: '0', professional_tax: '208', tds: '0', other_deduction: '0', total_deductions: '2008', net_pay: '24605',
};

describe('payslip email', () => {
  it('shows the month, net pay in words and only non-zero lines, with HTML escaped', () => {
    const m = payslipEmail(slip, { companyName: 'Ezofis', lang: 'en', portalUrl: 'https://app.example.com/portal/payslips' });
    expect(m.subject).toBe('Payslip for October 2026 · Ezofis');
    expect(m.text).toContain('Net pay: ₹24,605.00 (Rupees Twenty-Four Thousand Six Hundred Five only)');
    expect(m.text).toContain('Paid days 27.5 of 31 · LOP 3.5');
    expect(m.text).not.toContain('ESI');
    expect(m.html).toContain('Anbu &lt;script&gt;');
    expect(m.html).not.toContain('<script>');
  });

  it('speaks Tamil for Tamil companies and ignores a bad accent colour', () => {
    const m = payslipEmail(slip, { companyName: 'Ezofis', lang: 'ta', portalUrl: 'https://x', accent: 'red;background:url(x)' });
    expect(m.subject).toContain('சம்பளச் சீட்டு');
    expect(m.html).toContain('#4f46e5');
    expect(m.html).not.toContain('url(x)');
  });
});
