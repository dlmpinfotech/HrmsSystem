import { useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WhatsAppButton } from '@/components/shared/brand';
import { planFeatureText, planPrice, usePublicPlans } from '@/features/subscriptions/plans';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export function PricingCards() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data: plans = [] } = usePublicPlans();
  const [yearly, setYearly] = useState(false);
  const hasYearly = plans.some((p) => p.price_yearly !== null && p.billing_frequencies.includes('yearly'));

  return (
    <div>
      {hasYearly && (
        <div className="mb-8 flex justify-center">
          <div role="radiogroup" aria-label={t('pricing.billingCycle')} className="relative inline-flex max-w-full rounded-full border bg-card p-1">
            {[false, true].map((value) => (
              <button
                key={String(value)}
                role="radio"
                aria-checked={yearly === value}
                onClick={() => setYearly(value)}
                className={cn('relative z-10 inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors sm:gap-2 sm:px-4', yearly === value ? 'text-primary-foreground' : 'text-muted-foreground')}
              >
                {yearly === value && <motion.span layoutId="billing-pill" className="absolute inset-0 -z-10 rounded-full bg-primary" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                {value ? t('pricing.yearly') : t('pricing.monthly')}
                {value && <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', yearly ? 'bg-white/20' : 'bg-success/15 text-success')}>{t('pricing.save')}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        {plans.map((plan, i) => {
          const price = planPrice(plan, yearly && hasYearly);
          const custom = price === null;
          return (
            <motion.article
              key={plan.key}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.45, delay: i * 0.07 }}
              whileHover={{ y: -6 }}
              className={cn('relative flex flex-col rounded-2xl border bg-card p-6 shadow-card', plan.is_featured && 'border-primary shadow-soft ring-1 ring-primary')}
            >
              {plan.is_featured && (
                <Badge tone="primary" className="absolute -top-3 left-6 border-primary bg-primary text-primary-foreground">
                  <Sparkles className="size-3" aria-hidden /> {t('pricing.popular')}
                </Badge>
              )}
              <h3 className="text-lg font-bold">{plan.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-muted-foreground">{t(`pricing.planDesc.${plan.key}`, { defaultValue: plan.description ?? '' })}</p>
              <div className="mt-5 flex items-baseline gap-1">
                {custom ? (
                  <span className="text-3xl font-extrabold tracking-tight">{t('pricing.custom')}</span>
                ) : (
                  <>
                    <motion.span key={String(yearly)} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-4xl font-extrabold tracking-tight tabular">
                      {formatCurrency(Math.round(price), lang)}
                    </motion.span>
                    <span className="text-sm text-muted-foreground">{t('pricing.perMonth')}</span>
                  </>
                )}
              </div>
              <p className="mt-1 min-h-5 text-xs text-muted-foreground">
                {custom ? t('pricing.customNote') : yearly && hasYearly ? t('pricing.billedYearly', { amount: formatCurrency(plan.price_yearly, lang) }) : t('pricing.plusGst')}
              </p>
              <p className="mt-4 text-sm font-medium">
                {plan.employee_limit ? t('pricing.upToEmployees', { count: plan.employee_limit, formatted: formatNumber(plan.employee_limit, lang) }) : t('pricing.unlimitedEmployees')}
              </p>
              <ul className="mt-4 flex-1 space-y-2.5 text-sm">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                    <span>{planFeatureText(feature, lang)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 space-y-2">
                <Button asChild className="h-auto min-h-11 w-full whitespace-normal py-2 text-center leading-snug" variant={plan.is_featured ? 'default' : 'outline'}>
                  {custom ? <Link to="/contact">{t('cta.contactSales')}</Link> : <Link to={`/free-trial?plan=${plan.key}`}>{t('pricing.startTrial', { days: plan.trial_days })}</Link>}
                </Button>
                <WhatsAppButton intent="pricing" vars={{ plan: plan.name }} size="sm" variant="ghost" className="h-auto min-h-9 w-full whitespace-normal py-1.5 text-foreground">
                  {t('pricing.askOnWhatsApp')}
                </WhatsAppButton>
              </div>
            </motion.article>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">{t('pricing.footnote')}</p>
    </div>
  );
}
