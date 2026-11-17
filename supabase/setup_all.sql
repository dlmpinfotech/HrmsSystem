-- HRMS Cloud: full database setup (all migrations combined). Run once on an EMPTY Supabase project.

-- ===== 0001_schema.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0001 — Core schema
-- All timestamps are stored in UTC (timestamptz). Display timezone is Asia/Kolkata.
-- ════════════════════════════════════════════════════════════════════

create sequence if not exists public.invoice_number_seq;
create sequence if not exists public.ticket_number_seq;

-- ── Identity ────────────────────────────────────────────────────────
create table public.roles (
  key         text primary key,
  name        text not null,
  description text,
  is_staff    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  email              text not null,
  full_name          text not null default '',
  phone              text,
  avatar_url         text,
  preferred_language text check (preferred_language in ('en', 'ta')),
  theme_preference   text not null default 'system' check (theme_preference in ('light', 'dark', 'system')),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));

create table public.user_roles (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role_key   text not null references public.roles (key) on delete restrict,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role_key)
);
create index user_roles_role_idx on public.user_roles (role_key);

-- ── Tenants ─────────────────────────────────────────────────────────
create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  tenant_code      text not null unique default ('T-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  name             text not null check (char_length(name) between 2 and 160),
  display_name     text,
  industry         text,
  city             text,
  state            text default 'Tamil Nadu',
  country          text not null default 'India',
  address          text,
  pincode          text,
  gst_number       text,
  website          text,
  employee_count   integer check (employee_count is null or employee_count >= 0),
  default_language text not null default 'en' check (default_language in ('en', 'ta')),
  hrms_url         text,
  status           text not null default 'onboarding'
                   check (status in ('onboarding', 'trial', 'active', 'suspended', 'cancelled')),
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index companies_status_idx on public.companies (status);
create index companies_city_idx on public.companies (city);

create table public.company_memberships (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null default 'customer_user' check (role in ('customer_admin', 'customer_user')),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index company_memberships_user_idx on public.company_memberships (user_id);

create table public.company_branding (
  company_id       uuid primary key references public.companies (id) on delete cascade,
  display_name     text,
  tagline          text,
  logo_path        text,
  logo_light_path  text,
  logo_dark_path   text,
  favicon_path     text,
  theme_mode       text not null default 'system' check (theme_mode in ('light', 'dark', 'system', 'custom')),
  colors           jsonb not null default '{}'::jsonb,
  appearance       jsonb not null default '{}'::jsonb,
  default_language text not null default 'en' check (default_language in ('en', 'ta')),
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.user_invitations (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  role_key   text not null references public.roles (key),
  company_id uuid references public.companies (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index user_invitations_pending_idx
  on public.user_invitations (lower(email), coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'pending';

-- ── Marketing & CRM ─────────────────────────────────────────────────
create table public.marketing_campaigns (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  channel    text not null default 'other',
  utm_code   text unique,
  status     text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed')),
  budget     numeric(12, 2) check (budget is null or budget >= 0),
  start_date date,
  end_date   date,
  notes      text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id                    uuid primary key default gen_random_uuid(),
  company_name          text not null check (char_length(company_name) between 1 and 160),
  contact_person        text not null check (char_length(contact_person) between 1 and 120),
  phone                 text not null,
  phone_normalized      text,
  email                 text,
  email_normalized      text,
  city                  text,
  industry              text,
  employee_count        integer check (employee_count is null or employee_count >= 0),
  existing_hrms         text,
  interested_features   text[] not null default '{}',
  source                text not null default 'website',
  campaign_id           uuid references public.marketing_campaigns (id) on delete set null,
  assigned_to           uuid references public.profiles (id) on delete set null,
  priority              text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status                text not null default 'new'
                        check (status in ('new', 'contacted', 'qualified', 'demo_scheduled', 'demo_completed',
                                          'trial', 'negotiation', 'won', 'lost')),
  next_follow_up_at     timestamptz,
  remarks               text,
  communication_consent boolean not null default false,
  lost_reason           text,
  expected_value        numeric(12, 2),
  converted_company_id  uuid references public.companies (id) on delete set null,
  utm                   jsonb not null default '{}'::jsonb,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index leads_status_idx on public.leads (status);
create index leads_assigned_idx on public.leads (assigned_to);
create index leads_created_idx on public.leads (created_at desc);
create index leads_follow_up_idx on public.leads (next_follow_up_at) where next_follow_up_at is not null;
create index leads_phone_norm_idx on public.leads (phone_normalized);
create index leads_email_norm_idx on public.leads (email_normalized);
create index leads_source_idx on public.leads (source);
create index leads_city_idx on public.leads (city);

create table public.lead_activities (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  type       text not null default 'note'
             check (type in ('note', 'call', 'email', 'whatsapp', 'meeting', 'status_change', 'assignment', 'system')),
  body       text,
  metadata   jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index lead_activities_lead_idx on public.lead_activities (lead_id, created_at desc);

create table public.lead_tasks (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  due_at       timestamptz,
  completed_at timestamptz,
  assigned_to  uuid references public.profiles (id) on delete set null,
  reminded_at  timestamptz,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index lead_tasks_lead_idx on public.lead_tasks (lead_id);
create index lead_tasks_due_idx on public.lead_tasks (assigned_to, due_at) where completed_at is null;

-- ── Demos ───────────────────────────────────────────────────────────
-- Weekly availability, expressed in Asia/Kolkata wall-clock time.
create table public.demo_availability (
  id             uuid primary key default gen_random_uuid(),
  salesperson_id uuid not null references public.profiles (id) on delete cascade,
  weekday        smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time     time not null,
  end_time       time not null,
  slot_minutes   integer not null default 45 check (slot_minutes between 15 and 180),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  check (end_time > start_time),
  unique (salesperson_id, weekday, start_time)
);

create table public.demo_bookings (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid references public.leads (id) on delete set null,
  salesperson_id   uuid references public.profiles (id) on delete set null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  contact_name     text not null,
  company_name     text not null,
  email            text,
  phone            text not null,
  language         text not null default 'en' check (language in ('en', 'ta')),
  mode             text not null default 'online' check (mode in ('online', 'onsite', 'phone')),
  meeting_url      text,
  notes            text,
  manage_token     text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  reschedule_count integer not null default 0,
  cancelled_reason text,
  feedback_rating  smallint check (feedback_rating between 1 and 5),
  feedback_notes   text,
  outcome          text check (outcome in ('interested', 'needs_follow_up', 'not_interested', 'trial_started')),
  follow_up_at     timestamptz,
  reminder_24h_at  timestamptz,
  reminder_1h_at   timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at)
);
-- Double-booking prevention: one live booking per salesperson per start time.
create unique index demo_bookings_slot_uniq on public.demo_bookings (salesperson_id, starts_at) where status = 'scheduled';
create index demo_bookings_starts_idx on public.demo_bookings (starts_at);
create index demo_bookings_lead_idx on public.demo_bookings (lead_id);

-- ── Customers ───────────────────────────────────────────────────────
create table public.customers (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null unique references public.companies (id) on delete cascade,
  lead_id                 uuid references public.leads (id) on delete set null,
  account_owner_id        uuid references public.profiles (id) on delete set null,
  source                  text,
  notes                   text,
  activated_at            timestamptz,
  suspended_at            timestamptz,
  suspension_reason       text,
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create table public.customer_contacts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  name            text not null,
  designation     text,
  email           text,
  phone           text,
  is_primary      boolean not null default false,
  whatsapp_opt_in boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index customer_contacts_company_idx on public.customer_contacts (company_id);

create table public.onboarding_tasks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  title        text not null,
  description  text,
  status       text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'skipped')),
  due_date     date,
  sort_order   integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index onboarding_tasks_company_idx on public.onboarding_tasks (company_id, sort_order);

-- ── Plans, subscriptions, billing ───────────────────────────────────
create table public.plans (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,
  name           text not null,
  description    text,
  price_monthly  numeric(12, 2) check (price_monthly is null or price_monthly >= 0),
  price_yearly   numeric(12, 2) check (price_yearly is null or price_yearly >= 0),
  currency       text not null default 'INR',
  employee_limit integer check (employee_limit is null or employee_limit > 0),
  user_limit     integer check (user_limit is null or user_limit > 0),
  features       jsonb not null default '[]'::jsonb,
  trial_days     integer not null default 14 check (trial_days between 0 and 90),
  billing_frequencies text[] not null default '{monthly,yearly}',
  is_active      boolean not null default true,
  is_public      boolean not null default true,
  is_featured    boolean not null default false,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  plan_id              uuid not null references public.plans (id) on delete restrict,
  status               text not null default 'trialing'
                       check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  billing_frequency    text not null default 'monthly' check (billing_frequency in ('monthly', 'quarterly', 'yearly')),
  amount               numeric(12, 2) not null default 0 check (amount >= 0),
  currency             text not null default 'INR',
  trial_start          timestamptz,
  trial_end            timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at         timestamptz,
  cancel_reason        text,
  razorpay_subscription_id text,
  trial_reminder_at    timestamptz,
  renewal_reminder_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- At most one live subscription per tenant.
create unique index subscriptions_live_uniq on public.subscriptions (company_id)
  where status in ('trialing', 'active', 'past_due');
create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_period_end_idx on public.subscriptions (current_period_end);

create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  invoice_number  text not null unique
                  default ('INV-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0')),
  company_id      uuid not null references public.companies (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  description     text,
  amount          numeric(12, 2) not null check (amount >= 0),
  tax_amount      numeric(12, 2) not null default 0 check (tax_amount >= 0),
  total           numeric(12, 2) not null check (total >= 0),
  currency        text not null default 'INR',
  status          text not null default 'issued' check (status in ('draft', 'issued', 'paid', 'void', 'overdue')),
  issued_at       timestamptz not null default now(),
  due_at          timestamptz,
  paid_at         timestamptz,
  period_start    timestamptz,
  period_end      timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index invoices_company_idx on public.invoices (company_id, issued_at desc);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  invoice_id          uuid references public.invoices (id) on delete set null,
  subscription_id     uuid references public.subscriptions (id) on delete set null,
  amount              numeric(12, 2) not null check (amount > 0),
  currency            text not null default 'INR',
  method              text not null default 'bank_transfer'
                      check (method in ('bank_transfer', 'upi', 'cash', 'cheque', 'razorpay', 'other')),
  status              text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'refunded')),
  reference           text,
  paid_on             date,
  notes               text,
  razorpay_order_id   text,
  razorpay_payment_id text unique,
  recorded_by         uuid references public.profiles (id) on delete set null,
  verified_by         uuid references public.profiles (id) on delete set null,
  verified_at         timestamptz,
  verification_source text check (verification_source in ('manual', 'razorpay_webhook')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index payments_company_idx on public.payments (company_id, created_at desc);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_rzp_order_idx on public.payments (razorpay_order_id);

-- ── Support ─────────────────────────────────────────────────────────
create table public.support_tickets (
  id            uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default ('TKT-' || lpad(nextval('public.ticket_number_seq')::text, 6, '0')),
  company_id    uuid not null references public.companies (id) on delete cascade,
  created_by    uuid references public.profiles (id) on delete set null,
  subject       text not null check (char_length(subject) between 3 and 200),
  description   text not null,
  category      text not null default 'general'
                check (category in ('general', 'technical', 'billing', 'onboarding', 'feature_request')),
  priority      text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status        text not null default 'open'
                check (status in ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  assigned_to   uuid references public.profiles (id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index support_tickets_company_idx on public.support_tickets (company_id, created_at desc);
create index support_tickets_status_idx on public.support_tickets (status);

create table public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  body        text not null check (char_length(body) between 1 and 10000),
  is_internal boolean not null default false,
  created_at  timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- ── Notifications & WhatsApp ────────────────────────────────────────
create table public.notification_templates (
  id                     uuid primary key default gen_random_uuid(),
  key                    text not null,
  channel                text not null check (channel in ('email', 'whatsapp')),
  language               text not null default 'en' check (language in ('en', 'ta')),
  name                   text not null,
  subject                text,
  body                   text not null,
  whatsapp_template_name text, -- name of the template approved in Meta Business Manager
  variables              text[] not null default '{}',
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (key, channel, language)
);

create table public.notification_logs (
  id                  uuid primary key default gen_random_uuid(),
  template_key        text not null,
  channel             text not null check (channel in ('email', 'whatsapp')),
  recipient           text not null,
  language            text not null default 'en',
  subject             text,
  body                text,
  payload             jsonb not null default '{}'::jsonb,
  status              text not null default 'queued'
                      check (status in ('queued', 'sent', 'delivered', 'read', 'failed', 'skipped')),
  provider            text,
  provider_message_id text,
  error               text,
  attempts            integer not null default 0,
  next_retry_at       timestamptz,
  dedupe_key          text unique,
  lead_id             uuid references public.leads (id) on delete set null,
  company_id          uuid references public.companies (id) on delete set null,
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  updated_at          timestamptz not null default now()
);
create index notification_logs_created_idx on public.notification_logs (created_at desc);
create index notification_logs_retry_idx on public.notification_logs (next_retry_at) where status = 'failed';
create index notification_logs_provider_idx on public.notification_logs (provider_message_id);

create table public.whatsapp_conversations (
  id              uuid primary key default gen_random_uuid(),
  wa_phone        text not null unique, -- E.164 digits without '+'
  contact_name    text,
  lead_id         uuid references public.leads (id) on delete set null,
  company_id      uuid references public.companies (id) on delete set null,
  last_message_at timestamptz,
  last_inbound_at timestamptz, -- drives the 24h customer-service window
  unread_count    integer not null default 0,
  created_at      timestamptz not null default now()
);

create table public.whatsapp_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations (id) on delete cascade,
  direction       text not null check (direction in ('inbound', 'outbound')),
  wa_message_id   text unique, -- duplicate prevention for webhook redeliveries
  type            text not null default 'text',
  body            text,
  template_name   text,
  status          text not null default 'received'
                  check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  error           text,
  payload         jsonb not null default '{}'::jsonb,
  sent_by         uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index whatsapp_messages_conv_idx on public.whatsapp_messages (conversation_id, created_at);

create table public.communication_consents (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid references public.leads (id) on delete cascade,
  contact_id uuid references public.customer_contacts (id) on delete cascade,
  phone      text,
  email      text,
  channel    text not null check (channel in ('whatsapp', 'email', 'phone', 'sms')),
  granted    boolean not null,
  source     text not null default 'web_form',
  wording    text,
  ip_hash    text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index communication_consents_phone_idx on public.communication_consents (phone, channel);
create index communication_consents_lead_idx on public.communication_consents (lead_id);

-- ── Content ─────────────────────────────────────────────────────────
create table public.videos (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  title_ta      text,
  description   text,
  description_ta text,
  url           text not null,
  provider      text not null default 'youtube' check (provider in ('youtube', 'azure_blob', 'file')),
  thumbnail_url text,
  category      text not null default 'overview',
  audience      text not null default 'public' check (audience in ('public', 'customer')),
  duration_seconds integer,
  sort_order    integer not null default 0,
  is_published  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.help_articles (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  category     text not null default 'getting_started',
  title        text not null,
  title_ta     text,
  body         text not null,
  body_ta      text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── Platform ────────────────────────────────────────────────────────
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  company_id  uuid references public.companies (id) on delete set null,
  metadata    jsonb not null default '{}'::jsonb,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 1,
  primary key (key, window_start)
);

-- ===== 0002_functions.sql =====
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

-- ===== 0003_rls.sql =====
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

-- ===== 0004_storage.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0004 — Storage: company branding assets
-- Objects live at  branding/<company_uuid>/<kind>-<timestamp>.<ext>
-- The bucket enforces a 2 MB limit and an image-only MIME allowlist (no SVG:
-- SVG can carry scripts). Reads are public so logos render on login screens.
-- ════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding', 'branding', true, 2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy branding_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'branding'
         and (public.is_staff() or public.is_company_member(public.storage_company_id(name))));

create policy branding_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'branding'
              and (public.is_super_admin() or public.is_company_admin(public.storage_company_id(name))));

create policy branding_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'branding'
         and (public.is_super_admin() or public.is_company_admin(public.storage_company_id(name))))
  with check (bucket_id = 'branding'
              and (public.is_super_admin() or public.is_company_admin(public.storage_company_id(name))));

create policy branding_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'branding'
         and (public.is_super_admin() or public.is_company_admin(public.storage_company_id(name))));

-- ===== 0005_reference_data.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0005 — Reference data required for the app to run
-- (roles, default plans, settings, notification templates, help articles)
-- Plan prices are STARTING DEFAULTS — change them in Admin → Subscriptions → Plans.
-- ════════════════════════════════════════════════════════════════════

insert into public.roles (key, name, description, is_staff) values
  ('super_admin',       'Super Admin',       'Full platform access including users, settings and audit logs', true),
  ('sales_admin',       'Sales Admin',       'Manages the sales team, all leads, customers, plans and billing', true),
  ('sales_executive',   'Sales Executive',   'Works on assigned leads and demos', true),
  ('support_executive', 'Support Executive', 'Handles customer support tickets', true),
  ('customer_admin',    'Customer Admin',    'Administers one customer company in the portal', false),
  ('customer_user',     'Customer User',     'Member of a customer company', false)
on conflict (key) do update set name = excluded.name, description = excluded.description, is_staff = excluded.is_staff;

insert into public.plans (key, name, description, price_monthly, price_yearly, employee_limit, user_limit, trial_days, sort_order, is_featured, features) values
  ('starter', 'Starter', 'For small teams getting started with digital HR', 999, 9990, 25, 2, 14, 1, false,
   '[{"en":"Employee database","ta":"பணியாளர் தரவுத்தளம்"},{"en":"Attendance & leave","ta":"வருகைப் பதிவு & விடுப்பு"},{"en":"Basic payroll & payslips","ta":"அடிப்படை சம்பளப் பட்டியல் & சம்பளச் சீட்டு"},{"en":"Email support","ta":"மின்னஞ்சல் ஆதரவு"}]'::jsonb),
  ('business', 'Business', 'For growing businesses that need payroll compliance', 2499, 24990, 100, 5, 14, 2, true,
   '[{"en":"Everything in Starter","ta":"Starter-இல் உள்ள அனைத்தும்"},{"en":"PF, ESI & professional tax","ta":"PF, ESI & தொழில் வரி"},{"en":"Shift & overtime management","ta":"ஷிப்ட் & கூடுதல் நேர மேலாண்மை"},{"en":"Employee self-service app","ta":"பணியாளர் சுய சேவை செயலி"},{"en":"WhatsApp & phone support","ta":"WhatsApp & தொலைபேசி ஆதரவு"}]'::jsonb),
  ('growth', 'Growth', 'For multi-branch organisations', 4999, 49990, 300, 15, 14, 3, false,
   '[{"en":"Everything in Business","ta":"Business-இல் உள்ள அனைத்தும்"},{"en":"Multi-branch & departments","ta":"பல கிளைகள் & துறைகள்"},{"en":"Biometric device integration","ta":"பயோமெட்ரிக் சாதன இணைப்பு"},{"en":"Advanced reports & analytics","ta":"மேம்பட்ட அறிக்கைகள் & பகுப்பாய்வு"},{"en":"Priority support","ta":"முன்னுரிமை ஆதரவு"}]'::jsonb),
  ('enterprise', 'Enterprise', 'Custom rollout for large organisations', null, null, null, null, 30, 4, false,
   '[{"en":"Everything in Growth","ta":"Growth-இல் உள்ள அனைத்தும்"},{"en":"Unlimited employees","ta":"வரம்பற்ற பணியாளர்கள்"},{"en":"Custom workflows & integrations","ta":"தனிப்பயன் பணிப்பாய்வுகள் & இணைப்புகள்"},{"en":"Dedicated account manager","ta":"பிரத்யேக கணக்கு மேலாளர்"},{"en":"On-site onboarding","ta":"நேரடி செயலாக்க உதவி"}]'::jsonb)
on conflict (key) do nothing;

insert into public.app_settings (key, value, is_public) values
  ('brand',          '{"name":"HRMS Cloud","support_email":"","support_phone":"","address":"Tirunelveli, Tamil Nadu, India","hrms_login_url":""}'::jsonb, true),
  ('whatsapp',       '{"number":"","click_to_chat_enabled":true}'::jsonb, true),
  ('demo',           '{"min_lead_hours":4,"max_days_ahead":21,"default_meeting_url":""}'::jsonb, true),
  ('analytics',      '{"ga4_measurement_id":""}'::jsonb, true),
  ('testimonials',   '[]'::jsonb, true),
  -- Chargeable WhatsApp Cloud API messaging is OFF until a Super Admin enables it.
  ('whatsapp_cloud', '{"enabled":false,"default_language":"en"}'::jsonb, false),
  ('email',          '{"enabled":true}'::jsonb, false)
on conflict (key) do nothing;

-- ── Notification templates ──────────────────────────────────────────
-- Placeholders use {{variable}}. For WhatsApp, `variables` order = body parameter order
-- ({{1}}, {{2}}, …) of the template approved in Meta Business Manager.
insert into public.notification_templates (key, channel, language, name, subject, body, whatsapp_template_name, variables) values
  ('lead_acknowledgement', 'email', 'en', 'Enquiry received',
   'We received your enquiry — {{brand}}',
   E'Hi {{name}},\n\nThank you for your interest in {{brand}}. Our team will contact you shortly.\n\nIf you would like to see the product right away, book a free demo: {{demo_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,demo_url}'),
  ('lead_acknowledgement', 'email', 'ta', 'விசாரணை பெறப்பட்டது',
   'உங்கள் விசாரணை பெறப்பட்டது — {{brand}}',
   E'வணக்கம் {{name}},\n\n{{brand}} மீது ஆர்வம் காட்டியதற்கு நன்றி. எங்கள் குழு விரைவில் உங்களைத் தொடர்பு கொள்ளும்.\n\nஉடனடியாக தயாரிப்பைப் பார்க்க இலவச டெமோவை முன்பதிவு செய்யுங்கள்: {{demo_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,demo_url}'),

  ('demo_confirmation', 'email', 'en', 'Demo confirmation',
   'Your demo is confirmed for {{date}} at {{time}}',
   E'Hi {{name}},\n\nYour {{brand}} demo for {{company}} is confirmed.\n\nDate: {{date}}\nTime: {{time}} (IST)\nMode: {{mode}}\n{{meeting_line}}\n\nNeed to change the time? Reschedule or cancel here: {{manage_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,date,time,mode,meeting_line,manage_url}'),
  ('demo_confirmation', 'email', 'ta', 'டெமோ உறுதிப்படுத்தல்',
   'உங்கள் டெமோ {{date}} அன்று {{time}} மணிக்கு உறுதி செய்யப்பட்டது',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்திற்கான {{brand}} டெமோ உறுதி செய்யப்பட்டது.\n\nதேதி: {{date}}\nநேரம்: {{time}} (IST)\nமுறை: {{mode}}\n{{meeting_line}}\n\nநேரத்தை மாற்ற வேண்டுமா? இங்கே மாற்றலாம் அல்லது ரத்து செய்யலாம்: {{manage_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,date,time,mode,meeting_line,manage_url}'),
  ('demo_confirmation', 'whatsapp', 'en', 'Demo confirmation (WhatsApp)', null,
   'Hi {{name}}, your {{brand}} demo is confirmed for {{date}} at {{time}} IST. Manage your booking: {{manage_url}}',
   'demo_confirmation', '{name,brand,date,time,manage_url}'),
  ('demo_confirmation', 'whatsapp', 'ta', 'டெமோ உறுதிப்படுத்தல் (WhatsApp)', null,
   'வணக்கம் {{name}}, உங்கள் {{brand}} டெமோ {{date}} அன்று {{time}} IST மணிக்கு உறுதி செய்யப்பட்டது. முன்பதிவை நிர்வகிக்க: {{manage_url}}',
   'demo_confirmation', '{name,brand,date,time,manage_url}'),

  ('demo_reminder', 'email', 'en', 'Demo reminder',
   'Reminder: your demo is {{when}}',
   E'Hi {{name}},\n\nThis is a reminder for your {{brand}} demo.\n\nDate: {{date}}\nTime: {{time}} (IST)\n{{meeting_line}}\n\nReschedule or cancel: {{manage_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,when,date,time,meeting_line,manage_url}'),
  ('demo_reminder', 'email', 'ta', 'டெமோ நினைவூட்டல்',
   'நினைவூட்டல்: உங்கள் டெமோ {{when}}',
   E'வணக்கம் {{name}},\n\nஉங்கள் {{brand}} டெமோவிற்கான நினைவூட்டல்.\n\nதேதி: {{date}}\nநேரம்: {{time}} (IST)\n{{meeting_line}}\n\nமாற்ற அல்லது ரத்து செய்ய: {{manage_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,when,date,time,meeting_line,manage_url}'),
  ('demo_reminder', 'whatsapp', 'en', 'Demo reminder (WhatsApp)', null,
   'Hi {{name}}, a reminder that your {{brand}} demo is on {{date}} at {{time}} IST.',
   'demo_reminder', '{name,brand,date,time}'),
  ('demo_reminder', 'whatsapp', 'ta', 'டெமோ நினைவூட்டல் (WhatsApp)', null,
   'வணக்கம் {{name}}, உங்கள் {{brand}} டெமோ {{date}} அன்று {{time}} IST மணிக்கு நடைபெறும் என்பதை நினைவூட்டுகிறோம்.',
   'demo_reminder', '{name,brand,date,time}'),

  ('demo_rescheduled', 'email', 'en', 'Demo rescheduled',
   'Your demo has been moved to {{date}} at {{time}}',
   E'Hi {{name}},\n\nYour {{brand}} demo has been rescheduled.\n\nNew date: {{date}}\nNew time: {{time}} (IST)\n{{meeting_line}}\n\nManage your booking: {{manage_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,date,time,meeting_line,manage_url}'),
  ('demo_rescheduled', 'email', 'ta', 'டெமோ நேரம் மாற்றப்பட்டது',
   'உங்கள் டெமோ {{date}} அன்று {{time}} மணிக்கு மாற்றப்பட்டது',
   E'வணக்கம் {{name}},\n\nஉங்கள் {{brand}} டெமோ நேரம் மாற்றப்பட்டுள்ளது.\n\nபுதிய தேதி: {{date}}\nபுதிய நேரம்: {{time}} (IST)\n{{meeting_line}}\n\nமுன்பதிவை நிர்வகிக்க: {{manage_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,date,time,meeting_line,manage_url}'),

  ('demo_cancelled', 'email', 'en', 'Demo cancelled',
   'Your demo on {{date}} has been cancelled',
   E'Hi {{name}},\n\nYour {{brand}} demo scheduled for {{date}} at {{time}} (IST) has been cancelled.\n\nYou can book a new time whenever it suits you: {{demo_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,date,time,demo_url}'),
  ('demo_cancelled', 'email', 'ta', 'டெமோ ரத்து செய்யப்பட்டது',
   '{{date}} அன்றைய உங்கள் டெமோ ரத்து செய்யப்பட்டது',
   E'வணக்கம் {{name}},\n\n{{date}} அன்று {{time}} (IST) மணிக்கு திட்டமிடப்பட்ட உங்கள் {{brand}} டெமோ ரத்து செய்யப்பட்டது.\n\nஉங்களுக்கு வசதியான நேரத்தில் மீண்டும் முன்பதிவு செய்யலாம்: {{demo_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,date,time,demo_url}'),

  ('trial_activation', 'email', 'en', 'Trial activated',
   'Your {{brand}} free trial is active',
   E'Hi {{name}},\n\nWelcome! The free trial for {{company}} is now active on the {{plan}} plan until {{trial_end}}.\n\nSign in to your customer portal: {{portal_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,plan,trial_end,portal_url}'),
  ('trial_activation', 'email', 'ta', 'இலவச சோதனை தொடங்கியது',
   'உங்கள் {{brand}} இலவச சோதனை தொடங்கியது',
   E'வணக்கம் {{name}},\n\nவரவேற்கிறோம்! {{company}} நிறுவனத்திற்கான இலவச சோதனை {{plan}} திட்டத்தில் {{trial_end}} வரை செயலில் உள்ளது.\n\nவாடிக்கையாளர் போர்ட்டலில் உள்நுழையுங்கள்: {{portal_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,plan,trial_end,portal_url}'),
  ('trial_activation', 'whatsapp', 'en', 'Trial activated (WhatsApp)', null,
   'Hi {{name}}, your {{brand}} free trial for {{company}} is active until {{trial_end}}.',
   'trial_activation', '{name,brand,company,trial_end}'),

  ('trial_expiring', 'email', 'en', 'Trial expiring',
   'Your free trial ends on {{trial_end}}',
   E'Hi {{name}},\n\nThe {{brand}} free trial for {{company}} ends on {{trial_end}}.\n\nTo continue without interruption, choose a plan in your portal: {{portal_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,trial_end,portal_url}'),
  ('trial_expiring', 'email', 'ta', 'இலவச சோதனை முடிவடைகிறது',
   'உங்கள் இலவச சோதனை {{trial_end}} அன்று முடிவடைகிறது',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்திற்கான {{brand}} இலவச சோதனை {{trial_end}} அன்று முடிவடைகிறது.\n\nதடையின்றி தொடர, போர்ட்டலில் ஒரு திட்டத்தைத் தேர்ந்தெடுக்கவும்: {{portal_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,trial_end,portal_url}'),
  ('trial_expiring', 'whatsapp', 'en', 'Trial expiring (WhatsApp)', null,
   'Hi {{name}}, your {{brand}} free trial for {{company}} ends on {{trial_end}}.',
   'trial_expiring', '{name,brand,company,trial_end}'),

  ('subscription_renewal', 'email', 'en', 'Subscription renewal',
   'Your {{plan}} subscription renews on {{renewal_date}}',
   E'Hi {{name}},\n\nThe {{plan}} subscription for {{company}} is due for renewal on {{renewal_date}}.\nAmount: {{amount}}\n\nView details in your portal: {{portal_url}}\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,plan,renewal_date,amount,portal_url}'),
  ('subscription_renewal', 'email', 'ta', 'சந்தா புதுப்பிப்பு',
   'உங்கள் {{plan}} சந்தா {{renewal_date}} அன்று புதுப்பிக்கப்பட வேண்டும்',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்தின் {{plan}} சந்தா {{renewal_date}} அன்று புதுப்பிக்கப்பட வேண்டும்.\nதொகை: {{amount}}\n\nவிவரங்களை போர்ட்டலில் பார்க்கவும்: {{portal_url}}\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,plan,renewal_date,amount,portal_url}'),
  ('subscription_renewal', 'whatsapp', 'en', 'Subscription renewal (WhatsApp)', null,
   'Hi {{name}}, the {{plan}} subscription for {{company}} is due for renewal on {{renewal_date}}.',
   'subscription_renewal', '{name,plan,company,renewal_date}'),

  ('payment_confirmation', 'email', 'en', 'Payment confirmation',
   'Payment received — {{invoice_number}}',
   E'Hi {{name}},\n\nWe have received and verified your payment of {{amount}} for {{company}}.\nInvoice: {{invoice_number}}\n\nThank you for choosing {{brand}}.\n\nRegards,\n{{brand}} Team',
   null, '{name,brand,company,amount,invoice_number}'),
  ('payment_confirmation', 'email', 'ta', 'பணம் பெறப்பட்டது',
   'பணம் பெறப்பட்டது — {{invoice_number}}',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்திற்கான {{amount}} தொகை பெறப்பட்டு சரிபார்க்கப்பட்டது.\nவிலைப்பட்டியல்: {{invoice_number}}\n\n{{brand}}-ஐத் தேர்ந்தெடுத்ததற்கு நன்றி.\n\nநன்றி,\n{{brand}} குழு',
   null, '{name,brand,company,amount,invoice_number}'),
  ('payment_confirmation', 'whatsapp', 'en', 'Payment confirmation (WhatsApp)', null,
   'Hi {{name}}, we received your payment of {{amount}} for invoice {{invoice_number}}. Thank you!',
   'payment_confirmation', '{name,amount,invoice_number}'),

  ('support_ticket_update', 'email', 'en', 'Support ticket update',
   '[{{ticket_number}}] {{ticket_subject}} — {{status}}',
   E'Hi {{name}},\n\nThere is an update on your support ticket {{ticket_number}}: {{ticket_subject}}\nStatus: {{status}}\n\n{{message}}\n\nView the ticket: {{portal_url}}\n\nRegards,\n{{brand}} Support',
   null, '{name,brand,ticket_number,ticket_subject,status,message,portal_url}'),
  ('support_ticket_update', 'email', 'ta', 'ஆதரவு டிக்கெட் புதுப்பிப்பு',
   '[{{ticket_number}}] {{ticket_subject}} — {{status}}',
   E'வணக்கம் {{name}},\n\nஉங்கள் ஆதரவு டிக்கெட் {{ticket_number}} புதுப்பிக்கப்பட்டுள்ளது: {{ticket_subject}}\nநிலை: {{status}}\n\n{{message}}\n\nடிக்கெட்டைப் பார்க்க: {{portal_url}}\n\nநன்றி,\n{{brand}} ஆதரவுக் குழு',
   null, '{name,brand,ticket_number,ticket_subject,status,message,portal_url}'),
  ('support_ticket_update', 'whatsapp', 'en', 'Support ticket update (WhatsApp)', null,
   'Hi {{name}}, your support ticket {{ticket_number}} has been updated. Status: {{status}}.',
   'support_ticket_update', '{name,ticket_number,status}'),

  ('follow_up_reminder', 'email', 'en', 'Follow-up reminder (internal)',
   'Follow-up due: {{company}}',
   E'Hi {{name}},\n\nA follow-up is due for {{company}} ({{contact}}, {{phone}}).\nDue: {{due}}\n\nOpen the lead: {{lead_url}}',
   null, '{name,company,contact,phone,due,lead_url}')
on conflict (key, channel, language) do nothing;

-- ── Starter help articles (editable in Admin → Help Center) ─────────
insert into public.help_articles (slug, category, title, title_ta, body, body_ta, sort_order) values
  ('getting-started', 'getting_started', 'Getting started with your account', 'உங்கள் கணக்கைத் தொடங்குதல்',
   E'1. Sign in to the customer portal with the email you registered.\n2. Open Company Profile and complete your company details.\n3. Open Branding to upload your logo and choose your colours.\n4. Follow the onboarding checklist on your dashboard.\n5. Use the "Open HRMS" button to launch the HRMS application once your account is activated.',
   E'1. பதிவு செய்த மின்னஞ்சலுடன் வாடிக்கையாளர் போர்ட்டலில் உள்நுழையவும்.\n2. நிறுவன விவரம் பக்கத்தில் உங்கள் நிறுவன விவரங்களை நிரப்பவும்.\n3. பிராண்டிங் பக்கத்தில் லோகோவை பதிவேற்றி நிறங்களைத் தேர்ந்தெடுக்கவும்.\n4. டாஷ்போர்டில் உள்ள செயலாக்கப் பட்டியலைப் பின்பற்றவும்.\n5. கணக்கு செயல்படுத்தப்பட்டதும் "HRMS திற" பொத்தானைப் பயன்படுத்தவும்.', 1),
  ('billing-and-payments', 'billing', 'How billing and payments work', 'பில்லிங் மற்றும் பணம் செலுத்துதல்',
   E'Invoices appear under Billing in your portal. You can pay by bank transfer or UPI and share the reference with our team. A payment is shown as "Verified" only after our accounts team confirms it has been received.',
   E'விலைப்பட்டியல்கள் போர்ட்டலின் பில்லிங் பகுதியில் தோன்றும். வங்கி பரிமாற்றம் அல்லது UPI மூலம் செலுத்தி குறிப்பு எண்ணை எங்கள் குழுவுடன் பகிரலாம். எங்கள் கணக்குக் குழு பணம் பெறப்பட்டதை உறுதிசெய்த பிறகே "சரிபார்க்கப்பட்டது" எனக் காட்டப்படும்.', 2),
  ('raise-support-ticket', 'support', 'Raising a support ticket', 'ஆதரவு டிக்கெட் எழுப்புதல்',
   E'Go to Support → New ticket, choose a category and describe the issue. You will be notified when our team replies, and you can continue the conversation inside the ticket.',
   E'ஆதரவு → புதிய டிக்கெட் பக்கத்திற்குச் சென்று வகையைத் தேர்ந்தெடுத்து சிக்கலை விவரிக்கவும். எங்கள் குழு பதிலளிக்கும்போது உங்களுக்கு அறிவிக்கப்படும்; டிக்கெட்டிலேயே உரையாடலைத் தொடரலாம்.', 3)
on conflict (slug) do nothing;

-- ===== 0006_hrms.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0006 — HRMS core: employees, attendance, leave, holidays
-- Data here belongs to a customer company (tenant) and is visible only to:
--   • that company's HR (Company Admin or HR Manager), and
--   • the employee themself (their own rows).
-- Platform staff are intentionally NOT given access to employee personal data.
-- Attendance times are taken from the server clock (clock_attendance), never the browser.
-- ════════════════════════════════════════════════════════════════════

-- ── New company roles ───────────────────────────────────────────────
insert into public.roles (key, name, description, is_staff) values
  ('hr_manager', 'HR Manager', 'Manages employees, attendance and leave for one company', false),
  ('employee',   'Employee',   'Marks own attendance and applies for leave', false)
on conflict (key) do nothing;

alter table public.company_memberships drop constraint if exists company_memberships_role_check;
alter table public.company_memberships add constraint company_memberships_role_check
  check (role in ('customer_admin', 'hr_manager', 'customer_user', 'employee'));

-- Invitations now carry any of the four company roles into the membership.
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
      values (
        inv.company_id, new.id,
        case when inv.role_key in ('customer_admin', 'hr_manager', 'customer_user', 'employee') then inv.role_key else 'customer_user' end
      )
      on conflict (company_id, user_id) do nothing;
    end if;

    update public.user_invitations set status = 'accepted', accepted_at = now() where id = inv.id;
  end loop;

  return new;
end $$;

-- ── Role helpers ────────────────────────────────────────────────────
create or replace function public.company_role(p_company uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role
  from public.company_memberships m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company and m.user_id = auth.uid() and p.is_active
  limit 1;
$$;

create or replace function public.is_company_hr(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.company_role(p_company) in ('customer_admin', 'hr_manager'), false);
$$;

-- ── Employees ───────────────────────────────────────────────────────
create table public.employees (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete cascade,
  user_id                 uuid references public.profiles (id) on delete set null,
  employee_code           text not null check (char_length(employee_code) between 1 and 30),
  full_name               text not null check (char_length(full_name) between 2 and 120),
  email                   text,
  phone                   text,
  department              text,
  designation             text,
  employment_type         text not null default 'full_time'
                          check (employment_type in ('full_time', 'part_time', 'contract', 'intern')),
  date_of_joining         date,
  date_of_birth           date,
  gender                  text check (gender in ('male', 'female', 'other')),
  address                 text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  shift_start             time not null default '09:30',
  shift_end               time not null default '18:30',
  grace_minutes           integer not null default 10 check (grace_minutes between 0 and 120),
  weekly_offs             smallint[] not null default '{0}',
  status                  text not null default 'active' check (status in ('active', 'inactive', 'exited')),
  exit_date               date,
  created_by              uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (company_id, employee_code),
  check (shift_end > shift_start),
  check (weekly_offs <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[])
);
create unique index employees_email_uniq on public.employees (company_id, lower(email)) where email is not null;
create unique index employees_user_uniq on public.employees (company_id, user_id) where user_id is not null;
create index employees_company_status_idx on public.employees (company_id, status);

-- ── Attendance ──────────────────────────────────────────────────────
create table public.attendance_records (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  employee_id        uuid not null references public.employees (id) on delete cascade,
  work_date          date not null, -- calendar day in Asia/Kolkata
  check_in_at        timestamptz,
  check_out_at       timestamptz,
  check_in_location  jsonb,
  check_out_location jsonb,
  source             text not null default 'self' check (source in ('self', 'hr')),
  status             text not null default 'present'
                     check (status in ('present', 'half_day', 'absent', 'on_leave', 'holiday', 'weekly_off')),
  late_minutes       integer not null default 0,
  work_minutes       integer,
  notes              text check (notes is null or char_length(notes) <= 500),
  corrected_by       uuid references public.profiles (id) on delete set null,
  corrected_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (employee_id, work_date),
  check (check_out_at is null or check_in_at is null or check_out_at >= check_in_at)
);
create index attendance_company_date_idx on public.attendance_records (company_id, work_date);

-- ── Leave ───────────────────────────────────────────────────────────
create table public.leave_types (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 60),
  code         text not null check (char_length(code) between 1 and 10),
  annual_quota numeric(5, 1) check (annual_quota is null or annual_quota >= 0), -- null = no limit
  is_paid      boolean not null default true,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (company_id, code)
);

create table public.holidays (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  holiday_date date not null,
  name         text not null check (char_length(name) between 2 and 80),
  created_at   timestamptz not null default now(),
  unique (company_id, holiday_date)
);

create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete restrict,
  start_date    date not null,
  end_date      date not null,
  half_day      boolean not null default false,
  days          numeric(5, 1) not null default 0,
  reason        text check (reason is null or char_length(reason) <= 1000),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date),
  check (not half_day or start_date = end_date)
);
create index leave_requests_company_status_idx on public.leave_requests (company_id, status);
create index leave_requests_employee_idx on public.leave_requests (employee_id, start_date);

do $$
declare t text;
begin
  foreach t in array array['employees', 'attendance_records', 'leave_types', 'leave_requests'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['employees', 'leave_requests', 'leave_types', 'holidays'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ── Defaults per company ────────────────────────────────────────────
create or replace function public.seed_hr_defaults(p_company uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.leave_types (company_id, name, code, annual_quota, is_paid, sort_order) values
    (p_company, 'Casual Leave', 'CL', 12, true, 1),
    (p_company, 'Sick Leave',   'SL', 12, true, 2),
    (p_company, 'Earned Leave', 'EL', 15, true, 3),
    (p_company, 'Loss of Pay',  'LOP', null, false, 4)
  on conflict (company_id, code) do nothing;
$$;

create or replace function public.companies_seed_hr() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_hr_defaults(new.id);
  return new;
end $$;
create trigger companies_seed_hr after insert on public.companies for each row execute function public.companies_seed_hr();

select public.seed_hr_defaults(id) from public.companies;

-- ── Employee rules ──────────────────────────────────────────────────
create or replace function public.employees_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_limit integer;
  v_active integer;
  v_n integer;
begin
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  new.employee_code := upper(trim(coalesce(new.employee_code, '')));
  if new.employee_code = '' then
    select count(*) + 1 into v_n from public.employees where company_id = new.company_id;
    loop
      new.employee_code := 'EMP' || lpad(v_n::text, 4, '0');
      exit when not exists (select 1 from public.employees where company_id = new.company_id and employee_code = new.employee_code);
      v_n := v_n + 1;
    end loop;
  end if;

  if tg_op = 'UPDATE' and new.company_id <> old.company_id then
    raise exception 'company cannot change' using errcode = '42501';
  end if;
  if new.status = 'exited' and new.exit_date is null then
    new.exit_date := (now() at time zone 'Asia/Kolkata')::date;
  end if;

  -- Link to a portal login with the same email in this company.
  if new.user_id is null and new.email is not null then
    select m.user_id into new.user_id
    from public.company_memberships m join public.profiles p on p.id = m.user_id
    where m.company_id = new.company_id and lower(p.email) = new.email
      and not exists (select 1 from public.employees e where e.company_id = new.company_id and e.user_id = m.user_id and e.id <> new.id)
    limit 1;
  end if;

  -- Plan employee limit (counts active employees).
  if new.status = 'active' and (tg_op = 'INSERT' or old.status <> 'active') then
    select p.employee_limit into v_limit
    from public.subscriptions s join public.plans p on p.id = s.plan_id
    where s.company_id = new.company_id and s.status in ('trialing', 'active', 'past_due')
    limit 1;
    if v_limit is not null then
      select count(*) into v_active from public.employees where company_id = new.company_id and status = 'active' and id <> new.id;
      if v_active >= v_limit then
        raise exception 'employee_limit_reached' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger employees_before before insert or update on public.employees
  for each row execute function public.employees_before();

-- A new portal login is linked to the employee record with the same email.
create or replace function public.memberships_link_employee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.employees e
  set user_id = new.user_id
  from public.profiles p
  where p.id = new.user_id and e.company_id = new.company_id and e.user_id is null
    and e.email = lower(p.email)
    and not exists (select 1 from public.employees x where x.company_id = new.company_id and x.user_id = new.user_id);
  return new;
end $$;
create trigger memberships_link_employee after insert on public.company_memberships
  for each row execute function public.memberships_link_employee();

-- ── Attendance rules ────────────────────────────────────────────────
create or replace function public.attendance_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_late integer;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id; -- never trust a client-supplied tenant

  if new.check_in_at is not null then
    v_late := floor(extract(epoch from ((new.check_in_at at time zone 'Asia/Kolkata') - (new.work_date + v_emp.shift_start))) / 60);
    new.late_minutes := case when v_late > v_emp.grace_minutes then v_late else 0 end;
  else
    new.late_minutes := 0;
  end if;

  if new.check_in_at is not null and new.check_out_at is not null then
    new.work_minutes := floor(extract(epoch from (new.check_out_at - new.check_in_at)) / 60);
    -- Less than four hours on a self-marked day counts as a half day.
    if new.source = 'self' and new.status = 'present' and new.work_minutes < 240 then
      new.status := 'half_day';
    end if;
  else
    new.work_minutes := null;
  end if;

  if new.source = 'hr' and auth.uid() is not null then
    new.corrected_by := auth.uid();
    new.corrected_at := now();
  end if;
  return new;
end $$;
create trigger attendance_before before insert or update on public.attendance_records
  for each row execute function public.attendance_before();

-- Clean location payload: only numeric lat/lng/accuracy within valid ranges.
create or replace function public.clean_location(p jsonb) returns jsonb
language sql immutable as $$
  select case
    when p is null or jsonb_typeof(p -> 'lat') <> 'number' or jsonb_typeof(p -> 'lng') <> 'number' then null
    when (p ->> 'lat')::numeric not between -90 and 90 or (p ->> 'lng')::numeric not between -180 and 180 then null
    else jsonb_build_object(
      'lat', round((p ->> 'lat')::numeric, 6),
      'lng', round((p ->> 'lng')::numeric, 6),
      'accuracy', case when jsonb_typeof(p -> 'accuracy') = 'number' then round((p ->> 'accuracy')::numeric) end)
  end;
$$;

-- Self check-in / check-out. Times come from the database clock.
create or replace function public.clock_attendance(p_company uuid, p_action text, p_location jsonb default null)
returns public.attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_rec public.attendance_records;
  v_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select e.* into v_emp
  from public.employees e join public.profiles p on p.id = e.user_id
  where e.company_id = p_company and e.user_id = auth.uid() and e.status = 'active' and p.is_active;
  if not found then raise exception 'no_employee_record' using errcode = 'P0002'; end if;

  if exists (select 1 from public.companies where id = p_company and status in ('suspended', 'cancelled')) then
    raise exception 'company_inactive' using errcode = '42501';
  end if;

  select * into v_rec from public.attendance_records where employee_id = v_emp.id and work_date = v_date for update;

  if p_action = 'in' then
    if found and v_rec.check_in_at is not null then raise exception 'already_checked_in' using errcode = '23505'; end if;
    insert into public.attendance_records (company_id, employee_id, work_date, check_in_at, check_in_location, source, status)
    values (v_emp.company_id, v_emp.id, v_date, now(), public.clean_location(p_location), 'self', 'present')
    on conflict (employee_id, work_date) do update
      set check_in_at = excluded.check_in_at, check_in_location = excluded.check_in_location, status = 'present'
    returning * into v_rec;
  elsif p_action = 'out' then
    if not found or v_rec.check_in_at is null then raise exception 'not_checked_in' using errcode = '22023'; end if;
    if v_rec.check_out_at is not null then raise exception 'already_checked_out' using errcode = '23505'; end if;
    update public.attendance_records
    set check_out_at = now(), check_out_location = public.clean_location(p_location)
    where id = v_rec.id
    returning * into v_rec;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return v_rec;
end $$;

-- ── Leave rules ─────────────────────────────────────────────────────
-- Working days in a range for one employee (weekly offs and company holidays excluded).
create or replace function public.leave_days(p_employee uuid, p_start date, p_end date, p_half boolean)
returns numeric
language sql stable security definer set search_path = public as $$
  with e as (select company_id, weekly_offs from public.employees where id = p_employee),
  d as (
    select g::date as day
    from generate_series(p_start, p_end, interval '1 day') g, e
    where not (extract(dow from g)::smallint = any (e.weekly_offs))
      and not exists (select 1 from public.holidays h where h.company_id = e.company_id and h.holiday_date = g::date)
  )
  select case when p_half then least(count(*), 1) * 0.5 else count(*) end from d;
$$;

create or replace function public.leave_requests_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_type public.leave_types;
  v_hr boolean;
  v_used numeric;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);

  if tg_op = 'UPDATE' then
    if not v_hr then
      -- Employees may only withdraw their own pending request.
      if not (old.status = 'pending' and new.status = 'cancelled')
         or new.start_date <> old.start_date or new.end_date <> old.end_date
         or new.leave_type_id <> old.leave_type_id or new.half_day <> old.half_day then
        raise exception 'only_cancel_pending' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.status <> old.status and new.status in ('approved', 'rejected') then
      if old.status not in ('pending', 'approved') then
        raise exception 'cannot_decide' using errcode = '22023';
      end if;
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
    if new.status = old.status and (new.start_date, new.end_date, new.half_day, new.leave_type_id) = (old.start_date, old.end_date, old.half_day, old.leave_type_id) then
      return new;
    end if;
  else
    if not v_hr and new.status <> 'pending' then
      raise exception 'new_requests_are_pending' using errcode = '42501';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.status = 'approved' then
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  end if;

  select * into v_type from public.leave_types where id = new.leave_type_id;
  if not found or v_type.company_id <> v_emp.company_id or not v_type.is_active then
    raise exception 'invalid_leave_type' using errcode = '22023';
  end if;

  new.days := public.leave_days(new.employee_id, new.start_date, new.end_date, new.half_day);
  if new.days <= 0 then raise exception 'no_working_days' using errcode = '22023'; end if;

  if new.status in ('pending', 'approved') and exists (
    select 1 from public.leave_requests r
    where r.employee_id = new.employee_id and r.id <> new.id and r.status in ('pending', 'approved')
      and r.start_date <= new.end_date and r.end_date >= new.start_date
  ) then
    raise exception 'leave_overlap' using errcode = '23505';
  end if;

  if v_type.annual_quota is not null and new.status in ('pending', 'approved') then
    select coalesce(sum(days), 0) into v_used
    from public.leave_requests r
    where r.employee_id = new.employee_id and r.leave_type_id = new.leave_type_id and r.id <> new.id
      and r.status in ('pending', 'approved')
      and extract(year from r.start_date) = extract(year from new.start_date);
    if v_used + new.days > v_type.annual_quota then
      raise exception 'insufficient_balance' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger leave_requests_before before insert or update on public.leave_requests
  for each row execute function public.leave_requests_before();

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.employees enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_types enable row level security;
alter table public.holidays enable row level security;
alter table public.leave_requests enable row level security;

grant select, insert, update, delete on public.employees, public.attendance_records, public.leave_types, public.holidays, public.leave_requests to authenticated;
grant all on public.employees, public.attendance_records, public.leave_types, public.holidays, public.leave_requests to service_role;

create or replace function public.is_my_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees where id = p_employee and user_id = auth.uid());
$$;

create policy employees_select on public.employees for select to authenticated
  using (public.is_company_hr(company_id) or user_id = auth.uid());
create policy employees_write on public.employees for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy attendance_select on public.attendance_records for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy attendance_write on public.attendance_records for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy leave_types_select on public.leave_types for select to authenticated
  using (public.is_company_member(company_id));
create policy leave_types_write on public.leave_types for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy holidays_select on public.holidays for select to authenticated
  using (public.is_company_member(company_id));
create policy holidays_write on public.holidays for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy leave_select on public.leave_requests for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy leave_insert on public.leave_requests for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy leave_update on public.leave_requests for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));

-- ── Function privileges ─────────────────────────────────────────────
revoke execute on function public.clock_attendance(uuid, text, jsonb) from public, anon;
grant execute on function public.clock_attendance(uuid, text, jsonb) to authenticated, service_role;
revoke execute on function public.seed_hr_defaults(uuid) from public, anon, authenticated;
grant execute on function public.seed_hr_defaults(uuid) to service_role;

-- ===== 0007_lock_anon.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0007 — Defence in depth: the public (anon) key gets no table rights on HR data.
-- Supabase grants anon access to newly created tables by default; RLS already
-- returns no rows, but the grant itself is removed so private tables refuse outright.
-- Also stops future tables created by this role from being auto-granted to anon.
-- ════════════════════════════════════════════════════════════════════
revoke all on public.employees, public.attendance_records, public.leave_types, public.holidays, public.leave_requests from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
