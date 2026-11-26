import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CalendarPlus, Check, ChevronLeft, ChevronRight, Download, Gift, Plus, Send, Settings2, Trash2, Wallet, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { FilterBar } from '@/components/shared/FilterBar';
import { CheckField, RadioGroupField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, FormDialog, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  hhmm,
  useApprovalTeam,
  useCompOffCredits,
  useDirectReports,
  useEncashments,
  useEmployees,
  useHolidays,
  useInvalidateHr,
  useLeaveBalances,
  useLeaveRequests,
  useLeaveTypes,
  useMyEmployee,
  useTeamLeave,
  type CompOffCredit,
  type LeaveEncashment,
  type Employee,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType,
} from '@/features/hr/api';
import { ApprovalLimitsCard, DelegationCard } from '@/features/hr/Delegation';
import { errorKey } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatCurrency, formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { countLeaveDays, datesInMonth, currentMonth } from '@shared/hr';
import { leaveRequestSchema, leaveTypeRulesSchema, compOffSchema, encashSchema, type LeaveRequestInput, type LeaveTypeRulesInput, type CompOffInput, type EncashInput } from '@shared/schemas';
import { istDateString, istWeekday } from '@shared/slots';

const d = (date: string, lang: string) => formatDate(`${date}T06:30:00Z`, lang);
type RangeLike = Pick<LeaveRequest, 'start_date' | 'end_date' | 'half_day'> & { start_time?: string | null; end_time?: string | null };
const range = (r: RangeLike, lang: string, halfLabel: string) => {
  if (r.start_time && r.end_time) return `${d(r.start_date, lang)} · ${hhmm(r.start_time)}–${hhmm(r.end_time)}`;
  return r.start_date === r.end_date ? `${d(r.start_date, lang)}${r.half_day ? ` (${halfLabel})` : ''}` : `${d(r.start_date, lang)} – ${d(r.end_date, lang)}`;
};

function useOnError() {
  const { t } = useTranslation();
  return (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
}

function useAmount() {
  const { t } = useTranslation();
  return (r: Pick<LeaveRequest, 'days' | 'hours'>) => (r.hours !== null && r.hours !== undefined && Number(r.days) === 0 ? t('leave.hoursCount', { count: Number(r.hours) }) : t('leave.daysCount', { count: Number(r.days) }));
}

/** Status, with "manager approved, waiting for HR" for two-level requests. */
function RequestStatus({ r }: { r: Pick<LeaveRequest, 'status' | 'approval_step'> }) {
  const { t } = useTranslation();
  if (r.status === 'pending' && r.approval_step === 2) return <Badge tone="info">{t('leave.managerApproved')}</Badge>;
  return <StatusBadge value={r.status} group="leaveStatus" />;
}

// ── Balances ──────────────────────────────────────────────────────────
function balanceLine(t: TFunction, b: LeaveBalance | undefined) {
  if (!b) return '';
  if (b.unit === 'hour') return b.hours_limit === null ? t('leave.noLimit') : t('leave.hoursLine', { used: b.hours_used_month ?? 0, limit: b.hours_limit });
  if (b.is_comp_off) return t('leave.compOffLine', { used: b.used, pending: b.pending });
  if (b.entitled === null) return t('leave.noLimit');
  return t('leave.balanceLineV2', { used: b.used, pending: b.pending, entitled: b.entitled }) + (b.carried > 0 ? ` · ${t('leave.carried', { count: b.carried })}` : '') + (b.encashed > 0 ? ` · ${t('encash.encashedLine', { count: b.encashed })}` : '');
}

export function BalanceCards({ employeeId, types }: { employeeId: string; types: LeaveType[] }) {
  const { t } = useTranslation();
  const year = Number(istDateString(new Date()).slice(0, 4));
  const balances = useLeaveBalances(employeeId, year);
  if (balances.isPending) return <ListSkeleton rows={2} />;
  if (balances.isError) return <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {types.filter((x) => x.is_active).map((lt) => {
        const b = balances.data?.find((x) => x.leave_type_id === lt.id);
        const value = !b ? '—' : b.available === null ? '∞' : b.unit === 'hour' ? `${b.available}h` : String(b.available);
        return (
          <Card key={lt.id} className="p-4">
            <p className="text-sm text-muted-foreground">{lt.name} <span className="text-xs">({lt.code})</span></p>
            <p className="mt-1 font-display text-2xl font-bold tabular">{value}</p>
            <p className="text-xs text-muted-foreground">{balanceLine(t, b)}</p>
          </Card>
        );
      })}
    </div>
  );
}

// ── My leave ──────────────────────────────────────────────────────────
function MyLeave({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const amount = useAmount();
  const types = useLeaveTypes(activeCompany?.id);
  const reports = useDirectReports(employee.id);
  const requests = useLeaveRequests(activeCompany?.id, { employeeId: employee.id });
  const [cancelId, setCancelId] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('leave_requests').update({ status: 'cancelled' }).eq('id', id).select('id').single()),
    onSuccess: async () => {
      setCancelId(null);
      toast.success(t('leave.cancelled'));
      await invalidate();
    },
    onError,
  });
  const hasCompOff = (types.data ?? []).some((x) => x.is_comp_off && x.is_active);

  return (
    <div className="space-y-5">
      <BalanceCards employeeId={employee.id} types={types.data ?? []} />
      <Card>
        <CardHeader><CardTitle>{t('leave.myRequests')}</CardTitle></CardHeader>
        <CardContent>
          {requests.isPending ? <ListSkeleton rows={3} /> : requests.isError ? <ErrorState error={requests.error} onRetry={() => void requests.refetch()} /> : !requests.data?.length ? <EmptyState icon={CalendarPlus} title={t('leave.none')} /> : (
            <ul className="divide-y rounded-xl border">
              {requests.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{r.leave_types?.name} · {range(r, lang, t('leave.halfDay'))}</p>
                    <p className="text-xs text-muted-foreground">
                      {amount(r)}
                      {r.reason ? ` · ${r.reason}` : ''}
                      {r.manager_note ? ` · ${t('leave.managerNote')}: ${r.manager_note}` : ''}
                      {r.decision_note ? ` · ${t('leave.note')}: ${r.decision_note}` : ''}
                    </p>
                  </div>
                  <RequestStatus r={r} />
                  {r.status === 'pending' && <Button variant="ghost" size="sm" onClick={() => setCancelId(r.id)}>{t('leave.withdraw')}</Button>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {(types.data ?? []).some((x) => x.encashable && x.is_active) && <EncashSection employee={employee} types={(types.data ?? []).filter((x) => x.encashable && x.is_active)} />}
      {hasCompOff && <CompOffSection employee={employee} />}
      {(reports.data?.length ?? 0) > 0 && <DelegationCard fixedManager={employee} />}
      <ConfirmDialog open={Boolean(cancelId)} onOpenChange={(o) => !o && setCancelId(null)} title={t('leave.withdraw')} description={t('leave.withdrawConfirm')} confirmLabel={t('leave.withdraw')} destructive loading={cancel.isPending} onConfirm={() => cancelId && cancel.mutate(cancelId)} />
    </div>
  );
}

// ── Leave encashment ──────────────────────────────────────────────────
function EncashSection({ employee, types }: { employee: Employee; types: LeaveType[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const year = Number(istDateString(new Date()).slice(0, 4));
  const balances = useLeaveBalances(employee.id, year);
  const list = useEncashments(activeCompany?.id, { employeeId: employee.id });
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<EncashInput>({
    resolver: zodResolver(encashSchema) as never,
    defaultValues: { leave_type_id: types[0]?.id ?? '', days: '' as unknown as number, reason: '' },
  });
  const typeId = watch('leave_type_id');
  const sel = types.find((x) => x.id === typeId);
  const bal = balances.data?.find((b) => b.leave_type_id === typeId);
  const canTake = bal?.available === null || bal?.available === undefined ? 0 : Math.min(bal.available, sel?.max_encash_days === null || sel?.max_encash_days === undefined ? Infinity : Math.max(Number(sel.max_encash_days) - bal.encashed, 0));
  const onSubmit = async (raw: EncashInput) => {
    const v = encashSchema.parse(raw);
    try {
      unwrap(await sb().from('leave_encashments').insert({ employee_id: employee.id, leave_type_id: v.leave_type_id, year, days: v.days, reason: v.reason ?? null }).select('id').single());
      toast.success(t('encash.requested'));
      reset();
      setOpen(false);
      await invalidate();
    } catch (err) {
      onError(err);
    }
  };
  const withdraw = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('leave_encashments').update({ status: 'cancelled' }).eq('id', id).select('id').single()),
    onSuccess: async () => {
      toast.success(t('leave.cancelled'));
      await invalidate();
    },
    onError,
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{t('encash.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('encash.hint')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Wallet />{t('encash.request')}</Button>
      </CardHeader>
      <CardContent>
        {list.isPending ? <ListSkeleton rows={2} /> : list.isError ? <ErrorState error={list.error} /> : !list.data?.length ? <p className="text-sm text-muted-foreground">{t('encash.none')}</p> : (
          <ul className="divide-y rounded-xl border text-sm">
            {list.data.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t('encash.line', { type: x.leave_types?.name ?? '', days: x.days, year: x.year })}</p>
                  <p className="text-xs text-muted-foreground">
                    {x.amount !== null ? formatCurrency(x.amount, lang) : t('encash.amountOnApproval')}
                    {x.paid_run_id ? ` · ${t('encash.paid')}` : x.status === 'approved' ? ` · ${t('encash.nextPayroll')}` : ''}
                    {x.decision_note ? ` · ${t('leave.note')}: ${x.decision_note}` : ''}
                  </p>
                </div>
                <StatusBadge value={x.status} group="leaveStatus" />
                {x.status === 'pending' && <Button variant="ghost" size="sm" loading={withdraw.isPending && withdraw.variables === x.id} onClick={() => withdraw.mutate(x.id)}>{t('leave.withdraw')}</Button>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <FormDialog open={open} onOpenChange={setOpen} title={t('encash.request')} description={t('encash.requestHint')}>
        <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
            <SelectField label={t('leave.type')} error={errors.leave_type_id?.message} {...register('leave_type_id')}>
              {types.map((lt) => <option key={lt.id} value={lt.id}>{lt.name} ({lt.code})</option>)}
            </SelectField>
            <TextField label={t('encash.days')} type="number" inputMode="decimal" min={0.5} step={0.5} max={Number.isFinite(canTake) ? canTake : undefined} required hint={t('encash.canTake', { count: Number.isFinite(canTake) ? canTake : 0 })} error={errors.days?.message} {...register('days')} />
            <TextareaField label={t('leave.reason')} rows={2} maxLength={500} error={errors.reason?.message} {...register('reason')} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting} disabled={!canTake}><Send />{t('leave.submit')}</Button>
          </DialogFooter>
        </form>
      </FormDialog>
    </Card>
  );
}

// ── Comp-off: earn credits ────────────────────────────────────────────
function CompOffSection({ employee }: { employee: Employee }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const credits = useCompOffCredits(activeCompany?.id, { employeeId: employee.id });
  const [open, setOpen] = useState(false);
  const today = istDateString(new Date());
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CompOffInput>({
    resolver: zodResolver(compOffSchema) as never,
    defaultValues: { work_date: '', days: '1', reason: '' } as unknown as CompOffInput,
  });
  const onSubmit = async (raw: CompOffInput) => {
    const v = compOffSchema.parse(raw);
    try {
      unwrap(await sb().from('comp_off_credits').insert({ employee_id: employee.id, work_date: v.work_date, days: v.days, reason: v.reason ?? null }).select('id').single());
      toast.success(t('compOff.requested'));
      reset();
      setOpen(false);
      await invalidate();
    } catch (err) {
      onError(err);
    }
  };
  const withdraw = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('comp_off_credits').update({ status: 'cancelled' }).eq('id', id).select('id').single()),
    onSuccess: async () => {
      toast.success(t('leave.cancelled'));
      await invalidate();
    },
    onError,
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{t('compOff.title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('compOff.hint')}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Gift />{t('compOff.request')}</Button>
      </CardHeader>
      <CardContent>
        {credits.isPending ? <ListSkeleton rows={2} /> : credits.isError ? <ErrorState error={credits.error} /> : !credits.data?.length ? <p className="text-sm text-muted-foreground">{t('compOff.none')}</p> : (
          <ul className="divide-y rounded-xl border text-sm">
            {credits.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t('compOff.workedOn', { date: d(c.work_date, lang) })} · {t('leave.daysCount', { count: Number(c.days) })}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.expires_on ? (c.expires_on < today ? t('compOff.expired', { date: d(c.expires_on, lang) }) : t('compOff.expires', { date: d(c.expires_on, lang) })) : ''}
                    {c.reason ? ` · ${c.reason}` : ''}
                  </p>
                </div>
                <StatusBadge value={c.status} group="leaveStatus" />
                {c.status === 'pending' && <Button variant="ghost" size="sm" loading={withdraw.isPending && withdraw.variables === c.id} onClick={() => withdraw.mutate(c.id)}>{t('leave.withdraw')}</Button>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <FormDialog open={open} onOpenChange={setOpen} title={t('compOff.request')} description={t('compOff.requestHint')}>
        <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
          <TextField label={t('compOff.dateWorked')} type="date" max={today} required error={errors.work_date?.message} {...register('work_date')} />
          <RadioGroupField label={t('compOff.credit')} inputProps={register('days')} options={[{ value: '1', label: t('compOff.fullDay') }, { value: '0.5', label: t('compOff.halfDay') }]} />
          <TextareaField label={t('leave.reason')} rows={2} maxLength={500} error={errors.reason?.message} {...register('reason')} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}><Send />{t('leave.submit')}</Button>
          </DialogFooter>
        </form>
      </FormDialog>
    </Card>
  );
}

// ── Approvals (HR: everything; managers: their team's first step) ─────
function Approvals({ scope, reportIds }: { scope: 'hr' | 'team'; reportIds?: string[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const amount = useAmount();
  const pending = useLeaveRequests(activeCompany?.id, { status: 'pending' });
  const credits = useCompOffCredits(activeCompany?.id, { status: 'pending' });
  const encash = useEncashments(scope === 'hr' ? activeCompany?.id : undefined, { status: 'pending' });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const mine = (employeeId: string) => scope === 'hr' || (reportIds ?? []).includes(employeeId);
  const leaveRows = (pending.data ?? []).filter((r) => mine(r.employee_id) && (scope === 'hr' || r.approval_step === 1)).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const creditRows = (credits.data ?? []).filter((c) => mine(c.employee_id));
  const encashRows = scope === 'hr' ? encash.data ?? [] : [];

  const decide = useMutation({
    mutationFn: async ({ table, id, status }: { table: 'leave_requests' | 'comp_off_credits' | 'leave_encashments'; id: string; status: 'approved' | 'rejected' }) =>
      unwrap(await sb().from(table).update({ status, decision_note: notes[id]?.trim() || null }).eq('id', id).select('id, status').single()) as { status: string },
    onSuccess: async (row, v) => {
      toast.success(v.status === 'rejected' ? t('leave.rejectedToast') : row.status === 'pending' ? t('leave.forwardedToast') : t('leave.approvedToast'));
      await invalidate();
    },
    onError,
  });

  if (pending.isPending || credits.isPending) return <ListSkeleton rows={3} />;
  const failed = [pending, credits].find((q) => q.isError);
  if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  if (!leaveRows.length && !creditRows.length && !encashRows.length) return <EmptyState icon={Check} title={t('leave.noPending')} />;

  const actions = (table: 'leave_requests' | 'comp_off_credits' | 'leave_encashments', id: string, twoStep: boolean) => (
    <div className="flex w-full flex-col gap-2 sm:w-72">
      <Input placeholder={t('leave.notePlaceholder')} aria-label={t('leave.note')} value={notes[id] ?? ''} onChange={(e) => setNotes({ ...notes, [id]: e.target.value })} maxLength={500} className="h-9" />
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" loading={decide.isPending && decide.variables?.id === id && decide.variables.status === 'approved'} onClick={() => decide.mutate({ table, id, status: 'approved' })}>
          <Check />{twoStep ? t('leave.approveForward') : t('leave.approve')}
        </Button>
        <Button size="sm" variant="outline" className="flex-1" loading={decide.isPending && decide.variables?.id === id && decide.variables.status === 'rejected'} onClick={() => decide.mutate({ table, id, status: 'rejected' })}><X />{t('leave.reject')}</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {leaveRows.length > 0 && (
        <ul className="space-y-3">
          {leaveRows.map((r) => (
            <li key={r.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-semibold">{r.employees?.full_name} <span className="text-xs font-normal text-muted-foreground">{r.employees?.employee_code}{r.employees?.department ? ` · ${r.employees.department}` : ''}</span></p>
                    <p className="text-sm">{r.leave_types?.name} · {range(r, lang, t('leave.halfDay'))} · <strong>{amount(r)}</strong></p>
                    {r.reason && <p className="text-sm text-muted-foreground">“{r.reason}”</p>}
                    {r.approval_step === 2 && <p className="text-xs"><Badge tone="info">{t('leave.managerApproved')}</Badge>{r.manager_note ? <span className="ml-2 text-muted-foreground">{r.manager_note}</span> : null}</p>}
                  </div>
                  {actions('leave_requests', r.id, scope === 'team' && r.leave_types?.approval_levels === 2)}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {creditRows.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('compOff.pendingTitle')}</h3>
          <ul className="space-y-3">
            {creditRows.map((c: CompOffCredit) => (
              <li key={c.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-semibold">{c.employees?.full_name} <span className="text-xs font-normal text-muted-foreground">{c.employees?.employee_code}</span></p>
                      <p className="text-sm">{t('compOff.workedOn', { date: d(c.work_date, lang) })} · <strong>{t('leave.daysCount', { count: Number(c.days) })}</strong></p>
                      {c.reason && <p className="text-sm text-muted-foreground">“{c.reason}”</p>}
                    </div>
                    {actions('comp_off_credits', c.id, false)}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
      {encashRows.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('encash.pendingTitle')}</h3>
          <ul className="space-y-3">
            {encashRows.map((x: LeaveEncashment) => (
              <li key={x.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-semibold">{x.employees?.full_name} <span className="text-xs font-normal text-muted-foreground">{x.employees?.employee_code}</span></p>
                      <p className="text-sm">{t('encash.line', { type: x.leave_types?.name ?? '', days: x.days, year: x.year })}</p>
                      <p className="text-xs text-muted-foreground">{t('encash.amountOnApproval')}</p>
                      {x.reason && <p className="text-sm text-muted-foreground">“{x.reason}”</p>}
                    </div>
                    {actions('leave_encashments', x.id, false)}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ── Team calendar ─────────────────────────────────────────────────────
function TeamCalendar() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const [month, setMonth] = useState(currentMonth());
  const days = datesInMonth(month);
  const from = days[0];
  const to = days[days.length - 1];
  const rows = useTeamLeave(activeCompany?.id, from, to);
  const holidays = useHolidays(activeCompany?.id);
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);
  const today = istDateString(new Date());
  const people = useMemo(() => {
    const m = new Map<string, { name: string; department: string | null; items: NonNullable<typeof rows.data> }>();
    for (const r of rows.data ?? []) {
      const p = m.get(r.employee_id) ?? { name: r.full_name, department: r.department, items: [] };
      p.items.push(r);
      m.set(r.employee_id, p);
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rows.data]);
  const shift = (n: number) => {
    const [y, mo] = month.split('-').map(Number);
    const dt = new Date(Date.UTC(y, mo - 1 + n, 1));
    setMonth(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const monthLabel = new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  const awayToday = (rows.data ?? []).filter((r) => r.start_date <= today && r.end_date >= today);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label={t('leave.prevMonth')} onClick={() => shift(-1)}><ChevronLeft /></Button>
        <p className="min-w-40 text-center font-semibold">{monthLabel}</p>
        <Button variant="outline" size="icon-sm" aria-label={t('leave.nextMonth')} onClick={() => shift(1)}><ChevronRight /></Button>
        {month !== currentMonth() && <Button variant="ghost" size="sm" onClick={() => setMonth(currentMonth())}>{t('leave.thisMonth')}</Button>}
        <span className="ml-auto flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="size-3 rounded-[3px] bg-primary" aria-hidden />{t('leaveStatus.approved')}</span>
          <span className="flex items-center gap-1"><span className="size-3 rounded-[3px] bg-primary/35" aria-hidden />{t('leaveStatus.pending')}</span>
        </span>
      </div>
      {month === currentMonth() && (
        <p className="text-sm text-muted-foreground">{awayToday.length ? t('leave.awayToday', { names: [...new Set(awayToday.map((r) => r.full_name))].join(', ') }) : t('leave.nobodyAway')}</p>
      )}
      {rows.isPending ? <ListSkeleton rows={4} /> : rows.isError ? <ErrorState error={rows.error} onRetry={() => void rows.refetch()} /> : people.length === 0 ? <EmptyState icon={CalendarDays} title={t('leave.calendarEmpty')} /> : (
        <Card className="overflow-hidden">
          <div className="scroll-thin overflow-x-auto">
            <table className="w-max min-w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 min-w-36 bg-card px-3 py-2 text-left font-medium text-muted-foreground">{t('hr.employee')}</th>
                  {days.map((day) => {
                    const off = holidaySet.has(day) || istWeekday(day) === 0;
                    return (
                      <th key={day} scope="col" className={cn('w-7 px-0 py-2 text-center font-medium tabular', off ? 'text-muted-foreground/60' : 'text-muted-foreground', day === today && 'text-primary')}>
                        {Number(day.slice(8))}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {people.map(([id, p]) => (
                  <tr key={id} className="border-t">
                    <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">
                      <span className="block max-w-40 truncate">{p.name}</span>
                      {p.department && <span className="block text-[11px] font-normal text-muted-foreground">{p.department}</span>}
                    </th>
                    {days.map((day) => {
                      const hit = p.items.find((r) => r.start_date <= day && r.end_date >= day);
                      const off = holidaySet.has(day);
                      return (
                        <td key={day} className={cn('h-9 px-0.5 text-center', off && 'bg-muted/50', day === today && 'bg-primary/5')}>
                          {hit && (
                            <span
                              title={`${p.name} · ${hit.leave_name} · ${range(hit, lang, t('leave.halfDay'))} · ${t(`leaveStatus.${hit.status}`)}`}
                              className={cn('mx-auto flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold', hit.status === 'approved' ? 'bg-primary text-primary-foreground' : 'bg-primary/35 text-foreground', (hit.half_day || hit.start_time) && 'w-3.5')}
                            >
                              {hit.half_day || hit.start_time ? '' : hit.leave_code.slice(0, 2)}
                            </span>
                          )}
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
    </div>
  );
}

// ── HR: all requests ──────────────────────────────────────────────────
function AllRequests() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const amount = useAmount();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const requests = useLeaveRequests(activeCompany?.id, { status: status || undefined });
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const [cancelRow, setCancelRow] = useState<LeaveRequest | null>(null);
  const cancel = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('leave_requests').update({ status: 'cancelled' }).eq('id', id).select('id').single()),
    onSuccess: async () => {
      setCancelRow(null);
      toast.success(t('leave.approvedCancelled'));
      await invalidate();
    },
    onError,
  });
  const rows = (requests.data ?? []).filter((r) => !search || `${r.employees?.full_name} ${r.employees?.employee_code}`.toLowerCase().includes(search.toLowerCase()));
  const columns: Column<LeaveRequest>[] = [
    { key: 'emp', header: t('hr.employee'), primary: true, cell: (r) => <div><p className="font-semibold">{r.employees?.full_name}</p><p className="text-xs text-muted-foreground">{r.employees?.employee_code}</p></div> },
    { key: 'type', header: t('leave.type'), cell: (r) => r.leave_types?.name },
    { key: 'dates', header: t('leave.dates'), cell: (r) => range(r, lang, t('leave.halfDay')) },
    { key: 'days', header: t('leave.days'), align: 'right', cell: (r) => amount(r) },
    { key: 'status', header: t('crm.status'), cell: (r) => <RequestStatus r={r} /> },
    {
      key: 'actions',
      header: t('leave.actions'),
      cell: (r) => (r.status === 'approved' ? <Button variant="outline" size="sm" onClick={() => setCancelRow(r)}><X />{t('leave.cancelApproved')}</Button> : '—'),
    },
  ];
  return (
    <div className="space-y-3">
      <FilterBar
        search={<Input type="search" aria-label={t('common.search')} placeholder={t('hr.searchEmployees')} value={search} onChange={(e) => setSearch(e.target.value)} />}
        activeCount={status ? 1 : 0}
        onReset={() => setStatus('')}
        filters={[{
          label: t('crm.status'),
          control: (
            <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('crm.allStatuses')}</option>
              {(['pending', 'approved', 'rejected', 'cancelled'] as const).map((s) => <option key={s} value={s}>{t(`leaveStatus.${s}`)}</option>)}
            </Select>
          ),
        }]}
      />
      <div className="flex justify-end">
        <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => downloadCsv('leave-requests', rows, [
          { header: 'Employee code', value: (r) => r.employees?.employee_code }, { header: 'Name', value: (r) => r.employees?.full_name },
          { header: 'Type', value: (r) => r.leave_types?.code }, { header: 'From', value: (r) => r.start_date }, { header: 'To', value: (r) => r.end_date },
          { header: 'Start time', value: (r) => hhmm(r.start_time) }, { header: 'End time', value: (r) => hhmm(r.end_time) },
          { header: 'Days', value: (r) => Number(r.days) }, { header: 'Hours', value: (r) => (r.hours === null ? '' : Number(r.hours)) },
          { header: 'Status', value: (r) => r.status }, { header: 'Reason', value: (r) => r.reason }, { header: 'Manager note', value: (r) => r.manager_note }, { header: 'Note', value: (r) => r.decision_note },
        ])}><Download />{t('common.exportCsv')}</Button>
      </div>
      {requests.isPending ? <ListSkeleton rows={4} /> : requests.isError ? <ErrorState error={requests.error} onRetry={() => void requests.refetch()} /> : rows.length === 0 ? <EmptyState icon={CalendarPlus} title={t('leave.none')} /> : <DataTable caption={t('leave.allRequests')} columns={columns} rows={rows} rowKey={(r) => r.id} />}
      <ConfirmDialog
        open={Boolean(cancelRow)}
        onOpenChange={(o) => !o && setCancelRow(null)}
        title={t('leave.cancelApproved')}
        description={cancelRow ? t('leave.cancelApprovedConfirm', { name: cancelRow.employees?.full_name ?? '', dates: range(cancelRow, lang, t('leave.halfDay')) }) : ''}
        confirmLabel={t('leave.cancelApproved')}
        destructive
        loading={cancel.isPending}
        onConfirm={() => cancelRow && cancel.mutate(cancelRow.id)}
      />
    </div>
  );
}

// ── HR: leave type rules ──────────────────────────────────────────────
function RulesDialog({ type, onClose }: { type: LeaveType | null; onClose: () => void }) {
  const { t } = useTranslation();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<LeaveTypeRulesInput>({
    resolver: zodResolver(leaveTypeRulesSchema) as never,
    values: type
      ? ({
          annual_quota: type.annual_quota === null ? '' : String(type.annual_quota),
          accrual: type.accrual,
          carry_forward_max: String(type.carry_forward_max ?? 0),
          max_hours_per_month: type.max_hours_per_month === null ? '' : String(type.max_hours_per_month),
          approval_levels: String(type.approval_levels),
          is_paid: type.is_paid,
          encashable: type.encashable,
          max_encash_days: type.max_encash_days === null ? '' : String(type.max_encash_days),
        } as unknown as LeaveTypeRulesInput)
      : undefined,
  });
  const quota = watch('annual_quota' as never) as unknown as string;
  const encashable = watch('encashable');
  const onSubmit = async (raw: LeaveTypeRulesInput) => {
    if (!type) return;
    const v = leaveTypeRulesSchema.parse(raw);
    const patch =
      type.unit === 'hour'
        ? { max_hours_per_month: v.max_hours_per_month, approval_levels: v.approval_levels, is_paid: v.is_paid }
        : type.is_comp_off
          ? { approval_levels: v.approval_levels, is_paid: v.is_paid }
          : {
              annual_quota: v.annual_quota, accrual: v.accrual, carry_forward_max: v.annual_quota === null ? 0 : v.carry_forward_max, approval_levels: v.approval_levels, is_paid: v.is_paid,
              encashable: v.annual_quota !== null && v.encashable, max_encash_days: v.annual_quota !== null && v.encashable ? v.max_encash_days : null,
            };
    try {
      unwrap(await sb().from('leave_types').update(patch).eq('id', type.id).select('id').single());
      toast.success(t('common.saved'));
      await invalidate();
      onClose();
    } catch (err) {
      onError(err);
    }
  };
  return (
    <FormDialog open={Boolean(type)} onOpenChange={(o) => !o && onClose()} title={type ? t('leave.rulesFor', { name: type.name }) : ''} description={t('leave.rulesHint')}>
      {type && (
        <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
          {type.unit === 'day' && !type.is_comp_off && (
            <>
              <TextField label={t('leave.quota')} type="number" min={0} step={0.5} placeholder="∞" hint={t('leave.quotaHint')} error={errors.annual_quota?.message} {...register('annual_quota')} />
              {quota !== '' && (
                <>
                  <RadioGroupField label={t('leave.accrual')} inputProps={register('accrual')} options={(['annual', 'monthly'] as const).map((a) => ({ value: a, label: t(`leave.accruals.${a}`), hint: t(`leave.accrualHints.${a}`) }))} />
                  <TextField label={t('leave.carryForward')} type="number" min={0} step={0.5} hint={t('leave.carryForwardHint')} error={errors.carry_forward_max?.message} {...register('carry_forward_max')} />
                  <CheckField label={t('encash.allow')} {...register('encashable')} />
                  {encashable && <TextField label={t('encash.maxDays')} type="number" min={0.5} step={0.5} placeholder="∞" hint={t('encash.maxDaysHint')} error={errors.max_encash_days?.message} {...register('max_encash_days')} />}
                </>
              )}
            </>
          )}
          {type.unit === 'hour' && (
            <TextField label={t('leave.maxHours')} type="number" min={0.5} step={0.5} placeholder="∞" hint={t('leave.maxHoursHint')} error={errors.max_hours_per_month?.message} {...register('max_hours_per_month')} />
          )}
          {type.is_comp_off && <p className="rounded-lg bg-muted p-3 text-sm">{t('leave.compOffRules')}</p>}
          <RadioGroupField label={t('leave.approvalLevels')} inputProps={register('approval_levels')} options={(['1', '2'] as const).map((n) => ({ value: n, label: t(`leave.levels.${n}`), hint: t(`leave.levelHints.${n}`) }))} />
          <CheckField label={t('leave.paid')} {...register('is_paid')} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" loading={isSubmitting}>{t('common.save')}</Button>
          </DialogFooter>
        </form>
      )}
    </FormDialog>
  );
}

function typeSummary(t: TFunction, lt: LeaveType) {
  const parts: string[] = [lt.is_paid ? t('leave.paid') : t('leave.unpaid')];
  if (lt.unit === 'hour') parts.push(lt.max_hours_per_month === null ? t('leave.hourlyNoLimit') : t('leave.hourlyLimit', { count: Number(lt.max_hours_per_month) }));
  else if (lt.is_comp_off) parts.push(t('leave.compOffShort'));
  else if (lt.annual_quota === null) parts.push(t('leave.noLimit'));
  else {
    parts.push(t('leave.perYear', { count: Number(lt.annual_quota) }));
    if (lt.accrual === 'monthly') parts.push(t('leave.accruals.monthly'));
    if (Number(lt.carry_forward_max) > 0) parts.push(t('leave.carryUpTo', { count: Number(lt.carry_forward_max) }));
  }
  if (lt.encashable) parts.push(t('encash.short'));
  if (lt.approval_levels === 2) parts.push(t('leave.levels.2'));
  return parts.join(' · ');
}

function LeaveSettings() {
  const { t, i18n } = useTranslation();
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const types = useLeaveTypes(activeCompany?.id);
  const holidays = useHolidays(activeCompany?.id);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [newType, setNewType] = useState({ name: '', code: '', annual_quota: '', is_paid: true, unit: 'day' as 'day' | 'hour' });
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
        <CardHeader><CardTitle>{t('leave.types')}</CardTitle><p className="text-sm text-muted-foreground">{t('leave.typesHintV2')}</p></CardHeader>
        <CardContent className="space-y-3">
          <ul className="divide-y rounded-xl border">
            {types.data?.map((lt) => (
              <li key={lt.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-[10rem] flex-1">
                  <p className="font-medium">{lt.name} <span className="text-xs text-muted-foreground">({lt.code})</span></p>
                  <p className="text-xs text-muted-foreground">{typeSummary(t, lt)}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setEditing(lt)}><Settings2 />{t('leave.rules')}</Button>
                <Switch checked={lt.is_active} aria-label={t('common.active')} onCheckedChange={(v) => run.mutate(() => sb().from('leave_types').update({ is_active: v }).eq('id', lt.id).select('id').single())} />
              </li>
            ))}
          </ul>
          <div className="grid gap-2 rounded-xl border border-dashed p-3 sm:grid-cols-[1fr_90px_110px]">
            <TextField label={t('leave.typeName')} value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} placeholder={t('leave.typeNamePlaceholder')} />
            <TextField label={t('leave.code')} value={newType.code} maxLength={10} onChange={(e) => setNewType({ ...newType, code: e.target.value.toUpperCase() })} />
            <SelectField label={t('leave.unit')} value={newType.unit} onChange={(e) => setNewType({ ...newType, unit: e.target.value as 'day' | 'hour', annual_quota: '' })}>
              <option value="day">{t('leave.units.day')}</option>
              <option value="hour">{t('leave.units.hour')}</option>
            </SelectField>
            {newType.unit === 'day' && <TextField label={t('leave.quota')} type="number" min={0} value={newType.annual_quota} onChange={(e) => setNewType({ ...newType, annual_quota: e.target.value })} placeholder="∞" />}
            <CheckField label={t('leave.paid')} checked={newType.is_paid} onChange={(e) => setNewType({ ...newType, is_paid: e.target.checked })} className="self-end" />
            <Button
              size="sm"
              className="self-end"
              disabled={newType.name.trim().length < 2 || !newType.code.trim()}
              onClick={() =>
                run.mutate(
                  () =>
                    sb()
                      .from('leave_types')
                      .insert({ company_id: companyId, name: newType.name.trim(), code: newType.code.trim(), unit: newType.unit, annual_quota: newType.unit === 'day' && newType.annual_quota !== '' ? Number(newType.annual_quota) : null, is_paid: newType.is_paid, sort_order: (types.data?.length ?? 0) + 1 })
                      .select('id')
                      .single(),
                  { onSuccess: () => setNewType({ name: '', code: '', annual_quota: '', is_paid: true, unit: 'day' }) },
                )
              }
            >
              <Plus />{t('common.add')}
            </Button>
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
      <DelegationCard />
      <ApprovalLimitsCard />
      <RulesDialog type={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────
export function LeavePage() {
  const { t } = useTranslation();
  const { isHr } = useAuth();
  const me = useMyEmployee();
  const { activeCompany } = useAuth();
  const team = useApprovalTeam(activeCompany?.id, !isHr && Boolean(me.data));
  const [params, setParams] = useSearchParams();
  const isManager = !isHr && (team.data?.length ?? 0) > 0;
  const tab = params.get('tab') ?? (isHr ? 'approvals' : 'mine');
  if (me.isPending) return <ListSkeleton rows={5} />;
  const canApply = Boolean(me.data) || isHr;
  const header = <PageHeader title={t('leave.title')} description={isHr ? t('leave.subtitleHr') : t('leave.subtitle')} actions={canApply ? <Button asChild><Link to="/portal/leave/apply"><CalendarPlus />{t('leave.apply')}</Link></Button> : undefined} />;
  if (!isHr && !me.data) {
    return (
      <>
        {header}
        <EmptyState icon={CalendarPlus} title={t('att.noRecordTitle')} description={t('att.noRecordBody')} />
      </>
    );
  }
  return (
    <>
      {header}
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          {isHr && <TabsTrigger value="approvals">{t('leave.approvals')}</TabsTrigger>}
          {isManager && <TabsTrigger value="team">{t('leave.teamApprovals')}</TabsTrigger>}
          {me.data && <TabsTrigger value="mine">{t('leave.myLeave')}</TabsTrigger>}
          <TabsTrigger value="calendar">{t('leave.teamCalendar')}</TabsTrigger>
          {isHr && <TabsTrigger value="all">{t('leave.allRequests')}</TabsTrigger>}
          {isHr && <TabsTrigger value="settings">{t('leave.settings')}</TabsTrigger>}
        </TabsList>
        {isHr && <TabsContent value="approvals"><Approvals scope="hr" /></TabsContent>}
        {isManager && <TabsContent value="team"><Approvals scope="team" reportIds={team.data ?? []} /></TabsContent>}
        {me.data && <TabsContent value="mine"><MyLeave employee={me.data} /></TabsContent>}
        <TabsContent value="calendar"><TeamCalendar /></TabsContent>
        {isHr && <TabsContent value="all"><AllRequests /></TabsContent>}
        {isHr && <TabsContent value="settings"><LeaveSettings /></TabsContent>}
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
    values: { employee_id: me.data?.id ?? '', leave_type_id: '', start_date: today, end_date: today, half_day: false, reason: '', start_time: '', end_time: '' },
    resetOptions: { keepDirtyValues: true },
  });
  const v = watch();
  const employee = isHr ? employees.data?.find((e) => e.id === v.employee_id) : me.data ?? undefined;
  const year = Number((v.start_date || today).slice(0, 4));
  const balances = useLeaveBalances(employee?.id, year);
  const type = types.data?.find((x) => x.id === v.leave_type_id);
  const hourly = type?.unit === 'hour';
  const singleDay = hourly || type?.is_comp_off;
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.holiday_date)), [holidays.data]);
  const days = employee ? countLeaveDays(v.start_date, v.half_day || singleDay ? v.start_date : v.end_date, Boolean(v.half_day), employee.weekly_offs, holidaySet) : 0;
  const hours = hourly && v.start_time && v.end_time && v.end_time > v.start_time ? (Number(v.end_time.slice(0, 2)) * 60 + Number(v.end_time.slice(3, 5)) - Number(v.start_time.slice(0, 2)) * 60 - Number(v.start_time.slice(3, 5))) / 60 : 0;

  const onSubmit = async (raw: LeaveRequestInput) => {
    const input = leaveRequestSchema.parse({ ...raw, end_date: raw.half_day || singleDay ? raw.start_date : raw.end_date, half_day: hourly ? false : raw.half_day, start_time: hourly ? raw.start_time : '', end_time: hourly ? raw.end_time : '' });
    if (hourly && !input.start_time) return toast.error(t('errors.hours_required'));
    try {
      unwrap(
        await sb()
          .from('leave_requests')
          .insert({
            employee_id: input.employee_id, leave_type_id: input.leave_type_id, start_date: input.start_date, end_date: input.end_date, half_day: input.half_day,
            start_time: input.start_time ?? null, end_time: input.end_time ?? null, reason: input.reason ?? null, status: isHr && approveNow ? 'approved' : 'pending',
          })
          .select('id')
          .single(),
      );
      toast.success(isHr && approveNow ? t('leave.approvedToast') : t('leave.submittedV2'));
      await invalidate();
      navigate('/portal/leave');
    } catch (err) {
      onError(err);
    }
  };

  if (me.isPending || types.isPending) return <ListSkeleton rows={6} />;
  const hintFor = (lt: LeaveType) => {
    const b = balances.data?.find((x) => x.leave_type_id === lt.id);
    if (!b) return '';
    if (b.available === null) return t('leave.noLimit');
    if (b.unit === 'hour') return t('leave.hoursAvailable', { count: b.available });
    return t('leave.available', { count: b.available });
  };
  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to="/portal/leave"><ArrowLeft />{t('leave.back')}</Link></Button>
      <PageHeader title={t('leave.apply')} description={t('leave.applySubtitle')} />
      {balances.isError && <ErrorState className="mb-4" error={balances.error} onRetry={() => void balances.refetch()} />}
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
              options={(types.data ?? []).filter((x) => x.is_active).map((lt) => ({ value: lt.id, label: `${lt.name} (${lt.code})`, hint: hintFor(lt) }))}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={singleDay ? t('att.date') : t('leave.from')} type="date" required error={errors.start_date?.message} {...register('start_date')} />
              {!v.half_day && !singleDay && <TextField label={t('leave.to')} type="date" required min={v.start_date} error={errors.end_date?.message} {...register('end_date')} />}
            </div>
            {hourly && (
              <div className="grid grid-cols-2 gap-4">
                <TextField label={t('leave.fromTime')} type="time" required error={errors.start_time?.message} {...register('start_time')} />
                <TextField label={t('leave.toTime')} type="time" required error={errors.end_time?.message} {...register('end_time')} />
              </div>
            )}
            {!hourly && <CheckField label={t('leave.halfDayLabel')} error={errors.half_day?.message} {...register('half_day')} />}
            {type?.is_comp_off && <p className="text-sm text-muted-foreground">{t('leave.compOffApplyHint')}</p>}
            <TextareaField label={t('leave.reason')} rows={3} maxLength={1000} error={errors.reason?.message} {...register('reason')} />
            {employee && (
              <p className="rounded-lg bg-muted p-3 text-sm">
                {hourly ? (hours > 0 ? t('leave.previewHours', { count: hours }) : t('leave.previewHoursNone')) : days > 0 ? t('leave.preview', { count: days }) : t('leave.previewNone')}
                {type?.approval_levels === 2 && <span className="mt-1 block text-xs text-muted-foreground">{t('leave.twoLevelNote')}</span>}
              </p>
            )}
            {isHr && <label className="flex items-center gap-3 text-sm font-medium"><Switch checked={approveNow} onCheckedChange={setApproveNow} />{t('leave.approveNow')}</label>}
          </CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" asChild><Link to="/portal/leave">{t('common.cancel')}</Link></Button>
          <Button type="submit" loading={isSubmitting} disabled={!employee || (hourly ? hours <= 0 : days <= 0)}><Send />{isHr && approveNow ? t('leave.saveApproved') : t('leave.submit')}</Button>
        </div>
      </form>
    </div>
  );
}

