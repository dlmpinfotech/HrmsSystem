import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/** HR helpdesk and staff articles (0015). */
describe('HR helpdesk (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let beta: { companyId: string; adminId: string };
  let hrId: string;
  let anbuUser: string;
  let banuUser: string;
  let anbu: string;
  let ticket: string;

  const hr = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.as<T>('authenticated', hrId, sql, params);
  const as = <T = Record<string, unknown>>(u: string, sql: string, params: unknown[] = []) => db.as<T>('authenticated', u, sql, params);
  const addMember = async (companyId: string, email: string, role: string) => {
    const id = await db.createUser(email);
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, $3)`, [companyId, id, role]);
    return id;
  };
  const state = async () => (await hr<{ status: string; first_response_at: string | null; resolved_at: string | null }>(`select status, first_response_at, resolved_at from hr_tickets where id = $1`, [ticket]))[0];
  const say = (u: string, body: string, internal = false) => as(u, `insert into hr_ticket_messages (ticket_id, company_id, body, internal) values ($1, $2, $3, $4)`, [ticket, acme.companyId, body, internal]);

  beforeAll(async () => {
    db = await createTestDb();
    acme = await createTenant(db, 'Acme Mills', 'owner@acme.test');
    beta = await createTenant(db, 'Beta Labs', 'owner@beta.test');
    hrId = await addMember(acme.companyId, 'hr@acme.test', 'hr_manager');
    const rows = await hr<{ id: string }>(`insert into employees (company_id, employee_code, full_name, email) values ($1, 'A1', 'Anbu', 'anbu@acme.test'), ($1, 'B1', 'Banu', 'banu@acme.test') returning id`, [acme.companyId]);
    anbu = rows[0].id;
    anbuUser = await addMember(acme.companyId, 'anbu@acme.test', 'employee');
    banuUser = await addMember(acme.companyId, 'banu@acme.test', 'employee');
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it('opens a ticket with an answer-by time from its priority', async () => {
    const [r] = await as<{ id: string; status: string; hours: string; assigned_to: string | null }>(
      anbuUser,
      `insert into hr_tickets (employee_id, company_id, category, subject, priority, status, assigned_to) values ($1, $2, 'payroll', 'Salary slip question', 'high', 'resolved', $3)
       returning id, status, assigned_to, extract(epoch from (due_at - created_at)) / 3600 as hours`,
      [anbu, beta.companyId, hrId],
    );
    ticket = r.id;
    expect(r.status).toBe('open');
    expect(r.assigned_to).toBeNull();
    expect(Number(r.hours)).toBe(24);
    // The tenant comes from the employee, not from the client.
    expect((await hr<{ company_id: string }>(`select company_id from hr_tickets where id = $1`, [ticket]))[0].company_id).toBe(acme.companyId);
  });

  it('keeps tickets and internal notes private', async () => {
    expect(await as(banuUser, `select 1 from hr_tickets`)).toHaveLength(0);
    expect(await db.as('authenticated', beta.adminId, `select 1 from hr_tickets`)).toHaveLength(0);
    await expect(say(banuUser, 'peeking')).rejects.toThrow(/not_allowed|row-level security/);
    await say(hrId, 'Internal: check payroll', true);
    expect(await as(anbuUser, `select 1 from hr_ticket_messages`)).toHaveLength(0);
    // An internal note is not a reply.
    expect(await state()).toMatchObject({ status: 'open', first_response_at: null });
    await expect(db.as('anon', null, `select 1 from hr_tickets`)).rejects.toThrow(/permission denied/);
  });

  it('moves the status as the two sides reply', async () => {
    await say(hrId, 'Which month?');
    let s = await state();
    expect(s.status).toBe('waiting_employee');
    expect(s.first_response_at).not.toBeNull();
    await say(anbuUser, 'October');
    expect((await state()).status).toBe('open');
    await hr(`update hr_tickets set status = 'resolved' where id = $1`, [ticket]);
    s = await state();
    expect(s.resolved_at).not.toBeNull();
    await say(anbuUser, 'Still wrong');
    expect(await state()).toMatchObject({ status: 'open', resolved_at: null });
  });

  it('lets the employee only close or reopen, and blocks replies once closed', async () => {
    await expect(as(anbuUser, `update hr_tickets set priority = 'urgent' where id = $1`, [ticket])).rejects.toThrow(/only_close_or_reopen/);
    await expect(as(anbuUser, `update hr_tickets set status = 'resolved' where id = $1`, [ticket])).rejects.toThrow(/only_close_or_reopen/);
    await expect(hr(`update hr_tickets set assigned_to = $2 where id = $1`, [ticket, banuUser])).rejects.toThrow(/invalid_assignee/);
    await as(anbuUser, `update hr_tickets set status = 'closed' where id = $1`, [ticket]);
    await expect(say(anbuUser, 'one more')).rejects.toThrow(/ticket_closed/);
  });

  it("does not count HR's opening question as HR's reply", async () => {
    const [t] = await hr<{ id: string }>(`insert into hr_tickets (employee_id, company_id, category, subject) values ($1, $2, 'leave', 'Asked at the desk') returning id`, [anbu, acme.companyId]);
    const post = (body: string) => hr(`insert into hr_ticket_messages (ticket_id, company_id, body) values ($1, $2, $3)`, [t.id, acme.companyId, body]);
    const read = async () => (await hr<{ status: string; first_response_at: string | null }>(`select status, first_response_at from hr_tickets where id = $1`, [t.id]))[0];
    await post('Anbu asked about carry-forward');
    expect(await read()).toEqual({ status: 'open', first_response_at: null });
    await post('Up to 5 days carry forward');
    const after = await read();
    expect(after.status).toBe('waiting_employee');
    expect(after.first_response_at).not.toBeNull();
  });

  it('shows staff only published articles from their own company', async () => {
    await hr(`insert into hr_articles (company_id, title, body, published) values ($1, 'Leave policy', 'Apply early.', true), ($1, 'Draft policy', 'Not yet.', false)`, [acme.companyId]);
    expect((await as<{ title: string }>(anbuUser, `select title from hr_articles`)).map((a) => a.title)).toEqual(['Leave policy']);
    expect(await db.as('authenticated', beta.adminId, `select 1 from hr_articles`)).toHaveLength(0);
    await expect(as(anbuUser, `insert into hr_articles (company_id, title, body) values ($1, 'Mine', 'x')`, [acme.companyId])).rejects.toThrow(/row-level security/);
  });
});
