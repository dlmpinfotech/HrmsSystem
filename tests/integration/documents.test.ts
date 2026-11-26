import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/** Employee documents (0014): privacy, approval, versions, file paths and alerts. */
describe('Employee documents (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let beta: { companyId: string; adminId: string };
  let hrId: string;
  let anbuUser: string;
  let banuUser: string;
  let anbu: string;
  let banu: string;

  const hr = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>('authenticated', hrId, sql, params);
  const as = <T = Record<string, unknown>>(u: string, sql: string, params: unknown[] = []) => db.as<T>('authenticated', u, sql, params);
  const addMember = async (companyId: string, email: string, role: string) => {
    const id = await db.createUser(email);
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, $3)`, [companyId, id, role]);
    return id;
  };
  const path = (emp: string, name: string, company = acme.companyId) => `${company}/${emp}/${name}`;
  const insert = (user: string, emp: string, file: string, extra: { expires?: string; replaces?: string } = {}) =>
    as<{ id: string; status: string; version: number; is_current: boolean }>(
      user,
      `insert into employee_documents (employee_id, category, title, file_path, file_name, mime_type, file_size, expires_on, replaces_id, status)
       values ($1, 'id_proof', 'Aadhaar', $2, 'a.pdf', 'application/pdf', 1000, $3, $4, 'approved') returning id, status, version, is_current`,
      [emp, file, extra.expires ?? null, extra.replaces ?? null],
    ).then((r) => r[0]);

  beforeAll(async () => {
    db = await createTestDb();
    acme = await createTenant(db, 'Acme Mills', 'owner@acme.test');
    beta = await createTenant(db, 'Beta Labs', 'owner@beta.test');
    hrId = await addMember(acme.companyId, 'hr@acme.test', 'hr_manager');
    const rows = await hr<{ id: string }>(`insert into employees (company_id, employee_code, full_name, email) values ($1, 'A1', 'Anbu', 'anbu@acme.test'), ($1, 'B1', 'Banu', 'banu@acme.test') returning id`, [acme.companyId]);
    [anbu, banu] = rows.map((r) => r.id);
    anbuUser = await addMember(acme.companyId, 'anbu@acme.test', 'employee');
    banuUser = await addMember(acme.companyId, 'banu@acme.test', 'employee');
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('makes employee uploads wait for HR, even if they ask for approved', async () => {
    const mine = await insert(anbuUser, anbu, path(anbu, '1.pdf'));
    expect(mine).toMatchObject({ status: 'pending', version: 1 });
    expect(await as(anbuUser, `update employee_documents set status = 'approved' where id = $1 returning id`, [mine.id])).toHaveLength(0);
    const [ok] = await hr<{ status: string; decided_by: string }>(`update employee_documents set status = 'approved' where id = $1 returning status, decided_by`, [mine.id]);
    expect(ok).toEqual({ status: 'approved', decided_by: hrId });
  });

  it('keeps documents private to the employee and their HR', async () => {
    expect(await as(banuUser, `select 1 from employee_documents`)).toHaveLength(0);
    expect(await db.as('authenticated', beta.adminId, `select 1 from employee_documents`)).toHaveLength(0);
    await expect(db.as('anon', null, `select 1 from employee_documents`)).rejects.toThrow(/permission denied/);
    await expect(insert(banuUser, anbu, path(anbu, '2.pdf'))).rejects.toThrow(/not_allowed|row-level security/);
  });

  it("refuses a row that points outside the employee's own folder", async () => {
    await expect(insert(banuUser, banu, path(anbu, '1.pdf'))).rejects.toThrow(/invalid_file_path/);
    await expect(insert(banuUser, banu, `${path(banu, '..')}/../${anbu}/x.pdf`)).rejects.toThrow(/invalid_file_path/);
  });

  it('replaces an old version only when the new one is approved', async () => {
    const [old] = await hr<{ id: string }>(`select id from employee_documents where employee_id = $1`, [anbu]);
    const next = await insert(anbuUser, anbu, path(anbu, '3.pdf'), { replaces: old.id });
    expect(next).toMatchObject({ status: 'pending', version: 2 });
    const current = async (id: string) => (await hr<{ is_current: boolean }>(`select is_current from employee_documents where id = $1`, [id]))[0].is_current;
    expect(await current(old.id)).toBe(true);
    await hr(`update employee_documents set status = 'approved' where id = $1`, [next.id]);
    expect(await current(old.id)).toBe(false);
    await expect(hr(`update employee_documents set file_path = $2 where id = $1`, [next.id, path(anbu, '9.pdf')])).rejects.toThrow(/document_file_fixed/);
    // An employee cannot delete an approved document.
    expect(await as(anbuUser, `delete from employee_documents where id = $1 returning id`, [next.id])).toHaveLength(0);
  });

  it('guards the stored files the same way', async () => {
    const put = (u: string, name: string) => as(u, `insert into storage.objects (bucket_id, name) values ('employee-documents', $1)`, [name]);
    await put(anbuUser, path(anbu, '1.pdf'));
    await put(hrId, path(banu, 'b.pdf'));
    await expect(put(banuUser, path(anbu, 'steal.pdf'))).rejects.toThrow(/row-level security/);
    await expect(put(anbuUser, path(anbu, 'x.pdf', beta.companyId))).rejects.toThrow(/row-level security/);
    expect(await as(banuUser, `select name from storage.objects where bucket_id = 'employee-documents'`)).toHaveLength(1);
    expect(await db.as('authenticated', beta.adminId, `select 1 from storage.objects where bucket_id = 'employee-documents'`)).toHaveLength(0);
    expect(await as(anbuUser, `delete from storage.objects where name = $1 returning id`, [path(anbu, '1.pdf')])).toHaveLength(0);
  });

  it('raises alerts for expiring documents and uploads waiting for review', async () => {
    const soon = new Date(Date.now() + 330 * 60_000 + 5 * 86_400_000).toISOString().slice(0, 10);
    await insert(hrId, banu, path(banu, 'c.pdf'), { expires: soon });
    await insert(banuUser, banu, path(banu, 'd.pdf'));
    const alerts = await hr<{ alert_type: string; employee_id: string }>(`select alert_type, employee_id from hr_attention($1)`, [acme.companyId]);
    const forBanu = alerts.filter((a) => a.employee_id === banu).map((a) => a.alert_type);
    expect(forBanu).toContain('document_expiry');
    expect(forBanu).toContain('pending_document');
  });
});
