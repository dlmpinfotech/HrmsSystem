import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileUp, KeyRound, Save, Upload, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { FilterBar } from '@/components/shared/FilterBar';
import { CheckField, RadioGroupField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton, QueryState } from '@/components/shared/states';
import { PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { useEmployee, useEmployees, useInvalidateHr, hhmm, type Employee } from '@/features/hr/api';
import { api, ApiError, errorKey } from '@/lib/api';
import { downloadCsv, parseCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';
import { sb } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { formatPhone, toE164Digits } from '@shared/phone';
import { employeeSchema, type EmployeeInput } from '@shared/schemas';

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'] as const;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

// ── List ──────────────────────────────────────────────────────────────
export function EmployeesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { activeCompany } = useAuth();
  const query = useEmployees(activeCompany?.id);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active');
  const [dept, setDept] = useState('');
  const departments = useMemo(() => [...new Set((query.data ?? []).map((e) => e.department).filter(Boolean))].sort() as string[], [query.data]);
  const rows = useMemo(
    () =>
      (query.data ?? []).filter(
        (e) =>
          (!status || e.status === status) &&
          (!dept || e.department === dept) &&
          (!search || `${e.employee_code} ${e.full_name} ${e.email ?? ''} ${e.phone ?? ''} ${e.designation ?? ''}`.toLowerCase().includes(search.toLowerCase())),
      ),
    [query.data, search, status, dept],
  );

  const columns: Column<Employee>[] = [
    { key: 'name', header: t('hr.employee'), primary: true, cell: (e) => <div className="min-w-0"><p className="truncate font-semibold">{e.full_name}</p><p className="text-xs text-muted-foreground">{e.employee_code}{e.designation ? ` · ${e.designation}` : ''}</p></div> },
    { key: 'dept', header: t('hr.department'), cell: (e) => e.department ?? '—' },
    { key: 'phone', header: t('form.phone'), cell: (e) => (e.phone ? formatPhone(e.phone) : '—'), hideOnMobile: true },
    { key: 'joined', header: t('hr.joined'), cell: (e) => formatDate(e.date_of_joining, i18n.language), hideOnMobile: true },
    { key: 'shift', header: t('hr.shift'), cell: (e) => <span className="tabular">{hhmm(e.shift_start)}–{hhmm(e.shift_end)}</span> },
    { key: 'login', header: t('hr.login'), cell: (e) => (e.user_id ? <Badge tone="success"><KeyRound className="size-3" aria-hidden />{t('hr.loginActive')}</Badge> : <Badge tone="outline">{t('hr.noLogin')}</Badge>) },
    { key: 'status', header: t('crm.status'), cell: (e) => <StatusBadge value={e.status} group="employeeStatus" /> },
  ];

  const exportCsv = () =>
    downloadCsv('employees', rows, [
      { header: 'employee_code', value: (e) => e.employee_code },
      { header: 'full_name', value: (e) => e.full_name },
      { header: 'email', value: (e) => e.email },
      { header: 'phone', value: (e) => e.phone },
      { header: 'department', value: (e) => e.department },
      { header: 'designation', value: (e) => e.designation },
      { header: 'employment_type', value: (e) => e.employment_type },
      { header: 'date_of_joining', value: (e) => e.date_of_joining },
      { header: 'shift_start', value: (e) => hhmm(e.shift_start) },
      { header: 'shift_end', value: (e) => hhmm(e.shift_end) },
      { header: 'status', value: (e) => e.status },
    ]);

  return (
    <>
      <PageHeader
        title={t('hr.employees')}
        description={t('hr.employeesSubtitle')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download />{t('common.exportCsv')}</Button>
            <Button variant="outline" size="sm" asChild><Link to="/portal/employees/import"><Upload />{t('hr.import')}</Link></Button>
            <Button size="sm" asChild><Link to="/portal/employees/new"><UserPlus />{t('hr.addEmployee')}</Link></Button>
          </>
        }
      />
      <FilterBar
        className="mb-4"
        search={<Input type="search" aria-label={t('common.search')} placeholder={t('hr.searchEmployees')} value={search} onChange={(e) => setSearch(e.target.value)} />}
        activeCount={(dept ? 1 : 0) + (status !== 'active' ? 1 : 0)}
        onReset={() => { setDept(''); setStatus('active'); }}
        filters={[
          {
            label: t('hr.department'),
            className: 'md:w-48',
            control: (
              <Select aria-label={t('hr.department')} value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">{t('hr.allDepartments')}</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            ),
          },
          {
            label: t('crm.status'),
            control: (
              <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t('crm.allStatuses')}</option>
                {(['active', 'inactive', 'exited'] as const).map((s) => <option key={s} value={s}>{t(`employeeStatus.${s}`)}</option>)}
              </Select>
            ),
          },
        ]}
      />
      <QueryState
        query={query}
        isEmpty={() => rows.length === 0}
        empty={<EmptyState icon={Users} title={query.data?.length ? t('hr.noMatch') : t('hr.noEmployees')} description={query.data?.length ? undefined : t('hr.noEmployeesBody')} action={query.data?.length ? undefined : <Button asChild><Link to="/portal/employees/new"><UserPlus />{t('hr.addEmployee')}</Link></Button>} />}
      >
        {() => (
          <>
            <p className="mb-2 text-xs text-muted-foreground">{t('hr.count', { count: rows.length })}</p>
            <DataTable caption={t('hr.employees')} columns={columns} rows={rows} rowKey={(e) => e.id} onRowClick={(e) => navigate(`/portal/employees/${e.id}`)} />
          </>
        )}
      </QueryState>
    </>
  );
}

// ── Add / edit ────────────────────────────────────────────────────────
function defaults(e: Employee | undefined): EmployeeInput {
  return {
    employee_code: e?.employee_code ?? '',
    full_name: e?.full_name ?? '',
    email: e?.email ?? '',
    phone: e?.phone ?? '',
    department: e?.department ?? '',
    designation: e?.designation ?? '',
    employment_type: e?.employment_type ?? 'full_time',
    date_of_joining: e?.date_of_joining ?? '',
    date_of_birth: e?.date_of_birth ?? '',
    gender: e?.gender ?? '',
    address: e?.address ?? '',
    emergency_contact_name: e?.emergency_contact_name ?? '',
    emergency_contact_phone: e?.emergency_contact_phone ?? '',
    shift_start: hhmm(e?.shift_start) || '09:30',
    shift_end: hhmm(e?.shift_end) || '18:30',
    grace_minutes: e?.grace_minutes ?? 10,
    weekly_offs: (e?.weekly_offs ?? [0]).map(String) as unknown as number[],
    status: e?.status ?? 'active',
    login_access: false,
    login_role: 'employee',
    reporting_manager_id: e?.reporting_manager_id ?? '',
    probation_end_date: e?.probation_end_date ?? '',
    contract_end_date: e?.contract_end_date ?? '',
    work_location: e?.work_location ?? '',
  } as EmployeeInput;
}

function EmployeeForm({ employee }: { employee?: Employee }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeCompany, user, isCompanyAdmin } = useAuth();
  const invalidate = useInvalidateHr();
  const allEmployees = useEmployees(activeCompany?.id).data;
  const departments = allEmployees?.map((e) => e.department).filter(Boolean) as string[] | undefined;
  const managers = (allEmployees ?? []).filter((e) => e.status === 'active' && e.id !== employee?.id);
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm<EmployeeInput>({ resolver: zodResolver(employeeSchema) as never, defaultValues: defaults(employee) });
  const loginAccess = watch('login_access');
  const hasLogin = Boolean(employee?.user_id);

  const onSubmit = async (raw: EmployeeInput) => {
    const v = employeeSchema.parse(raw);
    const row = {
      company_id: activeCompany!.id,
      employee_code: v.employee_code,
      full_name: v.full_name,
      email: v.email ?? null,
      phone: v.phone ? toE164Digits(v.phone) ?? v.phone : null,
      department: v.department ?? null,
      designation: v.designation ?? null,
      employment_type: v.employment_type,
      date_of_joining: v.date_of_joining,
      date_of_birth: v.date_of_birth,
      gender: v.gender,
      address: v.address ?? null,
      emergency_contact_name: v.emergency_contact_name ?? null,
      emergency_contact_phone: v.emergency_contact_phone ? toE164Digits(v.emergency_contact_phone) ?? v.emergency_contact_phone : null,
      shift_start: v.shift_start,
      shift_end: v.shift_end,
      grace_minutes: v.grace_minutes,
      weekly_offs: [...new Set(v.weekly_offs.map(Number))],
      status: v.status,
      reporting_manager_id: v.reporting_manager_id,
      probation_end_date: v.probation_end_date,
      contract_end_date: v.contract_end_date,
      work_location: v.work_location ?? null,
    };
    const res = employee
      ? await sb().from('employees').update(row).eq('id', employee.id).select('id').single()
      : await sb().from('employees').insert({ ...row, created_by: user!.id }).select('id').single();
    if (res.error) {
      const msg = res.error.message;
      if (res.error.code === '23505' && msg.includes('employee_code')) setError('employee_code', { message: 'validation.codeTaken' });
      else if (res.error.code === '23505' && msg.includes('email')) setError('email', { message: 'validation.emailTaken' });
      else toast.error(t(errorKey(new Error(msg)), { defaultValue: t('errors.generic') }));
      return;
    }

    if (v.login_access && v.email && !hasLogin) {
      try {
        const r = await api<{ invited?: boolean; emailed?: boolean }>('/team', { method: 'POST', body: { action: 'invite', email: v.email, full_name: v.full_name, role_key: v.login_role, company_id: activeCompany!.id } });
        toast.success(r.invited ? t('hr.savedInvited', { email: v.email }) : r.emailed ? t('hr.savedLinkedEmailed', { email: v.email }) : t('hr.savedLinked'));
      } catch (err) {
        const reason = err instanceof ApiError ? t(`errors.${err.code}`, { defaultValue: err.message }) : t('errors.generic');
        toast.error(t('hr.savedInviteFailed', { reason }), { duration: 8000 });
      }
    } else {
      toast.success(employee ? t('common.saved') : t('hr.added'));
    }
    await invalidate();
    navigate(employee ? `/portal/employees/${employee.id}` : '/portal/employees');
  };

  const section = 'grid gap-4 sm:grid-cols-2';
  return (
    <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="space-y-5">
      <Card>
        <CardHeader><CardTitle>{t('hr.personal')}</CardTitle></CardHeader>
        <CardContent className={section}>
          <TextField label={t('hr.fullName')} required error={errors.full_name?.message} {...register('full_name')} />
          <TextField label={t('hr.code')} hint={employee ? undefined : t('hr.codeHint')} error={errors.employee_code?.message} {...register('employee_code')} />
          <TextField label={t('form.email')} type="email" inputMode="email" required={loginAccess} error={errors.email?.message} {...register('email')} />
          <TextField label={t('form.phone')} type="tel" inputMode="tel" placeholder="98765 43210" error={errors.phone?.message} {...register('phone')} />
          <TextField label={t('hr.dob')} type="date" error={errors.date_of_birth?.message} {...register('date_of_birth')} />
          <SelectField label={t('hr.gender')} {...register('gender')}>
            <option value="">{t('form.select')}</option>
            {(['male', 'female', 'other'] as const).map((g) => <option key={g} value={g}>{t(`hr.genders.${g}`)}</option>)}
          </SelectField>
          <TextareaField label={t('company.address')} rows={2} className="sm:col-span-2" error={errors.address?.message} {...register('address')} />
          <TextField label={t('hr.emergencyName')} error={errors.emergency_contact_name?.message} {...register('emergency_contact_name')} />
          <TextField label={t('hr.emergencyPhone')} type="tel" error={errors.emergency_contact_phone?.message} {...register('emergency_contact_phone')} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('hr.job')}</CardTitle></CardHeader>
        <CardContent className={section}>
          <TextField label={t('hr.department')} list="hr-departments" error={errors.department?.message} {...register('department')} />
          <datalist id="hr-departments">{[...new Set(departments ?? [])].map((d) => <option key={d} value={d} />)}</datalist>
          <TextField label={t('contacts.designation')} placeholder={t('people.designationPlaceholder')} error={errors.designation?.message} {...register('designation')} />
          <TextField label={t('hr.joiningDate')} type="date" error={errors.date_of_joining?.message} {...register('date_of_joining')} />
          <SelectField label={t('hr.reportingManager')} error={errors.reporting_manager_id?.message} {...register('reporting_manager_id')}>
            <option value="">{t('hr.noManager')}</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.employee_code})</option>)}
          </SelectField>
          <TextField label={t('hr.workLocation')} placeholder={t('hr.workLocationPlaceholder')} error={errors.work_location?.message} {...register('work_location')} />
          <TextField label={t('hr.probationEnd')} type="date" error={errors.probation_end_date?.message} {...register('probation_end_date')} />
          <TextField label={t('hr.contractEnd')} type="date" hint={t('hr.contractEndHint')} error={errors.contract_end_date?.message} {...register('contract_end_date')} />
          <RadioGroupField label={t('hr.employmentType')} inputProps={register('employment_type')} options={EMPLOYMENT_TYPES.map((v) => ({ value: v, label: t(`hr.types.${v}`) }))} />
          {employee && (
            <RadioGroupField label={t('crm.status')} inputProps={register('status')} options={(['active', 'inactive', 'exited'] as const).map((v) => ({ value: v, label: t(`employeeStatus.${v}`), hint: t(`hr.statusHint.${v}`) }))} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('hr.shiftRules')}</CardTitle><p className="text-sm text-muted-foreground">{t('hr.shiftRulesHint')} <Link to="/portal/shifts?tab=assignments" className="font-medium text-primary hover:underline">{t('hr.shiftRotationLink')}</Link></p></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label={t('hr.shiftStart')} type="time" error={errors.shift_start?.message} {...register('shift_start')} />
            <TextField label={t('hr.shiftEnd')} type="time" error={errors.shift_end?.message} {...register('shift_end')} />
            <TextField label={t('hr.grace')} type="number" min={0} max={120} hint={t('hr.graceHint')} error={errors.grace_minutes?.message} {...register('grace_minutes')} />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('hr.weeklyOffs')}</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <label key={d} className="cursor-pointer">
                  <input type="checkbox" value={d} className="peer sr-only" {...register('weekly_offs')} />
                  <span className="inline-flex min-h-10 items-center rounded-lg border px-3 text-sm peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{t(`weekday.${d}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('hr.loginAccess')}</CardTitle><p className="text-sm text-muted-foreground">{hasLogin ? t('hr.loginLinked') : t('hr.loginHint')}</p></CardHeader>
        {!hasLogin && (
          <CardContent className="space-y-3">
            <CheckField label={t('hr.allowLogin')} {...register('login_access')} />
            {loginAccess && (
              <RadioGroupField label={t('team.role')} inputProps={register('login_role')} options={(isCompanyAdmin ? (['employee', 'hr_manager'] as const) : (['employee'] as const)).map((r) => ({ value: r, label: t(`role.${r}`), hint: t(`roleHint.${r}`) }))} />
            )}
          </CardContent>
        )}
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" asChild><Link to={employee ? `/portal/employees/${employee.id}` : '/portal/employees'}>{t('common.cancel')}</Link></Button>
        <Button type="submit" loading={isSubmitting}><Save />{loginAccess && !hasLogin ? t('people.saveAndInvite') : t('common.save')}</Button>
      </div>
    </form>
  );
}

export function EmployeeFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const query = useEmployee(id);
  const editing = Boolean(id);
  return (
    <div className="mx-auto max-w-4xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={editing ? `/portal/employees/${id}` : '/portal/employees'}><ArrowLeft />{editing ? t('e360.backToProfile') : t('hr.backToEmployees')}</Link></Button>
      <PageHeader title={editing ? query.data?.full_name ?? t('hr.editEmployee') : t('hr.addEmployee')} description={editing ? query.data?.employee_code : t('hr.addEmployeeSubtitle')} />
      {editing && query.isPending && <ListSkeleton rows={6} />}
      {editing && query.isError && <ErrorState error={query.error} />}
      {(!editing || query.data) && <EmployeeForm key={query.data?.id ?? 'new'} employee={query.data} />}
    </div>
  );
}

// ── CSV import ────────────────────────────────────────────────────────
const IMPORT_COLUMNS = ['employee_code', 'full_name', 'email', 'phone', 'department', 'designation', 'employment_type', 'date_of_joining', 'shift_start', 'shift_end'] as const;

interface ImportRow {
  line: number;
  values: Record<string, string>;
  error: string | null;
}

export function ImportEmployeesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeCompany, user } = useAuth();
  const invalidate = useInvalidateHr();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: number; failed: { line: number; reason: string }[] } | null>(null);
  const valid = rows.filter((r) => !r.error);

  const template = () =>
    downloadCsv('employee-import-template', [{ employee_code: 'EMP0001', full_name: 'Priya R', email: 'priya@example.com', phone: '9876543210', department: 'Accounts', designation: 'Accountant', employment_type: 'full_time', date_of_joining: '2026-04-01', shift_start: '09:30', shift_end: '18:30' }], IMPORT_COLUMNS.map((c) => ({ header: c, value: (r: Record<string, string>) => r[c] })));

  const onFile = async (file: File) => {
    setResult(null);
    setFileName(file.name);
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('upload.tooLarge'));
      return;
    }
    const table = parseCsv(await file.text());
    if (table.length < 2) {
      setRows([]);
      toast.error(t('hr.importEmpty'));
      return;
    }
    const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    if (!header.includes('full_name')) {
      toast.error(t('hr.importNoName'));
      return;
    }
    setRows(
      table.slice(1, 1001).map((cells, i) => {
        const values: Record<string, string> = {};
        header.forEach((h, idx) => {
          if ((IMPORT_COLUMNS as readonly string[]).includes(h)) values[h] = (cells[idx] ?? '').trim();
        });
        const parsed = employeeSchema.safeParse({
          ...values,
          employment_type: values.employment_type || 'full_time',
          shift_start: values.shift_start || '09:30',
          shift_end: values.shift_end || '18:30',
          grace_minutes: 10,
          weekly_offs: [0],
          status: 'active',
        });
        const issue = parsed.success ? null : parsed.error.issues[0];
        return { line: i + 2, values, error: issue ? `${issue.path.join('.')}: ${t(issue.message, { defaultValue: issue.message })}` : null };
      }),
    );
  };

  const runImport = async () => {
    setBusy(true);
    const failed: { line: number; reason: string }[] = [];
    let ok = 0;
    for (const r of valid) {
      const v = employeeSchema.parse({ ...r.values, employment_type: r.values.employment_type || 'full_time', shift_start: r.values.shift_start || '09:30', shift_end: r.values.shift_end || '18:30', grace_minutes: 10, weekly_offs: [0], status: 'active' });
      const { error } = await sb().from('employees').insert({
        company_id: activeCompany!.id,
        employee_code: v.employee_code,
        full_name: v.full_name,
        email: v.email ?? null,
        phone: v.phone ? toE164Digits(v.phone) ?? v.phone : null,
        department: v.department ?? null,
        designation: v.designation ?? null,
        employment_type: v.employment_type,
        date_of_joining: v.date_of_joining,
        shift_start: v.shift_start,
        shift_end: v.shift_end,
        created_by: user!.id,
      });
      if (error) {
        failed.push({ line: r.line, reason: error.code === '23505' ? t('hr.importDuplicate') : t(errorKey(new Error(error.message)), { defaultValue: error.message }) });
        if (error.message.includes('employee_limit_reached')) break;
      } else ok++;
    }
    setBusy(false);
    setResult({ ok, failed });
    await invalidate();
    if (ok) toast.success(t('hr.imported', { count: ok }));
  };

  return (
    <div className="mx-auto max-w-5xl">
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to="/portal/employees"><ArrowLeft />{t('hr.backToEmployees')}</Link></Button>
      <PageHeader title={t('hr.importTitle')} description={t('hr.importSubtitle')} actions={<Button variant="outline" size="sm" onClick={template}><Download />{t('hr.downloadTemplate')}</Button>} />
      <Card className="mb-5">
        <CardContent className="space-y-3 pt-5">
          <label className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors hover:border-primary/60')}>
            <FileUp className="size-8 text-primary" aria-hidden />
            <span className="font-medium">{fileName || t('hr.chooseCsv')}</span>
            <span className="text-xs text-muted-foreground">{t('hr.csvColumns', { columns: IMPORT_COLUMNS.join(', ') })}</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
          </label>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>{t('hr.preview', { valid: valid.length, total: rows.length })}</CardTitle>
            <Button onClick={() => void runImport()} loading={busy} disabled={!valid.length || Boolean(result)}><Upload />{t('hr.importN', { count: valid.length })}</Button>
          </CardHeader>
          <CardContent>
            {result && (
              <div className="mb-4 rounded-lg bg-muted p-3 text-sm">
                <p className="font-medium">{t('hr.importDone', { ok: result.ok, failed: result.failed.length })}</p>
                <ul className="mt-1 list-disc pl-5 text-destructive">{result.failed.map((f) => <li key={f.line}>{t('hr.line', { line: f.line })}: {f.reason}</li>)}</ul>
                <Button size="sm" className="mt-3" onClick={() => navigate('/portal/employees')}>{t('hr.backToEmployees')}</Button>
              </div>
            )}
            <div className="scroll-thin max-h-[420px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">{t('hr.code')}</th><th className="px-3 py-2">{t('hr.fullName')}</th><th className="px-3 py-2">{t('form.email')}</th><th className="px-3 py-2">{t('hr.department')}</th><th className="px-3 py-2">{t('crm.status')}</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line} className="border-t">
                      <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                      <td className="px-3 py-2">{r.values.employee_code || t('hr.auto')}</td>
                      <td className="px-3 py-2 font-medium">{r.values.full_name}</td>
                      <td className="px-3 py-2">{r.values.email}</td>
                      <td className="px-3 py-2">{r.values.department}</td>
                      <td className="px-3 py-2">{r.error ? <span className="text-xs text-destructive">{r.error}</span> : <Badge tone="success">{t('hr.ready')}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
