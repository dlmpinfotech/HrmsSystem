import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';

describe('database migrations', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it('creates every required table with RLS enabled', async () => {
    const required = [
      'profiles', 'roles', 'user_roles', 'companies', 'company_memberships', 'company_branding', 'leads',
      'lead_activities', 'lead_tasks', 'demo_bookings', 'demo_availability', 'customers', 'customer_contacts',
      'onboarding_tasks', 'plans', 'subscriptions', 'payments', 'invoices', 'support_tickets', 'support_messages',
      'notification_templates', 'notification_logs', 'whatsapp_conversations', 'whatsapp_messages',
      'communication_consents', 'marketing_campaigns', 'audit_logs', 'app_settings',
    ];
    const rows = await db.admin<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
    );
    const byName = new Map(rows.map((r) => [r.tablename, r.rowsecurity]));
    for (const table of required) {
      expect(byName.has(table), `table ${table} exists`).toBe(true);
      expect(byName.get(table), `RLS enabled on ${table}`).toBe(true);
    }
    // No public table may be left without RLS.
    expect(rows.filter((r) => !r.rowsecurity).map((r) => r.tablename)).toEqual([]);
  });

  it('seeds roles, plans and notification templates', async () => {
    const roles = await db.admin<{ key: string }>(`select key from public.roles order by key`);
    expect(roles.map((r) => r.key)).toEqual([
      'customer_admin', 'customer_user', 'employee', 'hr_manager', 'sales_admin', 'sales_executive', 'super_admin', 'support_executive',
    ]);
    const plans = await db.admin<{ key: string }>(`select key from public.plans order by sort_order`);
    expect(plans.map((p) => p.key)).toEqual(['starter', 'business', 'growth', 'enterprise']);
    const keys = await db.admin<{ key: string }>(`select distinct key from public.notification_templates`);
    for (const k of ['demo_confirmation', 'demo_reminder', 'trial_activation', 'trial_expiring',
      'subscription_renewal', 'payment_confirmation', 'support_ticket_update']) {
      expect(keys.map((r) => r.key)).toContain(k);
    }
  });

  it('keeps chargeable WhatsApp messaging disabled by default', async () => {
    const [row] = await db.admin<{ value: { enabled: boolean }; is_public: boolean }>(
      `select value, is_public from public.app_settings where key = 'whatsapp_cloud'`,
    );
    expect(row.value.enabled).toBe(false);
    expect(row.is_public).toBe(false);
  });
});
