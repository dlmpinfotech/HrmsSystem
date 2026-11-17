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
  source: 'self' | 'hr';
  status: 'present' | 'half_day' | 'absent' | 'on_leave' | 'holiday' | 'weekly_off';
  late_minutes: number;
  work_minutes: number | null;
  notes: string | null;
  corrected_at: string | null;
}

export interface LeaveType {
  id: string;
  company_id: string;
  name: string;
  code: string;
  annual_quota: number | null;
  is_paid: boolean;
  is_active: boolean;
  sort_order: number;
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
  employees?: Pick<Employee, 'id' | 'full_name' | 'employee_code' | 'department'> | null;
  leave_types?: Pick<LeaveType, 'id' | 'name' | 'code'> | null;
}

export const hrKeys = {
  employees: (companyId: string) => ['hr', 'employees', companyId] as const,
  employee: (id: string) => ['hr', 'employee', id] as const,
  me: (companyId: string, userId: string) => ['hr', 'me', companyId, userId] as const,
  attendance: (companyId: string, from: string, to: string, employeeId?: string) => ['hr', 'attendance', companyId, from, to, employeeId ?? 'all'] as const,
  leaveTypes: (companyId: string) => ['hr', 'leave-types', companyId] as const,
  holidays: (companyId: string) => ['hr', 'holidays', companyId] as const,
  leave: (companyId: string, scope: string) => ['hr', 'leave', companyId, scope] as const,
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
        .select('*, employees(id, full_name, employee_code, department), leave_types(id, name, code)')
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
