import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Briefcase, KeyRound, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, Clock, FileClock, Hourglass, LogIn, LogOut, Mail, MapPin, Pencil, Phone, Repeat, UserCheck, Users, Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { InfoRow, StatCard, StatusBadge } from '@/components/shared/widgets';
import { EmployeeAssetsCard } from '@/features/assets/AssetsPages';
import { useAuth } from '@/features/auth/AuthProvider';
import { DocumentsPanel } from '@/features/documents/DocumentsPanel';
import {
  hhmm, useAttendance, useEmployee, useEmployees, useHolidays, useLeaveBalances, useLeaveRequests, useLeaveTypes, useRegularizations, useShiftAssignments, type AttendanceRecord, type Employee,
} from '@/features/hr/api';
import { api, errorKey } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { formatPhone } from '@shared/phone';
import { attendanceRate, buildTimeline, dayStatus, formatMinutes, summarizeMonth, type DayStatus, type TimelineKind } from '@shared/hr';
import { addDays, istDateString } from '@shared/slots';

const day = (date: string | null | undefined, lang: string) => (date ? formatDate(`${date}T06:30:00Z`, lang) : '—');
const HEAT_DAYS = 84; // 12 weeks

const CELL: Record<DayStatus, string> = {
  present: 'bg-success',
  late: 'bg-warning',
  half_day: 'bg-warning/50',
  absent: 'bg-destructive',
  on_leave: 'bg-brand-2',
  holiday: 'bg-primary/60',
  weekly_off: 'bg-muted',
  upcoming: 'bg-muted/40',
  not_joined: 'bg-muted/40',
};

const TIMELINE_ICON: Record<TimelineKind, LucideIcon> = {
  joined: UserCheck, probation_end: Hourglass, contract_end: FileClock, exited: LogOut, leave: CalendarPlus, regularization: Wrench, correction: Pencil, shift: Repeat,
};

/** Today's shift as the database resolves it (rotation, override or own default). */
function useShiftToday(employeeId: string | undefined, date: string) {
  return useQuery({
    queryKey: ['hr', 'shift-on', employeeId ?? '', date],
    enabled: Boolean(employeeId),
    queryFn: async () => {
      const rows = unwrap(await sb().rpc('employee_shift_on', { p_employee: employeeId!, p_date: date })) as { shift_name: string | null; start_time: string; end_time: string; is_off: boolean }[];
      return rows[0] ?? null;
    },
  });
}

function daysLeft(date: string | null, today: string) {
  if (!date) return null;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

// ── Header ────────────────────────────────────────────────────────────
function Hero({ e, manager, today }: { e: Employee; manager: Employee | undefined; today: string }) {
  const { t, i18n } = useTranslation();
  const shift = useShiftToday(e.id, today);
  const probation = daysLeft(e.probation_end_date, today);
  const contract = daysLeft(e.contract_end_date, today);
  const sendLink = useMutation({
    mutationFn: () => api<{ invited?: boolean }>('/team', { method: 'POST', body: { action: 'send_login_link', employee_id: e.id } }),
    onSuccess: (r) => toast.success(r.invited ? t('e360.inviteSent', { email: e.email }) : t('e360.loginLinkSent', { email: e.email })),
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }), { duration: 8000 }),
  });
  return (
    <Card className="mb-5 overflow-hidden">
      <div className="h-16 bg-gradient-to-r from-primary/25 via-brand-2/20 to-transparent sm:h-20" aria-hidden />
      <CardContent className="-mt-10 flex flex-col gap-4 sm:-mt-12 sm:flex-row sm:items-end">
        <Avatar name={e.full_name} className="size-20 border-4 border-card text-xl sm:size-24 sm:text-2xl" />
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{e.full_name}</h1>
          <p className="text-sm text-muted-foreground">
            {e.employee_code}
            {e.designation ? ` · ${e.designation}` : ''}
            {e.department ? ` · ${e.department}` : ''}
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <StatusBadge value={e.status} group="employeeStatus" />
            <Badge tone="outline">{t(`hr.types.${e.employment_type}`)}</Badge>
            {e.user_id ? <Badge tone="success">{t('hr.loginActive')}</Badge> : <Badge tone="outline">{t('hr.noLogin')}</Badge>}
            {probation !== null && probation >= 0 && <Badge tone="warning">{t('e360.onProbation', { count: probation })}</Badge>}
            {contract !== null && contract >= 0 && contract <= 60 && <Badge tone="danger">{t('e360.contractEnds', { count: contract })}</Badge>}
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {e.email && e.status === 'active' && (
            <Button variant="outline" loading={sendLink.isPending} onClick={() => sendLink.mutate()}><KeyRound />{t('e360.sendLoginLink')}</Button>
          )}
          <Button asChild><Link to={`/portal/employees/${e.id}/edit`}><Pencil />{t('e360.edit')}</Link></Button>
        </div>
      </CardContent>
      <div className="grid gap-px border-t bg-border text-sm sm:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: Mail, label: t('form.email'), value: e.email ? <a href={`mailto:${e.email}`} className="text-primary hover:underline">{e.email}</a> : null },
          { icon: Phone, label: t('form.phone'), value: e.phone ? <a href={`tel:+${e.phone.replace(/\D/g, '')}`} className="text-primary hover:underline">{formatPhone(e.phone)}</a> : null },
          { icon: Users, label: t('hr.reportingManager'), value: manager ? <Link to={`/portal/employees/${manager.id}`} className="text-primary hover:underline">{manager.full_name}</Link> : null },
          {
            icon: Clock,
            label: t('e360.shiftToday'),
            value: shift.data ? (shift.data.is_off ? t('dayStatus.weekly_off') : `${shift.data.shift_name ?? t('e360.defaultShift')} · ${hhmm(shift.data.start_time)}–${hhmm(shift.data.end_time)}`) : `${hhmm(e.shift_start)}–${hhmm(e.shift_end)}`,
          },
          { icon: MapPin, label: t('hr.workLocation'), value: e.work_location },
          { icon: CalendarCheck, label: t('hr.joined'), value: day(e.date_of_joining, i18n.language) },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex min-w-0 items-center gap-3 bg-card px-4 py-3">
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="truncate font-medium">{value ?? '—'}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Attendance heatmap ────────────────────────────────────────────────
function Heatmap({ statuses, from }: { statuses: Map<string, DayStatus>; from: string }) {
  const { t, i18n } = useTranslation();
  // Start the grid on a Monday so each column is one week.
  const startDow = new Date(`${from}T00:00:00Z`).getUTCDay();
  const gridStart = addDays(from, -((startDow + 6) % 7));
  const weeks = Math.ceil((HEAT_DAYS + (startDow + 6) % 7) / 7);
  return (
    <div>
      <div className="scroll-thin overflow-x-auto pb-2">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-1" role="img" aria-label={t('e360.heatmapLabel')}>
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const d = addDays(gridStart, i);
            const s = statuses.get(d);
            return <span key={d} title={s ? `${day(d, i18n.language)} · ${t(`dayStatus.${s}`)}` : undefined} className={cn('size-3.5 rounded-[3px] sm:size-4', s ? CELL[s] : 'bg-transparent')} />;
          })}
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(['present', 'late', 'half_day', 'absent', 'on_leave', 'holiday', 'weekly_off'] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5"><span className={cn('size-3 rounded-[3px]', CELL[s])} aria-hidden />{t(`dayStatus.${s}`)}</li>
        ))}
      </ul>
    </div>
  );
}

function RecentDays({ records }: { records: AttendanceRecord[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const rows = [...records].sort((a, b) => b.work_date.localeCompare(a.work_date)).slice(0, 14);
  if (!rows.length) return <EmptyState icon={CalendarDays} title={t('e360.noAttendance')} />;
  return (
    <ul className="divide-y rounded-xl border text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
          <span className="w-28 shrink-0 font-medium">{day(r.work_date, lang)}</span>
          <span className="flex items-center gap-1 tabular text-muted-foreground"><LogIn className="size-3.5" aria-hidden />{formatTime(r.check_in_at, lang) || '—'}</span>
          <span className="flex items-center gap-1 tabular text-muted-foreground"><LogOut className="size-3.5" aria-hidden />{formatTime(r.check_out_at, lang) || '—'}</span>
          <span className="tabular">{formatMinutes(r.work_minutes)}</span>
          <span className="ml-auto flex flex-wrap gap-1">
            {r.late_minutes > 0 && <Badge tone="warning">{t('e360.lateBy', { minutes: r.late_minutes })}</Badge>}
            {r.overtime_minutes > 0 && <Badge tone="info">{t('e360.overtime', { time: formatMinutes(r.overtime_minutes) })}</Badge>}
            {r.work_mode && r.work_mode !== 'office' && <Badge tone="outline">{t(`workMode.${r.work_mode}`)}</Badge>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export function Employee360Page() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id;
  const today = istDateString(new Date());
  const from = addDays(today, -(HEAT_DAYS - 1));
  const year = Number(today.slice(0, 4));

  const employee = useEmployee(id);
  const all = useEmployees(companyId);
  const attendance = useAttendance(companyId, from, today, id);
  const leave = useLeaveRequests(companyId, { employeeId: id });
  const types = useLeaveTypes(companyId);
  const holidays = useHolidays(companyId);
  const regs = useRegularizations(companyId, { employeeId: id });
  const assignments = useShiftAssignments(companyId);

  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);
  const e = employee.data;
  const approved = useMemo(() => (leave.data ?? []).filter((l) => l.status === 'approved'), [leave.data]);

  const statuses = useMemo(() => {
    const m = new Map<string, DayStatus>();
    if (!e) return m;
    const byDate = new Map((attendance.data ?? []).map((r) => [r.work_date, r]));
    for (let d = from; d <= today; d = addDays(d, 1)) m.set(d, dayStatus(d, e, byDate.get(d), approved, holidaySet, today));
    return m;
  }, [e, attendance.data, approved, holidaySet, from, today]);

  const month = today.slice(0, 7);
  const summary = useMemo(() => (e ? summarizeMonth(month, e, attendance.data ?? [], approved, holidaySet, today) : null), [e, month, attendance.data, approved, holidaySet, today]);
  const rate = summary ? attendanceRate(summary) : null;
  const overtime = useMemo(() => (attendance.data ?? []).filter((r) => r.work_date.startsWith(month)).reduce((s, r) => s + (r.overtime_minutes ?? 0), 0), [attendance.data, month]);
  const balances = useLeaveBalances(id, year).data ?? [];
  const leaveTaken = balances.filter((b) => b.unit === 'day').reduce((s, b) => s + b.used, 0);

  const manager = all.data?.find((m) => m.id === e?.reporting_manager_id);
  const reports = (all.data ?? []).filter((m) => m.reporting_manager_id === e?.id && m.status !== 'exited');
  const myAssignments = (assignments.data ?? []).filter((a) => a.employee_id === id);

  const timeline = useMemo(
    () =>
      e
        ? buildTimeline(
            {
              employee: e,
              leave: leave.data,
              regularizations: regs.data,
              corrections: (attendance.data ?? []).filter((r) => r.source === 'hr').map((r) => ({ id: r.id, corrected_at: r.corrected_at })),
              assignments: myAssignments,
            },
            today,
          )
        : [],
    [e, leave.data, regs.data, attendance.data, myAssignments, today],
  );
  const leaveById = new Map((leave.data ?? []).map((l) => [l.id, l]));
  const regById = new Map((regs.data ?? []).map((r) => [r.id, r]));

  const back = <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to="/portal/employees"><ArrowLeft />{t('hr.backToEmployees')}</Link></Button>;
  if (employee.isPending) return <>{back}<ListSkeleton rows={8} /></>;
  if (employee.isError || !e) return <>{back}<ErrorState error={employee.error} /></>;

  const timelineText = (ev: (typeof timeline)[number]) => {
    switch (ev.kind) {
      case 'leave': {
        const l = leaveById.get(ev.refId!);
        return l ? t('e360.tl.leave', { type: l.leave_types?.name ?? '', from: day(l.start_date, lang), to: day(l.end_date, lang), count: Number(l.days) }) : '';
      }
      case 'regularization': {
        const r = regById.get(ev.refId!);
        return r ? t('e360.tl.regularization', { date: day(r.work_date, lang) }) : '';
      }
      default:
        return t(`e360.tl.${ev.kind}`, { date: day(ev.date, lang) });
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      {back}
      <Hero e={e} manager={manager} today={today} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} icon={CalendarCheck} tone="success" label={t('e360.attendanceRate')} value={rate ?? 0} format={(n) => (rate === null ? '—' : `${Math.round(n)}%`)} hint={t('e360.thisMonth')} />
        <StatCard index={1} icon={Clock} tone="warning" label={t('e360.lateDays')} value={summary?.late ?? 0} hint={t('e360.thisMonth')} />
        <StatCard index={2} icon={CalendarPlus} tone="info" label={t('e360.leaveTaken')} value={leaveTaken} hint={t('e360.thisYear', { year })} />
        <StatCard index={3} icon={Briefcase} tone="primary" label={t('e360.overtimeLabel')} value={overtime} format={(n) => formatMinutes(n)} hint={t('e360.thisMonth')} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="overview">{t('e360.overview')}</TabsTrigger>
          <TabsTrigger value="attendance">{t('e360.attendance')}</TabsTrigger>
          <TabsTrigger value="leave">{t('e360.leave')}</TabsTrigger>
          <TabsTrigger value="documents">{t('docs.title')}</TabsTrigger>
          <TabsTrigger value="timeline">{t('e360.timeline')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>{t('e360.last12Weeks')}</CardTitle></CardHeader>
              <CardContent>{attendance.isPending ? <ListSkeleton rows={2} /> : <Heatmap statuses={statuses} from={from} />}</CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('e360.team')}</CardTitle></CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('hr.reportingManager')}</p>
                  {manager ? <PersonLink p={manager} /> : <p className="text-muted-foreground">{t('hr.noManager')}</p>}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('e360.directReports', { count: reports.length })}</p>
                  {reports.length ? <ul className="space-y-2">{reports.map((r) => <li key={r.id}><PersonLink p={r} /></li>)}</ul> : <p className="text-muted-foreground">{t('e360.noReports')}</p>}
                </div>
              </CardContent>
            </Card>
            <EmployeeAssetsCard employeeId={e.id} />
            <Card>
              <CardHeader><CardTitle>{t('hr.personal')}</CardTitle></CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <InfoRow label={t('hr.dob')}>{day(e.date_of_birth, lang)}</InfoRow>
                  <InfoRow label={t('hr.gender')}>{e.gender ? t(`hr.genders.${e.gender}`) : null}</InfoRow>
                  <InfoRow label={t('company.address')}>{e.address}</InfoRow>
                  <InfoRow label={t('hr.emergencyName')}>{e.emergency_contact_name}</InfoRow>
                  <InfoRow label={t('hr.emergencyPhone')}>{e.emergency_contact_phone ? formatPhone(e.emergency_contact_phone) : null}</InfoRow>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('hr.job')}</CardTitle></CardHeader>
              <CardContent>
                <dl className="divide-y">
                  <InfoRow label={t('hr.joiningDate')}>{day(e.date_of_joining, lang)}</InfoRow>
                  <InfoRow label={t('hr.probationEnd')}>{day(e.probation_end_date, lang)}</InfoRow>
                  <InfoRow label={t('hr.contractEnd')}>{day(e.contract_end_date, lang)}</InfoRow>
                  {e.exit_date && <InfoRow label={t('e360.exitDate')}>{day(e.exit_date, lang)}</InfoRow>}
                  <InfoRow label={t('hr.weeklyOffs')}>{e.weekly_offs.length ? e.weekly_offs.map((d) => t(`weekday.${d}`)).join(', ') : t('e360.none')}</InfoRow>
                  <InfoRow label={t('hr.grace')}>{t('e360.minutes', { count: e.grace_minutes })}</InfoRow>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('e360.leaveBalance')}</CardTitle></CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm">
                  {(types.data ?? []).filter((x) => x.is_active).map((lt) => {
                    const b = balances.find((x) => x.leave_type_id === lt.id);
                    const total = b?.unit === 'hour' ? b.hours_limit : b?.entitled ?? null;
                    const spent = b?.unit === 'hour' ? b.hours_used_month ?? 0 : (b?.used ?? 0) + (b?.pending ?? 0);
                    const pct = total ? Math.min(100, (spent / total) * 100) : 0;
                    const label = !b || b.available === null ? '∞' : b.unit === 'hour' ? `${b.available}h / ${b.hours_limit}h` : b.is_comp_off ? String(b.available) : `${b.available} / ${b.entitled}`;
                    return (
                      <li key={lt.id}>
                        <div className="flex justify-between gap-2"><span>{lt.name}</span><span className="tabular font-semibold">{label}</span></div>
                        {total ? <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div> : null}
                        {b && b.carried > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{t('leave.carried', { count: b.carried })}</p>}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="attendance">
          <div className="space-y-5">
            {summary && (
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">{t('dayStatus.present')}: {summary.present}</Badge>
                <Badge tone="warning">{t('dayStatus.late')}: {summary.late}</Badge>
                <Badge tone="warning">{t('dayStatus.half_day')}: {summary.halfDay}</Badge>
                <Badge tone="danger">{t('dayStatus.absent')}: {summary.absent}</Badge>
                <Badge tone="info">{t('dayStatus.on_leave')}: {summary.onLeave}</Badge>
                <Badge tone="neutral">{t('e360.worked', { time: formatMinutes(summary.workedMinutes) })}</Badge>
              </div>
            )}
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle>{t('e360.recentDays')}</CardTitle>
                <Button variant="outline" size="sm" asChild><Link to={`/portal/attendance?tab=search&employee=${e.id}`}>{t('e360.fullHistory')}</Link></Button>
              </CardHeader>
              <CardContent>{attendance.isPending ? <ListSkeleton rows={4} /> : <RecentDays records={attendance.data ?? []} />}</CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="leave">
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle>{t('e360.leaveHistory')}</CardTitle>
              <Button size="sm" asChild><Link to="/portal/leave/apply"><CalendarPlus />{t('leave.apply')}</Link></Button>
            </CardHeader>
            <CardContent>
              {leave.isPending ? <ListSkeleton rows={4} /> : !leave.data?.length ? <EmptyState icon={CalendarPlus} title={t('leave.none')} /> : (
                <ul className="divide-y rounded-xl border text-sm">
                  {leave.data.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{l.leave_types?.name} · {day(l.start_date, lang)}{l.end_date !== l.start_date ? ` – ${day(l.end_date, lang)}` : ''}</p>
                        <p className="text-xs text-muted-foreground">{l.hours !== null && Number(l.days) === 0 ? t('leave.hoursCount', { count: Number(l.hours) }) : t('leave.daysCount', { count: Number(l.days) })}{l.reason ? ` · ${l.reason}` : ''}</p>
                      </div>
                      <StatusBadge value={l.status} group="leaveStatus" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents"><DocumentsPanel companyId={e.company_id} employeeId={e.id} /></TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="pt-5">
              {timeline.length === 0 ? <EmptyState icon={CalendarClock} title={t('e360.noEvents')} /> : (
                <ol className="relative space-y-5 border-l pl-6">
                  {timeline.map((ev, i) => {
                    const Icon = TIMELINE_ICON[ev.kind];
                    return (
                      <li key={`${ev.kind}-${ev.refId ?? i}`} className="relative">
                        <span className={cn('absolute -left-[2.15rem] inline-flex size-7 items-center justify-center rounded-full border bg-card', ev.upcoming ? 'text-warning' : 'text-primary')}>
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <p className="text-xs text-muted-foreground">{day(ev.date, lang)}{ev.upcoming ? ` · ${t('e360.upcoming')}` : ''}</p>
                        <p className="text-sm font-medium">{timelineText(ev)}</p>
                        {ev.status && <StatusBadge value={ev.status} group="leaveStatus" className="mt-1" />}
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PersonLink({ p }: { p: Employee }) {
  return (
    <Link to={`/portal/employees/${p.id}`} className="flex items-center gap-2.5 rounded-lg p-1 -m-1 hover:bg-muted">
      <Avatar name={p.full_name} className="size-8" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{p.full_name}</span>
        <span className="block truncate text-xs text-muted-foreground">{p.designation ?? p.employee_code}</span>
      </span>
    </Link>
  );
}
