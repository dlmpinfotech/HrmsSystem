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

-- ===== 0008_attendance_intelligence.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0008 — Attendance intelligence + HR command center
--   • Shift templates (incl. overnight), weekly rotations, per-day overrides
--   • Attendance: work mode (office / home / field), breaks, early leave, overtime
--   • Attendance regularization requests (employee asks, HR approves)
--   • Employee: reporting manager, probation and contract end dates
--   • hr_attention(): "Requires attention" queue + per-alert state (assign / snooze / resolve / escalate)
-- Only adds; rows created before this migration keep their meaning
-- (no shift assigned → the employee's own shift_start / shift_end / grace, no break deduction).
-- ════════════════════════════════════════════════════════════════════

-- ── Employees ───────────────────────────────────────────────────────
-- Overnight default shifts (e.g. 22:00–06:00) are now allowed.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.employees'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%shift_end > shift_start%'
  loop
    execute format('alter table public.employees drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.employees add constraint employees_shift_not_empty check (shift_end <> shift_start);

alter table public.employees
  add column reporting_manager_id uuid references public.employees (id) on delete set null,
  add column probation_end_date   date,
  add column contract_end_date    date,
  add column work_location        text check (work_location is null or char_length(work_location) <= 80);
create index employees_manager_idx on public.employees (reporting_manager_id) where reporting_manager_id is not null;

create or replace function public.employees_manager_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reporting_manager_id is not null then
    if new.reporting_manager_id = new.id then raise exception 'invalid_manager' using errcode = '22023'; end if;
    if not exists (select 1 from public.employees m where m.id = new.reporting_manager_id and m.company_id = new.company_id) then
      raise exception 'invalid_manager' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
create trigger employees_manager_check before insert or update of reporting_manager_id on public.employees
  for each row execute function public.employees_manager_check();

-- ── Shift templates ─────────────────────────────────────────────────
create table public.shifts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  name                   text not null check (char_length(name) between 2 and 60),
  code                   text not null check (char_length(code) between 1 and 10),
  start_time             time not null,
  end_time               time not null,           -- earlier than start_time = ends next day
  break_minutes          integer not null default 60 check (break_minutes between 0 and 240),
  grace_minutes          integer not null default 10 check (grace_minutes between 0 and 120),
  early_grace_minutes    integer not null default 10 check (early_grace_minutes between 0 and 120),
  overtime_after_minutes integer not null default 30 check (overtime_after_minutes between 0 and 480),
  color                  text not null default 'primary' check (color in ('primary', 'success', 'warning', 'info', 'danger', 'neutral')),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, code),
  check (end_time <> start_time)
);

-- Weekly rotation: week 1 → shift_ids[1], week 2 → shift_ids[2], … then repeats.
create table public.shift_rotations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 60),
  shift_ids   uuid[] not null check (cardinality(shift_ids) between 1 and 12),
  anchor_date date not null, -- the Monday on which week 1 starts
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (extract(isodow from anchor_date) = 1)
);

create table public.shift_assignments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  employee_id    uuid not null references public.employees (id) on delete cascade,
  shift_id       uuid references public.shifts (id) on delete cascade,
  rotation_id    uuid references public.shift_rotations (id) on delete cascade,
  effective_from date not null,
  effective_to   date,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  check (num_nonnulls(shift_id, rotation_id) = 1),
  check (effective_to is null or effective_to >= effective_from)
);
create index shift_assignments_employee_idx on public.shift_assignments (employee_id, effective_from desc);

-- One-day change for one employee (shift swap, extra day off). shift_id null = day off.
create table public.shift_overrides (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  work_date   date not null,
  shift_id    uuid references public.shifts (id) on delete cascade,
  note        text check (note is null or char_length(note) <= 200),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- Tenant + ownership checks: never trust company_id or foreign ids from the client.
create or replace function public.shift_refs_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  if tg_table_name = 'shift_rotations' then
    if exists (select 1 from unnest(new.shift_ids) s(id) where not exists (select 1 from public.shifts x where x.id = s.id and x.company_id = new.company_id)) then
      raise exception 'invalid_shift' using errcode = '22023';
    end if;
    return new;
  end if;

  select company_id into v_company from public.employees where id = new.employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_company;
  if new.shift_id is not null and not exists (select 1 from public.shifts where id = new.shift_id and company_id = v_company) then
    raise exception 'invalid_shift' using errcode = '22023';
  end if;
  if tg_table_name = 'shift_assignments' then
    if new.rotation_id is not null and not exists (select 1 from public.shift_rotations where id = new.rotation_id and company_id = v_company) then
      raise exception 'invalid_shift' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  return new;
end $$;
create trigger shift_rotations_refs before insert or update on public.shift_rotations for each row execute function public.shift_refs_before();
create trigger shift_assignments_refs before insert or update on public.shift_assignments for each row execute function public.shift_refs_before();
create trigger shift_overrides_refs before insert or update on public.shift_overrides for each row execute function public.shift_refs_before();

-- The shift that applies to one employee on one day:
-- override → latest assignment (fixed shift or rotation week) → the employee's own default shift.
create or replace function public.employee_shift_on(p_employee uuid, p_date date)
returns table (
  shift_id uuid, shift_name text, start_time time, end_time time, break_minutes integer,
  grace_minutes integer, early_grace_minutes integer, overtime_after_minutes integer, is_off boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_sid uuid;
  v_rid uuid;
  v_found boolean := false;
  v_rot public.shift_rotations;
  v_n integer;
  v_week integer;
  v_s public.shifts;
begin
  select * into v_emp from public.employees where id = p_employee;
  if not found then return; end if;
  if auth.uid() is not null and not (public.is_company_hr(v_emp.company_id) or v_emp.user_id = auth.uid()) then return; end if;

  select o.shift_id into v_sid from public.shift_overrides o where o.employee_id = p_employee and o.work_date = p_date;
  v_found := found;
  if v_found and v_sid is null then
    return query select null::uuid, null::text, v_emp.shift_start, v_emp.shift_end, 0, v_emp.grace_minutes, 10, 30, true;
    return;
  end if;

  if not v_found then
    select a.shift_id, a.rotation_id into v_sid, v_rid
    from public.shift_assignments a
    where a.employee_id = p_employee and a.effective_from <= p_date and (a.effective_to is null or a.effective_to >= p_date)
    order by a.effective_from desc, a.created_at desc
    limit 1;
    if v_sid is null and v_rid is not null then
      select * into v_rot from public.shift_rotations where id = v_rid;
      v_n := cardinality(v_rot.shift_ids);
      v_week := floor((p_date - v_rot.anchor_date)::numeric / 7)::integer;
      v_sid := v_rot.shift_ids[((v_week % v_n) + v_n) % v_n + 1];
    end if;
  end if;

  if v_sid is not null then
    select * into v_s from public.shifts where id = v_sid;
    if found then
      return query select v_s.id, v_s.name, v_s.start_time, v_s.end_time, v_s.break_minutes, v_s.grace_minutes, v_s.early_grace_minutes, v_s.overtime_after_minutes, false;
      return;
    end if;
  end if;
  return query select null::uuid, null::text, v_emp.shift_start, v_emp.shift_end, 0, v_emp.grace_minutes, 10, 30, false;
end $$;

-- ── Attendance: work mode, breaks, early leave, overtime ────────────
alter table public.attendance_records drop constraint if exists attendance_records_source_check;
alter table public.attendance_records add constraint attendance_records_source_check check (source in ('self', 'hr', 'regularization'));
alter table public.attendance_records
  add column work_mode        text not null default 'office' check (work_mode in ('office', 'home', 'field')),
  add column shift_id         uuid references public.shifts (id) on delete set null,
  add column scheduled_start  timestamptz,
  add column scheduled_end    timestamptz,
  add column break_minutes    integer not null default 0 check (break_minutes >= 0),
  add column early_minutes    integer not null default 0,
  add column overtime_minutes integer not null default 0,
  add column on_break_since   timestamptz;
create index attendance_open_idx on public.attendance_records (company_id, work_date) where check_out_at is null;

create table public.attendance_breaks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  attendance_id uuid not null references public.attendance_records (id) on delete cascade,
  start_at      timestamptz not null,
  end_at        timestamptz,
  created_at    timestamptz not null default now(),
  check (end_at is null or end_at >= start_at)
);
create index attendance_breaks_attendance_idx on public.attendance_breaks (attendance_id);

-- Recomputes schedule, late, early, worked, overtime from the shift that applies that day.
-- Worked = span − max(breaks taken, scheduled break); the scheduled break is only deducted from spans of 5h+.
create or replace function public.attendance_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_sh record;
  v_off boolean;
  v_sched integer;
  v_span integer;
  v_diff integer;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id; -- never trust a client-supplied tenant

  select * into v_sh from public.employee_shift_on(new.employee_id, new.work_date);
  if v_sh.start_time is null then
    select null::uuid as shift_id, v_emp.shift_start as start_time, v_emp.shift_end as end_time, 0 as break_minutes,
           v_emp.grace_minutes as grace_minutes, 10 as early_grace_minutes, 30 as overtime_after_minutes, false as is_off
    into v_sh;
  end if;
  new.shift_id := v_sh.shift_id;
  new.scheduled_start := (new.work_date + v_sh.start_time) at time zone 'Asia/Kolkata';
  new.scheduled_end := new.scheduled_start
    + case when v_sh.end_time > v_sh.start_time then v_sh.end_time - v_sh.start_time else (v_sh.end_time - v_sh.start_time) + interval '24 hours' end;
  v_sched := floor(extract(epoch from (new.scheduled_end - new.scheduled_start)) / 60) - v_sh.break_minutes;
  v_off := v_sh.is_off
    or extract(dow from new.work_date)::smallint = any (v_emp.weekly_offs)
    or exists (select 1 from public.holidays h where h.company_id = v_emp.company_id and h.holiday_date = new.work_date)
    or new.status in ('holiday', 'weekly_off');

  if new.check_in_at is not null and not v_off then
    v_diff := floor(extract(epoch from (new.check_in_at - new.scheduled_start)) / 60);
    new.late_minutes := case when v_diff > v_sh.grace_minutes then v_diff else 0 end;
  else
    new.late_minutes := 0;
  end if;

  if new.check_in_at is not null and new.check_out_at is not null then
    v_span := floor(extract(epoch from (new.check_out_at - new.check_in_at)) / 60);
    new.work_minutes := greatest(v_span - greatest(new.break_minutes, case when v_span >= 300 then v_sh.break_minutes else 0 end), 0);
    if v_off then
      new.early_minutes := 0;
      new.overtime_minutes := new.work_minutes;
    else
      v_diff := floor(extract(epoch from (new.scheduled_end - new.check_out_at)) / 60);
      new.early_minutes := case when v_diff > v_sh.early_grace_minutes then v_diff else 0 end;
      new.overtime_minutes := case when new.work_minutes - v_sched > v_sh.overtime_after_minutes then new.work_minutes - v_sched else 0 end;
    end if;
    -- Less than four hours on a self-marked day counts as a half day.
    if new.source = 'self' and new.status = 'present' and new.work_minutes < 240 then
      new.status := 'half_day';
    end if;
  else
    new.work_minutes := null;
    new.early_minutes := 0;
    new.overtime_minutes := 0;
  end if;

  if new.source in ('hr', 'regularization') and auth.uid() is not null then
    new.corrected_by := auth.uid();
    new.corrected_at := now();
  end if;
  return new;
end $$;

-- Self check-in / check-out / breaks. Times come from the database clock.
-- Overnight shifts: check-out closes yesterday's open record; check-in up to 2h before a shift
-- that starts after midnight is dated to that shift's day.
drop function if exists public.clock_attendance(uuid, text, jsonb);
create function public.clock_attendance(p_company uuid, p_action text, p_location jsonb default null, p_mode text default null)
returns public.attendance_records
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_rec public.attendance_records;
  v_open public.attendance_records;
  v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_date date;
  v_next record;
begin
  select e.* into v_emp
  from public.employees e join public.profiles p on p.id = e.user_id
  where e.company_id = p_company and e.user_id = auth.uid() and e.status = 'active' and p.is_active;
  if not found then raise exception 'no_employee_record' using errcode = 'P0002'; end if;
  if exists (select 1 from public.companies where id = p_company and status in ('suspended', 'cancelled')) then
    raise exception 'company_inactive' using errcode = '42501';
  end if;
  if p_mode is not null and p_mode not in ('office', 'home', 'field') then
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  -- The record still "open" for this person: checked in, not out, and its shift not long over.
  select * into v_open from public.attendance_records r
  where r.employee_id = v_emp.id and r.check_in_at is not null and r.check_out_at is null
    and (r.work_date >= v_today or (r.work_date = v_today - 1 and v_now < r.scheduled_end + interval '6 hours'))
  order by r.work_date desc
  limit 1
  for update;

  if p_action = 'in' then
    if v_open.id is not null then raise exception 'already_checked_in' using errcode = '23505'; end if;
    v_date := v_today;
    select * into v_next from public.employee_shift_on(v_emp.id, v_today + 1);
    if v_next.start_time is not null and not v_next.is_off
       and v_now >= ((v_today + 1) + v_next.start_time) at time zone 'Asia/Kolkata' - interval '2 hours' then
      v_date := v_today + 1;
    end if;
    select * into v_rec from public.attendance_records where employee_id = v_emp.id and work_date = v_date for update;
    if found and v_rec.check_in_at is not null then raise exception 'already_checked_in' using errcode = '23505'; end if;
    insert into public.attendance_records (company_id, employee_id, work_date, check_in_at, check_in_location, source, status, work_mode)
    values (v_emp.company_id, v_emp.id, v_date, v_now, public.clean_location(p_location), 'self', 'present', coalesce(p_mode, 'office'))
    on conflict (employee_id, work_date) do update
      set check_in_at = excluded.check_in_at, check_in_location = excluded.check_in_location, status = 'present', work_mode = excluded.work_mode
    returning * into v_rec;
    return v_rec;
  end if;

  if v_open.id is null then
    if p_action = 'out' and exists (select 1 from public.attendance_records where employee_id = v_emp.id and work_date = v_today and check_out_at is not null) then
      raise exception 'already_checked_out' using errcode = '23505';
    end if;
    if p_action in ('out', 'break_start', 'break_end') then raise exception 'not_checked_in' using errcode = '22023'; end if;
    raise exception 'invalid_action' using errcode = '22023';
  end if;

  if p_action = 'break_start' then
    if v_open.on_break_since is not null then raise exception 'already_on_break' using errcode = '23505'; end if;
    insert into public.attendance_breaks (company_id, employee_id, attendance_id, start_at) values (v_open.company_id, v_emp.id, v_open.id, v_now);
    update public.attendance_records set on_break_since = v_now where id = v_open.id returning * into v_rec;
  elsif p_action in ('break_end', 'out') then
    if p_action = 'break_end' and v_open.on_break_since is null then raise exception 'not_on_break' using errcode = '22023'; end if;
    update public.attendance_breaks set end_at = v_now where attendance_id = v_open.id and end_at is null;
    update public.attendance_records r
    set on_break_since = null,
        break_minutes = coalesce((select floor(sum(extract(epoch from (b.end_at - b.start_at))) / 60) from public.attendance_breaks b where b.attendance_id = r.id and b.end_at is not null), 0),
        check_out_at = case when p_action = 'out' then v_now else r.check_out_at end,
        check_out_location = case when p_action = 'out' then public.clean_location(p_location) else r.check_out_location end
    where r.id = v_open.id
    returning * into v_rec;
  else
    raise exception 'invalid_action' using errcode = '22023';
  end if;
  return v_rec;
end $$;

-- ── Attendance regularization ───────────────────────────────────────
create table public.attendance_regularizations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  employee_id      uuid not null references public.employees (id) on delete cascade,
  work_date        date not null,
  check_in_time    time not null,
  check_out_time   time,
  out_next_day     boolean not null default false,
  requested_status text not null default 'present' check (requested_status in ('present', 'half_day')),
  work_mode        text not null default 'office' check (work_mode in ('office', 'home', 'field')),
  reason           text not null check (char_length(reason) between 5 and 500),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  decision_note    text check (decision_note is null or char_length(decision_note) <= 500),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index regularizations_one_pending on public.attendance_regularizations (employee_id, work_date) where status = 'pending';
create index regularizations_company_status_idx on public.attendance_regularizations (company_id, status);

create or replace function public.regularizations_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_hr boolean;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);

  if tg_op = 'UPDATE' then
    if not v_hr then
      if not (old.status = 'pending' and new.status = 'cancelled')
         or (new.work_date, new.check_in_time, new.check_out_time, new.out_next_day) is distinct from (old.work_date, old.check_in_time, old.check_out_time, old.out_next_day) then
        raise exception 'only_cancel_pending' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.status <> old.status and new.status in ('approved', 'rejected') then
      if old.status <> 'pending' then raise exception 'cannot_decide' using errcode = '22023'; end if;
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  else
    if not v_hr and new.status <> 'pending' then raise exception 'new_requests_are_pending' using errcode = '42501'; end if;
    -- Employees may correct up to 30 days back; never the future.
    if new.work_date > v_today or (not v_hr and new.work_date < v_today - 30) then
      raise exception 'regularization_window' using errcode = '22023';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;

  if new.check_out_time is not null and not new.out_next_day and new.check_out_time <= new.check_in_time then
    raise exception 'out_before_in' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger regularizations_before before insert or update on public.attendance_regularizations
  for each row execute function public.regularizations_before();

-- Approval writes the attendance record (one row per employee per day — never a duplicate).
create or replace function public.regularizations_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    insert into public.attendance_records (company_id, employee_id, work_date, check_in_at, check_out_at, status, work_mode, source, notes)
    values (
      new.company_id, new.employee_id, new.work_date,
      (new.work_date + new.check_in_time) at time zone 'Asia/Kolkata',
      case when new.check_out_time is not null
        then ((new.work_date + case when new.out_next_day then 1 else 0 end) + new.check_out_time) at time zone 'Asia/Kolkata' end,
      new.requested_status, new.work_mode, 'regularization', left(new.reason, 500)
    )
    on conflict (employee_id, work_date) do update
      set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, status = excluded.status,
          work_mode = excluded.work_mode, source = 'regularization', notes = excluded.notes, on_break_since = null;
  end if;
  return new;
end $$;
create trigger regularizations_apply after insert or update of status on public.attendance_regularizations
  for each row execute function public.regularizations_apply();

-- ── Requires attention ──────────────────────────────────────────────
create table public.hr_alert_states (
  company_id    uuid not null references public.companies (id) on delete cascade,
  alert_key     text not null check (char_length(alert_key) <= 200),
  status        text not null default 'open' check (status in ('open', 'snoozed', 'resolved', 'escalated')),
  snoozed_until date,
  assigned_to   uuid references public.profiles (id) on delete set null,
  note          text check (note is null or char_length(note) <= 500),
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (company_id, alert_key),
  check (status <> 'snoozed' or snoozed_until is not null)
);

create or replace function public.hr_alert_states_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.company_memberships where company_id = new.company_id and user_id = new.assigned_to and role in ('customer_admin', 'hr_manager')
  ) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
create trigger hr_alert_states_before before insert or update on public.hr_alert_states
  for each row execute function public.hr_alert_states_before();

-- Live list of issues for HR. Each row has a stable key so HR can snooze / resolve / assign it.
create or replace function public.hr_attention(p_company uuid)
returns table (
  alert_key text, alert_type text, severity text, employee_id uuid, employee_name text, employee_code text,
  department text, ref_date date, detail jsonb, status text, snoozed_until date, assigned_to uuid, note text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is not null and not public.is_company_hr(p_company) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with emp as (
    select * from public.employees e where e.company_id = p_company
  ),
  raw as (
    -- Checked in but never checked out (2h after the shift ended).
    select 'missing_punch:' || r.id::text as k, 'missing_punch'::text as t,
           case when r.work_date < v_today - 1 then 'high' else 'medium' end as sev,
           r.employee_id as eid, r.work_date as d, jsonb_build_object('check_in_at', r.check_in_at) as det
    from public.attendance_records r
    where r.company_id = p_company and r.check_in_at is not null and r.check_out_at is null
      and r.work_date >= v_today - 30 and now() > coalesce(r.scheduled_end, r.check_in_at + interval '9 hours') + interval '2 hours'

    union all
    -- Working day, shift started more than 30 min ago, no check-in and no approved leave.
    select 'not_checked_in:' || e.id::text || ':' || v_today::text, 'not_checked_in', 'low', e.id, v_today,
           jsonb_build_object('shift_start', s.start_time)
    from emp e
    cross join lateral public.employee_shift_on(e.id, v_today) s
    where e.status = 'active' and (e.date_of_joining is null or e.date_of_joining <= v_today)
      and not s.is_off
      and not (extract(dow from v_today)::smallint = any (e.weekly_offs))
      and not exists (select 1 from public.holidays h where h.company_id = p_company and h.holiday_date = v_today)
      and now() > ((v_today + s.start_time) at time zone 'Asia/Kolkata') + make_interval(mins => s.grace_minutes + 30)
      and not exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = v_today)
      and not exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'approved' and v_today between l.start_date and l.end_date)

    union all
    -- Late three or more times in the last 30 days (one alert per employee per week).
    select 'repeated_late:' || r.employee_id::text || ':' || to_char(v_today, 'IYYY-IW'), 'repeated_late', 'medium', r.employee_id, max(r.work_date),
           jsonb_build_object('count', count(*), 'minutes', sum(r.late_minutes))
    from public.attendance_records r
    where r.company_id = p_company and r.work_date >= v_today - 30 and r.late_minutes > 0
    group by r.employee_id
    having count(*) >= 3

    union all
    -- Worked 2h+ beyond the schedule in the last 7 days.
    select 'overtime:' || r.id::text, 'excess_hours', 'low', r.employee_id, r.work_date,
           jsonb_build_object('overtime_minutes', r.overtime_minutes, 'work_minutes', r.work_minutes)
    from public.attendance_records r
    where r.company_id = p_company and r.work_date >= v_today - 7 and r.overtime_minutes >= 120

    union all
    -- Marked present on a day of approved leave.
    select 'leave_conflict:' || r.id::text, 'leave_conflict', 'medium', r.employee_id, r.work_date,
           jsonb_build_object('leave_id', l.id)
    from public.attendance_records r
    join public.leave_requests l on l.employee_id = r.employee_id and l.status = 'approved' and r.work_date between l.start_date and l.end_date and not l.half_day
    where r.company_id = p_company and r.work_date >= v_today - 30 and r.check_in_at is not null

    union all
    select 'pending_leave:' || l.id::text, 'pending_leave',
           case when l.created_at < now() - interval '3 days' then 'high' when l.created_at < now() - interval '1 day' then 'medium' else 'low' end,
           l.employee_id, l.start_date,
           jsonb_build_object('days', l.days, 'waiting_hours', floor(extract(epoch from (now() - l.created_at)) / 3600))
    from public.leave_requests l
    where l.company_id = p_company and l.status = 'pending'

    union all
    select 'pending_regularization:' || g.id::text, 'pending_regularization',
           case when g.created_at < now() - interval '3 days' then 'high' when g.created_at < now() - interval '1 day' then 'medium' else 'low' end,
           g.employee_id, g.work_date,
           jsonb_build_object('waiting_hours', floor(extract(epoch from (now() - g.created_at)) / 3600))
    from public.attendance_regularizations g
    where g.company_id = p_company and g.status = 'pending'

    union all
    select 'contract_expiry:' || e.id::text || ':' || e.contract_end_date::text, 'contract_expiry',
           case when e.contract_end_date <= v_today + 7 then 'high' else 'medium' end, e.id, e.contract_end_date,
           jsonb_build_object('days_left', e.contract_end_date - v_today)
    from emp e
    where e.status = 'active' and e.contract_end_date between v_today and v_today + 30

    union all
    select 'probation_end:' || e.id::text || ':' || e.probation_end_date::text, 'probation_end',
           case when e.probation_end_date <= v_today + 7 then 'medium' else 'low' end, e.id, e.probation_end_date,
           jsonb_build_object('days_left', e.probation_end_date - v_today)
    from emp e
    where e.status = 'active' and e.probation_end_date between v_today and v_today + 15

    union all
    select 'incomplete_profile:' || e.id::text, 'incomplete_profile', 'low', e.id, coalesce(e.date_of_joining, e.created_at::date),
           jsonb_build_object('missing', to_jsonb(array_remove(array[
             case when e.email is null then 'email' end,
             case when e.phone is null then 'phone' end,
             case when e.date_of_joining is null then 'date_of_joining' end,
             case when e.department is null then 'department' end], null)))
    from emp e
    where e.status = 'active' and (e.email is null or e.phone is null or e.date_of_joining is null or e.department is null)
  )
  select raw.k, raw.t,
         case when st.status = 'escalated' then 'critical' else raw.sev end,
         raw.eid, e.full_name, e.employee_code, e.department, raw.d, raw.det,
         coalesce(st.status, 'open'), st.snoozed_until, st.assigned_to, st.note
  from raw
  join emp e on e.id = raw.eid
  left join public.hr_alert_states st on st.company_id = p_company and st.alert_key = raw.k
  where coalesce(st.status, 'open') <> 'resolved'
    and (coalesce(st.status, 'open') <> 'snoozed' or st.snoozed_until <= v_today)
  order by case when st.status = 'escalated' then 0 when raw.sev = 'high' then 1 when raw.sev = 'medium' then 2 else 3 end, raw.d desc;
end $$;

-- ── Housekeeping triggers ───────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['shifts', 'shift_rotations', 'attendance_regularizations'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['shifts', 'shift_rotations', 'shift_assignments', 'shift_overrides', 'attendance_regularizations'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.shifts enable row level security;
alter table public.shift_rotations enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.shift_overrides enable row level security;
alter table public.attendance_breaks enable row level security;
alter table public.attendance_regularizations enable row level security;
alter table public.hr_alert_states enable row level security;

revoke all on public.shifts, public.shift_rotations, public.shift_assignments, public.shift_overrides,
  public.attendance_breaks, public.attendance_regularizations, public.hr_alert_states from anon;
grant select, insert, update, delete on public.shifts, public.shift_rotations, public.shift_assignments, public.shift_overrides,
  public.attendance_breaks, public.attendance_regularizations, public.hr_alert_states to authenticated;
grant all on public.shifts, public.shift_rotations, public.shift_assignments, public.shift_overrides,
  public.attendance_breaks, public.attendance_regularizations, public.hr_alert_states to service_role;

create policy shifts_select on public.shifts for select to authenticated using (public.is_company_member(company_id));
create policy shifts_write on public.shifts for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy rotations_select on public.shift_rotations for select to authenticated using (public.is_company_member(company_id));
create policy rotations_write on public.shift_rotations for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy assignments_select on public.shift_assignments for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy assignments_write on public.shift_assignments for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy overrides_select on public.shift_overrides for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy overrides_write on public.shift_overrides for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy breaks_select on public.attendance_breaks for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy breaks_write on public.attendance_breaks for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

create policy regularizations_select on public.attendance_regularizations for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy regularizations_insert on public.attendance_regularizations for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy regularizations_update on public.attendance_regularizations for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));

create policy alert_states_all on public.hr_alert_states for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

-- ── Function privileges ─────────────────────────────────────────────
revoke execute on function public.clock_attendance(uuid, text, jsonb, text) from public, anon;
grant execute on function public.clock_attendance(uuid, text, jsonb, text) to authenticated, service_role;
revoke execute on function public.employee_shift_on(uuid, date) from public, anon;
grant execute on function public.employee_shift_on(uuid, date) to authenticated, service_role;
revoke execute on function public.hr_attention(uuid) from public, anon;
grant execute on function public.hr_attention(uuid) to authenticated, service_role;

-- ===== 0009_leave_automation.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0009 — Leave automation
--   • Reporting-manager scope: is_manager_of(); managers see and decide their team's leave
--   • Two-level approval per leave type (manager → HR); one level = manager or HR
--   • Hourly permissions (leave types measured in hours, monthly hour limit)
--   • Monthly accrual and carry-forward of unused days (capped)
--   • Compensatory off: credits earned by working on an off day / holiday, used FIFO, expire
--   • leave_balances() for the UI and team_leave() for the team calendar
-- Only adds. Existing leave types keep "annual quota, no carry-forward, one level",
-- so balances and approvals of existing requests do not change.
-- ════════════════════════════════════════════════════════════════════

-- ── Manager scope ───────────────────────────────────────────────────
create or replace function public.is_manager_of(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.employees e
    join public.employees m on m.id = e.reporting_manager_id
    join public.profiles p on p.id = m.user_id
    where e.id = p_employee and m.user_id = auth.uid() and m.status = 'active' and p.is_active
  );
$$;

-- ── Leave type policy ───────────────────────────────────────────────
alter table public.leave_types
  add column accrual             text not null default 'annual' check (accrual in ('annual', 'monthly')),
  add column carry_forward_max   numeric(5, 1) not null default 0 check (carry_forward_max >= 0),
  add column unit                text not null default 'day' check (unit in ('day', 'hour')),
  add column max_hours_per_month numeric(4, 1) check (max_hours_per_month is null or max_hours_per_month > 0),
  add column approval_levels     smallint not null default 1 check (approval_levels in (1, 2)),
  add column is_comp_off         boolean not null default false;
alter table public.leave_types add constraint leave_types_hour_rules
  check (unit = 'day' or (annual_quota is null and not is_comp_off and carry_forward_max = 0));
alter table public.leave_types add constraint leave_types_comp_off_rules
  check (not is_comp_off or (annual_quota is null and carry_forward_max = 0));

-- ── Compensatory off credits ────────────────────────────────────────
create table public.comp_off_credits (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  work_date     date not null,
  days          numeric(3, 1) not null default 1 check (days in (0.5, 1)),
  reason        text check (reason is null or char_length(reason) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  expires_on    date,
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (expires_on is null or expires_on >= work_date)
);
create unique index comp_off_credits_day_uniq on public.comp_off_credits (employee_id, work_date) where status in ('pending', 'approved');
create index comp_off_credits_company_idx on public.comp_off_credits (company_id, status);

-- ── Leave request columns ───────────────────────────────────────────
alter table public.leave_requests
  add column start_time         time,
  add column end_time           time,
  add column hours              numeric(4, 2),
  add column approval_step      smallint not null default 1 check (approval_step in (1, 2)),
  add column manager_decided_by uuid references public.profiles (id) on delete set null,
  add column manager_decided_at timestamptz,
  add column manager_note       text check (manager_note is null or char_length(manager_note) <= 500),
  add column comp_off_credit_id uuid references public.comp_off_credits (id) on delete set null;
alter table public.leave_requests add constraint leave_requests_hours_rules
  check ((start_time is null) = (end_time is null) and (start_time is null or (start_date = end_date and not half_day and end_time > start_time)));
create unique index leave_requests_credit_uniq on public.leave_requests (comp_off_credit_id)
  where comp_off_credit_id is not null and status in ('pending', 'approved');

-- ── Entitlement: accrual + carry-forward ────────────────────────────
-- Days a person is entitled to for one type in one year, accrued through p_through
-- (null = whole year). Carry-forward = unused days of the previous year, capped.
create or replace function public.leave_entitlement(p_employee uuid, p_type uuid, p_year integer, p_through date default null, p_with_carry boolean default true)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.leave_types;
  v_join date;
  v_first integer;
  v_last integer;
  v_base numeric;
  v_prev numeric;
  v_prev_used numeric;
  v_carry numeric := 0;
begin
  select * into v_t from public.leave_types where id = p_type;
  if not found or v_t.annual_quota is null or v_t.unit <> 'day' or v_t.is_comp_off then return null; end if;
  select date_of_joining into v_join from public.employees where id = p_employee;
  if v_join is not null and extract(year from v_join)::int > p_year then return 0; end if;

  if v_t.accrual = 'monthly' then
    v_first := case when v_join is not null and extract(year from v_join)::int = p_year then extract(month from v_join)::int else 1 end;
    v_last := case
      when p_through is null or extract(year from p_through)::int > p_year then 12
      when extract(year from p_through)::int < p_year then 0
      else extract(month from p_through)::int
    end;
    v_base := floor(v_t.annual_quota * greatest(v_last - v_first + 1, 0) / 12.0 * 2) / 2;
  else
    v_base := v_t.annual_quota;
  end if;

  if p_with_carry and v_t.carry_forward_max > 0 and (v_join is null or extract(year from v_join)::int < p_year) then
    v_prev := coalesce(public.leave_entitlement(p_employee, p_type, p_year - 1, null, false), 0);
    select coalesce(sum(days), 0) into v_prev_used
    from public.leave_requests
    where employee_id = p_employee and leave_type_id = p_type and status = 'approved' and extract(year from start_date)::int = p_year - 1;
    v_carry := least(v_t.carry_forward_max, greatest(v_prev - v_prev_used, 0));
  end if;
  return v_base + v_carry;
end $$;

-- ── Leave request rules (replaces 0006 version) ─────────────────────
create or replace function public.leave_requests_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_type public.leave_types;
  v_hr boolean;
  v_mgr boolean;
  v_used numeric;
  v_ent numeric;
  v_credit uuid;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);
  v_mgr := not v_hr and public.is_manager_of(new.employee_id);
  if not v_hr and not v_mgr and not public.is_my_employee(new.employee_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.employee_id <> old.employee_id then raise exception 'employee cannot change' using errcode = '42501'; end if;
    -- Approval trail is written here only.
    new.approval_step := old.approval_step;
    new.manager_decided_by := old.manager_decided_by;
    new.manager_decided_at := old.manager_decided_at;
    new.manager_note := old.manager_note;

    if not v_hr then
      if (new.start_date, new.end_date, new.half_day, new.leave_type_id) is distinct from (old.start_date, old.end_date, old.half_day, old.leave_type_id)
         or (new.start_time, new.end_time) is distinct from (old.start_time, old.end_time) then
        raise exception 'only_cancel_pending' using errcode = '42501';
      end if;
      new.comp_off_credit_id := old.comp_off_credit_id;

      -- Reporting manager decides step 1.
      if v_mgr and old.status = 'pending' and old.approval_step = 1 and new.status in ('approved', 'rejected') then
        select * into v_type from public.leave_types where id = old.leave_type_id;
        new.manager_decided_by := auth.uid();
        new.manager_decided_at := now();
        new.manager_note := new.decision_note;
        if new.status = 'rejected' then
          new.decided_by := auth.uid();
          new.decided_at := now();
          new.comp_off_credit_id := null;
        elsif v_type.approval_levels >= 2 then
          new.status := 'pending';
          new.approval_step := 2;
          new.decision_note := old.decision_note;
        else
          new.decided_by := auth.uid();
          new.decided_at := now();
        end if;
        return new;
      end if;

      -- Employees may only withdraw their own pending request.
      if not (public.is_my_employee(old.employee_id) and old.status = 'pending' and new.status = 'cancelled') then
        raise exception 'only_cancel_pending' using errcode = '42501';
      end if;
      new.comp_off_credit_id := null;
      return new;
    end if;

    if new.status <> old.status and new.status in ('approved', 'rejected') then
      if old.status not in ('pending', 'approved') then
        raise exception 'cannot_decide' using errcode = '22023';
      end if;
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
    if new.status in ('rejected', 'cancelled') then new.comp_off_credit_id := null; end if;
    if new.status = old.status
       and (new.start_date, new.end_date, new.half_day, new.leave_type_id) = (old.start_date, old.end_date, old.half_day, old.leave_type_id)
       and (new.start_time, new.end_time) is not distinct from (old.start_time, old.end_time) then
      return new;
    end if;
  else
    if not v_hr and new.status <> 'pending' then
      raise exception 'new_requests_are_pending' using errcode = '42501';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.approval_step := 1;
    new.manager_decided_by := null;
    new.manager_decided_at := null;
    new.manager_note := null;
    new.comp_off_credit_id := null;
    if new.status = 'approved' then
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  end if;

  select * into v_type from public.leave_types where id = new.leave_type_id;
  if not found or v_type.company_id <> v_emp.company_id or not v_type.is_active then
    raise exception 'invalid_leave_type' using errcode = '22023';
  end if;

  if v_type.unit = 'hour' then
    if new.start_time is null or new.end_time is null then raise exception 'hours_required' using errcode = '22023'; end if;
    if public.leave_days(new.employee_id, new.start_date, new.start_date, false) <= 0 then
      raise exception 'no_working_days' using errcode = '22023';
    end if;
    new.hours := round((extract(epoch from (new.end_time - new.start_time)) / 3600)::numeric, 2);
    new.days := 0;
  else
    if new.start_time is not null or new.end_time is not null then raise exception 'hours_not_allowed' using errcode = '22023'; end if;
    new.hours := null;
    new.days := public.leave_days(new.employee_id, new.start_date, new.end_date, new.half_day);
    if new.days <= 0 then raise exception 'no_working_days' using errcode = '22023'; end if;
  end if;

  if new.status in ('pending', 'approved') and exists (
    select 1 from public.leave_requests r
    where r.employee_id = new.employee_id and r.id <> new.id and r.status in ('pending', 'approved')
      and r.start_date <= new.end_date and r.end_date >= new.start_date
      and not (r.hours is not null and new.hours is not null and (r.end_time <= new.start_time or r.start_time >= new.end_time))
  ) then
    raise exception 'leave_overlap' using errcode = '23505';
  end if;

  if new.status in ('pending', 'approved') then
    if v_type.unit = 'hour' then
      if v_type.max_hours_per_month is not null then
        select coalesce(sum(hours), 0) into v_used
        from public.leave_requests r
        where r.employee_id = new.employee_id and r.leave_type_id = new.leave_type_id and r.id <> new.id
          and r.status in ('pending', 'approved') and date_trunc('month', r.start_date) = date_trunc('month', new.start_date);
        if v_used + new.hours > v_type.max_hours_per_month then
          raise exception 'insufficient_balance' using errcode = '23514';
        end if;
      end if;
    elsif v_type.is_comp_off then
      if new.start_date <> new.end_date then raise exception 'comp_off_single_day' using errcode = '22023'; end if;
      if new.comp_off_credit_id is null then
        select c.id into v_credit
        from public.comp_off_credits c
        where c.employee_id = new.employee_id and c.status = 'approved' and c.expires_on >= new.start_date and c.days >= new.days
          and not exists (select 1 from public.leave_requests r where r.comp_off_credit_id = c.id and r.id <> new.id and r.status in ('pending', 'approved'))
        order by (c.days = new.days) desc, c.expires_on, c.work_date
        limit 1
        for update;
        if v_credit is null then raise exception 'insufficient_balance' using errcode = '23514'; end if;
        new.comp_off_credit_id := v_credit;
      end if;
    elsif v_type.annual_quota is not null then
      v_ent := public.leave_entitlement(new.employee_id, new.leave_type_id, extract(year from new.start_date)::int, new.start_date, true);
      select coalesce(sum(days), 0) into v_used
      from public.leave_requests r
      where r.employee_id = new.employee_id and r.leave_type_id = new.leave_type_id and r.id <> new.id
        and r.status in ('pending', 'approved')
        and extract(year from r.start_date) = extract(year from new.start_date);
      if v_used + new.days > v_ent then
        raise exception 'insufficient_balance' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end $$;

-- ── Comp-off credit rules ───────────────────────────────────────────
create or replace function public.comp_off_credits_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_hr boolean;
  v_mgr boolean;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);
  v_mgr := not v_hr and public.is_manager_of(new.employee_id);
  -- Refuse outsiders before any check that could reveal another person's data.
  if not v_hr and not v_mgr and not public.is_my_employee(new.employee_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if not v_hr then
      if new.status <> 'pending' then raise exception 'new_requests_are_pending' using errcode = '42501'; end if;
      if new.work_date > v_today then raise exception 'future_date' using errcode = '22023'; end if;
      if public.leave_days(new.employee_id, new.work_date, new.work_date, false) > 0 then
        raise exception 'not_an_off_day' using errcode = '22023';
      end if;
      if not exists (select 1 from public.attendance_records a where a.employee_id = new.employee_id and a.work_date = new.work_date and a.check_in_at is not null) then
        raise exception 'no_attendance_on_day' using errcode = '22023';
      end if;
      new.expires_on := new.work_date + 90;
      new.decided_by := null;
      new.decided_at := null;
    else
      new.expires_on := coalesce(new.expires_on, new.work_date + 90);
      if new.status in ('approved', 'rejected') then
        new.decided_by := coalesce(auth.uid(), new.decided_by);
        new.decided_at := now();
      end if;
    end if;
    return new;
  end if;

  if new.employee_id <> old.employee_id then raise exception 'employee cannot change' using errcode = '42501'; end if;
  if not v_hr then
    if (new.work_date, new.days, new.expires_on) is distinct from (old.work_date, old.days, old.expires_on) then
      raise exception 'only_cancel_pending' using errcode = '42501';
    end if;
    if v_mgr and old.status = 'pending' and new.status in ('approved', 'rejected') then
      new.decided_by := auth.uid();
      new.decided_at := now();
      return new;
    end if;
    if not (public.is_my_employee(old.employee_id) and old.status = 'pending' and new.status = 'cancelled') then
      raise exception 'only_cancel_pending' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status <> old.status and new.status in ('approved', 'rejected') then
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
  end if;
  if old.status = 'approved' and new.status <> 'approved'
     and exists (select 1 from public.leave_requests r where r.comp_off_credit_id = old.id and r.status in ('pending', 'approved')) then
    raise exception 'credit_in_use' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger comp_off_credits_before before insert or update on public.comp_off_credits
  for each row execute function public.comp_off_credits_before();
create trigger comp_off_credits_set_updated_at before update on public.comp_off_credits
  for each row execute function public.set_updated_at();
create trigger comp_off_credits_audit after insert or update or delete on public.comp_off_credits
  for each row execute function public.audit_row_change();

-- ── Balances for the UI ─────────────────────────────────────────────
create or replace function public.leave_balances(p_employee uuid, p_year integer)
returns table (
  leave_type_id uuid, unit text, is_comp_off boolean, entitled numeric, carried numeric,
  used numeric, pending numeric, available numeric, hours_used_month numeric, hours_limit numeric
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_through date;
  t public.leave_types;
  v_ent numeric;
  v_base numeric;
  v_used numeric;
  v_pending numeric;
begin
  select * into v_emp from public.employees where id = p_employee;
  if not found then return; end if;
  if auth.uid() is not null and not (public.is_company_hr(v_emp.company_id) or v_emp.user_id = auth.uid() or public.is_manager_of(p_employee)) then
    return;
  end if;
  v_through := case when p_year = extract(year from v_today)::int then v_today else make_date(p_year, 12, 31) end;

  for t in select * from public.leave_types where company_id = v_emp.company_id and is_active order by sort_order, name loop
    leave_type_id := t.id;
    unit := t.unit;
    is_comp_off := t.is_comp_off;
    hours_used_month := null;
    hours_limit := null;
    entitled := null;
    carried := 0;
    if t.unit = 'hour' then
      select coalesce(sum(hours), 0) into v_used from public.leave_requests r
      where r.employee_id = p_employee and r.leave_type_id = t.id and r.status in ('pending', 'approved')
        and date_trunc('month', r.start_date) = date_trunc('month', v_today);
      used := 0; pending := 0;
      hours_used_month := v_used;
      hours_limit := t.max_hours_per_month;
      available := case when t.max_hours_per_month is null then null else greatest(t.max_hours_per_month - v_used, 0) end;
    else
      select coalesce(sum(days) filter (where status = 'approved'), 0), coalesce(sum(days) filter (where status = 'pending'), 0)
        into v_used, v_pending
      from public.leave_requests r
      where r.employee_id = p_employee and r.leave_type_id = t.id and extract(year from r.start_date)::int = p_year;
      used := v_used;
      pending := v_pending;
      if t.is_comp_off then
        select coalesce(sum(c.days), 0) into available
        from public.comp_off_credits c
        where c.employee_id = p_employee and c.status = 'approved' and c.expires_on >= v_today
          and not exists (select 1 from public.leave_requests r where r.comp_off_credit_id = c.id and r.status in ('pending', 'approved'));
        entitled := available + v_used + v_pending;
      elsif t.annual_quota is null then
        available := null;
      else
        v_ent := public.leave_entitlement(p_employee, t.id, p_year, v_through, true);
        v_base := public.leave_entitlement(p_employee, t.id, p_year, v_through, false);
        entitled := v_ent;
        carried := v_ent - v_base;
        available := greatest(v_ent - v_used - v_pending, 0);
      end if;
    end if;
    return next;
  end loop;
end $$;

-- ── Team calendar ───────────────────────────────────────────────────
-- HR: everyone. Others: their department, manager, team-mates and reports.
-- Returns no reasons or notes — just who is away and when.
create or replace function public.team_leave(p_company uuid, p_from date, p_to date)
returns table (
  request_id uuid, employee_id uuid, full_name text, department text, leave_code text, leave_name text,
  start_date date, end_date date, half_day boolean, start_time time, end_time time, status text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hr boolean := public.is_company_hr(p_company);
  v_me public.employees;
begin
  if p_to < p_from or p_to - p_from > 62 then raise exception 'range_too_long' using errcode = '22023'; end if;
  if not public.is_company_member(p_company) then return; end if;
  if not v_hr then
    select * into v_me from public.employees x where x.company_id = p_company and x.user_id = auth.uid() and x.status = 'active';
    if not found then return; end if;
  end if;
  return query
    select r.id, e.id, e.full_name, e.department, t.code, t.name, r.start_date, r.end_date, r.half_day, r.start_time, r.end_time, r.status
    from public.leave_requests r
    join public.employees e on e.id = r.employee_id
    join public.leave_types t on t.id = r.leave_type_id
    where r.company_id = p_company and r.status in ('pending', 'approved')
      and r.start_date <= p_to and r.end_date >= p_from
      and (
        v_hr
        or e.id = v_me.id
        or e.reporting_manager_id = v_me.id
        or e.id = v_me.reporting_manager_id
        or (v_me.reporting_manager_id is not null and e.reporting_manager_id = v_me.reporting_manager_id)
        or (v_me.department is not null and e.department = v_me.department)
      )
    order by r.start_date, e.full_name
    limit 2000;
end $$;

-- ── Default types: Comp-off and Permission ──────────────────────────
create or replace function public.seed_hr_defaults(p_company uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.leave_types (company_id, name, code, annual_quota, is_paid, sort_order) values
    (p_company, 'Casual Leave', 'CL', 12, true, 1),
    (p_company, 'Sick Leave',   'SL', 12, true, 2),
    (p_company, 'Earned Leave', 'EL', 15, true, 3),
    (p_company, 'Loss of Pay',  'LOP', null, false, 4)
  on conflict (company_id, code) do nothing;
  insert into public.leave_types (company_id, name, code, annual_quota, is_paid, sort_order, is_comp_off) values
    (p_company, 'Compensatory Off', 'CO', null, true, 5, true)
  on conflict (company_id, code) do nothing;
  insert into public.leave_types (company_id, name, code, annual_quota, is_paid, sort_order, unit, max_hours_per_month) values
    (p_company, 'Permission', 'PER', null, true, 6, 'hour', 4)
  on conflict (company_id, code) do nothing;
$$;
select public.seed_hr_defaults(id) from public.companies;

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.comp_off_credits enable row level security;
revoke all on public.comp_off_credits from anon;
grant select, insert, update, delete on public.comp_off_credits to authenticated;
grant all on public.comp_off_credits to service_role;

create policy comp_off_select on public.comp_off_credits for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id) or public.is_manager_of(employee_id));
create policy comp_off_insert on public.comp_off_credits for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy comp_off_update on public.comp_off_credits for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id) or public.is_manager_of(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id) or public.is_manager_of(employee_id));
create policy comp_off_delete on public.comp_off_credits for delete to authenticated
  using (public.is_company_hr(company_id));

-- Managers read their team's records and decide their leave (never insert or delete).
create policy employees_select_manager on public.employees for select to authenticated
  using (public.is_manager_of(id));
create policy attendance_select_manager on public.attendance_records for select to authenticated
  using (public.is_manager_of(employee_id));
create policy leave_select_manager on public.leave_requests for select to authenticated
  using (public.is_manager_of(employee_id));
create policy leave_update_manager on public.leave_requests for update to authenticated
  using (public.is_manager_of(employee_id)) with check (public.is_manager_of(employee_id));

-- ── Function privileges ─────────────────────────────────────────────
revoke execute on function public.leave_entitlement(uuid, uuid, integer, date, boolean) from public, anon, authenticated;
grant execute on function public.leave_entitlement(uuid, uuid, integer, date, boolean) to service_role;
revoke execute on function public.is_manager_of(uuid) from public, anon;
grant execute on function public.is_manager_of(uuid) to authenticated, service_role;
revoke execute on function public.leave_balances(uuid, integer) from public, anon;
grant execute on function public.leave_balances(uuid, integer) to authenticated, service_role;
revoke execute on function public.team_leave(uuid, date, date) from public, anon;
grant execute on function public.team_leave(uuid, date, date) to authenticated, service_role;

-- ===== 0010_employee_email_relink.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0010 — Changing an employee's email moves their login link
-- Before: an employee stayed linked to the old login after HR corrected the
-- email (e.g. a record typed with the HR person's own email stayed tied to
-- the HR person's account). Now a changed email clears the link, and
-- employees_before() links the login that matches the new email, if any.
-- Runs before employees_before (triggers fire in name order).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.employees_email_relink() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, ''))
     and new.user_id is not distinct from old.user_id then
    new.user_id := null;
  end if;
  return new;
end $$;

create trigger employees_a_email_relink before update of email on public.employees
  for each row execute function public.employees_email_relink();

-- ===== 0011_payroll.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0011 — Payroll
--   • payroll_settings: PF / ESI / Tamil Nadu professional tax rules per company
--   • salary_structures: monthly components per employee, dated (latest one wins)
--   • payroll_runs + payslips: one run per company per month
--   • generate_payroll(): LOP from attendance + leave, pro-rated earnings,
--     PF (wage ceiling), ESI (wage limit), PT (half-yearly slabs), TDS
--   • finalize / reopen; employees see only their finalized payslips
-- Runs and payslips are written only by these functions (no direct writes).
-- ════════════════════════════════════════════════════════════════════

create table public.payroll_settings (
  company_id         uuid primary key references public.companies (id) on delete cascade,
  pf_enabled         boolean not null default true,
  pf_employee_rate   numeric(5, 2) not null default 12 check (pf_employee_rate between 0 and 20),
  pf_employer_rate   numeric(5, 2) not null default 12 check (pf_employer_rate between 0 and 20),
  pf_wage_ceiling    numeric(10, 2) not null default 15000 check (pf_wage_ceiling > 0),
  pf_cap_at_ceiling  boolean not null default true,
  esi_enabled        boolean not null default true,
  esi_employee_rate  numeric(5, 2) not null default 0.75 check (esi_employee_rate between 0 and 10),
  esi_employer_rate  numeric(5, 2) not null default 3.25 check (esi_employer_rate between 0 and 10),
  esi_wage_limit     numeric(10, 2) not null default 21000 check (esi_wage_limit > 0),
  pt_enabled         boolean not null default true,
  pt_frequency       text not null default 'half_yearly' check (pt_frequency in ('half_yearly', 'monthly')),
  -- Half-yearly income slabs → tax for the half year ("upto": null = and above). Tamil Nadu (2024 revision).
  pt_slabs           jsonb not null default '[{"upto":21000,"tax":0},{"upto":30000,"tax":180},{"upto":45000,"tax":425},{"upto":60000,"tax":930},{"upto":75000,"tax":1025},{"upto":null,"tax":1250}]'::jsonb
                     check (jsonb_typeof(pt_slabs) = 'array'),
  updated_by         uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now()
);

create table public.salary_structures (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  effective_from    date not null,
  basic             numeric(12, 2) not null check (basic >= 0),
  hra               numeric(12, 2) not null default 0 check (hra >= 0),
  conveyance        numeric(12, 2) not null default 0 check (conveyance >= 0),
  special_allowance numeric(12, 2) not null default 0 check (special_allowance >= 0),
  other_allowance   numeric(12, 2) not null default 0 check (other_allowance >= 0),
  other_deduction   numeric(12, 2) not null default 0 check (other_deduction >= 0),
  tds_monthly       numeric(12, 2) not null default 0 check (tds_monthly >= 0),
  pf_applicable     boolean not null default true,
  esi_applicable    boolean not null default true,
  pt_applicable     boolean not null default true,
  note              text check (note is null or char_length(note) <= 300),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (employee_id, effective_from)
);
create index salary_structures_company_idx on public.salary_structures (company_id);

create table public.payroll_runs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  period              date not null check (extract(day from period) = 1),
  status              text not null default 'draft' check (status in ('draft', 'finalized')),
  employee_count      integer not null default 0,
  total_gross         numeric(14, 2) not null default 0,
  total_deductions    numeric(14, 2) not null default 0,
  total_net           numeric(14, 2) not null default 0,
  total_employer_cost numeric(14, 2) not null default 0,
  generated_at        timestamptz,
  generated_by        uuid references public.profiles (id) on delete set null,
  finalized_at        timestamptz,
  finalized_by        uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, period)
);

create table public.payslips (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.payroll_runs (id) on delete cascade,
  company_id        uuid not null references public.companies (id) on delete cascade,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  period            date not null,
  employee_code     text not null,
  employee_name     text not null,
  department        text,
  designation       text,
  days_in_month     integer not null,
  paid_days         numeric(4, 1) not null,
  lop_days          numeric(4, 1) not null,
  basic             numeric(12, 2) not null default 0,
  hra               numeric(12, 2) not null default 0,
  conveyance        numeric(12, 2) not null default 0,
  special_allowance numeric(12, 2) not null default 0,
  other_allowance   numeric(12, 2) not null default 0,
  gross             numeric(12, 2) not null default 0,
  pf_employee       numeric(12, 2) not null default 0,
  esi_employee      numeric(12, 2) not null default 0,
  professional_tax  numeric(12, 2) not null default 0,
  tds               numeric(12, 2) not null default 0,
  other_deduction   numeric(12, 2) not null default 0,
  total_deductions  numeric(12, 2) not null default 0,
  net_pay           numeric(12, 2) not null default 0,
  pf_employer       numeric(12, 2) not null default 0,
  esi_employer      numeric(12, 2) not null default 0,
  emailed_at        timestamptz,
  email_error       text,
  created_at        timestamptz not null default now(),
  unique (run_id, employee_id)
);
create index payslips_employee_idx on public.payslips (employee_id, period desc);

-- ── Structure rules ─────────────────────────────────────────────────
create or replace function public.salary_structures_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.employees where id = new.employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_company;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  return new;
end $$;
create trigger salary_structures_before before insert or update on public.salary_structures
  for each row execute function public.salary_structures_before();

create or replace function public.payroll_settings_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
create trigger payroll_settings_before before insert or update on public.payroll_settings
  for each row execute function public.payroll_settings_before();

do $$
declare t text;
begin
  foreach t in array array['salary_structures', 'payroll_runs'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['salary_structures', 'payroll_settings', 'payroll_runs'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ── Professional tax ────────────────────────────────────────────────
create or replace function public.pt_for_half_year(p_slabs jsonb, p_income numeric) returns numeric
language sql immutable as $$
  select coalesce((
    select (s ->> 'tax')::numeric
    from jsonb_array_elements(p_slabs) with ordinality as x(s, n)
    where s ->> 'upto' is null or p_income <= (s ->> 'upto')::numeric
    order by n
    limit 1
  ), 0);
$$;

-- ── Loss of pay ─────────────────────────────────────────────────────
-- Unpaid days in [p_start, p_end]: absent working days, half days (0.5), unpaid leave,
-- and days before joining / after exit. Future days count as paid.
create or replace function public.payroll_lop_days(p_employee uuid, p_start date, p_end date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_lop numeric := 0;
  d date;
  v_att text;
  v_found boolean;
  v_lv_half boolean;
  v_lv_paid boolean;
  v_lv_found boolean;
  v_off boolean;
begin
  select * into v_emp from public.employees where id = p_employee;
  if not found then return 0; end if;
  for d in select g::date from generate_series(p_start, p_end, interval '1 day') g loop
    if (v_emp.date_of_joining is not null and d < v_emp.date_of_joining) or (v_emp.exit_date is not null and d > v_emp.exit_date) then
      v_lop := v_lop + 1;
      continue;
    end if;

    select a.status into v_att from public.attendance_records a where a.employee_id = p_employee and a.work_date = d;
    v_found := found;
    select r.half_day, t.is_paid into v_lv_half, v_lv_paid
    from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
    where r.employee_id = p_employee and r.status = 'approved' and t.unit = 'day' and d between r.start_date and r.end_date
    order by t.is_paid, r.half_day
    limit 1;
    v_lv_found := found;

    if v_found then
      if v_att = 'half_day' then v_lop := v_lop + 0.5;
      elsif v_att = 'absent' then v_lop := v_lop + 1;
      elsif v_att = 'on_leave' and v_lv_found and not v_lv_paid then v_lop := v_lop + case when v_lv_half then 0.5 else 1 end;
      end if;
      continue;
    end if;

    if v_lv_found then
      if not v_lv_paid then v_lop := v_lop + case when v_lv_half then 0.5 else 1 end;
      elsif v_lv_half and d <= v_today then v_lop := v_lop + 0.5; -- other half of the day not worked
      end if;
      continue;
    end if;

    v_off := exists (select 1 from public.holidays h where h.company_id = v_emp.company_id and h.holiday_date = d)
      or exists (select 1 from public.shift_overrides o where o.employee_id = p_employee and o.work_date = d and o.shift_id is null)
      or (extract(dow from d)::smallint = any (v_emp.weekly_offs)
          and not exists (select 1 from public.shift_overrides o where o.employee_id = p_employee and o.work_date = d and o.shift_id is not null));
    if v_off or d > v_today then continue; end if;
    v_lop := v_lop + 1;
  end loop;
  return v_lop;
end $$;

-- ── Generate (or regenerate) a month ────────────────────────────────
create or replace function public.generate_payroll(p_company uuid, p_period date)
returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_period)::date;
  v_end date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_dim integer;
  v_set public.payroll_settings;
  v_run public.payroll_runs;
  e public.employees;
  s public.salary_structures;
  v_lop numeric;
  v_paid numeric;
  f numeric;
  v_basic numeric; v_hra numeric; v_conv numeric; v_special numeric; v_other numeric; v_gross numeric;
  v_full numeric; v_pf_wage numeric; v_pf numeric; v_pf_er numeric; v_esi numeric; v_esi_er numeric; v_pt numeric; v_tax numeric; v_ded numeric;
begin
  if auth.uid() is not null and not public.is_company_hr(p_company) then raise exception 'not_allowed' using errcode = '42501'; end if;
  v_dim := extract(day from v_end)::int;
  insert into public.payroll_settings (company_id) values (p_company) on conflict (company_id) do nothing;
  select * into v_set from public.payroll_settings where company_id = p_company;
  insert into public.payroll_runs (company_id, period) values (p_company, v_start) on conflict (company_id, period) do nothing;
  select * into v_run from public.payroll_runs where company_id = p_company and period = v_start for update;
  if v_run.status = 'finalized' then raise exception 'payroll_finalized' using errcode = '22023'; end if;

  delete from public.payslips where run_id = v_run.id;

  for e in
    select * from public.employees
    where company_id = p_company and status in ('active', 'exited')
      and (date_of_joining is null or date_of_joining <= v_end)
      and (exit_date is null or exit_date >= v_start)
    order by employee_code
  loop
    select * into s from public.salary_structures where employee_id = e.id and effective_from <= v_end order by effective_from desc limit 1;
    continue when not found;

    v_lop := least(public.payroll_lop_days(e.id, v_start, v_end), v_dim);
    v_paid := v_dim - v_lop;
    f := v_paid / v_dim;
    v_basic := round(s.basic * f);
    v_hra := round(s.hra * f);
    v_conv := round(s.conveyance * f);
    v_special := round(s.special_allowance * f);
    v_other := round(s.other_allowance * f);
    v_gross := v_basic + v_hra + v_conv + v_special + v_other;
    v_full := s.basic + s.hra + s.conveyance + s.special_allowance + s.other_allowance;

    v_pf := 0; v_pf_er := 0;
    if v_set.pf_enabled and s.pf_applicable then
      v_pf_wage := case when v_set.pf_cap_at_ceiling then least(v_basic, v_set.pf_wage_ceiling) else v_basic end;
      v_pf := round(v_pf_wage * v_set.pf_employee_rate / 100);
      v_pf_er := round(v_pf_wage * v_set.pf_employer_rate / 100);
    end if;

    v_esi := 0; v_esi_er := 0;
    if v_set.esi_enabled and s.esi_applicable and v_full <= v_set.esi_wage_limit and v_gross > 0 then
      v_esi := ceil(v_gross * v_set.esi_employee_rate / 100);
      v_esi_er := ceil(v_gross * v_set.esi_employer_rate / 100);
    end if;

    v_pt := 0;
    if v_set.pt_enabled and s.pt_applicable and v_gross > 0 then
      v_tax := public.pt_for_half_year(v_set.pt_slabs, v_full * 6);
      v_pt := case
        when v_set.pt_frequency = 'monthly' then round(v_tax / 6)
        when extract(month from v_start) in (3, 9) then v_tax
        else 0
      end;
    end if;

    v_ded := v_pf + v_esi + v_pt + s.tds_monthly + s.other_deduction;
    insert into public.payslips (
      run_id, company_id, employee_id, period, employee_code, employee_name, department, designation,
      days_in_month, paid_days, lop_days, basic, hra, conveyance, special_allowance, other_allowance, gross,
      pf_employee, esi_employee, professional_tax, tds, other_deduction, total_deductions, net_pay, pf_employer, esi_employer
    ) values (
      v_run.id, p_company, e.id, v_start, e.employee_code, e.full_name, e.department, e.designation,
      v_dim, v_paid, v_lop, v_basic, v_hra, v_conv, v_special, v_other, v_gross,
      v_pf, v_esi, v_pt, s.tds_monthly, s.other_deduction, v_ded, greatest(v_gross - v_ded, 0), v_pf_er, v_esi_er
    );
  end loop;

  update public.payroll_runs r set
    employee_count = x.n, total_gross = x.gross, total_deductions = x.ded, total_net = x.net, total_employer_cost = x.cost,
    generated_at = now(), generated_by = auth.uid()
  from (
    select count(*) n, coalesce(sum(gross), 0) gross, coalesce(sum(total_deductions), 0) ded, coalesce(sum(net_pay), 0) net,
           coalesce(sum(gross + pf_employer + esi_employer), 0) cost
    from public.payslips where run_id = v_run.id
  ) x
  where r.id = v_run.id
  returning r.* into v_run;
  return v_run;
end $$;

create or replace function public.set_payroll_status(p_run uuid, p_status text)
returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare v_run public.payroll_runs;
begin
  select * into v_run from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'payroll_not_found' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.is_company_hr(v_run.company_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_status = 'finalized' then
    if v_run.status <> 'draft' or v_run.generated_at is null then raise exception 'payroll_not_ready' using errcode = '22023'; end if;
    if v_run.employee_count = 0 then raise exception 'payroll_empty' using errcode = '22023'; end if;
    update public.payroll_runs set status = 'finalized', finalized_at = now(), finalized_by = auth.uid() where id = p_run returning * into v_run;
  elsif p_status = 'draft' then
    -- Reopening is for corrections; only a Company Admin may undo a finalized month.
    if auth.uid() is not null and public.company_role(v_run.company_id) <> 'customer_admin' then raise exception 'not_allowed' using errcode = '42501'; end if;
    update public.payroll_runs set status = 'draft', finalized_at = null, finalized_by = null where id = p_run returning * into v_run;
  else
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  return v_run;
end $$;

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.payroll_settings enable row level security;
alter table public.salary_structures enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payslips enable row level security;

revoke all on public.payroll_settings, public.salary_structures, public.payroll_runs, public.payslips from anon;
grant select, insert, update on public.payroll_settings to authenticated;
grant select, insert, update, delete on public.salary_structures to authenticated;
grant select on public.payroll_runs, public.payslips to authenticated;
grant all on public.payroll_settings, public.salary_structures, public.payroll_runs, public.payslips to service_role;

create policy payroll_settings_hr on public.payroll_settings for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy salary_structures_hr on public.salary_structures for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy salary_structures_own on public.salary_structures for select to authenticated
  using (public.is_my_employee(employee_id));
create policy payroll_runs_hr on public.payroll_runs for select to authenticated
  using (public.is_company_hr(company_id));
-- Employees cannot read payroll_runs, so the run's status is checked by a definer helper.
create or replace function public.is_finalized_run(p_run uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payroll_runs where id = p_run and status = 'finalized');
$$;
create policy payslips_select on public.payslips for select to authenticated
  using (public.is_company_hr(company_id) or (public.is_my_employee(employee_id) and public.is_finalized_run(run_id)));

-- ── Function privileges ─────────────────────────────────────────────
revoke execute on function public.payroll_lop_days(uuid, date, date) from public, anon, authenticated;
grant execute on function public.payroll_lop_days(uuid, date, date) to service_role;
revoke execute on function public.is_finalized_run(uuid) from public, anon;
grant execute on function public.is_finalized_run(uuid) to authenticated, service_role;
revoke execute on function public.generate_payroll(uuid, date) from public, anon;
grant execute on function public.generate_payroll(uuid, date) to authenticated, service_role;
revoke execute on function public.set_payroll_status(uuid, text) from public, anon;
grant execute on function public.set_payroll_status(uuid, text) to authenticated, service_role;

-- ===== 0012_leave_encashment.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0012 — Leave encashment + approval reminder templates
--   • Leave types can be encashable (with a yearly cap)
--   • leave_encashments: employee asks, HR approves; the amount is fixed at
--     approval from the salary in force (basic or gross ÷ 26 or 30 per day)
--   • Encashed days reduce the year's balance (leave_entitlement / leave_balances)
--   • generate_payroll() pays approved encashments in the next payroll
--     (earnings, not subject to PF or ESI)
--   • Email templates for HR approval reminders and escalations
-- ════════════════════════════════════════════════════════════════════

alter table public.leave_types
  add column encashable       boolean not null default false,
  add column max_encash_days  numeric(5, 1) check (max_encash_days is null or max_encash_days > 0);
alter table public.leave_types add constraint leave_types_encash_rules
  check (not encashable or (unit = 'day' and annual_quota is not null and not is_comp_off));

alter table public.payroll_settings
  add column encash_basis   text not null default 'basic' check (encash_basis in ('basic', 'gross')),
  add column encash_divisor integer not null default 26 check (encash_divisor in (26, 30));

create table public.leave_encashments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  leave_type_id uuid not null references public.leave_types (id) on delete restrict,
  year          integer not null check (year between 2000 and 2100),
  days          numeric(5, 1) not null check (days > 0 and days * 2 = floor(days * 2)),
  amount        numeric(12, 2),
  per_day       numeric(12, 2),
  reason        text check (reason is null or char_length(reason) <= 500),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  paid_run_id   uuid references public.payroll_runs (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index leave_encashments_company_idx on public.leave_encashments (company_id, status);
create index leave_encashments_employee_idx on public.leave_encashments (employee_id, leave_type_id, year);

alter table public.payslips add column leave_encashment numeric(12, 2) not null default 0;

-- ── Encashed days ───────────────────────────────────────────────────
create or replace function public.encashed_days(p_employee uuid, p_type uuid, p_year integer, p_exclude uuid default null)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(days), 0) from public.leave_encashments
  where employee_id = p_employee and leave_type_id = p_type and year = p_year and status in ('pending', 'approved')
    and (p_exclude is null or id <> p_exclude);
$$;

-- Entitlement now net of encashed days (replaces 0009). Carry-forward also
-- ignores days that were encashed last year.
create or replace function public.leave_entitlement(p_employee uuid, p_type uuid, p_year integer, p_through date default null, p_with_carry boolean default true)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_t public.leave_types;
  v_join date;
  v_first integer;
  v_last integer;
  v_base numeric;
  v_prev numeric;
  v_prev_used numeric;
  v_carry numeric := 0;
begin
  select * into v_t from public.leave_types where id = p_type;
  if not found or v_t.annual_quota is null or v_t.unit <> 'day' or v_t.is_comp_off then return null; end if;
  select date_of_joining into v_join from public.employees where id = p_employee;
  if v_join is not null and extract(year from v_join)::int > p_year then return 0; end if;

  if v_t.accrual = 'monthly' then
    v_first := case when v_join is not null and extract(year from v_join)::int = p_year then extract(month from v_join)::int else 1 end;
    v_last := case
      when p_through is null or extract(year from p_through)::int > p_year then 12
      when extract(year from p_through)::int < p_year then 0
      else extract(month from p_through)::int
    end;
    v_base := floor(v_t.annual_quota * greatest(v_last - v_first + 1, 0) / 12.0 * 2) / 2;
  else
    v_base := v_t.annual_quota;
  end if;

  if not p_with_carry then return v_base; end if;

  if v_t.carry_forward_max > 0 and (v_join is null or extract(year from v_join)::int < p_year) then
    v_prev := coalesce(public.leave_entitlement(p_employee, p_type, p_year - 1, null, false), 0);
    select coalesce(sum(days), 0) into v_prev_used
    from public.leave_requests
    where employee_id = p_employee and leave_type_id = p_type and status = 'approved' and extract(year from start_date)::int = p_year - 1;
    v_prev_used := v_prev_used + public.encashed_days(p_employee, p_type, p_year - 1);
    v_carry := least(v_t.carry_forward_max, greatest(v_prev - v_prev_used, 0));
  end if;
  return v_base + v_carry - public.encashed_days(p_employee, p_type, p_year);
end $$;

-- leave_balances gains an "encashed" column (return type change → drop + create).
drop function if exists public.leave_balances(uuid, integer);
create function public.leave_balances(p_employee uuid, p_year integer)
returns table (
  leave_type_id uuid, unit text, is_comp_off boolean, entitled numeric, carried numeric, encashed numeric,
  used numeric, pending numeric, available numeric, hours_used_month numeric, hours_limit numeric, encashable boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_through date;
  t public.leave_types;
  v_net numeric;
  v_base numeric;
  v_used numeric;
  v_pending numeric;
  v_enc numeric;
begin
  select * into v_emp from public.employees where id = p_employee;
  if not found then return; end if;
  if auth.uid() is not null and not (public.is_company_hr(v_emp.company_id) or v_emp.user_id = auth.uid() or public.is_manager_of(p_employee)) then
    return;
  end if;
  v_through := case when p_year = extract(year from v_today)::int then v_today else make_date(p_year, 12, 31) end;

  for t in select * from public.leave_types x where x.company_id = v_emp.company_id and x.is_active order by x.sort_order, x.name loop
    leave_type_id := t.id;
    unit := t.unit;
    is_comp_off := t.is_comp_off;
    encashable := t.encashable;
    hours_used_month := null;
    hours_limit := null;
    entitled := null;
    carried := 0;
    encashed := 0;
    if t.unit = 'hour' then
      select coalesce(sum(r.hours), 0) into v_used from public.leave_requests r
      where r.employee_id = p_employee and r.leave_type_id = t.id and r.status in ('pending', 'approved')
        and date_trunc('month', r.start_date) = date_trunc('month', v_today);
      used := 0; pending := 0;
      hours_used_month := v_used;
      hours_limit := t.max_hours_per_month;
      available := case when t.max_hours_per_month is null then null else greatest(t.max_hours_per_month - v_used, 0) end;
    else
      select coalesce(sum(r.days) filter (where r.status = 'approved'), 0), coalesce(sum(r.days) filter (where r.status = 'pending'), 0)
        into v_used, v_pending
      from public.leave_requests r
      where r.employee_id = p_employee and r.leave_type_id = t.id and extract(year from r.start_date)::int = p_year;
      used := v_used;
      pending := v_pending;
      if t.is_comp_off then
        select coalesce(sum(c.days), 0) into available
        from public.comp_off_credits c
        where c.employee_id = p_employee and c.status = 'approved' and c.expires_on >= v_today
          and not exists (select 1 from public.leave_requests r where r.comp_off_credit_id = c.id and r.status in ('pending', 'approved'));
        entitled := available + v_used + v_pending;
      elsif t.annual_quota is null then
        available := null;
      else
        v_net := public.leave_entitlement(p_employee, t.id, p_year, v_through, true);
        v_base := public.leave_entitlement(p_employee, t.id, p_year, v_through, false);
        v_enc := public.encashed_days(p_employee, t.id, p_year);
        encashed := v_enc;
        entitled := v_net + v_enc;
        carried := v_net + v_enc - v_base;
        available := greatest(v_net - v_used - v_pending, 0);
      end if;
    end if;
    return next;
  end loop;
end $$;

-- ── Encashment rules ────────────────────────────────────────────────
create or replace function public.leave_encashments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_type public.leave_types;
  v_hr boolean;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_avail numeric;
  v_used numeric;
  v_set public.payroll_settings;
  s public.salary_structures;
  v_base numeric;
begin
  select * into v_emp from public.employees where id = new.employee_id;
  if not found then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_emp.company_id;
  v_hr := auth.uid() is null or public.is_company_hr(v_emp.company_id);
  if not v_hr and not public.is_my_employee(new.employee_id) then raise exception 'not_allowed' using errcode = '42501'; end if;

  if tg_op = 'UPDATE' then
    if (new.employee_id, new.leave_type_id, new.year) is distinct from (old.employee_id, old.leave_type_id, old.year) then
      raise exception 'only_cancel_pending' using errcode = '42501';
    end if;
    if old.paid_run_id is not null and new.status <> old.status then raise exception 'encashment_paid' using errcode = '22023'; end if;
    if not v_hr then
      if not (old.status = 'pending' and new.status = 'cancelled' and new.days = old.days) then raise exception 'only_cancel_pending' using errcode = '42501'; end if;
      return new;
    end if;
    if new.status = old.status and new.days = old.days then return new; end if;
    if new.status <> old.status and new.status in ('approved', 'rejected') then
      if old.status <> 'pending' then raise exception 'cannot_decide' using errcode = '22023'; end if;
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.paid_run_id := null;
    new.amount := null;
    new.per_day := null;
    if not v_hr and new.status <> 'pending' then raise exception 'new_requests_are_pending' using errcode = '42501'; end if;
    if new.year is null then new.year := extract(year from v_today)::int; end if;
    if new.status = 'approved' then
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
  end if;

  select * into v_type from public.leave_types where id = new.leave_type_id;
  if not found or v_type.company_id <> v_emp.company_id or not v_type.encashable or not v_type.is_active then
    raise exception 'not_encashable' using errcode = '22023';
  end if;

  if new.status in ('pending', 'approved') then
    if v_type.max_encash_days is not null and public.encashed_days(new.employee_id, new.leave_type_id, new.year, new.id) + new.days > v_type.max_encash_days then
      raise exception 'encash_limit' using errcode = '23514';
    end if;
    -- Balance for the year, ignoring this row (it is not yet saved, or it is being changed).
    v_avail := public.leave_entitlement(new.employee_id, new.leave_type_id, new.year, case when new.year = extract(year from v_today)::int then v_today else make_date(new.year, 12, 31) end, true)
             + case when tg_op = 'UPDATE' and old.status in ('pending', 'approved') then old.days else 0 end;
    select coalesce(sum(days), 0) into v_used from public.leave_requests
    where employee_id = new.employee_id and leave_type_id = new.leave_type_id and status in ('pending', 'approved')
      and extract(year from start_date)::int = new.year;
    if v_used + new.days > v_avail then raise exception 'insufficient_balance' using errcode = '23514'; end if;
  end if;

  -- Fix the amount when approved, from the salary in force today.
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved' or new.days <> old.days) then
    insert into public.payroll_settings (company_id) values (v_emp.company_id) on conflict (company_id) do nothing;
    select * into v_set from public.payroll_settings where company_id = v_emp.company_id;
    select * into s from public.salary_structures where employee_id = new.employee_id and effective_from <= v_today order by effective_from desc limit 1;
    if not found then raise exception 'no_salary_structure' using errcode = '22023'; end if;
    v_base := case when v_set.encash_basis = 'gross' then s.basic + s.hra + s.conveyance + s.special_allowance + s.other_allowance else s.basic end;
    new.per_day := round(v_base / v_set.encash_divisor, 2);
    new.amount := round(new.per_day * new.days);
  elsif new.status <> 'approved' then
    new.amount := null;
    new.per_day := null;
  end if;
  return new;
end $$;
create trigger leave_encashments_before before insert or update on public.leave_encashments
  for each row execute function public.leave_encashments_before();
create trigger leave_encashments_set_updated_at before update on public.leave_encashments
  for each row execute function public.set_updated_at();
create trigger leave_encashments_audit after insert or update or delete on public.leave_encashments
  for each row execute function public.audit_row_change();

-- ── Payroll pays approved encashments (replaces 0011 version) ───────
create or replace function public.generate_payroll(p_company uuid, p_period date)
returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_period)::date;
  v_end date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_dim integer;
  v_set public.payroll_settings;
  v_run public.payroll_runs;
  e public.employees;
  s public.salary_structures;
  v_lop numeric;
  v_paid numeric;
  f numeric;
  v_basic numeric; v_hra numeric; v_conv numeric; v_special numeric; v_other numeric; v_gross numeric; v_enc numeric; v_wages numeric;
  v_full numeric; v_pf_wage numeric; v_pf numeric; v_pf_er numeric; v_esi numeric; v_esi_er numeric; v_pt numeric; v_tax numeric; v_ded numeric;
begin
  if auth.uid() is not null and not public.is_company_hr(p_company) then raise exception 'not_allowed' using errcode = '42501'; end if;
  v_dim := extract(day from v_end)::int;
  insert into public.payroll_settings (company_id) values (p_company) on conflict (company_id) do nothing;
  select * into v_set from public.payroll_settings where company_id = p_company;
  insert into public.payroll_runs (company_id, period) values (p_company, v_start) on conflict (company_id, period) do nothing;
  select * into v_run from public.payroll_runs where company_id = p_company and period = v_start for update;
  if v_run.status = 'finalized' then raise exception 'payroll_finalized' using errcode = '22023'; end if;

  delete from public.payslips where run_id = v_run.id;
  -- Encashments attached to this (draft) run are released and picked up again below.
  update public.leave_encashments set paid_run_id = null where paid_run_id = v_run.id;

  for e in
    select * from public.employees
    where company_id = p_company and status in ('active', 'exited')
      and (date_of_joining is null or date_of_joining <= v_end)
      and (exit_date is null or exit_date >= v_start)
    order by employee_code
  loop
    select * into s from public.salary_structures where employee_id = e.id and effective_from <= v_end order by effective_from desc limit 1;
    continue when not found;

    v_lop := least(public.payroll_lop_days(e.id, v_start, v_end), v_dim);
    v_paid := v_dim - v_lop;
    f := v_paid / v_dim;
    v_basic := round(s.basic * f);
    v_hra := round(s.hra * f);
    v_conv := round(s.conveyance * f);
    v_special := round(s.special_allowance * f);
    v_other := round(s.other_allowance * f);
    v_wages := v_basic + v_hra + v_conv + v_special + v_other;
    v_full := s.basic + s.hra + s.conveyance + s.special_allowance + s.other_allowance;

    update public.leave_encashments set paid_run_id = v_run.id
    where employee_id = e.id and status = 'approved' and paid_run_id is null and decided_at < (v_end + 1)::timestamp at time zone 'Asia/Kolkata';
    select coalesce(sum(amount), 0) into v_enc from public.leave_encashments where employee_id = e.id and paid_run_id = v_run.id;
    v_gross := v_wages + v_enc;

    v_pf := 0; v_pf_er := 0;
    if v_set.pf_enabled and s.pf_applicable then
      v_pf_wage := case when v_set.pf_cap_at_ceiling then least(v_basic, v_set.pf_wage_ceiling) else v_basic end;
      v_pf := round(v_pf_wage * v_set.pf_employee_rate / 100);
      v_pf_er := round(v_pf_wage * v_set.pf_employer_rate / 100);
    end if;

    -- Leave encashment is not ESI wages.
    v_esi := 0; v_esi_er := 0;
    if v_set.esi_enabled and s.esi_applicable and v_full <= v_set.esi_wage_limit and v_wages > 0 then
      v_esi := ceil(v_wages * v_set.esi_employee_rate / 100);
      v_esi_er := ceil(v_wages * v_set.esi_employer_rate / 100);
    end if;

    v_pt := 0;
    if v_set.pt_enabled and s.pt_applicable and v_wages > 0 then
      v_tax := public.pt_for_half_year(v_set.pt_slabs, v_full * 6);
      v_pt := case
        when v_set.pt_frequency = 'monthly' then round(v_tax / 6)
        when extract(month from v_start) in (3, 9) then v_tax
        else 0
      end;
    end if;

    v_ded := v_pf + v_esi + v_pt + s.tds_monthly + s.other_deduction;
    insert into public.payslips (
      run_id, company_id, employee_id, period, employee_code, employee_name, department, designation,
      days_in_month, paid_days, lop_days, basic, hra, conveyance, special_allowance, other_allowance, leave_encashment, gross,
      pf_employee, esi_employee, professional_tax, tds, other_deduction, total_deductions, net_pay, pf_employer, esi_employer
    ) values (
      v_run.id, p_company, e.id, v_start, e.employee_code, e.full_name, e.department, e.designation,
      v_dim, v_paid, v_lop, v_basic, v_hra, v_conv, v_special, v_other, v_enc, v_gross,
      v_pf, v_esi, v_pt, s.tds_monthly, s.other_deduction, v_ded, greatest(v_gross - v_ded, 0), v_pf_er, v_esi_er
    );
  end loop;

  update public.payroll_runs r set
    employee_count = x.n, total_gross = x.gross, total_deductions = x.ded, total_net = x.net, total_employer_cost = x.cost,
    generated_at = now(), generated_by = auth.uid()
  from (
    select count(*) n, coalesce(sum(gross), 0) gross, coalesce(sum(total_deductions), 0) ded, coalesce(sum(net_pay), 0) net,
           coalesce(sum(gross + pf_employer + esi_employer), 0) cost
    from public.payslips where run_id = v_run.id
  ) x
  where r.id = v_run.id
  returning r.* into v_run;
  return v_run;
end $$;

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.leave_encashments enable row level security;
revoke all on public.leave_encashments from anon;
grant select, insert, update on public.leave_encashments to authenticated;
grant all on public.leave_encashments to service_role;

create policy encash_select on public.leave_encashments for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy encash_insert on public.leave_encashments for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy encash_update on public.leave_encashments for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));

revoke execute on function public.encashed_days(uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.encashed_days(uuid, uuid, integer, uuid) to service_role;
revoke execute on function public.leave_balances(uuid, integer) from public, anon;
grant execute on function public.leave_balances(uuid, integer) to authenticated, service_role;

-- ── Reminder / escalation email templates ───────────────────────────
insert into public.notification_templates (key, channel, language, name, subject, body, variables) values
  ('hr_pending_digest', 'email', 'en', 'Approvals waiting',
   '{{count}} requests are waiting for your approval — {{company}}',
   E'Hi {{name}},\n\nThese requests at {{company}} are waiting for a decision:\n\n{{items}}\n\nReview them here: {{url}}\n\nRegards,\n{{brand}}',
   '{name,count,company,items,url,brand}'),
  ('hr_pending_digest', 'email', 'ta', 'ஒப்புதலுக்குக் காத்திருப்பவை',
   '{{count}} கோரிக்கைகள் உங்கள் ஒப்புதலுக்குக் காத்திருக்கின்றன — {{company}}',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்தின் இந்தக் கோரிக்கைகள் முடிவுக்குக் காத்திருக்கின்றன:\n\n{{items}}\n\nஇங்கே பார்க்கவும்: {{url}}\n\nநன்றி,\n{{brand}}',
   '{name,count,company,items,url,brand}'),
  ('approval_escalation', 'email', 'en', 'Approval overdue',
   'Overdue: {{count}} requests have waited more than {{hours}} hours — {{company}}',
   E'Hi {{name}},\n\nThese requests at {{company}} have waited more than {{hours}} hours without a decision:\n\n{{items}}\n\nPlease review them or ask the approver to: {{url}}\n\nRegards,\n{{brand}}',
   '{name,count,hours,company,items,url,brand}'),
  ('approval_escalation', 'email', 'ta', 'ஒப்புதல் தாமதம்',
   'தாமதம்: {{count}} கோரிக்கைகள் {{hours}} மணி நேரத்துக்கு மேல் காத்திருக்கின்றன — {{company}}',
   E'வணக்கம் {{name}},\n\n{{company}} நிறுவனத்தின் இந்தக் கோரிக்கைகள் {{hours}} மணி நேரத்துக்கு மேல் முடிவின்றிக் காத்திருக்கின்றன:\n\n{{items}}\n\nதயவுசெய்து பார்க்கவும் அல்லது ஒப்புதல் அளிப்பவரிடம் கேட்கவும்: {{url}}\n\nநன்றி,\n{{brand}}',
   '{name,count,hours,company,items,url,brand}')
on conflict (key, channel, language) do nothing;

-- ===== 0013_payroll_today.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0013 — Payroll: today is not absent until the day ends
-- Replaces payroll_lop_days() from 0011. Running payroll before a day was
-- over counted that day as loss of pay (no check-in yet). Only completed days
-- can now be absent; today and future days count as paid unless HR has
-- recorded them (absent / half day) or they are unpaid leave.
-- Recalculate any draft payroll after running this.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.payroll_lop_days(p_employee uuid, p_start date, p_end date) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp public.employees;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_lop numeric := 0;
  d date;
  v_att text;
  v_found boolean;
  v_lv_half boolean;
  v_lv_paid boolean;
  v_lv_found boolean;
  v_off boolean;
begin
  select * into v_emp from public.employees where id = p_employee;
  if not found then return 0; end if;
  for d in select g::date from generate_series(p_start, p_end, interval '1 day') g loop
    if (v_emp.date_of_joining is not null and d < v_emp.date_of_joining) or (v_emp.exit_date is not null and d > v_emp.exit_date) then
      v_lop := v_lop + 1;
      continue;
    end if;

    select a.status into v_att from public.attendance_records a where a.employee_id = p_employee and a.work_date = d;
    v_found := found;
    select r.half_day, t.is_paid into v_lv_half, v_lv_paid
    from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
    where r.employee_id = p_employee and r.status = 'approved' and t.unit = 'day' and d between r.start_date and r.end_date
    order by t.is_paid, r.half_day
    limit 1;
    v_lv_found := found;

    if v_found then
      if v_att = 'half_day' then v_lop := v_lop + 0.5;
      elsif v_att = 'absent' then v_lop := v_lop + 1;
      elsif v_att = 'on_leave' and v_lv_found and not v_lv_paid then v_lop := v_lop + case when v_lv_half then 0.5 else 1 end;
      end if;
      continue;
    end if;

    if v_lv_found then
      if not v_lv_paid then v_lop := v_lop + case when v_lv_half then 0.5 else 1 end;
      elsif v_lv_half and d < v_today then v_lop := v_lop + 0.5; -- other half of the day not worked
      end if;
      continue;
    end if;

    v_off := exists (select 1 from public.holidays h where h.company_id = v_emp.company_id and h.holiday_date = d)
      or exists (select 1 from public.shift_overrides o where o.employee_id = p_employee and o.work_date = d and o.shift_id is null)
      or (extract(dow from d)::smallint = any (v_emp.weekly_offs)
          and not exists (select 1 from public.shift_overrides o where o.employee_id = p_employee and o.work_date = d and o.shift_id is not null));
    if v_off or d >= v_today then continue; end if; -- today is not over yet
    v_lop := v_lop + 1;
  end loop;
  return v_lop;
end $$;

-- ===== 0014_employee_documents.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0014 — Employee documents
--   • Private storage bucket "employee-documents" (PDF / images, 5 MB)
--     path: <company_id>/<employee_id>/<random>-<file name>
--   • employee_documents: category, expiry, versions, HR approval
--     (employee uploads wait for HR; HR uploads are approved at once)
--   • Only the company's HR and the employee themself can see them
--   • hr_attention() also reports expiring documents and uploads to review
-- ════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-documents', 'employee-documents', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table public.employee_documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  employee_id   uuid not null references public.employees (id) on delete cascade,
  category      text not null check (category in ('id_proof', 'address_proof', 'offer_letter', 'contract', 'certificate', 'bank', 'medical', 'other')),
  title         text not null check (char_length(title) between 2 and 120),
  file_path     text not null unique check (char_length(file_path) <= 400),
  file_name     text not null check (char_length(file_name) between 1 and 200),
  mime_type     text not null check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  file_size     integer not null check (file_size > 0 and file_size <= 5242880),
  expires_on    date,
  version       integer not null default 1,
  replaces_id   uuid references public.employee_documents (id) on delete set null,
  is_current    boolean not null default true,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index employee_documents_employee_idx on public.employee_documents (employee_id, category);
create index employee_documents_company_idx on public.employee_documents (company_id, status, expires_on);

create or replace function public.employee_documents_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_hr boolean;
  v_old public.employee_documents;
begin
  select company_id into v_company from public.employees where id = new.employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  v_hr := auth.uid() is null or public.is_company_hr(v_company);
  if not v_hr and not public.is_my_employee(new.employee_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  new.company_id := v_company;

  if tg_op = 'INSERT' then
    -- The file must sit in this employee's own folder, so a row can never point at someone else's file.
    if new.file_path not like v_company::text || '/' || new.employee_id::text || '/%' or new.file_path like '%..%' then
      raise exception 'invalid_file_path' using errcode = '22023';
    end if;
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    new.version := 1;
    new.is_current := true;
    if new.replaces_id is not null then
      select * into v_old from public.employee_documents where id = new.replaces_id;
      if not found or v_old.employee_id <> new.employee_id then raise exception 'invalid_replacement' using errcode = '22023'; end if;
      new.version := v_old.version + 1;
      new.category := v_old.category;
    end if;
    if not v_hr then
      new.status := 'pending';
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := null;
    else
      new.status := 'approved';
      new.decided_by := coalesce(auth.uid(), new.decided_by);
      new.decided_at := now();
    end if;
    return new;
  end if;

  if not v_hr then raise exception 'not_allowed' using errcode = '42501'; end if;
  if (new.employee_id, new.file_path, new.version, new.replaces_id) is distinct from (old.employee_id, old.file_path, old.version, old.replaces_id) then
    raise exception 'document_file_fixed' using errcode = '22023';
  end if;
  if new.status <> old.status and new.status in ('approved', 'rejected') then
    new.decided_by := coalesce(auth.uid(), new.decided_by);
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger employee_documents_before before insert or update on public.employee_documents
  for each row execute function public.employee_documents_before();

-- A newer version takes over only once it is approved.
create or replace function public.employee_documents_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and new.replaces_id is not null and (tg_op = 'INSERT' or old.status <> 'approved') then
    update public.employee_documents set is_current = false where id = new.replaces_id;
  end if;
  return null;
end $$;
create trigger employee_documents_after after insert or update of status on public.employee_documents
  for each row execute function public.employee_documents_after();
create trigger employee_documents_set_updated_at before update on public.employee_documents
  for each row execute function public.set_updated_at();
create trigger employee_documents_audit after insert or update or delete on public.employee_documents
  for each row execute function public.audit_row_change();

alter table public.employee_documents enable row level security;
revoke all on public.employee_documents from anon;
grant select, insert, update, delete on public.employee_documents to authenticated;
grant all on public.employee_documents to service_role;

create policy documents_select on public.employee_documents for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy documents_insert on public.employee_documents for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy documents_update on public.employee_documents for update to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy documents_delete on public.employee_documents for delete to authenticated
  using (public.is_company_hr(company_id) or (public.is_my_employee(employee_id) and status <> 'approved'));

-- ── Storage access ──────────────────────────────────────────────────
-- Second folder of the object name = employee id.
create or replace function public.storage_employee_id(p_name text) returns uuid
language sql immutable as $$
  select case
    when split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 2)::uuid
  end;
$$;

-- The caller may use a file when they are HR of the company in the path, or the employee in the path
-- (and the employee really belongs to that company).
create or replace function public.can_access_employee_file(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.id = public.storage_employee_id(p_name) and e.company_id = public.storage_company_id(p_name)
      and (public.is_company_hr(e.company_id) or e.user_id = auth.uid())
  );
$$;

create policy employee_files_select on storage.objects for select to authenticated
  using (bucket_id = 'employee-documents' and public.can_access_employee_file(name));
create policy employee_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents' and public.can_access_employee_file(name));
-- HR can remove files; an employee only one that is not an approved document.
create policy employee_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-documents' and public.can_access_employee_file(name)
         and (public.is_company_hr(public.storage_company_id(name))
              or not exists (select 1 from public.employee_documents d where d.file_path = name and d.status = 'approved')));

revoke execute on function public.can_access_employee_file(text) from public, anon;
grant execute on function public.can_access_employee_file(text) to authenticated, service_role;

-- ── Requires attention: documents (replaces hr_attention from 0008) ──
create or replace function public.hr_attention(p_company uuid)
returns table (
  alert_key text, alert_type text, severity text, employee_id uuid, employee_name text, employee_code text,
  department text, ref_date date, detail jsonb, status text, snoozed_until date, assigned_to uuid, note text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is not null and not public.is_company_hr(p_company) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with emp as (
    select * from public.employees e where e.company_id = p_company
  ),
  raw as (
    -- Checked in but never checked out (2h after the shift ended).
    select 'missing_punch:' || r.id::text as k, 'missing_punch'::text as t,
           case when r.work_date < v_today - 1 then 'high' else 'medium' end as sev,
           r.employee_id as eid, r.work_date as d, jsonb_build_object('check_in_at', r.check_in_at) as det
    from public.attendance_records r
    where r.company_id = p_company and r.check_in_at is not null and r.check_out_at is null
      and r.work_date >= v_today - 30 and now() > coalesce(r.scheduled_end, r.check_in_at + interval '9 hours') + interval '2 hours'

    union all
    -- Working day, shift started more than 30 min ago, no check-in and no approved leave.
    select 'not_checked_in:' || e.id::text || ':' || v_today::text, 'not_checked_in', 'low', e.id, v_today,
           jsonb_build_object('shift_start', s.start_time)
    from emp e
    cross join lateral public.employee_shift_on(e.id, v_today) s
    where e.status = 'active' and (e.date_of_joining is null or e.date_of_joining <= v_today)
      and not s.is_off
      and not (extract(dow from v_today)::smallint = any (e.weekly_offs))
      and not exists (select 1 from public.holidays h where h.company_id = p_company and h.holiday_date = v_today)
      and now() > ((v_today + s.start_time) at time zone 'Asia/Kolkata') + make_interval(mins => s.grace_minutes + 30)
      and not exists (select 1 from public.attendance_records r where r.employee_id = e.id and r.work_date = v_today)
      and not exists (select 1 from public.leave_requests l where l.employee_id = e.id and l.status = 'approved' and v_today between l.start_date and l.end_date)

    union all
    -- Late three or more times in the last 30 days (one alert per employee per week).
    select 'repeated_late:' || r.employee_id::text || ':' || to_char(v_today, 'IYYY-IW'), 'repeated_late', 'medium', r.employee_id, max(r.work_date),
           jsonb_build_object('count', count(*), 'minutes', sum(r.late_minutes))
    from public.attendance_records r
    where r.company_id = p_company and r.work_date >= v_today - 30 and r.late_minutes > 0
    group by r.employee_id
    having count(*) >= 3

    union all
    -- Worked 2h+ beyond the schedule in the last 7 days.
    select 'overtime:' || r.id::text, 'excess_hours', 'low', r.employee_id, r.work_date,
           jsonb_build_object('overtime_minutes', r.overtime_minutes, 'work_minutes', r.work_minutes)
    from public.attendance_records r
    where r.company_id = p_company and r.work_date >= v_today - 7 and r.overtime_minutes >= 120

    union all
    -- Marked present on a day of approved leave.
    select 'leave_conflict:' || r.id::text, 'leave_conflict', 'medium', r.employee_id, r.work_date,
           jsonb_build_object('leave_id', l.id)
    from public.attendance_records r
    join public.leave_requests l on l.employee_id = r.employee_id and l.status = 'approved' and r.work_date between l.start_date and l.end_date and not l.half_day
    where r.company_id = p_company and r.work_date >= v_today - 30 and r.check_in_at is not null

    union all
    select 'pending_leave:' || l.id::text, 'pending_leave',
           case when l.created_at < now() - interval '3 days' then 'high' when l.created_at < now() - interval '1 day' then 'medium' else 'low' end,
           l.employee_id, l.start_date,
           jsonb_build_object('days', l.days, 'waiting_hours', floor(extract(epoch from (now() - l.created_at)) / 3600))
    from public.leave_requests l
    where l.company_id = p_company and l.status = 'pending'

    union all
    select 'pending_regularization:' || g.id::text, 'pending_regularization',
           case when g.created_at < now() - interval '3 days' then 'high' when g.created_at < now() - interval '1 day' then 'medium' else 'low' end,
           g.employee_id, g.work_date,
           jsonb_build_object('waiting_hours', floor(extract(epoch from (now() - g.created_at)) / 3600))
    from public.attendance_regularizations g
    where g.company_id = p_company and g.status = 'pending'

    union all
    select 'contract_expiry:' || e.id::text || ':' || e.contract_end_date::text, 'contract_expiry',
           case when e.contract_end_date <= v_today + 7 then 'high' else 'medium' end, e.id, e.contract_end_date,
           jsonb_build_object('days_left', e.contract_end_date - v_today)
    from emp e
    where e.status = 'active' and e.contract_end_date between v_today and v_today + 30

    union all
    select 'probation_end:' || e.id::text || ':' || e.probation_end_date::text, 'probation_end',
           case when e.probation_end_date <= v_today + 7 then 'medium' else 'low' end, e.id, e.probation_end_date,
           jsonb_build_object('days_left', e.probation_end_date - v_today)
    from emp e
    where e.status = 'active' and e.probation_end_date between v_today and v_today + 15

    union all
    -- Approved documents that expired in the last 30 days or expire within 30.
    select 'document_expiry:' || d.id::text, 'document_expiry',
           case when d.expires_on < v_today then 'high' when d.expires_on <= v_today + 7 then 'medium' else 'low' end,
           d.employee_id, d.expires_on,
           jsonb_build_object('title', d.title, 'days_left', d.expires_on - v_today)
    from public.employee_documents d
    where d.company_id = p_company and d.is_current and d.status = 'approved' and d.expires_on between v_today - 30 and v_today + 30

    union all
    select 'pending_document:' || d.id::text, 'pending_document',
           case when d.created_at < now() - interval '3 days' then 'medium' else 'low' end,
           d.employee_id, (d.created_at at time zone 'Asia/Kolkata')::date,
           jsonb_build_object('title', d.title)
    from public.employee_documents d
    where d.company_id = p_company and d.status = 'pending'

    union all
    select 'incomplete_profile:' || e.id::text, 'incomplete_profile', 'low', e.id, coalesce(e.date_of_joining, e.created_at::date),
           jsonb_build_object('missing', to_jsonb(array_remove(array[
             case when e.email is null then 'email' end,
             case when e.phone is null then 'phone' end,
             case when e.date_of_joining is null then 'date_of_joining' end,
             case when e.department is null then 'department' end], null)))
    from emp e
    where e.status = 'active' and (e.email is null or e.phone is null or e.date_of_joining is null or e.department is null)
  )
  select raw.k, raw.t,
         case when st.status = 'escalated' then 'critical' else raw.sev end,
         raw.eid, e.full_name, e.employee_code, e.department, raw.d, raw.det,
         coalesce(st.status, 'open'), st.snoozed_until, st.assigned_to, st.note
  from raw
  join emp e on e.id = raw.eid
  left join public.hr_alert_states st on st.company_id = p_company and st.alert_key = raw.k
  where coalesce(st.status, 'open') <> 'resolved'
    and (coalesce(st.status, 'open') <> 'snoozed' or st.snoozed_until <= v_today)
  order by case when st.status = 'escalated' then 0 when raw.sev = 'high' then 1 when raw.sev = 'medium' then 2 else 3 end, raw.d desc;
end $$;

-- ===== 0015_hr_helpdesk.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0015 — HR helpdesk and staff help articles
--   • hr_tickets: an employee asks HR (payroll, leave, grievance, …);
--     answer-by time from priority; HR assigns and resolves
--   • hr_ticket_messages: conversation; HR can add internal notes
--   • hr_articles: the company's own policy / how-to articles for staff
-- Separate from support_tickets, which goes to the software vendor.
-- Only the employee and their company's HR see a ticket.
-- ════════════════════════════════════════════════════════════════════

create sequence if not exists public.hr_ticket_number_seq;

create table public.hr_tickets (
  id                uuid primary key default gen_random_uuid(),
  ticket_no         bigint not null default nextval('public.hr_ticket_number_seq'),
  company_id        uuid not null references public.companies (id) on delete cascade,
  employee_id       uuid not null references public.employees (id) on delete cascade,
  category          text not null check (category in ('payroll', 'leave', 'attendance', 'policy', 'it', 'grievance', 'other')),
  subject           text not null check (char_length(subject) between 3 and 150),
  priority          text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status            text not null default 'open' check (status in ('open', 'waiting_employee', 'resolved', 'closed')),
  assigned_to       uuid references public.profiles (id) on delete set null,
  due_at            timestamptz,
  first_response_at timestamptz,
  resolved_at       timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index hr_tickets_company_idx on public.hr_tickets (company_id, status, due_at);
create index hr_tickets_employee_idx on public.hr_tickets (employee_id, created_at desc);

create table public.hr_ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.hr_tickets (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  from_hr    boolean not null default false,
  internal   boolean not null default false,
  body       text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index hr_ticket_messages_ticket_idx on public.hr_ticket_messages (ticket_id, created_at);

create table public.hr_articles (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title      text not null check (char_length(title) between 3 and 150),
  body       text not null check (char_length(body) between 1 and 20000),
  category   text not null default 'policy' check (category in ('payroll', 'leave', 'attendance', 'policy', 'it', 'other')),
  published  boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hr_articles_company_idx on public.hr_articles (company_id, published);

-- Time to answer, by priority.
create or replace function public.hr_ticket_due(p_from timestamptz, p_priority text) returns timestamptz
language sql immutable as $$
  select p_from + case p_priority when 'urgent' then interval '4 hours' when 'high' then interval '24 hours' when 'low' then interval '96 hours' else interval '48 hours' end;
$$;

create or replace function public.hr_tickets_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_hr boolean;
begin
  select company_id into v_company from public.employees where id = new.employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  v_hr := auth.uid() is null or public.is_company_hr(v_company);
  if not v_hr and not public.is_my_employee(new.employee_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  new.company_id := v_company;

  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.status := 'open';
    new.first_response_at := null;
    new.resolved_at := null;
    if not v_hr then new.assigned_to := null; end if;
    new.due_at := public.hr_ticket_due(coalesce(new.created_at, now()), new.priority);
  else
    if (new.employee_id, new.ticket_no, new.created_at) is distinct from (old.employee_id, old.ticket_no, old.created_at) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    -- The employee may only close their ticket or reopen a resolved one. (Their replies
    -- update the status through the message trigger, which runs one level deeper.)
    if not v_hr and pg_trigger_depth() = 1 then
      if (new.subject, new.category, new.priority, new.assigned_to, new.due_at, new.first_response_at)
           is distinct from (old.subject, old.category, old.priority, old.assigned_to, old.due_at, old.first_response_at)
         or not (new.status = old.status or new.status = 'closed' or (new.status = 'open' and old.status = 'resolved')) then
        raise exception 'only_close_or_reopen' using errcode = '42501';
      end if;
    end if;
    if new.priority <> old.priority then new.due_at := public.hr_ticket_due(old.created_at, new.priority); end if;
    if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then new.resolved_at := now(); end if;
    if new.status in ('open', 'waiting_employee') then new.resolved_at := null; end if;
  end if;

  -- Assignee must be HR of the same company.
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.company_memberships m where m.company_id = v_company and m.user_id = new.assigned_to and m.role in ('customer_admin', 'hr_manager')) then
    raise exception 'invalid_assignee' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger hr_tickets_before before insert or update on public.hr_tickets
  for each row execute function public.hr_tickets_before();
create trigger hr_tickets_set_updated_at before update on public.hr_tickets
  for each row execute function public.set_updated_at();
create trigger hr_tickets_audit after insert or update or delete on public.hr_tickets
  for each row execute function public.audit_row_change();

create or replace function public.hr_ticket_messages_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare t public.hr_tickets;
begin
  select * into t from public.hr_tickets where id = new.ticket_id;
  if not found then raise exception 'ticket not found' using errcode = '23503'; end if;
  new.company_id := t.company_id;
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.created_at := now();
  -- "From HR" means an HR person answering someone else's ticket.
  new.from_hr := public.is_company_hr(t.company_id) and not public.is_my_employee(t.employee_id);
  if not public.is_company_hr(t.company_id) and auth.uid() is not null then
    if not public.is_my_employee(t.employee_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
    new.internal := false;
  end if;
  if t.status = 'closed' and not new.internal then raise exception 'ticket_closed' using errcode = '22023'; end if;
  return new;
end $$;
create trigger hr_ticket_messages_before before insert on public.hr_ticket_messages
  for each row execute function public.hr_ticket_messages_before();

create or replace function public.hr_ticket_messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.internal then return null; end if;
  if new.from_hr then
    update public.hr_tickets
    set first_response_at = coalesce(first_response_at, now()),
        status = case when status = 'open' then 'waiting_employee' else status end
    where id = new.ticket_id;
  else
    update public.hr_tickets set status = 'open' where id = new.ticket_id and status in ('waiting_employee', 'resolved');
    update public.hr_tickets set updated_at = now() where id = new.ticket_id;
  end if;
  return null;
end $$;
create trigger hr_ticket_messages_after after insert on public.hr_ticket_messages
  for each row execute function public.hr_ticket_messages_after();

create trigger hr_articles_set_updated_at before update on public.hr_articles
  for each row execute function public.set_updated_at();
create trigger hr_articles_audit after insert or update or delete on public.hr_articles
  for each row execute function public.audit_row_change();

alter table public.hr_tickets enable row level security;
alter table public.hr_ticket_messages enable row level security;
alter table public.hr_articles enable row level security;
revoke all on public.hr_tickets, public.hr_ticket_messages, public.hr_articles from anon;
grant select, insert, update on public.hr_tickets to authenticated;
grant select, insert on public.hr_ticket_messages to authenticated;
grant select, insert, update, delete on public.hr_articles to authenticated;
grant usage on sequence public.hr_ticket_number_seq to authenticated;
grant all on public.hr_tickets, public.hr_ticket_messages, public.hr_articles to service_role;

create policy hr_tickets_select on public.hr_tickets for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy hr_tickets_insert on public.hr_tickets for insert to authenticated
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));
create policy hr_tickets_update on public.hr_tickets for update to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(employee_id));

create or replace function public.is_my_hr_ticket(p_ticket uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hr_tickets t join public.employees e on e.id = t.employee_id where t.id = p_ticket and e.user_id = auth.uid());
$$;
revoke execute on function public.is_my_hr_ticket(uuid) from public, anon;
grant execute on function public.is_my_hr_ticket(uuid) to authenticated, service_role;

create policy hr_messages_select on public.hr_ticket_messages for select to authenticated
  using (public.is_company_hr(company_id) or (not internal and public.is_my_hr_ticket(ticket_id)));
create policy hr_messages_insert on public.hr_ticket_messages for insert to authenticated
  with check (public.is_company_hr(company_id) or (not internal and public.is_my_hr_ticket(ticket_id)));

create policy hr_articles_select on public.hr_articles for select to authenticated
  using (public.is_company_hr(company_id) or (published and public.is_company_member(company_id)));
create policy hr_articles_write on public.hr_articles for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

-- ===== 0016_assets_delegation.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0016 — Company assets, approval delegation and approval time limits
--   • company_assets + asset_assignments (one open assignment per asset;
--     the asset's status follows the assignment)
--   • approval_delegations: while a manager is away, a colleague approves
--     their team's leave and comp-off (extends is_manager_of)
--   • hr_settings: after how many hours approvals are reminded / escalated
-- ════════════════════════════════════════════════════════════════════

-- ── Assets ──────────────────────────────────────────────────────────
create table public.company_assets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  asset_tag     text not null check (char_length(asset_tag) between 1 and 40),
  name          text not null check (char_length(name) between 2 and 120),
  category      text not null default 'other' check (category in ('laptop', 'phone', 'id_card', 'sim', 'vehicle', 'tool', 'uniform', 'other')),
  serial_no     text check (serial_no is null or char_length(serial_no) <= 80),
  status        text not null default 'available' check (status in ('available', 'assigned', 'repair', 'retired')),
  purchased_on  date,
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, asset_tag)
);

create table public.asset_assignments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  asset_id     uuid not null references public.company_assets (id) on delete cascade,
  employee_id  uuid not null references public.employees (id) on delete cascade,
  assigned_on  date not null default (now() at time zone 'Asia/Kolkata')::date,
  returned_on  date,
  note         text check (note is null or char_length(note) <= 500),
  assigned_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (returned_on is null or returned_on >= assigned_on)
);
create unique index asset_assignments_open_uniq on public.asset_assignments (asset_id) where returned_on is null;
create index asset_assignments_employee_idx on public.asset_assignments (employee_id);

create or replace function public.asset_assignments_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.company_assets;
begin
  select * into a from public.company_assets where id = new.asset_id for update;
  if not found then raise exception 'asset not found' using errcode = '23503'; end if;
  new.company_id := a.company_id;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.employees e where e.id = new.employee_id and e.company_id = a.company_id and e.status = 'active') then
      raise exception 'invalid_employee' using errcode = '22023';
    end if;
    if a.status <> 'available' then raise exception 'asset_not_available' using errcode = '23505'; end if;
    new.returned_on := null;
    new.assigned_by := coalesce(auth.uid(), new.assigned_by);
  elsif (new.asset_id, new.employee_id, new.assigned_on) is distinct from (old.asset_id, old.employee_id, old.assigned_on)
        or (old.returned_on is not null and new.returned_on is distinct from old.returned_on) then
    raise exception 'assignment_fixed' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger asset_assignments_before before insert or update on public.asset_assignments
  for each row execute function public.asset_assignments_before();

create or replace function public.asset_assignments_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.company_assets set status = 'assigned' where id = new.asset_id;
  elsif new.returned_on is not null and old.returned_on is null then
    update public.company_assets set status = 'available' where id = new.asset_id and status = 'assigned';
  end if;
  return null;
end $$;
create trigger asset_assignments_after after insert or update on public.asset_assignments
  for each row execute function public.asset_assignments_after();

-- "Assigned" is only ever set by an assignment, and an asset in use cannot change status by hand.
create or replace function public.company_assets_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() = 1 then
    if tg_op = 'INSERT' and new.status = 'assigned' then raise exception 'asset_assigned' using errcode = '22023'; end if;
    if tg_op = 'UPDATE' and new.status <> old.status and (new.status = 'assigned' or old.status = 'assigned') then
      raise exception 'asset_assigned' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and new.company_id <> old.company_id then raise exception 'not_allowed' using errcode = '42501'; end if;
  end if;
  return new;
end $$;
create trigger company_assets_before before insert or update on public.company_assets
  for each row execute function public.company_assets_before();

-- ── Approval delegation ─────────────────────────────────────────────
create table public.approval_delegations (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  manager_employee_id  uuid not null references public.employees (id) on delete cascade,
  delegate_employee_id uuid not null references public.employees (id) on delete cascade,
  from_date            date not null,
  to_date              date not null,
  note                 text check (note is null or char_length(note) <= 300),
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 180),
  check (manager_employee_id <> delegate_employee_id)
);
create index approval_delegations_delegate_idx on public.approval_delegations (delegate_employee_id, to_date);

create or replace function public.approval_delegations_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.employees where id = new.manager_employee_id;
  if v_company is null then raise exception 'employee not found' using errcode = '23503'; end if;
  new.company_id := v_company;
  if not exists (select 1 from public.employees where id = new.delegate_employee_id and company_id = v_company and status = 'active') then
    raise exception 'invalid_employee' using errcode = '22023';
  end if;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
create trigger approval_delegations_before before insert or update on public.approval_delegations
  for each row execute function public.approval_delegations_before();

-- Direct reporting manager, or someone that manager has delegated to for today.
-- Nobody is ever the approver of their own requests.
create or replace function public.is_manager_of(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.employees e
    join public.employees m on m.company_id = e.company_id and m.user_id = auth.uid() and m.status = 'active'
    join public.profiles p on p.id = m.user_id and p.is_active
    where e.id = p_employee and e.id <> m.id
      and (
        e.reporting_manager_id = m.id
        or exists (
          select 1 from public.approval_delegations d
          where d.manager_employee_id = e.reporting_manager_id and d.delegate_employee_id = m.id
            and (now() at time zone 'Asia/Kolkata')::date between d.from_date and d.to_date
        )
      )
  );
$$;

-- The people whose requests the caller can decide as manager or delegate.
create or replace function public.my_approval_team(p_company uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.id from public.employees e where e.company_id = p_company and e.status <> 'exited' and public.is_manager_of(e.id);
$$;

-- ── Approval time limits ────────────────────────────────────────────
create table public.hr_settings (
  company_id           uuid primary key references public.companies (id) on delete cascade,
  remind_after_hours   integer not null default 24 check (remind_after_hours between 1 and 240),
  escalate_after_hours integer not null default 72 check (escalate_after_hours between 2 and 720),
  updated_at           timestamptz not null default now(),
  check (escalate_after_hours > remind_after_hours)
);
create trigger hr_settings_set_updated_at before update on public.hr_settings
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['company_assets'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array['company_assets', 'asset_assignments', 'approval_delegations', 'hr_settings'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- ── Row Level Security ──────────────────────────────────────────────
alter table public.company_assets enable row level security;
alter table public.asset_assignments enable row level security;
alter table public.approval_delegations enable row level security;
alter table public.hr_settings enable row level security;
revoke all on public.company_assets, public.asset_assignments, public.approval_delegations, public.hr_settings from anon;
grant select, insert, update, delete on public.company_assets, public.asset_assignments, public.approval_delegations, public.hr_settings to authenticated;
grant all on public.company_assets, public.asset_assignments, public.approval_delegations, public.hr_settings to service_role;

create or replace function public.holds_asset(p_asset uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.asset_assignments a join public.employees e on e.id = a.employee_id
    where a.asset_id = p_asset and a.returned_on is null and e.user_id = auth.uid()
  );
$$;

create policy assets_hr on public.company_assets for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy assets_holder on public.company_assets for select to authenticated using (public.holds_asset(id));
create policy asset_assignments_hr on public.asset_assignments for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));
create policy asset_assignments_own on public.asset_assignments for select to authenticated using (public.is_my_employee(employee_id));

-- A manager hands over their own approvals; HR can set it for anyone.
create policy delegations_select on public.approval_delegations for select to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(manager_employee_id) or public.is_my_employee(delegate_employee_id));
create policy delegations_write on public.approval_delegations for all to authenticated
  using (public.is_company_hr(company_id) or public.is_my_employee(manager_employee_id))
  with check (public.is_company_hr(company_id) or public.is_my_employee(manager_employee_id));

create policy hr_settings_hr on public.hr_settings for all to authenticated
  using (public.is_company_hr(company_id)) with check (public.is_company_hr(company_id));

revoke execute on function public.my_approval_team(uuid) from public, anon;
grant execute on function public.my_approval_team(uuid) to authenticated, service_role;
revoke execute on function public.holds_asset(uuid) from public, anon;
grant execute on function public.holds_asset(uuid) to authenticated, service_role;

-- Names only (no other details), for choosing and showing a delegate. HR and
-- people with direct reports see all active colleagues; others get nothing.
create or replace function public.colleague_names(p_company uuid)
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name
  from public.employees e
  where e.company_id = p_company and e.status = 'active'
    and (
      public.is_company_hr(p_company)
      or exists (
        select 1 from public.employees m join public.employees r on r.reporting_manager_id = m.id
        where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active'
      )
    )
  order by e.full_name;
$$;
revoke execute on function public.colleague_names(uuid) from public, anon;
grant execute on function public.colleague_names(uuid) to authenticated, service_role;

-- A delegate needs to see the names of the team they are covering.
-- (employees_select_manager from 0009 already uses is_manager_of, which now includes delegates.)

-- ===== 0017_mfa.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0017 — Two-step sign-in is enforced in the database
-- A person who has turned on an authenticator app (a verified MFA factor)
-- can reach company data only with a session that passed the second step
-- (JWT claim aal = 'aal2'). A stolen password alone gets nothing.
-- People who have not turned it on are not affected.
--
-- How: mfa_ok() is added as a RESTRICTIVE policy on every table that has RLS,
-- and to the role helpers used inside security-definer functions.
-- Every new table must add the same "mfa_required" policy
-- (tests/integration/mfa.test.ts fails otherwise).
--
-- Locked out (lost phone)? In the Supabase dashboard: Authentication → Users →
-- the person → remove the MFA factor.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.mfa_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or auth.uid() is null
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified');
$$;
revoke execute on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated, service_role;

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using ((select public.mfa_ok())) with check ((select public.mfa_ok()))', t.relname);
  end loop;
end $$;

create policy mfa_required on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_ok())) with check ((select public.mfa_ok()));

-- Security-definer functions skip RLS but ask these helpers who the caller is.
create or replace function public.company_role(p_company uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.role
  from public.company_memberships m
  join public.profiles p on p.id = m.user_id
  where m.company_id = p_company and m.user_id = auth.uid() and p.is_active and public.mfa_ok()
  limit 1;
$$;

create or replace function public.is_my_employee(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (select 1 from public.employees where id = p_employee and user_id = auth.uid());
$$;

create or replace function public.has_any_role(p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and p.is_active and ur.role_key = any (p_roles)
  );
$$;

create or replace function public.is_company_member(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (
    select 1
    from public.company_memberships m
    join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.user_id = auth.uid() and p.is_active
  );
$$;

create or replace function public.is_company_admin(p_company uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (
    select 1
    from public.company_memberships m
    join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.user_id = auth.uid() and m.role = 'customer_admin' and p.is_active
  );
$$;

-- Check-in runs as a security-definer function, so guard the rows it writes too.
create or replace function public.require_mfa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.mfa_ok() then raise exception 'mfa_required' using errcode = '42501'; end if;
  return new;
end $$;
create trigger attendance_records_require_mfa before insert or update on public.attendance_records
  for each row execute function public.require_mfa();
create trigger attendance_breaks_require_mfa before insert or update on public.attendance_breaks
  for each row execute function public.require_mfa();

-- ===== 0018_helpdesk_opening_message.sql =====
-- ════════════════════════════════════════════════════════════════════
-- 0018 — Helpdesk: the opening question is not a reply
-- Replaces hr_ticket_messages_after() from 0015. When HR opened a ticket on
-- an employee's behalf, the first message counted as HR's answer: the ticket
-- jumped to "waiting for employee" and the answer-by time stopped.
-- The opening message (the first one, written by whoever created the ticket)
-- now leaves the ticket open and unanswered.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.hr_ticket_messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.internal then return null; end if;
  if new.author_id is not distinct from (select created_by from public.hr_tickets where id = new.ticket_id)
     and not exists (select 1 from public.hr_ticket_messages m where m.ticket_id = new.ticket_id and m.id <> new.id and not m.internal) then
    return null;
  end if;
  if new.from_hr then
    update public.hr_tickets
    set first_response_at = coalesce(first_response_at, now()),
        status = case when status = 'open' then 'waiting_employee' else status end
    where id = new.ticket_id;
  else
    update public.hr_tickets set status = 'open' where id = new.ticket_id and status in ('waiting_employee', 'resolved');
    update public.hr_tickets set updated_at = now() where id = new.ticket_id;
  end if;
  return null;
end $$;
