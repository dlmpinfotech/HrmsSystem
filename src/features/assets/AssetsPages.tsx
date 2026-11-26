import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Laptop, Pencil, Plus, Undo2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { SelectField, TextField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, FormDialog, PageHeader } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { useEmployees } from '@/features/hr/api';
import { errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { istDateString } from '@shared/slots';

const CATEGORIES = ['laptop', 'phone', 'id_card', 'sim', 'vehicle', 'tool', 'uniform', 'other'] as const;
const STATUSES = ['available', 'assigned', 'repair', 'retired'] as const;
type AssetStatus = (typeof STATUSES)[number];
const TONE: Record<AssetStatus, BadgeTone> = { available: 'success', assigned: 'info', repair: 'warning', retired: 'neutral' };

interface Assignment {
  id: string;
  employee_id: string;
  assigned_on: string;
  returned_on: string | null;
  employees?: { full_name: string; employee_code: string } | null;
  company_assets?: Asset | null;
}
interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  category: (typeof CATEGORIES)[number];
  serial_no: string | null;
  status: AssetStatus;
  asset_assignments?: Assignment[];
}

const day = (date: string, lang: string) => formatDate(`${date}T06:30:00Z`, lang);

function useOnError() {
  const { t } = useTranslation();
  return (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
}
function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['assets'] });
}

function AssetDialog({ asset, onClose }: { asset: Partial<Asset> | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { activeCompany } = useAuth();
  const onError = useOnError();
  const refresh = useRefresh();
  const [form, setForm] = useState<Partial<Asset>>(asset ?? {});
  const valid = Boolean(form.asset_tag?.trim()) && (form.name?.trim().length ?? 0) >= 2;
  const locked = asset?.status === 'assigned';
  const save = useMutation({
    mutationFn: async () => {
      const row = { asset_tag: form.asset_tag!.trim(), name: form.name!.trim(), category: form.category ?? 'laptop', serial_no: form.serial_no?.trim() || null, ...(locked ? {} : { status: form.status ?? 'available' }) };
      return asset?.id
        ? unwrap(await sb().from('company_assets').update(row).eq('id', asset.id).select('id').single())
        : unwrap(await sb().from('company_assets').insert({ ...row, company_id: activeCompany!.id }).select('id').single());
    },
    onSuccess: async () => {
      toast.success(t('common.saved'));
      await refresh();
      onClose();
    },
    onError: (err) => ((err as { code?: string }).code === '23505' ? toast.error(t('assets.tagTaken')) : onError(err)),
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={asset?.id ? t('assets.edit') : t('assets.add')} description={t('assets.addHint')}>
      <form onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }} className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          <TextField label={t('assets.tag')} required maxLength={40} placeholder="LT-001" value={form.asset_tag ?? ''} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} />
          <TextField label={t('assets.name')} required maxLength={120} value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <SelectField label={t('assets.category')} value={form.category ?? 'laptop'} onChange={(e) => setForm({ ...form, category: e.target.value as Asset['category'] })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`assets.categories.${c}`)}</option>)}
          </SelectField>
          <TextField label={t('assets.serial')} maxLength={80} value={form.serial_no ?? ''} onChange={(e) => setForm({ ...form, serial_no: e.target.value })} />
          {!locked && (
            <SelectField label={t('crm.status')} value={form.status ?? 'available'} onChange={(e) => setForm({ ...form, status: e.target.value as AssetStatus })}>
              {STATUSES.filter((s) => s !== 'assigned').map((s) => <option key={s} value={s}>{t(`assets.statuses.${s}`)}</option>)}
            </SelectField>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={save.isPending} disabled={!valid}>{t('common.save')}</Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}

function AssignDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const { t } = useTranslation();
  const { activeCompany } = useAuth();
  const employees = useEmployees(activeCompany?.id);
  const onError = useOnError();
  const refresh = useRefresh();
  const [employeeId, setEmployeeId] = useState('');
  const assign = useMutation({
    mutationFn: async () => unwrap(await sb().from('asset_assignments').insert({ company_id: activeCompany!.id, asset_id: asset.id, employee_id: employeeId }).select('id').single()),
    onSuccess: async () => {
      toast.success(t('assets.assigned'));
      await refresh();
      onClose();
    },
    onError,
  });
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={t('assets.assignTitle', { name: asset.name })} description={asset.asset_tag}>
      <form onSubmit={(e) => { e.preventDefault(); if (employeeId) assign.mutate(); }} className="flex min-h-0 flex-1 flex-col">
        <DialogBody>
          <SelectField label={t('hr.employee')} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">{t('form.select')}</option>
            {(employees.data ?? []).filter((e) => e.status === 'active').map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
          </SelectField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={assign.isPending} disabled={!employeeId}>{t('assets.assign')}</Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}

export function AssetsPage() {
  const { t, i18n } = useTranslation();
  const { activeCompany } = useAuth();
  const onError = useOnError();
  const refresh = useRefresh();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Partial<Asset> | null>(null);
  const [assigning, setAssigning] = useState<Asset | null>(null);
  const [returning, setReturning] = useState<{ asset: Asset; assignment: Assignment } | null>(null);
  const assets = useQuery({
    queryKey: ['assets', 'all', activeCompany?.id],
    enabled: Boolean(activeCompany),
    queryFn: async () => unwrap(await sb().from('company_assets').select('*, asset_assignments(id, employee_id, assigned_on, returned_on, employees(full_name, employee_code))').eq('company_id', activeCompany!.id).order('asset_tag')) as unknown as Asset[],
  });
  const giveBack = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('asset_assignments').update({ returned_on: istDateString(new Date()) }).eq('id', id).select('id').single()),
    onSuccess: async () => {
      setReturning(null);
      toast.success(t('assets.returned'));
      await refresh();
    },
    onError,
  });
  const holder = (a: Asset) => a.asset_assignments?.find((x) => !x.returned_on);
  const rows = (assets.data ?? []).filter((a) => (!status || a.status === status) && (!search || `${a.asset_tag} ${a.name} ${a.serial_no ?? ''} ${holder(a)?.employees?.full_name ?? ''}`.toLowerCase().includes(search.toLowerCase())));

  return (
    <>
      <PageHeader title={t('assets.title')} description={t('assets.subtitle')} actions={<Button onClick={() => setEditing({ category: 'laptop', status: 'available' })}><Plus />{t('assets.add')}</Button>} />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input type="search" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-52">
          <option value="">{t('crm.allStatuses')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`assets.statuses.${s}`)}</option>)}
        </Select>
      </div>
      {assets.isPending ? <ListSkeleton rows={4} /> : assets.isError ? <ErrorState error={assets.error} onRetry={() => void assets.refetch()} /> : !rows.length ? <EmptyState icon={Laptop} title={t('assets.none')} description={t('assets.noneBody')} /> : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((a) => {
            const h = holder(a);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1 basis-52">
                  <p className="break-words font-semibold">{a.name} <span className="text-xs font-normal text-muted-foreground">{a.asset_tag}</span></p>
                  <p className="text-xs text-muted-foreground">{t(`assets.categories.${a.category}`)}{a.serial_no ? ` · ${a.serial_no}` : ''}</p>
                  {h && <p className="text-xs">{t('assets.with', { name: h.employees?.full_name ?? '', date: day(h.assigned_on, i18n.language) })}</p>}
                </div>
                <Badge tone={TONE[a.status]}>{t(`assets.statuses.${a.status}`)}</Badge>
                <div className="flex w-full justify-end gap-2 sm:w-auto">
                  {a.status === 'available' && <Button size="sm" onClick={() => setAssigning(a)}><UserPlus />{t('assets.assign')}</Button>}
                  {h && <Button size="sm" variant="outline" onClick={() => setReturning({ asset: a, assignment: h })}><Undo2 />{t('assets.return')}</Button>}
                  <Button size="icon-sm" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(a)}><Pencil /></Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <AssetDialog key={editing.id ?? 'new'} asset={editing} onClose={() => setEditing(null)} />}
      {assigning && <AssignDialog asset={assigning} onClose={() => setAssigning(null)} />}
      <ConfirmDialog open={Boolean(returning)} onOpenChange={(o) => !o && setReturning(null)} title={t('assets.return')} description={returning ? t('assets.returnConfirm', { name: returning.asset.name, person: returning.assignment.employees?.full_name ?? '' }) : ''} confirmLabel={t('assets.return')} loading={giveBack.isPending} onConfirm={() => returning && giveBack.mutate(returning.assignment.id)} />
    </>
  );
}

/** What one employee currently holds (shown on the profile and on the employee's own documents page). */
export function EmployeeAssetsCard({ employeeId }: { employeeId: string }) {
  const { t, i18n } = useTranslation();
  const held = useQuery({
    queryKey: ['assets', 'held', employeeId],
    queryFn: async () => unwrap(await sb().from('asset_assignments').select('id, employee_id, assigned_on, returned_on, company_assets(id, asset_tag, name, category, serial_no, status)').eq('employee_id', employeeId).is('returned_on', null).order('assigned_on')) as unknown as Assignment[],
  });
  return (
    <Card>
      <CardHeader><CardTitle>{t('assets.title')}</CardTitle></CardHeader>
      <CardContent>
        {held.isPending ? <ListSkeleton rows={2} /> : held.isError ? <ErrorState error={held.error} /> : !held.data?.length ? <p className="text-sm text-muted-foreground">{t('assets.noneHeld')}</p> : (
          <ul className="space-y-2 text-sm">
            {held.data.map((h) => (
              <li key={h.id} className="flex items-start gap-2.5">
                <Laptop className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">
                  <span className="block break-words font-medium">{h.company_assets?.name}</span>
                  <span className="block text-xs text-muted-foreground">{h.company_assets?.asset_tag} · {day(h.assigned_on, i18n.language)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
