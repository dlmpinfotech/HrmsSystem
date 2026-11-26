import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, CalendarRange, ChevronLeft, ChevronRight, Plus, Repeat, Save, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { CheckField, RadioGroupField, SelectField, TextField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, PageHeader } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  hhmm,
  SHIFT_COLORS,
  useEmployees,
  useInvalidateHr,
  useRotations,
  useShiftAssignments,
  useShiftData,
  useShifts,
  type Shift,
  type ShiftAssignment,
  type ShiftRotation,
} from '@/features/hr/api';
import { errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { formatMinutes, isOvernight, mondayOf, resolveShift, rotationIndex, shiftMinutes } from '@shared/hr';
import { rotationSchema, shiftAssignmentSchema, shiftSchema, type ShiftAssignmentInput, type ShiftInput } from '@shared/schemas';
import { addDays, istDateString, istWeekday } from '@shared/slots';

const day = (date: string, lang: string) => formatDate(`${date}T06:30:00Z`, lang);

function useOnError() {
  const { t } = useTranslation();
  return (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
}

export function ShiftBadge({ shift }: { shift: { code: string; name: string; color?: string } }) {
  return <Badge tone={(shift.color ?? 'primary') as BadgeTone} title={shift.name}>{shift.code}</Badge>;
}

const timeRange = (s: Pick<Shift, 'start_time' | 'end_time'>) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}`;

// ── Roster (week grid) ────────────────────────────────────────────────
function Roster() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const [monday, setMonday] = useState(() => mondayOf(istDateString(new Date())));
  const [q, setQ] = useState('');
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);
  const employees = useEmployees(activeCompany?.id);
  const shiftData = useShiftData(activeCompany?.id, days[0], days[6]);
  const activeShifts = shiftData.data.shifts.filter((s) => s.is_active);
  const today = istDateString(new Date());
  const people = (employees.data ?? []).filter((e) => e.status === 'active' && (!q || `${e.full_name} ${e.employee_code} ${e.department ?? ''}`.toLowerCase().includes(q.toLowerCase())));

  const setDay = useMutation({
    mutationFn: async ({ employeeId, date, value }: { employeeId: string; date: string; value: string }) => {
      if (value === 'scheduled') {
        return unwrap(await sb().from('shift_overrides').delete().eq('employee_id', employeeId).eq('work_date', date).select('id'));
      }
      return unwrap(
        await sb()
          .from('shift_overrides')
          .upsert({ company_id: activeCompany!.id, employee_id: employeeId, work_date: date, shift_id: value === 'off' ? null : value }, { onConflict: 'employee_id,work_date' })
          .select('id'),
      );
    },
    onSuccess: async () => {
      toast.success(t('shifts.rosterSaved'));
      await invalidate();
    },
    onError,
  });

  if (employees.isError) return <ErrorState error={employees.error} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label={t('shifts.prevWeek')} onClick={() => setMonday(addDays(monday, -7))}><ChevronLeft /></Button>
          <Button variant="outline" size="sm" onClick={() => setMonday(mondayOf(today))}>{t('shifts.thisWeek')}</Button>
          <Button variant="outline" size="icon" aria-label={t('shifts.nextWeek')} onClick={() => setMonday(addDays(monday, 7))}><ChevronRight /></Button>
        </div>
        <p className="text-sm font-medium">{day(days[0], lang)} – {day(days[6], lang)}</p>
        <Input type="search" aria-label={t('common.search')} placeholder={t('hr.searchEmployees')} value={q} onChange={(e) => setQ(e.target.value)} className="sm:ml-auto sm:w-56" />
      </div>
      {employees.isPending || shiftData.isPending ? <ListSkeleton rows={5} /> : people.length === 0 ? (
        <EmptyState icon={Users} title={t('hr.noEmployees')} />
      ) : (
        <Card className="overflow-hidden">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">{t('shifts.roster')}</caption>
              <thead className="bg-muted/60 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-muted px-3 py-2">{t('hr.employee')}</th>
                  {days.map((d) => (
                    <th key={d} scope="col" className={cn('px-2 py-2 text-center', d === today && 'text-primary')}>
                      {t(`weekday.${istWeekday(d)}`)}<br /><span className="font-normal normal-case">{d.slice(8)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((e) => (
                  <tr key={e.id} className="border-t">
                    <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal">
                      <p className="font-semibold">{e.full_name}</p>
                      <p className="text-xs text-muted-foreground">{e.employee_code}</p>
                    </th>
                    {days.map((d) => {
                      const r = resolveShift(d, e, shiftData.data);
                      const weeklyOff = e.weekly_offs.includes(istWeekday(d));
                      const off = r.isOff || weeklyOff;
                      const value = r.source === 'override' ? (r.isOff ? 'off' : r.shift?.id ?? 'scheduled') : 'scheduled';
                      return (
                        <td key={d} className={cn('px-1.5 py-1.5 align-top', d === today && 'bg-primary/5')}>
                          <div className="flex flex-col items-center gap-1">
                            {off ? <Badge tone="outline">{t('shifts.off')}</Badge> : r.shift ? <ShiftBadge shift={r.shift} /> : <Badge tone="neutral">{t('shifts.default')}</Badge>}
                            <span className="text-[11px] tabular text-muted-foreground">{off ? '—' : `${r.start}–${r.end}`}</span>
                            <Select
                              aria-label={t('shifts.changeDay', { name: e.full_name, date: day(d, lang) })}
                              value={value}
                              disabled={setDay.isPending}
                              onChange={(ev) => setDay.mutate({ employeeId: e.id, date: d, value: ev.target.value })}
                              className={cn('h-8 w-full min-w-[88px] px-1 text-xs', r.source === 'override' && 'border-primary')}
                            >
                              <option value="scheduled">{t('shifts.asPlanned')}</option>
                              {activeShifts.map((s) => <option key={s.id} value={s.id}>{s.code} · {timeRange(s)}</option>)}
                              <option value="off">{t('shifts.dayOff')}</option>
                            </Select>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">{t('shifts.rosterHint')}</p>
    </div>
  );
}

// ── Shift templates ───────────────────────────────────────────────────
function ShiftList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeCompany } = useAuth();
  const shifts = useShifts(activeCompany?.id);
  const columns: Column<Shift>[] = [
    { key: 'name', header: t('shifts.name'), primary: true, cell: (s) => <span className="flex items-center gap-2"><ShiftBadge shift={s} /><span className="font-semibold">{s.name}</span></span> },
    { key: 'time', header: t('shifts.time'), cell: (s) => <span className="tabular">{timeRange(s)}{isOvernight(hhmm(s.start_time), hhmm(s.end_time)) && <Badge tone="info" className="ml-2">{t('shifts.overnight')}</Badge>}</span> },
    { key: 'hours', header: t('shifts.hours'), align: 'right', cell: (s) => formatMinutes(shiftMinutes(hhmm(s.start_time), hhmm(s.end_time), s.break_minutes)) },
    { key: 'break', header: t('shifts.break'), align: 'right', hideOnMobile: true, cell: (s) => `${s.break_minutes}m` },
    { key: 'grace', header: t('hr.grace'), align: 'right', hideOnMobile: true, cell: (s) => `${s.grace_minutes}m` },
    { key: 'status', header: t('crm.status'), cell: (s) => (s.is_active ? <Badge tone="success">{t('shifts.active')}</Badge> : <Badge tone="outline">{t('shifts.inactive')}</Badge>) },
  ];
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button asChild><Link to="/portal/shifts/new"><Plus />{t('shifts.newShift')}</Link></Button></div>
      {shifts.isPending ? <ListSkeleton rows={3} /> : !shifts.data?.length ? (
        <EmptyState icon={CalendarRange} title={t('shifts.noShifts')} description={t('shifts.noShiftsBody')} action={<Button asChild><Link to="/portal/shifts/new"><Plus />{t('shifts.newShift')}</Link></Button>} />
      ) : (
        <DataTable caption={t('shifts.templates')} columns={columns} rows={shifts.data} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/portal/shifts/${s.id}`)} />
      )}
    </div>
  );
}

export function ShiftFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams();
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const shifts = useShifts(activeCompany?.id);
  const editing = id ? shifts.data?.find((s) => s.id === id) : undefined;
  const back = '/portal/shifts?tab=templates';
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<ShiftInput>({
    resolver: zodResolver(shiftSchema) as never,
    values: editing
      ? { ...editing, start_time: hhmm(editing.start_time), end_time: hhmm(editing.end_time) }
      : { name: '', code: '', start_time: '09:00', end_time: '18:00', break_minutes: 60, grace_minutes: 10, early_grace_minutes: 10, overtime_after_minutes: 30, color: 'primary', is_active: true },
  });
  const [start, end, brk] = watch(['start_time', 'end_time', 'break_minutes']);
  const overnight = start && end && start !== end && isOvernight(start, end);

  const onSubmit = async (raw: ShiftInput) => {
    const v = shiftSchema.parse(raw);
    try {
      if (editing) unwrap(await sb().from('shifts').update(v).eq('id', editing.id).select('id').single());
      else unwrap(await sb().from('shifts').insert({ ...v, company_id: activeCompany!.id }).select('id').single());
      toast.success(t('common.saved'));
      await invalidate();
      navigate(back);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === '23505' || e.message?.includes('duplicate')) toast.error(t('validation.codeTaken'));
      else onError(err);
    }
  };

  if (id && shifts.isPending) return <ListSkeleton rows={5} />;
  if (id && !editing) return <ErrorState error={new Error('errors.generic')} />;
  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={back}><ArrowLeft />{t('shifts.title')}</Link></Button>
      <PageHeader title={editing ? editing.name : t('shifts.newShift')} description={t('shifts.formSubtitle')} />
      <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="space-y-5">
        <Card>
          <CardContent className="grid gap-4 pt-5 sm:grid-cols-2">
            <TextField label={t('shifts.name')} required placeholder={t('shifts.namePlaceholder')} error={errors.name?.message} {...register('name')} />
            <TextField label={t('shifts.code')} required maxLength={10} hint={t('shifts.codeHint')} error={errors.code?.message} {...register('code')} />
            <TextField label={t('hr.shiftStart')} type="time" required error={errors.start_time?.message} {...register('start_time')} />
            <TextField label={t('hr.shiftEnd')} type="time" required hint={overnight ? t('shifts.overnightHint') : undefined} error={errors.end_time?.message} {...register('end_time')} />
            <p className="text-sm text-muted-foreground sm:col-span-2">
              {start && end && start !== end ? t('shifts.lengthLine', { hours: formatMinutes(shiftMinutes(start, end, Number(brk) || 0)) }) : null}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('shifts.rules')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('shifts.breakMinutes')} type="number" min={0} max={240} hint={t('shifts.breakHint')} error={errors.break_minutes?.message} {...register('break_minutes')} />
            <TextField label={t('hr.grace')} type="number" min={0} max={120} hint={t('hr.graceHint')} error={errors.grace_minutes?.message} {...register('grace_minutes')} />
            <TextField label={t('shifts.earlyGrace')} type="number" min={0} max={120} hint={t('shifts.earlyGraceHint')} error={errors.early_grace_minutes?.message} {...register('early_grace_minutes')} />
            <TextField label={t('shifts.overtimeAfter')} type="number" min={0} max={480} hint={t('shifts.overtimeAfterHint')} error={errors.overtime_after_minutes?.message} {...register('overtime_after_minutes')} />
            <RadioGroupField className="sm:col-span-2" label={t('shifts.color')} inputProps={register('color')} options={SHIFT_COLORS.map((c) => ({ value: c, label: t(`shifts.colors.${c}`) }))} />
            <CheckField label={t('shifts.activeLabel')} {...register('is_active')} />
          </CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" asChild><Link to={back}>{t('common.cancel')}</Link></Button>
          <Button type="submit" loading={isSubmitting}><Save />{t('common.save')}</Button>
        </div>
      </form>
    </div>
  );
}

// ── Rotations ─────────────────────────────────────────────────────────
function RotationList() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const rotations = useRotations(activeCompany?.id);
  const shifts = useShifts(activeCompany?.id);
  const byId = new Map((shifts.data ?? []).map((s) => [s.id, s]));
  const [removeId, setRemoveId] = useState<string | null>(null);
  const today = istDateString(new Date());
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('shift_rotations').delete().eq('id', id).select('id')),
    onSuccess: async () => {
      setRemoveId(null);
      toast.success(t('shifts.rotationDeleted'));
      await invalidate();
    },
    onError,
  });
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button asChild disabled={!shifts.data?.length}><Link to="/portal/shifts/rotations/new"><Plus />{t('shifts.newRotation')}</Link></Button></div>
      {rotations.isPending ? <ListSkeleton rows={3} /> : !rotations.data?.length ? (
        <EmptyState icon={Repeat} title={t('shifts.noRotations')} description={t('shifts.noRotationsBody')} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rotations.data.map((r: ShiftRotation) => {
            const current = rotationIndex(r.anchor_date, today, r.shift_ids.length);
            return (
              <li key={r.id}>
                <Card className="p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{t('shifts.startsOn', { date: day(r.anchor_date, lang) })}</p>
                    </div>
                    <Button variant="ghost" size="icon" aria-label={t('common.delete')} onClick={() => setRemoveId(r.id)}><Trash2 /></Button>
                  </div>
                  <ol className="mt-3 space-y-1.5 text-sm">
                    {r.shift_ids.map((sid, i) => {
                      const s = byId.get(sid);
                      return (
                        <li key={`${sid}-${i}`} className={cn('flex items-center gap-2 rounded-lg px-2 py-1', i === current && 'bg-primary/10')}>
                          <span className="w-16 shrink-0 text-xs text-muted-foreground">{t('shifts.weekN', { n: i + 1 })}</span>
                          {s ? <><ShiftBadge shift={s} /><span className="tabular">{timeRange(s)}</span></> : <Badge tone="danger">{t('shifts.missingShift')}</Badge>}
                          {i === current && <Badge tone="primary" className="ml-auto">{t('shifts.thisWeek')}</Badge>}
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog open={Boolean(removeId)} onOpenChange={(o) => !o && setRemoveId(null)} title={t('shifts.deleteRotation')} description={t('shifts.deleteRotationBody')} confirmLabel={t('common.delete')} destructive loading={remove.isPending} onConfirm={() => removeId && remove.mutate(removeId)} />
    </div>
  );
}

export function RotationFormPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const shifts = useShifts(activeCompany?.id);
  const active = (shifts.data ?? []).filter((s) => s.is_active);
  const [name, setName] = useState('');
  const [anchor, setAnchor] = useState(() => mondayOf(istDateString(new Date())));
  const [weeks, setWeeks] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const back = '/portal/shifts?tab=rotations';
  const list = weeks.length ? weeks : active.slice(0, 3).map((s) => s.id);

  const move = (i: number, dir: -1 | 1) => {
    const next = [...list];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setWeeks(next);
  };

  const save = async () => {
    const parsed = rotationSchema.safeParse({ name, shift_ids: list, anchor_date: mondayOf(anchor) });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      unwrap(await sb().from('shift_rotations').insert({ ...parsed.data, company_id: activeCompany!.id }).select('id').single());
      toast.success(t('common.saved'));
      await invalidate();
      navigate(back);
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={back}><ArrowLeft />{t('shifts.title')}</Link></Button>
      <PageHeader title={t('shifts.newRotation')} description={t('shifts.rotationSubtitle')} />
      {shifts.isPending ? <ListSkeleton rows={4} /> : !active.length ? (
        <EmptyState icon={CalendarRange} title={t('shifts.noShifts')} action={<Button asChild><Link to="/portal/shifts/new"><Plus />{t('shifts.newShift')}</Link></Button>} />
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <TextField label={t('shifts.rotationName')} required placeholder={t('shifts.rotationNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
            <TextField label={t('shifts.firstWeek')} type="date" required value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} hint={t('shifts.firstWeekHint', { date: day(mondayOf(anchor), lang) })} error={errors.anchor_date} />
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{t('shifts.weekOrder')}</legend>
              {list.map((sid, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-sm text-muted-foreground">{t('shifts.weekN', { n: i + 1 })}</span>
                  <Select aria-label={t('shifts.weekN', { n: i + 1 })} value={sid} onChange={(e) => setWeeks(list.map((x, j) => (j === i ? e.target.value : x)))} className="flex-1">
                    {active.map((s) => <option key={s.id} value={s.id}>{s.name} ({timeRange(s)})</option>)}
                  </Select>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('shifts.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('shifts.moveDown')} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('common.delete')} disabled={list.length <= 1} onClick={() => setWeeks(list.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              ))}
              {errors.shift_ids && <p className="text-sm text-destructive">{t(errors.shift_ids)}</p>}
              <Button type="button" variant="outline" size="sm" disabled={list.length >= 12} onClick={() => setWeeks([...list, active[0].id])}><Plus />{t('shifts.addWeek')}</Button>
            </fieldset>
            <p className="rounded-lg bg-muted p-3 text-sm">{t('shifts.rotationExplain', { weeks: list.length })}</p>
            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button variant="outline" asChild><Link to={back}>{t('common.cancel')}</Link></Button>
              <Button loading={saving} onClick={() => void save()}><Save />{t('common.save')}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Assignments ───────────────────────────────────────────────────────
function AssignmentList() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const assignments = useShiftAssignments(activeCompany?.id);
  const employees = useEmployees(activeCompany?.id);
  const shifts = useShifts(activeCompany?.id);
  const rotations = useRotations(activeCompany?.id);
  const today = istDateString(new Date());
  const [endId, setEndId] = useState<string | null>(null);
  const empById = new Map((employees.data ?? []).map((e) => [e.id, e]));
  const shiftById = new Map((shifts.data ?? []).map((s) => [s.id, s]));
  const rotById = new Map((rotations.data ?? []).map((r) => [r.id, r]));
  const rows = (assignments.data ?? []).filter((a) => !a.effective_to || a.effective_to >= today);

  const end = useMutation({
    mutationFn: async (a: ShiftAssignment) =>
      a.effective_from > today
        ? unwrap(await sb().from('shift_assignments').delete().eq('id', a.id).select('id'))
        : unwrap(await sb().from('shift_assignments').update({ effective_to: addDays(today, -1) < a.effective_from ? a.effective_from : addDays(today, -1) }).eq('id', a.id).select('id')),
    onSuccess: async () => {
      setEndId(null);
      toast.success(t('shifts.assignmentEnded'));
      await invalidate();
    },
    onError,
  });

  const columns: Column<ShiftAssignment>[] = [
    { key: 'emp', header: t('hr.employee'), primary: true, cell: (a) => <div><p className="font-semibold">{empById.get(a.employee_id)?.full_name ?? '—'}</p><p className="text-xs text-muted-foreground">{empById.get(a.employee_id)?.employee_code}</p></div> },
    {
      key: 'what',
      header: t('shifts.assigned'),
      cell: (a) => {
        if (a.shift_id) { const s = shiftById.get(a.shift_id); return s ? <span className="flex items-center gap-2"><ShiftBadge shift={s} />{timeRange(s)}</span> : '—'; }
        const r = a.rotation_id ? rotById.get(a.rotation_id) : undefined;
        return r ? <span className="flex items-center gap-2"><Repeat className="size-4 text-primary" aria-hidden />{r.name}</span> : '—';
      },
    },
    { key: 'from', header: t('att.from'), cell: (a) => day(a.effective_from, lang) },
    { key: 'to', header: t('att.to'), cell: (a) => (a.effective_to ? day(a.effective_to, lang) : t('shifts.ongoing')) },
    { key: 'end', header: '', cell: (a) => <Button variant="ghost" size="sm" onClick={() => setEndId(a.id)}>{a.effective_from > today ? t('common.delete') : t('shifts.endAssignment')}</Button> },
  ];
  const ending = rows.find((a) => a.id === endId);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button asChild disabled={!shifts.data?.length}><Link to="/portal/shifts/assign"><UserPlus />{t('shifts.assign')}</Link></Button></div>
      {assignments.isPending || employees.isPending ? <ListSkeleton rows={3} /> : !rows.length ? (
        <EmptyState icon={UserPlus} title={t('shifts.noAssignments')} description={t('shifts.noAssignmentsBody')} />
      ) : (
        <DataTable caption={t('shifts.assignments')} columns={columns} rows={rows} rowKey={(a) => a.id} />
      )}
      <ConfirmDialog open={Boolean(ending)} onOpenChange={(o) => !o && setEndId(null)} title={t('shifts.endAssignment')} description={t('shifts.endAssignmentBody')} confirmLabel={t('shifts.endAssignment')} loading={end.isPending} onConfirm={() => ending && end.mutate(ending)} />
    </div>
  );
}

export function AssignShiftsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const { activeCompany, user } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const employees = useEmployees(activeCompany?.id);
  const shifts = useShifts(activeCompany?.id);
  const rotations = useRotations(activeCompany?.id);
  const [q, setQ] = useState('');
  const back = '/portal/shifts?tab=assignments';
  const today = istDateString(new Date());
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<ShiftAssignmentInput>({
    resolver: zodResolver(shiftAssignmentSchema) as never,
    defaultValues: { employee_ids: [], kind: 'rotation', target_id: '', effective_from: mondayOf(addDays(today, 7)), effective_to: '' },
  });
  const [kind, targetId, from, selected] = watch(['kind', 'target_id', 'effective_from', 'employee_ids']);
  const active = (employees.data ?? []).filter((e) => e.status === 'active');
  const visible = active.filter((e) => !q || `${e.full_name} ${e.employee_code} ${e.department ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const targets = kind === 'shift' ? (shifts.data ?? []).filter((s) => s.is_active).map((s) => ({ id: s.id, label: `${s.name} (${timeRange(s)})` })) : (rotations.data ?? []).map((r) => ({ id: r.id, label: r.name }));
  const rotation = kind === 'rotation' ? rotations.data?.find((r) => r.id === targetId) : undefined;
  const firstShift = rotation && from ? shifts.data?.find((s) => s.id === rotation.shift_ids[rotationIndex(rotation.anchor_date, from, rotation.shift_ids.length)]) : undefined;

  const onSubmit = async (raw: ShiftAssignmentInput) => {
    const v = shiftAssignmentSchema.parse(raw);
    try {
      unwrap(
        await sb()
          .from('shift_assignments')
          .insert(v.employee_ids.map((employee_id) => ({
            company_id: activeCompany!.id,
            employee_id,
            shift_id: v.kind === 'shift' ? v.target_id : null,
            rotation_id: v.kind === 'rotation' ? v.target_id : null,
            effective_from: v.effective_from,
            effective_to: v.effective_to,
            created_by: user!.id,
          })))
          .select('id'),
      );
      toast.success(t('shifts.assignedToast', { count: v.employee_ids.length }));
      await invalidate();
      navigate(back);
    } catch (err) {
      onError(err);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={back}><ArrowLeft />{t('shifts.title')}</Link></Button>
      <PageHeader title={t('shifts.assign')} description={t('shifts.assignSubtitle')} />
      {employees.isPending || shifts.isPending || rotations.isPending ? <ListSkeleton rows={5} /> : (
        <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{t('shifts.what')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <RadioGroupField label={t('shifts.assignType')} inputProps={register('kind', { onChange: () => setValue('target_id', '') })} options={[{ value: 'rotation', label: t('shifts.kindRotation'), hint: t('shifts.kindRotationHint') }, { value: 'shift', label: t('shifts.kindShift'), hint: t('shifts.kindShiftHint') }]} />
              <SelectField label={kind === 'shift' ? t('shifts.shift') : t('shifts.rotation')} required error={errors.target_id?.message} {...register('target_id')}>
                <option value="">{t('form.select')}</option>
                {targets.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </SelectField>
              {kind === 'rotation' && !rotations.data?.length && <p className="text-sm text-muted-foreground">{t('shifts.noRotations')} <Link className="text-primary hover:underline" to="/portal/shifts/rotations/new">{t('shifts.newRotation')}</Link></p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label={t('att.from')} type="date" required error={errors.effective_from?.message} {...register('effective_from')} />
                <TextField label={t('shifts.until')} type="date" hint={t('shifts.untilHint')} error={errors.effective_to?.message} {...register('effective_to')} />
              </div>
              {firstShift && from && <p className="rounded-lg bg-muted p-3 text-sm">{t('shifts.previewLine', { date: day(from, lang), shift: `${firstShift.name} (${timeRange(firstShift)})` })}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle>{t('shifts.who', { count: selected.length })}</CardTitle>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setValue('employee_ids', [...new Set([...selected, ...visible.map((e) => e.id)])], { shouldValidate: true })}>{t('shifts.selectAll')}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setValue('employee_ids', [], { shouldValidate: true })}>{t('shifts.clear')}</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input type="search" aria-label={t('common.search')} placeholder={t('hr.searchEmployees')} value={q} onChange={(e) => setQ(e.target.value)} />
              <ul className="scroll-thin grid max-h-80 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                {visible.map((e) => (
                  <li key={e.id}>
                    <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 hover:bg-muted">
                      <input type="checkbox" value={e.id} className="size-4 accent-[hsl(var(--primary))]" {...register('employee_ids')} />
                      <span className="min-w-0 flex-1 truncate text-sm">{e.full_name} <span className="text-xs text-muted-foreground">{e.employee_code}{e.department ? ` · ${e.department}` : ''}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
              {errors.employee_ids && <p className="text-sm text-destructive">{t(errors.employee_ids.message ?? 'validation.pickEmployees')}</p>}
            </CardContent>
          </Card>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" asChild><Link to={back}>{t('common.cancel')}</Link></Button>
            <Button type="submit" loading={isSubmitting}><Save />{t('shifts.assignN', { count: selected.length })}</Button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export function ShiftsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'roster';
  return (
    <>
      <PageHeader title={t('shifts.title')} description={t('shifts.subtitle')} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="roster">{t('shifts.roster')}</TabsTrigger>
          <TabsTrigger value="templates">{t('shifts.templates')}</TabsTrigger>
          <TabsTrigger value="rotations">{t('shifts.rotations')}</TabsTrigger>
          <TabsTrigger value="assignments">{t('shifts.assignments')}</TabsTrigger>
        </TabsList>
        <TabsContent value="roster"><Roster /></TabsContent>
        <TabsContent value="templates"><ShiftList /></TabsContent>
        <TabsContent value="rotations"><RotationList /></TabsContent>
        <TabsContent value="assignments"><AssignmentList /></TabsContent>
      </Tabs>
    </>
  );
}
