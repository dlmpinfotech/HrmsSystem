-- ════════════════════════════════════════════════════════════════════
-- 0003 — Row Level Security
-- Every table has RLS enabled. Tenant data is visible only to members of
-- that tenant (company) and to platform staff with the right role.
-- The service role (Netlify Functions) bypasses RLS; it is never sent to browsers.
-- ════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ── Table privileges ────────────────────────────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant usage on schema public to anon, authenticated, service_role;

grant select on public.plans, public.videos, public.help_articles, public.app_settings to anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.rate_limits from authenticated;
revoke insert, update, delete on public.audit_logs, public.notification_logs, public.whatsapp_messages,
  public.roles, public.user_invitations from authenticated;
grant usage, select on all sequences in schema public to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ── Identity ────────────────────────────────────────────────────────
create policy roles_select on public.roles for select to authenticated using (true);

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff() or public.shares_company(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_super_admin())
  with check (id = auth.uid() or public.is_super_admin());

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy user_roles_write on public.user_roles for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ── Tenants ─────────────────────────────────────────────────────────
create policy companies_select on public.companies for select to authenticated
  using (public.is_staff() or public.is_company_member(id));
create policy companies_insert on public.companies for insert to authenticated
  with check (public.is_admin());
create policy companies_update on public.companies for update to authenticated
  using (public.is_admin() or public.is_support() or public.is_company_admin(id))
  with check (public.is_admin() or public.is_support() or public.is_company_admin(id));
create policy companies_delete on public.companies for delete to authenticated
  using (public.is_super_admin());

create policy memberships_select on public.company_memberships for select to authenticated
  using (user_id = auth.uid() or public.is_staff() or public.is_company_member(company_id));
create policy memberships_write on public.company_memberships for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy branding_select on public.company_branding for select to authenticated
  using (public.is_staff() or public.is_company_member(company_id));
create policy branding_insert on public.company_branding for insert to authenticated
  with check (public.is_super_admin() or public.is_company_admin(company_id));
create policy branding_update on public.company_branding for update to authenticated
  using (public.is_super_admin() or public.is_company_admin(company_id))
  with check (public.is_super_admin() or public.is_company_admin(company_id));

create policy invitations_select on public.user_invitations for select to authenticated
  using (public.is_super_admin() or (company_id is not null and public.is_company_admin(company_id)));

-- ── CRM (staff only) ────────────────────────────────────────────────
create policy campaigns_select on public.marketing_campaigns for select to authenticated using (public.is_sales());
create policy campaigns_write on public.marketing_campaigns for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Sales executives work on their own and unassigned leads; admins see everything.
create policy leads_select on public.leads for select to authenticated
  using (public.is_admin()
         or (public.has_any_role(array['sales_executive']) and (assigned_to = auth.uid() or assigned_to is null)));
create policy leads_insert on public.leads for insert to authenticated
  with check (public.is_sales());
create policy leads_update on public.leads for update to authenticated
  using (public.is_admin()
         or (public.has_any_role(array['sales_executive']) and (assigned_to = auth.uid() or assigned_to is null)))
  with check (public.is_admin()
              or (public.has_any_role(array['sales_executive']) and (assigned_to = auth.uid() or assigned_to is null)));
create policy leads_delete on public.leads for delete to authenticated using (public.is_admin());

-- Child rows inherit lead visibility (the sub-select is itself filtered by leads RLS).
create policy lead_activities_select on public.lead_activities for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_activities_insert on public.lead_activities for insert to authenticated
  with check (created_by = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_activities_delete on public.lead_activities for delete to authenticated using (public.is_admin());

create policy lead_tasks_select on public.lead_tasks for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_tasks_insert on public.lead_tasks for insert to authenticated
  with check (exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_tasks_update on public.lead_tasks for update to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id))
  with check (exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_tasks_delete on public.lead_tasks for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

-- ── Demos ───────────────────────────────────────────────────────────
create policy demo_availability_select on public.demo_availability for select to authenticated using (public.is_sales());
create policy demo_availability_write on public.demo_availability for all to authenticated
  using (public.is_admin() or (public.is_sales() and salesperson_id = auth.uid()))
  with check (public.is_admin() or (public.is_sales() and salesperson_id = auth.uid()));

create policy demo_bookings_select on public.demo_bookings for select to authenticated using (public.is_sales());
create policy demo_bookings_insert on public.demo_bookings for insert to authenticated with check (public.is_sales());
create policy demo_bookings_update on public.demo_bookings for update to authenticated
  using (public.is_admin() or (public.is_sales() and salesperson_id = auth.uid()))
  with check (public.is_admin() or (public.is_sales() and salesperson_id = auth.uid()));
create policy demo_bookings_delete on public.demo_bookings for delete to authenticated using (public.is_admin());

-- ── Customers ───────────────────────────────────────────────────────
create policy customers_select on public.customers for select to authenticated using (public.is_staff());
create policy customers_write on public.customers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy contacts_select on public.customer_contacts for select to authenticated
  using (public.is_staff() or public.is_company_member(company_id));
create policy contacts_write on public.customer_contacts for all to authenticated
  using (public.is_admin() or public.is_support() or public.is_company_admin(company_id))
  with check (public.is_admin() or public.is_support() or public.is_company_admin(company_id));

create policy onboarding_select on public.onboarding_tasks for select to authenticated
  using (public.is_staff() or public.is_company_member(company_id));
create policy onboarding_insert on public.onboarding_tasks for insert to authenticated
  with check (public.is_staff());
create policy onboarding_update on public.onboarding_tasks for update to authenticated
  using (public.is_staff() or public.is_company_admin(company_id))
  with check (public.is_staff() or public.is_company_admin(company_id));
create policy onboarding_delete on public.onboarding_tasks for delete to authenticated using (public.is_staff());

-- ── Plans & billing ─────────────────────────────────────────────────
-- Lets a tenant read its own (possibly non-public) plan. SECURITY DEFINER because
-- anon has no privileges on subscriptions and policies run with the caller's rights.
create or replace function public.is_plan_subscriber(p_plan uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.subscriptions s
    where s.plan_id = p_plan and public.is_company_member(s.company_id)
  );
$$;

create policy plans_select on public.plans for select to anon, authenticated
  using ((is_active and is_public)
         or public.is_staff()
         or public.is_plan_subscriber(id));
create policy plans_write on public.plans for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_staff() or public.is_company_member(company_id));
create policy subscriptions_write on public.subscriptions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy invoices_select on public.invoices for select to authenticated
  using (public.is_staff() or public.is_company_admin(company_id));
create policy invoices_write on public.invoices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy payments_select on public.payments for select to authenticated
  using (public.is_staff() or public.is_company_admin(company_id));
create policy payments_insert on public.payments for insert to authenticated
  with check (public.is_admin() and recorded_by = auth.uid());
create policy payments_update on public.payments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── Support ─────────────────────────────────────────────────────────
create policy tickets_select on public.support_tickets for select to authenticated
  using (public.is_staff() or public.is_company_member(company_id));
create policy tickets_insert on public.support_tickets for insert to authenticated
  with check (public.is_staff() or (public.is_company_member(company_id) and created_by = auth.uid()));
create policy tickets_update on public.support_tickets for update to authenticated
  using (public.is_support()) with check (public.is_support());

create policy messages_select on public.support_messages for select to authenticated
  using (public.is_staff() or (public.is_company_member(company_id) and not is_internal));
create policy messages_insert on public.support_messages for insert to authenticated
  with check (author_id = auth.uid()
              and (public.is_staff() or (not is_internal and public.is_company_member(company_id))));

-- ── Notifications & WhatsApp (staff only; writes via backend) ───────
create policy templates_select on public.notification_templates for select to authenticated using (public.is_staff());
create policy templates_write on public.notification_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy notification_logs_select on public.notification_logs for select to authenticated using (public.is_staff());

create policy wa_conversations_select on public.whatsapp_conversations for select to authenticated using (public.is_staff());
create policy wa_conversations_update on public.whatsapp_conversations for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy wa_messages_select on public.whatsapp_messages for select to authenticated using (public.is_staff());

create policy consents_select on public.communication_consents for select to authenticated using (public.is_staff());
create policy consents_insert on public.communication_consents for insert to authenticated with check (public.is_sales());

-- ── Content ─────────────────────────────────────────────────────────
create policy videos_select on public.videos for select to anon, authenticated
  using ((is_published and (audience = 'public' or auth.uid() is not null)) or public.is_staff());
create policy videos_write on public.videos for all to authenticated
  using (public.is_admin() or public.is_support()) with check (public.is_admin() or public.is_support());

create policy help_select on public.help_articles for select to anon, authenticated
  using (is_published or public.is_staff());
create policy help_write on public.help_articles for all to authenticated
  using (public.is_admin() or public.is_support()) with check (public.is_admin() or public.is_support());

-- ── Platform ────────────────────────────────────────────────────────
create policy audit_select on public.audit_logs for select to authenticated using (public.is_super_admin());

create policy settings_select on public.app_settings for select to anon, authenticated
  using (is_public or public.is_staff());
create policy settings_write on public.app_settings for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- rate_limits: no policies → reachable only by the service role.
