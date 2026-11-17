import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, CalendarPlus, CheckCircle2, Circle, Mail, MessageSquare, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { WhatsAppIcon } from '@/components/shared/brand';
import { SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, FormDialog, InfoRow, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { useInvalidateLeads, useLead, useLeadActivities, useLeadTasks, useUpdateLeadStatus } from '@/features/crm/api';
import { LeadFormDialog } from '@/features/crm/LeadFormDialog';
import { ScheduleDemoDialog } from '@/features/demos/ScheduleDemoDialog';
import { usePublicPlans } from '@/features/subscriptions/plans';
import { api, errorKey } from '@/lib/api';
import { formatCurrency, formatDateTime, formatRelative, fromIstInput } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { ACTIVITY_TYPES, LEAD_STATUSES, type LeadStatus } from '@shared/constants';
import { formatPhone } from '@shared/phone';
import { activitySchema, taskSchema } from '@shared/schemas';
import { buildWhatsAppLink } from '@shared/whatsapp';
import type { z } from 'zod';

function ActivityComposer({ leadId }: { leadId: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const invalidate = useInvalidateLeads();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.input<typeof activitySchema>>({ resolver: zodResolver(activitySchema), defaultValues: { type: 'note', body: '' } });
  const onSubmit = async (v: z.input<typeof activitySchema>) => {
    try {
      unwrap(await sb().from('lead_activities').insert({ lead_id: leadId, type: v.type, body: v.body, created_by: user!.id }).select('id').single());
      reset({ type: v.type, body: '' });
      await invalidate(leadId);
    } catch (err) {
      toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    }
  };
  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-2 rounded-xl border bg-muted/30 p-3">
      <TextareaField label={t('crm.addActivity')} rows={2} error={errors.body?.message} placeholder={t('crm.activityPlaceholder')} {...register('body')} />
      <div className="flex items-center justify-between gap-2">
        <Select aria-label={t('crm.activityType')} className="h-9 w-36" {...register('type')}>
          {ACTIVITY_TYPES.map((a) => <option key={a} value={a}>{t(`activityType.${a}`)}</option>)}
        </Select>
        <Button type="submit" size="sm" loading={isSubmitting}>{t('common.add')}</Button>
      </div>
    </form>
  );
}

function Timeline({ leadId }: { leadId: string }) {
  const { t, i18n } = useTranslation();
  const query = useLeadActivities(leadId);
  if (query.isPending) return <ListSkeleton rows={4} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {query.data.map((a) => (
        <motion.li key={a.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="relative">
          <span className={cn('absolute -left-[27px] top-1 size-3 rounded-full border-2 border-background', a.type === 'status_change' ? 'bg-warning' : a.type === 'system' ? 'bg-muted-foreground' : 'bg-primary')} aria-hidden />
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <Badge tone="outline">{t(`activityType.${a.type}`)}</Badge>
            <span>{a.author?.full_name ?? t('crm.system')}</span>
            <time dateTime={a.created_at} title={formatDateTime(a.created_at, i18n.language)}>{formatRelative(a.created_at, i18n.language)}</time>
          </div>
          {a.type === 'status_change' ? (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm"><StatusBadge value={String(a.metadata.from ?? '')} group="leadStatus" />→<StatusBadge value={String(a.metadata.to ?? '')} group="leadStatus" /></p>
          ) : a.type === 'assignment' ? (
            <p className="mt-1 text-sm">{t('crm.reassigned')}</p>
          ) : (
            a.body && <p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p>
          )}
        </motion.li>
      ))}
    </ol>
  );
}

function Tasks({ leadId, assignedTo }: { leadId: string; assignedTo: string | null }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const query = useLeadTasks(leadId);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.input<typeof taskSchema>>({ resolver: zodResolver(taskSchema) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['lead-tasks', leadId] });
  const add = async (v: z.input<typeof taskSchema>) => {
    const parsed = taskSchema.parse(v);
    try {
      unwrap(await sb().from('lead_tasks').insert({ lead_id: leadId, title: parsed.title, due_at: fromIstInput(parsed.due_at), assigned_to: assignedTo ?? user!.id, created_by: user!.id }).select('id').single());
      reset({ title: '', due_at: '' });
      await refresh();
    } catch (err) {
      toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    }
  };
  const toggle = useMutation({
    mutationFn: async ({ id, done }: { id: string; done: boolean }) => unwrap(await sb().from('lead_tasks').update({ completed_at: done ? new Date().toISOString() : null }).eq('id', id).select('id').single()),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: async (id: string) => unwrap(await sb().from('lead_tasks').delete().eq('id', id).select('id')), onSettled: refresh });

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit(add)} noValidate className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <TextField label={t('crm.taskTitle')} error={errors.title?.message} {...register('title')} />
        <TextField label={t('crm.due')} type="datetime-local" error={errors.due_at?.message} {...register('due_at')} />
        <Button type="submit" loading={isSubmitting}><Plus />{t('common.add')}</Button>
      </form>
      <ul className="divide-y rounded-xl border">
        {query.data?.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">{t('crm.noTasks')}</li>}
        <AnimatePresence initial={false}>
          {query.data?.map((task) => {
            const done = Boolean(task.completed_at);
            const overdue = !done && task.due_at && new Date(task.due_at).getTime() < Date.now();
            return (
              <motion.li key={task.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 px-3 py-2.5">
                <button className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-muted" aria-label={done ? t('crm.markIncomplete') : t('crm.markComplete')} aria-pressed={done} onClick={() => toggle.mutate({ id: task.id, done: !done })}>
                  {done ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-muted-foreground" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate text-sm font-medium', done && 'text-muted-foreground line-through')}>{task.title}</p>
                  {task.due_at && <p className={cn('text-xs', overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{formatDateTime(task.due_at, i18n.language)}</p>}
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onClick={() => remove.mutate(task.id)}><Trash2 /></Button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function ConvertDialog({ open, onOpenChange, leadId }: { open: boolean; onOpenChange: (o: boolean) => void; leadId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const invalidate = useInvalidateLeads();
  const { data: plans = [] } = usePublicPlans();
  const [plan, setPlan] = useState('business');
  const convert = useMutation({
    mutationFn: () => api<{ company_id: string }>('/admin/customers', { method: 'POST', body: { action: 'convert', lead_id: leadId, plan_key: plan } }),
    onSuccess: async (res) => {
      toast.success(t('crm.converted'));
      await invalidate(leadId);
      navigate(`/admin/customers/${res.company_id}`);
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t('crm.convertTitle')} description={t('crm.convertBody')} size="sm">
      <DialogBody>
        <SelectField label={t('trial.plan')} value={plan} onChange={(e) => setPlan(e.target.value)}>
          {plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
        </SelectField>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        <Button loading={convert.isPending} onClick={() => convert.mutate()}>{t('crm.convert')}</Button>
      </DialogFooter>
    </FormDialog>
  );
}

export function LeadDetailPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const query = useLead(id);
  const updateStatus = useUpdateLeadStatus();
  const invalidate = useInvalidateLeads();
  const [editOpen, setEditOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const del = useMutation({
    mutationFn: async () => unwrap(await sb().from('leads').delete().eq('id', id!).select('id')),
    onSuccess: async () => {
      toast.success(t('crm.deleted'));
      await invalidate();
      navigate('/admin/leads');
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  if (query.isPending) return <ListSkeleton rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const lead = query.data;
  const wa = buildWhatsAppLink(lead.phone, t('crm.waGreeting', { name: lead.contact_person }));

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to="/admin/leads"><ArrowLeft />{t('crm.backToLeads')}</Link></Button>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{lead.company_name}</h1>
            <StatusBadge value={lead.priority} group="priority" />
            {lead.converted_company_id && <Badge tone="success">{t('crm.customer')}</Badge>}
          </div>
          <p className="text-muted-foreground">{lead.contact_person}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild><a href={`tel:${lead.phone}`}><Phone />{t('crm.call')}</a></Button>
          {wa && <Button variant="whatsapp" size="sm" asChild><a href={wa} target="_blank" rel="noopener noreferrer"><WhatsAppIcon className="size-4" />WhatsApp</a></Button>}
          {lead.email && <Button variant="outline" size="sm" asChild><a href={`mailto:${lead.email}`}><Mail />{t('form.email')}</a></Button>}
          <Button variant="outline" size="sm" onClick={() => setDemoOpen(true)}><CalendarPlus />{t('demos.schedule')}</Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}><Pencil />{t('common.edit')}</Button>
          {lead.converted_company_id ? (
            <Button size="sm" asChild><Link to={`/admin/customers/${lead.converted_company_id}`}><Building2 />{t('crm.viewCustomer')}</Link></Button>
          ) : (
            <Button size="sm" onClick={() => setConvertOpen(true)}><Building2 />{t('crm.convert')}</Button>
          )}
        </div>
      </div>

      {/* Pipeline stepper */}
      <div className="scroll-thin mb-5 overflow-x-auto">
        <ol className="flex min-w-max gap-1" aria-label={t('crm.pipeline')}>
          {LEAD_STATUSES.map((s) => {
            const idx = LEAD_STATUSES.indexOf(s);
            const cur = LEAD_STATUSES.indexOf(lead.status);
            const active = s === lead.status;
            const past = lead.status !== 'lost' && idx < cur && s !== 'lost';
            return (
              <li key={s}>
                <button
                  onClick={() => s !== lead.status && updateStatus.mutate({ id: lead.id, status: s as LeadStatus })}
                  aria-current={active ? 'step' : undefined}
                  className={cn('h-9 rounded-md px-3 text-xs font-semibold transition-colors', active ? (s === 'lost' ? 'bg-destructive text-destructive-foreground' : s === 'won' ? 'bg-success text-white' : 'bg-primary text-primary-foreground') : past ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/70')}
                >
                  {t(`leadStatus.${s}`)}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <Card>
          <Tabs defaultValue="activity">
            <CardHeader className="pb-0"><TabsList><TabsTrigger value="activity"><MessageSquare />{t('crm.history')}</TabsTrigger><TabsTrigger value="tasks"><CheckCircle2 />{t('crm.tasks')}</TabsTrigger></TabsList></CardHeader>
            <CardContent>
              <TabsContent value="activity" className="space-y-5"><ActivityComposer leadId={lead.id} /><Timeline leadId={lead.id} /></TabsContent>
              <TabsContent value="tasks"><Tasks leadId={lead.id} assignedTo={lead.assigned_to} /></TabsContent>
            </CardContent>
          </Tabs>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{t('crm.details')}</CardTitle></CardHeader>
            <CardContent>
              <dl className="divide-y">
                <InfoRow label={t('crm.status')}><StatusBadge value={lead.status} group="leadStatus" /></InfoRow>
                <InfoRow label={t('form.phone')}>{formatPhone(lead.phone)}</InfoRow>
                <InfoRow label={t('form.email')}>{lead.email}</InfoRow>
                <InfoRow label={t('form.city')}>{lead.city ? t(`city.${lead.city}`, { defaultValue: lead.city }) : null}</InfoRow>
                <InfoRow label={t('form.industry')}>{lead.industry ? t(`industry.${lead.industry}`, { defaultValue: lead.industry }) : null}</InfoRow>
                <InfoRow label={t('crm.employeeCount')}>{lead.employee_count}</InfoRow>
                <InfoRow label={t('form.existingHrms')}>{lead.existing_hrms}</InfoRow>
                <InfoRow label={t('crm.source')}>{t(`source.${lead.source}`)}</InfoRow>
                <InfoRow label={t('crm.assignedTo')}>{lead.assignee?.full_name ?? t('crm.unassigned')}</InfoRow>
                <InfoRow label={t('crm.nextFollowUp')}>{formatDateTime(lead.next_follow_up_at, lang)}</InfoRow>
                <InfoRow label={t('crm.expectedValue')}>{lead.expected_value !== null ? formatCurrency(lead.expected_value, lang) : null}</InfoRow>
                <InfoRow label={t('crm.consent')}>{lead.communication_consent ? t('common.yes') : t('common.no')}</InfoRow>
                <InfoRow label={t('crm.created')}>{formatDateTime(lead.created_at, lang)}</InfoRow>
                {lead.lost_reason && <InfoRow label={t('crm.lostReason')}>{lead.lost_reason}</InfoRow>}
              </dl>
              {lead.interested_features.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">{lead.interested_features.map((f) => <Badge key={f} tone="primary">{t(`feature.${f}`, { defaultValue: f })}</Badge>)}</div>
              )}
              {lead.remarks && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{lead.remarks}</p>}
            </CardContent>
          </Card>
          {can('leads.delete') && <Button variant="ghost" className="w-full text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 />{t('crm.deleteLead')}</Button>}
        </div>
      </div>

      <LeadFormDialog open={editOpen} onOpenChange={setEditOpen} lead={lead} />
      <ScheduleDemoDialog open={demoOpen} onOpenChange={setDemoOpen} lead={lead} />
      <ConvertDialog open={convertOpen} onOpenChange={setConvertOpen} leadId={lead.id} />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t('crm.deleteLead')} description={t('crm.deleteConfirm')} confirmLabel={t('common.delete')} destructive loading={del.isPending} onConfirm={() => del.mutate()} />
    </>
  );
}
