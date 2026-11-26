import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/** Two-step sign-in is enforced by the database (0017). */
describe('MFA enforcement (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let empUser: string;
  let empId: string;

  const aal = (level: '' | 'aal1' | 'aal2') => db.admin(`select set_config('request.jwt.claim.aal', $1, false)`, [level]);
  const admin = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>('authenticated', acme.adminId, sql, params);

  beforeAll(async () => {
    db = await createTestDb();
    acme = await createTenant(db, 'Acme Mills', 'owner@acme.test');
    [{ id: empId }] = await admin<{ id: string }>(`insert into employees (company_id, employee_code, full_name, email) values ($1, 'A1', 'Anbu', 'anbu@acme.test') returning id`, [acme.companyId]);
    empUser = await db.createUser('anbu@acme.test');
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, 'employee')`, [acme.companyId, empUser]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('every table with row-level security also requires the second step', async () => {
    const missing = await db.admin<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'mfa_required' and p.permissive = 'RESTRICTIVE')`,
    );
    expect(missing.map((m) => m.relname)).toEqual([]);
  });

  it('changes nothing for people without an authenticator', async () => {
    await aal('aal1');
    expect(await admin(`select 1 from employees`)).toHaveLength(1);
    // A factor that was never confirmed does not count.
    await db.admin(`insert into auth.mfa_factors (user_id, status) values ($1, 'unverified')`, [acme.adminId]);
    expect(await admin(`select 1 from employees`)).toHaveLength(1);
  });

  it('shows nothing with only a password once MFA is on, and everything after the second step', async () => {
    await db.admin(`update auth.mfa_factors set status = 'verified' where user_id = $1`, [acme.adminId]);
    await aal('aal1');
    for (const table of ['employees', 'companies', 'profiles', 'company_memberships', 'leave_types', 'subscriptions']) {
      expect(await admin(`select 1 from ${table}`), table).toHaveLength(0);
    }
    await expect(admin(`insert into employees (company_id, employee_code, full_name) values ($1, 'X', 'Nope')`, [acme.companyId])).rejects.toThrow(/row-level security/);
    await expect(admin(`select generate_payroll($1, '2026-10-01')`, [acme.companyId])).rejects.toThrow(/not_allowed|row-level security/);
    await expect(admin(`select * from hr_attention($1)`, [acme.companyId])).rejects.toThrow(/forbidden/);
    await aal('aal2');
    expect(await admin(`select 1 from employees`)).toHaveLength(1);
  });

  it('also blocks check-in without the second step', async () => {
    await db.admin(`insert into auth.mfa_factors (user_id, status) values ($1, 'verified')`, [empUser]);
    await aal('aal1');
    await expect(db.as('authenticated', empUser, `select clock_attendance($1, 'in')`, [acme.companyId])).rejects.toThrow(/mfa_required|no_employee_record/);
    expect(await db.admin(`select 1 from attendance_records where employee_id = $1`, [empId])).toHaveLength(0);
    await aal('aal2');
    await db.as('authenticated', empUser, `select clock_attendance($1, 'in')`, [acme.companyId]);
    expect(await db.admin(`select 1 from attendance_records where employee_id = $1`, [empId])).toHaveLength(1);
  });
});
