import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Plan, PlanFeature } from '@/types/db';

const f = (en: string, ta: string): PlanFeature => ({ en, ta });

/**
 * Shown on the public pricing page only when the database is unreachable or not
 * configured yet. Mirrors supabase/migrations/0005_reference_data.sql.
 */
export const FALLBACK_PLANS: Plan[] = [
  {
    id: 'starter', key: 'starter', name: 'Starter', description: 'For small teams getting started with digital HR', price_monthly: 999, price_yearly: 9990, currency: 'INR',
    employee_limit: 25, user_limit: 2, trial_days: 14, billing_frequencies: ['monthly', 'yearly'], is_active: true, is_public: true, is_featured: false, sort_order: 1,
    features: [f('Employee database', 'பணியாளர் தரவுத்தளம்'), f('Attendance & leave', 'வருகைப் பதிவு & விடுப்பு'), f('Basic payroll & payslips', 'அடிப்படை சம்பளப் பட்டியல் & சம்பளச் சீட்டு'), f('Email support', 'மின்னஞ்சல் ஆதரவு')],
  },
  {
    id: 'business', key: 'business', name: 'Business', description: 'For growing businesses that need payroll compliance', price_monthly: 2499, price_yearly: 24990, currency: 'INR',
    employee_limit: 100, user_limit: 5, trial_days: 14, billing_frequencies: ['monthly', 'yearly'], is_active: true, is_public: true, is_featured: true, sort_order: 2,
    features: [f('Everything in Starter', 'Starter-இல் உள்ள அனைத்தும்'), f('PF, ESI & professional tax', 'PF, ESI & தொழில் வரி'), f('Shift & overtime management', 'ஷிப்ட் & கூடுதல் நேர மேலாண்மை'), f('Employee self-service app', 'பணியாளர் சுய சேவை செயலி'), f('WhatsApp & phone support', 'WhatsApp & தொலைபேசி ஆதரவு')],
  },
  {
    id: 'growth', key: 'growth', name: 'Growth', description: 'For multi-branch organisations', price_monthly: 4999, price_yearly: 49990, currency: 'INR',
    employee_limit: 300, user_limit: 15, trial_days: 14, billing_frequencies: ['monthly', 'yearly'], is_active: true, is_public: true, is_featured: false, sort_order: 3,
    features: [f('Everything in Business', 'Business-இல் உள்ள அனைத்தும்'), f('Multi-branch & departments', 'பல கிளைகள் & துறைகள்'), f('Biometric device integration', 'பயோமெட்ரிக் சாதன இணைப்பு'), f('Advanced reports & analytics', 'மேம்பட்ட அறிக்கைகள் & பகுப்பாய்வு'), f('Priority support', 'முன்னுரிமை ஆதரவு')],
  },
  {
    id: 'enterprise', key: 'enterprise', name: 'Enterprise', description: 'Custom rollout for large organisations', price_monthly: null, price_yearly: null, currency: 'INR',
    employee_limit: null, user_limit: null, trial_days: 30, billing_frequencies: ['monthly', 'yearly'], is_active: true, is_public: true, is_featured: false, sort_order: 4,
    features: [f('Everything in Growth', 'Growth-இல் உள்ள அனைத்தும்'), f('Unlimited employees', 'வரம்பற்ற பணியாளர்கள்'), f('Custom workflows & integrations', 'தனிப்பயன் பணிப்பாய்வுகள் & இணைப்புகள்'), f('Dedicated account manager', 'பிரத்யேக கணக்கு மேலாளர்'), f('On-site onboarding', 'நேரடி செயலாக்க உதவி')],
  },
];

async function fetchPublicPlans(): Promise<Plan[]> {
  if (!supabase) return FALLBACK_PLANS;
  const { data, error } = await supabase.from('plans').select('*').eq('is_active', true).eq('is_public', true).order('sort_order');
  if (error || !data || data.length === 0) return FALLBACK_PLANS;
  return data as Plan[];
}

export function usePublicPlans() {
  return useQuery({ queryKey: ['public-plans'], queryFn: fetchPublicPlans, staleTime: 5 * 60_000, placeholderData: FALLBACK_PLANS });
}

export function planFeatureText(feature: PlanFeature | string, lang: string): string {
  if (typeof feature === 'string') return feature;
  return (lang === 'ta' && feature.ta) || feature.en;
}

/** Monthly-equivalent price for a billing choice. */
export function planPrice(plan: Pick<Plan, 'price_monthly' | 'price_yearly'>, yearly: boolean): number | null {
  if (yearly) return plan.price_yearly !== null ? plan.price_yearly / 12 : null;
  return plan.price_monthly;
}

export function periodAmount(plan: Pick<Plan, 'price_monthly' | 'price_yearly'>, frequency: 'monthly' | 'quarterly' | 'yearly'): number {
  if (frequency === 'yearly') return plan.price_yearly ?? (plan.price_monthly ?? 0) * 12;
  if (frequency === 'quarterly') return (plan.price_monthly ?? 0) * 3;
  return plan.price_monthly ?? 0;
}

export function addPeriod(start: Date, frequency: 'monthly' | 'quarterly' | 'yearly'): Date {
  const d = new Date(start);
  d.setUTCMonth(d.getUTCMonth() + (frequency === 'yearly' ? 12 : frequency === 'quarterly' ? 3 : 1));
  return d;
}
