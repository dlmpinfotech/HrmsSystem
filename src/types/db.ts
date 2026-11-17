import type {
  BillingFrequency,
  CompanyStatus,
  DemoStatus,
  Language,
  LeadPriority,
  LeadSource,
  LeadStatus,
  RoleKey,
  SubscriptionStatus,
  TicketStatus,
} from '@shared/constants';

/** Row shapes mirroring supabase/migrations. Keep in sync when the schema changes. */

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  preferred_language: Language | null;
  theme_preference: 'light' | 'dark' | 'system';
  is_active: boolean;
  created_at: string;
}

export interface UserRole {
  user_id: string;
  role_key: RoleKey;
}

export interface Company {
  id: string;
  tenant_code: string;
  name: string;
  display_name: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string;
  address: string | null;
  pincode: string | null;
  gst_number: string | null;
  website: string | null;
  employee_count: number | null;
  default_language: Language;
  hrms_url: string | null;
  status: CompanyStatus;
  created_at: string;
  updated_at: string;
}

export interface CompanyMembership {
  id: string;
  company_id: string;
  user_id: string;
  role: 'customer_admin' | 'hr_manager' | 'customer_user' | 'employee';
  created_at: string;
  companies?: Company;
  profiles?: Pick<Profile, 'id' | 'full_name' | 'email' | 'is_active'>;
}

export interface CompanyBrandingRow {
  company_id: string;
  display_name: string | null;
  tagline: string | null;
  logo_path: string | null;
  logo_light_path: string | null;
  logo_dark_path: string | null;
  favicon_path: string | null;
  theme_mode: 'light' | 'dark' | 'system' | 'custom';
  colors: Record<string, string>;
  appearance: Record<string, unknown>;
  default_language: Language;
  updated_at: string;
}

export interface Lead {
  id: string;
  company_name: string;
  contact_person: string;
  phone: string;
  email: string | null;
  city: string | null;
  industry: string | null;
  employee_count: number | null;
  existing_hrms: string | null;
  interested_features: string[];
  source: LeadSource;
  campaign_id: string | null;
  assigned_to: string | null;
  priority: LeadPriority;
  status: LeadStatus;
  next_follow_up_at: string | null;
  remarks: string | null;
  communication_consent: boolean;
  lost_reason: string | null;
  expected_value: number | null;
  converted_company_id: string | null;
  created_at: string;
  updated_at: string;
  assignee?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface LeadActivity {
  id: string;
  lead_id: string;
  type: 'note' | 'call' | 'email' | 'whatsapp' | 'meeting' | 'status_change' | 'assignment' | 'system';
  body: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  author?: Pick<Profile, 'full_name'> | null;
}

export interface LeadTask {
  id: string;
  lead_id: string;
  title: string;
  due_at: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  created_at: string;
}

export interface DemoAvailability {
  id: string;
  salesperson_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  is_active: boolean;
}

export interface DemoBooking {
  id: string;
  lead_id: string | null;
  salesperson_id: string | null;
  starts_at: string;
  ends_at: string;
  status: DemoStatus;
  contact_name: string;
  company_name: string;
  email: string | null;
  phone: string;
  language: Language;
  mode: 'online' | 'onsite' | 'phone';
  meeting_url: string | null;
  notes: string | null;
  reschedule_count: number;
  cancelled_reason: string | null;
  feedback_rating: number | null;
  feedback_notes: string | null;
  outcome: string | null;
  follow_up_at: string | null;
  created_at: string;
  salesperson?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface Customer {
  id: string;
  company_id: string;
  lead_id: string | null;
  account_owner_id: string | null;
  source: string | null;
  notes: string | null;
  activated_at: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
  onboarding_completed_at: string | null;
  created_at: string;
}

export interface CustomerContact {
  id: string;
  company_id: string;
  name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  whatsapp_opt_in: boolean;
}

export interface OnboardingTask {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
  due_date: string | null;
  sort_order: number;
  completed_at: string | null;
}

export interface PlanFeature {
  en: string;
  ta?: string;
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  price_monthly: number | null;
  price_yearly: number | null;
  currency: string;
  employee_limit: number | null;
  user_limit: number | null;
  features: PlanFeature[];
  trial_days: number;
  billing_frequencies: BillingFrequency[];
  is_active: boolean;
  is_public: boolean;
  is_featured: boolean;
  sort_order: number;
}

export interface Subscription {
  id: string;
  company_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  billing_frequency: BillingFrequency;
  amount: number;
  currency: string;
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  plans?: Plan;
  companies?: Pick<Company, 'id' | 'name' | 'city' | 'status'>;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  company_id: string;
  subscription_id: string | null;
  description: string | null;
  amount: number;
  tax_amount: number;
  total: number;
  currency: string;
  status: 'draft' | 'issued' | 'paid' | 'void' | 'overdue';
  issued_at: string;
  due_at: string | null;
  paid_at: string | null;
  period_start: string | null;
  period_end: string | null;
  companies?: Pick<Company, 'id' | 'name'>;
}

export interface Payment {
  id: string;
  company_id: string;
  invoice_id: string | null;
  amount: number;
  currency: string;
  method: string;
  status: 'pending' | 'verified' | 'failed' | 'refunded';
  reference: string | null;
  paid_on: string | null;
  notes: string | null;
  verified_at: string | null;
  verification_source: string | null;
  created_at: string;
  companies?: Pick<Company, 'id' | 'name'>;
  invoices?: Pick<Invoice, 'invoice_number'> | null;
}

export interface SupportTicket {
  id: string;
  ticket_number: string;
  company_id: string;
  created_by: string | null;
  subject: string;
  description: string;
  category: string;
  priority: LeadPriority;
  status: TicketStatus;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  companies?: Pick<Company, 'id' | 'name'>;
  creator?: Pick<Profile, 'full_name' | 'email'> | null;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  author_id: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
  author?: Pick<Profile, 'full_name'> | null;
}

export interface NotificationTemplate {
  id: string;
  key: string;
  channel: 'email' | 'whatsapp';
  language: Language;
  name: string;
  subject: string | null;
  body: string;
  whatsapp_template_name: string | null;
  variables: string[];
  is_active: boolean;
}

export interface NotificationLog {
  id: string;
  template_key: string;
  channel: 'email' | 'whatsapp';
  recipient: string;
  subject: string | null;
  body: string | null;
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';
  error: string | null;
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

export interface WhatsAppConversation {
  id: string;
  wa_phone: string;
  contact_name: string | null;
  lead_id: string | null;
  last_message_at: string | null;
  last_inbound_at: string | null;
  unread_count: number;
}

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  body: string | null;
  template_name: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

export interface Video {
  id: string;
  title: string;
  title_ta: string | null;
  description: string | null;
  description_ta: string | null;
  url: string;
  provider: 'youtube' | 'azure_blob' | 'file';
  thumbnail_url: string | null;
  category: string;
  audience: 'public' | 'customer';
  sort_order: number;
  is_published: boolean;
}

export interface HelpArticle {
  id: string;
  slug: string;
  category: string;
  title: string;
  title_ta: string | null;
  body: string;
  body_ta: string | null;
  sort_order: number;
  is_published: boolean;
}

export interface MarketingCampaign {
  id: string;
  name: string;
  channel: string;
  utm_code: string | null;
  status: 'draft' | 'active' | 'paused' | 'completed';
  budget: number | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  company_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: Pick<Profile, 'full_name' | 'email'> | null;
}

export interface UserInvitation {
  id: string;
  email: string;
  role_key: RoleKey;
  company_id: string | null;
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
}

export interface AppSetting<T = unknown> {
  key: string;
  value: T;
  is_public: boolean;
}
