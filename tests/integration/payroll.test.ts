import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/** Payroll (0011): LOP from attendance + leave, PF / ESI / PT, finalize, and who can see what. */
describe('Payroll (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let beta: { companyId: string; adminId: string };
  let hrId: string;
  let anbuUser: string;
  let banuUser: string;
  let anbu: string;
  let banu: string;
  let runId: string;

  const hr = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>('authenticated', hrId, sql, params);
  const addMember = async (companyId: string, email: string, role: string) => {
    const id = await db.createUser(email);
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, $3)`, [companyId, id, role]);
    return id;
  };
  const present = (employee: string, from: string, to: string) =>
    db.admin(
      `insert into attendance_records (employee_id, company_id, work_date, check_in_at, check_out_at, source, status)
       select $1, $2, g::date, (g::date + time '09:00') at time zone 'Asia/Kolkata', (g::date + time '18:00') at time zone 'Asia/Kolkata', 'hr', 'present'
       from generate_series($3::date, $4::date, interval '1 day') g where extract(dow from g) <> 0`,
      [employee, acme.companyId, from, to],
    );
  const slip = async (employee: string) =>
    (await hr<Record<string, string>>(`select * from payslips where run_id = $1 and employee_id = $2`, [runId, employee]))[0];

  beforeAll(async () => {
    db = await createTestDb();
    acme = await createTenant(db, 'Acme Mills', 'owner@acme.test');
    beta = await createTenant(db, 'Beta Labs', 'owner@beta.test');
    hrId = await addMember(acme.companyId, 'hr@acme.test', 'hr_manager');
    const rows = await hr<{ id: string }>(
      `insert into employees (company_id, employee_code, full_name, email, weekly_offs, date_of_joining) values
         ($1, 'A1', 'Anbu', 'anbu@acme.test', '{0}', '2026-01-01'),
         ($1, 'B1', 'Banu', 'banu@acme.test', '{0}', '2026-10-16')
       returning id`,
      [acme.companyId],
    );
    [anbu, banu] = rows.map((r) => r.id);
    anbuUser = await addMember(acme.companyId, 'anbu@acme.test', 'employee');
    banuUser = await addMember(acme.companyId, 'banu@acme.test', 'employee');

    // October 2026: 31 days, 4 Sundays.
    await present(anbu, '2026-10-01', '2026-10-31');
    await db.admin(`delete from attendance_records where employee_id = $1 and work_date in ('2026-10-06', '2026-10-07', '2026-10-20', '2026-10-21')`, [anbu]);
    await db.admin(`update attendance_records set status = 'half_day' where employee_id = $1 and work_date = '2026-10-08'`, [anbu]);
    const types = Object.fromEntries((await db.admin<{ id: string; code: string }>(`select id, code from leave_types where company_id = $1`, [acme.companyId])).map((t) => [t.code, t.id]));
    await db.admin(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, status) values ($1, $2, '2026-10-20', '2026-10-20', 'approved'), ($1, $3, '2026-10-21', '2026-10-21', 'approved')`, [anbu, types.LOP, types.CL]);
    await present(banu, '2026-10-16', '2026-10-31');

    await hr(`insert into salary_structures (employee_id, effective_from, basic, hra, special_allowance) values ($1, '2026-01-01', 20000, 8000, 2000)`, [anbu]);
    await hr(`insert into salary_structures (employee_id, effective_from, basic, hra, conveyance) values ($1, '2026-10-16', 10000, 4000, 1600)`, [banu]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('works out LOP from absences, half days, unpaid leave and the joining date', async () => {
    const [run] = await hr<{ id: string; employee_count: number; status: string }>(`select * from generate_payroll($1, '2026-10-15')`, [acme.companyId]);
    runId = run.id;
    expect(run).toMatchObject({ employee_count: 2, status: 'draft' });
    const a = await slip(anbu);
    // 2 absent + 0.5 half day + 1 LOP leave; the paid CL day costs nothing.
    expect(a).toMatchObject({ days_in_month: 31, lop_days: '3.5', paid_days: '27.5', basic: '17742.00', gross: '26613.00', pf_employee: '1800.00', esi_employee: '0.00', professional_tax: '0.00', net_pay: '24813.00' });
    const b = await slip(banu);
    // Joined on the 16th: 15 days not employed.
    expect(b).toMatchObject({ lop_days: '15.0', gross: '8052.00', pf_employee: '619.00', esi_employee: '61.00', esi_employer: '262.00', net_pay: '7372.00' });
  });

  it('does not count today as absent before the day is over', async () => {
    const [{ today, day }] = await db.admin<{ today: string; day: number }>(
      `select (now() at time zone 'Asia/Kolkata')::date::text as today, extract(day from (now() at time zone 'Asia/Kolkata'))::int as day`,
    );
    const [e] = await db.admin<{ id: string }>(
      `insert into employees (company_id, employee_code, full_name, weekly_offs, date_of_joining, status) values ($1, 'T1', 'Today Joiner', '{}', $2, 'inactive') returning id`,
      [acme.companyId, today],
    );
    const lop = async (from: string, to: string) =>
      Number((await db.admin<{ v: string }>(`select payroll_lop_days($1, $2, $3) as v`, [e.id, from, to]))[0].v);
    // No check-in yet today: nothing lost for today, only the days before joining.
    expect(await lop(today, today)).toBe(0);
    expect(await lop(`${today.slice(0, 8)}01`, today)).toBe(day - 1);
    // A day HR has marked absent still counts, even today.
    await db.admin(`insert into attendance_records (employee_id, company_id, work_date, source, status) values ($1, $2, $3, 'hr', 'absent')`, [e.id, acme.companyId, today]);
    expect(await lop(today, today)).toBe(1);
  });

  it('charges monthly professional tax when set to monthly', async () => {
    await hr(`update payroll_settings set pt_frequency = 'monthly' where company_id = $1`, [acme.companyId]);
    await hr(`select generate_payroll($1, '2026-10-01')`, [acme.companyId]);
    expect((await slip(anbu)).professional_tax).toBe('208.00');
    const [run] = await hr<{ total_net: string; employee_count: number }>(`select * from payroll_runs where id = $1`, [runId]);
    expect(run.employee_count).toBe(2);
    expect(Number(run.total_net)).toBe(24813 - 208 + 7372 - 208);
  });

  it('hides draft payslips from employees and shows only their own once finalized', async () => {
    expect(await db.as('authenticated', anbuUser, `select 1 from payslips`)).toHaveLength(0);
    const [fin] = await hr<{ status: string }>(`select * from set_payroll_status($1, 'finalized')`, [runId]);
    expect(fin.status).toBe('finalized');
    const mine = await db.as<{ employee_id: string }>('authenticated', anbuUser, `select employee_id from payslips`);
    expect(mine.map((r) => r.employee_id)).toEqual([anbu]);
    expect(await db.as('authenticated', anbuUser, `select 1 from payroll_runs`)).toHaveLength(0);
    // Employees see their own salary structure, never a colleague's.
    expect(await db.as('authenticated', banuUser, `select basic from salary_structures`)).toEqual([{ basic: '10000.00' }]);
  });

  it('locks a finalized month; only a Company Admin can reopen it', async () => {
    await expect(hr(`select generate_payroll($1, '2026-10-01')`, [acme.companyId])).rejects.toThrow(/payroll_finalized/);
    await expect(hr(`select set_payroll_status($1, 'draft')`, [runId])).rejects.toThrow(/not_allowed/);
    const [open] = await db.as<{ status: string }>('authenticated', acme.adminId, `select * from set_payroll_status($1, 'draft')`, [runId]);
    expect(open.status).toBe('draft');
  });

  it('keeps payroll writes inside the functions and other people out', async () => {
    await expect(hr(`update payslips set net_pay = 99999 where run_id = $1`, [runId])).rejects.toThrow(/permission denied/);
    await expect(hr(`insert into payroll_runs (company_id, period) values ($1, '2026-12-01')`, [acme.companyId])).rejects.toThrow(/permission denied/);
    await expect(db.as('authenticated', anbuUser, `select generate_payroll($1, '2026-11-01')`, [acme.companyId])).rejects.toThrow(/not_allowed/);
    await expect(db.as('authenticated', anbuUser, `insert into salary_structures (employee_id, effective_from, basic) values ($1, '2026-11-01', 99999)`, [anbu])).rejects.toThrow(/row-level security/);
    expect(await db.as('authenticated', beta.adminId, `select 1 from payslips`)).toHaveLength(0);
    expect(await db.as('authenticated', beta.adminId, `select 1 from salary_structures`)).toHaveLength(0);
    await expect(db.as('authenticated', beta.adminId, `select generate_payroll($1, '2026-11-01')`, [acme.companyId])).rejects.toThrow(/not_allowed/);
    await expect(db.as('anon', null, `select 1 from payslips`)).rejects.toThrow(/permission denied/);
  });
});
