import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, LifeBuoy, Lock, MessageSquarePlus, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { CheckField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, FormDialog, PageHeader } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { useEmployees, useHrMembers, useMyEmployee } from '@/features/hr/api';
import { errorKey } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { ARTICLE_CATEGORIES, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, isOverdue, type TicketPriority, type TicketStatus } from '@shared/helpdesk';

interface HrTicket {
  id: string;
  ticket_no: number;
  company_id: string;
  employee_id: string;
  category: string;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to: string | null;
  due_at: string | null;
  first_response_at: string | null;
  created_at: string;
  updated_at: string;
  employees?: { full_name: string; employee_code: string } | null;
}
interface Message {
  id: string;
  body: string;
  from_hr: boolean;
  internal: boolean;
  created_at: string;
}
interface Article {
  id: string;
  title: string;
  body: string;
  category: string;
  published: boolean;
}

const STATUS_TONE: Record<TicketStatus, BadgeTone> = { open: 'info', waiting_employee: 'warning', resolved: 'success', closed: 'neutral' };
const PRIORITY_TONE: Record<TicketPriority, BadgeTone> = { low: 'outline', normal: 'neutral', high: 'warning', urgent: 'danger' };

function useOnError() {
  const { t } = useTranslation();
  return (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
}
function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['helpdesk'] });
}

function TicketBadges({ x }: { x: HrTicket }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={STATUS_TONE[x.status]}>{t(`helpdesk.statuses.${x.status}`)}</Badge>
      <Badge tone={PRIORITY_TONE[x.priority]}>{t(`helpdesk.priorities.${x.priority}`)}</Badge>
      {isOverdue(x) && <Badge tone="danger">{t('helpdesk.overdue')}</Badge>}
    </span>
  );
}

// ── New ticket ────────────────────────────────────────────────────────
function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { activeCompany, isHr } = useAuth();
  const me = useMyEmployee();
  const employees = useEmployees(activeCompany?.id, isHr && open);
  const onError = useOnError();
  const refresh = useRefresh();
  const [form, setForm] = useState({ employee_id: '', category: 'payroll', priority: 'normal', subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const employeeId = isHr ? form.employee_id || me.data?.id || '' : me.data?.id ?? '';
  const valid = Boolean(employeeId) && form.subject.trim().length >= 3 && form.body.trim().length >= 1;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const ticket = unwrap(
        await sb().from('hr_tickets').insert({ company_id: activeCompany!.id, employee_id: employeeId, category: form.category, priority: form.priority, subject: form.subject.trim() }).select('id').single(),
      ) as { id: string };
      unwrap(await sb().from('hr_ticket_messages').insert({ ticket_id: ticket.id, company_id: activeCompany!.id, body: form.body.trim() }).select('id').single());
      toast.success(t('helpdesk.created'));
      setForm({ employee_id: '', category: 'payroll', priority: 'normal', subject: '', body: '' });
      await refresh();
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={(o) => !o && onClose()} title={t('helpdesk.ask')} description={t('helpdesk.askHint')}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <DialogBody className="space-y-4">
          {isHr && (
            <SelectField label={t('hr.employee')} value={employeeId} onChange={(e) => set({ employee_id: e.target.value })}>
              <option value="">{t('form.select')}</option>
              {(employees.data ?? []).filter((x) => x.status === 'active').map((x) => <option key={x.id} value={x.id}>{x.full_name} ({x.employee_code})</option>)}
            </SelectField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label={t('helpdesk.category')} value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{t(`helpdesk.categories.${c}`)}</option>)}
            </SelectField>
            <SelectField label={t('helpdesk.priority')} value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(`helpdesk.priorities.${p}`)}</option>)}
            </SelectField>
          </div>
          <TextField label={t('helpdesk.subject')} required maxLength={150} value={form.subject} onChange={(e) => set({ subject: e.target.value })} />
          <TextareaField label={t('helpdesk.details')} required rows={5} maxLength={4000} value={form.body} onChange={(e) => set({ body: e.target.value })} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={busy} disabled={!valid}><Send />{t('helpdesk.send')}</Button>
        </DialogFooter>
      </form>
    </FormDialog>
  );
}

// ── Ticket list ───────────────────────────────────────────────────────
function Tickets() {
  const { t, i18n } = useTranslation();
  const { activeCompany, isHr } = useAuth();
  const me = useMyEmployee();
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const scope = isHr ? 'all' : me.data?.id ?? '';
  const tickets = useQuery({
    queryKey: ['helpdesk', 'tickets', activeCompany?.id, scope],
    enabled: Boolean(activeCompany && scope),
    queryFn: async () => {
      let q = sb().from('hr_tickets').select('*, employees(full_name, employee_code)').eq('company_id', activeCompany!.id).order('updated_at', { ascending: false }).limit(500);
      if (!isHr) q = q.eq('employee_id', scope);
      return unwrap(await q) as unknown as HrTicket[];
    },
  });
  const rows = (tickets.data ?? []).filter(
    (x) => (status === '' || (status === 'active' ? x.status === 'open' || x.status === 'waiting_employee' : x.status === status)) && (!search || `#${x.ticket_no} ${x.subject} ${x.employees?.full_name ?? ''}`.toLowerCase().includes(search.toLowerCase())),
  );

  if (!isHr && !me.isPending && !me.data) return <EmptyState icon={LifeBuoy} title={t('att.noRecordTitle')} description={t('att.noRecordBody')} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input type="search" aria-label={t('common.search')} placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        <Select aria-label={t('crm.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-56">
          <option value="active">{t('helpdesk.active')}</option>
          <option value="">{t('crm.allStatuses')}</option>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{t(`helpdesk.statuses.${s}`)}</option>)}
        </Select>
      </div>
      {tickets.isPending ? <ListSkeleton rows={4} /> : tickets.isError ? <ErrorState error={tickets.error} onRetry={() => void tickets.refetch()} /> : !rows.length ? <EmptyState icon={LifeBuoy} title={t('helpdesk.none')} /> : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((x) => (
            <li key={x.id}>
              <Link to={`/portal/helpdesk/${x.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-words font-semibold">#{x.ticket_no} · {x.subject}</p>
                  <p className="text-xs text-muted-foreground">{t(`helpdesk.categories.${x.category}`)}{isHr && x.employees ? ` · ${x.employees.full_name}` : ''} · {formatDateTime(x.updated_at, i18n.language)}</p>
                </div>
                <TicketBadges x={x} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Articles ──────────────────────────────────────────────────────────
function Articles() {
  const { t } = useTranslation();
  const { activeCompany, isHr } = useAuth();
  const onError = useOnError();
  const refresh = useRefresh();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<Article> | null>(null);
  const [deleting, setDeleting] = useState<Article | null>(null);
  const articles = useQuery({
    queryKey: ['helpdesk', 'articles', activeCompany?.id],
    enabled: Boolean(activeCompany),
    queryFn: async () => unwrap(await sb().from('hr_articles').select('*').eq('company_id', activeCompany!.id).order('title')) as Article[],
  });
  const rows = (articles.data ?? []).filter((a) => !search || `${a.title} ${a.body}`.toLowerCase().includes(search.toLowerCase()));
  const save = useMutation({
    mutationFn: async (a: Partial<Article>) => {
      const row = { title: a.title!.trim(), body: a.body!.trim(), category: a.category ?? 'policy', published: a.published ?? true };
      return a.id
        ? unwrap(await sb().from('hr_articles').update(row).eq('id', a.id).select('id').single())
        : unwrap(await sb().from('hr_articles').insert({ ...row, company_id: activeCompany!.id }).select('id').single());
    },
    onSuccess: async () => {
      toast.success(t('common.saved'));
      setEditing(null);
      await refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from('hr_articles').delete().eq('id', id).select('id')),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
    },
    onError,
  });
  const valid = (editing?.title?.trim().length ?? 0) >= 3 && Boolean(editing?.body?.trim());

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input type="search" aria-label={t('common.search')} placeholder={t('helpdesk.searchArticles')} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        {isHr && <Button size="sm" onClick={() => setEditing({ category: 'policy', published: true, title: '', body: '' })}><Plus />{t('helpdesk.newArticle')}</Button>}
      </div>
      {articles.isPending ? <ListSkeleton rows={3} /> : articles.isError ? <ErrorState error={articles.error} onRetry={() => void articles.refetch()} /> : !rows.length ? <EmptyState icon={BookOpen} title={t('helpdesk.noArticles')} /> : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id}>
              <Card>
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-semibold">
                    <span className="min-w-0 flex-1 break-words">{a.title}</span>
                    <Badge tone="outline">{t(`helpdesk.categories.${a.category}`)}</Badge>
                    {!a.published && <Badge tone="warning">{t('helpdesk.draft')}</Badge>}
                  </summary>
                  <div className="space-y-3 border-t px-4 py-3">
                    <p className="whitespace-pre-wrap break-words text-sm">{a.body}</p>
                    {isHr && (
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setEditing(a)}><Pencil />{t('common.edit')}</Button>
                        <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onClick={() => setDeleting(a)}><Trash2 /></Button>
                      </div>
                    )}
                  </div>
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <FormDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} size="lg" title={editing?.id ? t('common.edit') : t('helpdesk.newArticle')} description={t('helpdesk.articleHint')}>
        {editing && (
          <form onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(editing); }} className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="space-y-4">
              <TextField label={t('helpdesk.articleTitle')} required maxLength={150} value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              <SelectField label={t('helpdesk.category')} value={editing.category ?? 'policy'} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {ARTICLE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`helpdesk.categories.${c}`)}</option>)}
              </SelectField>
              <TextareaField label={t('helpdesk.articleBody')} required rows={10} maxLength={20000} value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              <CheckField label={t('helpdesk.publish')} checked={editing.published ?? true} onChange={(e) => setEditing({ ...editing, published: e.target.checked })} />
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
              <Button type="submit" loading={save.isPending} disabled={!valid}>{t('common.save')}</Button>
            </DialogFooter>
          </form>
        )}
      </FormDialog>
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={t('common.delete')} description={deleting?.title ?? ''} confirmLabel={t('common.delete')} destructive loading={remove.isPending} onConfirm={() => deleting && remove.mutate(deleting.id)} />
    </div>
  );
}

export function HelpdeskPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'tickets';
  const [asking, setAsking] = useState(false);
  return (
    <>
      <PageHeader title={t('helpdesk.title')} description={t('helpdesk.subtitle')} actions={<Button onClick={() => setAsking(true)}><MessageSquarePlus />{t('helpdesk.ask')}</Button>} />
      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="tickets">{t('helpdesk.tickets')}</TabsTrigger>
          <TabsTrigger value="articles">{t('helpdesk.articles')}</TabsTrigger>
        </TabsList>
        <TabsContent value="tickets"><Tickets /></TabsContent>
        <TabsContent value="articles"><Articles /></TabsContent>
      </Tabs>
      <NewTicketDialog open={asking} onClose={() => setAsking(false)} />
    </>
  );
}

// ── One ticket ────────────────────────────────────────────────────────
export function HrTicketPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id } = useParams();
  const { activeCompany, isHr } = useAuth();
  const hrMembers = useHrMembers(isHr ? activeCompany?.id : undefined);
  const onError = useOnError();
  const refresh = useRefresh();
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const ticket = useQuery({
    queryKey: ['helpdesk', 'ticket', id],
    queryFn: async () => unwrap(await sb().from('hr_tickets').select('*, employees(full_name, employee_code)').eq('id', id!).single()) as unknown as HrTicket,
  });
  const messages = useQuery({
    queryKey: ['helpdesk', 'messages', id],
    queryFn: async () => unwrap(await sb().from('hr_ticket_messages').select('*').eq('ticket_id', id!).order('created_at')) as Message[],
  });
  const send = useMutation({
    mutationFn: async () => unwrap(await sb().from('hr_ticket_messages').insert({ ticket_id: id!, company_id: ticket.data!.company_id, body: reply.trim(), internal: isHr && internal }).select('id').single()),
    onSuccess: async () => {
      setReply('');
      setInternal(false);
      await refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: async (patch: Partial<Pick<HrTicket, 'status' | 'priority' | 'assigned_to'>>) => unwrap(await sb().from('hr_tickets').update(patch).eq('id', id!).select('id').single()),
    onSuccess: async () => {
      toast.success(t('common.saved'));
      await refresh();
    },
    onError,
  });

  const back = <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2"><Link to="/portal/helpdesk"><ArrowLeft />{t('helpdesk.back')}</Link></Button>;
  if (ticket.isPending) return <>{back}<ListSkeleton rows={6} /></>;
  if (ticket.isError || !ticket.data) return <>{back}<ErrorState error={ticket.error} /></>;
  const x = ticket.data;
  const closed = x.status === 'closed';

  return (
    <div className="mx-auto max-w-3xl">
      {back}
      <Card className="mb-4">
        <CardContent className="space-y-3 pt-5">
          <h1 className="break-words text-xl font-bold">#{x.ticket_no} · {x.subject}</h1>
          <p className="text-sm text-muted-foreground">{t(`helpdesk.categories.${x.category}`)}{x.employees ? ` · ${x.employees.full_name} (${x.employees.employee_code})` : ''} · {formatDateTime(x.created_at, lang)}</p>
          <TicketBadges x={x} />
          {x.due_at && !x.first_response_at && !closed && <p className="text-xs text-muted-foreground">{t('helpdesk.answerBy', { date: formatDateTime(x.due_at, lang) })}</p>}
          {isHr ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField label={t('crm.status')} value={x.status} onChange={(e) => update.mutate({ status: e.target.value as TicketStatus })}>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{t(`helpdesk.statuses.${s}`)}</option>)}
              </SelectField>
              <SelectField label={t('helpdesk.priority')} value={x.priority} onChange={(e) => update.mutate({ priority: e.target.value as TicketPriority })}>
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(`helpdesk.priorities.${p}`)}</option>)}
              </SelectField>
              <SelectField label={t('helpdesk.assignee')} value={x.assigned_to ?? ''} onChange={(e) => update.mutate({ assigned_to: e.target.value || null })}>
                <option value="">{t('alerts.unassigned')}</option>
                {(hrMembers.data ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.email}</option>)}
              </SelectField>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {!closed && <Button variant="outline" size="sm" loading={update.isPending} onClick={() => update.mutate({ status: 'closed' })}>{t('helpdesk.close')}</Button>}
              {x.status === 'resolved' && <Button variant="outline" size="sm" onClick={() => update.mutate({ status: 'open' })}>{t('helpdesk.reopen')}</Button>}
            </div>
          )}
        </CardContent>
      </Card>

      {messages.isPending ? <ListSkeleton rows={3} /> : messages.isError ? <ErrorState error={messages.error} /> : (
        <ul className="space-y-3">
          {messages.data!.map((m) => (
            <li key={m.id} className={cn('rounded-xl border p-3 text-sm', m.internal ? 'border-warning/40 bg-warning/10' : m.from_hr ? 'bg-primary/5 sm:ml-8' : 'bg-card sm:mr-8')}>
              <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{m.from_hr || m.internal ? t('helpdesk.hrTeam') : x.employees?.full_name}</span>
                {formatDateTime(m.created_at, lang)}
                {m.internal && <Badge tone="warning"><Lock className="size-3" aria-hidden />{t('helpdesk.internal')}</Badge>}
              </p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ul>
      )}

      {closed ? <p className="mt-4 rounded-lg bg-muted p-3 text-sm">{t('helpdesk.closedNote')}</p> : (
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) send.mutate(); }}>
          <Textarea aria-label={t('helpdesk.reply')} placeholder={t('helpdesk.reply')} rows={4} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {isHr ? <CheckField label={t('helpdesk.internalHint')} checked={internal} onChange={(e) => setInternal(e.target.checked)} /> : <span />}
            <Button type="submit" loading={send.isPending} disabled={!reply.trim()}><Send />{t('helpdesk.send')}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
