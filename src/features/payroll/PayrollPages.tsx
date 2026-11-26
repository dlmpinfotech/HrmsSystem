import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Banknote, CheckCircle2, Download, FileText, Lock, Mail, Pencil, Plus, Printer, RefreshCw, Trash2, Unlock, Users, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { CheckField, RadioGroupField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, FormDialog, PageHeader, StatCard } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { useEmployees, useMyEmployee, type Employee } from '@/features/hr/api';
import { api, errorKey } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatCurrency, formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { computeSlip, daysInMonth, rupeesInWords } from '@shared/payroll';
import { payrollSettingsSchema, salaryStructureSchema, type PayrollSettingsInput, type SalaryStructureInput } from '@shared/schemas';
import { istDateString } from '@shared/slots';
import { structureOn, useMyPayslips, usePayrollRuns, usePayrollSettings, usePayslip, usePayslips, useSalaryStructures, type Payslip, type SalaryStructure } from './api';

const money = (v: number, lang: string) => formatCurrency(v, lang);
const monthName = (period: string, lang: string) =>
  new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period.slice(0, 7)}-01T00:00:00Z`));

function useOnError() {
  const { t } = useTranslation();
  return (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }), { duration: 8000 });
}

function useInvalidatePayroll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['payroll'] });
}

// ── Monthly run ───────────────────────────────────────────────────────
function RunPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany, isCompanyAdmin } = useAuth();
  const companyId = activeCompany?.id;
  const onError = useOnError();
  const invalidate = useInvalidatePayroll();
  const [month, setMonth] = useState(istDateString(new Date()).slice(0, 7));
  const period = `${month}-01`;
  const runs = usePayrollRuns(companyId);
  const run = runs.data?.find((r) => r.period.slice(0, 7) === month);
  const slips = usePayslips(run?.id);
  const employees = useEmployees(companyId);
  const structures = useSalaryStructures(companyId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | 'finalize' | 'reopen' | 'email'>(null);
  const finalized = run?.status === 'finalized';
  const monthEnd = `${month}-${String(daysInMonth(period)).padStart(2, '0')}`;
  const missing = (employees.data ?? []).filter((e) => e.status === 'active' && (!e.date_of_joining || e.date_of_joining <= monthEnd) && !structureOn(structures.data ?? [], e.id, monthEnd));

  const generate = useMutation({
    mutationFn: async () => unwrap(await sb().rpc('generate_payroll', { p_company: companyId!, p_period: period })),
    onSuccess: async () => {
      toast.success(t('payroll.generated'));
      setSelected(new Set());
      await invalidate();
    },
    onError,
  });
  const setStatus = useMutation({
    mutationFn: async (status: 'finalized' | 'draft') => unwrap(await sb().rpc('set_payroll_status', { p_run: run!.id, p_status: status })),
    onSuccess: async (_d, status) => {
      toast.success(status === 'finalized' ? t('payroll.finalizedToast') : t('payroll.reopenedToast'));
      setConfirm(null);
      await invalidate();
    },
    onError,
  });
  const email = useMutation({
    mutationFn: async (ids: string[] | undefined) => api<{ sent: number; failed: { employee_id: string; reason: string }[] }>('/payroll', { method: 'POST', body: { action: 'email_payslips', run_id: run!.id, employee_ids: ids } }),
    onSuccess: async (r) => {
      setConfirm(null);
      if (r.failed.length) toast.warning(t('payroll.emailedSome', { sent: r.sent, failed: r.failed.length }), { duration: 8000 });
      else toast.success(t('payroll.emailed', { count: r.sent }));
      setSelected(new Set());
      await invalidate();
    },
    onError,
  });

  const rows = slips.data ?? [];
  const failed = [runs, structures].find((q) => q.isError);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.employee_id));
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const exportCsv = () =>
    downloadCsv(`payroll-${month}`, rows, [
      { header: 'Employee code', value: (r) => r.employee_code }, { header: 'Name', value: (r) => r.employee_name }, { header: 'Department', value: (r) => r.department },
      { header: 'Days', value: (r) => r.days_in_month }, { header: 'Paid days', value: (r) => r.paid_days }, { header: 'LOP days', value: (r) => r.lop_days },
      { header: 'Basic', value: (r) => r.basic }, { header: 'HRA', value: (r) => r.hra }, { header: 'Conveyance', value: (r) => r.conveyance }, { header: 'Special', value: (r) => r.special_allowance }, { header: 'Other allowance', value: (r) => r.other_allowance },
      { header: 'Leave encashment', value: (r) => r.leave_encashment ?? 0 }, { header: 'Gross', value: (r) => r.gross }, { header: 'PF', value: (r) => r.pf_employee }, { header: 'ESI', value: (r) => r.esi_employee }, { header: 'PT', value: (r) => r.professional_tax }, { header: 'TDS', value: (r) => r.tds },
      { header: 'Other deduction', value: (r) => r.other_deduction }, { header: 'Total deductions', value: (r) => r.total_deductions }, { header: 'Net pay', value: (r) => r.net_pay },
      { header: 'Employer PF', value: (r) => r.pf_employer }, { header: 'Employer ESI', value: (r) => r.esi_employer },
    ]);
  const emailIds = selected.size ? [...selected] : undefined;

  if (failed) return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:flex-wrap sm:items-end">
          <TextField label={t('payroll.month')} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="sm:w-48" />
          <div className="flex items-center gap-2 sm:pb-2.5">
            {run ? (finalized ? <Badge tone="success"><Lock className="size-3" aria-hidden />{t('payroll.status.finalized')}</Badge> : <Badge tone="warning">{t('payroll.status.draft')}</Badge>) : <Badge tone="outline">{t('payroll.notRun')}</Badge>}
            {run?.generated_at && <span className="text-xs text-muted-foreground">{t('payroll.generatedAt', { date: formatDate(run.generated_at, lang) })}</span>}
          </div>
          <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row sm:flex-wrap">
            {!finalized && <Button onClick={() => generate.mutate()} loading={generate.isPending}>{run ? <RefreshCw /> : <Banknote />}{run ? t('payroll.regenerate') : t('payroll.generate')}</Button>}
            {run && !finalized && run.employee_count > 0 && <Button variant="outline" onClick={() => setConfirm('finalize')}><Lock />{t('payroll.finalize')}</Button>}
            {finalized && <Button onClick={() => setConfirm('email')} disabled={!rows.length}><Mail />{selected.size ? t('payroll.emailSelected', { count: selected.size }) : t('payroll.emailAll')}</Button>}
            {finalized && isCompanyAdmin && <Button variant="ghost" onClick={() => setConfirm('reopen')}><Unlock />{t('payroll.reopen')}</Button>}
            {rows.length > 0 && <Button variant="outline" onClick={exportCsv}><Download />{t('common.exportCsv')}</Button>}
          </div>
        </CardContent>
      </Card>

      {missing.length > 0 && !finalized && (
        <div role="status" className="flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t('payroll.missingTitle', { count: missing.length })}</p>
            <p className="text-muted-foreground">{missing.slice(0, 6).map((e) => e.full_name).join(', ')}{missing.length > 6 ? '…' : ''}</p>
          </div>
          <Button size="sm" variant="outline" asChild><Link to="/portal/payroll?tab=structures">{t('payroll.setSalaries')}</Link></Button>
        </div>
      )}

      {run && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard index={0} icon={Users} label={t('payroll.employees')} value={run.employee_count} />
          <StatCard index={1} icon={Wallet} tone="info" label={t('payroll.gross')} value={run.total_gross} format={(n) => money(n, lang)} />
          <StatCard index={2} icon={Banknote} tone="success" label={t('payroll.netPay')} value={run.total_net} format={(n) => money(n, lang)} />
          <StatCard index={3} icon={FileText} tone="warning" label={t('payroll.employerCost')} value={run.total_employer_cost} format={(n) => money(n, lang)} hint={t('payroll.employerCostHint')} />
        </div>
      )}

      {!run ? (
        <EmptyState icon={Banknote} title={t('payroll.noRunTitle', { month: monthName(period, lang) })} description={t('payroll.noRunBody')} />
      ) : slips.isPending ? (
        <ListSkeleton rows={5} />
      ) : !rows.length ? (
        <EmptyState icon={Users} title={t('payroll.noSlips')} description={t('payroll.noSlipsBody')} />
      ) : (
        <Card className="overflow-hidden">
          {/* Phones: cards */}
          <ul className="divide-y md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start gap-3 p-4">
                {finalized && <input type="checkbox" className="mt-1 size-5 accent-[hsl(var(--primary))]" aria-label={t('payroll.select', { name: r.employee_name })} checked={selected.has(r.employee_id)} onChange={() => toggle(r.employee_id)} />}
                <Link to={`/portal/payroll/payslips/${r.id}`} className="min-w-0 flex-1">
                  <p className="font-semibold">{r.employee_name} <span className="text-xs font-normal text-muted-foreground">{r.employee_code}</span></p>
                  <p className="text-xs text-muted-foreground">{t('payroll.daysLine', { paid: r.paid_days, total: r.days_in_month, lop: r.lop_days })}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-sm"><span>{t('payroll.gross')}: {money(r.gross, lang)}</span><span className="font-semibold">{t('payroll.net')}: {money(r.net_pay, lang)}</span></p>
                  <EmailState slip={r} />
                </Link>
              </li>
            ))}
          </ul>
          {/* Tablets and up: table */}
          <div className="scroll-thin hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {finalized && <th className="w-10 px-3 py-2.5"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" aria-label={t('payroll.selectAll')} checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.employee_id)))} /></th>}
                  <th className="px-3 py-2.5">{t('hr.employee')}</th>
                  <th className="px-3 py-2.5 text-right">{t('payroll.paidDays')}</th>
                  <th className="px-3 py-2.5 text-right">{t('payroll.lop')}</th>
                  <th className="px-3 py-2.5 text-right">{t('payroll.gross')}</th>
                  <th className="px-3 py-2.5 text-right">{t('payroll.pf')}</th>
                  <th className="px-3 py-2.5 text-right">{t('payroll.esi')}</th>
                  <th className="px-3 py-2.5 text-right">{t('payroll.pt')}</th>
                  <th className="px-3 py-2.5 text-right">{t('payroll.tds')}</th>
                  <th className="px-3 py-2.5 text-right">{t('payroll.net')}</th>
                  <th className="px-3 py-2.5">{t('payroll.email')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    {finalized && <td className="px-3 py-2.5"><input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" aria-label={t('payroll.select', { name: r.employee_name })} checked={selected.has(r.employee_id)} onChange={() => toggle(r.employee_id)} /></td>}
                    <td className="px-3 py-2.5"><Link to={`/portal/payroll/payslips/${r.id}`} className="font-semibold text-primary hover:underline">{r.employee_name}</Link><p className="text-xs text-muted-foreground">{r.employee_code}{r.department ? ` · ${r.department}` : ''}</p></td>
                    <td className="px-3 py-2.5 text-right tabular">{r.paid_days}/{r.days_in_month}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular', r.lop_days > 0 && 'font-semibold text-destructive')}>{r.lop_days}</td>
                    <td className="px-3 py-2.5 text-right tabular">{money(r.gross, lang)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{money(r.pf_employee, lang)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{money(r.esi_employee, lang)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{money(r.professional_tax, lang)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{money(r.tds, lang)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular">{money(r.net_pay, lang)}</td>
                    <td className="px-3 py-2.5"><EmailState slip={r} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/40 font-semibold">
                <tr>
                  {finalized && <td />}
                  <td className="px-3 py-2.5">{t('payroll.total')}</td>
                  <td colSpan={2} />
                  <td className="px-3 py-2.5 text-right tabular">{money(run.total_gross, lang)}</td>
                  <td colSpan={4} className="px-3 py-2.5 text-right tabular">−{money(run.total_deductions, lang)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{money(run.total_net, lang)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <ConfirmDialog open={confirm === 'finalize'} onOpenChange={(o) => !o && setConfirm(null)} title={t('payroll.finalize')} description={t('payroll.finalizeConfirm', { month: monthName(period, lang) })} confirmLabel={t('payroll.finalize')} loading={setStatus.isPending} onConfirm={() => setStatus.mutate('finalized')} />
      <ConfirmDialog open={confirm === 'reopen'} onOpenChange={(o) => !o && setConfirm(null)} title={t('payroll.reopen')} description={t('payroll.reopenConfirm')} confirmLabel={t('payroll.reopen')} destructive loading={setStatus.isPending} onConfirm={() => setStatus.mutate('draft')} />
      <ConfirmDialog open={confirm === 'email'} onOpenChange={(o) => !o && setConfirm(null)} title={t('payroll.emailTitle')} description={emailIds ? t('payroll.emailConfirmSome', { count: emailIds.length }) : t('payroll.emailConfirmAll', { count: rows.length })} confirmLabel={t('payroll.send')} loading={email.isPending} onConfirm={() => email.mutate(emailIds)} />
    </div>
  );
}

function EmailState({ slip }: { slip: Payslip }) {
  const { t, i18n } = useTranslation();
  if (slip.emailed_at) return <Badge tone="success"><CheckCircle2 className="size-3" aria-hidden />{t('payroll.sentOn', { date: formatDate(slip.emailed_at, i18n.language) })}</Badge>;
  if (slip.email_error) return <Badge tone="danger">{slip.email_error === 'no_email' ? t('payroll.noEmail') : t('payroll.sendFailed')}</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

// ── Salary structures ─────────────────────────────────────────────────
function StructureDialog({ employee, current, onClose }: { employee: Employee | null; current?: SalaryStructure; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const onError = useOnError();
  const invalidate = useInvalidatePayroll();
  const settings = usePayrollSettings(activeCompany?.id);
  const today = istDateString(new Date());
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<SalaryStructureInput>({
    resolver: zodResolver(salaryStructureSchema) as never,
    values: employee
      ? ({
          employee_id: employee.id,
          effective_from: current ? today.slice(0, 8) + '01' : employee.date_of_joining ?? today.slice(0, 8) + '01',
          basic: current?.basic ?? '', hra: current?.hra ?? '', conveyance: current?.conveyance ?? '', special_allowance: current?.special_allowance ?? '', other_allowance: current?.other_allowance ?? '',
          other_deduction: current?.other_deduction ?? '', tds_monthly: current?.tds_monthly ?? '',
          pf_applicable: current?.pf_applicable ?? true, esi_applicable: current?.esi_applicable ?? true, pt_applicable: current?.pt_applicable ?? true, note: '',
        } as unknown as SalaryStructureInput)
      : undefined,
  });
  const v = watch();
  const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const preview = settings.data
    ? computeSlip(
        { basic: num(v.basic), hra: num(v.hra), conveyance: num(v.conveyance), special_allowance: num(v.special_allowance), other_allowance: num(v.other_allowance), other_deduction: num(v.other_deduction), tds_monthly: num(v.tds_monthly), pf_applicable: Boolean(v.pf_applicable), esi_applicable: Boolean(v.esi_applicable), pt_applicable: Boolean(v.pt_applicable) },
        { ...settings.data.settings, pt_frequency: 'monthly' },
        30, 30, 1,
      )
    : null;

  const onSubmit = async (raw: SalaryStructureInput) => {
    const x = salaryStructureSchema.parse(raw);
    try {
      unwrap(await sb().from('salary_structures').upsert({ ...x, note: x.note ?? null }, { onConflict: 'employee_id,effective_from' }).select('id').single());
      toast.success(t('common.saved'));
      await invalidate();
      onClose();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <FormDialog open={Boolean(employee)} onOpenChange={(o) => !o && onClose()} size="lg" title={employee ? t('payroll.salaryFor', { name: employee.full_name }) : ''} description={t('payroll.salaryHint')}>
      {employee && (
        <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
          <TextField label={t('payroll.effectiveFrom')} type="date" required hint={t('payroll.effectiveHint')} error={errors.effective_from?.message} {...register('effective_from')} />
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{t('payroll.earningsMonthly')}</legend>
            <TextField label={t('payroll.basic')} type="number" inputMode="decimal" min={0} required error={errors.basic?.message} {...register('basic')} />
            <TextField label={t('payroll.hra')} type="number" inputMode="decimal" min={0} error={errors.hra?.message} {...register('hra')} />
            <TextField label={t('payroll.conveyance')} type="number" inputMode="decimal" min={0} error={errors.conveyance?.message} {...register('conveyance')} />
            <TextField label={t('payroll.special')} type="number" inputMode="decimal" min={0} error={errors.special_allowance?.message} {...register('special_allowance')} />
            <TextField label={t('payroll.otherAllowance')} type="number" inputMode="decimal" min={0} error={errors.other_allowance?.message} {...register('other_allowance')} />
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{t('payroll.deductionsMonthly')}</legend>
            <TextField label={t('payroll.tdsMonthly')} type="number" inputMode="decimal" min={0} error={errors.tds_monthly?.message} {...register('tds_monthly')} />
            <TextField label={t('payroll.otherDeduction')} type="number" inputMode="decimal" min={0} hint={t('payroll.otherDeductionHint')} error={errors.other_deduction?.message} {...register('other_deduction')} />
            <div className="flex flex-col gap-2 sm:col-span-2">
              <CheckField label={t('payroll.pfApplies')} {...register('pf_applicable')} />
              <CheckField label={t('payroll.esiApplies')} {...register('esi_applicable')} />
              <CheckField label={t('payroll.ptApplies')} {...register('pt_applicable')} />
            </div>
          </fieldset>
          <TextareaField label={t('payroll.note')} rows={2} maxLength={300} error={errors.note?.message} {...register('note')} />
          {preview && preview.gross > 0 && (
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-3 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">{t('payroll.gross')}</p><p className="font-semibold tabular">{money(preview.gross, lang)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('payroll.deductions')}</p><p className="font-semibold tabular">{money(preview.total_deductions, lang)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('payroll.net')}</p><p className="font-semibold tabular text-success">{money(preview.net_pay, lang)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('payroll.ctcMonthly')}</p><p className="font-semibold tabular">{money(preview.employer_cost, lang)}</p></div>
              <p className="col-span-full text-xs text-muted-foreground">{t('payroll.previewHint')}</p>
            </div>
          )}
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

function StructuresPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const employees = useEmployees(activeCompany?.id);
  const structures = useSalaryStructures(activeCompany?.id);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Employee | null>(null);
  const today = istDateString(new Date());
  const rows = (employees.data ?? []).filter((e) => e.status !== 'exited' && (!search || `${e.full_name} ${e.employee_code} ${e.department ?? ''}`.toLowerCase().includes(search.toLowerCase())));
  const latest = (id: string) => structureOn(structures.data ?? [], id, '9999-12-31');
  const gross = (s?: SalaryStructure) => (s ? s.basic + s.hra + s.conveyance + s.special_allowance + s.other_allowance : 0);

  if (employees.isPending || structures.isPending) return <ListSkeleton rows={5} />;
  if (structures.isError) return <ErrorState error={structures.error} onRetry={() => void structures.refetch()} />;
  return (
    <div className="space-y-3">
      <Input type="search" aria-label={t('common.search')} placeholder={t('hr.searchEmployees')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-sm" />
      {!rows.length ? <EmptyState icon={Users} title={t('hr.noEmployees')} /> : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((e) => {
            const s = latest(e.id);
            const future = s && s.effective_from > today;
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-[10rem] flex-1">
                  <p className="font-semibold">{e.full_name} <span className="text-xs font-normal text-muted-foreground">{e.employee_code}</span></p>
                  <p className="text-xs text-muted-foreground">{e.designation ?? e.department ?? '—'}</p>
                </div>
                {s ? (
                  <div className="text-right">
                    <p className="font-semibold tabular">{money(gross(s), lang)} <span className="text-xs font-normal text-muted-foreground">{t('payroll.perMonth')}</span></p>
                    <p className="text-xs text-muted-foreground">{future ? t('payroll.startsOn', { date: formatDate(`${s.effective_from}T06:30:00Z`, lang) }) : t('payroll.since', { date: formatDate(`${s.effective_from}T06:30:00Z`, lang) })}</p>
                  </div>
                ) : <Badge tone="warning">{t('payroll.noSalary')}</Badge>}
                <Button size="sm" variant={s ? 'outline' : 'default'} onClick={() => setEditing(e)}>{s ? <Pencil /> : <Plus />}{s ? t('payroll.revise') : t('payroll.setSalary')}</Button>
              </li>
            );
          })}
        </ul>
      )}
      <StructureDialog employee={editing} current={editing ? latest(editing.id) : undefined} onClose={() => setEditing(null)} />
    </div>
  );
}

// ── Statutory settings ────────────────────────────────────────────────
function SettingsPanel() {
  const { t } = useTranslation();
  const { activeCompany } = useAuth();
  const onError = useOnError();
  const invalidate = useInvalidatePayroll();
  const settings = usePayrollSettings(activeCompany?.id);
  const s = settings.data?.settings;
  const { register, handleSubmit, control, formState: { errors, isSubmitting, isDirty } } = useForm<PayrollSettingsInput>({
    resolver: zodResolver(payrollSettingsSchema) as never,
    values: s ? ({ ...s, encash_basis: s.encash_basis ?? 'basic', encash_divisor: String(s.encash_divisor ?? 26), pt_slabs: s.pt_slabs.map((x) => ({ upto: x.upto ?? '', tax: x.tax })) } as unknown as PayrollSettingsInput) : undefined,
  });
  const slabs = useFieldArray({ control, name: 'pt_slabs' });
  const onSubmit = async (raw: PayrollSettingsInput) => {
    const x = payrollSettingsSchema.parse(raw);
    try {
      unwrap(await sb().from('payroll_settings').upsert({ company_id: activeCompany!.id, ...x }, { onConflict: 'company_id' }).select('company_id').single());
      toast.success(t('common.saved'));
      await invalidate();
    } catch (err) {
      onError(err);
    }
  };
  if (settings.isPending) return <ListSkeleton rows={6} />;
  if (settings.isError) return <ErrorState error={settings.error} />;
  return (
    <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="space-y-5">
      {!settings.data?.saved && <p className="rounded-lg bg-muted p-3 text-sm">{t('payroll.defaultsNote')}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('payroll.pfTitle')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <CheckField label={t('payroll.enabled')} {...register('pf_enabled')} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('payroll.employeeRate')} type="number" step={0.01} error={errors.pf_employee_rate?.message} {...register('pf_employee_rate')} />
              <TextField label={t('payroll.employerRate')} type="number" step={0.01} error={errors.pf_employer_rate?.message} {...register('pf_employer_rate')} />
            </div>
            <TextField label={t('payroll.pfCeiling')} type="number" error={errors.pf_wage_ceiling?.message} {...register('pf_wage_ceiling')} />
            <CheckField label={t('payroll.pfCap')} {...register('pf_cap_at_ceiling')} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('payroll.esiTitle')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <CheckField label={t('payroll.enabled')} {...register('esi_enabled')} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label={t('payroll.employeeRate')} type="number" step={0.01} error={errors.esi_employee_rate?.message} {...register('esi_employee_rate')} />
              <TextField label={t('payroll.employerRate')} type="number" step={0.01} error={errors.esi_employer_rate?.message} {...register('esi_employer_rate')} />
            </div>
            <TextField label={t('payroll.esiLimit')} type="number" hint={t('payroll.esiLimitHint')} error={errors.esi_wage_limit?.message} {...register('esi_wage_limit')} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t('payroll.encashTitle')}</CardTitle><p className="text-sm text-muted-foreground">{t('payroll.encashHint')}</p></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <RadioGroupField label={t('payroll.encashBasis')} inputProps={register('encash_basis')} options={(['basic', 'gross'] as const).map((b) => ({ value: b, label: t(`payroll.basis.${b}`) }))} />
            <RadioGroupField label={t('payroll.encashDivisor')} inputProps={register('encash_divisor')} options={(['26', '30'] as const).map((n) => ({ value: n, label: t(`payroll.divisor.${n}`) }))} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t('payroll.ptTitle')}</CardTitle><p className="text-sm text-muted-foreground">{t('payroll.ptHint')}</p></CardHeader>
          <CardContent className="space-y-4">
            <CheckField label={t('payroll.enabled')} {...register('pt_enabled')} />
            <RadioGroupField label={t('payroll.ptFrequency')} inputProps={register('pt_frequency')} options={(['half_yearly', 'monthly'] as const).map((f) => ({ value: f, label: t(`payroll.ptFreq.${f}`), hint: t(`payroll.ptFreqHint.${f}`) }))} />
            <div>
              <p className="mb-2 text-sm font-medium">{t('payroll.slabs')}</p>
              <ul className="space-y-2">
                {slabs.fields.map((f, i) => (
                  <li key={f.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <TextField label={t('payroll.slabUpto')} type="number" placeholder={t('payroll.andAbove')} error={errors.pt_slabs?.[i]?.upto?.message} {...register(`pt_slabs.${i}.upto` as const)} />
                    <TextField label={t('payroll.slabTax')} type="number" error={errors.pt_slabs?.[i]?.tax?.message} {...register(`pt_slabs.${i}.tax` as const)} />
                    <Button type="button" variant="ghost" size="icon" aria-label={t('common.delete')} disabled={slabs.fields.length <= 1} onClick={() => slabs.remove(i)}><Trash2 /></Button>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => slabs.append({ upto: '', tax: 0 } as never)}><Plus />{t('payroll.addSlab')}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="flex justify-end"><Button type="submit" loading={isSubmitting} disabled={settings.data?.saved && !isDirty}>{t('common.save')}</Button></div>
    </form>
  );
}

// ── HR page ───────────────────────────────────────────────────────────
export function PayrollPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'run';
  return (
    <>
      <PageHeader title={t('payroll.title')} description={t('payroll.subtitle')} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="run">{t('payroll.tabs.run')}</TabsTrigger>
          <TabsTrigger value="structures">{t('payroll.tabs.structures')}</TabsTrigger>
          <TabsTrigger value="settings">{t('payroll.tabs.settings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="run"><RunPanel /></TabsContent>
        <TabsContent value="structures"><StructuresPanel /></TabsContent>
        <TabsContent value="settings"><SettingsPanel /></TabsContent>
      </Tabs>
    </>
  );
}

// ── Payslip (HR and employee) ─────────────────────────────────────────
function PayslipDocument({ p }: { p: Payslip }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const earnings: [string, number][] = [[t('payroll.basic'), p.basic], [t('payroll.hra'), p.hra], [t('payroll.conveyance'), p.conveyance], [t('payroll.special'), p.special_allowance], [t('payroll.otherAllowance'), p.other_allowance], [t('payroll.leaveEncashment'), p.leave_encashment ?? 0]];
  const deductions: [string, number][] = [[t('payroll.pfLong'), p.pf_employee], [t('payroll.esi'), p.esi_employee], [t('payroll.ptLong'), p.professional_tax], [t('payroll.tdsLong'), p.tds], [t('payroll.otherDeduction'), p.other_deduction]];
  const list = (rows: [string, number][], totalLabel: string, total: number) => (
    <dl className="text-sm">
      {rows.filter(([, v]) => v !== 0).map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="tabular">{money(v, lang)}</dd></div>)}
      <div className="mt-1 flex justify-between gap-3 border-t pt-2 font-semibold"><dt>{totalLabel}</dt><dd className="tabular">{money(total, lang)}</dd></div>
    </dl>
  );
  return (
    <Card className="print-area overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-primary px-5 py-4 text-primary-foreground sm:px-6">
        <div><p className="font-display text-lg font-bold">{activeCompany?.name}</p><p className="text-sm opacity-90">{t('payroll.payslipFor', { month: monthName(p.period, lang) })}</p></div>
        <Wallet className="size-7 opacity-80" aria-hidden />
      </div>
      <CardContent className="space-y-5 pt-5 sm:px-6">
        <div className="grid gap-3 rounded-xl bg-muted/60 p-4 text-sm sm:grid-cols-2">
          <div><p className="text-xs text-muted-foreground">{t('hr.employee')}</p><p className="font-semibold">{p.employee_name} · {p.employee_code}</p><p className="text-muted-foreground">{[p.designation, p.department].filter(Boolean).join(' · ') || '—'}</p></div>
          <div className="sm:text-right"><p className="text-xs text-muted-foreground">{t('payroll.attendance')}</p><p className="font-semibold">{t('payroll.daysLine', { paid: p.paid_days, total: p.days_in_month, lop: p.lop_days })}</p></div>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <section><h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('payroll.earnings')}</h3>{list(earnings, t('payroll.grossLong'), p.gross)}</section>
          <section><h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('payroll.deductions')}</h3>{list(deductions, t('payroll.totalDeductions'), p.total_deductions)}</section>
        </div>
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
          <p className="text-sm text-muted-foreground">{t('payroll.netPay')}</p>
          <p className="font-display text-3xl font-extrabold tabular">{money(p.net_pay, lang)}</p>
          <p className="text-xs text-muted-foreground">{t('payroll.inWords')}: Rupees {rupeesInWords(p.net_pay)} only</p>
        </div>
        <p className="text-xs text-muted-foreground">{t('payroll.employerContrib', { pf: money(p.pf_employer, lang), esi: money(p.esi_employer, lang) })}</p>
        <p className="text-center text-xs text-muted-foreground">{t('payroll.systemGenerated')}</p>
      </CardContent>
    </Card>
  );
}

export function PayslipPage({ back }: { back: 'hr' | 'mine' }) {
  const { t } = useTranslation();
  const { id } = useParams();
  const slip = usePayslip(id);
  const backTo = back === 'hr' ? '/portal/payroll' : '/portal/payslips';
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" size="sm" asChild className="-ml-2"><Link to={backTo}><ArrowLeft />{t('payroll.back')}</Link></Button>
        {slip.data && <Button variant="outline" size="sm" onClick={() => window.print()}><Printer />{t('payroll.print')}</Button>}
      </div>
      {slip.isPending ? <ListSkeleton rows={8} /> : slip.isError || !slip.data ? <ErrorState error={slip.error} /> : <PayslipDocument p={slip.data} />}
    </div>
  );
}

export function MyPayslipsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const me = useMyEmployee();
  const slips = useMyPayslips(me.data?.id);
  const byYear = useMemo(() => {
    const m = new Map<string, Payslip[]>();
    for (const s of slips.data ?? []) m.set(s.period.slice(0, 4), [...(m.get(s.period.slice(0, 4)) ?? []), s]);
    return [...m.entries()];
  }, [slips.data]);
  return (
    <>
      <PageHeader title={t('payroll.myTitle')} description={t('payroll.mySubtitle')} />
      {me.isPending || (me.data && slips.isPending) ? <ListSkeleton rows={4} /> : !me.data ? <EmptyState icon={Wallet} title={t('att.noRecordTitle')} description={t('att.noRecordBody')} /> : slips.isError ? <ErrorState error={slips.error} onRetry={() => void slips.refetch()} /> : !slips.data?.length ? (
        <EmptyState icon={Wallet} title={t('payroll.myNone')} description={t('payroll.myNoneBody')} />
      ) : (
        <div className="space-y-6">
          {byYear.map(([year, list]) => (
            <section key={year}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{year}</h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((s) => (
                  <li key={s.id}>
                    <Link to={`/portal/payslips/${s.id}`} className="block rounded-xl border bg-card p-4 transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <p className="font-semibold">{monthName(s.period, lang)}</p>
                      <p className="mt-1 font-display text-2xl font-extrabold tabular">{money(s.net_pay, lang)}</p>
                      <p className="text-xs text-muted-foreground">{t('payroll.daysLine', { paid: s.paid_days, total: s.days_in_month, lop: s.lop_days })}</p>
                      <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary"><FileText className="size-4" aria-hidden />{t('payroll.view')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

