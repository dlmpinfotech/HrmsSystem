import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/** Company assets, approval delegation and time limits (0016). */
describe('Assets and approval delegation (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let beta: { companyId: string; adminId: string };
  let hrId: string;
  let mgrUser: string;
  let delUser: string;
  let empUser: string;
  let mgr: string;
  let del: string;
  let emp: string;
  let sl: string;

  const hr = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>('authenticated', hrId, sql, params);
  const as = <T = Record<string, unknown>>(u: string, sql: string, params: unknown[] = []) => db.as<T>('authenticated', u, sql, params);
  const addMember = async (companyId: string, email: string, role: string) => {
    const id = await db.createUser(email);
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, $3)`, [companyId, id, role]);
    return id;
  };
  const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const team = async (u: string) => (await as<{ t: string }>(u, `select my_approval_team($1) as t`, [acme.companyId])).map((r) => r.t).sort();

  beforeAll(async () => {
    db = await createTestDb();
    acme = await createTenant(db, 'Acme Mills', 'owner@acme.test');
    beta = await createTenant(db, 'Beta Labs', 'owner@beta.test');
    hrId = await addMember(acme.companyId, 'hr@acme.test', 'hr_manager');
    const rows = await hr<{ id: string }>(
      `insert into employees (company_id, employee_code, full_name, email, weekly_offs) values ($1, 'M', 'Mala', 'm@acme.test', '{}'), ($1, 'D', 'Dev', 'd@acme.test', '{}'), ($1, 'E', 'Esha', 'e@acme.test', '{}') returning id`,
      [acme.companyId],
    );
    [mgr, del, emp] = rows.map((r) => r.id);
    await hr(`update employees set reporting_manager_id = $1 where id = $2`, [mgr, emp]);
    mgrUser = await addMember(acme.companyId, 'm@acme.test', 'employee');
    delUser = await addMember(acme.companyId, 'd@acme.test', 'employee');
    empUser = await addMember(acme.companyId, 'e@acme.test', 'employee');
    sl = (await db.admin<{ id: string }>(`select id from leave_types where company_id = $1 and code = 'SL'`, [acme.companyId]))[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('assigns an asset to one person at a time and frees it on return', async () => {
    const [a] = await hr<{ id: string }>(`insert into company_assets (company_id, asset_tag, name, category) values ($1, 'LT-1', 'Dell laptop', 'laptop') returning id`, [acme.companyId]);
    const give = (e: string) => hr<{ id: string }>(`insert into asset_assignments (company_id, asset_id, employee_id) values ($1, $2, $3) returning id`, [acme.companyId, a.id, e]);
    const status = async () => (await hr<{ status: string }>(`select status from company_assets where id = $1`, [a.id]))[0].status;
    const [first] = await give(emp);
    expect(await status()).toBe('assigned');
    await expect(give(del)).rejects.toThrow(/asset_not_available|duplicate/);
    await expect(hr(`update company_assets set status = 'retired' where id = $1`, [a.id])).rejects.toThrow(/asset_assigned/);
    // The holder sees it; a colleague and another company do not.
    expect(await as(empUser, `select name from company_assets`)).toHaveLength(1);
    expect(await as(delUser, `select 1 from company_assets`)).toHaveLength(0);
    expect(await db.as('authenticated', beta.adminId, `select 1 from asset_assignments`)).toHaveLength(0);
    expect(await as(empUser, `update asset_assignments set returned_on = $2 where id = $1 returning id`, [first.id, today()])).toHaveLength(0);
    await hr(`update asset_assignments set returned_on = $2 where id = $1`, [first.id, today()]);
    expect(await status()).toBe('available');
    expect(await as(empUser, `select 1 from company_assets`)).toHaveLength(0);
  });

  it('lets a delegate approve only while the delegation is active', async () => {
    expect(await team(mgrUser)).toEqual([emp]);
    expect(await team(delUser)).toEqual([]);
    const [req] = await as<{ id: string }>(empUser, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1, $2, '2031-04-07', '2031-04-07') returning id`, [emp, sl]);
    expect(await as(delUser, `update leave_requests set status = 'approved' where id = $1 returning id`, [req.id])).toHaveLength(0);
    // A colleague cannot make themselves the delegate.
    await expect(as(delUser, `insert into approval_delegations (company_id, manager_employee_id, delegate_employee_id, from_date, to_date) values ($1, $2, $3, $4, $4)`, [acme.companyId, mgr, del, today()])).rejects.toThrow(/row-level security/);
    await as(mgrUser, `insert into approval_delegations (company_id, manager_employee_id, delegate_employee_id, from_date, to_date) values ($1, $2, $3, $4, $4)`, [acme.companyId, mgr, del, today()]);
    expect(await team(delUser)).toEqual([emp]);
    const [ok] = await as<{ status: string; decided_by: string }>(delUser, `update leave_requests set status = 'approved' where id = $1 returning status, decided_by`, [req.id]);
    expect(ok).toEqual({ status: 'approved', decided_by: delUser });
    await db.admin(`update approval_delegations set from_date = '2020-01-01', to_date = '2020-01-02'`);
    expect(await team(delUser)).toEqual([]);
  });

  it('shows colleague names only to HR and managers', async () => {
    const names = async (u: string) => (await as(u, `select full_name from colleague_names($1)`, [acme.companyId])).length;
    expect(await names(hrId)).toBe(3);
    expect(await names(mgrUser)).toBe(3);
    expect(await names(empUser)).toBe(0);
    expect(await names(beta.adminId)).toBe(0);
  });

  it('never lets a delegate approve their own request', async () => {
    await hr(`update employees set reporting_manager_id = $1 where id = $2`, [mgr, del]);
    await as(mgrUser, `insert into approval_delegations (company_id, manager_employee_id, delegate_employee_id, from_date, to_date) values ($1, $2, $3, $4, $4)`, [acme.companyId, mgr, del, today()]);
    expect(await team(delUser)).toEqual([emp]);
    const [own] = await as<{ id: string }>(delUser, `insert into leave_requests (employee_id, leave_type_id, start_date, end_date) values ($1, $2, '2031-05-05', '2031-05-05') returning id`, [del, sl]);
    await expect(as(delUser, `update leave_requests set status = 'approved' where id = $1`, [own.id])).rejects.toThrow(/only_cancel_pending/);
  });

  it('keeps time limits sensible and HR-only', async () => {
    await expect(hr(`insert into hr_settings (company_id, remind_after_hours, escalate_after_hours) values ($1, 48, 24)`, [acme.companyId])).rejects.toThrow(/check constraint/);
    await hr(`insert into hr_settings (company_id, remind_after_hours, escalate_after_hours) values ($1, 8, 24)`, [acme.companyId]);
    expect(await as(empUser, `select 1 from hr_settings`)).toHaveLength(0);
    await expect(db.as('anon', null, `select 1 from company_assets`)).rejects.toThrow(/permission denied/);
  });
});
