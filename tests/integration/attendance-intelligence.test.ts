import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/** Shifts, rotations, overnight attendance, breaks, regularization and the HR attention queue (0008). */
describe('Attendance intelligence (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let beta: { companyId: string; adminId: string };
  let hrId: string;
  let empUser: string;
  let otherUser: string;
  let empId: string;
  let otherId: string;
  let day: string; // shift A
  let night: string; // shift B 18:00–01:00
  let early: string; // shift C 01:00–09:00
  let rotationId: string;

  const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const ist = (d: string, hm: string) => new Date(Date.parse(`${d}T${hm}:00+05:30`)).toISOString();
  const hr = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>('authenticated', hrId, sql, params);
  const addMember = async (companyId: string, email: string, role: string) => {
    const id = await db.createUser(email);
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, $3)`, [companyId, id, role]);
    return id;
  };
  const shiftOn = async (employee: string, date: string) =>
    (await hr<{ shift_name: string | null; is_off: boolean }>(`select shift_name, is_off from employee_shift_on($1, $2)`, [employee, date]))[0];

  beforeAll(async () => {
    db = await createTestDb();
    acme = await createTenant(db, 'Acme Mills', 'owner@acme.test');
    beta = await createTenant(db, 'Beta Labs', 'owner@beta.test');
    hrId = await addMember(acme.companyId, 'hr@acme.test', 'hr_manager');
    const rows = await hr<{ id: string }>(
      `insert into employees (company_id, employee_code, full_name, email, weekly_offs, shift_start, shift_end)
       values ($1, 'A1', 'Anbu', 'anbu@acme.test', '{}', '09:00', '18:00'), ($1, 'A2', 'Banu', 'banu@acme.test', '{}', '09:00', '18:00')
       returning id`,
      [acme.companyId],
    );
    [empId, otherId] = rows.map((r) => r.id);
    empUser = await addMember(acme.companyId, 'anbu@acme.test', 'employee');
    otherUser = await addMember(acme.companyId, 'banu@acme.test', 'employee');

    const shifts = await hr<{ id: string }>(
      `insert into shifts (company_id, name, code, start_time, end_time, break_minutes) values
         ($1, 'Day', 'D', '09:00', '18:00', 60), ($1, 'Evening', 'E', '18:00', '01:00', 60), ($1, 'Night', 'N', '01:00', '09:00', 30)
       returning id`,
      [acme.companyId],
    );
    [day, night, early] = shifts.map((s) => s.id);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('rotates weekly through the shifts and repeats', async () => {
    const [rot] = await hr<{ id: string }>(`insert into shift_rotations (company_id, name, shift_ids, anchor_date) values ($1, '3-week', $2, '2026-11-02') returning id`, [
      acme.companyId,
      [day, night, early],
    ]);
    rotationId = rot.id;
    await hr(`insert into shift_assignments (company_id, employee_id, rotation_id, effective_from) values ($1, $2, $3, '2026-11-02')`, [acme.companyId, empId, rotationId]);
    expect((await shiftOn(empId, '2026-11-04')).shift_name).toBe('Day');
    expect((await shiftOn(empId, '2026-11-09')).shift_name).toBe('Evening');
    expect((await shiftOn(empId, '2026-11-22')).shift_name).toBe('Night');
    expect((await shiftOn(empId, '2026-11-23')).shift_name).toBe('Day');
    // Before the assignment started: the employee's own default shift.
    expect((await shiftOn(empId, '2026-10-30')).shift_name).toBeNull();
  });

  it('lets a one-day override replace the rotation (or give a day off)', async () => {
    await hr(`insert into shift_overrides (company_id, employee_id, work_date, shift_id) values ($1, $2, '2026-11-05', $3)`, [acme.companyId, empId, night]);
    await hr(`insert into shift_overrides (company_id, employee_id, work_date, shift_id) values ($1, $2, '2026-11-06', null)`, [acme.companyId, empId]);
    expect((await shiftOn(empId, '2026-11-05')).shift_name).toBe('Evening');
    expect((await shiftOn(empId, '2026-11-06')).is_off).toBe(true);
  });

  it('rejects a rotation that uses another company’s shift', async () => {
    const [foreign] = await db.as<{ id: string }>('authenticated', beta.adminId, `insert into shifts (company_id, name, code, start_time, end_time) values ($1, 'Beta day', 'X', '10:00', '19:00') returning id`, [beta.companyId]);
    await expect(hr(`insert into shift_rotations (company_id, name, shift_ids, anchor_date) values ($1, 'Bad', $2, '2026-11-02')`, [acme.companyId, [day, foreign.id]])).rejects.toThrow(/invalid_shift/);
    await expect(hr(`insert into shift_assignments (company_id, employee_id, shift_id, effective_from) values ($1, $2, $3, '2026-11-02')`, [acme.companyId, otherId, foreign.id])).rejects.toThrow(/invalid_shift/);
  });

  it('computes an overnight shift across midnight (scheduled break deducted, no overtime under threshold)', async () => {
    // 2026-11-09 is in the Evening week (18:00–01:00, 60 min break).
    const [r] = await hr<{ late_minutes: number; work_minutes: number; early_minutes: number; overtime_minutes: number; scheduled_end: string }>(
      `insert into attendance_records (company_id, employee_id, work_date, check_in_at, check_out_at, source) values ($1, $2, '2026-11-09', $3, $4, 'hr')
       returning late_minutes, work_minutes, early_minutes, overtime_minutes, scheduled_end`,
      [acme.companyId, empId, ist('2026-11-09', '18:05'), ist('2026-11-10', '01:30')],
    );
    expect(r.late_minutes).toBe(0);
    expect(r.work_minutes).toBe(445 - 60);
    expect(r.early_minutes).toBe(0);
    expect(r.overtime_minutes).toBe(0);
    expect(new Date(r.scheduled_end).toISOString()).toBe(ist('2026-11-10', '01:00'));
  });

  it('flags late arrival, early departure and overtime from the day’s shift', async () => {
    const [late] = await hr<{ late_minutes: number; early_minutes: number }>(
      `insert into attendance_records (company_id, employee_id, work_date, check_in_at, check_out_at, source) values ($1, $2, '2026-11-03', $3, $4, 'hr') returning late_minutes, early_minutes`,
      [acme.companyId, empId, ist('2026-11-03', '09:25'), ist('2026-11-03', '17:30')],
    );
    expect(late).toEqual({ late_minutes: 25, early_minutes: 30 });
    const [ot] = await hr<{ overtime_minutes: number; work_minutes: number }>(
      `insert into attendance_records (company_id, employee_id, work_date, check_in_at, check_out_at, source) values ($1, $2, '2026-11-04', $3, $4, 'hr') returning overtime_minutes, work_minutes`,
      [acme.companyId, empId, ist('2026-11-04', '09:00'), ist('2026-11-04', '20:00')],
    );
    expect(ot.work_minutes).toBe(600);
    expect(ot.overtime_minutes).toBe(120);
  });

  it('keeps the old behaviour for employees without a shift assignment', async () => {
    const [r] = await hr<{ late_minutes: number; work_minutes: number }>(
      `insert into attendance_records (company_id, employee_id, work_date, check_in_at, check_out_at, source) values ($1, $2, '2026-11-03', $3, $4, 'hr') returning late_minutes, work_minutes`,
      [acme.companyId, otherId, ist('2026-11-03', '09:05'), ist('2026-11-03', '18:00')],
    );
    expect(r.late_minutes).toBe(0); // within 10 min grace
    expect(r.work_minutes).toBe(535); // no break deduction without a shift template
  });

  it('records breaks and work mode through the server clock', async () => {
    const clock = (action: string, mode: string | null = null) =>
      db.as<{ work_mode: string; on_break_since: string | null; check_out_at: string | null }>('authenticated', otherUser, `select * from clock_attendance($1, $2, null, $3)`, [acme.companyId, action, mode]);
    const [inRec] = await clock('in', 'home');
    expect(inRec.work_mode).toBe('home');
    await expect(clock('in')).rejects.toThrow(/already_checked_in/);
    expect((await clock('break_start'))[0].on_break_since).not.toBeNull();
    await expect(clock('break_start')).rejects.toThrow(/already_on_break/);
    expect((await clock('break_end'))[0].on_break_since).toBeNull();
    await expect(clock('break_end')).rejects.toThrow(/not_on_break/);
    expect((await clock('out'))[0].check_out_at).not.toBeNull();
    await expect(clock('out')).rejects.toThrow(/already_checked_out/);
    const breaks = await db.as('authenticated', otherUser, `select 1 from attendance_breaks`);
    expect(breaks).toHaveLength(1);
    await expect(clock('in', 'beach')).rejects.toThrow(/invalid_action/);
  });

  it('runs the regularization workflow without creating duplicate attendance rows', async () => {
    const d = addDays(today(), -2);
    const asEmp = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => db.as<T>('authenticated', empUser, sql, p);
    await expect(asEmp(`insert into attendance_regularizations (company_id, employee_id, work_date, check_in_time, reason) values ($1, $2, $3, '09:00', 'Forgot to punch')`, [acme.companyId, otherId, d])).rejects.toThrow(/row-level security/);
    await expect(asEmp(`insert into attendance_regularizations (company_id, employee_id, work_date, check_in_time, reason) values ($1, $2, $3, '09:00', 'Future day')`, [acme.companyId, empId, addDays(today(), 2)])).rejects.toThrow(/regularization_window/);
    await expect(asEmp(`insert into attendance_regularizations (company_id, employee_id, work_date, check_in_time, reason, status) values ($1, $2, $3, '09:00', 'Approve myself', 'approved')`, [acme.companyId, empId, d])).rejects.toThrow(/new_requests_are_pending/);

    const [req] = await asEmp<{ id: string }>(
      `insert into attendance_regularizations (company_id, employee_id, work_date, check_in_time, check_out_time, work_mode, reason) values ($1, $2, $3, '09:00', '18:00', 'field', 'Client visit, no punch') returning id`,
      [acme.companyId, empId, d],
    );
    expect(await asEmp(`update attendance_regularizations set status = 'approved' where id = $1 returning id`, [req.id]).catch((e: Error) => e.message)).toMatch(/only_cancel_pending/);

    await hr(`update attendance_regularizations set status = 'approved', decision_note = 'ok' where id = $1`, [req.id]);
    const recs = await hr<{ source: string; work_mode: string; check_out_at: string }>(`select source, work_mode, check_out_at from attendance_records where employee_id = $1 and work_date = $2`, [empId, d]);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ source: 'regularization', work_mode: 'field' });

    // A second approved request for the same day updates the same row.
    const [req2] = await asEmp<{ id: string }>(`insert into attendance_regularizations (company_id, employee_id, work_date, check_in_time, check_out_time, reason) values ($1, $2, $3, '10:00', '19:00', 'Corrected times') returning id`, [acme.companyId, empId, d]);
    await hr(`update attendance_regularizations set status = 'approved' where id = $1`, [req2.id]);
    expect(await hr(`select 1 from attendance_records where employee_id = $1 and work_date = $2`, [empId, d])).toHaveLength(1);
    await expect(hr(`update attendance_regularizations set status = 'rejected' where id = $1`, [req2.id])).rejects.toThrow(/cannot_decide/);

    // Colleagues cannot see each other's requests; the other company sees nothing.
    expect(await db.as('authenticated', otherUser, `select 1 from attendance_regularizations`)).toHaveLength(0);
    expect(await db.as('authenticated', beta.adminId, `select 1 from attendance_regularizations`)).toHaveLength(0);
  });

  it('lists issues for HR and lets HR snooze, resolve and assign them', async () => {
    const d = addDays(today(), -3);
    await hr(`insert into attendance_records (company_id, employee_id, work_date, check_in_at, source) values ($1, $2, $3, $4, 'hr')`, [acme.companyId, otherId, d, ist(d, '09:00')]);
    await db.as('authenticated', otherUser, `insert into attendance_regularizations (company_id, employee_id, work_date, check_in_time, reason) values ($1, $2, $3, '09:00', 'Need fix')`, [acme.companyId, otherId, addDays(today(), -1)]);
    await hr(`update employees set contract_end_date = $2 where id = $1`, [otherId, addDays(today(), 5)]);

    const list = async () => hr<{ alert_key: string; alert_type: string; severity: string; status: string }>(`select * from hr_attention($1)`, [acme.companyId]);
    const types = (await list()).map((a) => a.alert_type);
    expect(types).toEqual(expect.arrayContaining(['missing_punch', 'pending_regularization', 'contract_expiry', 'incomplete_profile']));
    const missing = (await list()).find((a) => a.alert_type === 'missing_punch')!;
    expect(missing.severity).toBe('high');

    await hr(`insert into hr_alert_states (company_id, alert_key, status) values ($1, $2, 'resolved')`, [acme.companyId, missing.alert_key]);
    expect((await list()).some((a) => a.alert_key === missing.alert_key)).toBe(false);

    const contract = (await list()).find((a) => a.alert_type === 'contract_expiry')!;
    await hr(`insert into hr_alert_states (company_id, alert_key, status, snoozed_until) values ($1, $2, 'snoozed', $3)`, [acme.companyId, contract.alert_key, addDays(today(), 3)]);
    expect((await list()).some((a) => a.alert_key === contract.alert_key)).toBe(false);

    const reg = (await list()).find((a) => a.alert_type === 'pending_regularization')!;
    await hr(`insert into hr_alert_states (company_id, alert_key, status, assigned_to) values ($1, $2, 'escalated', $3)`, [acme.companyId, reg.alert_key, acme.adminId]);
    expect((await list()).find((a) => a.alert_key === reg.alert_key)).toMatchObject({ status: 'escalated', severity: 'critical' });
    await expect(hr(`insert into hr_alert_states (company_id, alert_key, assigned_to) values ($1, 'x:1', $2)`, [acme.companyId, empUser])).rejects.toThrow(/invalid_assignee/);
  });

  it('keeps the attention queue and alert states away from employees and other companies', async () => {
    await expect(db.as('authenticated', empUser, `select * from hr_attention($1)`, [acme.companyId])).rejects.toThrow(/forbidden/);
    await expect(db.as('authenticated', beta.adminId, `select * from hr_attention($1)`, [acme.companyId])).rejects.toThrow(/forbidden/);
    expect(await db.as('authenticated', empUser, `select 1 from hr_alert_states`)).toHaveLength(0);
    expect(await db.as('anon', null, `select 1 from shifts`).catch((e: Error) => e.message)).toMatch(/permission denied/);
    expect(await db.as('authenticated', beta.adminId, `select 1 from shifts where company_id = $1`, [acme.companyId])).toHaveLength(0);
    // Employees see their own assignment, not a colleague's.
    expect(await db.as('authenticated', empUser, `select 1 from shift_assignments`)).toHaveLength(1);
    expect(await db.as('authenticated', otherUser, `select 1 from shift_assignments`)).toHaveLength(0);
    expect(await db.as('authenticated', otherUser, `select * from employee_shift_on($1, '2026-11-09')`, [empId])).toHaveLength(0);
  });

  it('rejects a reporting manager from another company or the employee themself', async () => {
    await expect(hr(`update employees set reporting_manager_id = id where id = $1`, [empId])).rejects.toThrow(/invalid_manager/);
    await hr(`update employees set reporting_manager_id = $2 where id = $1`, [empId, otherId]);
    const [betaEmp] = await db.as<{ id: string }>('authenticated', beta.adminId, `insert into employees (company_id, employee_code, full_name) values ($1, 'B1', 'Beta Person') returning id`, [beta.companyId]);
    await expect(hr(`update employees set reporting_manager_id = $2 where id = $1`, [empId, betaEmp.id])).rejects.toThrow(/invalid_manager/);
  });
});
