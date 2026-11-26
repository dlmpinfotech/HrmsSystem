/**
 * Pure HR helpers shared by the UI and tests. Dates are IST calendar days as
 * 'YYYY-MM-DD' strings. The database recomputes anything that matters
 * (late minutes, leave days) — these mirror it for previews and reports.
 */
import { addDays, istDateString, istWeekday } from './slots';

export type DayStatus = 'present' | 'late' | 'half_day' | 'absent' | 'on_leave' | 'holiday' | 'weekly_off' | 'upcoming' | 'not_joined';

export interface EmployeeLite {
  id: string;
  weekly_offs: number[];
  date_of_joining: string | null;
  exit_date?: string | null;
  shift_end?: string;
}

export interface AttendanceLite {
  employee_id: string;
  work_date: string;
  status: string;
  late_minutes: number;
  check_in_at: string | null;
  check_out_at: string | null;
  work_minutes: number | null;
}

export interface LeaveLite {
  employee_id: string;
  start_date: string;
  end_date: string;
  status: string;
  half_day?: boolean;
}

export function isWorkingDay(date: string, weeklyOffs: number[], holidays: Set<string>): boolean {
  return !weeklyOffs.includes(istWeekday(date)) && !holidays.has(date);
}

/** Same rule as the database's leave_days(): working days only, half day = 0.5. */
export function countLeaveDays(start: string, end: string, halfDay: boolean, weeklyOffs: number[], holidays: Set<string>): number {
  if (!start || !end || end < start) return 0;
  let n = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) if (isWorkingDay(d, weeklyOffs, holidays)) n++;
  return halfDay ? Math.min(n, 1) * 0.5 : n;
}

export function datesInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function currentMonth(now = new Date()): string {
  return istDateString(now).slice(0, 7);
}

/**
 * The status of one employee on one day, from the attendance record (if any),
 * approved leave, holidays and weekly offs — in that order of precedence.
 */
export function dayStatus(
  date: string,
  employee: EmployeeLite,
  record: AttendanceLite | undefined,
  approvedLeave: LeaveLite[],
  holidays: Set<string>,
  today = istDateString(new Date()),
): DayStatus {
  if (employee.date_of_joining && date < employee.date_of_joining) return 'not_joined';
  if (employee.exit_date && date > employee.exit_date) return 'not_joined';
  if (record) {
    if (record.status === 'present') return record.late_minutes > 0 ? 'late' : 'present';
    if (['half_day', 'absent', 'on_leave', 'holiday', 'weekly_off'].includes(record.status)) return record.status as DayStatus;
  }
  if (approvedLeave.some((l) => l.employee_id === employee.id && l.status === 'approved' && l.start_date <= date && l.end_date >= date)) return 'on_leave';
  if (holidays.has(date)) return 'holiday';
  if (employee.weekly_offs.includes(istWeekday(date))) return 'weekly_off';
  if (date >= today) return 'upcoming';
  return 'absent';
}

export interface MonthSummary {
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  holidays: number;
  weeklyOffs: number;
  workedMinutes: number;
}

export function summarizeMonth(
  month: string,
  employee: EmployeeLite,
  records: AttendanceLite[],
  approvedLeave: LeaveLite[],
  holidays: Set<string>,
  today = istDateString(new Date()),
): MonthSummary {
  const byDate = new Map(records.filter((r) => r.employee_id === employee.id).map((r) => [r.work_date, r]));
  const s: MonthSummary = { present: 0, late: 0, halfDay: 0, absent: 0, onLeave: 0, holidays: 0, weeklyOffs: 0, workedMinutes: 0 };
  for (const d of datesInMonth(month)) {
    const rec = byDate.get(d);
    s.workedMinutes += rec?.work_minutes ?? 0;
    switch (dayStatus(d, employee, rec, approvedLeave, holidays, today)) {
      case 'present': s.present++; break;
      case 'late': s.present++; s.late++; break;
      case 'half_day': s.halfDay++; break;
      case 'absent': s.absent++; break;
      case 'on_leave': s.onLeave++; break;
      case 'holiday': s.holidays++; break;
      case 'weekly_off': s.weeklyOffs++; break;
      default: break;
    }
  }
  return s;
}

export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Leave balance per type for one year. */
export function leaveBalances(
  types: { id: string; annual_quota: number | null }[],
  requests: { leave_type_id: string; status: string; days: number; start_date: string }[],
  year: number,
) {
  return types.map((t) => {
    const inYear = requests.filter((r) => r.leave_type_id === t.id && r.start_date.startsWith(String(year)));
    const used = inYear.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.days), 0);
    const pending = inYear.filter((r) => r.status === 'pending').reduce((s, r) => s + Number(r.days), 0);
    const quota = t.annual_quota === null ? null : Number(t.annual_quota);
    return { typeId: t.id, quota, used, pending, available: quota === null ? null : Math.max(quota - used - pending, 0) };
  });
}

// ── Shifts (mirrors employee_shift_on() and attendance_before() in 0008) ──

export interface ShiftLite {
  id: string;
  name: string;
  code: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  color?: string;
}

export interface RotationLite {
  id: string;
  shift_ids: string[];
  anchor_date: string;
}

export interface AssignmentLite {
  employee_id: string;
  shift_id: string | null;
  rotation_id: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at?: string;
}

export interface OverrideLite {
  employee_id: string;
  work_date: string;
  shift_id: string | null;
}

export interface ResolvedShift {
  shift: ShiftLite | null; // null = the employee's own default shift
  start: string; // HH:MM
  end: string;
  isOff: boolean;
  source: 'override' | 'assignment' | 'rotation' | 'default';
}

const toMin = (t: string) => {
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
};

/** Ends on the next calendar day (e.g. 18:00–01:00). */
export const isOvernight = (start: string, end: string) => toMin(end) <= toMin(start);

/** Length of a shift in minutes, minus the break. */
export function shiftMinutes(start: string, end: string, breakMinutes = 0): number {
  const span = isOvernight(start, end) ? toMin(end) + 1440 - toMin(start) : toMin(end) - toMin(start);
  return Math.max(span - breakMinutes, 0);
}

/** Week number (0-based) of a rotation on a date; works before the anchor too. */
export function rotationIndex(anchor: string, date: string, length: number): number {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / 86_400_000);
  const week = Math.floor(days / 7);
  return ((week % length) + length) % length;
}

/** Worked minutes: span minus the larger of breaks taken and the scheduled break (only for spans of 5h+). */
export function workedMinutes(spanMinutes: number, breaksTaken: number, scheduledBreak: number): number {
  return Math.max(spanMinutes - Math.max(breaksTaken, spanMinutes >= 300 ? scheduledBreak : 0), 0);
}

/** The shift for one employee on one day: override → latest assignment (fixed or rotation) → default. */
export function resolveShift(
  date: string,
  employee: { id: string; shift_start: string; shift_end: string },
  data: { shifts: ShiftLite[]; rotations: RotationLite[]; assignments: AssignmentLite[]; overrides: OverrideLite[] },
): ResolvedShift {
  const byId = new Map(data.shifts.map((s) => [s.id, s]));
  const fallback: ResolvedShift = { shift: null, start: employee.shift_start.slice(0, 5), end: employee.shift_end.slice(0, 5), isOff: false, source: 'default' };
  const make = (id: string | null, source: ResolvedShift['source']): ResolvedShift => {
    const s = id ? byId.get(id) : undefined;
    return s ? { shift: s, start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5), isOff: false, source } : fallback;
  };

  const override = data.overrides.find((o) => o.employee_id === employee.id && o.work_date === date);
  if (override) return override.shift_id ? make(override.shift_id, 'override') : { ...fallback, isOff: true, source: 'override' };

  const assignment = data.assignments
    .filter((a) => a.employee_id === employee.id && a.effective_from <= date && (!a.effective_to || a.effective_to >= date))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
  if (!assignment) return fallback;
  if (assignment.shift_id) return make(assignment.shift_id, 'assignment');
  const rotation = data.rotations.find((r) => r.id === assignment.rotation_id);
  if (!rotation || !rotation.shift_ids.length) return fallback;
  return make(rotation.shift_ids[rotationIndex(rotation.anchor_date, date, rotation.shift_ids.length)], 'rotation');
}

/** Monday of the week containing a date (IST calendar day). */
export function mondayOf(date: string): string {
  const dow = istWeekday(date); // 0 = Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

// ── Requires attention ────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';
export const ALERT_TYPES = [
  'missing_punch', 'not_checked_in', 'repeated_late', 'excess_hours', 'leave_conflict',
  'pending_leave', 'pending_regularization', 'contract_expiry', 'probation_end', 'incomplete_profile', 'document_expiry', 'pending_document',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/** Where HR goes to act on an alert. */
export function alertLink(type: string, employeeId: string, refDate: string): string {
  switch (type) {
    case 'missing_punch':
    case 'leave_conflict':
    case 'excess_hours':
      return `/portal/attendance/correct?employee=${employeeId}&date=${refDate}`;
    case 'not_checked_in':
      return `/portal/attendance?tab=register`;
    case 'document_expiry':
    case 'pending_document':
      return `/portal/employees/${employeeId}?tab=documents`;
    case 'repeated_late':
      return `/portal/attendance?tab=search&employee=${employeeId}`;
    case 'pending_leave':
      return `/portal/leave?tab=approvals`;
    case 'pending_regularization':
      return `/portal/attendance?tab=requests`;
    default:
      return `/portal/employees/${employeeId}`;
  }
}

export const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ── Employee 360° timeline ────────────────────────────────────────────
export type TimelineKind = 'joined' | 'probation_end' | 'contract_end' | 'exited' | 'leave' | 'regularization' | 'correction' | 'shift';

export interface TimelineEvent {
  kind: TimelineKind;
  date: string; // IST calendar day
  upcoming: boolean;
  refId?: string;
  status?: string;
}

export interface TimelineInput {
  employee: { date_of_joining: string | null; probation_end_date?: string | null; contract_end_date?: string | null; exit_date?: string | null };
  leave?: { id: string; created_at: string; status: string }[];
  regularizations?: { id: string; created_at: string; status: string }[];
  corrections?: { id: string; corrected_at: string | null }[];
  assignments?: { id: string; effective_from: string }[];
}

/** One employee's history (newest first) from data the viewer can already read. */
export function buildTimeline(input: TimelineInput, today = istDateString(new Date())): TimelineEvent[] {
  const e = input.employee;
  const out: TimelineEvent[] = [];
  const push = (kind: TimelineKind, date: string | null | undefined, extra: Partial<TimelineEvent> = {}) => {
    if (date) out.push({ kind, date: date.slice(0, 10), upcoming: date.slice(0, 10) > today, ...extra });
  };
  const istDay = (iso: string) => istDateString(new Date(iso));
  push('joined', e.date_of_joining);
  push('probation_end', e.probation_end_date);
  push('contract_end', e.contract_end_date);
  push('exited', e.exit_date);
  for (const l of input.leave ?? []) push('leave', istDay(l.created_at), { refId: l.id, status: l.status });
  for (const r of input.regularizations ?? []) push('regularization', istDay(r.created_at), { refId: r.id, status: r.status });
  for (const c of input.corrections ?? []) if (c.corrected_at) push('correction', istDay(c.corrected_at), { refId: c.id });
  for (const a of input.assignments ?? []) push('shift', a.effective_from, { refId: a.id });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Present-day percentage over working days that have passed (null when there are none). */
export function attendanceRate(s: Pick<MonthSummary, 'present' | 'halfDay' | 'absent'>): number | null {
  const base = s.present + s.halfDay + s.absent;
  return base === 0 ? null : Math.round(((s.present + s.halfDay * 0.5) / base) * 100);
}
