import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { sb, unwrap } from '@/lib/supabase';

export interface Employee {
  id: string;
  company_id: string;
  user_id: string | null;
  employee_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  employment_type: 'full_time' | 'part_time' | 'contract' | 'intern';
  date_of_joining: string | null;
  date_of_birth: string | null;
  gender: 'male' | 'female' | 'other' | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  shift_start: string;
  shift_end: string;
  grace_minutes: number;
  weekly_offs: number[];
  status: 'active' | 'inactive' | 'exited';
  exit_date: string | null;
  reporting_manager_id: string | null;
  probation_end_date: string | null;
  contract_end_date: string | null;
  work_location: string | null;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  company_id: string;
  employee_id: string;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  check_in_location: { lat: number; lng: number; accuracy?: number } | null;
  check_out_location: { lat: number; lng: number; accuracy?: number } | null;
  source: 'self' | 'hr' | 'regularization';
  status: 'present' | 'half_day' | 'absent' | 'on_leave' | 'holiday' | 'weekly_off';
  late_minutes: number;
  work_minutes: number | null;
  notes: string | null;
  corrected_at: string | null;
  work_mode: WorkMode;
  shift_id: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  break_minutes: number;
  early_minutes: number;
  overtime_minutes: number;
  on_break_since: string | null;
}

export type WorkMode = 'office' | 'home' | 'field';
export const WORK_MODES: WorkMode[] = ['office', 'home', 'field'];

export interface LeaveType {
  id: string;
  company_id: string;
  name: string;
  code: string;
  annual_quota: number | null;
  is_paid: boolean;
  is_active: boolean;
  sort_order: number;
  accrual: 'annual' | 'monthly';
  carry_forward_max: number;
  unit: 'day' | 'hour';
  max_hours_per_month: number | null;
  approval_levels: 1 | 2;
  is_comp_off: boolean;
  encashable: boolean;
  max_encash_days: number | null;
}

export interface Holiday {
  id: string;
  company_id: string;
  holiday_date: string;
  name: string;
}

export interface LeaveRequest {
  id: string;
  company_id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  approval_step: 1 | 2;
  manager_decided_at: string | null;
  manager_note: string | null;
  comp_off_credit_id: string | null;
  employees?: Pick<Employee, 'id' | 'full_name' | 'employee_code' | 'department'> | null;
  leave_types?: Pick<LeaveType, 'id' | 'name' | 'code' | 'unit' | 'approval_levels'> | null;
}

export const hrKeys = {
  employees: (companyId: string) => ['hr', 'employees', companyId] as const,
  employee: (id: string) => ['hr', 'employee', id] as const,
  me: (companyId: string, userId: string) => ['hr', 'me', companyId, userId] as const,
  attendance: (companyId: string, from: string, to: string, employeeId?: string) => ['hr', 'attendance', companyId, from, to, employeeId ?? 'all'] as const,
  leaveTypes: (companyId: string) => ['hr', 'leave-types', companyId] as const,
  holidays: (companyId: string) => ['hr', 'holidays', companyId] as const,
  leave: (companyId: string, scope: string) => ['hr', 'leave', companyId, scope] as const,
  shifts: (companyId: string) => ['hr', 'shifts', companyId] as const,
  rotations: (companyId: string) => ['hr', 'rotations', companyId] as const,
  assignments: (companyId: string) => ['hr', 'shift-assignments', companyId] as const,
  overrides: (companyId: string, from: string, to: string) => ['hr', 'shift-overrides', companyId, from, to] as const,
  regularizations: (companyId: string, scope: string) => ['hr', 'regularizations', companyId, scope] as const,
  attention: (companyId: string) => ['hr', 'attention', companyId] as const,
  hrMembers: (companyId: string) => ['hr', 'members', companyId] as const,
  balances: (employeeId: string, year: number) => ['hr', 'balances', employeeId, year] as const,
  compOff: (companyId: string, scope: string) => ['hr', 'comp-off', companyId, scope] as const,
  teamLeave: (companyId: string, from: string, to: string) => ['hr', 'team-leave', companyId, from, to] as const,
  reports: (managerId: string) => ['hr', 'reports', managerId] as const,
  encash: (companyId: string, scope: string) => ['hr', 'encash', companyId, scope] as const,
};

/** Refreshes every HR query after a change. */
export function useInvalidateHr() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['hr'] });
}

export function useEmployees(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: hrKeys.employees(companyId ?? ''),
    enabled: Boolean(companyId) && enabled,
    queryFn: async () => unwrap(await sb().from('employees').select('*').eq('company_id', companyId!).order('employee_code')) as Employee[],
  });
}

export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: hrKeys.employee(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => unwrap(await sb().from('employees').select('*').eq('id', id!).single()) as Employee,
  });
}

/** The signed-in person's own employee record in the active company (null if they are not an employee). */
export function useMyEmployee() {
  const { activeCompany, user } = useAuth();
  return useQuery({
    queryKey: hrKeys.me(activeCompany?.id ?? '', user?.id ?? ''),
    enabled: Boolean(activeCompany && user),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().from('employees').select('*').eq('company_id', activeCompany!.id).eq('user_id', user!.id).maybeSingle();
      // Before the HRMS migration runs the table does not exist — treat as "no record".
      if (error) return null;
      return data as Employee | null;
    },
  });
}

export function useAttendance(companyId: string | undefined, from: string, to: string, employeeId?: string) {
  return useQuery({
    queryKey: hrKeys.attendance(companyId ?? '', from, to, employeeId),
    enabled: Boolean(companyId),
    queryFn: async () => {
      let q = sb().from('attendance_records').select('*').eq('company_id', companyId!).gte('work_date', from).lte('work_date', to).order('work_date');
      if (employeeId) q = q.eq('employee_id', employeeId);
      return unwrap(await q) as AttendanceRecord[];
    },
  });
}

export function useLeaveTypes(companyId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.leaveTypes(companyId ?? ''),
    enabled: Boolean(companyId),
    queryFn: async () => unwrap(await sb().from('leave_types').select('*').eq('company_id', companyId!).order('sort_order').order('name')) as LeaveType[],
  });
}

export function useHolidays(companyId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.holidays(companyId ?? ''),
    enabled: Boolean(companyId),
    queryFn: async () => unwrap(await sb().from('holidays').select('*').eq('company_id', companyId!).order('holiday_date')) as Holiday[],
  });
}

/** Leave requests: all for HR (optionally filtered), or one employee's own. */
export function useLeaveRequests(companyId: string | undefined, opts: { employeeId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: hrKeys.leave(companyId ?? '', `${opts.employeeId ?? 'all'}:${opts.status ?? 'any'}`),
    enabled: Boolean(companyId),
    queryFn: async () => {
      let q = sb()
        .from('leave_requests')
        .select('*, employees(id, full_name, employee_code, department), leave_types(id, name, code, unit, approval_levels)')
        .eq('company_id', companyId!)
        .order('start_date', { ascending: false })
        .limit(1000);
      if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
      if (opts.status) q = q.eq('status', opts.status);
      return unwrap(await q) as unknown as LeaveRequest[];
    },
  });
}

/** "HH:MM" from a Postgres time value. */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

// ── Shifts ────────────────────────────────────────────────────────────
export type ShiftColor = 'primary' | 'success' | 'warning' | 'info' | 'danger' | 'neutral';
export const SHIFT_COLORS: ShiftColor[] = ['primary', 'success', 'warning', 'info', 'danger', 'neutral'];

export interface Shift {
  id: string;
  company_id: string;
  name: string;
  code: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  early_grace_minutes: number;
  overtime_after_minutes: number;
  color: ShiftColor;
  is_active: boolean;
}

export interface ShiftRotation {
  id: string;
  company_id: string;
  name: string;
  shift_ids: string[];
  anchor_date: string;
  is_active: boolean;
}

export interface ShiftAssignment {
  id: string;
  company_id: string;
  employee_id: string;
  shift_id: string | null;
  rotation_id: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

export interface ShiftOverride {
  id: string;
  employee_id: string;
  work_date: string;
  shift_id: string | null;
  note: string | null;
}

export function useShifts(companyId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.shifts(companyId ?? ''),
    enabled: Boolean(companyId),
    queryFn: async () => unwrap(await sb().from('shifts').select('*').eq('company_id', companyId!).order('start_time')) as Shift[],
  });
}

export function useRotations(companyId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.rotations(companyId ?? ''),
    enabled: Boolean(companyId),
    queryFn: async () => unwrap(await sb().from('shift_rotations').select('*').eq('company_id', companyId!).order('name')) as ShiftRotation[],
  });
}

/** Assignments HR can see (an employee only gets their own — RLS decides). */
export function useShiftAssignments(companyId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.assignments(companyId ?? ''),
    enabled: Boolean(companyId),
    queryFn: async () => unwrap(await sb().from('shift_assignments').select('*').eq('company_id', companyId!).order('effective_from', { ascending: false })) as ShiftAssignment[],
  });
}

export function useShiftOverrides(companyId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: hrKeys.overrides(companyId ?? '', from, to),
    enabled: Boolean(companyId),
    queryFn: async () => unwrap(await sb().from('shift_overrides').select('*').eq('company_id', companyId!).gte('work_date', from).lte('work_date', to)) as ShiftOverride[],
  });
}

/** Everything resolveShift() needs for a date range, in one hook. */
export function useShiftData(companyId: string | undefined, from: string, to: string) {
  const shifts = useShifts(companyId);
  const rotations = useRotations(companyId);
  const assignments = useShiftAssignments(companyId);
  const overrides = useShiftOverrides(companyId, from, to);
  return {
    isPending: shifts.isPending || rotations.isPending || assignments.isPending || overrides.isPending,
    data: {
      shifts: shifts.data ?? [],
      rotations: rotations.data ?? [],
      assignments: assignments.data ?? [],
      overrides: overrides.data ?? [],
    },
  };
}

// ── Regularization ────────────────────────────────────────────────────
export interface Regularization {
  id: string;
  company_id: string;
  employee_id: string;
  work_date: string;
  check_in_time: string;
  check_out_time: string | null;
  out_next_day: boolean;
  requested_status: 'present' | 'half_day';
  work_mode: WorkMode;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  employees?: Pick<Employee, 'id' | 'full_name' | 'employee_code' | 'department'> | null;
}

export function useRegularizations(companyId: string | undefined, opts: { employeeId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: hrKeys.regularizations(companyId ?? '', `${opts.employeeId ?? 'all'}:${opts.status ?? 'any'}`),
    enabled: Boolean(companyId),
    queryFn: async () => {
      let q = sb()
        .from('attendance_regularizations')
        .select('*, employees(id, full_name, employee_code, department)')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false })
        .limit(500);
      if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
      if (opts.status) q = q.eq('status', opts.status);
      return unwrap(await q) as unknown as Regularization[];
    },
  });
}

// ── Requires attention ────────────────────────────────────────────────
export interface AttentionItem {
  alert_key: string;
  alert_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  employee_id: string;
  employee_name: string;
  employee_code: string;
  department: string | null;
  ref_date: string;
  detail: Record<string, unknown>;
  status: 'open' | 'snoozed' | 'escalated';
  snoozed_until: string | null;
  assigned_to: string | null;
  note: string | null;
}

export function useAttention(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: hrKeys.attention(companyId ?? ''),
    enabled: Boolean(companyId) && enabled,
    refetchInterval: 5 * 60_000,
    queryFn: async () => unwrap(await sb().rpc('hr_attention', { p_company: companyId! })) as AttentionItem[],
  });
}

export interface HrMember {
  user_id: string;
  role: 'customer_admin' | 'hr_manager';
  full_name: string | null;
  email: string | null;
}

/** Company admins and HR managers — who an alert can be assigned or escalated to. */
export function useHrMembers(companyId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.hrMembers(companyId ?? ''),
    enabled: Boolean(companyId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const rows = unwrap(
        await sb().from('company_memberships').select('user_id, role, profiles(full_name, email, is_active)').eq('company_id', companyId!).in('role', ['customer_admin', 'hr_manager']),
      ) as unknown as { user_id: string; role: HrMember['role']; profiles: { full_name: string | null; email: string | null; is_active: boolean } | null }[];
      return rows
        .filter((r) => r.profiles?.is_active !== false)
        .map((r) => ({ user_id: r.user_id, role: r.role, full_name: r.profiles?.full_name ?? null, email: r.profiles?.email ?? null }) satisfies HrMember);
    },
  });
}

// ── Leave automation (0009) ───────────────────────────────────────────
export interface LeaveBalance {
  leave_type_id: string;
  unit: 'day' | 'hour';
  is_comp_off: boolean;
  entitled: number | null;
  carried: number;
  encashed: number;
  encashable: boolean;
  used: number;
  pending: number;
  available: number | null;
  hours_used_month: number | null;
  hours_limit: number | null;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Balances as the database computes them (accrual, carry-forward, comp-off credits, hourly limits). */
export function useLeaveBalances(employeeId: string | undefined, year: number) {
  return useQuery({
    queryKey: hrKeys.balances(employeeId ?? '', year),
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const rows = unwrap(await sb().rpc('leave_balances', { p_employee: employeeId!, p_year: year })) as Record<string, unknown>[];
      return rows.map((r) => ({
        leave_type_id: String(r.leave_type_id),
        unit: r.unit as LeaveBalance['unit'],
        is_comp_off: Boolean(r.is_comp_off),
        entitled: num(r.entitled),
        carried: Number(r.carried ?? 0),
        encashed: Number(r.encashed ?? 0),
        encashable: Boolean(r.encashable),
        used: Number(r.used ?? 0),
        pending: Number(r.pending ?? 0),
        available: num(r.available),
        hours_used_month: num(r.hours_used_month),
        hours_limit: num(r.hours_limit),
      })) satisfies LeaveBalance[];
    },
  });
}

export interface CompOffCredit {
  id: string;
  company_id: string;
  employee_id: string;
  work_date: string;
  days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  expires_on: string | null;
  decision_note: string | null;
  created_at: string;
  employees?: Pick<Employee, 'id' | 'full_name' | 'employee_code' | 'department'> | null;
}

export function useCompOffCredits(companyId: string | undefined, opts: { employeeId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: hrKeys.compOff(companyId ?? '', `${opts.employeeId ?? 'all'}:${opts.status ?? 'any'}`),
    enabled: Boolean(companyId),
    queryFn: async () => {
      let q = sb().from('comp_off_credits').select('*, employees(id, full_name, employee_code, department)').eq('company_id', companyId!).order('work_date', { ascending: false }).limit(500);
      if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
      if (opts.status) q = q.eq('status', opts.status);
      return unwrap(await q) as unknown as CompOffCredit[];
    },
  });
}

export interface TeamLeaveRow {
  request_id: string;
  employee_id: string;
  full_name: string;
  department: string | null;
  leave_code: string;
  leave_name: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  start_time: string | null;
  end_time: string | null;
  status: 'pending' | 'approved';
}

/** Who is away (no reasons) — HR sees everyone, others their department, manager and team. */
export function useTeamLeave(companyId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: hrKeys.teamLeave(companyId ?? '', from, to),
    enabled: Boolean(companyId),
    queryFn: async () => unwrap(await sb().rpc('team_leave', { p_company: companyId!, p_from: from, p_to: to })) as TeamLeaveRow[],
  });
}

/** Active people who report to this employee (empty for non-managers). */
export function useDirectReports(managerId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.reports(managerId ?? ''),
    enabled: Boolean(managerId),
    staleTime: 60_000,
    queryFn: async () => unwrap(await sb().from('employees').select('*').eq('reporting_manager_id', managerId!).neq('status', 'exited').order('full_name')) as Employee[],
  });
}

export interface LeaveEncashment {
  id: string;
  company_id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  days: number;
  amount: number | null;
  per_day: number | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decision_note: string | null;
  paid_run_id: string | null;
  created_at: string;
  employees?: Pick<Employee, 'id' | 'full_name' | 'employee_code' | 'department'> | null;
  leave_types?: Pick<LeaveType, 'id' | 'name' | 'code'> | null;
}

export function useEncashments(companyId: string | undefined, opts: { employeeId?: string; status?: string } = {}) {
  return useQuery({
    queryKey: hrKeys.encash(companyId ?? '', `${opts.employeeId ?? 'all'}:${opts.status ?? 'any'}`),
    enabled: Boolean(companyId),
    queryFn: async () => {
      let q = sb().from('leave_encashments').select('*, employees(id, full_name, employee_code, department), leave_types(id, name, code)').eq('company_id', companyId!).order('created_at', { ascending: false }).limit(300);
      if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
      if (opts.status) q = q.eq('status', opts.status);
      const { data, error } = await q;
      if (error) return [] as LeaveEncashment[]; // table missing before migration 0012
      return (data as unknown as LeaveEncashment[]).map((e) => ({ ...e, days: Number(e.days), amount: e.amount === null ? null : Number(e.amount) }));
    },
  });
}

/** Employee ids the signed-in person can approve for, as reporting manager or delegate. */
export function useApprovalTeam(companyId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hr', 'approval-team', companyId ?? ''],
    enabled: Boolean(companyId) && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb().rpc('my_approval_team', { p_company: companyId! });
      if (error) return [] as string[]; // function missing before migration 0016
      return data as string[];
    },
  });
}

/** Names only, for choosing a delegate (HR and managers). */
export function useTeamNames(companyId: string | undefined) {
  return useQuery({
    queryKey: ['hr', 'colleague-names', companyId ?? ''],
    enabled: Boolean(companyId),
    queryFn: async () => unwrap(await sb().rpc('colleague_names', { p_company: companyId! })) as { id: string; full_name: string }[],
  });
}
