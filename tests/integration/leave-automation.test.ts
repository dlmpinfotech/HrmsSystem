import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/** Manager scope, two-level approval, hourly permissions, accrual, carry-forward, comp-off and team calendar (0009). */
describe('Leave automation (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let beta: { companyId: string; adminId: string };
  let hrId: string;
  let meenaUser: string; // manager
  let raviUser: string; // reports to Meena
  let kalaUser: string; // other department, no manager
  let meena: string;
  let ravi: string;
  let kala: string;
  const types: Record<string, string> = {};

  const hr = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>('authenticated', hrId, sql, params);
  const as = <T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) => db.as<T>('authenticated', user, sql, params);
  const addMember = async (companyId: string, email: string, role: string) => {
    const id = await db.createUser(email);
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, $3)`, [companyId, id, role]);
    return id;
  };
  const apply = (user: string, employee: string, code: string, start: string, end = start, extra = '') =>
    as<{ id: string; status: string; days: string; hours: string | null; comp_off_credit_id: string | null }>(
      user,
      `insert into leave_requests (employee_id, leave_type_id, start_date, end_date${extra ? ', start_time, end_time' : ''})
       values ($1, $2, $3, $4${extra ? `, ${extra}` : ''}) returning id, status, days, hours, comp_off_credit_id`,
      [employee, types[code], start, end],
    ).then((r) => r[0]);

  beforeAll(async () => {
    db = await createTestDb();
    acme = await createTenant(db, 'Acme Mills', 'owner@acme.test');
    beta = await createTenant(db, 'Beta Labs', 'owner@beta.test');
    hrId = await addMember(acme.companyId, 'hr@acme.test', 'hr_manager');
    const rows = await hr<{ id: string }>(
      `insert into employees (company_id, employee_code, full_name, email, department, weekly_offs, date_of_joining) values
         ($1, 'M1', 'Meena', 'meena@acme.test', 'Weaving', '{0}', '2028-01-01'),
         ($1, 'R1', 'Ravi',  'ravi@acme.test',  'Weaving', '{0}', '2029-01-01'),
         ($1, 'K1', 'Kala',  'kala@acme.test',  'Dyeing',  '{0}', '2029-01-01')
       returning id`,
      [acme.companyId],
    );
    [meena, ravi, kala] = rows.map((r) => r.id);
    await hr(`update employees set reporting_manager_id = $1 where id = $2`, [meena, ravi]);
    meenaUser = await addMember(acme.companyId, 'meena@acme.test', 'employee');
    raviUser = await addMember(acme.companyId, 'ravi@acme.test', 'employee');
    kalaUser = await addMember(acme.companyId, 'kala@acme.test', 'employee');
    for (const t of await db.admin<{ id: string; code: string }>(`select id, code from leave_types where company_id = $1`, [acme.companyId])) types[t.code] = t.id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('seeds Compensatory Off and Permission types for every company', async () => {
    expect(Object.keys(types).sort()).toEqual(['CL', 'CO', 'EL', 'LOP', 'PER', 'SL']);
    const [per] = await db.admin<{ unit: string; max_hours_per_month: string }>(`select unit, max_hours_per_month from leave_types where id = $1`, [types.PER]);
    expect(per).toEqual({ unit: 'hour', max_hours_per_month: '4.0' });
  });

  it('lets a manager see only their own reports', async () => {
    const seen = await as<{ full_name: string }>(meenaUser, `select full_name from employees order by full_name`);
    expect(seen.map((r) => r.full_name)).toEqual(['Meena', 'Ravi']);
    expect(await as(raviUser, `select 1 from employees where id = $1`, [meena])).toHaveLength(0);
    expect(await as(kalaUser, `select 1 from employees where id = $1`, [ravi])).toHaveLength(0);
  });

  it('runs two-level approval: manager first, then HR', async () => {
    await hr(`update leave_types set approval_levels = 2 where id = $1`, [types.CL]);
    const req = await apply(raviUser, ravi, 'CL', '2031-01-06');
    expect(req.status).toBe('pending');
    expect(await as(kalaUser, `update leave_requests set status = 'approved' where id = $1 returning id`, [req.id])).toHaveLength(0);

    const [step] = await as<{ status: string; approval_step: number; manager_decided_by: string }>(
      meenaUser, `update leave_requests set status = 'approved', decision_note = 'OK from me' where id = $1 returning status, approval_step, manager_decided_by`, [req.id],
    );
    expect(step).toEqual({ status: 'pending', approval_step: 2, manager_decided_by: meenaUser });
    // The manager cannot also give the final approval.
    await expect(as(meenaUser, `update leave_requests set status = 'approved' where id = $1`, [req.id])).rejects.toThrow(/only_cancel_pending/);

    const [done] = await hr<{ status: string; decided_by: string }>(`update leave_requests set status = 'approved' where id = $1 returning status, decided_by`, [req.id]);
    expect(done).toEqual({ status: 'approved', decided_by: hrId });
  });

  it('lets the manager give the final decision on one-level types, and reject', async () => {
    const a = await apply(raviUser, ravi, 'SL', '2031-01-07');
    const [ok] = await as<{ status: string; decided_by: string }>(meenaUser, `update leave_requests set status = 'approved' where id = $1 returning status, decided_by`, [a.id]);
    expect(ok).toEqual({ status: 'approved', decided_by: meenaUser });
    const b = await apply(raviUser, ravi, 'SL', '2031-01-08');
    const [no] = await as<{ status: string }>(meenaUser, `update leave_requests set status = 'rejected' where id = $1 returning status`, [b.id]);
    expect(no.status).toBe('rejected');
    // Managers cannot apply on a report's behalf or change dates.
    await expect(apply(meenaUser, ravi, 'SL', '2031-01-09')).rejects.toThrow(/row-level security/);
    await expect(as(meenaUser, `update leave_requests set start_date = '2031-01-10', end_date = '2031-01-10' where id = $1`, [a.id])).rejects.toThrow(/only_cancel_pending/);
  });

  it('handles hourly permissions with a monthly hour limit', async () => {
    const p1 = await apply(raviUser, ravi, 'PER', '2031-02-03', '2031-02-03', `'09:00', '11:00'`);
    expect(p1).toMatchObject({ days: '0.0', hours: '2.00' });
    await expect(apply(raviUser, ravi, 'PER', '2031-02-03', '2031-02-03', `'10:00', '11:30'`)).rejects.toThrow(/leave_overlap/);
    await apply(raviUser, ravi, 'PER', '2031-02-03', '2031-02-03', `'16:00', '18:00'`);
    await expect(apply(raviUser, ravi, 'PER', '2031-02-10', '2031-02-10', `'16:00', '17:00'`)).rejects.toThrow(/insufficient_balance/);
    // Next month starts fresh.
    await apply(raviUser, ravi, 'PER', '2031-03-10', '2031-03-10', `'16:00', '17:00'`);
    await expect(apply(raviUser, ravi, 'PER', '2031-02-11')).rejects.toThrow(/hours_required/);
    await expect(apply(raviUser, ravi, 'SL', '2031-02-12', '2031-02-12', `'09:00', '10:00'`)).rejects.toThrow(/hours_not_allowed/);
  });

  it('accrues monthly-accrual leave month by month', async () => {
    await hr(`update leave_types set accrual = 'monthly', annual_quota = 12 where id = $1`, [types.EL]);
    // By March, 3 days have accrued.
    await expect(apply(kalaUser, kala, 'EL', '2031-03-03', '2031-03-06')).rejects.toThrow(/insufficient_balance/);
    const ok = await apply(kalaUser, kala, 'EL', '2031-03-03', '2031-03-05');
    expect(ok.days).toBe('3.0');
  });

  it('carries forward unused days up to the cap', async () => {
    await hr(`update leave_types set carry_forward_max = 5 where id = $1`, [types.SL]);
    await hr(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, status) values ($1, $2, '2030-05-06', '2030-05-07', 'approved')`, [kala, types.SL]);
    const rows = await as<{ leave_type_id: string; entitled: string; carried: string; available: string }>(kalaUser, `select * from leave_balances($1, 2031)`, [kala]);
    const sl = rows.find((r) => r.leave_type_id === types.SL)!;
    expect(Number(sl.entitled)).toBe(17);
    expect(Number(sl.carried)).toBe(5);
    // Ravi may not read Kala's balances.
    expect(await as(raviUser, `select * from leave_balances($1, 2031)`, [kala])).toHaveLength(0);
  });

  it('earns comp-off for work on an off day and spends it once', async () => {
    await expect(as(raviUser, `insert into comp_off_credits (employee_id, work_date) values ($1, '2026-11-02')`, [ravi])).rejects.toThrow(/not_an_off_day/);
    await expect(as(raviUser, `insert into comp_off_credits (employee_id, work_date) values ($1, '2026-10-25')`, [ravi])).rejects.toThrow(/no_attendance_on_day/);
    await db.admin(`insert into attendance_records (employee_id, company_id, work_date, check_in_at, check_out_at, source) values ($1, $2, '2026-11-01', '2026-11-01T04:00:00Z', '2026-11-01T12:00:00Z', 'hr')`, [ravi, acme.companyId]);
    const [credit] = await as<{ id: string; status: string; expires_on: string }>(raviUser, `insert into comp_off_credits (employee_id, work_date, status, expires_on) values ($1, '2026-11-01', 'pending', '2099-01-01') returning id, status, expires_on::text`, [ravi]);
    expect(credit.expires_on).toBe('2027-01-30');
    await expect(as(raviUser, `update comp_off_credits set status = 'approved' where id = $1`, [credit.id])).rejects.toThrow(/only_cancel_pending/);

    await expect(apply(raviUser, ravi, 'CO', '2026-12-01')).rejects.toThrow(/insufficient_balance/);
    await as(meenaUser, `update comp_off_credits set status = 'approved' where id = $1`, [credit.id]);
    const used = await apply(raviUser, ravi, 'CO', '2026-12-01');
    expect(used.comp_off_credit_id).toBe(credit.id);
    await expect(apply(raviUser, ravi, 'CO', '2026-12-02')).rejects.toThrow(/insufficient_balance/);
    await expect(hr(`update comp_off_credits set status = 'cancelled' where id = $1`, [credit.id])).rejects.toThrow(/credit_in_use/);

    // Withdrawing the leave frees the credit again.
    const [w] = await as<{ comp_off_credit_id: string | null }>(raviUser, `update leave_requests set status = 'cancelled' where id = $1 returning comp_off_credit_id`, [used.id]);
    expect(w.comp_off_credit_id).toBeNull();
    const again = await apply(raviUser, ravi, 'CO', '2026-12-02');
    expect(again.comp_off_credit_id).toBe(credit.id);
  });

  it('shows the team calendar to the right people only', async () => {
    const names = async (user: string) => [...new Set((await as<{ full_name: string }>(user, `select full_name from team_leave($1, '2031-02-01', '2031-03-31')`, [acme.companyId])).map((r) => r.full_name))].sort();
    expect(await names(hrId)).toEqual(['Kala', 'Ravi']);
    expect(await names(meenaUser)).toEqual(['Ravi']);
    expect(await names(kalaUser)).toEqual(['Kala']);
    await expect(as(hrId, `select * from team_leave($1, '2031-01-01', '2031-06-01')`, [acme.companyId])).rejects.toThrow(/range_too_long/);
    expect(await db.as('authenticated', beta.adminId, `select * from team_leave($1, '2031-01-01', '2031-03-01')`, [acme.companyId])).toHaveLength(0);
  });

  it('keeps comp-off credits private and internal functions closed', async () => {
    expect(await db.as('authenticated', beta.adminId, `select 1 from comp_off_credits`)).toHaveLength(0);
    expect(await as(kalaUser, `select 1 from comp_off_credits`)).toHaveLength(0);
    await expect(db.as('anon', null, `select 1 from comp_off_credits`)).rejects.toThrow(/permission denied/);
    await expect(as(raviUser, `select leave_entitlement($1, $2, 2031)`, [ravi, types.SL])).rejects.toThrow(/permission denied/);
  });
});
