import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/shared/Field';
import { ErrorState, ListSkeleton } from '@/components/shared/states';
import { useAuth } from '@/features/auth/AuthProvider';
import { useInvalidateHr, useTeamNames, type Employee } from '@/features/hr/api';
import { errorKey } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { istDateString } from '@shared/slots';

interface Delegation {
  id: string;
  manager_employee_id: string;
  delegate_employee_id: string;
  from_date: string;
  to_date: string;
}

const day = (date: string, lang: string) => formatDate(`${date}T06:30:00Z`, lang);

function useOnError() {
  const { t } = useTranslation();
  return (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
}

/**
 * Hand approvals to a colleague for some days. HR chooses any manager;
 * a manager (fixedManager) hands over their own.
 */
export function DelegationCard({ fixedManager }: { fixedManager?: Employee }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { activeCompany } = useAuth();
  const invalidate = useInvalidateHr();
  const onError = useOnError();
  const names = useTeamNames(activeCompany?.id);
  const today = istDateString(new Date());
  const [form, setForm] = useState({ manager: '', delegate: '', from: today, to: today });
  const manager = fixedManager?.id ?? form.manager;
  const list = useQuery({
    queryKey: ['hr', 'delegations', activeCompany?.id, fixedManager?.id ?? 'all'],
    enabled: Boolean(activeCompany),
    queryFn: async () => {
      let q = sb().from('approval_delegations').select('*').eq('company_id', activeCompany!.id).gte('to_date', today).order('from_date');
      if (fixedManager) q = q.eq('manager_employee_id', fixedManager.id);
      return unwrap(await q) as Delegation[];
    },
  });
  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>) => unwrap(await fn()),
    onSuccess: async () => {
      toast.success(t('common.saved'));
      await invalidate();
    },
    onError,
  });
  const people = names.data ?? [];
  const nameOf = (id: string) => people.find((p) => p.id === id)?.full_name ?? '—';
  const valid = manager && form.delegate && form.delegate !== manager && form.to >= form.from;

  return (
    <Card>
      <CardHeader><CardTitle>{t('delegation.title')}</CardTitle><p className="text-sm text-muted-foreground">{t('delegation.hint')}</p></CardHeader>
      <CardContent className="space-y-3">
        {list.isPending ? <ListSkeleton rows={2} /> : list.isError ? <ErrorState error={list.error} /> : list.data!.length === 0 ? <p className="text-sm text-muted-foreground">{t('delegation.none')}</p> : (
          <ul className="divide-y rounded-xl border text-sm">
            {list.data!.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t('delegation.line', { manager: nameOf(d.manager_employee_id), delegate: nameOf(d.delegate_employee_id) })}</p>
                  <p className="text-xs text-muted-foreground">{day(d.from_date, lang)} – {day(d.to_date, lang)}</p>
                </div>
                {d.from_date <= today && <Badge tone="success">{t('delegation.activeNow')}</Badge>}
                <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onClick={() => run.mutate(() => sb().from('approval_delegations').delete().eq('id', d.id).select('id'))}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 rounded-xl border border-dashed p-3 sm:grid-cols-2">
          {!fixedManager && (
            <SelectField label={t('hr.reportingManager')} value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })}>
              <option value="">{t('form.select')}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </SelectField>
          )}
          <SelectField label={t('delegation.delegate')} value={form.delegate} onChange={(e) => setForm({ ...form, delegate: e.target.value })}>
            <option value="">{t('form.select')}</option>
            {people.filter((p) => p.id !== manager).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </SelectField>
          <TextField label={t('leave.from')} type="date" min={today} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          <TextField label={t('leave.to')} type="date" min={form.from} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          <Button size="sm" className="sm:col-span-2" disabled={!valid} loading={run.isPending} onClick={() => run.mutate(() => sb().from('approval_delegations').insert({ company_id: activeCompany!.id, manager_employee_id: manager, delegate_employee_id: form.delegate, from_date: form.from, to_date: form.to }).select('id').single())}><Plus />{t('delegation.add')}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** HR: after how many hours a waiting approval is reminded and escalated. */
export function ApprovalLimitsCard() {
  const { t } = useTranslation();
  const { activeCompany } = useAuth();
  const onError = useOnError();
  const settings = useQuery({
    queryKey: ['hr', 'settings', activeCompany?.id],
    enabled: Boolean(activeCompany),
    queryFn: async () => (unwrap(await sb().from('hr_settings').select('remind_after_hours, escalate_after_hours').eq('company_id', activeCompany!.id).maybeSingle()) as { remind_after_hours: number; escalate_after_hours: number } | null) ?? { remind_after_hours: 24, escalate_after_hours: 72 },
  });
  const [draft, setDraft] = useState<{ remind: string; escalate: string } | null>(null);
  const remind = draft?.remind ?? String(settings.data?.remind_after_hours ?? 24);
  const escalate = draft?.escalate ?? String(settings.data?.escalate_after_hours ?? 72);
  const valid = Number(remind) >= 1 && Number(remind) <= 240 && Number(escalate) > Number(remind) && Number(escalate) <= 720;
  const invalidate = useInvalidateHr();
  const save = useMutation({
    mutationFn: async () => unwrap(await sb().from('hr_settings').upsert({ company_id: activeCompany!.id, remind_after_hours: Number(remind), escalate_after_hours: Number(escalate) }, { onConflict: 'company_id' }).select('company_id').single()),
    onSuccess: async () => {
      toast.success(t('common.saved'));
      setDraft(null);
      await invalidate();
    },
    onError,
  });
  return (
    <Card>
      <CardHeader><CardTitle>{t('delegation.limitsTitle')}</CardTitle><p className="text-sm text-muted-foreground">{t('delegation.limitsHint')}</p></CardHeader>
      <CardContent className="space-y-3">
        {settings.isError ? <ErrorState error={settings.error} /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t('delegation.remindAfter')} type="number" min={1} max={240} value={remind} onChange={(e) => setDraft({ remind: e.target.value, escalate })} />
              <TextField label={t('delegation.escalateAfter')} type="number" min={2} max={720} error={!valid && draft ? 'validation.number' : undefined} value={escalate} onChange={(e) => setDraft({ remind, escalate: e.target.value })} />
            </div>
            <Button size="sm" disabled={!draft || !valid} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
