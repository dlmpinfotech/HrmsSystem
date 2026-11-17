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
