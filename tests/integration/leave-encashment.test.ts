import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/** Leave encashment (0012): limits, balance, fixed amount at approval, paid once through payroll. */
describe('Leave encashment (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let beta: { companyId: string; adminId: string };
  let hrId: string;
  let empUser: string;
  let emp: string;
  let el: string;
  let cl: string;
  let encId: string;
  let runId: string;
  // Next month: every day is still in the future, so nobody has LOP.
  const now = new Date(Date.now() + 330 * 60_000);
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

  const hr = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>('authenticated', hrId, sql, params);
  const me = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>('authenticated', empUser, sql, params);
  const addMember = async (companyId: string, email: string, role: string) => {
    const id = await db.createUser(email);
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, $3)`, [companyId, id, role]);
    return id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    acme = await createTenant(db, 'Acme Mills', 'owner@acme.test');
    beta = await createTenant(db, 'Beta Labs', 'owner@beta.test');
    hrId = await addMember(acme.companyId, 'hr@acme.test', 'hr_manager');
    [{ id: emp }] = await hr<{ id: string }>(`insert into employees (company_id, employee_code, full_name, email, weekly_offs, date_of_joining) values ($1, 'E1', 'Ezhil', 'ezhil@acme.test', '{0}', '2025-01-01') returning id`, [acme.companyId]);
    empUser = await addMember(acme.companyId, 'ezhil@acme.test', 'employee');
    const types = Object.fromEntries((await db.admin<{ id: string; code: string }>(`select id, code from leave_types where company_id = $1`, [acme.companyId])).map((t) => [t.code, t.id]));
    el = types.EL;
    cl = types.CL;
    await hr(`update leave_types set encashable = true, max_encash_days = 10 where id = $1`, [el]);
    await hr(`update payroll_settings set pt_enabled = false where company_id = $1`, [acme.companyId]);
    await hr(`insert into payroll_settings (company_id, pt_enabled) values ($1, false) on conflict (company_id) do update set pt_enabled = false`, [acme.companyId]);
    // 3 days of EL taken in 2026 (15 per year).
    await hr(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date, status) values ($1, $2, '2026-03-03', '2026-03-05', 'approved')`, [emp, el]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('caps encashment by the yearly limit and the balance, and only for encashable types', async () => {
    const ask = (days: number, type = el) => me<{ id: string; status: string; amount: string | null }>(`insert into leave_encashments (employee_id, leave_type_id, year, days) values ($1, $2, 2026, $3) returning id, status, amount`, [emp, type, days]);
    await expect(ask(11)).rejects.toThrow(/encash_limit/);
    await expect(ask(2, cl)).rejects.toThrow(/not_encashable/);
    const [r] = await ask(10);
    expect(r).toMatchObject({ status: 'pending', amount: null });
    encId = r.id;
    // Pending encashment already holds the days: 15 − 3 taken − 10 = 2 left.
    await expect(me(`insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1, $2, '2026-12-08', '2026-12-10')`, [emp, el])).rejects.toThrow(/insufficient_balance/);
    await expect(me(`update leave_encashments set status = 'approved' where id = $1`, [encId])).rejects.toThrow(/only_cancel_pending/);
  });

  it('needs a salary to approve, then fixes the amount from basic ÷ 26', async () => {
    await expect(hr(`update leave_encashments set status = 'approved' where id = $1`, [encId])).rejects.toThrow(/no_salary_structure/);
    await hr(`insert into salary_structures (employee_id, effective_from, basic) values ($1, '2025-01-01', 13000)`, [emp]);
    const [r] = await hr<{ status: string; per_day: string; amount: string }>(`update leave_encashments set status = 'approved' where id = $1 returning status, per_day, amount`, [encId]);
    expect(r).toEqual({ status: 'approved', per_day: '500.00', amount: '5000.00' });
    const bal = (await me<{ leave_type_id: string; encashed: string; available: string; entitled: string }>(`select * from leave_balances($1, 2026)`, [emp])).find((b) => b.leave_type_id === el)!;
    expect(Number(bal.encashed)).toBe(10);
    expect(Number(bal.available)).toBe(2);
  });

  it('pays it once in the next payroll, outside ESI', async () => {
    const [run] = await hr<{ id: string }>(`select * from generate_payroll($1, $2)`, [acme.companyId, next]);
    runId = run.id;
    const [slip] = await hr<Record<string, string>>(`select * from payslips where run_id = $1`, [runId]);
    expect(slip).toMatchObject({ leave_encashment: '5000.00', gross: '18000.00', pf_employee: '1560.00', esi_employee: '98.00', net_pay: '16342.00' });
    // Recalculating keeps it in the same run.
    await hr(`select generate_payroll($1, $2)`, [acme.companyId, next]);
    expect((await hr<{ leave_encashment: string }>(`select leave_encashment from payslips where run_id = $1`, [runId]))[0].leave_encashment).toBe('5000.00');
    await expect(hr(`update leave_encashments set status = 'rejected' where id = $1`, [encId])).rejects.toThrow(/encashment_paid|cannot_decide/);
  });

  it('keeps encashments private', async () => {
    expect(await db.as('authenticated', beta.adminId, `select 1 from leave_encashments`)).toHaveLength(0);
    await expect(db.as('authenticated', beta.adminId, `insert into leave_encashments (employee_id, leave_type_id, year, days) values ($1, $2, 2026, 1)`, [emp, el])).rejects.toThrow(/not_allowed|row-level security/);
    await expect(db.as('anon', null, `select 1 from leave_encashments`)).rejects.toThrow(/permission denied/);
  });
});
