export const LANGUAGES = ['en', 'ta'] as const;
export type Language = (typeof LANGUAGES)[number];

export const ROLE_KEYS = [
  'super_admin',
  'sales_admin',
  'sales_executive',
  'support_executive',
  'customer_admin',
  'hr_manager',
  'customer_user',
  'employee',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const STAFF_ROLES: RoleKey[] = ['super_admin', 'sales_admin', 'sales_executive', 'support_executive'];
/** Roles a person can hold inside a customer company. Employees do not count towards the plan's portal-user limit. */
export const COMPANY_ROLES = ['customer_admin', 'hr_manager', 'customer_user', 'employee'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'qualified',
  'demo_scheduled',
  'demo_completed',
  'trial',
  'negotiation',
  'won',
  'lost',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const OPEN_LEAD_STATUSES: LeadStatus[] = LEAD_STATUSES.filter((s) => s !== 'won' && s !== 'lost');

export const LEAD_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_SOURCES = [
  'website',
  'contact_form',
  'demo_booking',
  'free_trial',
  'whatsapp',
  'phone_call',
  'referral',
  'walk_in',
  'google_ads',
  'facebook',
  'instagram',
  'exhibition',
  'cold_call',
  'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const CITIES = ['Tirunelveli', 'Thoothukudi', 'Nagercoil', 'Madurai', 'Tenkasi', 'Kovilpatti', 'Chennai', 'Coimbatore', 'Other'] as const;

export const INDUSTRIES = [
  'manufacturing',
  'textiles',
  'healthcare',
  'education',
  'retail',
  'logistics',
  'construction',
  'hospitality',
  'it_services',
  'finance',
  'other',
] as const;
export type Industry = (typeof INDUSTRIES)[number];

export const FEATURE_INTERESTS = [
  'attendance',
  'payroll',
  'leave',
  'compliance',
  'shifts',
  'mobile_app',
  'recruitment',
  'performance',
  'reports',
] as const;

export const EMPLOYEE_RANGES = [
  { key: '1-25', value: 25 },
  { key: '26-50', value: 50 },
  { key: '51-100', value: 100 },
  { key: '101-300', value: 300 },
  { key: '301-1000', value: 1000 },
  { key: '1000+', value: 1500 },
] as const;

export const DEMO_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];
export const DEMO_MODES = ['online', 'onsite', 'phone'] as const;
export const DEMO_OUTCOMES = ['interested', 'needs_follow_up', 'not_interested', 'trial_started'] as const;

export const COMPANY_STATUSES = ['onboarding', 'trial', 'active', 'suspended', 'cancelled'] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'yearly'] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export const PAYMENT_METHODS = ['bank_transfer', 'upi', 'cash', 'cheque', 'razorpay', 'other'] as const;
export const PAYMENT_STATUSES = ['pending', 'verified', 'failed', 'refunded'] as const;
export const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'void', 'overdue'] as const;

export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_CATEGORIES = ['general', 'technical', 'billing', 'onboarding', 'feature_request'] as const;
export const TICKET_PRIORITIES = LEAD_PRIORITIES;

export const ACTIVITY_TYPES = ['note', 'call', 'email', 'whatsapp', 'meeting'] as const;

export const NOTIFICATION_KEYS = [
  'lead_acknowledgement',
  'demo_confirmation',
  'demo_reminder',
  'demo_rescheduled',
  'demo_cancelled',
  'trial_activation',
  'trial_expiring',
  'subscription_renewal',
  'payment_confirmation',
  'support_ticket_update',
  'follow_up_reminder',
] as const;
export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

export const GST_RATE = 0.18;
export const TIMEZONE = 'Asia/Kolkata';
