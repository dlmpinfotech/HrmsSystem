import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { ErrorState, ListSkeleton } from '@/components/shared/states';
import { PageHeader } from '@/components/shared/widgets';
import { BarList, ChartCard, DonutChart, TrendChart } from '@/features/analytics/charts';
import { computeMrr, countBy, funnel, inRange, leadSummary, performanceBy, presetRange, RANGE_PRESETS, rate, timeSeries, type RangePreset } from '@/features/analytics/metrics';
import { staffName, useStaff } from '@/hooks/useStaff';
import { downloadCsv, type CsvColumn } from '@/lib/csv';
import { formatCompact, formatCurrency, formatPercent } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import type { DemoBooking, Lead, Payment, Subscription } from '@/types/db';

export const REPORTS = ['lead', 'sales', 'demo', 'customer', 'revenue', 'subscription', 'trial', 'source', 'city', 'industry', 'salesperson'] as const;
type ReportKey = (typeof REPORTS)[number];

interface Data {
  leads: Lead[];
  demos: DemoBooking[];
  subs: (Subscription & { plans: { name: string } | null; companies: { name: string; city: string | null; industry: string | null; status: string; created_at: string } | null })[];
  payments: Payment[];
}

async function loadData(): Promise<Data> {
  const db = sb();
  const [leads, demos, subs, payments] = await Promise.all([
    db.from('leads').select('id, company_name, status, source, city, industry, assigned_to, created_at, expected_value, priority').limit(10000),
    db.from('demo_bookings').select('id, starts_at, status, outcome, feedback_rating, salesperson_id, created_at, company_name').limit(10000),
    db.from('subscriptions').select('id, status, amount, billing_frequency, trial_start, trial_end, current_period_end, created_at, cancelled_at, plans(name), companies(name, city, industry, status, created_at)').limit(10000),
    db.from('payments').select('id, amount, status, method, paid_on, verified_at, created_at').eq('status', 'verified').limit(10000),
  ]);
  return { leads: unwrap(leads) as Lead[], demos: unwrap(demos) as DemoBooking[], subs: unwrap(subs) as unknown as Data['subs'], payments: unwrap(payments) as Payment[] };
}

interface Row { name: string; total: number; won?: number; lost?: number; conversion?: number; value?: number; extra?: number }

export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { data: staff } = useStaff();
  const [report, setReport] = useState<ReportKey>('lead');
  const [preset, setPreset] = useState<RangePreset>('90d');
  const [city, setCity] = useState('');
  const query = useQuery({ queryKey: ['reports-data'], queryFn: loadData, staleTime: 60_000 });
  const range = useMemo(() => presetRange(preset), [preset]);
  const money = (n: number) => formatCurrency(Math.round(n), lang);

  const view = useMemo(() => {
    if (!query.data) return null;
    const cityOk = (c: string | null | undefined) => !city || c === city;
    const leads = query.data.leads.filter((l) => inRange(l.created_at, range) && cityOk(l.city));
    const demos = query.data.demos.filter((d) => inRange(d.starts_at, range));
    const subs = query.data.subs.filter((s) => cityOk(s.companies?.city));
    const payments = query.data.payments.filter((p) => inRange(p.verified_at ?? p.created_at, range));
    const label = (n: string, ns: string) => t(`${ns}.${n}`, { defaultValue: n === 'unknown' ? t('reports.unknown') : n });
    const perf = (key: (l: Lead) => string | null, ns: string): Row[] => performanceBy(leads, key as never).map((r) => ({ ...r, name: ns === 'staff' ? (r.name === 'unknown' ? t('crm.unassigned') : staffName(staff, r.name)) : label(r.name, ns) }));
    const s = leadSummary(leads);

    switch (report) {
      case 'lead':
        return {
          kpis: [[t('reports.leads'), String(s.total)], [t('reports.open'), String(s.open)], [t('reports.won'), String(s.won)], [t('reports.lost'), String(s.lost)]],
          trend: timeSeries(leads, (l) => l.created_at, range),
          bars: countBy(leads, (l) => l.status).map((d) => ({ ...d, name: t(`leadStatus.${d.name}`) })),
          donut: countBy(leads, (l) => l.priority).map((d) => ({ ...d, name: t(`priority.${d.name}`) })),
          rows: countBy(leads, (l) => l.status).map((d) => ({ name: t(`leadStatus.${d.name}`), total: d.value })),
        };
      case 'sales':
        return {
          kpis: [[t('reports.won'), String(s.won)], [t('dashboard.conversion'), formatPercent(s.conversion, 1)], [t('reports.winRate'), formatPercent(s.winRate, 1)], [t('reports.wonValue'), money(leads.filter((l) => l.status === 'won').reduce((a, l) => a + Number(l.expected_value ?? 0), 0))]],
          trend: timeSeries(leads.filter((l) => l.status === 'won'), (l) => l.created_at, range),
          bars: funnel(leads).map((d) => ({ ...d, name: t(`leadStatus.${d.name}`) })),
          rows: funnel(leads).map((d) => ({ name: t(`leadStatus.${d.name}`), total: d.value, conversion: rate(d.value, leads.length) })),
        };
      case 'demo': {
        const done = demos.filter((d) => d.status === 'completed');
        const rated = done.filter((d) => d.feedback_rating);
        return {
          kpis: [[t('reports.demos'), String(demos.length)], [t('status.completed'), String(done.length)], [t('status.no_show'), String(demos.filter((d) => d.status === 'no_show').length)], [t('reports.avgRating'), rated.length ? (rated.reduce((a, d) => a + (d.feedback_rating ?? 0), 0) / rated.length).toFixed(1) : '—']],
          trend: timeSeries(demos, (d) => d.starts_at, range),
          bars: countBy(done, (d) => d.outcome).map((d) => ({ ...d, name: d.name === 'unknown' ? t('reports.unknown') : t(`demoOutcome.${d.name}`) })),
          donut: countBy(demos, (d) => d.status).map((d) => ({ ...d, name: t(`status.${d.name}`) })),
          rows: countBy(demos, (d) => d.salesperson_id).map((d) => ({ name: staffName(staff, d.name), total: d.value, extra: demos.filter((x) => x.salesperson_id === d.name && x.status === 'completed').length })),
        };
      }
      case 'customer': {
        const companies = subs.map((x) => x.companies).filter(Boolean) as NonNullable<Data['subs'][number]['companies']>[];
        const unique = [...new Map(companies.map((c) => [c.name, c])).values()];
        return {
          kpis: [[t('reports.customers'), String(unique.length)], [t('status.active'), String(unique.filter((c) => c.status === 'active').length)], [t('status.trial'), String(unique.filter((c) => c.status === 'trial').length)], [t('status.suspended'), String(unique.filter((c) => c.status === 'suspended').length)]],
          trend: timeSeries(unique, (c) => c.created_at, range),
          bars: countBy(unique, (c) => c.status).map((d) => ({ ...d, name: t(`status.${d.name}`) })),
          donut: countBy(unique, (c) => c.industry).map((d) => ({ ...d, name: label(d.name, 'industry') })),
          rows: countBy(unique, (c) => c.city).map((d) => ({ name: label(d.name, 'city'), total: d.value })),
        };
      }
      case 'revenue': {
        const total = payments.reduce((a, p) => a + Number(p.amount), 0);
        return {
          kpis: [[t('reports.collected'), money(total)], [t('dashboard.mrr'), money(computeMrr(subs))], [t('reports.arr'), money(computeMrr(subs) * 12)], [t('reports.payments'), String(payments.length)]],
          trend: timeSeries(payments, (p) => p.verified_at ?? p.created_at, range, (p) => Number(p.amount)),
          trendFormat: (n: number) => formatCompact(n, lang),
          donut: countBy(payments, (p) => p.method).map((d) => ({ ...d, name: t(`paymentMethod.${d.name}`) })),
          rows: countBy(payments, (p) => p.method).map((d) => ({ name: t(`paymentMethod.${d.name}`), total: d.value, value: payments.filter((p) => p.method === d.name).reduce((a, p) => a + Number(p.amount), 0) })),
          valueIsMoney: true,
        };
      }
      case 'subscription':
        return {
          kpis: [[t('reports.subscriptions'), String(subs.length)], [t('status.active'), String(subs.filter((x) => x.status === 'active').length)], [t('status.past_due'), String(subs.filter((x) => x.status === 'past_due').length)], [t('status.cancelled'), String(subs.filter((x) => x.status === 'cancelled').length)]],
          trend: timeSeries(subs, (x) => x.created_at, range),
          bars: countBy(subs, (x) => x.plans?.name).map((d) => ({ ...d })),
          donut: countBy(subs, (x) => x.status).map((d) => ({ ...d, name: t(`status.${d.name}`) })),
          rows: countBy(subs, (x) => x.plans?.name).map((d) => ({ name: d.name, total: d.value, value: subs.filter((x) => x.plans?.name === d.name && ['active', 'past_due'].includes(x.status)).reduce((a, x) => a + Number(x.amount), 0) })),
          valueIsMoney: true,
        };
      case 'trial': {
        const trials = subs.filter((x) => x.trial_start && inRange(x.trial_start, range));
        const converted = trials.filter((x) => x.status === 'active' || x.status === 'past_due');
        return {
          kpis: [[t('reports.trialsStarted'), String(trials.length)], [t('dashboard.activeTrials'), String(trials.filter((x) => x.status === 'trialing').length)], [t('reports.converted'), String(converted.length)], [t('reports.trialConversion'), formatPercent(rate(converted.length, trials.length), 1)]],
          trend: timeSeries(trials, (x) => x.trial_start, range),
          donut: countBy(trials, (x) => x.status).map((d) => ({ ...d, name: t(`status.${d.name}`) })),
          bars: countBy(trials, (x) => x.plans?.name),
          rows: countBy(trials, (x) => x.plans?.name).map((d) => ({ name: d.name, total: d.value, won: trials.filter((x) => x.plans?.name === d.name && ['active', 'past_due'].includes(x.status)).length })),
        };
      }
      case 'source':
        return { rows: perf((l) => l.source, 'source'), bars: perf((l) => l.source, 'source').map((r) => ({ name: r.name, value: r.total })), donut: perf((l) => l.source, 'source').map((r) => ({ name: r.name, value: r.won ?? 0 })) };
      case 'city':
        return { rows: perf((l) => l.city, 'city'), bars: perf((l) => l.city, 'city').map((r) => ({ name: r.name, value: r.total })), donut: perf((l) => l.city, 'city').map((r) => ({ name: r.name, value: r.won ?? 0 })) };
      case 'industry':
        return { rows: perf((l) => l.industry, 'industry'), bars: perf((l) => l.industry, 'industry').map((r) => ({ name: r.name, value: r.total })), donut: perf((l) => l.industry, 'industry').map((r) => ({ name: r.name, value: r.won ?? 0 })) };
      case 'salesperson':
        return { rows: perf((l) => l.assigned_to, 'staff'), bars: perf((l) => l.assigned_to, 'staff').map((r) => ({ name: r.name, value: r.won ?? 0 })), donut: perf((l) => l.assigned_to, 'staff').map((r) => ({ name: r.name, value: r.total })) };
    }
  }, [query.data, report, range, city, staff, t, lang]);

  const perfReport = ['source', 'city', 'industry', 'salesperson', 'sales', 'trial'].includes(report);
  const columns: Column<Row>[] = [
    { key: 'name', header: t('reports.dimension'), primary: true, cell: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'total', header: report === 'demo' ? t('reports.demos') : t('reports.count'), align: 'right', cell: (r) => r.total },
    ...(report === 'demo' ? [{ key: 'extra', header: t('status.completed'), align: 'right' as const, cell: (r: Row) => r.extra ?? 0 }] : []),
    ...(perfReport && report !== 'sales' ? [{ key: 'won', header: report === 'trial' ? t('reports.converted') : t('reports.won'), align: 'right' as const, cell: (r: Row) => r.won ?? 0 }] : []),
    ...(['source', 'city', 'industry', 'salesperson'].includes(report) ? [{ key: 'lost', header: t('reports.lost'), align: 'right' as const, cell: (r: Row) => r.lost ?? 0 }] : []),
    ...(perfReport && report !== 'trial' ? [{ key: 'conv', header: t('dashboard.conversion'), align: 'right' as const, cell: (r: Row) => formatPercent(r.conversion ?? 0, 1) }] : []),
    ...(view && 'valueIsMoney' in view ? [{ key: 'value', header: t('reports.value'), align: 'right' as const, cell: (r: Row) => money(r.value ?? 0) }] : []),
  ];

  const exportCsv = () => {
    if (!view) return;
    const cols: CsvColumn<Row>[] = columns.map((c) => ({ header: c.header, value: (r: Row) => ({ name: r.name, total: r.total, extra: r.extra, won: r.won, lost: r.lost, conv: r.conversion !== undefined ? (r.conversion * 100).toFixed(1) + '%' : '', value: r.value })[c.key as 'name'] }));
    downloadCsv(`report-${report}-${preset}`, view.rows, cols);
  };

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        description={t('reports.subtitle')}
        actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!view?.rows.length}><Download />{t('common.exportCsv')}</Button>}
      />
      <div className="mb-5 grid gap-2 sm:grid-cols-3">
        <Select aria-label={t('reports.report')} value={report} onChange={(e) => setReport(e.target.value as ReportKey)}>
          {REPORTS.map((r) => <option key={r} value={r}>{t(`reports.names.${r}`)}</option>)}
        </Select>
        <Select aria-label={t('reports.range')} value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)}>
          {RANGE_PRESETS.map((p) => <option key={p} value={p}>{t(`range.${p}`)}</option>)}
        </Select>
        <Select aria-label={t('form.city')} value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">{t('crm.allCities')}</option>
          {['Tirunelveli', 'Thoothukudi', 'Nagercoil', 'Madurai', 'Tenkasi', 'Kovilpatti', 'Chennai', 'Coimbatore', 'Other'].map((c) => <option key={c} value={c}>{t(`city.${c}`)}</option>)}
        </Select>
      </div>
      {query.isPending && <ListSkeleton rows={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {view && (
        <div className="space-y-5">
          {'kpis' in view && view.kpis && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {view.kpis.map(([label, value]) => <Card key={label} className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-bold tabular">{value}</p></Card>)}
            </div>
          )}
          <div className="grid gap-5 xl:grid-cols-2">
            {'trend' in view && view.trend && (
              <ChartCard title={t('reports.trend')}>
                <TrendChart data={view.trend} label={t(`reports.names.${report}`)} format={'trendFormat' in view ? view.trendFormat : undefined} />
              </ChartCard>
            )}
            {view.bars && <ChartCard title={t('reports.breakdown')} empty={view.bars.length === 0}><BarList data={view.bars.slice(0, 10)} label={t('reports.count')} /></ChartCard>}
            {'donut' in view && view.donut && <ChartCard title={['source', 'city', 'industry'].includes(report) ? t('reports.wonBy') : t('reports.distribution')} empty={view.donut.every((d) => d.value === 0)}><DonutChart data={view.donut.filter((d) => d.value > 0)} label={t('reports.count')} /></ChartCard>}
          </div>
          <DataTable caption={t(`reports.names.${report}`)} columns={columns} rows={view.rows} rowKey={(r) => r.name} />
        </div>
      )}
    </>
  );
}
