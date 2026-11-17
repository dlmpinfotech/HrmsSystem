import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarClock, CalendarDays, Download, FlaskConical, IndianRupee, Percent, RefreshCw, Sparkles, Target, UserCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState } from '@/components/shared/states';
import { PageHeader, StatCard, StatusBadge } from '@/components/shared/widgets';
import { BarList, ChartCard, DonutChart, TrendChart } from '@/features/analytics/charts';
import { computeMrr, countBy, funnel, inRange, leadSummary, presetRange, RANGE_PRESETS, rate, timeSeries, type RangePreset } from '@/features/analytics/metrics';
import { useAuth } from '@/features/auth/AuthProvider';
import { downloadCsv } from '@/lib/csv';
import { formatCompact, formatCurrency, formatDateTime, formatPercent, formatRelative } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import type { DemoBooking, Lead, LeadActivity, Subscription } from '@/types/db';

interface DashboardData {
  leads: Lead[];
  demos: DemoBooking[];
  subscriptions: Subscription[];
  activities: (LeadActivity & { leads: { company_name: string } | null })[];
}

async function loadDashboard(): Promise<DashboardData> {
  const db = sb();
  const [leads, demos, subscriptions, activities] = await Promise.all([
    db.from('leads').select('id, company_name, status, source, city, industry, assigned_to, created_at, expected_value, next_follow_up_at').order('created_at', { ascending: false }).limit(5000),
    db.from('demo_bookings').select('id, starts_at, status, company_name, contact_name, salesperson_id, created_at').order('starts_at', { ascending: false }).limit(2000),
    db.from('subscriptions').select('id, status, amount, billing_frequency, current_period_end, trial_end, created_at, companies(id, name)').limit(5000),
    db.from('lead_activities').select('id, type, body, metadata, created_at, lead_id, leads(company_name)').neq('type', 'system').order('created_at', { ascending: false }).limit(12),
  ]);
  return {
    leads: unwrap(leads) as Lead[],
    demos: unwrap(demos) as DemoBooking[],
    subscriptions: unwrap(subscriptions) as unknown as Subscription[],
    activities: unwrap(activities) as unknown as DashboardData['activities'],
  };
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { profile, can } = useAuth();
  const [preset, setPreset] = useState<RangePreset>('30d');
  const query = useQuery({ queryKey: ['dashboard'], queryFn: loadDashboard, refetchInterval: 5 * 60_000 });
  const range = useMemo(() => presetRange(preset), [preset]);

  const m = useMemo(() => {
    if (!query.data) return null;
    const { leads, demos, subscriptions } = query.data;
    const periodLeads = leads.filter((l) => inRange(l.created_at, range));
    const now = Date.now();
    const in30 = now + 30 * 86_400_000;
    const summary = leadSummary(periodLeads);
    const renewals = subscriptions.filter((s) => s.status === 'active' && s.current_period_end && new Date(s.current_period_end).getTime() <= in30);
    const mrr = computeMrr(subscriptions);
    const paidSubs = subscriptions.filter((s) => s.status === 'active' || s.status === 'past_due');
    const unit = range.to.getTime() - range.from.getTime() > 92 * 86_400_000 ? 'month' : 'day';
    const label = (key: string) => new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-IN', unit === 'day' ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(unit === 'day' ? `${key}T00:00:00Z` : `${key}-01T00:00:00Z`));
    return {
      totalLeads: leads.length,
      newLeads: periodLeads.length,
      qualified: periodLeads.filter((l) => ['qualified', 'demo_scheduled', 'demo_completed', 'trial', 'negotiation', 'won'].includes(l.status)).length,
      demoRequests: demos.filter((d) => inRange(d.created_at, range)).length,
      upcoming: demos.filter((d) => d.status === 'scheduled' && new Date(d.starts_at).getTime() >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      activeTrials: subscriptions.filter((s) => s.status === 'trialing').length,
      paying: paidSubs.length,
      mrr,
      renewals,
      conversion: summary.conversion,
      winRate: summary.winRate,
      leadTrend: timeSeries(periodLeads, (l) => l.created_at, range).map((d) => ({ ...d, label: label(d.key) })),
      revenueTrend: timeSeries(paidSubs, (s) => s.created_at, range, (s) => Number(s.amount)).map((d) => ({ ...d, label: label(d.key) })),
      sources: countBy(periodLeads, (l) => l.source).map((d) => ({ ...d, name: t(`source.${d.name}`, { defaultValue: d.name }) })),
      funnel: funnel(periodLeads).map((d) => ({ ...d, name: t(`leadStatus.${d.name}`) })),
      followUpsDue: leads.filter((l) => l.next_follow_up_at && new Date(l.next_follow_up_at).getTime() <= now + 86_400_000 && !['won', 'lost'].includes(l.status)).length,
      periodLeads,
    };
  }, [query.data, range, lang, t]);

  const exportCsv = () => {
    if (!m) return;
    downloadCsv(`dashboard-leads-${preset}`, m.periodLeads, [
      { header: t('form.companyName'), value: (l) => l.company_name },
      { header: t('crm.status'), value: (l) => t(`leadStatus.${l.status}`) },
      { header: t('crm.source'), value: (l) => t(`source.${l.source}`) },
      { header: t('form.city'), value: (l) => l.city },
      { header: t('form.industry'), value: (l) => (l.industry ? t(`industry.${l.industry}`, { defaultValue: l.industry }) : '') },
      { header: t('crm.created'), value: (l) => formatDateTime(l.created_at, lang) },
    ]);
  };

  const greeting = t('dashboard.greeting', { name: profile?.full_name?.split(' ')[0] || '' });
  return (
    <>
      <PageHeader
        title={greeting}
        description={t('dashboard.subtitle')}
        actions={
          <>
            <label className="sr-only" htmlFor="dash-range">{t('reports.range')}</label>
            <Select id="dash-range" value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} className="h-9 w-40">
              {RANGE_PRESETS.map((p) => <option key={p} value={p}>{t(`range.${p}`)}</option>)}
            </Select>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()} aria-label={t('common.refresh')}><RefreshCw className={query.isFetching ? 'animate-spin' : ''} /></Button>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!m}><Download />{t('common.exportCsv')}</Button>
          </>
        }
      />
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {!query.isError && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-6">
            {[
              { label: t('dashboard.totalLeads'), value: m?.totalLeads ?? 0, icon: Users },
              { label: t('dashboard.newLeads'), value: m?.newLeads ?? 0, icon: Sparkles, tone: 'info' as const },
              { label: t('dashboard.qualified'), value: m?.qualified ?? 0, icon: UserCheck, tone: 'success' as const },
              { label: t('dashboard.demoRequests'), value: m?.demoRequests ?? 0, icon: CalendarDays, tone: 'warning' as const },
              { label: t('dashboard.upcomingDemos'), value: m?.upcoming.length ?? 0, icon: CalendarClock },
              { label: t('dashboard.activeTrials'), value: m?.activeTrials ?? 0, icon: FlaskConical, tone: 'info' as const },
              { label: t('dashboard.paying'), value: m?.paying ?? 0, icon: Target, tone: 'success' as const },
              { label: t('dashboard.mrr'), value: m?.mrr ?? 0, icon: IndianRupee, format: (n: number) => formatCurrency(Math.round(n), lang), tone: 'success' as const },
              { label: t('dashboard.renewals'), value: m?.renewals.length ?? 0, icon: RefreshCw, tone: 'warning' as const, hint: t('dashboard.next30') },
              { label: t('dashboard.conversion'), value: (m?.conversion ?? 0) * 100, icon: Percent, format: (n: number) => `${n.toFixed(1)}%`, hint: t('dashboard.winRate', { rate: formatPercent(m?.winRate ?? 0) }) },
              { label: t('dashboard.followUps'), value: m?.followUpsDue ?? 0, icon: CalendarClock, tone: 'warning' as const, hint: t('dashboard.dueSoon') },
            ].map((s, i) => (
              <StatCard key={s.label} index={i} {...s} />
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            <ChartCard title={t('dashboard.leadTrend')} loading={!m} className="xl:col-span-2">
              {m && <TrendChart data={m.leadTrend} label={t('dashboard.newLeads')} />}
            </ChartCard>
            <ChartCard title={t('dashboard.sourcePerformance')} loading={!m} empty={m?.sources.length === 0}>
              {m && <DonutChart data={m.sources} label={t('dashboard.newLeads')} />}
            </ChartCard>
          </div>

          <div className="grid gap-5 xl:grid-cols-3">
            {can('reports.view') && (
              <ChartCard title={t('dashboard.revenueTrend')} loading={!m} className="xl:col-span-2">
                {m && <TrendChart data={m.revenueTrend} label={t('dashboard.newRevenue')} format={(n) => formatCompact(n, lang)} />}
              </ChartCard>
            )}
            <ChartCard title={t('dashboard.funnel')} loading={!m} className={can('reports.view') ? undefined : 'xl:col-span-3'}>
              {m && <BarList data={m.funnel} label={t('dashboard.leads')} />}
            </ChartCard>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>{t('dashboard.upcomingDemos')}</CardTitle>
                <Button variant="link" asChild><Link to="/admin/demos">{t('common.viewAll')}</Link></Button>
              </CardHeader>
              <CardContent>
                {m && m.upcoming.length === 0 && <EmptyState icon={CalendarDays} title={t('dashboard.noDemos')} />}
                <ul className="divide-y">
                  {m?.upcoming.slice(0, 6).map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.company_name}</p>
                        <p className="truncate text-xs text-muted-foreground">{d.contact_name}</p>
                      </div>
                      <p className="shrink-0 text-right text-sm font-medium">{formatDateTime(d.starts_at, lang)}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('dashboard.activity')}</CardTitle></CardHeader>
              <CardContent>
                {query.data && query.data.activities.length === 0 && <EmptyState title={t('dashboard.noActivity')} />}
                <ul className="space-y-3">
                  {query.data?.activities.map((a) => (
                    <li key={a.id} className="flex gap-3 text-sm">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">
                          <Link to={`/admin/leads/${a.lead_id}`} className="font-medium hover:underline">{a.leads?.company_name}</Link>
                          {' · '}
                          {a.type === 'status_change' ? (
                            <>{t('crm.movedTo')} <StatusBadge value={String(a.metadata.to)} group="leadStatus" /></>
                          ) : (
                            <span className="text-muted-foreground">{t(`activityType.${a.type}`)}</span>
                          )}
                        </p>
                        {a.body && <p className="truncate text-muted-foreground">{a.body}</p>}
                      </div>
                      <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.created_at}>{formatRelative(a.created_at, lang)}</time>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">{t('dashboard.rateNote', { conversion: formatPercent(rate(m?.paying ?? 0, m?.totalLeads ?? 0), 1) })}</p>
        </div>
      )}
    </>
  );
}
