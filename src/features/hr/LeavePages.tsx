import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, Check, Download, Plus, Send, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { CheckField, RadioGroupField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { useEmployees, useHolidays, useInvalidateHr, useLeaveRequests, useLeaveTypes, useMyEmployee, type LeaveRequest } from '@/features/hr/api';
import { errorKey } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { countLeaveDays, leaveBalances } from '@shared/hr';
import { leaveRequestSchema, type LeaveRequestInput } from '@shared/schemas';
import { istDateString } from '@shared/slots';

const d = (date: string, lang: string) => formatDate(`${date}T06:30:00Z`, lang);
const range = (r: Pick<LeaveRequest, 'start_date' | 'end_date' | 'half_day'>, lang: string, halfLabel: string) =>
  r.start_date === r.end_date ? `${d(r.start_date, lang)}${r.half_day ? ` (${halfLabel})` : ''}` : `${d(r.start_date, lang)} – ${d(r.end_date, lang)}`;

function useOnError() {
  const { t } = useTranslation();
  return (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
}

// ── Balances + my requests ────────────────────────────────────────────
function MyLeave({ employeeId }: { employeeId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const types = useLeaveTypes(activeCompany?.id);
  const requests = useLeaveRequests(activeCompany?.id, { employeeId });
  const [cancelId, setCancelId] = useState<string | null>(null);
  const year = Number(istDateString(new Date()).slice(0, 4));
  const balances = useMemo(() => leaveBalances((types.data ?? []).filter((x) => x.is_active), requests.data ?? [], year), [types.data, requests.data, year]);
  const cancel = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('leave_requests').update({ status: 'cancelled' }).eq('id', id).select('id').single()),
    onSuccess: async () => {
      setCancelId(null);
      toast.success(t('leave.cancelled'));
      await invalidate();
    },
    onError,
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(types.data ?? []).filter((x) => x.is_active).map((lt) => {
          const b = balances.find((x) => x.typeId === lt.id)!;
          return (
            <Card key={lt.id} className="p-4">
              <p className="text-sm text-muted-foreground">{lt.name} <span className="text-xs">({lt.code})</span></p>
              <p className="mt-1 text-2xl font-bold tabular">{b.available === null ? '∞' : b.available}</p>
              <p className="text-xs text-muted-foreground">{b.quota === null ? t('leave.noLimit') : t('leave.balanceLine', { used: b.used, pending: b.pending, quota: b.quota })}</p>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader><CardTitle>{t('leave.myRequests')}</CardTitle></CardHeader>
        <CardContent>
          {requests.isPending ? <ListSkeleton rows={3} /> : !requests.data?.length ? <EmptyState icon={CalendarPlus} title={t('leave.none')} /> : (
            <ul className="divide-y rounded-xl border">
              {requests.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{r.leave_types?.name} · {range(r, lang, t('leave.halfDay'))}</p>
                    <p className="text-xs text-muted-foreground">{t('leave.daysCount', { count: Number(r.days) })}{r.reason ? ` · ${r.reason}` : ''}{r.decision_note ? ` · ${t('leave.note')}: ${r.decision_note}` : ''}</p>
                  </div>
                  <StatusBadge value={r.status} group="leaveStatus" />
                  {r.status === 'pending' && <Button variant="ghost" size="sm" onClick={() => setCancelId(r.id)}>{t('leave.withdraw')}</Button>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog open={Boolean(cancelId)} onOpenChange={(o) => !o && setCancelId(null)} title={t('leave.withdraw')} description={t('leave.withdrawConfirm')} confirmLabel={t('leave.withdraw')} destructive loading={cancel.isPending} onConfirm={() => cancelId && cancel.mutate(cancelId)} />
    </div>
  );
}

// ── HR: approvals + all requests ──────────────────────────────────────
function Approvals() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const pending = useLeaveRequests(activeCompany?.id, { status: 'pending' });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'approved' | 'rejected' }) =>
      unwrap(await sb().from('leave_requests').update({ status, decision_note: notes[id]?.trim() || null }).eq('id', id).select('id').single()),
    onSuccess: async (_d, v) => {
      toast.success(v.status === 'approved' ? t('leave.approvedToast') : t('leave.rejectedToast'));
      await invalidate();
    },
    onError,
  });
  if (pending.isPending) return <ListSkeleton rows={3} />;
  if (!pending.data?.length) return <EmptyState icon={Check} title={t('leave.noPending')} />;
  return (
    <ul className="space-y-3">
      {[...pending.data].sort((a, b) => a.start_date.localeCompare(b.start_date)).map((r) => (
        <li key={r.id}>
          <Card className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{r.employees?.full_name} <span className="text-xs font-normal text-muted-foreground">{r.employees?.employee_code}{r.employees?.department ? ` · ${r.employees.department}` : ''}</span></p>
                <p className="text-sm">{r.leave_types?.name} · {range(r, lang, t('leave.halfDay'))} · <strong>{t('leave.daysCount', { count: Number(r.days) })}</strong></p>
                {r.reason && <p className="mt-1 text-sm text-muted-foreground">“{r.reason}”</p>}
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-72">
                <Input placeholder={t('leave.notePlaceholder')} aria-label={t('leave.note')} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} maxLength={500} className="h-9" />
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" loading={decide.isPending && decide.variables?.id === r.id && decide.variables.status === 'approved'} onClick={() => decide.mutate({ id: r.id, status: 'approved' })}><Check />{t('leave.approve')}</Button>
                  <Button size="sm" variant="outline" className="flex-1" loading={decide.isPending && decide.variables?.id === r.id && decide.variables.status === 'rejected'} onClick={() => decide.mutate({ id: r.id, status: 'rejected' })}><X />{t('leave.reject')}</Button>
                </div>
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function AllRequests() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const requests = useLeaveRequests(activeCompany?.id, { status: status || undefined });
  const rows = (requests.data ?? []).filter((r) => !search || `${r.employees?.full_name} ${r.employees?.employee_code}`.toLowerCase().includes(search.toLowerCase()));
  const columns: Column<LeaveRequest>[] = [
    { key: 'emp', header: t('hr.employee'), primary: true, cell: (r) => <div><p className="font-semibold">{r.employees?.full_name}</p><p className="text-xs text-muted-foreground">{r.employees?.employee_code}</p></div> },
    { key: 'type', header: t('leave.type'), cell: (r) => r.leave_types?.name },
    { key: 'dates', header: t('leave.dates'), cell: (r) => range(r, lang, t('leave.halfDay')) },
    { key: 'days', header: t('leave.days'), align: 'right', cell: (r) => Number(r.days) },
    { key: 'status', header: t('crm.status'), cell: (r) => <StatusBadge value={r.status} group="leaveStatus" /> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input type="search" aria-label={t('common.search')} placeholder={t('hr.searchEmployees')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44">
          <option value="">{t('crm.allStatuses')}</option>
          {(['pending', 'approved', 'rejected', 'cancelled'] as const).map((s) => <option key={s} value={s}>{t(`leaveStatus.${s}`)}</option>)}
        </Select>
        <Button variant="outline" size="sm" className="sm:ml-auto" disabled={!rows.length} onClick={() => downloadCsv('leave-requests', rows, [
          { header: 'Employee code', value: (r) => r.employees?.employee_code }, { header: 'Name', value: (r) => r.employees?.full_name },
          { header: 'Type', value: (r) => r.leave_types?.code }, { header: 'From', value: (r) => r.start_date }, { header: 'To', value: (r) => r.end_date },
          { header: 'Days', value: (r) => Number(r.days) }, { header: 'Status', value: (r) => r.status }, { header: 'Reason', value: (r) => r.reason }, { header: 'Note', value: (r) => r.decision_note },
        ])}><Download />{t('common.exportCsv')}</Button>
      </div>
      {requests.isPending ? <ListSkeleton rows={4} /> : rows.length === 0 ? <EmptyState icon={CalendarPlus} title={t('leave.none')} /> : <DataTable caption={t('leave.allRequests')} columns={columns} rows={rows} rowKey={(r) => r.id} />}
    </div>
  );
}

// ── HR: leave types + holidays ────────────────────────────────────────
function LeaveSettings() {
  const { t, i18n } = useTranslation();
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const types = useLeaveTypes(activeCompany?.id);
  const holidays = useHolidays(activeCompany?.id);
  const [newType, setNewType] = useState({ name: '', code: '', annual_quota: '', is_paid: true });
  const [newHoliday, setNewHoliday] = useState({ holiday_date: '', name: '' });
  const [year, setYear] = useState(istDateString(new Date()).slice(0, 4));
  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>) => unwrap(await fn()),
    onSuccess: async () => {
      toast.success(t('common.saved'));
      await invalidate();
    },
    onError,
  });
  const companyId = activeCompany!.id;
  const yearHolidays = (holidays.data ?? []).filter((h) => h.holiday_date.startsWith(year));

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>{t('leave.types')}</CardTitle><p className="text-sm text-muted-foreground">{t('leave.typesHint')}</p></CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y rounded-xl border">
            {types.data?.map((lt) => (
              <li key={lt.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1"><p className="font-medium">{lt.name} <span className="text-xs text-muted-foreground">({lt.code})</span></p><p className="text-xs text-muted-foreground">{lt.is_paid ? t('leave.paid') : t('leave.unpaid')}</p></div>
                <label className="flex items-center gap-1.5 text-xs">
                  {t('leave.quota')}
                  <Input type="number" min={0} step={0.5} defaultValue={lt.annual_quota ?? ''} placeholder="∞" className="h-8 w-20" aria-label={t('leave.quota')}
                    onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (lt.annual_quota === null ? null : Number(lt.annual_quota))) run.mutate(() => sb().from('leave_types').update({ annual_quota: v }).eq('id', lt.id).select('id').single()); }} />
                </label>
                <Switch checked={lt.is_active} aria-label={t('common.active')} onCheckedChange={(v) => run.mutate(() => sb().from('leave_types').update({ is_active: v }).eq('id', lt.id).select('id').single())} />
              </li>
            ))}
          </ul>
          <div className="grid gap-2 rounded-xl border border-dashed p-3 sm:grid-cols-[1fr_90px_90px]">
            <TextField label={t('leave.typeName')} value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} placeholder={t('leave.typeNamePlaceholder')} />
            <TextField label={t('leave.code')} value={newType.code} maxLength={10} onChange={(e) => setNewType({ ...newType, code: e.target.value.toUpperCase() })} />
            <TextField label={t('leave.quota')} type="number" min={0} value={newType.annual_quota} onChange={(e) => setNewType({ ...newType, annual_quota: e.target.value })} placeholder="∞" />
            <CheckField label={t('leave.paid')} checked={newType.is_paid} onChange={(e) => setNewType({ ...newType, is_paid: e.target.checked })} className="sm:col-span-2" />
            <Button size="sm" disabled={newType.name.trim().length < 2 || !newType.code.trim()} onClick={() => run.mutate(() => sb().from('leave_types').insert({ company_id: companyId, name: newType.name.trim(), code: newType.code.trim(), annual_quota: newType.annual_quota === '' ? null : Number(newType.annual_quota), is_paid: newType.is_paid, sort_order: (types.data?.length ?? 0) + 1 }).select('id').single(), { onSuccess: () => setNewType({ name: '', code: '', annual_quota: '', is_paid: true }) })}><Plus />{t('common.add')}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div><CardTitle>{t('leave.holidays')}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{t('leave.holidaysHint')}</p></div>
          <Input type="number" aria-label={t('leave.year')} value={year} min={2020} max={2100} onChange={(e) => setYear(e.target.value)} className="h-9 w-24" />
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y rounded-xl border">
            {yearHolidays.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">{t('leave.noHolidays')}</li>}
            {yearHolidays.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="w-32 shrink-0 font-medium">{d(h.holiday_date, i18n.language)}</span>
                <span className="flex-1">{h.name}</span>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onClick={() => run.mutate(() => sb().from('holidays').delete().eq('id', h.id).select('id'))}><Trash2 /></Button>
              </li>
            ))}
          </ul>
          <div className="grid gap-2 rounded-xl border border-dashed p-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
            <TextField label={t('att.date')} type="date" value={newHoliday.holiday_date} onChange={(e) => setNewHoliday({ ...newHoliday, holiday_date: e.target.value })} />
            <TextField label={t('leave.holidayName')} value={newHoliday.name} onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })} placeholder={t('leave.holidayPlaceholder')} />
            <Button size="sm" disabled={!newHoliday.holiday_date || newHoliday.name.trim().length < 2} onClick={() => run.mutate(() => sb().from('holidays').insert({ company_id: companyId, holiday_date: newHoliday.holiday_date, name: newHoliday.name.trim() }).select('id').single(), { onSuccess: () => setNewHoliday({ holiday_date: '', name: '' }) })}><Plus />{t('common.add')}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export function LeavePage() {
  const { t } = useTranslation();
  const { isHr } = useAuth();
  const me = useMyEmployee();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? (isHr ? 'approvals' : 'mine');
  if (me.isPending) return <ListSkeleton rows={5} />;
  const canApply = Boolean(me.data) || isHr;
  const header = <PageHeader title={t('leave.title')} description={isHr ? t('leave.subtitleHr') : t('leave.subtitle')} actions={canApply ? <Button asChild><Link to="/portal/leave/apply"><CalendarPlus />{t('leave.apply')}</Link></Button> : undefined} />;
  if (!isHr) {
    return (
      <>
        {header}
        {me.data ? <MyLeave employeeId={me.data.id} /> : <EmptyState icon={CalendarPlus} title={t('att.noRecordTitle')} description={t('att.noRecordBody')} />}
      </>
    );
  }
  return (
    <>
      {header}
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="approvals">{t('leave.approvals')}</TabsTrigger>
          {me.data && <TabsTrigger value="mine">{t('leave.myLeave')}</TabsTrigger>}
          <TabsTrigger value="all">{t('leave.allRequests')}</TabsTrigger>
          <TabsTrigger value="settings">{t('leave.settings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="approvals"><Approvals /></TabsContent>
        {me.data && <TabsContent value="mine"><MyLeave employeeId={me.data.id} /></TabsContent>}
        <TabsContent value="all"><AllRequests /></TabsContent>
        <TabsContent value="settings"><LeaveSettings /></TabsContent>
      </Tabs>
    </>
  );
}

// ── Apply page ────────────────────────────────────────────────────────
export function ApplyLeavePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeCompany, isHr } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const me = useMyEmployee();
  const employees = useEmployees(activeCompany?.id, isHr);
  const types = useLeaveTypes(activeCompany?.id);
  const holidays = useHolidays(activeCompany?.id);
  const today = istDateString(new Date());
  const [approveNow, setApproveNow] = useState(false);
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<LeaveRequestInput>({
    resolver: zodResolver(leaveRequestSchema) as never,
    values: { employee_id: me.data?.id ?? '', leave_type_id: '', start_date: today, end_date: today, half_day: false, reason: '' },
    resetOptions: { keepDirtyValues: true },
  });
  const v = watch();
  const employee = isHr ? employees.data?.find((e) => e.id === v.employee_id) : me.data ?? undefined;
  const requests = useLeaveRequests(activeCompany?.id, { employeeId: v.employee_id || undefined });
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);
  const days = employee ? countLeaveDays(v.start_date, v.half_day ? v.start_date : v.end_date, Boolean(v.half_day), employee.weekly_offs, holidaySet) : 0;
  const balances = useMemo(() => leaveBalances((types.data ?? []).filter((x) => x.is_active), requests.data ?? [], Number((v.start_date || today).slice(0, 4))), [types.data, requests.data, v.start_date, today]);

  const onSubmit = async (raw: LeaveRequestInput) => {
    const input = leaveRequestSchema.parse({ ...raw, end_date: raw.half_day ? raw.start_date : raw.end_date });
    try {
      unwrap(
        await sb()
          .from('leave_requests')
          .insert({ employee_id: input.employee_id, leave_type_id: input.leave_type_id, start_date: input.start_date, end_date: input.end_date, half_day: input.half_day, reason: input.reason ?? null, status: isHr && approveNow ? 'approved' : 'pending' })
          .select('id')
          .single(),
      );
      toast.success(isHr && approveNow ? t('leave.approvedToast') : t('leave.submitted'));
      await invalidate();
      navigate('/portal/leave');
    } catch (err) {
      onError(err);
    }
  };

  if (me.isPending || types.isPending) return <ListSkeleton rows={6} />;
  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to="/portal/leave"><ArrowLeft />{t('leave.back')}</Link></Button>
      <PageHeader title={t('leave.apply')} description={t('leave.applySubtitle')} />
      <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="space-y-5">
        <Card>
          <CardContent className="space-y-5 pt-5">
            {isHr && (
              <SelectField label={t('hr.employee')} required error={errors.employee_id?.message} {...register('employee_id')}>
                <option value="">{t('form.select')}</option>
                {(employees.data ?? []).filter((e) => e.status === 'active').map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
              </SelectField>
            )}
            <RadioGroupField
              label={t('leave.type')}
              error={errors.leave_type_id?.message}
              inputProps={register('leave_type_id')}
              options={(types.data ?? []).filter((x) => x.is_active).map((lt) => {
                const b = balances.find((x) => x.typeId === lt.id);
                return { value: lt.id, label: `${lt.name} (${lt.code})`, hint: b?.available === null || !b ? t('leave.noLimit') : t('leave.available', { count: b.available }) };
              })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={t('leave.from')} type="date" required error={errors.start_date?.message} {...register('start_date')} />
              {!v.half_day && <TextField label={t('leave.to')} type="date" required min={v.start_date} error={errors.end_date?.message} {...register('end_date')} />}
            </div>
            <CheckField label={t('leave.halfDayLabel')} error={errors.half_day?.message} {...register('half_day')} />
            <TextareaField label={t('leave.reason')} rows={3} maxLength={1000} error={errors.reason?.message} {...register('reason')} />
            {employee && <p className="rounded-lg bg-muted p-3 text-sm">{days > 0 ? t('leave.preview', { count: days }) : t('leave.previewNone')}</p>}
            {isHr && <label className="flex items-center gap-3 text-sm font-medium"><Switch checked={approveNow} onCheckedChange={setApproveNow} />{t('leave.approveNow')}</label>}
          </CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" asChild><Link to="/portal/leave">{t('common.cancel')}</Link></Button>
          <Button type="submit" loading={isSubmitting} disabled={!employee || days <= 0}><Send />{isHr && approveNow ? t('leave.saveApproved') : t('leave.submit')}</Button>
        </div>
      </form>
    </div>
  );
}

