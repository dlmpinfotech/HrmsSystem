import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from 'motion/react';
import { CalendarCheck, Download, TrendingDown, Users, Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorState, ListSkeleton } from '@/components/shared/states';
import { PageHeader, StatCard } from '@/components/shared/widgets';
import { BarList, ChartCard, DonutChart, TrendChart } from '@/features/analytics/charts';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAttendance, useEmployees, useLeaveRequests } from '@/features/hr/api';
import { usePayrollRuns } from '@/features/payroll/api';
import { downloadCsv } from '@/lib/csv';
import { formatCompact, formatCurrency } from '@/lib/format';
import { attritionRate, averageTenureYears, countBy, employedOn, headcountByMonth, lastMonths } from '@shared/workforce';
import { addDays, istDateString } from '@shared/slots';

const axis = { stroke: 'hsl(var(--muted-foreground))', fontSize: 12, tickLine: false, axisLine: false } as const;

export function WorkforcePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const reduce = useReducedMotion();
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id;
  const today = istDateString(new Date());
  const employees = useEmployees(companyId);
  const attendance = useAttendance(companyId, addDays(today, -29), today);
  const leave = useLeaveRequests(companyId, { status: 'approved' });
  const payroll = usePayrollRuns(companyId);

  const months = useMemo(() => lastMonths(today, 12), [today]);
  const monthLabel = (m: string) => new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
  const people = employees.data ?? [];
  const trend = useMemo(() => headcountByMonth(employees.data ?? [], months, today), [employees.data, months, today]);
  const current = people.filter((p) => employedOn(p, today));
  const attrition = attritionRate(trend);
  const tenure = averageTenureYears(people, today);
  const records = attendance.data ?? [];
  const checkedIn = records.filter((r) => r.check_in_at);
  const onTime = checkedIn.length ? Math.round((checkedIn.filter((r) => r.late_minutes === 0).length / checkedIn.length) * 100) : null;
  const unnamed = t('workforce.notSet');
  const departments = countBy(current, (p) => p.department || unnamed);
  const types = countBy(current, (p) => t(`hr.types.${p.employment_type}`));
  const genders = countBy(current, (p) => (p.gender ? t(`hr.genders.${p.gender}`) : unnamed));
  const year = today.slice(0, 4);
  const leaveByType = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of leave.data ?? []) if (r.start_date.startsWith(year) && Number(r.days) > 0) m.set(r.leave_types?.name ?? '—', (m.get(r.leave_types?.name ?? '—') ?? 0) + Number(r.days));
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [leave.data, year]);
  const salary = (payroll.data ?? []).filter((r) => r.status === 'finalized').slice(0, 12).reverse().map((r) => ({ key: r.period, label: monthLabel(r.period.slice(0, 7)), value: r.total_employer_cost }));
  const chartTrend = trend.map((r) => ({ ...r, label: monthLabel(r.month) }));

  if (employees.isError) return <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />;
  if (employees.isPending) return <ListSkeleton rows={8} />;

  return (
    <>
      <PageHeader
        title={t('workforce.title')}
        description={t('workforce.subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={() => downloadCsv('workforce-trend', trend, [
            { header: 'Month', value: (r) => r.month }, { header: 'Headcount', value: (r) => r.headcount }, { header: 'Joined', value: (r) => r.joined }, { header: 'Left', value: (r) => r.left },
          ])}><Download />{t('common.exportCsv')}</Button>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} icon={Users} label={t('workforce.headcount')} value={current.length} />
        <StatCard index={1} icon={TrendingDown} tone="warning" label={t('workforce.attrition')} value={attrition ?? 0} format={(n) => (attrition === null ? '—' : `${n.toFixed(1)}%`)} hint={t('workforce.last12')} />
        <StatCard index={2} icon={Hourglass} tone="info" label={t('workforce.tenure')} value={tenure ?? 0} format={(n) => (tenure === null ? '—' : t('workforce.years', { value: n.toFixed(1) }))} />
        <StatCard index={3} icon={CalendarCheck} tone="success" label={t('workforce.onTime')} value={onTime ?? 0} format={(n) => (onTime === null ? '—' : `${Math.round(n)}%`)} hint={t('workforce.last30')} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard title={t('workforce.headcountTrend')}>
          <TrendChart label={t('workforce.headcount')} data={chartTrend.map((r) => ({ key: r.month, label: r.label, value: r.headcount }))} />
        </ChartCard>
        <ChartCard title={t('workforce.joinLeave')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="label" {...axis} minTickGap={16} />
              <YAxis {...axis} width={40} allowDecimals={false} />
              <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12 }} cursor={{ fill: 'hsl(var(--muted) / 0.6)' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="joined" name={t('workforce.joined')} fill="hsl(var(--success))" radius={[4, 4, 0, 0]} isAnimationActive={!reduce} />
              <Bar dataKey="left" name={t('workforce.left')} fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} isAnimationActive={!reduce} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title={t('workforce.departments')} empty={!departments.length}>
          <BarList label={t('workforce.headcount')} data={departments.slice(0, 8)} />
        </ChartCard>
        <ChartCard title={t('workforce.leaveByType', { year })} loading={leave.isPending} empty={!leaveByType.length}>
          <BarList label={t('leave.days')} data={leaveByType} />
        </ChartCard>
        <ChartCard title={t('workforce.employmentType')} empty={!types.length}>
          <DonutChart label={t('workforce.headcount')} data={types} />
        </ChartCard>
        <ChartCard title={t('workforce.gender')} empty={!genders.length}>
          <DonutChart label={t('workforce.headcount')} data={genders} />
        </ChartCard>
        <ChartCard title={t('workforce.salaryCost')} className="lg:col-span-2" loading={payroll.isPending} empty={!salary.length}>
          <TrendChart label={t('payroll.employerCost')} data={salary} format={(n) => (n >= 100000 ? formatCompact(n, lang) : formatCurrency(n, lang))} />
        </ChartCard>
      </div>
    </>
  );
}
