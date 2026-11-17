import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, FileText, Mail, RefreshCw, Send, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Select } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { WhatsAppIcon } from '@/components/shared/brand';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { CheckField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, QueryState } from '@/components/shared/states';
import { FormDialog, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorKey } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import type { NotificationLog, NotificationTemplate } from '@/types/db';
import { NOTIFICATION_KEYS } from '@shared/constants';
import { extractVariables, renderTemplate } from '@shared/templates';

interface ChannelStatus {
  email: { enabled: boolean; configured: boolean; provider: string };
  whatsapp: { enabled: boolean; configured: boolean };
}

function ChannelCard({ icon, title, enabled, configured, hint }: { icon: React.ReactNode; title: string; enabled: boolean; configured: boolean; hint: string }) {
  const { t } = useTranslation();
  const ok = enabled && configured;
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">{title}<Badge tone={ok ? 'success' : 'warning'}>{ok ? t('notifications.active') : !configured ? t('notifications.notConfigured') : t('notifications.disabled')}</Badge></p>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
    </Card>
  );
}

const SAMPLE: Record<string, string> = {
  name: 'Priya', brand: 'HRMS Cloud', company: 'Sri Murugan Textiles', date: 'Monday, 1 Dec 2026', time: '11:00 AM', mode: 'online', meeting_line: 'Link: https://meet.example.com/abc',
  manage_url: 'https://example.com/demo/manage/…', demo_url: 'https://example.com/book-demo', when: 'tomorrow', plan: 'Business', trial_end: '15 Dec 2026', portal_url: 'https://example.com/portal',
  renewal_date: '1 Jan 2027', amount: '₹2,499', invoice_number: 'INV-202612-00001', ticket_number: 'TKT-000123', ticket_subject: 'Payslip format', status: 'in progress', message: 'We have updated your payslip template.',
  contact: 'Priya', phone: '+91 98765 43210', due: '1 Dec 2026, 10:00 AM', lead_url: 'https://example.com/admin/leads/…',
};

function TemplateEditor({ template, onClose }: { template: NotificationTemplate; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [form, setForm] = useState({ name: template.name, subject: template.subject ?? '', body: template.body, whatsapp_template_name: template.whatsapp_template_name ?? '', is_active: template.is_active });
  const [testTo, setTestTo] = useState('');
  const vars = useMemo(() => [...new Set([...extractVariables(form.body), ...extractVariables(form.subject)])], [form.body, form.subject]);
  const unknown = vars.filter((v) => !(v in SAMPLE));
  const save = useMutation({
    mutationFn: async () => unwrap(await sb().from('notification_templates').update({ ...form, subject: form.subject || null, whatsapp_template_name: form.whatsapp_template_name || null }).eq('id', template.id).select('id').single()),
    onSuccess: async () => {
      toast.success(t('common.saved'));
      await qc.invalidateQueries({ queryKey: ['templates'] });
      onClose();
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; result: { status: string; error?: string } | null }>('/notifications', { method: 'POST', body: { action: 'test_email', key: template.key, to: testTo, language: template.language } }),
    onSuccess: (res) => (res.ok ? toast.success(t('notifications.testSent')) : toast.error(t('notifications.testFailed', { reason: res.result?.error ?? res.result?.status ?? '' }))),
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={template.name} description={`${template.key} · ${template.channel} · ${template.language.toUpperCase()}`} size="xl">
      <DialogBody>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <TextField label={t('notifications.templateName')} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            {template.channel === 'email' && <TextField label={t('notifications.subject')} value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />}
            <TextareaField label={t('notifications.body')} rows={10} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} className="font-mono" />
            {template.channel === 'whatsapp' && <TextField label={t('notifications.metaTemplate')} hint={t('notifications.metaTemplateHint')} value={form.whatsapp_template_name} onChange={(e) => setForm((f) => ({ ...f, whatsapp_template_name: e.target.value }))} />}
            <CheckField label={t('common.active')} checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
            <div className="flex flex-wrap gap-1.5 text-xs">{vars.map((v) => <Badge key={v} tone={v in SAMPLE ? 'outline' : 'warning'}>{`{{${v}}}`}</Badge>)}</div>
            {unknown.length > 0 && <p className="text-xs text-warning">{t('notifications.unknownVars', { vars: unknown.join(', ') })}</p>}
            {template.channel === 'whatsapp' && <p className="text-xs text-muted-foreground">{t('notifications.whatsappOrder', { vars: template.variables.join(', ') })}</p>}
          </div>
          <div className="space-y-3">
            <p className="text-sm font-medium">{t('notifications.preview')}</p>
            <div className="rounded-xl border bg-muted/40 p-4 text-sm">
              {template.channel === 'email' && <p className="mb-2 border-b pb-2 font-semibold">{renderTemplate(form.subject, SAMPLE)}</p>}
              <p className="whitespace-pre-wrap">{renderTemplate(form.body, SAMPLE)}</p>
            </div>
            {template.channel === 'email' && can('notifications.manage') && (
              <div className="flex items-end gap-2">
                <TextField label={t('notifications.sendTestTo')} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} className="flex-1" />
                <Button variant="outline" disabled={!testTo} loading={test.isPending} onClick={() => test.mutate()}><Send />{t('notifications.sendTest')}</Button>
              </div>
            )}
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
        {can('notifications.manage') && <Button loading={save.isPending} disabled={!form.body.trim()} onClick={() => save.mutate()}>{t('common.save')}</Button>}
      </DialogFooter>
    </FormDialog>
  );
}

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [channel, setChannel] = useState('');
  const [logStatus, setLogStatus] = useState('');
  const status = useQuery({ queryKey: ['notification-status'], queryFn: () => api<ChannelStatus>('/notifications'), retry: false });
  const templates = useQuery({ queryKey: ['templates'], queryFn: async () => unwrap(await sb().from('notification_templates').select('*').order('key').order('channel').order('language')) as NotificationTemplate[] });
  const logs = useQuery({
    queryKey: ['notification-logs', logStatus],
    refetchInterval: 30_000,
    queryFn: async () => {
      let q = sb().from('notification_logs').select('*').order('created_at', { ascending: false }).limit(300);
      if (logStatus) q = q.eq('status', logStatus);
      return unwrap(await q) as NotificationLog[];
    },
  });
  const retry = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean; result: { status: string; error?: string } }>('/notifications', { method: 'POST', body: { action: 'retry', log_id: id } }),
    onSuccess: async (res) => {
      if (res.ok) toast.success(t('notifications.retried'));
      else toast.error(t('notifications.testFailed', { reason: res.result.error ?? res.result.status }));
      await qc.invalidateQueries({ queryKey: ['notification-logs'] });
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });
  const runJobs = useMutation({
    mutationFn: () => api<{ summary: Record<string, unknown> }>('/notifications', { method: 'POST', body: { action: 'run_jobs' } }),
    onSuccess: (res) => toast.success(t('notifications.jobsRan', { summary: JSON.stringify(res.summary) })),
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  const filteredTemplates = (templates.data ?? []).filter((tpl) => !channel || tpl.channel === channel);
  const templateCols: Column<NotificationTemplate>[] = [
    { key: 'name', header: t('notifications.templateName'), primary: true, cell: (tpl) => <div><p className="font-semibold">{tpl.name}</p><p className="text-xs text-muted-foreground">{t(`notificationKey.${tpl.key}`, { defaultValue: tpl.key })}</p></div> },
    { key: 'channel', header: t('notifications.channel'), cell: (tpl) => <Badge tone={tpl.channel === 'email' ? 'info' : 'success'}>{tpl.channel === 'email' ? 'Email' : 'WhatsApp'}</Badge> },
    { key: 'lang', header: t('notifications.language'), cell: (tpl) => (tpl.language === 'ta' ? 'தமிழ்' : 'English') },
    { key: 'active', header: t('common.active'), cell: (tpl) => (tpl.is_active ? <CheckCircle2 className="size-4 text-success" aria-label={t('common.yes')} /> : <span className="text-muted-foreground">{t('common.no')}</span>) },
  ];
  const logCols: Column<NotificationLog>[] = [
    { key: 'when', header: t('notifications.when'), primary: true, cell: (l) => formatDateTime(l.created_at, i18n.language) },
    { key: 'key', header: t('notifications.type'), cell: (l) => t(`notificationKey.${l.template_key}`, { defaultValue: l.template_key }) },
    { key: 'channel', header: t('notifications.channel'), cell: (l) => (l.channel === 'email' ? 'Email' : 'WhatsApp') },
    { key: 'to', header: t('notifications.recipient'), cell: (l) => <span className="break-all text-xs">{l.recipient}</span> },
    { key: 'status', header: t('crm.status'), cell: (l) => <StatusBadge value={l.status} /> },
    { key: 'error', header: t('notifications.error'), cell: (l) => (l.error ? <span className="line-clamp-2 text-xs text-destructive" title={l.error}>{t(`notificationError.${l.error}`, { defaultValue: l.error })}</span> : '—'), hideOnMobile: true },
    { key: 'attempts', header: t('notifications.attempts'), align: 'right', cell: (l) => l.attempts },
    {
      key: 'retry', header: '', cell: (l) =>
        can('notifications.manage') && ['failed', 'skipped'].includes(l.status) ? (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); retry.mutate(l.id); }} loading={retry.isPending && retry.variables === l.id}><RefreshCw />{t('notifications.retry')}</Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t('notifications.title')} description={t('notifications.subtitle')} actions={can('settings.manage') ? <Button variant="outline" size="sm" loading={runJobs.isPending} onClick={() => runJobs.mutate()}><RefreshCw />{t('notifications.runJobs')}</Button> : undefined} />
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        <ChannelCard icon={<Mail className="size-5 text-primary" />} title={t('notifications.email')} enabled={status.data?.email.enabled ?? false} configured={status.data?.email.configured ?? false} hint={status.data?.email.configured ? t('notifications.emailProvider', { provider: status.data.email.provider }) : t('notifications.emailSetup')} />
        <ChannelCard icon={<WhatsAppIcon className="text-whatsapp" />} title={t('notifications.whatsappApi')} enabled={status.data?.whatsapp.enabled ?? false} configured={status.data?.whatsapp.configured ?? false} hint={t('notifications.whatsappHint')} />
      </div>
      {status.isError && <p className="mb-4 flex items-center gap-2 rounded-lg bg-warning/10 p-3 text-sm"><TriangleAlert className="size-4 text-warning" />{t(errorKey(status.error))}</p>}
      <Tabs defaultValue="logs">
        <TabsList>
          <TabsTrigger value="logs"><Send />{t('notifications.logs')}</TabsTrigger>
          <TabsTrigger value="templates"><FileText />{t('notifications.templates')}</TabsTrigger>
        </TabsList>
        <TabsContent value="logs">
          <Select aria-label={t('crm.status')} value={logStatus} onChange={(e) => setLogStatus(e.target.value)} className="mb-3 sm:w-48">
            <option value="">{t('notifications.allStatuses')}</option>
            {['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </Select>
          <QueryState query={logs} empty={<EmptyState icon={Send} title={t('notifications.noLogs')} />}>
            {(rows) => <DataTable caption={t('notifications.logs')} columns={logCols} rows={rows} rowKey={(l) => l.id} />}
          </QueryState>
        </TabsContent>
        <TabsContent value="templates">
          <Select aria-label={t('notifications.channel')} value={channel} onChange={(e) => setChannel(e.target.value)} className="mb-3 sm:w-48">
            <option value="">{t('notifications.allChannels')}</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
          </Select>
          <QueryState query={templates}>
            {() => <DataTable caption={t('notifications.templates')} columns={templateCols} rows={filteredTemplates} rowKey={(tpl) => tpl.id} onRowClick={setEditing} />}
          </QueryState>
          <p className="mt-3 text-xs text-muted-foreground">{t('notifications.keysNote', { count: NOTIFICATION_KEYS.length })}</p>
        </TabsContent>
      </Tabs>
      {editing && <TemplateEditor key={editing.id} template={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
