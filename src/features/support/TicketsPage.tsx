import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LifeBuoy, Lock, Plus, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Avatar, Switch } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton, QueryState } from '@/components/shared/states';
import { FormDialog, InfoRow, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { staffName, supportPeople, useStaff } from '@/hooks/useStaff';
import { api, errorKey } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { SupportMessage, SupportTicket } from '@/types/db';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from '@shared/constants';
import { ticketCreateSchema } from '@shared/schemas';
import type { z } from 'zod';

function useTickets(companyId?: string) {
  return useQuery({
    queryKey: ['tickets', companyId ?? 'all'],
    queryFn: async () => {
      let q = sb().from('support_tickets').select('*, companies(id, name)').order('updated_at', { ascending: false }).limit(500);
      if (companyId) q = q.eq('company_id', companyId);
      return unwrap(await q) as unknown as SupportTicket[];
    },
  });
}

export function TicketList({ companyId, basePath }: { companyId?: string; basePath: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isStaff } = useAuth();
  const { data: staff } = useStaff();
  const [status, setStatus] = useState('open_all');
  const [search, setSearch] = useState('');
  const query = useTickets(companyId);
  const rows = useMemo(
    () =>
      (query.data ?? []).filter(
        (tk) =>
          (status === '' || (status === 'open_all' ? !['resolved', 'closed'].includes(tk.status) : tk.status === status)) &&
          (!search || `${tk.ticket_number} ${tk.subject} ${tk.companies?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())),
      ),
    [query.data, status, search],
  );
  const columns: Column<SupportTicket>[] = [
    { key: 'subject', header: t('support.subject'), primary: true, cell: (tk) => <div className="min-w-0"><p className="truncate font-semibold">{tk.subject}</p><p className="text-xs text-muted-foreground">{tk.ticket_number}</p></div> },
    ...(companyId ? [] : [{ key: 'company', header: t('form.companyName'), cell: (tk: SupportTicket) => tk.companies?.name ?? '—' }]),
    { key: 'category', header: t('support.category'), cell: (tk) => t(`ticketCategory.${tk.category}`), hideOnMobile: true },
    { key: 'priority', header: t('crm.priority'), cell: (tk) => <StatusBadge value={tk.priority} group="priority" /> },
    { key: 'status', header: t('crm.status'), cell: (tk) => <StatusBadge value={tk.status} group="ticketStatus" /> },
    ...(isStaff ? [{ key: 'assignee', header: t('crm.assignedTo'), cell: (tk: SupportTicket) => staffName(staff, tk.assigned_to), hideOnMobile: true }] : []),
    { key: 'updated', header: t('support.updated'), cell: (tk) => <span className="text-xs">{formatRelative(tk.updated_at, i18n.language)}</span> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input type="search" aria-label={t('common.search')} placeholder={t('support.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
          <option value="open_all">{t('support.openTickets')}</option>
          <option value="">{t('support.allTickets')}</option>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{t(`ticketStatus.${s}`)}</option>)}
        </Select>
      </div>
      <QueryState query={query} isEmpty={() => rows.length === 0} empty={<EmptyState icon={LifeBuoy} title={t('support.empty')} />}>
        {() => <DataTable caption={t('support.title')} columns={columns} rows={rows} rowKey={(tk) => tk.id} onRowClick={(tk) => navigate(`${basePath}/${tk.id}`)} />}
      </QueryState>
    </div>
  );
}

export function NewTicketDialog({ open, onOpenChange, companyId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; companyId: string; onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.input<typeof ticketCreateSchema>>({
    resolver: zodResolver(ticketCreateSchema),
    defaultValues: { company_id: companyId, category: 'general', priority: 'medium', subject: '', description: '' },
  });
  const onSubmit = async (v: z.input<typeof ticketCreateSchema>) => {
    try {
      const res = await api<{ ticket: SupportTicket }>('/support', { method: 'POST', body: { action: 'create', ...v, company_id: companyId } });
      toast.success(t('support.created'));
      reset();
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ['tickets'] });
      onCreated(res.ticket.id);
    } catch (err) {
      toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    }
  };
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={t('support.newTicket')}>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-3">
          <TextField label={t('support.subject')} required error={errors.subject?.message} {...register('subject')} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={t('support.category')} {...register('category')}>{TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{t(`ticketCategory.${c}`)}</option>)}</SelectField>
            <SelectField label={t('crm.priority')} {...register('priority')}>{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}</SelectField>
          </div>
          <TextareaField label={t('support.description')} required rows={6} error={errors.description?.message} {...register('description')} />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button type="submit" loading={isSubmitting}>{t('support.submit')}</Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}

export function TicketDetailPage({ basePath }: { basePath: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { user, isStaff, can } = useAuth();
  const { data: staff } = useStaff();
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: async () => unwrap(await sb().from('support_tickets').select('*, companies(id, name), creator:profiles!support_tickets_created_by_fkey(full_name, email)').eq('id', id).single()) as unknown as SupportTicket });
  const messages = useQuery({
    queryKey: ['ticket-messages', id],
    refetchInterval: 30_000,
    queryFn: async () => unwrap(await sb().from('support_messages').select('*, author:profiles!support_messages_author_id_fkey(full_name)').eq('ticket_id', id).order('created_at')) as unknown as SupportMessage[],
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['ticket', id] }), qc.invalidateQueries({ queryKey: ['ticket-messages', id] }), qc.invalidateQueries({ queryKey: ['tickets'] })]);
  const action = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api('/support', { method: 'POST', body: { ticket_id: id, ...payload } }),
    onSuccess: async (_d, vars) => {
      if (vars.action === 'reply') setBody('');
      await refresh();
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  if (ticket.isPending) return <ListSkeleton rows={6} />;
  if (ticket.isError) return <ErrorState error={ticket.error} />;
  const tk = ticket.data;
  const closed = tk.status === 'closed';

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to={basePath}><ArrowLeft />{t('support.back')}</Link></Button>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{tk.subject}</h1>
        <StatusBadge value={tk.status} group="ticketStatus" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Card className="flex flex-col">
          <CardContent className="flex-1 space-y-4 pt-5">
            <div className="rounded-xl border bg-muted/40 p-4">
              <p className="mb-1 text-xs text-muted-foreground">{tk.creator?.full_name ?? tk.creator?.email} · {formatDateTime(tk.created_at, lang)}</p>
              <p className="whitespace-pre-wrap text-sm">{tk.description}</p>
            </div>
            {messages.data?.map((m) => {
              const mine = m.author_id === user?.id;
              return (
                <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('flex gap-3', mine && 'flex-row-reverse')}>
                  <Avatar name={m.author?.full_name ?? t('support.team')} className="size-8" />
                  <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm', m.is_internal ? 'border border-dashed border-warning bg-warning/10' : mine ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                    <p className={cn('mb-0.5 text-xs', mine && !m.is_internal ? 'opacity-80' : 'text-muted-foreground')}>
                      {m.author?.full_name ?? t('support.team')} · {formatRelative(m.created_at, lang)}
                      {m.is_internal && <Badge tone="warning" className="ml-2"><Lock className="size-3" />{t('support.internal')}</Badge>}
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                </motion.div>
              );
            })}
          </CardContent>
          <div className="sticky bottom-0 border-t bg-card p-4">
            {closed && !isStaff ? (
              <p className="text-sm text-muted-foreground">{t('support.closedNote')}</p>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) action.mutate({ action: 'reply', body, is_internal: internal }); }} className="space-y-2">
                <TextareaField label={t('support.reply')} rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {isStaff ? <label className="flex items-center gap-2 text-sm"><Switch checked={internal} onCheckedChange={setInternal} />{t('support.internalNote')}</label> : <span />}
                  <Button type="submit" loading={action.isPending && action.variables?.action === 'reply'} disabled={!body.trim()}><Send />{t('support.send')}</Button>
                </div>
              </form>
            )}
          </div>
        </Card>
        <Card className="self-start">
          <CardHeader><CardTitle>{t('crm.details')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <dl className="divide-y">
              <InfoRow label={t('support.number')}>{tk.ticket_number}</InfoRow>
              {isStaff && <InfoRow label={t('form.companyName')}><Link className="hover:underline" to={`/admin/customers/${tk.company_id}`}>{tk.companies?.name}</Link></InfoRow>}
              <InfoRow label={t('support.category')}>{t(`ticketCategory.${tk.category}`)}</InfoRow>
              <InfoRow label={t('support.created')}>{formatDateTime(tk.created_at, lang)}</InfoRow>
              {tk.resolved_at && <InfoRow label={t('support.resolved')}>{formatDateTime(tk.resolved_at, lang)}</InfoRow>}
            </dl>
            {isStaff && can('support.manage') ? (
              <div className="space-y-3">
                <SelectField label={t('crm.status')} value={tk.status} onChange={(e) => action.mutate({ action: 'update', status: e.target.value })}>
                  {TICKET_STATUSES.map((s) => <option key={s} value={s}>{t(`ticketStatus.${s}`)}</option>)}
                </SelectField>
                <SelectField label={t('crm.priority')} value={tk.priority} onChange={(e) => action.mutate({ action: 'update', priority: e.target.value })}>
                  {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
                </SelectField>
                <SelectField label={t('crm.assignedTo')} value={tk.assigned_to ?? ''} onChange={(e) => action.mutate({ action: 'update', assigned_to: e.target.value || null })}>
                  <option value="">{t('crm.unassigned')}</option>
                  {supportPeople(staff).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
                </SelectField>
              </div>
            ) : (
              !isStaff && (
                <div className="flex flex-wrap gap-2">
                  <InfoRow label={t('crm.priority')}><StatusBadge value={tk.priority} group="priority" /></InfoRow>
                  {['resolved', 'closed'].includes(tk.status) ? (
                    tk.status === 'resolved' && <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'update', status: 'open' })}>{t('support.reopen')}</Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'update', status: 'resolved' })}>{t('support.markResolved')}</Button>
                  )}
                </div>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Staff support queue. */
export function AdminTicketsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('support.title')} description={t('support.subtitle')} />
      <TicketList basePath="/admin/support" />
    </>
  );
}

/** Customer portal ticket list. */
export function PortalTicketsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeCompany } = useAuth();
  const [open, setOpen] = useState(false);
  if (!activeCompany) return null;
  return (
    <>
      <PageHeader title={t('support.title')} description={t('support.portalSubtitle')} actions={<Button onClick={() => setOpen(true)}><Plus />{t('support.newTicket')}</Button>} />
      <TicketList companyId={activeCompany.id} basePath="/portal/support" />
      <NewTicketDialog open={open} onOpenChange={setOpen} companyId={activeCompany.id} onCreated={(id) => navigate(`/portal/support/${id}`)} />
    </>
  );
}
