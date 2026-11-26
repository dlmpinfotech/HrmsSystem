/**
 * Payroll maths shared by the UI (previews) and tests. The database's
 * generate_payroll() (0011) is the source of truth; this mirrors it.
 */

export interface PtSlab {
  upto: number | null;
  tax: number;
}

export interface PayrollSettingsLite {
  pf_enabled: boolean;
  pf_employee_rate: number;
  pf_employer_rate: number;
  pf_wage_ceiling: number;
  pf_cap_at_ceiling: boolean;
  esi_enabled: boolean;
  esi_employee_rate: number;
  esi_employer_rate: number;
  esi_wage_limit: number;
  pt_enabled: boolean;
  pt_frequency: 'half_yearly' | 'monthly';
  pt_slabs: PtSlab[];
}

export interface StructureLite {
  basic: number;
  hra: number;
  conveyance: number;
  special_allowance: number;
  other_allowance: number;
  other_deduction: number;
  tds_monthly: number;
  pf_applicable: boolean;
  esi_applicable: boolean;
  pt_applicable: boolean;
}

/** Tamil Nadu professional tax (2024 revision), half-yearly income → half-yearly tax. */
export const TN_PT_SLABS: PtSlab[] = [
  { upto: 21000, tax: 0 },
  { upto: 30000, tax: 180 },
  { upto: 45000, tax: 425 },
  { upto: 60000, tax: 930 },
  { upto: 75000, tax: 1025 },
  { upto: null, tax: 1250 },
];

export const DEFAULT_PAYROLL_SETTINGS: PayrollSettingsLite = {
  pf_enabled: true,
  pf_employee_rate: 12,
  pf_employer_rate: 12,
  pf_wage_ceiling: 15000,
  pf_cap_at_ceiling: true,
  esi_enabled: true,
  esi_employee_rate: 0.75,
  esi_employer_rate: 3.25,
  esi_wage_limit: 21000,
  pt_enabled: true,
  pt_frequency: 'half_yearly',
  pt_slabs: TN_PT_SLABS,
};

export function ptForHalfYear(slabs: PtSlab[], income: number): number {
  for (const s of slabs) if (s.upto === null || income <= s.upto) return s.tax;
  return 0;
}

/** Postgres round(): half away from zero. */
const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));
const n = (v: unknown) => Number(v ?? 0);

export interface SlipNumbers {
  leave_encashment: number;
  basic: number;
  hra: number;
  conveyance: number;
  special_allowance: number;
  other_allowance: number;
  gross: number;
  pf_employee: number;
  pf_employer: number;
  esi_employee: number;
  esi_employer: number;
  professional_tax: number;
  tds: number;
  other_deduction: number;
  total_deductions: number;
  net_pay: number;
  employer_cost: number;
}

/**
 * One month's payslip numbers. `paidDays / daysInMonth` pro-rates earnings;
 * `month` (1–12) decides whether half-yearly PT is due (March and September).
 */
export function computeSlip(s: StructureLite, set: PayrollSettingsLite, paidDays: number, daysInMonth: number, month: number, leaveEncashment = 0): SlipNumbers {
  const f = daysInMonth > 0 ? paidDays / daysInMonth : 0;
  const basic = round(n(s.basic) * f);
  const hra = round(n(s.hra) * f);
  const conveyance = round(n(s.conveyance) * f);
  const special_allowance = round(n(s.special_allowance) * f);
  const other_allowance = round(n(s.other_allowance) * f);
  const wages = basic + hra + conveyance + special_allowance + other_allowance;
  const leave_encashment = n(leaveEncashment);
  const gross = wages + leave_encashment;
  const full = n(s.basic) + n(s.hra) + n(s.conveyance) + n(s.special_allowance) + n(s.other_allowance);

  let pf_employee = 0;
  let pf_employer = 0;
  if (set.pf_enabled && s.pf_applicable) {
    const wage = set.pf_cap_at_ceiling ? Math.min(basic, n(set.pf_wage_ceiling)) : basic;
    pf_employee = round((wage * n(set.pf_employee_rate)) / 100);
    pf_employer = round((wage * n(set.pf_employer_rate)) / 100);
  }

  let esi_employee = 0;
  let esi_employer = 0;
  // Leave encashment is not ESI wages.
  if (set.esi_enabled && s.esi_applicable && full <= n(set.esi_wage_limit) && wages > 0) {
    // Round to cents first so binary floating point never pushes an exact amount up a rupee.
    esi_employee = Math.ceil(Math.round(wages * n(set.esi_employee_rate)) / 100);
    esi_employer = Math.ceil(Math.round(wages * n(set.esi_employer_rate)) / 100);
  }

  let professional_tax = 0;
  if (set.pt_enabled && s.pt_applicable && wages > 0) {
    const tax = ptForHalfYear(set.pt_slabs, full * 6);
    professional_tax = set.pt_frequency === 'monthly' ? round(tax / 6) : month === 3 || month === 9 ? tax : 0;
  }

  const tds = n(s.tds_monthly);
  const other_deduction = n(s.other_deduction);
  const total_deductions = pf_employee + esi_employee + professional_tax + tds + other_deduction;
  return {
    leave_encashment, basic, hra, conveyance, special_allowance, other_allowance, gross,
    pf_employee, pf_employer, esi_employee, esi_employer, professional_tax, tds, other_deduction,
    total_deductions,
    net_pay: Math.max(gross - total_deductions, 0),
    employer_cost: gross + pf_employer + esi_employer,
  };
}

/** "2026-10-01" → number of days in that month. */
export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Indian rupee amount in words, e.g. 24813 → "Twenty-Four Thousand Eight Hundred Thirteen". */
export function rupeesInWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? `-${ones[x % 10]}` : ''}`);
  const three = (x: number) => [x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred` : '', two(x % 100)].filter(Boolean).join(' ');
  let v = Math.round(Math.abs(amount));
  if (v === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(v / 10_000_000);
  v %= 10_000_000;
  const lakh = Math.floor(v / 100_000);
  v %= 100_000;
  const thousand = Math.floor(v / 1000);
  v %= 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (v) parts.push(three(v));
  return parts.join(' ');
}
