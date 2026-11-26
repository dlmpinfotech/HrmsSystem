import { useQuery } from '@tanstack/react-query';
import { sb, unwrap } from '@/lib/supabase';
import { DEFAULT_PAYROLL_SETTINGS, type PayrollSettingsLite } from '@shared/payroll';

export interface PayrollRun {
  id: string;
  company_id: string;
  period: string;
  status: 'draft' | 'finalized';
  employee_count: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  total_employer_cost: number;
  generated_at: string | null;
  finalized_at: string | null;
}

export interface Payslip {
  id: string;
  run_id: string;
  company_id: string;
  employee_id: string;
  period: string;
  employee_code: string;
  employee_name: string;
  department: string | null;
  designation: string | null;
  days_in_month: number;
  paid_days: number;
  lop_days: number;
  basic: number;
  hra: number;
  conveyance: number;
  special_allowance: number;
  other_allowance: number;
  leave_encashment: number;
  gross: number;
  pf_employee: number;
  esi_employee: number;
  professional_tax: number;
  tds: number;
  other_deduction: number;
  total_deductions: number;
  net_pay: number;
  pf_employer: number;
  esi_employer: number;
  emailed_at: string | null;
  email_error: string | null;
}

export interface SalaryStructure {
  id: string;
  company_id: string;
  employee_id: string;
  effective_from: string;
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
  note: string | null;
}

export type PayrollSettings = PayrollSettingsLite & { company_id: string; encash_basis?: 'basic' | 'gross'; encash_divisor?: number };

const NUMERIC_SLIP: (keyof Payslip)[] = ['paid_days', 'lop_days', 'basic', 'hra', 'conveyance', 'special_allowance', 'other_allowance', 'leave_encashment', 'gross', 'pf_employee', 'esi_employee', 'professional_tax', 'tds', 'other_deduction', 'total_deductions', 'net_pay', 'pf_employer', 'esi_employer'];
const NUMERIC_STRUCT: (keyof SalaryStructure)[] = ['basic', 'hra', 'conveyance', 'special_allowance', 'other_allowance', 'other_deduction', 'tds_monthly'];
const NUMERIC_RUN: (keyof PayrollRun)[] = ['total_gross', 'total_deductions', 'total_net', 'total_employer_cost'];

/** Postgres numerics arrive as strings — turn the money columns into numbers. */
function nums<T>(row: T, keys: (keyof T)[]): T {
  const out = { ...row } as Record<string, unknown>;
  for (const k of keys) out[k as string] = Number(out[k as string] ?? 0);
  return out as T;
}

export const payrollKeys = {
  runs: (companyId: string) => ['payroll', 'runs', companyId] as const,
  slips: (runId: string) => ['payroll', 'slips', runId] as const,
  slip: (id: string) => ['payroll', 'slip', id] as const,
  mine: (employeeId: string) => ['payroll', 'mine', employeeId] as const,
  structures: (companyId: string) => ['payroll', 'structures', companyId] as const,
  settings: (companyId: string) => ['payroll', 'settings', companyId] as const,
};

export function usePayrollRuns(companyId: string | undefined) {
  return useQuery({
    queryKey: payrollKeys.runs(companyId ?? ''),
    enabled: Boolean(companyId),
    queryFn: async () => (unwrap(await sb().from('payroll_runs').select('*').eq('company_id', companyId!).order('period', { ascending: false })) as PayrollRun[]).map((r) => nums(r, NUMERIC_RUN)),
  });
}

export function usePayslips(runId: string | undefined) {
  return useQuery({
    queryKey: payrollKeys.slips(runId ?? ''),
    enabled: Boolean(runId),
    queryFn: async () => (unwrap(await sb().from('payslips').select('*').eq('run_id', runId!).order('employee_code')) as Payslip[]).map((p) => nums(p, NUMERIC_SLIP)),
  });
}

export function usePayslip(id: string | undefined) {
  return useQuery({
    queryKey: payrollKeys.slip(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => nums(unwrap(await sb().from('payslips').select('*').eq('id', id!).single()) as Payslip, NUMERIC_SLIP),
  });
}

/** The signed-in employee's finalized payslips (RLS hides drafts). */
export function useMyPayslips(employeeId: string | undefined) {
  return useQuery({
    queryKey: payrollKeys.mine(employeeId ?? ''),
    enabled: Boolean(employeeId),
    queryFn: async () => (unwrap(await sb().from('payslips').select('*').eq('employee_id', employeeId!).order('period', { ascending: false }).limit(60)) as Payslip[]).map((p) => nums(p, NUMERIC_SLIP)),
  });
}

export function useSalaryStructures(companyId: string | undefined) {
  return useQuery({
    queryKey: payrollKeys.structures(companyId ?? ''),
    enabled: Boolean(companyId),
    queryFn: async () =>
      (unwrap(await sb().from('salary_structures').select('*').eq('company_id', companyId!).order('effective_from', { ascending: false })) as SalaryStructure[]).map((s) => nums(s, NUMERIC_STRUCT)),
  });
}

export function usePayrollSettings(companyId: string | undefined) {
  return useQuery({
    queryKey: payrollKeys.settings(companyId ?? ''),
    enabled: Boolean(companyId),
    queryFn: async () => {
      const row = unwrap(await sb().from('payroll_settings').select('*').eq('company_id', companyId!).maybeSingle()) as Record<string, unknown> | null;
      const base = { ...DEFAULT_PAYROLL_SETTINGS, ...(row ?? {}), company_id: companyId! } as Record<string, unknown>;
      for (const k of ['pf_employee_rate', 'pf_employer_rate', 'pf_wage_ceiling', 'esi_employee_rate', 'esi_employer_rate', 'esi_wage_limit']) base[k] = Number(base[k]);
      return { settings: base as unknown as PayrollSettings, saved: Boolean(row) };
    },
  });
}

/** The structure in force on a date (latest effective_from ≤ date). */
export function structureOn(all: SalaryStructure[], employeeId: string, date: string): SalaryStructure | undefined {
  return all.filter((s) => s.employee_id === employeeId && s.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
}
