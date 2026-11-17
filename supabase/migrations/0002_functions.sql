-- ════════════════════════════════════════════════════════════════════
-- 0002 — Functions and triggers
-- ════════════════════════════════════════════════════════════════════

-- ── updated_at ──────────────────────────────────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'companies', 'company_branding', 'marketing_campaigns', 'leads', 'demo_bookings', 'customers',
    'customer_contacts', 'plans', 'subscriptions', 'invoices', 'payments', 'support_tickets',
    'notification_templates', 'notification_logs', 'videos', 'help_articles', 'app_settings'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;

-- ── Role helpers (SECURITY DEFINER so policies can call them without recursion) ──
create or replace function public.has_any_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and p.is_active and ur.role_key = any (p_roles)
  );
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin']);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'sales_admin']);
$$;

create or replace function public.is_sales() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'sales_admin', 'sales_executive']);
$$;

create or replace function public.is_support() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'sales_admin', 'support_executive']);
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_any_role(array['super_admin', 'sales_admin', 'sales_executive', 'support_executive']);
$$;

create or replace function public.is_company_member(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.company_memberships m
    join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.user_id = auth.uid() and p.is_active
  );
$$;

create or replace function public.is_company_admin(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.company_memberships m
    join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.user_id = auth.uid() and m.role = 'customer_admin' and p.is_active
  );
$$;

create or replace function public.shares_company(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.company_memberships mine
    join public.company_memberships theirs on theirs.company_id = mine.company_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user
  );
$$;

-- Extract the tenant id from a storage object path of the form "<company_uuid>/file.png".
create or replace function public.storage_company_id(p_name text) returns uuid
language sql immutable as $$
  select case
    when split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
    else null
  end;
$$;

-- ── New auth user → profile (+ pending invitations) ─────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv record;
begin
  insert into public.profiles (id, email, full_name, phone, preferred_language)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    case when new.raw_user_meta_data ->> 'language' in ('en', 'ta') then new.raw_user_meta_data ->> 'language' end
  )
  on conflict (id) do nothing;

  for inv in
    select * from public.user_invitations
    where lower(email) = lower(new.email) and status = 'pending'
  loop
    insert into public.user_roles (user_id, role_key, granted_by)
    values (new.id, inv.role_key, inv.invited_by)
    on conflict do nothing;

    if inv.company_id is not null then
      insert into public.company_memberships (company_id, user_id, role)
      values (inv.company_id, new.id, case when inv.role_key = 'customer_admin' then 'customer_admin' else 'customer_user' end)
      on conflict (company_id, user_id) do nothing;
    end if;

    update public.user_invitations set status = 'accepted', accepted_at = now() where id = inv.id;
  end loop;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Guards against privilege escalation through allowed UPDATEs ─────
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    if new.is_active is distinct from old.is_active or new.email is distinct from old.email or new.id <> old.id then
      raise exception 'not allowed to change protected profile fields' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

create or replace function public.protect_company_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for the service role (trusted backend).
  if auth.uid() is not null and not public.is_staff() then
    if new.status is distinct from old.status
       or new.tenant_code is distinct from old.tenant_code
       or new.hrms_url is distinct from old.hrms_url
       or new.settings is distinct from old.settings then
      raise exception 'not allowed to change protected company fields' using errcode = '42501';
    end if;
  end if;
  if new.tenant_code is distinct from old.tenant_code then
    raise exception 'tenant_code is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger companies_protect before update on public.companies
  for each row execute function public.protect_company_fields();

-- ── Leads ───────────────────────────────────────────────────────────
create or replace function public.normalize_lead() returns trigger
language plpgsql as $$
begin
  new.phone_normalized := nullif(right(regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), 10), '');
  new.email := nullif(trim(new.email), '');
  new.email_normalized := lower(new.email);
  return new;
end $$;
create trigger leads_normalize before insert or update of phone, email on public.leads
  for each row execute function public.normalize_lead();

create or replace function public.log_lead_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_activities (lead_id, type, body, metadata, created_by)
    values (new.id, 'system', 'Lead created', jsonb_build_object('source', new.source), auth.uid());
  else
    if new.status is distinct from old.status then
      insert into public.lead_activities (lead_id, type, body, metadata, created_by)
      values (new.id, 'status_change', null, jsonb_build_object('from', old.status, 'to', new.status), auth.uid());
    end if;
    if new.assigned_to is distinct from old.assigned_to then
      insert into public.lead_activities (lead_id, type, body, metadata, created_by)
      values (new.id, 'assignment', null, jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to), auth.uid());
    end if;
  end if;
  return new;
end $$;
create trigger leads_log_change after insert or update on public.leads
  for each row execute function public.log_lead_change();

-- Duplicate detection across ALL leads (bypasses per-user visibility, returns minimal fields).
create or replace function public.find_duplicate_leads(p_phone text, p_email text, p_exclude uuid default null)
returns table (id uuid, company_name text, contact_person text, status text, assigned_to_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text := nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if auth.uid() is not null and not public.is_sales() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select l.id, l.company_name, l.contact_person, l.status, p.full_name, l.created_at
    from public.leads l
    left join public.profiles p on p.id = l.assigned_to
    where (p_exclude is null or l.id <> p_exclude)
      and ((v_phone is not null and l.phone_normalized = v_phone)
        or (v_email is not null and l.email_normalized = v_email))
    order by l.created_at desc
    limit 5;
end $$;

-- ── Demo bookings: reject overlapping live bookings for one salesperson ──
create or replace function public.prevent_demo_overlap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'scheduled' and new.salesperson_id is not null then
    if exists (
      select 1 from public.demo_bookings b
      where b.salesperson_id = new.salesperson_id
        and b.status = 'scheduled'
        and b.id <> new.id
        and b.starts_at < new.ends_at
        and b.ends_at > new.starts_at
    ) then
      raise exception 'slot_taken' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;
create trigger demo_bookings_overlap before insert or update of starts_at, ends_at, salesperson_id, status
  on public.demo_bookings for each row execute function public.prevent_demo_overlap();

-- ── Support ─────────────────────────────────────────────────────────
create or replace function public.support_message_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- company_id always comes from the ticket; it can never be forged by the client.
  select t.company_id into new.company_id from public.support_tickets t where t.id = new.ticket_id;
  if new.company_id is null then
    raise exception 'ticket not found' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger support_messages_before before insert on public.support_messages
  for each row execute function public.support_message_before();

create or replace function public.support_message_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_staff boolean;
begin
  if new.is_internal then
    update public.support_tickets set updated_at = now() where id = new.ticket_id;
    return new;
  end if;
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = new.author_id
      and ur.role_key in ('super_admin', 'sales_admin', 'sales_executive', 'support_executive')
  ) into v_staff;
  update public.support_tickets t
  set updated_at = now(),
      status = case
        when v_staff and t.status = 'open' then 'in_progress'
        when not v_staff and t.status in ('waiting_customer', 'resolved') then 'open'
        else t.status
      end
  where t.id = new.ticket_id;
  return new;
end $$;
create trigger support_messages_after after insert on public.support_messages
  for each row execute function public.support_message_after();

create or replace function public.support_ticket_status() returns trigger
language plpgsql as $$
begin
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_at := now();
  elsif new.status not in ('resolved', 'closed') then
    new.resolved_at := null;
  end if;
  return new;
end $$;
create trigger support_tickets_status before update of status on public.support_tickets
  for each row execute function public.support_ticket_status();

-- ── Payments: a payment/invoice can only become verified/paid through verify_payment() ──
create or replace function public.guard_payment_status() returns trigger
language plpgsql as $$
declare v_flag text := coalesce(current_setting('app.verifying_payment', true), '');
begin
  if tg_op = 'INSERT' then
    if new.status not in ('pending', 'failed') and v_flag <> '1' then
      raise exception 'payments must be created as pending and verified via verify_payment()' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'verified' and v_flag <> '1' then
      raise exception 'payments can only be verified via verify_payment()' using errcode = '42501';
    end if;
    if old.status = 'verified' and new.status not in ('refunded') then
      raise exception 'a verified payment can only be refunded' using errcode = '42501';
    end if;
  end if;
  if new.status = 'verified' and (new.verified_at is null or new.verification_source is null) then
    raise exception 'verified payments need verification metadata' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger payments_guard before insert or update on public.payments
  for each row execute function public.guard_payment_status();

create or replace function public.guard_invoice_status() returns trigger
language plpgsql as $$
declare v_flag text := coalesce(current_setting('app.verifying_payment', true), '');
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') and v_flag <> '1' then
    raise exception 'invoices are marked paid only by a verified payment' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger invoices_guard before insert or update on public.invoices
  for each row execute function public.guard_invoice_status();

create or replace function public.verify_payment(p_payment uuid, p_actor uuid default null, p_source text default 'manual')
returns public.payments
language plpgsql security definer set search_path = public as $$
declare
  v_pay public.payments;
  v_inv public.invoices;
  v_paid numeric;
  v_actor uuid := coalesce(auth.uid(), p_actor);
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_source not in ('manual', 'razorpay_webhook') then
    raise exception 'invalid verification source' using errcode = '22023';
  end if;
  if p_source = 'manual' and v_actor is null then
    raise exception 'manual verification requires an actor' using errcode = '22023';
  end if;

  select * into v_pay from public.payments where id = p_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if v_pay.status <> 'pending' then
    raise exception 'only pending payments can be verified (current: %)', v_pay.status using errcode = '22023';
  end if;

  perform set_config('app.verifying_payment', '1', true);

  update public.payments
  set status = 'verified', verified_by = v_actor, verified_at = now(), verification_source = p_source
  where id = p_payment
  returning * into v_pay;

  if v_pay.invoice_id is not null then
    select * into v_inv from public.invoices where id = v_pay.invoice_id for update;
    select coalesce(sum(amount), 0) into v_paid
    from public.payments where invoice_id = v_inv.id and status = 'verified';

    if v_paid >= v_inv.total and v_inv.status <> 'paid' then
      update public.invoices set status = 'paid', paid_at = now() where id = v_inv.id;

      if v_inv.subscription_id is not null and v_inv.period_end is not null then
        update public.subscriptions
        set status = 'active',
            current_period_start = coalesce(v_inv.period_start, now()),
            current_period_end = v_inv.period_end,
            renewal_reminder_at = null,
            cancel_at_period_end = false
        where id = v_inv.subscription_id and status in ('trialing', 'active', 'past_due', 'expired');

        update public.companies set status = 'active'
        where id = v_inv.company_id and status in ('trial', 'onboarding', 'suspended');

        update public.customers
        set activated_at = coalesce(activated_at, now()), suspended_at = null, suspension_reason = null
        where company_id = v_inv.company_id;
      end if;
    end if;
  end if;

  perform set_config('app.verifying_payment', '', true);
  return v_pay;
end $$;

-- ── Tenant provisioning ─────────────────────────────────────────────
create or replace function public.seed_onboarding_tasks(p_company uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.onboarding_tasks (company_id, title, description, sort_order)
  values
    (p_company, 'Complete company profile', 'Add address, GST number and contact details.', 1),
    (p_company, 'Upload logo and set branding', 'Make the portal match your company identity.', 2),
    (p_company, 'Share employee master data', 'Send the employee list using the import template.', 3),
    (p_company, 'Configure attendance and shifts', 'Define shifts, weekly offs and holidays.', 4),
    (p_company, 'Configure payroll and statutory settings', 'Salary structures, PF, ESI and professional tax.', 5),
    (p_company, 'Admin training session', 'Walkthrough for your HR and payroll team.', 6),
    (p_company, 'Go live', 'Start using the HRMS for day-to-day operations.', 7);
$$;

create or replace function public.create_tenant(
  p_name text, p_contact_name text, p_phone text, p_email text, p_city text, p_industry text,
  p_employee_count integer, p_plan_key text, p_language text, p_lead uuid, p_owner uuid, p_source text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_plan public.plans;
  v_company uuid;
begin
  select * into v_plan from public.plans where key = p_plan_key and is_active;
  if not found then
    select * into v_plan from public.plans where is_active order by sort_order limit 1;
  end if;
  if not found then
    raise exception 'no active plan configured' using errcode = 'P0002';
  end if;

  insert into public.companies (name, display_name, industry, city, employee_count, default_language, status)
  values (p_name, p_name, p_industry, p_city, p_employee_count,
          case when p_language in ('en', 'ta') then p_language else 'en' end, 'trial')
  returning id into v_company;

  insert into public.company_branding (company_id, display_name, default_language)
  values (v_company, p_name, case when p_language in ('en', 'ta') then p_language else 'en' end);

  insert into public.customers (company_id, lead_id, account_owner_id, source)
  values (v_company, p_lead, p_owner, p_source);

  insert into public.customer_contacts (company_id, name, email, phone, is_primary)
  values (v_company, p_contact_name, nullif(p_email, ''), nullif(p_phone, ''), true);

  insert into public.subscriptions (company_id, plan_id, status, billing_frequency, amount, currency, trial_start, trial_end)
  values (v_company, v_plan.id, 'trialing', 'monthly', coalesce(v_plan.price_monthly, 0), v_plan.currency,
          now(), now() + make_interval(days => v_plan.trial_days));

  perform public.seed_onboarding_tasks(v_company);
  return v_company;
end $$;

-- Self-service trial signup. Called by the backend (service role) right after auth sign-up.
create or replace function public.provision_trial(
  p_user uuid, p_company_name text, p_contact_name text, p_phone text, p_email text, p_city text,
  p_industry text, p_employee_count integer, p_plan_key text, p_language text, p_consent boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_lead uuid;
  v_company uuid;
begin
  if exists (select 1 from public.company_memberships where user_id = p_user) then
    raise exception 'user already belongs to a company' using errcode = '23505';
  end if;

  insert into public.leads (company_name, contact_person, phone, email, city, industry, employee_count,
                            source, status, communication_consent)
  values (p_company_name, p_contact_name, p_phone, p_email, p_city, p_industry, p_employee_count,
          'free_trial', 'trial', coalesce(p_consent, false))
  returning id into v_lead;

  v_company := public.create_tenant(p_company_name, p_contact_name, p_phone, p_email, p_city, p_industry,
                                    p_employee_count, p_plan_key, p_language, v_lead, null, 'free_trial');

  update public.leads set converted_company_id = v_company where id = v_lead;

  insert into public.company_memberships (company_id, user_id, role) values (v_company, p_user, 'customer_admin');
  insert into public.user_roles (user_id, role_key) values (p_user, 'customer_admin') on conflict do nothing;
  update public.profiles
  set full_name = case when full_name = '' then p_contact_name else full_name end,
      phone = coalesce(phone, p_phone)
  where id = p_user;

  return v_company;
end $$;

-- Sales-driven conversion of a lead into a tenant with a trial subscription.
create or replace function public.convert_lead_to_customer(p_lead uuid, p_plan_key text, p_actor uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_lead public.leads;
  v_company uuid;
  v_actor uuid := coalesce(auth.uid(), p_actor);
begin
  if auth.uid() is not null and not public.is_sales() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_lead from public.leads where id = p_lead for update;
  if not found then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;
  if v_lead.converted_company_id is not null then
    raise exception 'lead already converted' using errcode = '23505';
  end if;

  v_company := public.create_tenant(v_lead.company_name, v_lead.contact_person, v_lead.phone, v_lead.email,
                                    v_lead.city, v_lead.industry, v_lead.employee_count, p_plan_key, 'en',
                                    v_lead.id, coalesce(v_lead.assigned_to, v_actor), v_lead.source);

  update public.leads
  set converted_company_id = v_company,
      status = case when status in ('won', 'lost') then status else 'trial' end
  where id = p_lead;

  return v_company;
end $$;

-- Subscription lifecycle sweep (run by the scheduled function).
create or replace function public.expire_subscriptions() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_trials integer := 0;
  v_past_due integer := 0;
  v_expired integer := 0;
  v_cancelled integer := 0;
begin
  -- Trials that ran out.
  with s as (
    update public.subscriptions set status = 'expired'
    where status = 'trialing' and trial_end is not null and trial_end < now()
    returning company_id
  ), c as (
    update public.companies set status = 'suspended'
    where id in (select company_id from s) and status in ('trial', 'onboarding')
    returning id
  ), k as (
    update public.customers set suspended_at = now(), suspension_reason = 'trial_expired'
    where company_id in (select id from c)
    returning 1
  )
  select count(*) into v_trials from s;

  -- Cancellations taking effect at period end.
  with s as (
    update public.subscriptions set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now())
    where status in ('active', 'past_due') and cancel_at_period_end
      and current_period_end is not null and current_period_end < now()
    returning company_id
  ), c as (
    update public.companies set status = 'cancelled'
    where id in (select company_id from s) and status <> 'cancelled'
    returning 1
  )
  select count(*) into v_cancelled from s;

  -- Unpaid renewals: 7-day grace period, then expiry + suspension.
  with s as (
    update public.subscriptions set status = 'expired'
    where status = 'past_due' and current_period_end is not null
      and current_period_end < now() - interval '7 days'
    returning company_id
  ), c as (
    update public.companies set status = 'suspended'
    where id in (select company_id from s) and status = 'active'
    returning id
  ), k as (
    update public.customers set suspended_at = now(), suspension_reason = 'subscription_expired'
    where company_id in (select id from c)
    returning 1
  )
  select count(*) into v_expired from s;

  with s as (
    update public.subscriptions set status = 'past_due'
    where status = 'active' and not cancel_at_period_end
      and current_period_end is not null and current_period_end < now()
    returning 1
  )
  select count(*) into v_past_due from s;

  update public.invoices set status = 'overdue'
  where status = 'issued' and due_at is not null and due_at < now();

  return jsonb_build_object('trials_expired', v_trials, 'past_due', v_past_due,
                            'expired', v_expired, 'cancelled', v_cancelled);
end $$;

-- ── Rate limiting (fixed window) ────────────────────────────────────
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_max;
end $$;

-- ── Audit ───────────────────────────────────────────────────────────
create or replace function public.log_audit(
  p_action text, p_entity_type text, p_entity_id text default null, p_company uuid default null,
  p_metadata jsonb default '{}'::jsonb, p_actor uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, company_id, metadata)
  values (coalesce(auth.uid(), p_actor), p_action, p_entity_type, p_entity_id, p_company, coalesce(p_metadata, '{}'::jsonb));
end $$;

create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_company uuid;
  v_meta jsonb := '{}'::jsonb;
begin
  v_company := case
    when tg_table_name = 'companies' then (v_row ->> 'id')::uuid
    when v_row ? 'company_id' then nullif(v_row ->> 'company_id', '')::uuid
  end;
  -- The tenant row itself may be the thing being deleted.
  if tg_op = 'DELETE' and tg_table_name = 'companies' then v_company := null; end if;
  if tg_op = 'DELETE' and v_company is not null
     and not exists (select 1 from public.companies where id = v_company) then
    v_company := null;
  end if;

  if tg_op = 'UPDATE' and v_row ? 'status' then
    v_meta := jsonb_build_object('status_from', to_jsonb(old) ->> 'status', 'status_to', v_row ->> 'status');
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, company_id, metadata)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'key', v_row ->> 'company_id', v_row ->> 'user_id'),
    v_company,
    v_meta || case when tg_table_name = 'user_roles' then jsonb_build_object('role', v_row ->> 'role_key') else '{}'::jsonb end
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'user_roles', 'company_memberships', 'companies', 'company_branding', 'plans', 'subscriptions',
    'invoices', 'payments', 'app_settings', 'notification_templates'
  ] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
                   t || '_audit', t);
  end loop;
end $$;

-- ── Function privileges ─────────────────────────────────────────────
-- Backend-only functions: never callable with a browser (anon/authenticated) key.
revoke execute on function public.provision_trial(uuid, text, text, text, text, text, text, integer, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.create_tenant(text, text, text, text, text, text, integer, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.seed_onboarding_tasks(uuid) from public, anon, authenticated;
revoke execute on function public.expire_subscriptions() from public, anon, authenticated;
revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.provision_trial(uuid, text, text, text, text, text, text, integer, text, text, boolean) to service_role;
grant execute on function public.create_tenant(text, text, text, text, text, text, integer, text, text, uuid, uuid, text) to service_role;
grant execute on function public.seed_onboarding_tasks(uuid) to service_role;
grant execute on function public.expire_subscriptions() to service_role;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- Role-checked functions: signed-in users only (each one validates the caller's role itself).
revoke execute on function public.verify_payment(uuid, uuid, text) from public, anon;
revoke execute on function public.convert_lead_to_customer(uuid, text, uuid) from public, anon;
revoke execute on function public.find_duplicate_leads(text, text, uuid) from public, anon;
revoke execute on function public.log_audit(text, text, text, uuid, jsonb, uuid) from public, anon;
grant execute on function public.verify_payment(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.convert_lead_to_customer(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.find_duplicate_leads(text, text, uuid) to authenticated, service_role;
grant execute on function public.log_audit(text, text, text, uuid, jsonb, uuid) to authenticated, service_role;
