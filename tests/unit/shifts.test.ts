import { describe, expect, it } from 'vitest';
import { alertLink, isOvernight, mondayOf, resolveShift, rotationIndex, shiftMinutes, workedMinutes, type ShiftLite } from '@shared/hr';
import { regularizationSchema, shiftAssignmentSchema, shiftSchema } from '@shared/schemas';

const shift = (id: string, start: string, end: string, breakMinutes = 60): ShiftLite => ({ id, name: id, code: id, start_time: `${start}:00`, end_time: `${end}:00`, break_minutes: breakMinutes, grace_minutes: 10 });
const A = shift('A', '09:00', '18:00');
const B = shift('B', '18:00', '01:00');
const C = shift('C', '01:00', '09:00', 30);
const emp = { id: 'e1', shift_start: '09:30:00', shift_end: '18:30:00' };
const data = {
  shifts: [A, B, C],
  rotations: [{ id: 'r1', shift_ids: ['A', 'B', 'C'], anchor_date: '2026-11-02' }],
  assignments: [{ employee_id: 'e1', shift_id: null, rotation_id: 'r1', effective_from: '2026-11-02', effective_to: null }],
  overrides: [{ employee_id: 'e1', work_date: '2026-11-05', shift_id: 'B' }, { employee_id: 'e1', work_date: '2026-11-06', shift_id: null }],
};

describe('shift maths (mirrors the database)', () => {
  it('handles overnight shifts', () => {
    expect(isOvernight('18:00', '01:00')).toBe(true);
    expect(isOvernight('09:00', '18:00')).toBe(false);
    expect(shiftMinutes('18:00', '01:00', 60)).toBe(360);
    expect(shiftMinutes('01:00', '09:00', 30)).toBe(450);
    expect(shiftMinutes('22:00', '06:00')).toBe(480);
  });

  it('rotates weekly, including dates before the anchor', () => {
    expect(rotationIndex('2026-11-02', '2026-11-08', 3)).toBe(0);
    expect(rotationIndex('2026-11-02', '2026-11-09', 3)).toBe(1);
    expect(rotationIndex('2026-11-02', '2026-11-16', 3)).toBe(2);
    expect(rotationIndex('2026-11-02', '2026-11-23', 3)).toBe(0);
    expect(rotationIndex('2026-11-02', '2026-11-01', 3)).toBe(2);
  });

  it('resolves override → rotation → default, like employee_shift_on()', () => {
    expect(resolveShift('2026-11-04', emp, data)).toMatchObject({ start: '09:00', source: 'rotation' });
    expect(resolveShift('2026-11-10', emp, data)).toMatchObject({ start: '18:00', end: '01:00', source: 'rotation' });
    expect(resolveShift('2026-11-18', emp, data).shift?.id).toBe('C');
    expect(resolveShift('2026-11-05', emp, data)).toMatchObject({ source: 'override', start: '18:00' });
    expect(resolveShift('2026-11-06', emp, data)).toMatchObject({ isOff: true });
    expect(resolveShift('2026-10-30', emp, data)).toMatchObject({ source: 'default', start: '09:30', end: '18:30' });
  });

  it('prefers the latest assignment and respects end dates', () => {
    const d = { ...data, assignments: [...data.assignments, { employee_id: 'e1', shift_id: 'A', rotation_id: null, effective_from: '2026-12-01', effective_to: '2026-12-31' }] };
    expect(resolveShift('2026-12-08', emp, d)).toMatchObject({ source: 'assignment', start: '09:00' });
    expect(resolveShift('2027-01-04', emp, d).source).toBe('rotation');
  });

  it('deducts the scheduled break only from long spans', () => {
    expect(workedMinutes(445, 0, 60)).toBe(385);
    expect(workedMinutes(240, 0, 60)).toBe(240);
    expect(workedMinutes(540, 90, 60)).toBe(450);
  });

  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-11-17')).toBe('2026-11-16');
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
  });

  it('links each alert to the page that fixes it', () => {
    expect(alertLink('missing_punch', 'e1', '2026-11-10')).toBe('/portal/attendance/correct?employee=e1&date=2026-11-10');
    expect(alertLink('pending_leave', 'e1', '2026-11-10')).toBe('/portal/leave?tab=approvals');
    expect(alertLink('contract_expiry', 'e1', '2026-11-10')).toBe('/portal/employees/e1');
  });
});

describe('shift and regularization forms', () => {
  const s = { name: 'Night', code: 'n', start_time: '22:00', end_time: '06:00', break_minutes: 30, grace_minutes: 10, early_grace_minutes: 10, overtime_after_minutes: 30, color: 'info' };
  it('accepts overnight shifts and upper-cases the code', () => {
    const r = shiftSchema.safeParse(s);
    expect(r.success && r.data.code).toBe('N');
    expect(shiftSchema.safeParse({ ...s, end_time: '22:00' }).error?.issues[0].message).toBe('validation.shiftEnd');
  });
  it('validates assignments', () => {
    const ok = { employee_ids: ['00000000-0000-4000-8000-000000000001'], kind: 'rotation', target_id: '00000000-0000-4000-8000-000000000002', effective_from: '2026-11-16' };
    expect(shiftAssignmentSchema.safeParse(ok).success).toBe(true);
    expect(shiftAssignmentSchema.safeParse({ ...ok, employee_ids: [] }).error?.issues[0].message).toBe('validation.pickEmployees');
    expect(shiftAssignmentSchema.safeParse({ ...ok, effective_to: '2026-11-01' }).error?.issues[0].message).toBe('validation.endBeforeStart');
  });
  it('validates regularization requests (overnight check-out needs next-day flag)', () => {
    const ok = { employee_id: '00000000-0000-4000-8000-000000000001', work_date: '2026-11-15', check_in_time: '18:00', check_out_time: '01:00', out_next_day: true, requested_status: 'present', work_mode: 'office', reason: 'Forgot to punch out' };
    expect(regularizationSchema.safeParse(ok).success).toBe(true);
    expect(regularizationSchema.safeParse({ ...ok, out_next_day: false }).error?.issues[0].message).toBe('errors.out_before_in');
    expect(regularizationSchema.safeParse({ ...ok, reason: 'x' }).error?.issues[0].message).toBe('validation.reasonMin');
  });
});
