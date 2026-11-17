import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, CalendarPlus, Download, Pause, Play, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton, QueryState } from '@/components/shared/states';
import { FormDialog, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { brandingKey } from '@/features/branding/useBranding';
import { CompanyPeople } from '@/features/customers/people';
import { OnboardingChecklist } from '@/features/customers/shared';
import { BillingPanel, SubscriptionPanel } from '@/features/subscriptions/billing';
import { TicketList } from '@/features/support/TicketsPage';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { staffName, useStaff } from '@/hooks/useStaff';
import { api, errorKey } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import type { Company, Customer, Subscription } from '@/types/db';
import { CITIES, COMPANY_STATUSES, INDUSTRIES } from '@shared/constants';
import { companyProfileSchema } from '@shared/schemas';
import type { z } from 'zod';

type CustomerRow = Company & { customers: Customer[] | Customer | null; subscriptions: (Subscription & { plans: { name: string } | null })[] };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export function CustomersPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: staff } = useStaff();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const query = useQuery({
    queryKey: ['customers'],
    queryFn: async () => unwrap(await sb().from('companies').select('*, customers(*), subscriptions(id, status, amount, billing_frequency, trial_end, current_period_end, plans(name))').order('created_at', { ascending: false })) as unknown as CustomerRow[],
  });
  const rows = useMemo(
    () => (query.data ?? []).filter((c) => (!status || c.status === status) && (!search || `${c.name} ${c.city ?? ''} ${c.tenant_code}`.toLowerCase().includes(search.toLowerCase()))),
    [query.data, search, status],
  );
  const live = (c: CustomerRow) => c.subscriptions.find((s) => ['trialing', 'active', 'past_due'].includes(s.status)) ?? c.subscriptions[0];

  const columns: Column<CustomerRow>[] = [
    { key: 'name', header: t('form.companyName'), primary: true, cell: (c) => <div><p className="font-semibold">{c.name}</p><p className="text-xs text-muted-foreground">{c.tenant_code}</p></div> },
    { key: 'city', header: t('form.city'), cell: (c) => (c.city ? t(`city.${c.city}`, { defaultValue: c.city }) : '—') },
    { key: 'plan', header: t('subs.plan'), cell: (c) => live(c)?.plans?.name ?? '—' },
    { key: 'sub', header: t('subs.subscription'), cell: (c) => <StatusBadge value={live(c)?.status} /> },
    { key: 'status', header: t('customers.account'), cell: (c) => <StatusBadge value={c.status} /> },
    { key: 'owner', header: t('customers.owner'), cell: (c) => staffName(staff, one(c.customers)?.account_owner_id), hideOnMobile: true },
    { key: 'since', header: t('customers.since'), cell: (c) => formatDate(c.created_at, i18n.language), hideOnMobile: true },
  ];

  const exportCsv = () =>
    downloadCsv('customers', rows, [
      { header: 'Tenant', value: (c) => c.tenant_code },
      { header: 'Company', value: (c) => c.name },
      { header: 'City', value: (c) => c.city },
      { header: 'Industry', value: (c) => c.industry },
      { header: 'Employees', value: (c) => c.employee_count },
      { header: 'Account status', value: (c) => c.status },
      { header: 'Plan', value: (c) => live(c)?.plans?.name },
      { header: 'Subscription status', value: (c) => live(c)?.status },
      { header: 'Amount', value: (c) => live(c)?.amount },
      { header: 'Created', value: (c) => formatDate(c.created_at) },
    ]);

  return (
    <>
      <PageHeader title={t('customers.title')} description={t('customers.subtitle')} actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download />{t('common.exportCsv')}</Button>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input type="search" placeholder={t('customers.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-sm" />
        <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
          <option value="">{t('crm.allStatuses')}</option>
          {COMPANY_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
      </div>
      <QueryState query={query} isEmpty={() => rows.length === 0} empty={<EmptyState icon={Building2} title={t('customers.empty')} description={t('customers.emptyBody')} />}>
        {() => <DataTable caption={t('customers.title')} columns={columns} rows={rows} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/admin/customers/${c.id}`)} />}
      </QueryState>
    </>
  );
}

// ── Company profile form (shared by staff and the customer portal) ────
export function CompanyProfileForm({ company, staffMode }: { company: Company; staffMode: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [hrmsUrl, setHrmsUrl] = useState(company.hrms_url ?? '');
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<z.input<typeof companyProfileSchema>>({
    resolver: zodResolver(companyProfileSchema),
    values: {
      name: company.name, industry: company.industry ?? '', city: company.city ?? '', state: company.state ?? '', address: company.address ?? '', pincode: company.pincode ?? '',
      gst_number: company.gst_number ?? '', website: company.website ?? '', employee_count: company.employee_count ?? '', default_language: company.default_language,
    },
  });
  const onSubmit = async (raw: z.input<typeof companyProfileSchema>) => {
    const v = companyProfileSchema.parse(raw);
    const patch: Record<string, unknown> = { ...v, display_name: v.name, industry: v.industry ?? null, city: v.city ?? null, state: v.state ?? null, address: v.address ?? null, pincode: v.pincode ?? null, gst_number: v.gst_number ?? null, website: v.website ?? null, employee_count: v.employee_count ?? null };
    if (staffMode) patch.hrms_url = hrmsUrl.trim() || null;
    try {
      unwrap(await sb().from('companies').update(patch).eq('id', company.id).select('id').single());
      // A rename also renames the portal (sidebar, welcome text). A different display name can still be set in Branding afterwards.
      if (v.name !== company.name) {
        await sb().from('company_branding').update({ display_name: v.name }).eq('company_id', company.id);
      }
      toast.success(t('common.saved'));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['customer', company.id] }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
        qc.invalidateQueries({ queryKey: brandingKey(company.id) }),
        refresh(),
      ]);
    } catch (err) {
      toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    }
  };
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t('form.companyName')} required hint={t('company.nameHint')} error={errors.name?.message} {...register('name')} />
        <SelectField label={t('form.industry')} error={errors.industry?.message} {...register('industry')}>
          <option value="">{t('form.select')}</option>
          {INDUSTRIES.map((i) => <option key={i} value={i}>{t(`industry.${i}`)}</option>)}
        </SelectField>
        <SelectField label={t('form.city')} error={errors.city?.message} {...register('city')}>
          <option value="">{t('form.select')}</option>
          {CITIES.map((c) => <option key={c} value={c}>{t(`city.${c}`)}</option>)}
        </SelectField>
        <TextField label={t('company.state')} error={errors.state?.message} {...register('state')} />
        <TextField label={t('company.pincode')} inputMode="numeric" error={errors.pincode?.message} {...register('pincode')} />
        <TextField label={t('company.gst')} error={errors.gst_number?.message} {...register('gst_number')} />
        <TextField label={t('company.website')} type="url" placeholder="https://" error={errors.website?.message} {...register('website')} />
        <TextField label={t('crm.employeeCount')} type="number" min={1} error={errors.employee_count?.message} {...register('employee_count')} />
        <SelectField label={t('company.defaultLanguage')} hint={t('company.defaultLanguageHint')} {...register('default_language')}>
          <option value="en">English</option>
          <option value="ta">தமிழ்</option>
        </SelectField>
        {staffMode ? (
          <TextField label={t('company.hrmsUrl')} type="url" placeholder="https://" value={hrmsUrl} onChange={(e) => setHrmsUrl(e.target.value)} hint={t('company.hrmsUrlHint')} />
        ) : (
          <TextField label={t('company.tenantCode')} value={company.tenant_code} readOnly disabled />
        )}
      </div>
      <TextareaField label={t('company.address')} rows={2} error={errors.address?.message} {...register('address')} />
      <Button type="submit" loading={isSubmitting} disabled={!isDirty && (!staffMode || hrmsUrl === (company.hrms_url ?? ''))}><Save />{t('common.saveChanges')}</Button>
    </form>
  );
}

function AccountActions({ company, customer }: { company: Company; customer: Customer | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('7');
  const action = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/admin/customers', { method: 'POST', body: { company_id: company.id, ...body } }),
    onSuccess: async () => {
      toast.success(t('common.saved'));
      setSuspendOpen(false);
      setExtendOpen(false);
      await Promise.all(['customer', 'subscription', 'customers'].map((k) => qc.invalidateQueries({ queryKey: k === 'customers' ? [k] : [k, company.id] })));
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });
  return (
    <div className="flex flex-wrap gap-2">
      {company.status !== 'active' && <Button size="sm" onClick={() => action.mutate({ action: 'activate' })} loading={action.isPending}><Play />{t('customers.activate')}</Button>}
      {company.status !== 'suspended' && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setSuspendOpen(true)}><Pause />{t('customers.suspend')}</Button>}
      <Button size="sm" variant="outline" onClick={() => setExtendOpen(true)}><CalendarPlus />{t('customers.extendTrial')}</Button>
      {customer?.suspension_reason && company.status === 'suspended' && <p className="w-full text-sm text-destructive">{t('customers.suspendedBecause', { reason: t(`suspension.${customer.suspension_reason}`, { defaultValue: customer.suspension_reason }) })}</p>}
      <FormDialog open={suspendOpen} onOpenChange={setSuspendOpen} title={t('customers.suspend')} description={t('customers.suspendHint')} size="sm">
        <DialogBody><TextareaField label={t('manageDemo.reason')} required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></DialogBody>
        <DialogFooter><Button variant="outline" onClick={() => setSuspendOpen(false)}>{t('common.cancel')}</Button><Button variant="destructive" disabled={!reason.trim()} loading={action.isPending} onClick={() => action.mutate({ action: 'suspend', reason })}>{t('customers.suspend')}</Button></DialogFooter>
      </FormDialog>
      <FormDialog open={extendOpen} onOpenChange={setExtendOpen} title={t('customers.extendTrial')} size="sm">
        <DialogBody><TextField label={t('customers.days')} type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} /></DialogBody>
        <DialogFooter><Button variant="outline" onClick={() => setExtendOpen(false)}>{t('common.cancel')}</Button><Button loading={action.isPending} onClick={() => action.mutate({ action: 'extend_trial', days: Number(days) })}>{t('customers.extend')}</Button></DialogFooter>
      </FormDialog>
    </div>
  );
}

export function CustomerDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const { can } = useAuth();
  const config = usePublicConfig();
  const manage = can('customers.manage');
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') ?? '';
  const tab = ['billing', 'users', 'support', 'profile'].includes(requested) ? requested : 'overview';
  const query = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const [company, customer] = await Promise.all([sb().from('companies').select('*').eq('id', id).single(), sb().from('customers').select('*').eq('company_id', id).maybeSingle()]);
      return { company: unwrap(company) as Company, customer: unwrap(customer) as Customer | null };
    },
  });
  if (query.isPending) return <ListSkeleton rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const { company, customer } = query.data;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to="/admin/customers"><ArrowLeft />{t('customers.back')}</Link></Button>
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight">{company.name}</h1><StatusBadge value={company.status} /></div>
          <p className="text-sm text-muted-foreground">{company.tenant_code} · {t('customers.since')} {formatDate(company.created_at, i18n.language)}{customer?.lead_id && <> · <Link className="text-primary hover:underline" to={`/admin/leads/${customer.lead_id}`}>{t('customers.originLead')}</Link></>}</p>
        </div>
        {manage && <AccountActions company={company} customer={customer} />}
      </div>
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'overview' ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="overview">{t('customers.overview')}</TabsTrigger>
          <TabsTrigger value="billing">{t('billing.title')}</TabsTrigger>
          <TabsTrigger value="users">{t('team.users')}</TabsTrigger>
          <TabsTrigger value="support">{t('support.title')}</TabsTrigger>
          <TabsTrigger value="profile">{t('company.profile')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
            <Card><CardHeader><CardTitle>{t('onboarding.title')}</CardTitle></CardHeader><CardContent><OnboardingChecklist companyId={company.id} editable /></CardContent></Card>
            <SubscriptionPanel companyId={company.id} manage={can('subscriptions.manage')} />
          </div>
        </TabsContent>
        <TabsContent value="billing"><BillingPanel companyId={company.id} companyName={company.name} manage={can('payments.verify')} brand={config.brand.name} /></TabsContent>
        <TabsContent value="users"><CompanyPeople companyId={company.id} editable={manage} addPath={`/admin/customers/${company.id}/users/new`} /></TabsContent>
        <TabsContent value="support"><TicketList companyId={company.id} basePath="/admin/support" /></TabsContent>
        <TabsContent value="profile"><Card><CardContent className="pt-5"><CompanyProfileForm company={company} staffMode /></CardContent></Card></TabsContent>
      </Tabs>
    </>
  );
}
