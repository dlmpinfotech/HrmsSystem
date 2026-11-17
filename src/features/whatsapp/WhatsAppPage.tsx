import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDashed, Copy, ExternalLink, Inbox, Send, Settings2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Avatar, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { WhatsAppIcon } from '@/components/shared/brand';
import { EmptyState } from '@/components/shared/states';
import { PageHeader } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { usePublicConfig } from '@/hooks/usePublicConfig';
import { api, errorKey } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { WhatsAppConversation, WhatsAppMessage } from '@/types/db';
import { formatPhone } from '@shared/phone';
import { buildWhatsAppLink, whatsAppMessage, type WhatsAppIntent } from '@shared/whatsapp';

interface WaStatus {
  enabled: boolean;
  webhook_url: string;
  config: Record<'access_token' | 'phone_number_id' | 'business_account_id' | 'verify_token' | 'app_secret' | 'can_send' | 'can_receive', boolean> & { phone_number_id_hint: string | null };
}

const WINDOW_MS = 24 * 3_600_000;

function Inbox_() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { can } = useAuth();
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const conversations = useQuery({
    queryKey: ['wa-conversations'],
    refetchInterval: 20_000,
    queryFn: async () => unwrap(await sb().from('whatsapp_conversations').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(200)) as WhatsAppConversation[],
  });
  const messages = useQuery({
    queryKey: ['wa-messages', selected],
    enabled: Boolean(selected),
    refetchInterval: 10_000,
    queryFn: async () => unwrap(await sb().from('whatsapp_messages').select('*').eq('conversation_id', selected!).order('created_at').limit(500)) as WhatsAppMessage[],
  });
  const conv = conversations.data?.find((c) => c.id === selected);
  const windowOpen = Boolean(conv?.last_inbound_at && Date.now() - new Date(conv.last_inbound_at).getTime() < WINDOW_MS);

  useEffect(() => {
    if (!selected || !conv?.unread_count) return;
    void sb().from('whatsapp_conversations').update({ unread_count: 0 }).eq('id', selected).then(() => qc.invalidateQueries({ queryKey: ['wa-conversations'] }));
  }, [selected, conv?.unread_count, qc]);
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [messages.data?.length]);

  const send = useMutation({
    mutationFn: () => api('/whatsapp', { method: 'POST', body: { conversation_id: selected, body: text } }),
    onSuccess: async () => {
      setText('');
      await qc.invalidateQueries({ queryKey: ['wa-messages', selected] });
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  if (conversations.data?.length === 0) return <EmptyState icon={Inbox} title={t('whatsapp.noConversations')} description={t('whatsapp.noConversationsBody')} />;
  return (
    <div className="grid min-h-[520px] overflow-hidden rounded-xl border bg-card md:grid-cols-[300px_1fr]">
      <ul className={cn('scroll-thin max-h-[640px] divide-y overflow-y-auto border-r', selected && 'hidden md:block')}>
        {conversations.data?.map((c) => (
          <li key={c.id}>
            <button onClick={() => setSelected(c.id)} className={cn('flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted/60', selected === c.id && 'bg-muted')}>
              <Avatar name={c.contact_name ?? c.wa_phone} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.contact_name ?? formatPhone(c.wa_phone)}</p>
                <p className="truncate text-xs text-muted-foreground">{formatRelative(c.last_message_at, i18n.language)}</p>
              </div>
              {c.unread_count > 0 && <span className="rounded-full bg-whatsapp px-2 py-0.5 text-xs font-bold text-[#062b14]">{c.unread_count}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className={cn('flex min-h-0 flex-col', !selected && 'hidden md:flex')}>
        {!conv ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{t('whatsapp.pickConversation')}</div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b px-4 py-3">
              <Button variant="ghost" size="sm" className="md:hidden" onClick={() => setSelected(null)}>←</Button>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{conv.contact_name ?? formatPhone(conv.wa_phone)}</p>
                <p className="text-xs text-muted-foreground">{formatPhone(conv.wa_phone)}</p>
              </div>
              {conv.lead_id && <Button variant="outline" size="sm" asChild><Link to={`/admin/leads/${conv.lead_id}`}>{t('demos.openLead')}</Link></Button>}
            </div>
            <div className="scroll-thin max-h-[480px] flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
              {messages.data?.map((m) => (
                <div key={m.id} className={cn('flex', m.direction === 'outbound' && 'justify-end')}>
                  <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm', m.direction === 'outbound' ? 'bg-[#d9fdd3] text-slate-900' : 'bg-card')}>
                    {m.template_name && <p className="mb-0.5 text-[10px] font-semibold uppercase opacity-60">{t('whatsapp.template')}: {m.template_name}</p>}
                    <p className="whitespace-pre-wrap">{m.body ?? `[${m.type}]`}</p>
                    <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-60">{formatDateTime(m.created_at, i18n.language)}{m.direction === 'outbound' && <> · {t(`status.${m.status}`, { defaultValue: m.status })}</>}</p>
                    {m.error && <p className="text-[10px] text-destructive">{m.error}</p>}
                  </div>
                </div>
              ))}
              <div ref={bottom} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }} className="space-y-2 border-t p-3">
              {!windowOpen && <p className="flex items-center gap-2 text-xs text-warning"><TriangleAlert className="size-3.5" />{t('whatsapp.windowClosed')}</p>}
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="wa-reply">{t('support.reply')}</label>
                <Textarea id="wa-reply" rows={2} value={text} onChange={(e) => setText(e.target.value)} disabled={!windowOpen || !can('whatsapp.send')} maxLength={4000} className="min-h-0 flex-1" />
                <Button type="submit" size="icon" aria-label={t('support.send')} disabled={!windowOpen || !text.trim()} loading={send.isPending}><Send /></Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function SetupChecklist({ status }: { status: WaStatus | undefined }) {
  const { t } = useTranslation();
  const items: { key: keyof WaStatus['config']; env: string }[] = [
    { key: 'access_token', env: 'META_WHATSAPP_ACCESS_TOKEN' },
    { key: 'phone_number_id', env: 'META_WHATSAPP_PHONE_NUMBER_ID' },
    { key: 'business_account_id', env: 'META_WHATSAPP_BUSINESS_ACCOUNT_ID' },
    { key: 'verify_token', env: 'META_WHATSAPP_VERIFY_TOKEN' },
    { key: 'app_secret', env: 'META_APP_SECRET' },
  ];
  const steps = t('whatsapp.setupSteps', { returnObjects: true }) as string[];
  const copy = (v: string) => void navigator.clipboard.writeText(v).then(() => toast.success(t('common.copied')));
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>{t('whatsapp.serverConfig')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.key} className="flex items-center gap-2 text-sm">
                {status?.config[i.key] ? <CheckCircle2 className="size-4 text-success" aria-label={t('common.yes')} /> : <CircleDashed className="size-4 text-muted-foreground" aria-label={t('common.no')} />}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{i.env}</code>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t('whatsapp.secretsNote')}</p>
          {status && (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('whatsapp.webhookUrl')}</p>
              <div className="flex gap-2"><code className="flex-1 break-all rounded-md bg-muted px-2 py-2 text-xs">{status.webhook_url}</code><Button variant="outline" size="icon-sm" aria-label={t('common.copy')} onClick={() => copy(status.webhook_url)}><Copy /></Button></div>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-sm">
            <Settings2 className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{status?.enabled ? t('whatsapp.sendingOn') : t('whatsapp.sendingOff')}</span>
            <Button variant="link" asChild><Link to="/admin/settings">{t('nav.settings')}</Link></Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('whatsapp.setupTitle')}</CardTitle></CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm">{Array.isArray(steps) && steps.map((s) => <li key={s}>{s}</li>)}</ol>
          <p className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">{t('whatsapp.costNote')}</p>
          <Button variant="link" asChild className="mt-2"><a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer">{t('whatsapp.metaDocs')}<ExternalLink /></a></Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ClickToChat() {
  const { t, i18n } = useTranslation();
  const config = usePublicConfig();
  const intents: WhatsAppIntent[] = ['product_enquiry', 'demo_booking', 'sales_support', 'customer_support', 'pricing'];
  const rows = useMemo(
    () => intents.map((i) => ({ intent: i, link: buildWhatsAppLink(config.whatsapp.number, whatsAppMessage(i, i18n.language === 'ta' ? 'ta' : 'en', { brand: config.brand.name, plan: 'Business', company: 'Your Company' })) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, i18n.language],
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><WhatsAppIcon className="text-whatsapp" />{t('whatsapp.clickToChat')}</CardTitle>
        <p className="text-sm text-muted-foreground">{config.whatsapp.number ? t('whatsapp.clickToChatOn', { number: formatPhone(config.whatsapp.number) }) : t('whatsapp.clickToChatOff')}</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.intent} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="w-44 font-medium">{t(`whatsapp.intent.${r.intent}`)}</span>
              {r.link ? <a href={r.link} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-xs text-primary hover:underline">{r.link}</a> : <span className="text-xs text-muted-foreground">—</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function WhatsAppPage() {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ['wa-status'], queryFn: () => api<WaStatus>('/whatsapp'), retry: false });
  return (
    <>
      <PageHeader title={t('whatsapp.title')} description={t('whatsapp.subtitle')} actions={<Badge tone={status.data?.enabled && status.data.config.can_send ? 'success' : 'warning'}>{status.data?.enabled && status.data.config.can_send ? t('whatsapp.apiLive') : t('whatsapp.apiOff')}</Badge>} />
      <Tabs defaultValue="inbox">
        <TabsList>
          <TabsTrigger value="inbox"><Inbox />{t('whatsapp.inbox')}</TabsTrigger>
          <TabsTrigger value="click">{t('whatsapp.clickToChat')}</TabsTrigger>
          <TabsTrigger value="setup"><Settings2 />{t('whatsapp.setup')}</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox"><Inbox_ /></TabsContent>
        <TabsContent value="click"><ClickToChat /></TabsContent>
        <TabsContent value="setup"><SetupChecklist status={status.data} /></TabsContent>
      </Tabs>
      {status.isError && <p className="mt-4 text-sm text-muted-foreground">{t(errorKey(status.error))}</p>}
    </>
  );
}
