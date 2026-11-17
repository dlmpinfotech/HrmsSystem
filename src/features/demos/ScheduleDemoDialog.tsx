import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { CheckField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { FormDialog } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { salesPeople, useStaff } from '@/hooks/useStaff';
import { api, errorKey } from '@/lib/api';
import { fromIstInput } from '@/lib/format';
import type { Lead } from '@/types/db';
import { DEMO_MODES } from '@shared/constants';

/** Staff-side demo scheduling for an existing lead. Overlaps are rejected by the database. */
export function ScheduleDemoDialog({ open, onOpenChange, lead }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Lead }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user, can } = useAuth();
  const { data: staff } = useStaff();
  const isAdmin = can('leads.assign');
  const [form, setForm] = useState({ salesperson_id: '', starts_at: '', duration_minutes: 45, mode: 'online', meeting_url: '', notes: '', notify: true });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setForm((f) => ({ ...f, salesperson_id: lead.assigned_to && isAdmin ? lead.assigned_to : user?.id ?? '', starts_at: '', notes: '' }));
  }, [open, lead.assigned_to, user?.id, isAdmin]);

  const mutation = useMutation({
    mutationFn: () => {
      const startsAt = fromIstInput(form.starts_at);
      if (!startsAt) throw new Error('errors.validation_failed');
      return api('/admin/demos', { method: 'POST', body: { action: 'create', lead_id: lead.id, ...form, starts_at: startsAt, meeting_url: form.meeting_url || undefined, notes: form.notes || undefined } });
    },
    onSuccess: async () => {
      toast.success(t('demos.scheduled'));
      onOpenChange(false);
      await Promise.all([qc.invalidateQueries({ queryKey: ['demos'] }), qc.invalidateQueries({ queryKey: ['lead', lead.id] }), qc.invalidateQueries({ queryKey: ['lead-activities', lead.id] }), qc.invalidateQueries({ queryKey: ['leads'] })]);
    },
    onError: (err) => setError(errorKey(err)),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : k === 'duration_minutes' ? Number(e.target.value) : e.target.value }));

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t('demos.schedule')} description={lead.company_name}>
      <DialogBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label={t('demos.salesperson')} value={form.salesperson_id} onChange={set('salesperson_id')} disabled={!isAdmin}>
            {salesPeople(staff).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
          </SelectField>
          <TextField label={t('demos.startsAt')} type="datetime-local" required hint={t('common.istHint')} value={form.starts_at} onChange={set('starts_at')} />
          <SelectField label={t('demos.duration')} value={String(form.duration_minutes)} onChange={set('duration_minutes')}>
            {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{t('demos.minutes', { count: m })}</option>)}
          </SelectField>
          <SelectField label={t('bookDemo.mode')} value={form.mode} onChange={set('mode')}>
            {DEMO_MODES.map((m) => <option key={m} value={m}>{t(`demoMode.${m}`)}</option>)}
          </SelectField>
        </div>
        <TextField label={t('demos.meetingUrl')} type="url" placeholder="https://" value={form.meeting_url} onChange={set('meeting_url')} />
        <TextareaField label={t('bookDemo.notes')} rows={2} value={form.notes} onChange={set('notes')} />
        <CheckField label={t('demos.notifyCustomer')} checked={form.notify} onChange={set('notify')} />
        {error && <p role="alert" className="text-sm font-medium text-destructive">{t(error, { defaultValue: t('errors.generic') })}</p>}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button disabled={!form.starts_at || !form.salesperson_id} loading={mutation.isPending} onClick={() => { setError(null); mutation.mutate(); }}>{t('demos.schedule')}</Button>
      </DialogFooter>
    </FormDialog>
  );
}
