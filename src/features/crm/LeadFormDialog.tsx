import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { CheckField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { FormDialog, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { findDuplicates, useSaveLead, type DuplicateLead } from '@/features/crm/api';
import { salesPeople, useStaff } from '@/hooks/useStaff';
import { formatDate, fromIstInput, toIstInput } from '@/lib/format';
import type { Lead } from '@/types/db';
import { CITIES, FEATURE_INTERESTS, INDUSTRIES, LEAD_PRIORITIES, LEAD_SOURCES, LEAD_STATUSES } from '@shared/constants';
import { leadFormSchema, type LeadFormInput, type LeadFormValues } from '@shared/schemas';
import { isValidIndianPhone } from '@shared/phone';

function defaults(lead: Lead | null | undefined, userId: string | undefined, canAssign: boolean): LeadFormInput {
  return {
    company_name: lead?.company_name ?? '',
    contact_person: lead?.contact_person ?? '',
    phone: lead?.phone ?? '',
    email: lead?.email ?? '',
    city: lead?.city ?? '',
    industry: lead?.industry ?? '',
    employee_count: lead?.employee_count ?? '',
    existing_hrms: lead?.existing_hrms ?? '',
    interested_features: lead?.interested_features ?? [],
    source: lead?.source ?? 'phone_call',
    assigned_to: lead ? lead.assigned_to ?? '' : canAssign ? '' : userId ?? '',
    priority: lead?.priority ?? 'medium',
    status: lead?.status ?? 'new',
    next_follow_up_at: toIstInput(lead?.next_follow_up_at),
    remarks: lead?.remarks ?? '',
    communication_consent: lead?.communication_consent ?? false,
    expected_value: lead?.expected_value ?? '',
  } as LeadFormInput;
}

export function LeadFormDialog({ open, onOpenChange, lead, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; lead?: Lead | null; onSaved?: (id: string) => void }) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const { data: staff } = useStaff();
  const save = useSaveLead();
  const canAssign = can('leads.assign');
  const [duplicates, setDuplicates] = useState<DuplicateLead[]>([]);
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<LeadFormInput>({ resolver: zodResolver(leadFormSchema) as never, defaultValues: defaults(lead, user?.id, canAssign) });

  useEffect(() => {
    if (open) {
      reset(defaults(lead, user?.id, canAssign));
      setDuplicates([]);
    }
  }, [open, lead, reset, user?.id, canAssign]);

  const phone = watch('phone');
  const email = watch('email');
  useEffect(() => {
    if (!open || !isValidIndianPhone(phone ?? '')) {
      setDuplicates([]);
      return;
    }
    const timer = setTimeout(() => void findDuplicates(phone, email || undefined, lead?.id).then(setDuplicates), 400);
    return () => clearTimeout(timer);
  }, [phone, email, open, lead?.id]);

  const onSubmit = async (values: LeadFormValues) => {
    const payload = { ...values, next_follow_up_at: fromIstInput(values.next_follow_up_at) };
    const res = await save.mutateAsync({ id: lead?.id, values: payload, userId: user!.id });
    onOpenChange(false);
    onSaved?.(res.id);
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={lead ? t('crm.editLead') : t('crm.newLead')} size="lg">
      <form onSubmit={handleSubmit(onSubmit as never)} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          {duplicates.length > 0 && (
            <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="mb-2 flex items-center gap-2 font-semibold"><TriangleAlert className="size-4 text-warning" aria-hidden />{t('crm.duplicateWarning')}</p>
              <ul className="space-y-1">
                {duplicates.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/leads/${d.id}`} className="font-medium underline-offset-4 hover:underline" onClick={() => onOpenChange(false)}>{d.company_name}</Link>
                    <span className="text-muted-foreground">{d.contact_person}</span>
                    <StatusBadge value={d.status} group="leadStatus" />
                    <span className="text-xs text-muted-foreground">{d.assigned_to_name ?? t('crm.unassigned')} · {formatDate(d.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label={t('form.companyName')} required error={errors.company_name?.message} {...register('company_name')} />
            <TextField label={t('form.contactPerson')} required error={errors.contact_person?.message} {...register('contact_person')} />
            <TextField label={t('form.phone')} required type="tel" inputMode="tel" error={errors.phone?.message} {...register('phone')} />
            <TextField label={t('form.email')} type="email" error={errors.email?.message} {...register('email')} />
            <SelectField label={t('form.city')} error={errors.city?.message} {...register('city')}>
              <option value="">{t('form.select')}</option>
              {CITIES.map((c) => <option key={c} value={c}>{t(`city.${c}`)}</option>)}
            </SelectField>
            <SelectField label={t('form.industry')} error={errors.industry?.message} {...register('industry')}>
              <option value="">{t('form.select')}</option>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{t(`industry.${i}`)}</option>)}
            </SelectField>
            <TextField label={t('crm.employeeCount')} type="number" min={1} inputMode="numeric" error={errors.employee_count?.message} {...register('employee_count')} />
            <TextField label={t('form.existingHrms')} error={errors.existing_hrms?.message} {...register('existing_hrms')} />
            <SelectField label={t('crm.source')} required error={errors.source?.message} {...register('source')}>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{t(`source.${s}`)}</option>)}
            </SelectField>
            <SelectField label={t('crm.assignedTo')} error={errors.assigned_to?.message} disabled={!canAssign} {...register('assigned_to')}>
              <option value="">{t('crm.unassigned')}</option>
              {salesPeople(staff).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
            </SelectField>
            <SelectField label={t('crm.priority')} error={errors.priority?.message} {...register('priority')}>
              {LEAD_PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
            </SelectField>
            <SelectField label={t('crm.status')} error={errors.status?.message} {...register('status')}>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(`leadStatus.${s}`)}</option>)}
            </SelectField>
            <TextField label={t('crm.nextFollowUp')} type="datetime-local" hint={t('common.istHint')} error={errors.next_follow_up_at?.message} {...register('next_follow_up_at')} />
            <TextField label={t('crm.expectedValue')} type="number" min={0} inputMode="decimal" error={errors.expected_value?.message} {...register('expected_value')} />
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('form.interestedIn')}</legend>
            <div className="flex flex-wrap gap-2">
              {FEATURE_INTERESTS.map((f) => (
                <label key={f} className="cursor-pointer">
                  <input type="checkbox" value={f} className="peer sr-only" {...register('interested_features')} />
                  <span className="inline-flex min-h-9 items-center rounded-full border px-3 text-sm peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:text-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{t(`feature.${f}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <TextareaField label={t('crm.remarks')} rows={3} error={errors.remarks?.message} {...register('remarks')} />
          <CheckField label={t('crm.consentConfirmed')} {...register('communication_consent')} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}
