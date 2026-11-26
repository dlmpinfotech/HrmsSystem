import { describe, expect, it } from 'vitest';
import { countLeaveDays, datesInMonth, dayStatus, formatMinutes, leaveBalances, summarizeMonth, type EmployeeLite } from '@shared/hr';
import { employeeSchema, leaveRequestSchema } from '@shared/schemas';

const emp: EmployeeLite = { id: 'e1', weekly_offs: [0], date_of_joining: '2030-01-03' };
const holidays = new Set(['2030-01-15']);
const today = '2030-01-20';

describe('day status', () => {
  const rec = (work_date: string, status = 'present', late_minutes = 0) => ({ employee_id: 'e1', work_date, status, late_minutes, check_in_at: 'x', check_out_at: null, work_minutes: 480 });

  it('derives present / late / leave / holiday / weekly off / absent / upcoming in priority order', () => {
    const leave = [{ employee_id: 'e1', start_date: '2030-01-10', end_date: '2030-01-11', status: 'approved' }];
    expect(dayStatus('2030-01-02', emp, undefined, [], holidays, today)).toBe('not_joined');
    expect(dayStatus('2030-01-07', emp, rec('2030-01-07'), [], holidays, today)).toBe('present');
    expect(dayStatus('2030-01-08', emp, rec('2030-01-08', 'present', 25), [], holidays, today)).toBe('late');
    expect(dayStatus('2030-01-10', emp, undefined, leave, holidays, today)).toBe('on_leave');
    expect(dayStatus('2030-01-15', emp, undefined, [], holidays, today)).toBe('holiday');
    expect(dayStatus('2030-01-13', emp, undefined, [], holidays, today)).toBe('weekly_off'); // Sunday
    expect(dayStatus('2030-01-14', emp, undefined, [], holidays, today)).toBe('absent');
    expect(dayStatus('2030-01-21', emp, undefined, [], holidays, today)).toBe('upcoming');
    // A pending request does not excuse an absence.
    expect(dayStatus('2030-01-14', emp, undefined, [{ employee_id: 'e1', start_date: '2030-01-14', end_date: '2030-01-14', status: 'pending' }], holidays, today)).toBe('absent');
  });

  it('summarises a month', () => {
    const s = summarizeMonth('2030-01', emp, [rec('2030-01-07'), rec('2030-01-08', 'present', 25)], [], holidays, today);
    expect(s).toMatchObject({ present: 2, late: 1, holidays: 1, workedMinutes: 960 });
    expect(s.weeklyOffs).toBe(4); // Sundays after joining: 6, 13, 20, 27
  });
});

describe('leave days', () => {
  it('excludes weekly offs and holidays, and supports half days', () => {
    expect(countLeaveDays('2030-01-14', '2030-01-20', false, [0], holidays)).toBe(5);
    expect(countLeaveDays('2030-01-14', '2030-01-14', true, [0], holidays)).toBe(0.5);
    expect(countLeaveDays('2030-01-13', '2030-01-13', false, [0], holidays)).toBe(0);
    expect(countLeaveDays('2030-01-20', '2030-01-14', false, [0], holidays)).toBe(0);
  });

  it('computes balances per type for the year', () => {
    const b = leaveBalances(
      [{ id: 'cl', annual_quota: 12 }, { id: 'lop', annual_quota: null }],
      [
        { leave_type_id: 'cl', status: 'approved', days: 3, start_date: '2030-02-01' },
        { leave_type_id: 'cl', status: 'pending', days: 2, start_date: '2030-03-01' },
        { leave_type_id: 'cl', status: 'approved', days: 5, start_date: '2029-12-01' },
        { leave_type_id: 'lop', status: 'approved', days: 1, start_date: '2030-02-01' },
      ],
      2030,
    );
    expect(b[0]).toEqual({ typeId: 'cl', quota: 12, used: 3, pending: 2, available: 7 });
    expect(b[1]).toEqual({ typeId: 'lop', quota: null, used: 1, pending: 0, available: null });
  });
});

describe('helpers', () => {
  it('lists the days of a month and formats durations', () => {
    expect(datesInMonth('2030-02')).toHaveLength(28);
    expect(datesInMonth('2028-02')).toHaveLength(29);
    expect(formatMinutes(515)).toBe('8h 35m');
    expect(formatMinutes(null)).toBe('—');
  });
});

describe('HR forms', () => {
  const base = { employee_code: '', full_name: 'Priya R', employment_type: 'full_time', shift_start: '09:30', shift_end: '18:30', grace_minutes: 10, weekly_offs: [0], status: 'active' };

  it('validates the employee form', () => {
    expect(employeeSchema.safeParse(base).success).toBe(true);
    expect(employeeSchema.safeParse({ ...base, shift_start: '22:00', shift_end: '06:00' }).success).toBe(true); // overnight
    const bad = employeeSchema.safeParse({ ...base, shift_end: '09:30' });
    expect(bad.error?.issues[0]).toMatchObject({ path: ['shift_end'], message: 'validation.shiftEnd' });
    const noEmail = employeeSchema.safeParse({ ...base, login_access: true });
    expect(noEmail.error?.issues[0]).toMatchObject({ path: ['email'], message: 'validation.emailForAccess' });
  });

  it('validates leave requests', () => {
    const ok = { employee_id: '00000000-0000-4000-8000-000000000001', leave_type_id: '00000000-0000-4000-8000-000000000002', start_date: '2030-01-14', end_date: '2030-01-15' };
    expect(leaveRequestSchema.safeParse(ok).success).toBe(true);
    expect(leaveRequestSchema.safeParse({ ...ok, end_date: '2030-01-13' }).error?.issues[0].message).toBe('validation.endBeforeStart');
    expect(leaveRequestSchema.safeParse({ ...ok, half_day: true }).error?.issues[0].message).toBe('validation.halfDayOneDay');
  });
});
