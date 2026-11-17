import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/** Employees, attendance and leave — real migrations, real RLS, acting as each role. */
describe('HRMS: employees, attendance and leave (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let beta: { companyId: string; adminId: string };
  let hrId: string;
  let empUserId: string;
  let otherEmpUserId: string;
  let empId: string;
  let otherEmpId: string;
  let salesAdmin: string;

  const addMember = async (companyId: string, email: string, role: string) => {
    const id = await db.createUser(email);
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, $3)`, [companyId, id, role]);
    return id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    salesAdmin = await db.createUser('sales@platform.test', ['sales_admin']);
    acme = await createTenant(db, 'Acme Textiles', 'owner@acme.test');
    beta = await createTenant(db, 'Beta Hospital', 'owner@beta.test');
    hrId = await addMember(acme.companyId, 'hr@acme.test', 'hr_manager');

    // HR adds two employees; their emails match logins created afterwards (auto-linked).
    const rows = await db.as<{ id: string; employee_code: string }>(
      'authenticated', hrId,
      `insert into employees (company_id, employee_code, full_name, email, department, weekly_offs)
       values ($1, '', 'Priya R', 'Priya@Acme.test', 'Weaving', '{0}'), ($1, 'E-77', 'Kumar S', 'kumar@acme.test', 'Dyeing', '{0}')
       returning id, employee_code`,
      [acme.companyId],
    );
    empId = rows[0].id;
    otherEmpId = rows[1].id;
    expect(rows[0].employee_code).toBe('EMP0001');
    expect(rows[1].employee_code).toBe('E-77');
    empUserId = await addMember(acme.companyId, 'priya@acme.test', 'employee');
    otherEmpUserId = await addMember(acme.companyId, 'kumar@acme.test', 'employee');
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('seeds default leave types for every company', async () => {
    const types = await db.admin<{ code: string }>(`select code from leave_types where company_id = $1 order by sort_order`, [acme.companyId]);
    expect(types.map((t) => t.code)).toEqual(['CL', 'SL', 'EL', 'LOP']);
  });

  it('links an employee to the portal login with the same email', async () => {
    const [e] = await db.admin<{ user_id: string }>(`select user_id from employees where id = $1`, [empId]);
    expect(e.user_id).toBe(empUserId);
  });

  it('lets HR and company admins see all employees; employees only see themselves', async () => {
    expect(await db.as('authenticated', hrId, `select 1 from employees where company_id = $1`, [acme.companyId])).toHaveLength(2);
    expect(await db.as('authenticated', acme.adminId, `select 1 from employees where company_id = $1`, [acme.companyId])).toHaveLength(2);
    const mine = await db.as<{ full_name: string }>('authenticated', empUserId, `select full_name from employees`);
    expect(mine.map((r) => r.full_name)).toEqual(['Priya R']);
  });

  it('keeps employee data away from other companies and from platform sales staff', async () => {
    expect(await db.as('authenticated', beta.adminId, `select 1 from employees`)).toHaveLength(0);
    expect(await db.as('authenticated', salesAdmin, `select 1 from employees`)).toHaveLength(0);
    await expect(db.as('authenticated', beta.adminId, `insert into employees (company_id, employee_code, full_name) values ($1, 'X1', 'Intruder')`, [acme.companyId])).rejects.toThrow(/row-level security/);
  });

  it('stops employees editing employee records (including their own)', async () => {
    const upd = await db.as('authenticated', empUserId, `update employees set department = 'Boss' where id = $1 returning id`, [empId]);
    expect(upd).toHaveLength(0);
  });

  it('enforces the plan employee limit', async () => {
    const t = await createTenant(db, 'Tiny Shop', 'owner@tiny.test');
    await db.admin(`update subscriptions set plan_id = (select id from plans where key = 'starter') where company_id = $1`, [t.companyId]);
    await db.admin(`insert into employees (company_id, employee_code, full_name) select $1, 'T' || g, 'Person ' || g from generate_series(1, 25) g`, [t.companyId]);
    await expect(db.admin(`insert into employees (company_id, employee_code, full_name) values ($1, 'T26', 'One Too Many')`, [t.companyId])).rejects.toThrow(/employee_limit_reached/);
  });

  // ── Attendance ──────────────────────────────────────────────────
  it('checks in and out with the server clock, once per day', async () => {
    const [inRec] = await db.as<{ check_in_at: string; status: string }>('authenticated', empUserId, `select * from clock_attendance($1, 'in', '{"lat": 8.7139, "lng": 77.7567, "accuracy": 12.4, "evil": "x"}'::jsonb)`, [acme.companyId]);
    expect(inRec.check_in_at).toBeTruthy();
    await expect(db.as('authenticated', empUserId, `select * from clock_attendance($1, 'in')`, [acme.companyId])).rejects.toThrow(/already_checked_in/);
    const [outRec] = await db.as<{ check_out_at: string; work_minutes: number; check_in_location: Record<string, unknown> }>('authenticated', empUserId, `select * from clock_attendance($1, 'out')`, [acme.companyId]);
    expect(outRec.check_out_at).toBeTruthy();
    expect(outRec.work_minutes).toBe(0);
    expect(outRec.check_in_location).toEqual({ lat: 8.7139, lng: 77.7567, accuracy: 12 });
    await expect(db.as('authenticated', empUserId, `select * from clock_attendance($1, 'out')`, [acme.companyId])).rejects.toThrow(/already_checked_out/);
  });

  it('refuses check-in for people without an employee record', async () => {
    await expect(db.as('authenticated', hrId, `select * from clock_attendance($1, 'in')`, [acme.companyId])).rejects.toThrow(/no_employee_record/);
    await expect(db.as('authenticated', empUserId, `select * from clock_attendance($1, 'in')`, [beta.companyId])).rejects.toThrow(/no_employee_record/);
  });

  it('stops employees writing attendance directly (no faking times)', async () => {
    await expect(db.as('authenticated', empUserId, `insert into attendance_records (company_id, employee_id, work_date, check_in_at) values ($1, $2, '2030-01-01', '2030-01-01T03:00:00Z')`, [acme.companyId, empId])).rejects.toThrow(/row-level security/);
    const upd = await db.as('authenticated', empUserId, `update attendance_records set check_in_at = check_in_at - interval '2 hours' returning id`);
    expect(upd).toHaveLength(0);
  });

  it('computes lateness against the shift and records HR corrections', async () => {
    // Shift 09:30 IST with 10 min grace; 09:55 IST = 04:25 UTC → 25 minutes late.
    const [r] = await db.as<{ late_minutes: number; work_minutes: number; corrected_by: string; source: string }>(
      'authenticated', hrId,
      `insert into attendance_records (company_id, employee_id, work_date, check_in_at, check_out_at, source)
       values ($1, $2, '2030-01-07', '2030-01-07T04:25:00Z', '2030-01-07T13:00:00Z', 'hr') returning late_minutes, work_minutes, corrected_by, source`,
      [beta.companyId /* forged tenant is overwritten */, otherEmpId],
    );
    expect(r).toMatchObject({ late_minutes: 25, work_minutes: 515, corrected_by: hrId, source: 'hr' });
    const [own] = await db.admin<{ company_id: string }>(`select company_id from attendance_records where employee_id = $1 and work_date = '2030-01-07'`, [otherEmpId]);
    expect(own.company_id).toBe(acme.companyId);
    // Within grace → not late.
    const [g] = await db.as<{ late_minutes: number }>('authenticated', hrId, `insert into attendance_records (company_id, employee_id, work_date, check_in_at, source) values ($1, $2, '2030-01-08', '2030-01-08T04:05:00Z', 'hr') returning late_minutes`, [acme.companyId, otherEmpId]);
    expect(g.late_minutes).toBe(0);
  });

  it('lets employees read only their own attendance', async () => {
    const kumar = await db.as('authenticated', otherEmpUserId, `select 1 from attendance_records`);
    const priya = await db.as('authenticated', empUserId, `select employee_id from attendance_records`);
    expect(kumar.length).toBe(2);
    expect(new Set(priya.map((r) => (r as { employee_id: string }).employee_id))).toEqual(new Set([empId]));
  });

  // ── Leave ───────────────────────────────────────────────────────
  const cl = async () => (await db.admin<{ id: string }>(`select id from leave_types where company_id = $1 and code = 'CL'`, [acme.companyId]))[0].id;

  it('counts only working days (weekly offs and holidays excluded)', async () => {
    await db.as('authenticated', hrId, `insert into holidays (company_id, holiday_date, name) values ($1, '2030-01-15', 'Pongal')`, [acme.companyId]);
    // Mon 14 → Sun 20 Jan 2030: 7 days, minus Sunday, minus Pongal (Tue 15) = 5.
    const [r] = await db.as<{ days: string; status: string }>('authenticated', empUserId, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date, reason) values ($1, $2, '2030-01-14', '2030-01-20', 'Family function') returning days, status`, [empId, await cl()]);
    expect(Number(r.days)).toBe(5);
    expect(r.status).toBe('pending');
  });

  it('rejects overlapping requests, holiday-only requests and over-quota requests', async () => {
    await expect(db.as('authenticated', empUserId, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1, $2, '2030-01-16', '2030-01-16')`, [empId, await cl()])).rejects.toThrow(/leave_overlap/);
    await expect(db.as('authenticated', empUserId, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1, $2, '2030-01-06', '2030-01-06')`, [empId, await cl()])).rejects.toThrow(/no_working_days/);
    // 12 CL per year; 5 already pending → 8 more working days exceeds the quota.
    await expect(db.as('authenticated', empUserId, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1, $2, '2030-02-04', '2030-02-13')`, [empId, await cl()])).rejects.toThrow(/insufficient_balance/);
  });

  it('stops employees approving their own leave or applying for colleagues', async () => {
    await expect(db.as('authenticated', empUserId, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date, status) values ($1, $2, '2030-03-04', '2030-03-04', 'approved')`, [empId, await cl()])).rejects.toThrow(/new_requests_are_pending/);
    await expect(db.as('authenticated', empUserId, `update leave_requests set status = 'approved' where employee_id = $1`, [empId])).rejects.toThrow(/only_cancel_pending/);
    await expect(db.as('authenticated', empUserId, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1, $2, '2030-03-04', '2030-03-04')`, [otherEmpId, await cl()])).rejects.toThrow(/row-level security/);
  });

  it('lets HR approve with a record of who decided, and employees cancel pending requests', async () => {
    const [r] = await db.as<{ status: string; decided_by: string; decided_at: string }>('authenticated', hrId, `update leave_requests set status = 'approved', decision_note = 'Enjoy' where employee_id = $1 returning status, decided_by, decided_at`, [empId]);
    expect(r).toMatchObject({ status: 'approved', decided_by: hrId });
    expect(r.decided_at).toBeTruthy();
    const [p] = await db.as<{ id: string }>('authenticated', empUserId, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date, half_day) values ($1, $2, '2030-03-05', '2030-03-05', true) returning id`, [empId, await cl()]);
    const [c] = await db.as<{ status: string }>('authenticated', empUserId, `update leave_requests set status = 'cancelled' where id = $1 returning status`, [p.id]);
    expect(c.status).toBe('cancelled');
  });

  it('keeps leave types and holidays read-only for employees', async () => {
    expect((await db.as('authenticated', empUserId, `select 1 from leave_types`)).length).toBe(4);
    await expect(db.as('authenticated', empUserId, `insert into holidays (company_id, holiday_date, name) values ($1, '2030-04-14', 'Tamil New Year')`, [acme.companyId])).rejects.toThrow(/row-level security/);
    expect(await db.as('authenticated', empUserId, `update leave_types set annual_quota = 99 returning id`)).toHaveLength(0);
  });
});
