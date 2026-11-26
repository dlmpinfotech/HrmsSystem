import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, Building2, CalendarClock, CalendarDays, LayoutDashboard, Clock, CreditCard, ExternalLink, FlaskConical, Home, LifeBuoy, Palette, Receipt, Search, ShieldAlert, Sparkles, Users, Video, Wallet, FolderOpen, Headset, Laptop, ChartColumn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { WhatsAppButton } from '@/components/shared/brand';
import { EmptyState, FullPageLoader, QueryState } from '@/components/shared/states';
import { PageHeader, StatusBadge } from '@/components/shared/widgets';
import { AppShell, type NavItem } from '@/components/layout/AppShell';
import { hrmsTarget } from '@shared/hrmsLink';
import { useAuth } from '@/features/auth/AuthProvider';
import { useApplyCompanyBranding } from '@/features/branding/useBranding';
import { VideoGallery } from '@/features/content/VideoGallery';
import { CompanyProfileForm } from '@/features/customers/CustomersPage';
import { CompanyPeople } from '@/features/customers/people';
import { useMyEmployee } from '@/features/hr/api';
import { OnboardingChecklist } from '@/features/customers/shared';
import { BillingPanel, SubscriptionPanel, useCompanySubscription } from '@/features/subscriptions/billing';
import { planFeatureText } from '@/features/subscriptions/plans';
import { useTheme } from '@/features/branding/ThemeProvider';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { daysUntil, formatDate } from '@/lib/format';
import { publicAssetUrl, sb, unwrap } from '@/lib/supabase';
import type { HelpArticle } from '@/types/db';

function PortalBanner() {
  const { t, i18n } = useTranslation();
  const { activeCompany } = useAuth();
  const sub = useCompanySubscription(activeCompany!.id);
  const current = sub.data?.current;
  if (activeCompany?.status === 'suspended') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-5 py-2.5 text-sm">
        <ShieldAlert className="size-4 text-destructive" aria-hidden />
        <span className="flex-1">{t('portal.suspended')}</span>
        <WhatsAppButton intent="customer_support" vars={{ company: activeCompany.name }} size="sm" />
      </div>
    );
  }
  if (current?.status === 'trialing') {
    const days = daysUntil(current.trial_end) ?? 0;
    return (
      <div className="flex flex-wrap items-center gap-3 border-b bg-primary/10 px-5 py-2.5 text-sm">
        <FlaskConical className="size-4 text-primary" aria-hidden />
        <span className="flex-1">{t('portal.trialBanner', { count: Math.max(days, 0), date: formatDate(current.trial_end, i18n.language) })}</span>
        <Button size="sm" asChild><Link to="/portal/subscription">{t('portal.choosePlan')}</Link></Button>
      </div>
    );
  }
  if (current?.status === 'past_due') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-5 py-2.5 text-sm">
        <Receipt className="size-4 text-warning" aria-hidden />
        <span className="flex-1">{t('portal.pastDue')}</span>
        <Button size="sm" variant="outline" asChild><Link to="/portal/billing">{t('billing.title')}</Link></Button>
      </div>
    );
  }
  return null;
}

export function PortalLayout() {
  const { t } = useTranslation();
  const { activeCompany, isCompanyAdmin, isHr, isEmployeeOnly, profile } = useAuth();
  const { resolved } = useTheme();
  const branding = useApplyCompanyBranding(activeCompany?.id, activeCompany?.name, profile?.preferred_language);
  const me = useMyEmployee();
  if (!activeCompany) return <FullPageLoader />;
  const b = branding.data;
  const logo = publicAssetUrl(resolved === 'dark' ? b?.logo_dark_path ?? b?.logo_path : b?.logo_light_path ?? b?.logo_path);
  const hrGroup = t('portal.nav.hrGroup');
  const hrNav: NavItem[] = isHr
    ? [
        { to: '/portal/hr', label: t('portal.nav.hrOverview'), icon: LayoutDashboard, group: hrGroup, mobile: true },
        { to: '/portal/employees', label: t('portal.nav.employees'), icon: Users },
        { to: '/portal/attendance', label: t('portal.nav.attendance'), icon: Clock, mobile: true },
        { to: '/portal/shifts', label: t('portal.nav.shifts'), icon: CalendarClock },
        { to: '/portal/leave', label: t('portal.nav.leave'), icon: CalendarDays, mobile: true },
        { to: '/portal/payroll', label: t('portal.nav.payroll'), icon: Wallet },
        { to: '/portal/helpdesk', label: t('portal.nav.helpdesk'), icon: Headset },
        { to: '/portal/assets', label: t('portal.nav.assets'), icon: Laptop },
        { to: '/portal/analytics', label: t('portal.nav.analytics'), icon: ChartColumn },
      ]
    : me.data
      ? [
          { to: '/portal/attendance', label: t('portal.nav.attendance'), icon: Clock, group: hrGroup, mobile: true },
          { to: '/portal/leave', label: t('portal.nav.leave'), icon: CalendarDays, mobile: true },
          { to: '/portal/payslips', label: t('portal.nav.payslips'), icon: Wallet },
          { to: '/portal/documents', label: t('portal.nav.documents'), icon: FolderOpen },
          { to: '/portal/helpdesk', label: t('portal.nav.helpdesk'), icon: Headset },
        ]
      : [];
  const nav: NavItem[] = isEmployeeOnly
    ? [
        { to: '/portal/attendance', label: t('portal.nav.attendance'), icon: Clock, mobile: true },
        { to: '/portal/leave', label: t('portal.nav.leave'), icon: CalendarDays, mobile: true },
        { to: '/portal/payslips', label: t('portal.nav.payslips'), icon: Wallet, mobile: true },
        { to: '/portal/documents', label: t('portal.nav.documents'), icon: FolderOpen },
        { to: '/portal/helpdesk', label: t('portal.nav.helpdesk'), icon: Headset },
        { to: '/portal/help', label: t('portal.nav.help'), icon: BookOpen, group: t('portal.nav.helpGroup') },
        { to: '/portal/videos', label: t('portal.nav.videos'), icon: Video },
      ]
    : [
    { to: '/portal', label: t('portal.nav.dashboard'), icon: Home, end: true, mobile: true },
    { to: '/portal/company', label: t('portal.nav.company'), icon: Building2 },
    ...(isCompanyAdmin ? [{ to: '/portal/branding', label: t('portal.nav.branding'), icon: Palette }] : []),
    { to: '/portal/subscription', label: t('portal.nav.subscription'), icon: CreditCard },
    ...(isCompanyAdmin ? [{ to: '/portal/billing', label: t('portal.nav.billing'), icon: Receipt }] : []),
    ...hrNav,
    { to: '/portal/support', label: t('portal.nav.support'), icon: LifeBuoy, group: t('portal.nav.helpGroup') },
    { to: '/portal/help', label: t('portal.nav.help'), icon: BookOpen },
    { to: '/portal/videos', label: t('portal.nav.videos'), icon: Video },
  ];
  return <AppShell nav={nav} brandName={b?.display_name ?? activeCompany.display_name ?? activeCompany.name} logoUrl={logo} homeTo="/portal" banner={isEmployeeOnly ? undefined : <PortalBanner />} />;
}

export function PortalDashboardPage() {
  const { t } = useTranslation();
  const { activeCompany, isCompanyAdmin, isHr } = useAuth();
  const { branding } = useTheme();
  const sub = useCompanySubscription(activeCompany!.id);
  const tickets = useQuery({
    queryKey: ['tickets-open-count', activeCompany!.id],
    queryFn: async () => (await sb().from('support_tickets').select('id', { count: 'exact', head: true }).eq('company_id', activeCompany!.id).not('status', 'in', '(resolved,closed)')).count ?? 0,
  });
  const hrms = hrmsTarget(activeCompany?.hrms_url, isHr);
  const current = sub.data?.current;
  const canOpenHrms = activeCompany?.status !== 'suspended' && activeCompany?.status !== 'cancelled';
  const quick = [
    { to: '/portal/company', icon: Building2, label: t('portal.nav.company') },
    ...(isCompanyAdmin ? [{ to: '/portal/branding', icon: Palette, label: t('portal.nav.branding') }] : []),
    { to: '/portal/support', icon: LifeBuoy, label: t('portal.nav.support') },
    { to: '/portal/help', icon: BookOpen, label: t('portal.nav.help') },
  ];

  return (
    <>
      <PageHeader
        title={t('portal.welcome', { company: branding?.display_name ?? activeCompany!.name })}
        description={branding?.tagline || t('portal.subtitle')}
        actions={
          !canOpenHrms ? (
            <Button size="lg" disabled><LayoutDashboard />{t('portal.openHrms')}</Button>
          ) : hrms.external ? (
            <Button asChild size="lg"><a href={hrms.href} target="_blank" rel="noopener noreferrer"><ExternalLink />{t('portal.openHrms')}</a></Button>
          ) : (
            <Button asChild size="lg"><Link to={hrms.href}><LayoutDashboard />{t('portal.openHrms')}</Link></Button>
          )
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: t('subs.plan'), value: current?.plans?.name ?? '—', icon: Sparkles, extra: <StatusBadge value={current?.status} /> },
          { label: current?.status === 'trialing' ? t('subs.trialEnds') : t('subs.renewsOn'), value: formatDate(current?.status === 'trialing' ? current?.trial_end : current?.current_period_end), icon: CreditCard },
          { label: t('portal.openTickets'), value: String(tickets.data ?? '—'), icon: LifeBuoy },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="flex items-center gap-3 p-4">
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><s.icon className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{s.label}</p><p className="truncate text-lg font-bold">{s.value}</p></div>
              {s.extra}
            </Card>
          </motion.div>
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader><CardTitle>{t('onboarding.title')}</CardTitle></CardHeader>
          <CardContent><OnboardingChecklist companyId={activeCompany!.id} editable={isCompanyAdmin} /></CardContent>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{t('portal.quickLinks')}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {quick.map((q) => (
                <Link key={q.to} to={q.to} className="flex flex-col items-center gap-2 rounded-xl border p-4 text-center text-sm font-medium transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-card">
                  <q.icon className="size-5 text-primary" aria-hidden />{q.label}
                </Link>
              ))}
            </CardContent>
          </Card>
          <Card className="p-5">
            <p className="font-semibold">{t('portal.needHelp')}</p>
            <p className="mb-3 mt-1 text-sm text-muted-foreground">{t('portal.needHelpBody')}</p>
            <WhatsAppButton intent="customer_support" vars={{ company: activeCompany!.name }} size="sm" />
          </Card>
        </div>
      </div>
    </>
  );
}

export function PortalCompanyPage() {
  const { t } = useTranslation();
  const { activeCompany, isCompanyAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'users' ? 'users' : 'profile';
  return (
    <>
      <PageHeader title={t('company.profile')} description={t('company.subtitle')} />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'profile' ? {} : { tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="profile"><Building2 />{t('company.profile')}</TabsTrigger>
          <TabsTrigger value="users"><Users />{t('team.users')}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <Card><CardContent className="pt-5">{isCompanyAdmin ? <CompanyProfileForm company={activeCompany!} staffMode={false} /> : <p className="text-sm text-muted-foreground">{t('company.readOnly')}</p>}</CardContent></Card>
        </TabsContent>
        <TabsContent value="users"><CompanyPeople companyId={activeCompany!.id} editable={isCompanyAdmin} addPath="/portal/company/users/new" /></TabsContent>
      </Tabs>
    </>
  );
}

export function PortalSubscriptionPage() {
  const { t, i18n } = useTranslation();
  const { activeCompany } = useAuth();
  const sub = useCompanySubscription(activeCompany!.id);
  const plan = sub.data?.current?.plans;
  return (
    <>
      <PageHeader title={t('portal.nav.subscription')} description={t('portal.subscriptionSubtitle')} />
      <div className="grid gap-5 xl:grid-cols-2">
        <SubscriptionPanel companyId={activeCompany!.id} manage={false} />
        <Card>
          <CardHeader><CardTitle>{t('portal.planIncludes')}</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">{plan?.features?.map((f, i) => <li key={i} className="flex gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />{planFeatureText(f, i18n.language)}</li>)}</ul>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="outline" asChild><Link to="/pricing" target="_blank">{t('portal.comparePlans')}</Link></Button>
              <WhatsAppButton intent="sales_support" size="default">{t('portal.changePlanWhatsApp')}</WhatsAppButton>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t('portal.changePlanNote')}</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function PortalBillingPage() {
  const { t } = useTranslation();
  const { activeCompany } = useAuth();
  const config = usePublicConfig();
  return (
    <>
      <PageHeader title={t('billing.title')} description={t('portal.billingSubtitle')} />
      <BillingPanel companyId={activeCompany!.id} companyName={activeCompany!.name} manage={false} brand={config.brand.name} />
    </>
  );
}

export function useHelpArticles() {
  return useQuery({ queryKey: ['help-articles'], queryFn: async () => unwrap(await sb().from('help_articles').select('*').eq('is_published', true).order('sort_order')) as HelpArticle[] });
}

export function HelpCenterPage() {
  const { t, i18n } = useTranslation();
  const ta = i18n.language === 'ta';
  const query = useHelpArticles();
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const articles = useMemo(
    () => (query.data ?? []).filter((a) => !search || `${a.title} ${a.title_ta ?? ''} ${a.body}`.toLowerCase().includes(search.toLowerCase())),
    [query.data, search],
  );
  return (
    <>
      <PageHeader title={t('help.title')} description={t('help.subtitle')} />
      <div className="relative mb-5 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" aria-label={t('common.search')} placeholder={t('help.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      <QueryState query={query} isEmpty={() => articles.length === 0} empty={<EmptyState icon={BookOpen} title={t('help.empty')} action={<Button asChild><Link to="/portal/support">{t('support.newTicket')}</Link></Button>} />}>
        {() => (
          <div className="space-y-3">
            {articles.map((a) => {
              const open = openId === a.id;
              return (
                <Card key={a.id}>
                  <button className="flex w-full items-center justify-between gap-3 p-4 text-left" aria-expanded={open} onClick={() => setOpenId(open ? null : a.id)}>
                    <span><span className="block text-xs text-muted-foreground">{t(`helpCategory.${a.category}`, { defaultValue: a.category })}</span><span className="font-semibold">{(ta && a.title_ta) || a.title}</span></span>
                    <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                  {open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="whitespace-pre-wrap border-t px-4 py-4 text-sm leading-relaxed">{(ta && a.body_ta) || a.body}</motion.div>}
                </Card>
              );
            })}
          </div>
        )}
      </QueryState>
    </>
  );
}

export function PortalVideosPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('videos.portalTitle')} description={t('videos.portalSubtitle')} />
      <VideoGallery audience="all" />
    </>
  );
}
