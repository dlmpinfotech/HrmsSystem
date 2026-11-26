import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, createTestDb, type TestDb } from '../helpers/db';

/**
 * Exercises the real RLS policies, triggers and functions from supabase/migrations
 * inside an in-process Postgres, acting as each role the way PostgREST would.
 */
describe('tenant isolation, roles and business rules (database)', () => {
  let db: TestDb;
  let acme: { companyId: string; adminId: string };
  let beta: { companyId: string; adminId: string };
  let superAdmin: string;
  let salesAdmin: string;
  let execA: string;
  let execB: string;
  let support: string;
  let acmeUser: string;

  beforeAll(async () => {
    db = await createTestDb();
    superAdmin = await db.createUser('root@platform.test', ['super_admin']);
    salesAdmin = await db.createUser('salesadmin@platform.test', ['sales_admin']);
    execA = await db.createUser('exec.a@platform.test', ['sales_executive']);
    execB = await db.createUser('exec.b@platform.test', ['sales_executive']);
    support = await db.createUser('support@platform.test', ['support_executive']);
    acme = await createTenant(db, 'Acme Textiles', 'owner@acme.test');
    beta = await createTenant(db, 'Beta Hospital', 'owner@beta.test');
    acmeUser = await db.createUser('staff@acme.test');
    await db.admin(`insert into company_memberships (company_id, user_id, role) values ($1, $2, 'customer_user')`, [acme.companyId, acmeUser]);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  // ── Provisioning ────────────────────────────────────────────────────
  it('provisions a trial tenant with branding, subscription, contact and onboarding', async () => {
    const [row] = await db.admin<{ status: string; sub: string; tasks: number; branding: number; admin_role: string }>(
      `select c.status,
              (select status from subscriptions where company_id = c.id) as sub,
              (select count(*)::int from onboarding_tasks where company_id = c.id) as tasks,
              (select count(*)::int from company_branding where company_id = c.id) as branding,
              (select role from company_memberships where company_id = c.id and user_id = $2) as admin_role
       from companies c where c.id = $1`,
      [acme.companyId, acme.adminId],
    );
    expect(row).toEqual({ status: 'trial', sub: 'trialing', tasks: 7, branding: 1, admin_role: 'customer_admin' });
  });

  it('does not let browsers call backend-only provisioning functions', async () => {
    await expect(db.as('authenticated', acme.adminId, `select provision_trial($1,'X','Y','9876500001','x@y.test',null,null,null,'starter','en',true)`, [acme.adminId])).rejects.toThrow(/permission denied/);
    await expect(db.as('anon', null, `select expire_subscriptions()`)).rejects.toThrow(/permission denied/);
  });

  // ── Tenant isolation ────────────────────────────────────────────────
  it('shows a customer only their own company', async () => {
    const rows = await db.as<{ id: string }>('authenticated', acme.adminId, `select id from companies`);
    expect(rows.map((r) => r.id)).toEqual([acme.companyId]);
  });

  it("hides other tenants' branding, subscriptions, invoices and tickets", async () => {
    await db.admin(`insert into invoices (company_id, amount, total) values ($1, 100, 118)`, [beta.companyId]);
    await db.admin(`insert into support_tickets (company_id, subject, description) values ($1, 'Beta issue', 'Something is wrong here')`, [beta.companyId]);
    for (const table of ['company_branding', 'subscriptions', 'invoices', 'support_tickets', 'onboarding_tasks', 'customer_contacts']) {
      const rows = await db.as<{ company_id: string }>('authenticated', acme.adminId, `select company_id from ${table}`);
      expect(rows.every((r) => r.company_id === acme.companyId), table).toBe(true);
    }
  });

  it("prevents updating another tenant's branding", async () => {
    const rows = await db.as('authenticated', acme.adminId, `update company_branding set display_name = 'Hacked' where company_id = $1 returning company_id`, [beta.companyId]);
    expect(rows).toHaveLength(0);
    const [b] = await db.admin<{ display_name: string }>(`select display_name from company_branding where company_id = $1`, [beta.companyId]);
    expect(b.display_name).toBe('Beta Hospital');
  });

  it('lets only company admins (not regular members) change branding', async () => {
    const asUser = await db.as('authenticated', acmeUser, `update company_branding set tagline = 'x' where company_id = $1 returning company_id`, [acme.companyId]);
    expect(asUser).toHaveLength(0);
    const asAdmin = await db.as('authenticated', acme.adminId, `update company_branding set tagline = 'Weaving since 1990', colors = '{"primary":"#b45309"}' where company_id = $1 returning company_id`, [acme.companyId]);
    expect(asAdmin).toHaveLength(1);
  });

  it('stops customers changing protected company fields (status, HRMS link)', async () => {
    await expect(db.as('authenticated', acme.adminId, `update companies set status = 'active' where id = $1`, [acme.companyId])).rejects.toThrow(/protected company fields/);
    await expect(db.as('authenticated', acme.adminId, `update companies set hrms_url = 'https://evil.test' where id = $1`, [acme.companyId])).rejects.toThrow(/protected company fields/);
    const ok = await db.as('authenticated', acme.adminId, `update companies set address = 'Palayamkottai' where id = $1 returning id`, [acme.companyId]);
    expect(ok).toHaveLength(1);
  });

  it('confines storage uploads to the tenant folder', async () => {
    await expect(db.as('authenticated', acme.adminId, `insert into storage.objects (bucket_id, name) values ('branding', $1)`, [`${beta.companyId}/logo-1.png`])).rejects.toThrow(/row-level security/);
    const ok = await db.as('authenticated', acme.adminId, `insert into storage.objects (bucket_id, name) values ('branding', $1) returning name`, [`${acme.companyId}/logo-1.png`]);
    expect(ok).toHaveLength(1);
    await expect(db.as('authenticated', acmeUser, `insert into storage.objects (bucket_id, name) values ('branding', $1)`, [`${acme.companyId}/logo-2.png`])).rejects.toThrow(/row-level security/);
  });

  it('prevents privilege escalation through user_roles and memberships', async () => {
    await expect(db.as('authenticated', acme.adminId, `insert into user_roles (user_id, role_key) values ($1, 'super_admin')`, [acme.adminId])).rejects.toThrow(/row-level security/);
    await expect(db.as('authenticated', acme.adminId, `insert into company_memberships (company_id, user_id, role) values ($1, $2, 'customer_admin')`, [beta.companyId, acme.adminId])).rejects.toThrow(/row-level security/);
    await expect(db.as('authenticated', acme.adminId, `update profiles set is_active = false where id = $1`, [acme.adminId])).rejects.toThrow(/protected profile fields/);
  });

  it('keeps anonymous visitors out of all private tables', async () => {
    for (const table of ['leads', 'companies', 'subscriptions', 'profiles', 'notification_logs', 'audit_logs', 'employees', 'leave_requests', 'comp_off_credits', 'payslips', 'salary_structures', 'payroll_runs', 'employee_documents', 'hr_tickets', 'hr_ticket_messages', 'hr_articles', 'company_assets', 'asset_assignments', 'approval_delegations', 'hr_settings']) {
      await expect(db.as('anon', null, `select * from ${table} limit 1`), table).rejects.toThrow(/permission denied/);
    }
    const plans = await db.as<{ key: string }>('anon', null, `select key from plans`);
    expect(plans.length).toBe(4);
    const settings = await db.as<{ key: string }>('anon', null, `select key from app_settings`);
    expect(settings.map((s) => s.key)).not.toContain('whatsapp_cloud');
  });

  it("hides another tenant's comp-off credits and blocks writing them", async () => {
    const [emp] = await db.as<{ id: string }>('authenticated', acme.adminId, `insert into employees (company_id, employee_code, full_name) values ($1, 'SEC1', 'Sec Test') returning id`, [acme.companyId]);
    await db.as('authenticated', acme.adminId, `insert into comp_off_credits (employee_id, work_date, status) values ($1, '2026-01-04', 'approved')`, [emp.id]);
    expect(await db.as('authenticated', beta.adminId, `select 1 from comp_off_credits`)).toHaveLength(0);
    expect(await db.as('authenticated', beta.adminId, `update comp_off_credits set status = 'cancelled' returning id`)).toHaveLength(0);
    await expect(db.as('authenticated', beta.adminId, `insert into comp_off_credits (employee_id, work_date) values ($1, '2026-01-11')`, [emp.id])).rejects.toThrow(/row-level security|not_allowed/);
  });

  // ── CRM roles ───────────────────────────────────────────────────────
  it('scopes leads: executives see own + unassigned, admins see all, support sees none', async () => {
    await db.admin(`insert into leads (company_name, contact_person, phone, assigned_to) values ('A Co', 'a', '9800000001', $1), ('B Co', 'b', '9800000002', $2), ('Open Co', 'c', '9800000003', null)`, [execA, execB]);
    const forA = await db.as<{ company_name: string }>('authenticated', execA, `select company_name from leads where company_name in ('A Co','B Co','Open Co') order by 1`);
    expect(forA.map((r) => r.company_name)).toEqual(['A Co', 'Open Co']);
    const forAdmin = await db.as<{ company_name: string }>('authenticated', salesAdmin, `select company_name from leads where company_name in ('A Co','B Co','Open Co')`);
    expect(forAdmin).toHaveLength(3);
    const forSupport = await db.as('authenticated', support, `select 1 from leads`);
    expect(forSupport).toHaveLength(0);
    const forCustomer = await db.as('authenticated', acme.adminId, `select 1 from leads`);
    expect(forCustomer).toHaveLength(0);
  });

  it("stops an executive editing a colleague's lead or reassigning to them", async () => {
    const upd = await db.as('authenticated', execA, `update leads set remarks = 'x' where company_name = 'B Co' returning id`);
    expect(upd).toHaveLength(0);
    await expect(db.as('authenticated', execA, `update leads set assigned_to = $1 where company_name = 'Open Co'`, [execB])).rejects.toThrow(/row-level security/);
  });

  it('logs lead creation and status changes automatically', async () => {
    const [lead] = await db.as<{ id: string }>('authenticated', execA, `insert into leads (company_name, contact_person, phone, assigned_to, created_by) values ('Log Co', 'x', '9800000009', $1, $1) returning id`, [execA]);
    await db.as('authenticated', execA, `update leads set status = 'contacted' where id = $1`, [lead.id]);
    const acts = await db.as<{ type: string }>('authenticated', execA, `select type from lead_activities where lead_id = $1 order by created_at`, [lead.id]);
    expect(acts.map((a) => a.type)).toEqual(['system', 'status_change']);
  });

  it('detects duplicates across all owners by normalised phone/email', async () => {
    const dups = await db.as<{ company_name: string }>('authenticated', execA, `select company_name from find_duplicate_leads('+91 98000 00002', null, null)`);
    expect(dups.map((d) => d.company_name)).toEqual(['B Co']);
    await expect(db.as('authenticated', acme.adminId, `select * from find_duplicate_leads('9800000002', null, null)`)).rejects.toThrow(/forbidden/);
  });

  // ── Demo double-booking ────────────────────────────────────────────
  it('rejects overlapping demos for the same salesperson but allows other salespeople', async () => {
    const insert = (sp: string, start: string, end: string) =>
      db.admin(`insert into demo_bookings (salesperson_id, starts_at, ends_at, contact_name, company_name, phone) values ($1, $2, $3, 'c', 'co', '9800000000')`, [sp, start, end]);
    await insert(execA, '2030-01-07T04:30:00Z', '2030-01-07T05:15:00Z');
    await expect(insert(execA, '2030-01-07T04:30:00Z', '2030-01-07T05:15:00Z')).rejects.toThrow(/duplicate key|slot_taken/);
    await expect(insert(execA, '2030-01-07T05:00:00Z', '2030-01-07T05:45:00Z')).rejects.toThrow(/slot_taken/);
    await expect(insert(execB, '2030-01-07T04:30:00Z', '2030-01-07T05:15:00Z')).resolves.toBeDefined();
    await insert(execA, '2030-01-07T05:15:00Z', '2030-01-07T06:00:00Z'); // back-to-back is fine
  });

  // ── Payments can never be marked verified without verification ─────
  it('blocks marking payments verified or invoices paid directly', async () => {
    const [inv] = await db.admin<{ id: string }>(`insert into invoices (company_id, amount, total) values ($1, 1000, 1180) returning id`, [acme.companyId]);
    await expect(db.as('authenticated', salesAdmin, `insert into payments (company_id, invoice_id, amount, status, recorded_by) values ($1, $2, 1180, 'verified', $3)`, [acme.companyId, inv.id, salesAdmin])).rejects.toThrow(/verify_payment/);
    await expect(db.as('authenticated', salesAdmin, `update invoices set status = 'paid' where id = $1`, [inv.id])).rejects.toThrow(/verified payment/);
    const [p] = await db.as<{ id: string }>('authenticated', salesAdmin, `insert into payments (company_id, invoice_id, amount, recorded_by) values ($1, $2, 1180, $3) returning id`, [acme.companyId, inv.id, salesAdmin]);
    await expect(db.as('authenticated', salesAdmin, `update payments set status = 'verified' where id = $1`, [p.id])).rejects.toThrow(/verify_payment/);
    await expect(db.as('authenticated', execA, `select verify_payment($1)`, [p.id])).rejects.toThrow(/forbidden/);
    await expect(db.as('authenticated', acme.adminId, `select verify_payment($1)`, [p.id])).rejects.toThrow(/forbidden/);
  });

  it('verifies a payment, marks the invoice paid and activates the subscription atomically', async () => {
    const [sub] = await db.admin<{ id: string }>(`select id from subscriptions where company_id = $1`, [acme.companyId]);
    const [inv] = await db.admin<{ id: string }>(
      `insert into invoices (company_id, subscription_id, amount, total, period_start, period_end) values ($1, $2, 2499, 2948.82, now(), now() + interval '1 month') returning id`,
      [acme.companyId, sub.id],
    );
    const [p] = await db.as<{ id: string }>('authenticated', salesAdmin, `insert into payments (company_id, invoice_id, subscription_id, amount, recorded_by) values ($1, $2, $3, 2948.82, $4) returning id`, [acme.companyId, inv.id, sub.id, salesAdmin]);
    await db.as('authenticated', salesAdmin, `select verify_payment($1)`, [p.id]);
    const [state] = await db.admin<{ pay: string; src: string; inv: string; sub: string; company: string }>(
      `select (select status from payments where id = $1) pay, (select verification_source from payments where id = $1) src,
              (select status from invoices where id = $2) inv, (select status from subscriptions where id = $3) sub,
              (select status from companies where id = $4) company`,
      [p.id, inv.id, sub.id, acme.companyId],
    );
    expect(state).toEqual({ pay: 'verified', src: 'manual', inv: 'paid', sub: 'active', company: 'active' });
    await expect(db.as('authenticated', salesAdmin, `select verify_payment($1)`, [p.id])).rejects.toThrow(/only pending/);
    // Audit trail captured the change.
    const audit = await db.admin(`select 1 from audit_logs where entity_type = 'payments' and entity_id = $1`, [p.id]);
    expect(audit.length).toBeGreaterThan(0);
  });

  it('does not activate the subscription for a partial payment', async () => {
    const [sub] = await db.admin<{ id: string }>(`select id from subscriptions where company_id = $1`, [beta.companyId]);
    const [inv] = await db.admin<{ id: string }>(`insert into invoices (company_id, subscription_id, amount, total, period_end) values ($1, $2, 1000, 1180, now() + interval '1 month') returning id`, [beta.companyId, sub.id]);
    const [p] = await db.as<{ id: string }>('authenticated', salesAdmin, `insert into payments (company_id, invoice_id, amount, recorded_by) values ($1, $2, 500, $3) returning id`, [beta.companyId, inv.id, salesAdmin]);
    await db.as('authenticated', salesAdmin, `select verify_payment($1)`, [p.id]);
    const [s] = await db.admin<{ inv: string; sub: string }>(`select (select status from invoices where id = $1) inv, (select status from subscriptions where id = $2) sub`, [inv.id, sub.id]);
    expect(s).toEqual({ inv: 'issued', sub: 'trialing' });
  });

  // ── Subscription lifecycle ─────────────────────────────────────────
  it('expires ended trials and suspends the tenant', async () => {
    const t = await createTenant(db, 'Gamma Retail', 'owner@gamma.test');
    await db.admin(`update subscriptions set trial_end = now() - interval '1 hour' where company_id = $1`, [t.companyId]);
    const [res] = await db.as<{ r: { trials_expired: number } }>('service_role', null, `select expire_subscriptions() as r`);
    expect(res.r.trials_expired).toBeGreaterThanOrEqual(1);
    const [c] = await db.admin<{ status: string; sub: string; reason: string }>(
      `select c.status, s.status as sub, k.suspension_reason as reason from companies c join subscriptions s on s.company_id = c.id join customers k on k.company_id = c.id where c.id = $1`,
      [t.companyId],
    );
    expect(c).toEqual({ status: 'suspended', sub: 'expired', reason: 'trial_expired' });
  });

  it('allows only one live subscription per tenant', async () => {
    const [plan] = await db.admin<{ id: string }>(`select id from plans where key = 'starter'`);
    await expect(db.admin(`insert into subscriptions (company_id, plan_id, status) values ($1, $2, 'active')`, [acme.companyId, plan.id])).rejects.toThrow(/duplicate key/);
  });

  // ── Support ─────────────────────────────────────────────────────────
  it('hides internal support notes from customers and pins messages to the ticket tenant', async () => {
    const [tk] = await db.as<{ id: string }>('authenticated', acmeUser, `insert into support_tickets (company_id, created_by, subject, description) values ($1, $2, 'Payslip issue', 'Payslip shows wrong PF') returning id`, [acme.companyId, acmeUser]);
    await db.as('authenticated', support, `insert into support_messages (ticket_id, company_id, author_id, body, is_internal) values ($1, $2, $3, 'internal: check PF config', true)`, [tk.id, acme.companyId, support]);
    await db.as('authenticated', support, `insert into support_messages (ticket_id, company_id, author_id, body) values ($1, $2, $3, 'We are looking into it')`, [tk.id, acme.companyId, support]);
    const seen = await db.as<{ body: string }>('authenticated', acmeUser, `select body from support_messages where ticket_id = $1`, [tk.id]);
    expect(seen.map((m) => m.body)).toEqual(['We are looking into it']);
    // A forged company_id is overwritten by the trigger.
    await db.as('authenticated', support, `insert into support_messages (ticket_id, company_id, author_id, body) values ($1, $2, $3, 'forged')`, [tk.id, beta.companyId, support]);
    const [m] = await db.admin<{ company_id: string }>(`select company_id from support_messages where body = 'forged'`);
    expect(m.company_id).toBe(acme.companyId);
    const [t2] = await db.admin<{ status: string }>(`select status from support_tickets where id = $1`, [tk.id]);
    expect(t2.status).toBe('in_progress');
    // Customers cannot post internal notes or tickets for another tenant.
    await expect(db.as('authenticated', acmeUser, `insert into support_messages (ticket_id, company_id, author_id, body, is_internal) values ($1, $2, $3, 'x', true)`, [tk.id, acme.companyId, acmeUser])).rejects.toThrow(/row-level security/);
    await expect(db.as('authenticated', acmeUser, `insert into support_tickets (company_id, created_by, subject, description) values ($1, $2, 'Hi there', 'Trying another tenant')`, [beta.companyId, acmeUser])).rejects.toThrow(/row-level security/);
  });

  // ── Invitations ─────────────────────────────────────────────────────
  it('applies pending invitations when the invited user signs up', async () => {
    await db.admin(`insert into user_invitations (email, role_key, company_id, invited_by) values ('new@beta.test', 'customer_user', $1, $2)`, [beta.companyId, beta.adminId]);
    const uid = await db.createUser('New@Beta.test');
    const [r] = await db.admin<{ role: string; inv: string }>(
      `select (select role from company_memberships where user_id = $1 and company_id = $2) role, (select status from user_invitations where lower(email) = 'new@beta.test') inv`,
      [uid, beta.companyId],
    );
    expect(r).toEqual({ role: 'customer_user', inv: 'accepted' });
  });

  it('rate limits by key and window', async () => {
    const hit = () => db.as<{ ok: boolean }>('service_role', null, `select check_rate_limit('test:ip', 2, 600) as ok`).then((r) => r[0].ok);
    expect([await hit(), await hit(), await hit()]).toEqual([true, true, false]);
  });

  it('lets only super admins read audit logs', async () => {
    expect(await db.as('authenticated', salesAdmin, `select 1 from audit_logs`)).toHaveLength(0);
    expect((await db.as('authenticated', superAdmin, `select 1 from audit_logs`)).length).toBeGreaterThan(0);
  });
});
