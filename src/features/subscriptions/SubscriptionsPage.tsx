import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, CreditCard, Download, Package, Pencil, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { CheckField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, QueryState } from '@/components/shared/states';
import { ConfirmDialog, FormDialog, PageHeader, StatCard, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { computeMrr } from '@/features/analytics/metrics';
import { useAllPlans } from '@/features/subscriptions/billing';
import { api, errorKey } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatCurrency, formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import type { Payment, Plan, PlanFeature, Subscription } from '@/types/db';
import { BILLING_FREQUENCIES, SUBSCRIPTION_STATUSES } from '@shared/constants';
import { planFeatureText } from './plans';
import { planFormSchema } from '@shared/schemas';
import type { z } from 'zod';

type PlanForm = z.input<typeof planFormSchema>;

function toForm(plan: Plan | null): PlanForm {
  const features = plan?.features ?? [];
  return {
    key: plan?.key ?? '', name: plan?.name ?? '', description: plan?.description ?? '',
    price_monthly: plan?.price_monthly ?? '', price_yearly: plan?.price_yearly ?? '', employee_limit: plan?.employee_limit ?? '', user_limit: plan?.user_limit ?? '',
    trial_days: plan?.trial_days ?? 14, billing_frequencies: plan?.billing_frequencies ?? ['monthly', 'yearly'],
    features_en: features.map((f) => (typeof f === 'string' ? f : f.en)).join('\n'),
    features_ta: features.map((f) => (typeof f === 'string' ? '' : f.ta ?? '')).join('\n'),
    is_active: plan?.is_active ?? true, is_public: plan?.is_public ?? true, is_featured: plan?.is_featured ?? false, sort_order: plan?.sort_order ?? 10,
  } as PlanForm;
}

function PlanDialog({ plan, open, onOpenChange }: { plan: Plan | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<PlanForm>({ resolver: zodResolver(planFormSchema) as never, values: toForm(plan) });
  const onSubmit = async (raw: PlanForm) => {
    const v = planFormSchema.parse(raw);
    const en = v.features_en.split('\n').map((s) => s.trim()).filter(Boolean);
    const ta = v.features_ta.split('\n').map((s) => s.trim());
    const features: PlanFeature[] = en.map((e, i) => (ta[i] ? { en: e, ta: ta[i] } : { en: e }));
    const { features_en: _a, features_ta: _b, ...rest } = v;
    void _a; void _b;
    try {
      const row = { ...rest, description: rest.description ?? null, features };
      if (plan) unwrap(await sb().from('plans').update(row).eq('id', plan.id).select('id').single());
      else unwrap(await sb().from('plans').insert(row).select('id').single());
      toast.success(t('common.saved'));
      await Promise.all([qc.invalidateQueries({ queryKey: ['plans-all'] }), qc.invalidateQueries({ queryKey: ['public-plans'] })]);
      onOpenChange(false);
    } catch (err) {
      toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    }
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={plan ? t('plans.edit', { name: plan.name }) : t('plans.new')} size="lg">
      <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('plans.key')} required disabled={Boolean(plan)} hint={t('plans.keyHint')} error={errors.key?.message} {...register('key')} />
            <TextField label={t('plans.name')} required error={errors.name?.message} {...register('name')} />
            <TextField label={t('plans.priceMonthly')} type="number" min={0} hint={t('plans.priceHint')} error={errors.price_monthly?.message} {...register('price_monthly')} />
            <TextField label={t('plans.priceYearly')} type="number" min={0} error={errors.price_yearly?.message} {...register('price_yearly')} />
            <TextField label={t('subs.employeeLimit')} type="number" min={1} hint={t('plans.blankUnlimited')} error={errors.employee_limit?.message} {...register('employee_limit')} />
            <TextField label={t('subs.userLimit')} type="number" min={1} hint={t('plans.blankUnlimited')} error={errors.user_limit?.message} {...register('user_limit')} />
            <TextField label={t('plans.trialDays')} type="number" min={0} max={90} error={errors.trial_days?.message} {...register('trial_days')} />
            <TextField label={t('plans.sortOrder')} type="number" min={0} error={errors.sort_order?.message} {...register('sort_order')} />
          </div>
          <TextareaField label={t('plans.description')} rows={2} error={errors.description?.message} {...register('description')} />
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('plans.frequencies')}</legend>
            <div className="flex flex-wrap gap-4">{BILLING_FREQUENCIES.map((f) => <label key={f} className="flex items-center gap-2 text-sm"><input type="checkbox" value={f} className="size-5 accent-[hsl(var(--primary))]" {...register('billing_frequencies')} />{t(`billing.${f}`)}</label>)}</div>
            {errors.billing_frequencies && <p className="mt-1 text-xs text-destructive">{t(String(errors.billing_frequencies.message))}</p>}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextareaField label={t('plans.featuresEn')} rows={6} hint={t('plans.featuresHint')} {...register('features_en')} />
            <TextareaField label={t('plans.featuresTa')} rows={6} hint={t('plans.featuresTaHint')} lang="ta" {...register('features_ta')} />
          </div>
          <div className="flex flex-wrap gap-6">
            <CheckField label={t('common.active')} {...register('is_active')} />
            <CheckField label={t('plans.public')} {...register('is_public')} />
            <CheckField label={t('plans.featured')} {...register('is_featured')} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}

type SubRow = Subscription & { plans: Plan; companies: { id: string; name: string; city: string | null; status: string } };

export function SubscriptionsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Plan | null | false>(false);
  const [verify, setVerify] = useState<Payment | null>(null);
  const plans = useAllPlans();
  const subs = useQuery({ queryKey: ['subscriptions-admin'], queryFn: async () => unwrap(await sb().from('subscriptions').select('*, plans(*), companies(id, name, city, status)').order('created_at', { ascending: false }).limit(2000)) as unknown as SubRow[] });
  const pending = useQuery({ queryKey: ['payments-admin'], queryFn: async () => unwrap(await sb().from('payments').select('*, companies(id, name), invoices(invoice_number)').eq('status', 'pending').order('created_at')) as unknown as Payment[] });
  const verifyMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/admin/payments', { method: 'POST', body }),
    onSuccess: async () => {
      toast.success(t('common.saved'));
      setVerify(null);
      await Promise.all(['payments-admin', 'subscriptions-admin', 'billing', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  const rows = useMemo(() => (subs.data ?? []).filter((s) => (!status || s.status === status) && (!search || s.companies?.name.toLowerCase().includes(search.toLowerCase()))), [subs.data, status, search]);
  const stats = useMemo(() => {
    const all = subs.data ?? [];
    const in30 = Date.now() + 30 * 86_400_000;
    return {
      mrr: computeMrr(all),
      active: all.filter((s) => s.status === 'active').length,
      trials: all.filter((s) => s.status === 'trialing').length,
      renewals: all.filter((s) => s.status === 'active' && s.current_period_end && new Date(s.current_period_end).getTime() < in30).length,
    };
  }, [subs.data]);

  const subCols: Column<SubRow>[] = [
    { key: 'company', header: t('form.companyName'), primary: true, cell: (s) => <span className="font-semibold">{s.companies?.name}</span> },
    { key: 'plan', header: t('subs.plan'), cell: (s) => s.plans?.name },
    { key: 'status', header: t('crm.status'), cell: (s) => <StatusBadge value={s.status} /> },
    { key: 'freq', header: t('subs.billing'), cell: (s) => t(`billing.${s.billing_frequency}`) },
    { key: 'amount', header: t('subs.amount'), align: 'right', cell: (s) => formatCurrency(s.amount, lang) },
    { key: 'ends', header: t('subs.periodEnd'), cell: (s) => formatDate(s.status === 'trialing' ? s.trial_end : s.current_period_end, lang) },
  ];
  const payCols: Column<Payment>[] = [
    { key: 'company', header: t('form.companyName'), primary: true, cell: (p) => <span className="font-semibold">{p.companies?.name}</span> },
    { key: 'amount', header: t('subs.amount'), align: 'right', cell: (p) => formatCurrency(p.amount, lang) },
    { key: 'method', header: t('billing.method'), cell: (p) => t(`paymentMethod.${p.method}`) },
    { key: 'ref', header: t('billing.reference'), cell: (p) => p.reference ?? '—' },
    { key: 'invoice', header: t('billing.invoice'), cell: (p) => p.invoices?.invoice_number ?? '—' },
    { key: 'date', header: t('billing.paidOn'), cell: (p) => formatDate(p.paid_on ?? p.created_at, lang) },
    {
      key: 'actions', header: '', cell: (p) => can('payments.verify') ? (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" onClick={() => setVerify(p)}><BadgeCheck />{t('billing.verify')}</Button>
          <Button size="sm" variant="ghost" onClick={() => verifyMutation.mutate({ action: 'reject', payment_id: p.id })}>{t('billing.reject')}</Button>
        </div>
      ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t('subs.title')} description={t('subs.subtitle')} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('dashboard.mrr')} value={stats.mrr} icon={Wallet} tone="success" format={(n) => formatCurrency(Math.round(n), lang)} />
        <StatCard label={t('subs.activeCount')} value={stats.active} icon={CreditCard} index={1} />
        <StatCard label={t('dashboard.activeTrials')} value={stats.trials} icon={Package} tone="info" index={2} />
        <StatCard label={t('dashboard.renewals')} value={stats.renewals} icon={BadgeCheck} tone="warning" hint={t('dashboard.next30')} index={3} />
      </div>
      <Tabs defaultValue="subscriptions">
        <TabsList>
          <TabsTrigger value="subscriptions">{t('subs.subscriptions')}</TabsTrigger>
          <TabsTrigger value="payments">{t('subs.pendingPayments')}{(pending.data?.length ?? 0) > 0 && <Badge tone="warning">{pending.data?.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="plans">{t('plans.title')}</TabsTrigger>
        </TabsList>
        <TabsContent value="subscriptions">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <Input type="search" aria-label={t('common.search')} placeholder={t('customers.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
            <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44">
              <option value="">{t('crm.allStatuses')}</option>
              {SUBSCRIPTION_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
            </Select>
            <Button variant="outline" className="sm:ml-auto" onClick={() => downloadCsv('subscriptions', rows, [
              { header: 'Company', value: (s) => s.companies?.name }, { header: 'Plan', value: (s) => s.plans?.name }, { header: 'Status', value: (s) => s.status },
              { header: 'Billing', value: (s) => s.billing_frequency }, { header: 'Amount', value: (s) => s.amount }, { header: 'Trial end', value: (s) => formatDate(s.trial_end) },
              { header: 'Period end', value: (s) => formatDate(s.current_period_end) }, { header: 'Cancel at period end', value: (s) => (s.cancel_at_period_end ? 'Yes' : 'No') },
            ])}><Download />{t('common.exportCsv')}</Button>
          </div>
          <QueryState query={subs} isEmpty={() => rows.length === 0} empty={<EmptyState icon={CreditCard} title={t('subs.empty')} />}>
            {() => <DataTable caption={t('subs.subscriptions')} columns={subCols} rows={rows} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/admin/customers/${s.company_id}`)} />}
          </QueryState>
        </TabsContent>
        <TabsContent value="payments">
          <p className="mb-3 text-sm text-muted-foreground">{t('billing.verifyNote')}</p>
          <QueryState query={pending} empty={<EmptyState icon={BadgeCheck} title={t('subs.noPending')} />}>
            {(rows2) => <DataTable caption={t('subs.pendingPayments')} columns={payCols} rows={rows2} rowKey={(p) => p.id} onRowClick={(p) => navigate(`/admin/customers/${p.company_id}`)} />}
          </QueryState>
        </TabsContent>
        <TabsContent value="plans">
          {can('subscriptions.manage') && <Button className="mb-4" onClick={() => setEditing(null)}><Plus />{t('plans.new')}</Button>}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.data?.map((p) => (
              <Card key={p.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="text-lg font-bold">{p.name}</p><p className="text-xs text-muted-foreground">{p.key}</p></div>
                  <div className="flex flex-wrap justify-end gap-1">
                    {!p.is_active && <Badge tone="neutral">{t('plans.inactive')}</Badge>}
                    {!p.is_public && <Badge tone="outline">{t('plans.private')}</Badge>}
                    {p.is_featured && <Badge tone="primary">{t('pricing.popular')}</Badge>}
                  </div>
                </div>
                <p className="mt-3 text-2xl font-extrabold">{p.price_monthly !== null ? formatCurrency(p.price_monthly, lang) : t('pricing.custom')}<span className="text-sm font-normal text-muted-foreground">{p.price_monthly !== null && t('pricing.perMonth')}</span></p>
                <p className="text-xs text-muted-foreground">{t('plans.summary', { employees: p.employee_limit ?? '∞', users: p.user_limit ?? '∞', days: p.trial_days })}</p>
                <ul className="mt-3 flex-1 space-y-1 text-sm">{p.features.slice(0, 5).map((f, i) => <li key={i} className="truncate">• {planFeatureText(f, lang)}</li>)}</ul>
                {can('subscriptions.manage') && <Button variant="outline" size="sm" className="mt-4" onClick={() => setEditing(p)}><Pencil />{t('common.edit')}</Button>}
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      {editing !== false && <PlanDialog plan={editing} open onOpenChange={(o) => !o && setEditing(false)} />}
      <ConfirmDialog
        open={Boolean(verify)}
        onOpenChange={(o) => !o && setVerify(null)}
        title={t('billing.verifyTitle')}
        description={verify ? t('billing.verifyBody', { amount: formatCurrency(verify.amount, lang), reference: verify.reference ?? '—' }) : undefined}
        confirmLabel={t('billing.verify')}
        loading={verifyMutation.isPending}
        onConfirm={() => verify && verifyMutation.mutate({ action: 'verify', payment_id: verify.id })}
      />
    </>
  );
}
