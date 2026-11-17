import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Clock, Download, LogIn, LogOut, MapPin, Pencil, Save, Trash2, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, PageHeader } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { hhmm, useAttendance, useEmployees, useHolidays, useInvalidateHr, useLeaveRequests, useMyEmployee, type AttendanceRecord, type Employee } from '@/features/hr/api';
import { errorKey } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatTime } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { currentMonth, datesInMonth, dayStatus, formatMinutes, summarizeMonth, type DayStatus } from '@shared/hr';
import { istDateString, istToUtc } from '@shared/slots';

const STATUS_TONE: Record<DayStatus, BadgeTone> = {
  present: 'success', late: 'warning', half_day: 'warning', absent: 'danger', on_leave: 'info', holiday: 'primary', weekly_off: 'neutral', upcoming: 'outline', not_joined: 'outline',
};

export function DayBadge({ status }: { status: DayStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`dayStatus.${status}`)}</Badge>;
}

/** Live IST clock that ticks every second. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Best-effort location; resolves to null if denied, unavailable or slow. */
function getLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    const timer = window.setTimeout(() => resolve(null), 8000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        window.clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60_000 },
    );
  });
}

function monthRange(month: string) {
  const days = datesInMonth(month);
  return { from: days[0], to: days[days.length - 1], days };
}

// ── Employee: today + my month ────────────────────────────────────────
function TodayCard({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const now = useNow();
  const today = istDateString(now);
  const records = useAttendance(activeCompany?.id, today, today, employee.id);
  const rec = records.data?.[0];
  const [locating, setLocating] = useState(false);

  const clock = useMutation({
    mutationFn: async (action: 'in' | 'out') => {
      setLocating(true);
      const location = await getLocation();
      setLocating(false);
      return unwrap(await sb().rpc('clock_attendance', { p_company: activeCompany!.id, p_action: action, p_location: location })) as AttendanceRecord;
    },
    onSuccess: async (r, action) => {
      toast.success(action === 'in' ? t('att.checkedIn', { time: formatTime(r.check_in_at, lang) }) : t('att.checkedOut', { time: formatTime(r.check_out_at, lang) }));
      await invalidate();
    },
    onError: (err) => {
      setLocating(false);
      toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    },
  });

  const checkedIn = Boolean(rec?.check_in_at);
  const checkedOut = Boolean(rec?.check_out_at);
  const liveMinutes = checkedIn && !checkedOut ? Math.max(0, Math.floor((now.getTime() - new Date(rec!.check_in_at!).getTime()) / 60_000)) : rec?.work_minutes ?? null;
  const action: 'in' | 'out' | null = !checkedIn ? 'in' : !checkedOut ? 'out' : null;

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[1fr_auto] md:items-center">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</p>
          <p className="text-4xl font-bold tabular tracking-tight sm:text-5xl" aria-live="off">{new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).format(now)}</p>
          <p className="text-sm text-muted-foreground">{t('att.shiftLine', { start: hhmm(employee.shift_start), end: hhmm(employee.shift_end) })}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 pt-3 text-sm">
            <span>{t('att.in')}: <strong className="tabular">{rec?.check_in_at ? formatTime(rec.check_in_at, lang) : '—'}</strong>{rec && rec.late_minutes > 0 && <Badge tone="warning" className="ml-2">{t('att.lateBy', { minutes: rec.late_minutes })}</Badge>}</span>
            <span>{t('att.out')}: <strong className="tabular">{rec?.check_out_at ? formatTime(rec.check_out_at, lang) : '—'}</strong></span>
            <span>{t('att.worked')}: <strong className="tabular">{formatMinutes(liveMinutes)}</strong></span>
          </div>
        </div>
        <div className="flex flex-col items-stretch gap-2 md:w-56">
          {action ? (
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button size="lg" className="h-16 w-full text-lg" variant={action === 'in' ? 'default' : 'destructive'} loading={clock.isPending} onClick={() => clock.mutate(action)}>
                {action === 'in' ? <LogIn /> : <LogOut />}
                {locating ? t('att.locating') : action === 'in' ? t('att.checkIn') : t('att.checkOut')}
              </Button>
            </motion.div>
          ) : (
            <div className="rounded-xl bg-success/10 p-4 text-center text-sm font-medium text-success">{t('att.doneForToday')}</div>
          )}
          <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-foreground"><MapPin className="size-3" aria-hidden />{t('att.locationNote')}</p>
        </div>
      </div>
    </Card>
  );
}

function MyMonth({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const [month, setMonth] = useState(currentMonth());
  const { from, to, days } = monthRange(month);
  const records = useAttendance(activeCompany?.id, from, to, employee.id);
  const holidays = useHolidays(activeCompany?.id);
  const leave = useLeaveRequests(activeCompany?.id, { employeeId: employee.id, status: 'approved' });
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);
  const byDate = useMemo(() => new Map((records.data ?? []).map((r) => [r.work_date, r])), [records.data]);
  const summary = useMemo(() => summarizeMonth(month, employee, records.data ?? [], leave.data ?? [], holidaySet), [month, employee, records.data, leave.data, holidaySet]);
  const today = istDateString(new Date());

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle>{t('att.myAttendance')}</CardTitle>
        <Input type="month" aria-label={t('att.month')} value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className="h-9 w-44" />
      </CardHeader>
      <CardContent className="space-y-4">
        <SummaryChips summary={summary} />
        {records.isPending ? <ListSkeleton rows={5} /> : (
          <ul className="divide-y rounded-xl border">
            {[...days].reverse().filter((d) => d <= today).map((d) => {
              const rec = byDate.get(d);
              const st = dayStatus(d, employee, rec, leave.data ?? [], holidaySet, today);
              if (st === 'not_joined') return null;
              return (
                <li key={d} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-28 shrink-0 font-medium">{formatDate(`${d}T06:30:00Z`, lang)}</span>
                  <DayBadge status={st} />
                  <span className="ml-auto flex gap-4 tabular text-muted-foreground">
                    <span>{rec?.check_in_at ? formatTime(rec.check_in_at, lang) : '—'}</span>
                    <span>{rec?.check_out_at ? formatTime(rec.check_out_at, lang) : '—'}</span>
                    <span className="w-16 text-right">{formatMinutes(rec?.work_minutes)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryChips({ summary }: { summary: ReturnType<typeof summarizeMonth> }) {
  const { t } = useTranslation();
  const items: [string, number | string, BadgeTone][] = [
    [t('dayStatus.present'), summary.present, 'success'],
    [t('dayStatus.late'), summary.late, 'warning'],
    [t('dayStatus.half_day'), summary.halfDay, 'warning'],
    [t('dayStatus.on_leave'), summary.onLeave, 'info'],
    [t('dayStatus.absent'), summary.absent, 'danger'],
    [t('att.totalHours'), formatMinutes(summary.workedMinutes), 'neutral'],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value, tone]) => (
        <div key={label} className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-xl font-bold tabular"><Badge tone={tone} className="border-0 bg-transparent p-0 text-xl">{value}</Badge></p>
        </div>
      ))}
    </div>
  );
}

// ── HR: daily register ────────────────────────────────────────────────
function DailyRegister() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const { activeCompany } = useAuth();
  const [date, setDate] = useState(istDateString(new Date()));
  const [filter, setFilter] = useState('');
  const employees = useEmployees(activeCompany?.id);
  const records = useAttendance(activeCompany?.id, date, date);
  const holidays = useHolidays(activeCompany?.id);
  const leave = useLeaveRequests(activeCompany?.id, { status: 'approved' });
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);

  const rows = useMemo(() => {
    const byEmp = new Map((records.data ?? []).map((r) => [r.employee_id, r]));
    return (employees.data ?? [])
      .filter((e) => e.status === 'active' || byEmp.has(e.id))
      .map((e) => ({ e, rec: byEmp.get(e.id), status: dayStatus(date, e, byEmp.get(e.id), leave.data ?? [], holidaySet) }))
      .filter((r) => r.status !== 'not_joined' && (!filter || r.status === filter));
  }, [employees.data, records.data, leave.data, holidaySet, date, filter]);

  const counts = useMemo(() => {
    const c: Partial<Record<DayStatus, number>> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: 'name', header: t('hr.employee'), primary: true, cell: (r) => <div><p className="font-semibold">{r.e.full_name}</p><p className="text-xs text-muted-foreground">{r.e.employee_code}{r.e.department ? ` · ${r.e.department}` : ''}</p></div> },
    { key: 'status', header: t('crm.status'), cell: (r) => <DayBadge status={r.status} /> },
    { key: 'in', header: t('att.in'), cell: (r) => <span className="tabular">{r.rec?.check_in_at ? formatTime(r.rec.check_in_at, lang) : '—'}{r.rec && r.rec.late_minutes > 0 ? <span className="ml-1 text-xs text-warning">+{r.rec.late_minutes}m</span> : null}</span> },
    { key: 'out', header: t('att.out'), cell: (r) => <span className="tabular">{r.rec?.check_out_at ? formatTime(r.rec.check_out_at, lang) : '—'}</span> },
    { key: 'hours', header: t('att.worked'), align: 'right', cell: (r) => formatMinutes(r.rec?.work_minutes) },
    { key: 'loc', header: t('att.location'), hideOnMobile: true, cell: (r) => (r.rec?.check_in_location ? <a className="inline-flex items-center gap-1 text-primary hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps?q=${r.rec.check_in_location.lat},${r.rec.check_in_location.lng}`} onClick={(e) => e.stopPropagation()}><MapPin className="size-3.5" />{t('att.map')}</a> : '—') },
    { key: 'edit', header: '', cell: (r) => <Button variant="ghost" size="sm" onClick={(ev) => { ev.stopPropagation(); navigate(`/portal/attendance/correct?employee=${r.e.id}&date=${date}`); }}><Pencil />{t('att.correct')}</Button> },
  ];

  if (employees.isError) return <ErrorState error={employees.error} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input type="date" aria-label={t('att.date')} value={date} max={istDateString(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} className="sm:w-48" />
        <Select aria-label={t('crm.status')} value={filter} onChange={(e) => setFilter(e.target.value)} className="sm:w-48">
          <option value="">{t('att.everyone')}</option>
          {(['present', 'late', 'half_day', 'absent', 'on_leave', 'holiday', 'weekly_off', 'upcoming'] as const).map((s) => <option key={s} value={s}>{t(`dayStatus.${s}`)}</option>)}
        </Select>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          {(['present', 'late', 'absent', 'on_leave'] as const).map((s) => <Badge key={s} tone={STATUS_TONE[s]}>{t(`dayStatus.${s}`)}: {counts[s] ?? 0}</Badge>)}
        </div>
      </div>
      {employees.isPending || records.isPending ? <ListSkeleton rows={5} /> : rows.length === 0 ? (
        <EmptyState icon={UserX} title={employees.data?.length ? t('att.nobody') : t('hr.noEmployees')} action={employees.data?.length ? undefined : <Button asChild><Link to="/portal/employees/new">{t('hr.addEmployee')}</Link></Button>} />
      ) : (
        <DataTable caption={t('att.register')} columns={columns} rows={rows} rowKey={(r) => r.e.id} />
      )}
    </div>
  );
}

// ── HR: monthly report ────────────────────────────────────────────────
function MonthlyReport() {
  const { t } = useTranslation();
  const { activeCompany } = useAuth();
  const [month, setMonth] = useState(currentMonth());
  const { from, to } = monthRange(month);
  const employees = useEmployees(activeCompany?.id);
  const records = useAttendance(activeCompany?.id, from, to);
  const holidays = useHolidays(activeCompany?.id);
  const leave = useLeaveRequests(activeCompany?.id, { status: 'approved' });
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);
  const rows = useMemo(
    () => (employees.data ?? []).filter((e) => e.status === 'active' || (records.data ?? []).some((r) => r.employee_id === e.id)).map((e) => ({ e, s: summarizeMonth(month, e, records.data ?? [], leave.data ?? [], holidaySet) })),
    [employees.data, records.data, leave.data, holidaySet, month],
  );
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: 'name', header: t('hr.employee'), primary: true, cell: (r) => <div><p className="font-semibold">{r.e.full_name}</p><p className="text-xs text-muted-foreground">{r.e.employee_code}</p></div> },
    { key: 'p', header: t('dayStatus.present'), align: 'right', cell: (r) => r.s.present },
    { key: 'l', header: t('dayStatus.late'), align: 'right', cell: (r) => r.s.late },
    { key: 'h', header: t('dayStatus.half_day'), align: 'right', cell: (r) => r.s.halfDay },
    { key: 'lv', header: t('dayStatus.on_leave'), align: 'right', cell: (r) => r.s.onLeave },
    { key: 'a', header: t('dayStatus.absent'), align: 'right', cell: (r) => <span className={r.s.absent ? 'font-semibold text-destructive' : ''}>{r.s.absent}</span> },
    { key: 'hrs', header: t('att.totalHours'), align: 'right', cell: (r) => formatMinutes(r.s.workedMinutes) },
  ];
  const exportCsv = () =>
    downloadCsv(`attendance-${month}`, rows, [
      { header: 'Employee code', value: (r) => r.e.employee_code },
      { header: 'Name', value: (r) => r.e.full_name },
      { header: 'Department', value: (r) => r.e.department },
      { header: 'Present', value: (r) => r.s.present },
      { header: 'Late', value: (r) => r.s.late },
      { header: 'Half day', value: (r) => r.s.halfDay },
      { header: 'On leave', value: (r) => r.s.onLeave },
      { header: 'Absent', value: (r) => r.s.absent },
      { header: 'Holidays', value: (r) => r.s.holidays },
      { header: 'Weekly offs', value: (r) => r.s.weeklyOffs },
      { header: 'Hours worked', value: (r) => (r.s.workedMinutes / 60).toFixed(2) },
    ]);
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input type="month" aria-label={t('att.month')} value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className="sm:w-48" />
        <Button variant="outline" size="sm" className="sm:ml-auto" onClick={exportCsv} disabled={!rows.length}><Download />{t('common.exportCsv')}</Button>
      </div>
      {employees.isPending || records.isPending ? <ListSkeleton rows={5} /> : rows.length === 0 ? <EmptyState icon={UserX} title={t('hr.noEmployees')} /> : <DataTable caption={t('att.monthly')} columns={columns} rows={rows} rowKey={(r) => r.e.id} />}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export function AttendancePage() {
  const { t } = useTranslation();
  const { isHr } = useAuth();
  const me = useMyEmployee();
  const [params, setParams] = useSearchParams();
  const defaultTab = me.data ? 'me' : 'register';
  const tab = params.get('tab') ?? defaultTab;
  if (me.isPending) return <ListSkeleton rows={6} />;

  const mine = me.data ? (
    <div className="space-y-5">
      <TodayCard employee={me.data} />
      <MyMonth employee={me.data} />
    </div>
  ) : null;

  return (
    <>
      <PageHeader title={t('att.title')} description={isHr ? t('att.subtitleHr') : t('att.subtitle')} />
      {!isHr ? (
        mine ?? <EmptyState icon={Clock} title={t('att.noRecordTitle')} description={t('att.noRecordBody')} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
          <TabsList>
            {mine && <TabsTrigger value="me">{t('att.myAttendance')}</TabsTrigger>}
            <TabsTrigger value="register">{t('att.register')}</TabsTrigger>
            <TabsTrigger value="monthly">{t('att.monthly')}</TabsTrigger>
          </TabsList>
          {mine && <TabsContent value="me">{mine}</TabsContent>}
          <TabsContent value="register"><DailyRegister /></TabsContent>
          <TabsContent value="monthly"><MonthlyReport /></TabsContent>
        </Tabs>
      )}
    </>
  );
}

// ── HR correction page ────────────────────────────────────────────────
export function AttendanceCorrectPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const employeeId = params.get('employee') ?? '';
  const date = params.get('date') ?? istDateString(new Date());
  const employees = useEmployees(activeCompany?.id);
  const employee = employees.data?.find((e) => e.id === employeeId);
  const records = useAttendance(activeCompany?.id, date, date, employeeId);
  const rec = records.data?.[0];
  const toLocalTime = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(11, 16) : '');
  const [form, setForm] = useState<{ status: string; in: string; out: string; notes: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const back = `/portal/attendance?tab=register`;

  useEffect(() => {
    if (!records.isPending && !form) setForm({ status: rec?.status ?? 'present', in: toLocalTime(rec?.check_in_at), out: toLocalTime(rec?.check_out_at), notes: rec?.notes ?? '' });
  }, [records.isPending, rec, form]);

  const save = useMutation({
    mutationFn: async () => {
      const working = form!.status === 'present' || form!.status === 'half_day';
      if (working && !form!.in) throw new Error('errors.checkInRequired');
      if (working && form!.out && form!.out < form!.in) throw new Error('errors.outBeforeIn');
      return unwrap(
        await sb()
          .from('attendance_records')
          .upsert(
            {
              company_id: activeCompany!.id,
              employee_id: employeeId,
              work_date: date,
              status: form!.status,
              check_in_at: working && form!.in ? istToUtc(date, form!.in).toISOString() : null,
              check_out_at: working && form!.out ? istToUtc(date, form!.out).toISOString() : null,
              notes: form!.notes || null,
              source: 'hr',
            },
            { onConflict: 'employee_id,work_date' },
          )
          .select('id')
          .single(),
      );
    },
    onSuccess: async () => {
      toast.success(t('common.saved'));
      await invalidate();
      navigate(back);
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await sb().from('attendance_records').delete().eq('id', rec!.id).select('id')),
    onSuccess: async () => {
      toast.success(t('att.cleared'));
      await invalidate();
      navigate(back);
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={back}><ArrowLeft />{t('att.backToRegister')}</Link></Button>
      <PageHeader title={t('att.correctTitle')} description={employee ? `${employee.full_name} · ${formatDate(`${date}T06:30:00Z`, i18n.language)}` : undefined} />
      {!form || employees.isPending ? <ListSkeleton rows={4} /> : !employee ? <ErrorState error={new Error('errors.generic')} /> : (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <SelectField label={t('crm.status')} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {(['present', 'half_day', 'absent', 'on_leave', 'holiday', 'weekly_off'] as const).map((s) => <option key={s} value={s}>{t(`dayStatus.${s}`)}</option>)}
            </SelectField>
            {(form.status === 'present' || form.status === 'half_day') && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={t('att.checkInTime')} type="time" required value={form.in} onChange={(e) => setForm({ ...form, in: e.target.value })} hint={t('common.istHint')} />
                <TextField label={t('att.checkOutTime')} type="time" value={form.out} onChange={(e) => setForm({ ...form, out: e.target.value })} />
              </div>
            )}
            <TextareaField label={t('att.reason')} rows={2} maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('att.reasonPlaceholder')} />
            <p className="text-xs text-muted-foreground">{t('att.correctNote')}</p>
            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              {rec && <Button variant="ghost" className="text-destructive sm:mr-auto" onClick={() => setConfirmDelete(true)}><Trash2 />{t('att.clearRecord')}</Button>}
              <Button variant="outline" asChild><Link to={back}>{t('common.cancel')}</Link></Button>
              <Button loading={save.isPending} onClick={() => save.mutate()}><Save />{t('common.save')}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t('att.clearRecord')} description={t('att.clearConfirm')} confirmLabel={t('att.clearRecord')} destructive loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}
