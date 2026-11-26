import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from 'motion/react';
import {
  AlarmClock, ArrowRight, BellOff, CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, Clock, FileWarning, Home, ShieldAlert, TriangleAlert, UserCheck, UserPlus, Users, UserX,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { PageHeader, StatCard } from '@/components/shared/widgets';
import { BarList, ChartCard } from '@/features/analytics/charts';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useAttendance,
  useAttention,
  useEmployees,
  useHolidays,
  useHrMembers,
  useInvalidateHr,
  useLeaveRequests,
  useRegularizations,
  type AttentionItem,
  type HrMember,
} from '@/features/hr/api';
import { errorKey } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { ALERT_TYPES, alertLink, dayStatus, formatMinutes, SEVERITY_ORDER, type AlertSeverity } from '@shared/hr';
import { addDays, istDateString } from '@shared/slots';

const SEVERITY_TONE: Record<AlertSeverity, BadgeTone> = { critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral' };
const day = (date: string, lang: string) => formatDate(`${date}T06:30:00Z`, lang);
const axis = { stroke: 'hsl(var(--muted-foreground))', fontSize: 12, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 10, color: 'hsl(var(--popover-foreground))', fontSize: 12 },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
  cursor: { fill: 'hsl(var(--muted) / 0.6)' },
};

// ── Saved filters (per viewer, best-effort) ───────────────────────────
interface Filters { severity: string; type: string; owner: 'all' | 'me' | 'unassigned' }
const DEFAULT_FILTERS: Filters = { severity: '', type: '', owner: 'all' };

function useSavedFilters(companyId: string | undefined) {
  const key = `hr-attention-filters:${companyId ?? ''}`;
  const [filters, setFilters] = useState<Filters>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<Filters>) } : DEFAULT_FILTERS;
    } catch {
      return DEFAULT_FILTERS;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(filters));
    } catch {
      /* storage unavailable — filters just won't be remembered */
    }
  }, [key, filters]);
  return [filters, setFilters] as const;
}

// ── Requires attention ────────────────────────────────────────────────
function useAlertReason() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  return (a: AttentionItem) => {
    const d = a.detail ?? {};
    const num = (k: string) => Number(d[k] ?? 0);
    switch (a.alert_type) {
      case 'missing_punch': return t('alerts.reason.missing_punch', { time: formatTime(String(d.check_in_at ?? ''), lang), date: day(a.ref_date, lang) });
      case 'not_checked_in': return t('alerts.reason.not_checked_in', { time: String(d.shift_start ?? '').slice(0, 5) });
      case 'repeated_late': return t('alerts.reason.repeated_late', { count: num('count'), minutes: num('minutes') });
      case 'excess_hours': return t('alerts.reason.excess_hours', { overtime: formatMinutes(num('overtime_minutes')), date: day(a.ref_date, lang) });
      case 'leave_conflict': return t('alerts.reason.leave_conflict', { date: day(a.ref_date, lang) });
      case 'pending_leave': return t('alerts.reason.pending_leave', { days: num('days'), hours: num('waiting_hours') });
      case 'pending_regularization': return t('alerts.reason.pending_regularization', { date: day(a.ref_date, lang), hours: num('waiting_hours') });
      case 'contract_expiry': return t('alerts.reason.contract_expiry', { count: num('days_left'), date: day(a.ref_date, lang) });
      case 'document_expiry': return t(num('days_left') < 0 ? 'alerts.reason.document_expired' : 'alerts.reason.document_expiry', { title: String(d.title ?? ''), date: day(a.ref_date, lang) });
      case 'pending_document': return t('alerts.reason.pending_document', { title: String(d.title ?? '') });
      case 'probation_end': return t('alerts.reason.probation_end', { count: num('days_left'), date: day(a.ref_date, lang) });
      case 'incomplete_profile': return t('alerts.reason.incomplete_profile', { fields: ((d.missing as string[]) ?? []).map((f) => t(`alerts.fields.${f}`)).join(', ') });
      default: return '';
    }
  };
}

type AlertPatch = { status: 'open' | 'snoozed' | 'resolved' | 'escalated'; assigned_to?: string | null; snoozed_until?: string | null };

function AlertCard({ a, members, onSave, saving }: { a: AttentionItem; members: HrMember[]; onSave: (a: AttentionItem, patch: AlertPatch) => void; saving: boolean }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const reason = useAlertReason();
  const today = istDateString(new Date());
  const assignee = members.find((m) => m.user_id === a.assigned_to);
  const admins = members.filter((m) => m.role === 'customer_admin');
  const escalateTo = admins.find((m) => m.user_id !== user?.id) ?? admins[0];
  const keepStatus: AlertPatch['status'] = a.status === 'escalated' ? 'escalated' : 'open';

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${a.severity === 'low' ? 'bg-muted text-muted-foreground' : a.severity === 'medium' ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}>
          {a.severity === 'critical' ? <ShieldAlert className="size-[18px]" aria-hidden /> : <TriangleAlert className="size-[18px]" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t(`alerts.type.${a.alert_type}`)}</span>
            <Badge tone={SEVERITY_TONE[a.severity]}>{t(`alerts.severity.${a.severity}`)}</Badge>
            {a.status === 'escalated' && <Badge tone="danger">{t('alerts.escalated')}</Badge>}
          </p>
          <p className="text-sm">
            <Link to={`/portal/employees/${a.employee_id}`} className="font-medium text-primary hover:underline">{a.employee_name}</Link>
            <span className="text-muted-foreground"> · {a.employee_code}{a.department ? ` · ${a.department}` : ''} · {day(a.ref_date, i18n.language)}</span>
          </p>
          <p className="text-sm text-muted-foreground">{reason(a)}</p>
          <p className="text-sm"><span className="font-medium">{t('alerts.next')}:</span> {t(`alerts.action.${a.alert_type}`)}</p>
          {assignee && <p className="text-xs text-muted-foreground">{t('alerts.assignedTo', { name: assignee.full_name || assignee.email })}</p>}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-56">
          <Button size="sm" asChild><Link to={alertLink(a.alert_type, a.employee_id, a.ref_date)}>{t('alerts.open')}<ArrowRight /></Link></Button>
          <Select aria-label={t('alerts.assign')} className="h-9 text-sm" value={a.assigned_to ?? ''} disabled={saving} onChange={(e) => onSave(a, { status: keepStatus, assigned_to: e.target.value || null })}>
            <option value="">{t('alerts.unassigned')}</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}{m.user_id === user?.id ? ` (${t('alerts.me')})` : ''}</option>)}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Select aria-label={t('alerts.snooze')} className="h-9 text-sm" value="" disabled={saving} onChange={(e) => e.target.value && onSave(a, { status: 'snoozed', snoozed_until: addDays(today, Number(e.target.value)) })}>
              <option value="">{t('alerts.snooze')}</option>
              {[1, 3, 7].map((n) => <option key={n} value={n}>{t('alerts.snoozeDays', { count: n })}</option>)}
            </Select>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => onSave(a, { status: 'resolved' })}><CheckCircle2 />{t('alerts.resolve')}</Button>
          </div>
          {a.status !== 'escalated' && escalateTo && (
            <Button size="sm" variant="ghost" className="text-destructive" disabled={saving} onClick={() => onSave(a, { status: 'escalated', assigned_to: escalateTo.user_id })}>
              <AlarmClock />{t('alerts.escalate')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function RequiresAttention() {
  const { t } = useTranslation();
  const { activeCompany, user } = useAuth();
  const invalidate = useInvalidateHr();
  const items = useAttention(activeCompany?.id);
  const members = useHrMembers(activeCompany?.id);
  const [filters, setFilters] = useSavedFilters(activeCompany?.id);
  const [showAll, setShowAll] = useState(false);

  const save = useMutation({
    mutationFn: async ({ a, patch }: { a: AttentionItem; patch: AlertPatch }) =>
      unwrap(
        await sb()
          .from('hr_alert_states')
          .upsert(
            {
              company_id: activeCompany!.id,
              alert_key: a.alert_key,
              status: patch.status,
              assigned_to: patch.assigned_to === undefined ? a.assigned_to : patch.assigned_to,
              snoozed_until: patch.status === 'snoozed' ? patch.snoozed_until : null,
            },
            { onConflict: 'company_id,alert_key' },
          )
          .select('alert_key'),
      ),
    onSuccess: async (_d, { patch }) => {
      toast.success(t(`alerts.saved.${patch.status}`));
      await invalidate();
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  const all = items.data ?? [];
  const filtered = all
    .filter((a) => (!filters.severity || a.severity === filters.severity) && (!filters.type || a.alert_type === filters.type))
    .filter((a) => filters.owner === 'all' || (filters.owner === 'me' ? a.assigned_to === user?.id : !a.assigned_to))
    .sort((x, y) => SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]);
  const shown = showAll ? filtered : filtered.slice(0, 8);
  const counts = all.reduce<Record<string, number>>((m, a) => ({ ...m, [a.severity]: (m[a.severity] ?? 0) + 1 }), {});

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto">{t('alerts.title')}</CardTitle>
          {(['critical', 'high', 'medium', 'low'] as const).map((s) => counts[s] ? <Badge key={s} tone={SEVERITY_TONE[s]}>{t(`alerts.severity.${s}`)}: {counts[s]}</Badge> : null)}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Select aria-label={t('alerts.filterSeverity')} value={filters.severity} onChange={(e) => setFilters({ ...filters, severity: e.target.value })}>
            <option value="">{t('alerts.allSeverities')}</option>
            {(['critical', 'high', 'medium', 'low'] as const).map((s) => <option key={s} value={s}>{t(`alerts.severity.${s}`)}</option>)}
          </Select>
          <Select aria-label={t('alerts.filterType')} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <option value="">{t('alerts.allTypes')}</option>
            {ALERT_TYPES.map((x) => <option key={x} value={x}>{t(`alerts.type.${x}`)}</option>)}
          </Select>
          <Select aria-label={t('alerts.filterOwner')} value={filters.owner} onChange={(e) => setFilters({ ...filters, owner: e.target.value as Filters['owner'] })}>
            <option value="all">{t('alerts.ownerAll')}</option>
            <option value="me">{t('alerts.ownerMe')}</option>
            <option value="unassigned">{t('alerts.unassigned')}</option>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.isPending ? <ListSkeleton rows={3} /> : items.isError ? <ErrorState error={items.error} onRetry={() => void items.refetch()} /> : filtered.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={all.length ? t('alerts.noMatch') : t('alerts.allClear')} description={all.length ? undefined : t('alerts.allClearBody')} />
        ) : (
          <>
            <ul className="space-y-3">
              {shown.map((a) => <li key={a.alert_key}><AlertCard a={a} members={members.data ?? []} saving={save.isPending && save.variables?.a.alert_key === a.alert_key} onSave={(x, patch) => save.mutate({ a: x, patch })} /></li>)}
            </ul>
            {filtered.length > shown.length && <Button variant="outline" className="w-full" onClick={() => setShowAll(true)}>{t('alerts.showAll', { count: filtered.length })}</Button>}
          </>
        )}
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><BellOff className="size-3" aria-hidden />{t('alerts.footnote')}</p>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export function CommandCenterPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const reduce = useReducedMotion();
  const { activeCompany } = useAuth();
  const today = istDateString(new Date());
  const from14 = addDays(today, -13);
  const employees = useEmployees(activeCompany?.id);
  const records = useAttendance(activeCompany?.id, from14, today);
  const holidays = useHolidays(activeCompany?.id);
  const approvedLeave = useLeaveRequests(activeCompany?.id, { status: 'approved' });
  const pendingLeave = useLeaveRequests(activeCompany?.id, { status: 'pending' });
  const pendingReg = useRegularizations(activeCompany?.id, { status: 'pending' });
  const attention = useAttention(activeCompany?.id);
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);

  const stats = useMemo(() => {
    const emps = employees.data ?? [];
    const active = emps.filter((e) => e.status === 'active');
    const month = today.slice(0, 7);
    const todays = (records.data ?? []).filter((r) => r.work_date === today);
    const leaveToday = active.filter((e) => (approvedLeave.data ?? []).some((l) => l.employee_id === e.id && l.start_date <= today && l.end_date >= today)).length;
    const alerts = attention.data ?? [];
    return {
      total: emps.filter((e) => e.status !== 'exited').length,
      active: active.length,
      joiners: emps.filter((e) => e.date_of_joining?.startsWith(month)).length,
      present: todays.filter((r) => r.check_in_at).length,
      late: todays.filter((r) => r.late_minutes > 0).length,
      wfh: todays.filter((r) => r.check_in_at && r.work_mode === 'home').length,
      notIn: alerts.filter((a) => a.alert_type === 'not_checked_in').length,
      missing: alerts.filter((a) => a.alert_type === 'missing_punch').length,
      leaveToday,
      contracts: active.filter((e) => e.contract_end_date && e.contract_end_date >= today && e.contract_end_date <= addDays(today, 30)).length,
    };
  }, [employees.data, records.data, approvedLeave.data, attention.data, today]);

  const trend = useMemo(() => {
    const active = (employees.data ?? []).filter((e) => e.status === 'active');
    const byKey = new Map((records.data ?? []).map((r) => [`${r.employee_id}:${r.work_date}`, r]));
    return Array.from({ length: 14 }, (_, i) => addDays(from14, i)).map((d) => {
      const row = { name: d.slice(5).split('-').reverse().join('/'), present: 0, late: 0, absent: 0, leave: 0 };
      for (const e of active) {
        const st = dayStatus(d, e, byKey.get(`${e.id}:${d}`), approvedLeave.data ?? [], holidaySet, today);
        if (st === 'present' || st === 'half_day') row.present++;
        else if (st === 'late') row.late++;
        else if (st === 'absent') row.absent++;
        else if (st === 'on_leave') row.leave++;
      }
      return row;
    });
  }, [employees.data, records.data, approvedLeave.data, holidaySet, from14, today]);

  const departments = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of employees.data ?? []) if (e.status === 'active') m.set(e.department || t('cc.noDepartment'), (m.get(e.department || t('cc.noDepartment')) ?? 0) + 1);
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  }, [employees.data, t]);

  const movement = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - (5 - i));
      return d.toISOString().slice(0, 7);
    });
    return months.map((m) => ({
      name: new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}-15T00:00:00Z`)),
      joined: (employees.data ?? []).filter((e) => e.date_of_joining?.startsWith(m)).length,
      exited: (employees.data ?? []).filter((e) => e.exit_date?.startsWith(m)).length,
    }));
  }, [employees.data, today, lang]);

  if (employees.isError) return <ErrorState error={employees.error} />;
  const loading = employees.isPending || records.isPending;
  const kpis = [
    { label: t('cc.activeEmployees'), value: stats.active, icon: Users, tone: 'primary' as const, hint: t('cc.totalHint', { total: stats.total }), to: '/portal/employees' },
    { label: t('cc.newJoiners'), value: stats.joiners, icon: UserPlus, tone: 'info' as const, hint: t('cc.thisMonth'), to: '/portal/employees' },
    { label: t('cc.presentToday'), value: stats.present, icon: UserCheck, tone: 'success' as const, hint: t('cc.lateHint', { count: stats.late }), to: '/portal/attendance?tab=register' },
    { label: t('cc.notCheckedIn'), value: stats.notIn, icon: UserX, tone: 'warning' as const, hint: t('cc.leaveHint', { count: stats.leaveToday }), to: '/portal/attendance?tab=register' },
    { label: t('cc.wfhToday'), value: stats.wfh, icon: Home, tone: 'info' as const, to: '/portal/attendance?tab=register' },
    { label: t('cc.missedPunches'), value: stats.missing, icon: Clock, tone: 'warning' as const, to: '/portal/attendance?tab=search' },
    { label: t('cc.pendingLeave'), value: pendingLeave.data?.length ?? 0, icon: CalendarDays, tone: 'primary' as const, to: '/portal/leave?tab=approvals' },
    { label: t('cc.pendingRequests'), value: pendingReg.data?.length ?? 0, icon: ClipboardCheck, tone: 'primary' as const, to: '/portal/attendance?tab=requests' },
    { label: t('cc.contractsEnding'), value: stats.contracts, icon: FileWarning, tone: 'warning' as const, hint: t('cc.next30'), to: '/portal/employees' },
  ];

  return (
    <>
      <PageHeader
        title={t('cc.title')}
        description={t('cc.subtitle', { date: day(today, lang) })}
        actions={<Button variant="outline" size="sm" asChild><Link to="/portal/shifts"><CalendarClock />{t('shifts.title')}</Link></Button>}
      />
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {kpis.map((k, i) => (
            <Link key={k.label} to={k.to} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <StatCard label={k.label} value={loading ? 0 : k.value} icon={k.icon} tone={k.tone} hint={k.hint} index={i} />
            </Link>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <RequiresAttention />
          <div className="space-y-5">
            <ChartCard title={t('cc.attendanceTrend')} loading={loading} empty={!stats.active}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="name" {...axis} minTickGap={8} />
                  <YAxis {...axis} width={40} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="present" name={t('dayStatus.present')} stackId="a" fill="hsl(var(--success))" isAnimationActive={!reduce} />
                  <Bar dataKey="late" name={t('dayStatus.late')} stackId="a" fill="hsl(var(--warning))" isAnimationActive={!reduce} />
                  <Bar dataKey="leave" name={t('dayStatus.on_leave')} stackId="a" fill="hsl(var(--brand-secondary))" isAnimationActive={!reduce} />
                  <Bar dataKey="absent" name={t('dayStatus.absent')} stackId="a" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} isAnimationActive={!reduce} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title={t('cc.byDepartment')} loading={employees.isPending} empty={!departments.length}>
              <BarList data={departments} label={t('cc.employees')} />
            </ChartCard>
            <ChartCard title={t('cc.joinersExits')} loading={employees.isPending} empty={!movement.some((m) => m.joined || m.exited)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={movement} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="name" {...axis} />
                  <YAxis {...axis} width={40} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="joined" name={t('cc.joined')} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reduce} />
                  <Bar dataKey="exited" name={t('cc.exited')} fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reduce} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </div>
      </div>
    </>
  );
}
