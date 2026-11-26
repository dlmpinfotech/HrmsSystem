import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlarmClock, ArrowLeft, Building2, CalendarDays, Check, CircleCheck, Clock, Coffee, Download, FilePenLine, Home, Hourglass, List, LogIn, LogOut, MapPin, Pencil, Plane, Save, Search, Send, Timer, Trash2, UserCheck, UserX, X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Avatar, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { FilterBar } from '@/components/shared/FilterBar';
import { CheckField, RadioGroupField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { AttendanceCalendar, DayRow, MonthSwitcher, Segmented, StatTile, type TileTone } from '@/features/hr/attendance-ui';
import {
  hhmm,
  useAttendance,
  useEmployees,
  useHolidays,
  useInvalidateHr,
  useLeaveRequests,
  useMyEmployee,
  useRegularizations,
  useShiftData,
  WORK_MODES,
  type AttendanceRecord,
  type Employee,
  type WorkMode,
} from '@/features/hr/api';
import { errorKey } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatTime } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn, storage } from '@/lib/utils';
import { currentMonth, datesInMonth, dayStatus, formatMinutes, resolveShift, shiftMinutes, summarizeMonth, type DayStatus } from '@shared/hr';
import { regularizationSchema, type RegularizationInput } from '@shared/schemas';
import { addDays, istDateString, istToUtc } from '@shared/slots';

const STATUS_TONE: Record<DayStatus, BadgeTone> = {
  present: 'success', late: 'warning', half_day: 'warning', absent: 'danger', on_leave: 'info', holiday: 'primary', weekly_off: 'neutral', upcoming: 'outline', not_joined: 'outline',
};
const MODE_TONE: Record<WorkMode, BadgeTone> = { office: 'neutral', home: 'info', field: 'primary' };
const day = (date: string, lang: string) => formatDate(`${date}T06:30:00Z`, lang);

export function DayBadge({ status }: { status: DayStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`dayStatus.${status}`)}</Badge>;
}

export function ModeBadge({ mode }: { mode: WorkMode | undefined }) {
  const { t } = useTranslation();
  if (!mode) return null;
  return <Badge tone={MODE_TONE[mode]}>{t(`workMode.${mode}`)}</Badge>;
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

/** "HH:MM" in IST from an ISO instant. */
const istHm = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(11, 16) : '');
const istDay = (iso: string) => istDateString(new Date(iso));

function useOnError() {
  const { t } = useTranslation();
  return (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
}

/**
 * The record the clock buttons act on — the same rule as clock_attendance():
 * an open record from today/tomorrow, or yesterday's if its shift ended less than 6h ago (overnight).
 */
function pickCurrent(records: AttendanceRecord[], today: string, now: Date) {
  const open = records
    .filter((r) => r.check_in_at && !r.check_out_at)
    .filter((r) => r.work_date >= today || (r.work_date === addDays(today, -1) && r.scheduled_end && now.getTime() < new Date(r.scheduled_end).getTime() + 6 * 3_600_000))
    .sort((a, b) => b.work_date.localeCompare(a.work_date))[0];
  return open ?? records.find((r) => r.work_date === today) ?? null;
}

// ── Employee: today + my month ────────────────────────────────────────
function TodayCard({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const now = useNow();
  const today = istDateString(now);
  const records = useAttendance(activeCompany?.id, addDays(today, -1), addDays(today, 1), employee.id);
  const shiftData = useShiftData(activeCompany?.id, today, today);
  const rec = pickCurrent(records.data ?? [], today, now);
  const shift = resolveShift(today, employee, shiftData.data);
  const [mode, setMode] = useState<WorkMode>('office');
  const [locating, setLocating] = useState(false);

  type Action = 'in' | 'out' | 'break_start' | 'break_end';
  const clock = useMutation({
    mutationFn: async (action: Action) => {
      let location = null;
      if (action === 'in' || action === 'out') {
        setLocating(true);
        location = await getLocation();
        setLocating(false);
      }
      return unwrap(await sb().rpc('clock_attendance', { p_company: activeCompany!.id, p_action: action, p_location: location, p_mode: action === 'in' ? mode : null })) as AttendanceRecord;
    },
    onSuccess: async (r, action) => {
      const msg: Record<Action, string> = {
        in: t('att.checkedIn', { time: formatTime(r.check_in_at, lang) }),
        out: t('att.checkedOut', { time: formatTime(r.check_out_at, lang) }),
        break_start: t('att.breakStarted'),
        break_end: t('att.breakEnded'),
      };
      toast.success(msg[action]);
      await invalidate();
    },
    onError: (err) => {
      setLocating(false);
      onError(err);
    },
  });

  const checkedIn = Boolean(rec?.check_in_at);
  const checkedOut = Boolean(rec?.check_out_at);
  const onBreak = Boolean(rec?.on_break_since) && !checkedOut;
  const breakLive = onBreak ? Math.floor((now.getTime() - new Date(rec!.on_break_since!).getTime()) / 60_000) : 0;
  const liveMinutes = checkedIn && !checkedOut
    ? Math.max(0, Math.floor((now.getTime() - new Date(rec!.check_in_at!).getTime()) / 60_000) - (rec?.break_minutes ?? 0) - breakLive)
    : rec?.work_minutes ?? null;
  const action: 'in' | 'out' | null = !checkedIn ? 'in' : !checkedOut ? 'out' : null;
  const shiftLine = rec?.scheduled_start && rec.scheduled_end
    ? t('att.shiftLine', { start: istHm(rec.scheduled_start), end: istHm(rec.scheduled_end) })
    : shift.isOff ? t('shifts.dayOff') : t('att.shiftLine', { start: shift.start, end: shift.end });

  const shiftTotal = rec?.scheduled_start && rec.scheduled_end
    ? Math.max(0, Math.round((new Date(rec.scheduled_end).getTime() - new Date(rec.scheduled_start).getTime()) / 60_000) - (shift.shift?.break_minutes ?? 0))
    : shift.isOff ? 0 : shiftMinutes(shift.start, shift.end, shift.shift?.break_minutes ?? 0);
  const done = liveMinutes ?? 0;
  const progress = shiftTotal > 0 ? Math.min(100, Math.round((done / shiftTotal) * 100)) : 0;
  const state: 'notIn' | 'working' | 'break' | 'done' = !checkedIn ? 'notIn' : checkedOut ? 'done' : onBreak ? 'break' : 'working';
  const clockParts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).formatToParts(now);
  const clockTime = clockParts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
  const clockPeriod = clockParts.find((p) => p.type === 'dayPeriod')?.value.toUpperCase();
  const MODE_ICON: Record<WorkMode, LucideIcon> = { office: Building2, home: Home, field: MapPin };
  const facts: { label: string; value: string; note?: string; icon: LucideIcon }[] = [
    { label: t('att.in'), value: rec?.check_in_at ? formatTime(rec.check_in_at, lang) : '—', note: rec && rec.late_minutes > 0 ? t('att.lateBy', { minutes: rec.late_minutes }) : undefined, icon: LogIn },
    { label: t('att.out'), value: rec?.check_out_at ? formatTime(rec.check_out_at, lang) : '—', note: rec && rec.early_minutes > 0 ? t('att.earlyBy', { minutes: rec.early_minutes }) : undefined, icon: LogOut },
    { label: t('att.worked'), value: formatMinutes(liveMinutes), note: rec && rec.overtime_minutes > 0 ? `${t('att.overtime')}: ${formatMinutes(rec.overtime_minutes)}` : undefined, icon: Timer },
    { label: t('att.breaks'), value: formatMinutes((rec?.break_minutes ?? 0) + breakLive), icon: Coffee },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-br from-primary to-primary/80 p-5 text-primary-foreground sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium opacity-90">{new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' }).format(now)}</p>
            <p className="mt-1 flex items-baseline gap-2 font-display font-extrabold tracking-tight" aria-live="off">
              <span className="text-4xl tabular sm:text-5xl">{clockTime}</span>
              <span className="text-lg opacity-85">{clockPeriod}</span>
            </p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-primary-foreground/15 px-3 py-1.5 text-sm font-semibold">
            <span className={cn('size-2 rounded-full bg-primary-foreground', (state === 'working' || state === 'break') && 'animate-pulse')} aria-hidden />
            {t(`att.state.${state}`)}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
          <span className="flex flex-wrap items-center gap-2 opacity-95">
            <Clock className="size-4" aria-hidden />
            {shift.shift ? `${shift.shift.name} · ` : ''}{shiftLine}
            {rec && rec.work_date !== today && <span className="rounded-full border border-primary-foreground/40 px-2 text-xs">{t('att.shiftOf', { date: day(rec.work_date, lang) })}</span>}
          </span>
          {shiftTotal > 0 && <span className="font-semibold tabular">{t('att.shiftProgress', { done: formatMinutes(done), total: formatMinutes(shiftTotal) })}</span>}
        </div>
        {shiftTotal > 0 && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-primary-foreground/25" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label={t('att.worked')}>
            <div className="h-full rounded-full bg-primary-foreground transition-[width] duration-700" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_18rem]">
        <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {facts.map(({ label, value, note, icon: Icon }) => (
            <div key={label} className="min-w-0 rounded-xl border bg-muted/30 p-3">
              <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className="size-3.5 shrink-0" aria-hidden />{label}</dt>
              <dd className="mt-1 font-display text-xl font-extrabold tabular">{value}</dd>
              {note && <dd className="mt-1"><Badge tone="warning">{note}</Badge></dd>}
            </div>
          ))}
        </dl>
        <div className="flex flex-col justify-center gap-2.5">
          {action === 'in' && (
            <div role="radiogroup" aria-label={t('att.workMode')} className="grid grid-cols-3 gap-2">
              {WORK_MODES.map((m) => {
                const Icon = MODE_ICON[m];
                return (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cn('flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center text-xs font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', mode === m ? 'border-primary bg-primary/10 text-primary ring-1 ring-primary' : 'text-muted-foreground hover:border-primary/40 hover:text-foreground')}
                  >
                    <Icon className="size-5" aria-hidden />
                    {t(`workMode.${m}`)}
                  </button>
                );
              })}
            </div>
          )}
          {action ? (
            <motion.div whileTap={{ scale: 0.97 }}>
              <Button size="lg" className="h-14 w-full text-base font-bold" variant={action === 'in' ? 'default' : 'destructive'} loading={clock.isPending && (clock.variables === 'in' || clock.variables === 'out')} disabled={clock.isPending} onClick={() => clock.mutate(action)}>
                {action === 'in' ? <LogIn /> : <LogOut />}
                {locating ? t('att.locating') : action === 'in' ? t('att.checkIn') : t('att.checkOut')}
              </Button>
            </motion.div>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-xl bg-success/10 p-4 text-center text-sm font-semibold text-success"><CircleCheck className="size-5 shrink-0" aria-hidden />{t('att.doneForToday')}</div>
          )}
          {action === 'out' && (
            <Button variant="outline" className="h-11" loading={clock.isPending && (clock.variables === 'break_start' || clock.variables === 'break_end')} disabled={clock.isPending} onClick={() => clock.mutate(onBreak ? 'break_end' : 'break_start')}>
              <Coffee />{onBreak ? t('att.endBreak', { minutes: breakLive }) : t('att.startBreak')}
            </Button>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            {rec && <ModeBadge mode={rec.work_mode} />}
            <span className="flex items-center gap-1"><MapPin className="size-3 shrink-0" aria-hidden />{t('att.locationNote')}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

type MonthView = 'calendar' | 'list';
const VIEW_KEY = 'hrms.attendance-view';

function MyMonth({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const [month, setMonth] = useState(currentMonth());
  const [view, setView] = useState<MonthView>(() => (storage.get(VIEW_KEY) === 'list' ? 'list' : 'calendar'));
  const [filter, setFilter] = useState<SummaryFilter | null>(null);
  const [picked, setPicked] = useState('');
  const { from, to, days } = monthRange(month);
  const records = useAttendance(activeCompany?.id, from, to, employee.id);
  const holidays = useHolidays(activeCompany?.id);
  const leave = useLeaveRequests(activeCompany?.id, { employeeId: employee.id, status: 'approved' });
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);
  const byDate = useMemo(() => new Map((records.data ?? []).map((r) => [r.work_date, r])), [records.data]);
  const summary = useMemo(() => summarizeMonth(month, employee, records.data ?? [], leave.data ?? [], holidaySet), [month, employee, records.data, leave.data, holidaySet]);
  const today = istDateString(new Date());
  const statusOf = (d: string) => dayStatus(d, employee, byDate.get(d), leave.data ?? [], holidaySet, today);
  // Today has not finished, so without a check-in it is not "absent" yet.
  const shownStatus = (d: string): DayStatus => (d === today && !byDate.get(d) && statusOf(d) === 'absent' ? 'upcoming' : statusOf(d));
  const calendarDays = days.map((d) => ({ date: d, status: d > today ? ('upcoming' as DayStatus) : shownStatus(d), minutes: byDate.get(d)?.work_minutes }));
  const listed = [...calendarDays]
    .reverse()
    .filter((d) => d.status !== 'upcoming' && d.status !== 'not_joined')
    .filter((d) => !filter || (filter === 'present' ? d.status === 'present' || d.status === 'late' : d.status === filter));
  const lastDay = [...calendarDays].reverse().find((d) => d.status !== 'upcoming' && d.status !== 'not_joined')?.date ?? '';
  const selected = picked.startsWith(month) ? picked : lastDay;
  const selectedDay = calendarDays.find((d) => d.date === selected);

  const chooseView = (v: MonthView) => {
    setView(v);
    storage.set(VIEW_KEY, v);
    if (v === 'calendar') setFilter(null);
  };
  const chooseFilter = (f: SummaryFilter) => {
    setFilter((current) => (current === f ? null : f));
    setView('list');
  };

  const rowFor = (d: (typeof calendarDays)[number]) => {
    const rec = byDate.get(d.date);
    const needsFix = d.date <= today && (d.status === 'absent' || (rec?.check_in_at && !rec.check_out_at && d.date < today));
    return (
      <DayRow
        date={d.date}
        status={d.status}
        inTime={rec?.check_in_at ? formatTime(rec.check_in_at, lang) : ''}
        outTime={rec?.check_out_at ? formatTime(rec.check_out_at, lang) : ''}
        minutes={rec?.work_minutes}
        badges={
          <>
            <DayBadge status={d.status} />
            {rec && rec.work_mode !== 'office' && <ModeBadge mode={rec.work_mode} />}
            {rec && rec.late_minutes > 0 && <Badge tone="warning">{t('att.lateBy', { minutes: rec.late_minutes })}</Badge>}
            {rec && rec.overtime_minutes > 0 && <Badge tone="primary">{t('att.overtime')}: {formatMinutes(rec.overtime_minutes)}</Badge>}
          </>
        }
        action={needsFix ? <Button variant="outline" size="sm" asChild><Link to={`/portal/attendance/regularize?date=${d.date}`}><FilePenLine />{t('reg.fix')}</Link></Button> : undefined}
      />
    );
  };

  return (
    <Card>
      <CardHeader className="gap-3 space-y-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>{t('att.myAttendance')}</CardTitle>
          <MonthSwitcher month={month} max={currentMonth()} onChange={(m) => { setMonth(m); setFilter(null); }} label={t('att.month')} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            label={t('att.viewLabel')}
            value={view}
            onChange={chooseView}
            options={[{ value: 'calendar', label: t('att.viewCalendar'), icon: CalendarDays }, { value: 'list', label: t('att.viewList'), icon: List }]}
          />
          <Button variant="outline" size="sm" asChild><Link to="/portal/attendance/regularize"><FilePenLine />{t('reg.request')}</Link></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <SummaryTiles summary={summary} filter={filter} onFilter={chooseFilter} />
        {records.isPending ? <ListSkeleton rows={5} /> : records.isError ? <ErrorState error={records.error} onRetry={() => void records.refetch()} /> : view === 'calendar' ? (
          <>
            <AttendanceCalendar days={calendarDays} selected={selected} today={today} onSelect={setPicked} formatDay={(d) => day(d, lang)} />
            {selectedDay && (
              <div className="rounded-xl border" aria-live="polite">
                <p className="border-b px-4 py-2 text-sm font-semibold">{day(selectedDay.date, lang)}</p>
                {rowFor(selectedDay)}
              </div>
            )}
          </>
        ) : listed.length === 0 ? (
          <EmptyState icon={CalendarDays} title={t('att.noResults')} action={filter ? <Button variant="outline" size="sm" onClick={() => setFilter(null)}>{t('filters.reset')}</Button> : undefined} />
        ) : (
          <>
            {filter && <p className="flex items-center gap-2 text-sm text-muted-foreground">{t('att.filteredBy', { status: t(`dayStatus.${filter}`) })}<Button variant="ghost" size="sm" onClick={() => setFilter(null)}><X />{t('filters.reset')}</Button></p>}
            <ul className="divide-y overflow-hidden rounded-xl border">
              {listed.map((d) => <li key={d.date}>{rowFor(d)}</li>)}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The signed-in employee's correction requests, with withdraw. */
function MyRequests({ employeeId }: { employeeId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const requests = useRegularizations(activeCompany?.id, { employeeId });
  const [cancelId, setCancelId] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('attendance_regularizations').update({ status: 'cancelled' }).eq('id', id).select('id').single()),
    onSuccess: async () => {
      setCancelId(null);
      toast.success(t('reg.withdrawn'));
      await invalidate();
    },
    onError,
  });
  if (!requests.data?.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t('reg.myRequests')}</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y rounded-xl border">
          {requests.data.slice(0, 20).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{day(r.work_date, lang)} · {hhmm(r.check_in_time)}–{r.check_out_time ? `${hhmm(r.check_out_time)}${r.out_next_day ? ` (${t('reg.nextDayShort')})` : ''}` : '—'}</p>
                <p className="text-xs text-muted-foreground">{r.reason}{r.decision_note ? ` · ${t('leave.note')}: ${r.decision_note}` : ''}</p>
              </div>
              <StatusBadge value={r.status} group="leaveStatus" />
              {r.status === 'pending' && <Button variant="ghost" size="sm" onClick={() => setCancelId(r.id)}>{t('leave.withdraw')}</Button>}
            </li>
          ))}
        </ul>
      </CardContent>
      <ConfirmDialog open={Boolean(cancelId)} onOpenChange={(o) => !o && setCancelId(null)} title={t('leave.withdraw')} description={t('reg.withdrawConfirm')} confirmLabel={t('leave.withdraw')} destructive loading={cancel.isPending} onConfirm={() => cancelId && cancel.mutate(cancelId)} />
    </Card>
  );
}

type SummaryFilter = 'present' | 'late' | 'half_day' | 'on_leave' | 'absent';

function SummaryTiles({ summary, filter, onFilter }: { summary: ReturnType<typeof summarizeMonth>; filter: SummaryFilter | null; onFilter: (f: SummaryFilter) => void }) {
  const { t } = useTranslation();
  const items: [SummaryFilter, number, LucideIcon, TileTone][] = [
    ['present', summary.present, UserCheck, 'success'],
    ['late', summary.late, AlarmClock, 'warning'],
    ['half_day', summary.halfDay, Hourglass, 'warning'],
    ['on_leave', summary.onLeave, Plane, 'info'],
    ['absent', summary.absent, UserX, 'danger'],
  ];
  return (
    <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
      {items.map(([key, value, icon, tone]) => <StatTile key={key} label={t(`dayStatus.${key}`)} value={value} icon={icon} tone={tone} active={filter === key} onClick={() => onFilter(key)} />)}
      <StatTile label={t('att.totalHours')} value={formatMinutes(summary.workedMinutes)} icon={Timer} tone="primary" />
    </div>
  );
}

const matches = (e: Employee, q: string) => !q || `${e.employee_code} ${e.full_name} ${e.department ?? ''}`.toLowerCase().includes(q.toLowerCase());

// ── HR: daily register ────────────────────────────────────────────────
function DailyRegister() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const { activeCompany } = useAuth();
  const [date, setDate] = useState(istDateString(new Date()));
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const employees = useEmployees(activeCompany?.id);
  const records = useAttendance(activeCompany?.id, date, date);
  const holidays = useHolidays(activeCompany?.id);
  const leave = useLeaveRequests(activeCompany?.id, { status: 'approved' });
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);

  const everyone = useMemo(() => {
    const byEmp = new Map((records.data ?? []).map((r) => [r.employee_id, r]));
    return (employees.data ?? [])
      .filter((e) => (e.status === 'active' || byEmp.has(e.id)) && matches(e, q))
      .map((e) => ({ e, rec: byEmp.get(e.id), status: dayStatus(date, e, byEmp.get(e.id), leave.data ?? [], holidaySet) }))
      .filter((r) => r.status !== 'not_joined');
  }, [employees.data, records.data, leave.data, holidaySet, date, q]);
  const rows = useMemo(() => everyone.filter((r) => !filter || r.status === filter || (filter === 'home' && r.rec?.work_mode === 'home')), [everyone, filter]);

  const totals = useMemo(() => {
    const status: Partial<Record<string, number>> = {};
    for (const r of everyone) status[r.status] = (status[r.status] ?? 0) + 1;
    return { status, home: everyone.filter((r) => r.rec?.work_mode === 'home').length };
  }, [everyone]);

  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: 'name', header: t('hr.employee'), primary: true, cell: (r) => <div className="flex min-w-0 items-center gap-2.5"><Avatar name={r.e.full_name} className="size-9" /><div className="min-w-0"><p className="font-semibold">{r.e.full_name}</p><p className="text-xs font-normal text-muted-foreground">{r.e.employee_code}{r.e.department ? ` · ${r.e.department}` : ''}</p></div></div> },
    { key: 'status', header: t('crm.status'), cell: (r) => <span className="flex flex-wrap gap-1"><DayBadge status={r.status} />{r.rec && r.rec.work_mode !== 'office' && <ModeBadge mode={r.rec.work_mode} />}{r.rec?.on_break_since && !r.rec.check_out_at && <Badge tone="outline">{t('att.onBreak')}</Badge>}</span> },
    { key: 'in', header: t('att.in'), cell: (r) => <span className="tabular">{r.rec?.check_in_at ? formatTime(r.rec.check_in_at, lang) : '—'}{r.rec && r.rec.late_minutes > 0 ? <span className="ml-1 text-xs text-warning">+{r.rec.late_minutes}m</span> : null}</span> },
    { key: 'out', header: t('att.out'), cell: (r) => <span className="tabular">{r.rec?.check_out_at ? formatTime(r.rec.check_out_at, lang) : '—'}{r.rec && r.rec.early_minutes > 0 ? <span className="ml-1 text-xs text-warning">−{r.rec.early_minutes}m</span> : null}</span> },
    { key: 'hours', header: t('att.worked'), align: 'right', cell: (r) => formatMinutes(r.rec?.work_minutes) },
    { key: 'ot', header: t('att.overtime'), align: 'right', hideOnMobile: true, cell: (r) => (r.rec?.overtime_minutes ? formatMinutes(r.rec.overtime_minutes) : '—') },
    { key: 'loc', header: t('att.location'), hideOnMobile: true, cell: (r) => (r.rec?.check_in_location ? <a className="inline-flex items-center gap-1 text-primary hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps?q=${r.rec.check_in_location.lat},${r.rec.check_in_location.lng}`} onClick={(e) => e.stopPropagation()}><MapPin className="size-3.5" />{t('att.map')}</a> : '—') },
    { key: 'edit', header: '', cell: (r) => <Button variant="ghost" size="sm" onClick={(ev) => { ev.stopPropagation(); navigate(`/portal/attendance/correct?employee=${r.e.id}&date=${date}`); }}><Pencil />{t('att.correct')}</Button> },
  ];

  if (employees.isError) return <ErrorState error={employees.error} />;
  return (
    <div className="space-y-4">
      <FilterBar
        search={<Input type="search" aria-label={t('common.search')} placeholder={t('hr.searchEmployees')} value={q} onChange={(e) => setQ(e.target.value)} />}
        activeCount={(date !== istDateString(new Date()) ? 1 : 0) + (filter ? 1 : 0)}
        onReset={() => { setDate(istDateString(new Date())); setFilter(''); }}
        filters={[
          { label: t('att.date'), control: <Input type="date" aria-label={t('att.date')} value={date} max={istDateString(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} /> },
          {
            label: t('crm.status'),
            control: (
              <Select aria-label={t('crm.status')} value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">{t('att.everyone')}</option>
                {(['present', 'late', 'half_day', 'absent', 'on_leave', 'holiday', 'weekly_off', 'upcoming'] as const).map((s) => <option key={s} value={s}>{t(`dayStatus.${s}`)}</option>)}
                <option value="home">{t('workMode.home')}</option>
              </Select>
            ),
          },
        ]}
      />
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        {([['present', UserCheck, 'success'], ['late', AlarmClock, 'warning'], ['half_day', Hourglass, 'warning'], ['absent', UserX, 'danger'], ['on_leave', Plane, 'info'], ['home', Home, 'primary']] as const).map(([key, icon, tone]) => (
          <StatTile
            key={key}
            label={key === 'home' ? t('workMode.home') : t(`dayStatus.${key}`)}
            value={key === 'home' ? totals.home : totals.status[key] ?? 0}
            icon={icon}
            tone={tone}
            active={filter === key}
            onClick={() => setFilter((f) => (f === key ? '' : key))}
          />
        ))}
      </div>
      {employees.isPending || records.isPending ? <ListSkeleton rows={5} /> : rows.length === 0 ? (
        <EmptyState icon={UserX} title={employees.data?.length ? t('att.nobody') : t('hr.noEmployees')} action={employees.data?.length ? undefined : <Button asChild><Link to="/portal/employees/new">{t('hr.addEmployee')}</Link></Button>} />
      ) : (
        <DataTable caption={t('att.register')} columns={columns} rows={rows} rowKey={(r) => r.e.id} />
      )}
    </div>
  );
}

// ── HR: search by employee and date range ─────────────────────────────
const MAX_SEARCH_DAYS = 93;
const MAX_ROWS = 1500;

function AttendanceSearch() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const { activeCompany } = useAuth();
  const [params] = useSearchParams();
  const today = istDateString(new Date());
  const [employeeId, setEmployeeId] = useState(params.get('employee') ?? '');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState('');
  const validRange = from <= to && (Date.parse(to) - Date.parse(from)) / 86_400_000 < MAX_SEARCH_DAYS;
  const employees = useEmployees(activeCompany?.id);
  const records = useAttendance(activeCompany?.id, validRange ? from : today, validRange ? to : today, employeeId || undefined);
  const holidays = useHolidays(activeCompany?.id);
  const leave = useLeaveRequests(activeCompany?.id, { status: 'approved' });
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);

  const allRows = useMemo(() => {
    if (!validRange) return [];
    const byKey = new Map((records.data ?? []).map((r) => [`${r.employee_id}:${r.work_date}`, r]));
    const people = (employees.data ?? []).filter((e) => (employeeId ? e.id === employeeId : e.status === 'active' || (records.data ?? []).some((r) => r.employee_id === e.id)));
    const out: { e: Employee; d: string; rec: AttendanceRecord | undefined; status: DayStatus }[] = [];
    for (let d = to; d >= from; d = addDays(d, -1)) {
      for (const e of people) {
        const rec = byKey.get(`${e.id}:${d}`);
        const st = dayStatus(d, e, rec, leave.data ?? [], holidaySet, today);
        if (st === 'not_joined' || st === 'upcoming') continue;
        if (status === 'missing_punch' ? Boolean(rec?.check_in_at && !rec.check_out_at) : status === 'overtime' ? (rec?.overtime_minutes ?? 0) > 0 : status === 'early' ? (rec?.early_minutes ?? 0) > 0 : !status || st === status) {
          out.push({ e, d, rec, status: st });
        }
      }
    }
    return out;
  }, [validRange, records.data, employees.data, employeeId, from, to, status, leave.data, holidaySet, today]);
  const rows = allRows.slice(0, MAX_ROWS);

  const totals = useMemo(() => {
    let worked = 0, ot = 0, late = 0, absent = 0;
    for (const r of allRows) {
      worked += r.rec?.work_minutes ?? 0;
      ot += r.rec?.overtime_minutes ?? 0;
      if ((r.rec?.late_minutes ?? 0) > 0) late++;
      if (r.status === 'absent') absent++;
    }
    return { worked, ot, late, absent };
  }, [allRows]);

  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { key: 'date', header: t('att.date'), primary: true, cell: (r) => <div><p className="font-semibold">{day(r.d, lang)}</p>{!employeeId && <p className="text-xs text-muted-foreground">{r.e.full_name} · {r.e.employee_code}</p>}</div> },
    { key: 'status', header: t('crm.status'), cell: (r) => <span className="flex flex-wrap gap-1"><DayBadge status={r.status} />{r.rec && r.rec.work_mode !== 'office' && <ModeBadge mode={r.rec.work_mode} />}</span> },
    { key: 'in', header: t('att.in'), cell: (r) => <span className="tabular">{r.rec?.check_in_at ? formatTime(r.rec.check_in_at, lang) : '—'}{r.rec && r.rec.late_minutes > 0 ? <span className="ml-1 text-xs text-warning">+{r.rec.late_minutes}m</span> : null}</span> },
    { key: 'out', header: t('att.out'), cell: (r) => <span className="tabular">{r.rec?.check_out_at ? formatTime(r.rec.check_out_at, lang) : r.rec?.check_in_at ? <Badge tone="danger">{t('att.missingOut')}</Badge> : '—'}</span> },
    { key: 'worked', header: t('att.worked'), align: 'right', cell: (r) => formatMinutes(r.rec?.work_minutes) },
    { key: 'ot', header: t('att.overtime'), align: 'right', hideOnMobile: true, cell: (r) => (r.rec?.overtime_minutes ? formatMinutes(r.rec.overtime_minutes) : '—') },
    { key: 'edit', header: '', cell: (r) => <Button variant="ghost" size="sm" onClick={() => navigate(`/portal/attendance/correct?employee=${r.e.id}&date=${r.d}`)}><Pencil />{t('att.correct')}</Button> },
  ];

  const exportCsv = () =>
    downloadCsv(`attendance-${employeeId ? employees.data?.find((e) => e.id === employeeId)?.employee_code ?? 'employee' : 'all'}-${from}-to-${to}`, allRows, [
      { header: 'Date', value: (r) => r.d },
      { header: 'Employee code', value: (r) => r.e.employee_code },
      { header: 'Name', value: (r) => r.e.full_name },
      { header: 'Department', value: (r) => r.e.department },
      { header: 'Status', value: (r) => r.status },
      { header: 'Work mode', value: (r) => r.rec?.work_mode },
      { header: 'Check-in (IST)', value: (r) => istHm(r.rec?.check_in_at) },
      { header: 'Check-out (IST)', value: (r) => (r.rec?.check_out_at ? `${istHm(r.rec.check_out_at)}${istDay(r.rec.check_out_at) !== r.d ? ' +1' : ''}` : '') },
      { header: 'Late minutes', value: (r) => r.rec?.late_minutes ?? 0 },
      { header: 'Early minutes', value: (r) => r.rec?.early_minutes ?? 0 },
      { header: 'Break minutes', value: (r) => r.rec?.break_minutes ?? 0 },
      { header: 'Worked hours', value: (r) => ((r.rec?.work_minutes ?? 0) / 60).toFixed(2) },
      { header: 'Overtime hours', value: (r) => ((r.rec?.overtime_minutes ?? 0) / 60).toFixed(2) },
      { header: 'Notes', value: (r) => r.rec?.notes },
    ]);

  return (
    <div className="space-y-4">
      <FilterBar
        activeCount={(employeeId ? 1 : 0) + (status ? 1 : 0) + (from !== `${today.slice(0, 7)}-01` || to !== today ? 1 : 0)}
        onReset={() => { setEmployeeId(''); setStatus(''); setFrom(`${today.slice(0, 7)}-01`); setTo(today); }}
        filters={[
          {
            label: t('hr.employee'),
            className: 'md:w-60',
            control: (
              <Select aria-label={t('hr.employee')} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">{t('att.allEmployees')}</option>
                {(employees.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
              </Select>
            ),
          },
          { label: t('att.from'), className: 'md:w-40', control: <Input type="date" aria-label={t('att.from')} value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /> },
          { label: t('att.to'), className: 'md:w-40', control: <Input type="date" aria-label={t('att.to')} value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /> },
          {
            label: t('crm.status'),
            control: (
              <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t('att.anyStatus')}</option>
                {(['present', 'late', 'half_day', 'absent', 'on_leave', 'holiday', 'weekly_off'] as const).map((s) => <option key={s} value={s}>{t(`dayStatus.${s}`)}</option>)}
                <option value="missing_punch">{t('att.missingOut')}</option>
                <option value="early">{t('att.earlyLeave')}</option>
                <option value="overtime">{t('att.overtime')}</option>
              </Select>
            ),
          },
        ]}
        trailing={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!allRows.length}><Download />{t('common.exportCsv')}</Button>}
      />
      {!validRange ? (
        <p role="alert" className="rounded-lg bg-warning/10 p-3 text-sm">{t('att.rangeTooLong', { days: MAX_SEARCH_DAYS })}</p>
      ) : employees.isPending || records.isPending ? <ListSkeleton rows={6} /> : allRows.length === 0 ? (
        <EmptyState icon={Search} title={t('att.noResults')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatTile label={t('att.worked')} value={formatMinutes(totals.worked)} icon={Timer} tone="success" />
            <StatTile label={t('att.overtime')} value={formatMinutes(totals.ot)} icon={Hourglass} tone="primary" />
            <StatTile label={t('dayStatus.late')} value={totals.late} icon={AlarmClock} tone="warning" />
            <StatTile label={t('dayStatus.absent')} value={totals.absent} icon={UserX} tone="danger" />
          </div>
          <p className="text-xs text-muted-foreground">{t('att.results', { count: allRows.length })}</p>
          <DataTable caption={t('att.search')} columns={columns} rows={rows} rowKey={(r) => `${r.e.id}:${r.d}`} />
          {allRows.length > rows.length && <p className="text-xs text-muted-foreground">{t('att.truncated', { shown: rows.length, total: allRows.length })}</p>}
        </>
      )}
    </div>
  );
}

// ── HR: correction requests ───────────────────────────────────────────
function RequestsQueue() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const [status, setStatus] = useState('pending');
  const requests = useRegularizations(activeCompany?.id, { status: status || undefined });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: async ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      unwrap(await sb().from('attendance_regularizations').update({ status: decision, decision_note: notes[id]?.trim() || null }).eq('id', id).select('id').single()),
    onSuccess: async (_d, v) => {
      toast.success(v.decision === 'approved' ? t('reg.approvedToast') : t('reg.rejectedToast'));
      await invalidate();
    },
    onError,
  });

  return (
    <div className="space-y-4">
      <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
        <option value="pending">{t('leaveStatus.pending')}</option>
        <option value="approved">{t('leaveStatus.approved')}</option>
        <option value="rejected">{t('leaveStatus.rejected')}</option>
        <option value="">{t('crm.allStatuses')}</option>
      </Select>
      {requests.isPending ? <ListSkeleton rows={3} /> : !requests.data?.length ? <EmptyState icon={Check} title={t('reg.none')} /> : (
        <ul className="space-y-3">
          {requests.data.map((r) => (
            <li key={r.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold">{r.employees?.full_name} <span className="text-xs font-normal text-muted-foreground">{r.employees?.employee_code}{r.employees?.department ? ` · ${r.employees.department}` : ''}</span></p>
                    <p className="text-sm">
                      {day(r.work_date, lang)} · <span className="tabular">{hhmm(r.check_in_time)}–{r.check_out_time ? hhmm(r.check_out_time) : '—'}</span>
                      {r.out_next_day && <Badge tone="outline" className="ml-1">{t('reg.nextDayShort')}</Badge>}
                    </p>
                    <p className="flex flex-wrap gap-1"><DayBadge status={r.requested_status} /><ModeBadge mode={r.work_mode} /><StatusBadge value={r.status} group="leaveStatus" /></p>
                    <p className="text-sm text-muted-foreground">“{r.reason}”</p>
                    {r.decision_note && <p className="text-xs text-muted-foreground">{t('leave.note')}: {r.decision_note}</p>}
                  </div>
                  {r.status === 'pending' && (
                    <div className="flex w-full flex-col gap-2 sm:w-72">
                      <Input placeholder={t('leave.notePlaceholder')} aria-label={t('leave.note')} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} maxLength={500} className="h-9" />
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" loading={decide.isPending && decide.variables?.id === r.id && decide.variables.decision === 'approved'} onClick={() => decide.mutate({ id: r.id, decision: 'approved' })}><Check />{t('leave.approve')}</Button>
                        <Button size="sm" variant="outline" className="flex-1" loading={decide.isPending && decide.variables?.id === r.id && decide.variables.decision === 'rejected'} onClick={() => decide.mutate({ id: r.id, decision: 'rejected' })}><X />{t('leave.reject')}</Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t('reg.approveNote')}</p>
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
    () =>
      (employees.data ?? [])
        .filter((e) => e.status === 'active' || (records.data ?? []).some((r) => r.employee_id === e.id))
        .map((e) => {
          const mine = (records.data ?? []).filter((r) => r.employee_id === e.id);
          return {
            e,
            s: summarizeMonth(month, e, records.data ?? [], leave.data ?? [], holidaySet),
            ot: mine.reduce((n, r) => n + (r.overtime_minutes ?? 0), 0),
            wfh: mine.filter((r) => r.work_mode === 'home').length,
          };
        }),
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
    { key: 'wfh', header: t('workMode.home'), align: 'right', hideOnMobile: true, cell: (r) => r.wfh },
    { key: 'hrs', header: t('att.totalHours'), align: 'right', cell: (r) => formatMinutes(r.s.workedMinutes) },
    { key: 'ot', header: t('att.overtime'), align: 'right', hideOnMobile: true, cell: (r) => formatMinutes(r.ot) },
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
      { header: 'Work from home days', value: (r) => r.wfh },
      { header: 'Hours worked', value: (r) => (r.s.workedMinutes / 60).toFixed(2) },
      { header: 'Overtime hours', value: (r) => (r.ot / 60).toFixed(2) },
    ]);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 sm:flex-none"><MonthSwitcher month={month} max={currentMonth()} onChange={setMonth} label={t('att.month')} /></div>
        <Button variant="outline" className="shrink-0 sm:ml-auto" onClick={exportCsv} disabled={!rows.length}><Download /><span className="hidden xs:inline">{t('common.exportCsv')}</span></Button>
      </div>
      {employees.isPending || records.isPending ? <ListSkeleton rows={5} /> : rows.length === 0 ? <EmptyState icon={UserX} title={t('hr.noEmployees')} /> : <DataTable caption={t('att.monthly')} columns={columns} rows={rows} rowKey={(r) => r.e.id} />}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export function AttendancePage() {
  const { t } = useTranslation();
  const { isHr, activeCompany } = useAuth();
  const me = useMyEmployee();
  const pendingCount = useRegularizations(isHr ? activeCompany?.id : undefined, { status: 'pending' }).data?.length ?? 0;
  const [params, setParams] = useSearchParams();
  const defaultTab = me.data ? 'me' : 'register';
  const tab = params.get('tab') ?? defaultTab;
  if (me.isPending) return <ListSkeleton rows={6} />;

  const mine = me.data ? (
    <div className="space-y-5">
      <TodayCard employee={me.data} />
      <MyMonth employee={me.data} />
      <MyRequests employeeId={me.data.id} />
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
            <TabsTrigger value="search">{t('att.search')}</TabsTrigger>
            <TabsTrigger value="requests">{t('reg.requests')}{pendingCount > 0 && <Badge tone="warning" className="ml-1.5">{pendingCount}</Badge>}</TabsTrigger>
            <TabsTrigger value="monthly">{t('att.monthly')}</TabsTrigger>
          </TabsList>
          {mine && <TabsContent value="me">{mine}</TabsContent>}
          <TabsContent value="register"><DailyRegister /></TabsContent>
          <TabsContent value="search"><AttendanceSearch /></TabsContent>
          <TabsContent value="requests"><RequestsQueue /></TabsContent>
          <TabsContent value="monthly"><MonthlyReport /></TabsContent>
        </Tabs>
      )}
    </>
  );
}

// ── Employee: request a correction (full page) ────────────────────────
export function RegularizePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const me = useMyEmployee();
  const today = istDateString(new Date());
  const back = '/portal/attendance';
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<RegularizationInput>({
    resolver: zodResolver(regularizationSchema) as never,
    values: {
      employee_id: me.data?.id ?? '',
      work_date: params.get('date') ?? addDays(today, -1),
      check_in_time: me.data ? hhmm(me.data.shift_start) : '09:30',
      check_out_time: me.data ? hhmm(me.data.shift_end) : '18:30',
      out_next_day: me.data ? hhmm(me.data.shift_end) <= hhmm(me.data.shift_start) : false,
      requested_status: 'present',
      work_mode: 'office',
      reason: '',
    },
    resetOptions: { keepDirtyValues: true },
  });
  const outNextDay = watch('out_next_day');

  const onSubmit = async (raw: RegularizationInput) => {
    const v = regularizationSchema.parse(raw);
    try {
      unwrap(await sb().from('attendance_regularizations').insert({ ...v, company_id: activeCompany!.id }).select('id').single());
      toast.success(t('reg.sent'));
      await invalidate();
      navigate(back);
    } catch (err) {
      onError(err);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={back}><ArrowLeft />{t('att.title')}</Link></Button>
      <PageHeader title={t('reg.title')} description={t('reg.subtitle')} />
      {me.isPending ? <ListSkeleton rows={4} /> : !me.data ? <EmptyState icon={Clock} title={t('att.noRecordTitle')} description={t('att.noRecordBody')} /> : (
        <form onSubmit={handleSubmit(onSubmit as never)} noValidate>
          <Card>
            <CardContent className="space-y-4 pt-5">
              <TextField label={t('att.date')} type="date" required min={addDays(today, -30)} max={today} hint={t('reg.windowHint')} error={errors.work_date?.message} {...register('work_date')} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={t('att.checkInTime')} type="time" required hint={t('common.istHint')} error={errors.check_in_time?.message} {...register('check_in_time')} />
                <TextField label={t('att.checkOutTime')} type="time" hint={outNextDay ? t('reg.nextDayHint') : undefined} error={errors.check_out_time?.message} {...register('check_out_time')} />
              </div>
              <CheckField label={t('reg.outNextDay')} {...register('out_next_day')} />
              <RadioGroupField label={t('reg.dayType')} inputProps={register('requested_status')} options={(['present', 'half_day'] as const).map((s) => ({ value: s, label: t(`dayStatus.${s}`) }))} />
              <RadioGroupField label={t('att.workMode')} inputProps={register('work_mode')} options={WORK_MODES.map((m) => ({ value: m, label: t(`workMode.${m}`) }))} />
              <TextareaField label={t('att.reason')} required rows={3} maxLength={500} placeholder={t('reg.reasonPlaceholder')} error={errors.reason?.message} {...register('reason')} />
              <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button variant="outline" asChild><Link to={back}>{t('common.cancel')}</Link></Button>
                <Button type="submit" loading={isSubmitting}><Send />{t('reg.send')}</Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}

// ── HR correction page ────────────────────────────────────────────────
export function AttendanceCorrectPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const employeeId = params.get('employee') ?? '';
  const date = params.get('date') ?? istDateString(new Date());
  const employees = useEmployees(activeCompany?.id);
  const employee = employees.data?.find((e) => e.id === employeeId);
  const records = useAttendance(activeCompany?.id, date, date, employeeId);
  const rec = records.data?.[0];
  const [form, setForm] = useState<{ status: string; in: string; out: string; nextDay: boolean; mode: WorkMode; notes: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const back = `/portal/attendance?tab=register`;

  useEffect(() => {
    if (records.isPending || form) return;
    const overnightDefault = employee ? hhmm(employee.shift_end) <= hhmm(employee.shift_start) : false;
    setForm({
      status: rec?.status ?? 'present',
      in: istHm(rec?.check_in_at),
      out: istHm(rec?.check_out_at),
      nextDay: rec?.check_out_at ? istDay(rec.check_out_at) > date : overnightDefault,
      mode: rec?.work_mode ?? 'office',
      notes: rec?.notes ?? '',
    });
  }, [records.isPending, rec, form, employee, date]);

  const save = useMutation({
    mutationFn: async () => {
      const f = form!;
      const working = f.status === 'present' || f.status === 'half_day';
      if (working && !f.in) throw new Error('errors.checkInRequired');
      if (working && f.out && !f.nextDay && f.out <= f.in) throw new Error('errors.out_before_in');
      return unwrap(
        await sb()
          .from('attendance_records')
          .upsert(
            {
              company_id: activeCompany!.id,
              employee_id: employeeId,
              work_date: date,
              status: f.status,
              work_mode: f.mode,
              check_in_at: working && f.in ? istToUtc(date, f.in).toISOString() : null,
              check_out_at: working && f.out ? istToUtc(f.nextDay ? addDays(date, 1) : date, f.out).toISOString() : null,
              on_break_since: null,
              notes: f.notes || null,
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
    onError,
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await sb().from('attendance_records').delete().eq('id', rec!.id).select('id')),
    onSuccess: async () => {
      toast.success(t('att.cleared'));
      await invalidate();
      navigate(back);
    },
    onError,
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
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label={t('att.checkInTime')} type="time" required value={form.in} onChange={(e) => setForm({ ...form, in: e.target.value })} hint={t('common.istHint')} />
                  <TextField label={t('att.checkOutTime')} type="time" value={form.out} onChange={(e) => setForm({ ...form, out: e.target.value })} hint={form.nextDay ? t('reg.nextDayHint') : undefined} />
                </div>
                <CheckField label={t('reg.outNextDay')} checked={form.nextDay} onChange={(e) => setForm({ ...form, nextDay: e.target.checked })} />
                <SelectField label={t('att.workMode')} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as WorkMode })}>
                  {WORK_MODES.map((m) => <option key={m} value={m}>{t(`workMode.${m}`)}</option>)}
                </SelectField>
              </>
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
