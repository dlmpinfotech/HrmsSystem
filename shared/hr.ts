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
