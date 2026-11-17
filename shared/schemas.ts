import { z } from 'zod';
import {
  ACTIVITY_TYPES,
  DEMO_MODES,
  DEMO_OUTCOMES,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  PAYMENT_METHODS,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  BILLING_FREQUENCIES,
} from './constants';
import { isValidIndianPhone } from './phone';

/**
 * Validation schemas shared by the browser forms and the Netlify Functions.
 * Error messages are i18n keys (e.g. "validation.required") resolved by the UI.
 */

const trimmed = (max: number) => z.string().trim().max(max, 'validation.tooLong');
const required = (max: number) => trimmed(max).min(1, 'validation.required');
const optionalText = (max: number) =>
  z
    .union([trimmed(max), z.null(), z.undefined()])
    .transform((v) => (v ? v : undefined));

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'validation.required')
  .refine(isValidIndianPhone, 'validation.phone');

export const emailSchema = z.string().trim().toLowerCase().min(1, 'validation.required').email('validation.email').max(160, 'validation.tooLong');
export const optionalEmailSchema = z
  .union([z.literal(''), z.null(), z.undefined(), z.string().trim().toLowerCase().email('validation.email').max(160)])
  .transform((v) => (v ? v : undefined));

const employeeCount = z
  .union([z.literal(''), z.null(), z.undefined(), z.coerce.number().int('validation.number').min(1, 'validation.number').max(1_000_000, 'validation.number')])
  .transform((v) => (typeof v === 'number' ? v : undefined));

const language = z.enum(['en', 'ta']).default('en');

/** Fields every public form carries for spam protection. */
const antiSpam = {
  /** Honeypot — real users never fill this hidden field. */
  website: z.string().max(200).optional(),
  /** Milliseconds between the form rendering and submission. */
  elapsed_ms: z.coerce.number().optional(),
};

const consent = z.literal(true, { errorMap: () => ({ message: 'validation.consent' }) });

export const publicLeadSchema = z.object({
  company_name: required(160),
  contact_person: required(120),
  phone: phoneSchema,
  email: optionalEmailSchema,
  city: optionalText(80),
  industry: optionalText(60),
  employee_count: employeeCount,
  existing_hrms: optionalText(120),
  interested_features: z.array(z.string().max(40)).max(20).default([]),
  message: optionalText(2000),
  source: z.enum(LEAD_SOURCES).default('website'),
  language,
  consent,
  whatsapp_opt_in: z.boolean().default(false),
  utm: z.record(z.string().max(200)).optional(),
  ...antiSpam,
});
export type PublicLeadInput = z.input<typeof publicLeadSchema>;

export const demoBookingSchema = z.object({
  contact_name: required(120),
  company_name: required(160),
  phone: phoneSchema,
  email: emailSchema,
  city: optionalText(80),
  employee_count: employeeCount,
  starts_at: z.string().datetime({ message: 'validation.slot' }),
  mode: z.enum(DEMO_MODES).default('online'),
  notes: optionalText(1000),
  language,
  consent,
  whatsapp_opt_in: z.boolean().default(false),
  utm: z.record(z.string().max(200)).optional(),
  ...antiSpam,
});
export type DemoBookingInput = z.input<typeof demoBookingSchema>;

export const manageBookingSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reschedule'), token: z.string().min(32).max(128), starts_at: z.string().datetime() }),
  z.object({ action: z.literal('cancel'), token: z.string().min(32).max(128), reason: optionalText(500) }),
]);

export const passwordSchema = z
  .string()
  .min(8, 'validation.passwordMin')
  .max(72, 'validation.tooLong')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'validation.passwordStrength');

export const trialSignupSchema = z.object({
  company_name: required(160).pipe(z.string().min(2, 'validation.min2')),
  contact_name: required(120),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  city: optionalText(80),
  industry: optionalText(60),
  employee_count: employeeCount,
  plan_key: z.string().trim().max(40).default('business'),
  language,
  consent,
  whatsapp_opt_in: z.boolean().default(false),
  ...antiSpam,
});
export type TrialSignupInput = z.input<typeof trialSignupSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'validation.required'),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'validation.passwordMatch' });

// ── Staff-side forms ──────────────────────────────────────────────────
const optionalDateTime = z
  .union([z.literal(''), z.null(), z.undefined(), z.string()])
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), 'validation.date');

const optionalUuid = z
  .union([z.literal(''), z.null(), z.undefined(), z.string().uuid()])
  .transform((v) => (v ? v : null));

export const leadFormSchema = z.object({
  company_name: required(160),
  contact_person: required(120),
  phone: phoneSchema,
  email: optionalEmailSchema,
  city: optionalText(80),
  industry: optionalText(60),
  employee_count: employeeCount,
  existing_hrms: optionalText(120),
  interested_features: z.array(z.string()).default([]),
  source: z.enum(LEAD_SOURCES),
  assigned_to: optionalUuid,
  priority: z.enum(LEAD_PRIORITIES),
  status: z.enum(LEAD_STATUSES),
  next_follow_up_at: optionalDateTime,
  remarks: optionalText(4000),
  communication_consent: z.boolean().default(false),
  expected_value: z
    .union([z.literal(''), z.null(), z.undefined(), z.coerce.number().min(0, 'validation.number')])
    .transform((v) => (typeof v === 'number' ? v : null)),
});
export type LeadFormInput = z.input<typeof leadFormSchema>;
export type LeadFormValues = z.output<typeof leadFormSchema>;

export const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  body: required(4000),
});

export const taskSchema = z.object({
  title: required(200),
  due_at: optionalDateTime,
});

export const adminDemoActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    lead_id: z.string().uuid(),
    salesperson_id: z.string().uuid(),
    starts_at: z.string().datetime(),
    duration_minutes: z.number().int().min(15).max(180).default(45),
    mode: z.enum(DEMO_MODES).default('online'),
    meeting_url: optionalText(500),
    notes: optionalText(1000),
    notify: z.boolean().default(true),
  }),
  z.object({
    action: z.literal('reschedule'),
    booking_id: z.string().uuid(),
    starts_at: z.string().datetime(),
    notify: z.boolean().default(true),
  }),
  z.object({
    action: z.literal('cancel'),
    booking_id: z.string().uuid(),
    reason: optionalText(500),
    notify: z.boolean().default(true),
  }),
  z.object({
    action: z.literal('complete'),
    booking_id: z.string().uuid(),
    status: z.enum(['completed', 'no_show']),
    outcome: z.enum(DEMO_OUTCOMES).optional(),
    feedback_rating: z.number().int().min(1).max(5).optional(),
    feedback_notes: optionalText(2000),
    follow_up_at: optionalDateTime,
  }),
]);

export const adminCustomerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('convert'), lead_id: z.string().uuid(), plan_key: z.string().min(1).max(40) }),
  z.object({ action: z.literal('activate'), company_id: z.string().uuid() }),
  z.object({ action: z.literal('suspend'), company_id: z.string().uuid(), reason: required(500) }),
  z.object({ action: z.literal('extend_trial'), company_id: z.string().uuid(), days: z.number().int().min(1).max(60) }),
]);

export const paymentRecordSchema = z.object({
  company_id: z.string().uuid(),
  invoice_id: optionalUuid,
  amount: z.coerce.number().positive('validation.number'),
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(120),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date'),
  notes: optionalText(1000),
});

export const adminPaymentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('record') }).merge(paymentRecordSchema),
  z.object({ action: z.literal('verify'), payment_id: z.string().uuid() }),
  z.object({ action: z.literal('reject'), payment_id: z.string().uuid(), reason: optionalText(500) }),
]);

export const invoiceCreateSchema = z.object({
  company_id: z.string().uuid(),
  subscription_id: optionalUuid,
  description: optionalText(300),
  amount: z.coerce.number().min(0, 'validation.number'),
  apply_gst: z.boolean().default(true),
  due_in_days: z.coerce.number().int().min(0).max(90).default(7),
  period_start: optionalDateTime,
  period_end: optionalDateTime,
});

export const planFormSchema = z.object({
  key: z.string().trim().min(2, 'validation.min2').max(40).regex(/^[a-z0-9_]+$/, 'validation.slug'),
  name: required(60),
  description: optionalText(300),
  price_monthly: z.union([z.literal(''), z.null(), z.coerce.number().min(0)]).transform((v) => (typeof v === 'number' ? v : null)),
  price_yearly: z.union([z.literal(''), z.null(), z.coerce.number().min(0)]).transform((v) => (typeof v === 'number' ? v : null)),
  employee_limit: z.union([z.literal(''), z.null(), z.coerce.number().int().positive()]).transform((v) => (typeof v === 'number' ? v : null)),
  user_limit: z.union([z.literal(''), z.null(), z.coerce.number().int().positive()]).transform((v) => (typeof v === 'number' ? v : null)),
  trial_days: z.coerce.number().int().min(0).max(90),
  billing_frequencies: z.array(z.enum(BILLING_FREQUENCIES)).min(1, 'validation.required'),
  features_en: trimmed(4000),
  features_ta: trimmed(4000),
  is_active: z.boolean(),
  is_public: z.boolean(),
  is_featured: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(1000),
});

export const ticketCreateSchema = z.object({
  company_id: z.string().uuid(),
  subject: z.string().trim().min(3, 'validation.min3').max(200, 'validation.tooLong'),
  description: z.string().trim().min(10, 'validation.min10').max(10000, 'validation.tooLong'),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(TICKET_PRIORITIES),
});

export const supportActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create') }).merge(ticketCreateSchema),
  z.object({
    action: z.literal('reply'),
    ticket_id: z.string().uuid(),
    body: z.string().trim().min(1, 'validation.required').max(10000, 'validation.tooLong'),
    is_internal: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('update'),
    ticket_id: z.string().uuid(),
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    assigned_to: optionalUuid.optional(),
  }),
]);

export const inviteSchema = z.object({
  email: emailSchema,
  full_name: required(120),
  role_key: z.enum(['super_admin', 'sales_admin', 'sales_executive', 'support_executive', 'customer_admin', 'hr_manager', 'customer_user', 'employee']),
  company_id: optionalUuid,
});

// ── HRMS ──────────────────────────────────────────────────────────────
const optionalDate = z
  .union([z.literal(''), z.null(), z.undefined(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date')])
  .transform((v) => (v ? v : null));
const timeHHMM = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'validation.time');

export const employeeSchema = z
  .object({
    employee_code: trimmed(30),
    full_name: required(120).pipe(z.string().min(2, 'validation.min2')),
    email: optionalEmailSchema,
    phone: z.union([z.literal(''), z.null(), z.undefined(), phoneSchema]).transform((v) => (v ? v : undefined)),
    department: optionalText(60),
    designation: optionalText(80),
    employment_type: z.enum(['full_time', 'part_time', 'contract', 'intern']),
    date_of_joining: optionalDate,
    date_of_birth: optionalDate,
    gender: z.union([z.literal(''), z.null(), z.undefined(), z.enum(['male', 'female', 'other'])]).transform((v) => (v ? v : null)),
    address: optionalText(400),
    emergency_contact_name: optionalText(120),
    emergency_contact_phone: z.union([z.literal(''), z.null(), z.undefined(), phoneSchema]).transform((v) => (v ? v : undefined)),
    shift_start: timeHHMM,
    shift_end: timeHHMM,
    grace_minutes: z.coerce.number().int('validation.number').min(0, 'validation.number').max(120, 'validation.number'),
    weekly_offs: z.array(z.coerce.number().int().min(0).max(6)).max(6),
    status: z.enum(['active', 'inactive', 'exited']),
    login_access: z.boolean().default(false),
    login_role: z.enum(['employee', 'hr_manager']).default('employee'),
  })
  .refine((v) => v.shift_end.slice(0, 5) > v.shift_start.slice(0, 5), { path: ['shift_end'], message: 'validation.shiftEnd' })
  .refine((v) => !v.login_access || Boolean(v.email), { path: ['email'], message: 'validation.emailForAccess' });
export type EmployeeInput = z.input<typeof employeeSchema>;

export const leaveRequestSchema = z
  .object({
    employee_id: z.string().uuid('validation.required'),
    leave_type_id: z.string().uuid('validation.required'),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date'),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date'),
    half_day: z.boolean().default(false),
    reason: optionalText(1000),
  })
  .refine((v) => v.end_date >= v.start_date, { path: ['end_date'], message: 'validation.endBeforeStart' })
  .refine((v) => !v.half_day || v.start_date === v.end_date, { path: ['half_day'], message: 'validation.halfDayOneDay' });
export type LeaveRequestInput = z.input<typeof leaveRequestSchema>;

/** One person at a customer company: a contact, optionally with portal access. */
export const companyPersonSchema = z
  .object({
    name: required(120).pipe(z.string().min(2, 'validation.min2')),
    designation: optionalText(120),
    email: optionalEmailSchema,
    phone: z.union([z.literal(''), z.null(), z.undefined(), phoneSchema]).transform((v) => (v ? v : undefined)),
    is_primary: z.boolean().default(false),
    whatsapp_opt_in: z.boolean().default(false),
    portal_access: z.boolean().default(false),
    role: z.enum(['customer_admin', 'hr_manager', 'customer_user']).default('customer_user'),
  })
  .refine((v) => !v.portal_access || Boolean(v.email), { path: ['email'], message: 'validation.emailForAccess' });
export type CompanyPersonInput = z.input<typeof companyPersonSchema>;

export const companyProfileSchema = z.object({
  name: z.string().trim().min(2, 'validation.min2').max(160, 'validation.tooLong'),
  industry: optionalText(60),
  city: optionalText(80),
  state: optionalText(80),
  address: optionalText(400),
  pincode: z.union([z.literal(''), z.null(), z.undefined(), z.string().trim().regex(/^\d{6}$/, 'validation.pincode')]).transform((v) => (v ? v : undefined)),
  gst_number: z
    .union([z.literal(''), z.null(), z.undefined(), z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'validation.gst')])
    .transform((v) => (v ? v : undefined)),
  website: z.union([z.literal(''), z.null(), z.undefined(), z.string().trim().url('validation.url').max(200)]).transform((v) => (v ? v : undefined)),
  employee_count: employeeCount,
  default_language: z.enum(['en', 'ta']),
});

export const whatsappSendSchema = z.object({
  conversation_id: z.string().uuid(),
  body: z.string().trim().min(1, 'validation.required').max(4000, 'validation.tooLong'),
});

export const templateFormSchema = z.object({
  name: required(120),
  subject: optionalText(200),
  body: required(6000),
  whatsapp_template_name: optionalText(120),
  is_active: z.boolean(),
});
