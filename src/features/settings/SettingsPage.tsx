import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BookOpen, History, Megaphone, Pencil, Plus, Settings, Trash2, UserPlus, Users, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { CheckField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, QueryState } from '@/components/shared/states';
import { ConfirmDialog, FormDialog, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { youtubeId } from '@/features/content/VideoGallery';
import { useStaff, type StaffMember } from '@/hooks/useStaff';
import { api, errorKey } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import type { AuditLog, HelpArticle, MarketingCampaign, Video as VideoRow } from '@/types/db';
import { isValidIndianPhone } from '@shared/phone';

const useErr = () => {
  const { t } = useTranslation();
  return (e: unknown) => toast.error(t(errorKey(e), { defaultValue: t('errors.generic') }));
};

// ── General settings ──────────────────────────────────────────────────
type SettingsMap = Record<string, Record<string, unknown>>;

function GeneralSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useErr();
  const [s, setS] = useState<SettingsMap | null>(null);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [testimonials, setTestimonials] = useState('[]');
  const query = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => Object.fromEntries((unwrap(await sb().from('app_settings').select('key, value')) as { key: string; value: unknown }[]).map((r) => [r.key, r.value])) as Record<string, unknown>,
  });
  useEffect(() => {
    if (query.data && !s) {
      const d = query.data;
      setS({ brand: (d.brand as object) ?? {}, whatsapp: (d.whatsapp as object) ?? {}, whatsapp_cloud: (d.whatsapp_cloud as object) ?? {}, email: (d.email as object) ?? {}, demo: (d.demo as object) ?? {}, analytics: (d.analytics as object) ?? {} } as SettingsMap);
      setTestimonials(JSON.stringify(d.testimonials ?? [], null, 2));
    }
  }, [query.data, s]);
  const save = useMutation({
    mutationFn: async () => {
      let parsedTestimonials: unknown;
      try {
        parsedTestimonials = JSON.parse(testimonials);
        if (!Array.isArray(parsedTestimonials)) throw new Error();
      } catch {
        throw new Error('errors.invalidTestimonials');
      }
      const rows = [
        ...Object.entries(s!).map(([key, value]) => ({ key, value, is_public: !['whatsapp_cloud', 'email'].includes(key) })),
        { key: 'testimonials', value: parsedTestimonials, is_public: true },
      ];
      return unwrap(await sb().from('app_settings').upsert(rows, { onConflict: 'key' }).select('key'));
    },
    onSuccess: async () => {
      toast.success(t('common.saved'));
      await Promise.all([qc.invalidateQueries({ queryKey: ['app-settings'] }), qc.invalidateQueries({ queryKey: ['public-config'] }), qc.invalidateQueries({ queryKey: ['wa-status'] }), qc.invalidateQueries({ queryKey: ['notification-status'] })]);
    },
    onError,
  });
  if (!s) return <QueryState query={query}>{() => null}</QueryState>;
  const field = (group: string, key: string) => ({
    value: String(s[group]?.[key] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setS((p) => ({ ...p!, [group]: { ...p![group], [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value } })),
  });
  const toggle = (group: string, key: string, v: boolean) => setS((p) => ({ ...p!, [group]: { ...p![group], [key]: v } }));
  const waNumber = String(s.whatsapp.number ?? '');
  const gaId = String(s.analytics.ga4_measurement_id ?? '');

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('settings.brand')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <TextField label={t('settings.brandName')} {...field('brand', 'name')} />
            <TextField label={t('settings.supportEmail')} type="email" {...field('brand', 'support_email')} />
            <TextField label={t('settings.supportPhone')} type="tel" {...field('brand', 'support_phone')} />
            <TextField label={t('settings.address')} {...field('brand', 'address')} />
            <TextField label={t('settings.hrmsLoginUrl')} type="url" placeholder="https://" hint={t('settings.hrmsLoginUrlHint')} {...field('brand', 'hrms_login_url')} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('settings.whatsapp')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <TextField label={t('settings.waNumber')} type="tel" hint={t('settings.waNumberHint')} error={waNumber && !isValidIndianPhone(waNumber) ? 'validation.phone' : undefined} {...field('whatsapp', 'number')} />
            <label className="flex items-center justify-between gap-3 text-sm font-medium">{t('settings.clickToChat')}<Switch checked={Boolean(s.whatsapp.click_to_chat_enabled)} onCheckedChange={(v) => toggle('whatsapp', 'click_to_chat_enabled', v)} /></label>
            <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
              <label className="flex items-center justify-between gap-3 text-sm font-medium">
                {t('settings.cloudApi')}
                <Switch checked={Boolean(s.whatsapp_cloud.enabled)} onCheckedChange={(v) => (v ? setConfirmPaid(true) : toggle('whatsapp_cloud', 'enabled', false))} />
              </label>
              <p className="mt-1.5 text-xs text-muted-foreground">{t('settings.cloudApiHint')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('settings.demosEmail')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t('settings.minLead')} type="number" min={0} max={72} {...field('demo', 'min_lead_hours')} />
              <TextField label={t('settings.maxDays')} type="number" min={1} max={60} {...field('demo', 'max_days_ahead')} />
            </div>
            <TextField label={t('settings.defaultMeeting')} type="url" placeholder="https://meet.google.com/…" {...field('demo', 'default_meeting_url')} />
            <label className="flex items-center justify-between gap-3 text-sm font-medium">{t('settings.emailEnabled')}<Switch checked={Boolean(s.email.enabled)} onCheckedChange={(v) => toggle('email', 'enabled', v)} /></label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('settings.analytics')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <TextField label={t('settings.ga4')} placeholder="G-XXXXXXXXXX" hint={t('settings.ga4Hint')} error={gaId && !/^G-[A-Z0-9]+$/.test(gaId) ? 'validation.ga4' : undefined} {...field('analytics', 'ga4_measurement_id')} />
            <TextareaField label={t('settings.testimonials')} rows={6} className="font-mono text-xs" hint={t('settings.testimonialsHint')} value={testimonials} onChange={(e) => setTestimonials(e.target.value)} />
          </CardContent>
        </Card>
      </div>
      <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.saveChanges')}</Button></div>
      <ConfirmDialog open={confirmPaid} onOpenChange={setConfirmPaid} title={t('settings.cloudApiConfirmTitle')} description={t('settings.cloudApiConfirm')} confirmLabel={t('settings.enable')} onConfirm={() => { toggle('whatsapp_cloud', 'enabled', true); setConfirmPaid(false); }} />
    </div>
  );
}

// ── Team ──────────────────────────────────────────────────────────────
const STAFF_ROLE_KEYS = ['super_admin', 'sales_admin', 'sales_executive', 'support_executive'] as const;

function TeamSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useErr();
  const { user } = useAuth();
  const staff = useStaff();
  const [invite, setInvite] = useState({ open: false, email: '', full_name: '', role_key: 'sales_executive' });
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const team = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<{ invited?: boolean }>('/team', { method: 'POST', body }),
    onSuccess: async (res) => {
      toast.success(res?.invited ? t('team.invited') : t('common.saved'));
      setInvite((i) => ({ ...i, open: false, email: '', full_name: '' }));
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ['staff'] });
    },
    onError,
  });
  const columns: Column<StaffMember>[] = [
    { key: 'name', header: t('contacts.name'), primary: true, cell: (m) => <div><p className="font-semibold">{m.full_name || '—'}</p><p className="text-xs text-muted-foreground">{m.email}</p></div> },
    { key: 'roles', header: t('team.roles'), cell: (m) => <div className="flex flex-wrap justify-end gap-1 md:justify-start">{m.roles.map((r) => <Badge key={r} tone="primary">{t(`role.${r}`)}</Badge>)}</div> },
    { key: 'active', header: t('common.active'), cell: (m) => <Switch checked={m.is_active} disabled={m.id === user?.id} onCheckedChange={(v) => team.mutate({ action: 'set_active', user_id: m.id, is_active: v })} aria-label={t('common.active')} onClick={(e) => e.stopPropagation()} /> },
    { key: 'edit', header: '', cell: (m) => <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditing(m); setRoles(m.roles); }}><Pencil />{t('team.editRoles')}</Button> },
  ];
  return (
    <>
      <Button className="mb-4" onClick={() => setInvite((i) => ({ ...i, open: true }))}><UserPlus />{t('team.inviteStaff')}</Button>
      <QueryState query={staff}>{(rows) => <DataTable caption={t('team.title')} columns={columns} rows={rows} rowKey={(m) => m.id} />}</QueryState>
      <FormDialog open={invite.open} onOpenChange={(o) => setInvite((i) => ({ ...i, open: o }))} title={t('team.inviteStaff')} description={t('team.inviteHint')} size="sm">
        <DialogBody className="space-y-3">
          <TextField label={t('contacts.name')} value={invite.full_name} onChange={(e) => setInvite((i) => ({ ...i, full_name: e.target.value }))} />
          <TextField label={t('form.email')} type="email" value={invite.email} onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))} />
          <SelectField label={t('team.role')} value={invite.role_key} onChange={(e) => setInvite((i) => ({ ...i, role_key: e.target.value }))}>
            {STAFF_ROLE_KEYS.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </SelectField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setInvite((i) => ({ ...i, open: false }))}>{t('common.cancel')}</Button>
          <Button disabled={!invite.email || !invite.full_name} loading={team.isPending} onClick={() => team.mutate({ action: 'invite', email: invite.email, full_name: invite.full_name, role_key: invite.role_key, company_id: null })}>{t('team.sendInvite')}</Button>
        </DialogFooter>
      </FormDialog>
      <FormDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} title={t('team.editRoles')} description={editing?.email} size="sm">
        <DialogBody className="space-y-2">
          {STAFF_ROLE_KEYS.map((r) => (
            <CheckField key={r} label={<><span className="font-medium">{t(`role.${r}`)}</span><span className="block text-xs text-muted-foreground">{t(`roleDesc.${r}`)}</span></>} checked={roles.includes(r)} onChange={(e) => setRoles((cur) => (e.target.checked ? [...cur, r] : cur.filter((x) => x !== r)))} />
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button loading={team.isPending} onClick={() => editing && team.mutate({ action: 'set_roles', user_id: editing.id, roles: roles.filter((r) => (STAFF_ROLE_KEYS as readonly string[]).includes(r)) })}>{t('common.save')}</Button>
        </DialogFooter>
      </FormDialog>
    </>
  );
}

// ── Content: videos + help articles ───────────────────────────────────
const EMPTY_VIDEO = { title: '', title_ta: '', description: '', description_ta: '', url: '', provider: 'youtube', category: 'overview', audience: 'public', sort_order: 0, is_published: true };
const EMPTY_ARTICLE = { slug: '', category: 'getting_started', title: '', title_ta: '', body: '', body_ta: '', sort_order: 0, is_published: true };

function ContentSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const onError = useErr();
  const [video, setVideo] = useState<(typeof EMPTY_VIDEO & { id?: string }) | null>(null);
  const [article, setArticle] = useState<(typeof EMPTY_ARTICLE & { id?: string }) | null>(null);
  const [del, setDel] = useState<{ table: 'videos' | 'help_articles'; id: string } | null>(null);
  const videos = useQuery({ queryKey: ['admin-videos'], queryFn: async () => unwrap(await sb().from('videos').select('*').order('sort_order')) as VideoRow[] });
  const articles = useQuery({ queryKey: ['admin-articles'], queryFn: async () => unwrap(await sb().from('help_articles').select('*').order('sort_order')) as HelpArticle[] });
  const refresh = () => Promise.all(['admin-videos', 'admin-articles', 'videos', 'help-articles'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const upsert = useMutation({
    mutationFn: async ({ table, row }: { table: 'videos' | 'help_articles'; row: Record<string, unknown> }) => {
      const { id, ...rest } = row;
      const clean = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v === '' && k !== 'body' && k !== 'title' ? null : v]));
      return unwrap(id ? await sb().from(table).update(clean).eq('id', id as string).select('id').single() : await sb().from(table).insert(clean).select('id').single());
    },
    onSuccess: async () => {
      toast.success(t('common.saved'));
      setVideo(null);
      setArticle(null);
      await refresh();
    },
    onError,
  });
  const remove = useMutation({ mutationFn: async (d: { table: 'videos' | 'help_articles'; id: string }) => unwrap(await sb().from(d.table).delete().eq('id', d.id).select('id')), onSuccess: async () => { setDel(null); await refresh(); }, onError });
  const videoUrlOk = !video || video.provider !== 'youtube' || Boolean(youtubeId(video.url));
  const setV = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setVideo((v) => v && { ...v, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  const setA = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setArticle((a) => a && { ...a, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value });

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="flex items-center gap-2"><Video className="size-4" />{t('settings.videos')}</CardTitle><Button size="sm" onClick={() => setVideo({ ...EMPTY_VIDEO })}><Plus />{t('common.add')}</Button></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {videos.data?.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">{t('videos.emptyTitle')}</li>}
            {videos.data?.map((v) => (
              <li key={v.id} className="flex items-center gap-2 py-2.5 text-sm">
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{v.title}</p><p className="text-xs text-muted-foreground">{t(`videoCategory.${v.category}`, { defaultValue: v.category })} · {v.audience}{!v.is_published && ` · ${t('settings.draft')}`}</p></div>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.edit')} onClick={() => setVideo({ ...EMPTY_VIDEO, ...v, title_ta: v.title_ta ?? '', description: v.description ?? '', description_ta: v.description_ta ?? '' })}><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onClick={() => setDel({ table: 'videos', id: v.id })}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="flex items-center gap-2"><BookOpen className="size-4" />{t('settings.articles')}</CardTitle><Button size="sm" onClick={() => setArticle({ ...EMPTY_ARTICLE })}><Plus />{t('common.add')}</Button></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {articles.data?.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2.5 text-sm">
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{a.title}</p><p className="text-xs text-muted-foreground">/{a.slug}{!a.is_published && ` · ${t('settings.draft')}`}</p></div>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.edit')} onClick={() => setArticle({ ...EMPTY_ARTICLE, ...a, title_ta: a.title_ta ?? '', body_ta: a.body_ta ?? '' })}><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onClick={() => setDel({ table: 'help_articles', id: a.id })}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <FormDialog open={Boolean(video)} onOpenChange={(o) => !o && setVideo(null)} title={t('settings.video')} size="lg">
        {video && (
          <>
            <DialogBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label={t('settings.titleEn')} required value={video.title} onChange={setV('title')} />
                <TextField label={t('settings.titleTa')} lang="ta" value={video.title_ta} onChange={setV('title_ta')} />
                <SelectField label={t('settings.provider')} value={video.provider} onChange={setV('provider')}><option value="youtube">YouTube</option><option value="azure_blob">Azure Blob</option><option value="file">{t('settings.directFile')}</option></SelectField>
                <TextField label="URL" type="url" required value={video.url} onChange={setV('url')} error={video.url && !videoUrlOk ? 'validation.youtube' : undefined} hint={video.provider === 'azure_blob' ? t('settings.azureHint') : undefined} />
                <SelectField label={t('settings.category')} value={video.category} onChange={setV('category')}>{['overview', 'attendance', 'payroll', 'leave', 'mobile_app', 'reports', 'onboarding'].map((c) => <option key={c} value={c}>{t(`videoCategory.${c}`)}</option>)}</SelectField>
                <SelectField label={t('settings.audience')} value={video.audience} onChange={setV('audience')}><option value="public">{t('settings.audiencePublic')}</option><option value="customer">{t('settings.audienceCustomer')}</option></SelectField>
              </div>
              <TextareaField label={t('settings.descriptionEn')} rows={2} value={video.description} onChange={setV('description')} />
              <TextareaField label={t('settings.descriptionTa')} lang="ta" rows={2} value={video.description_ta} onChange={setV('description_ta')} />
              <div className="flex flex-wrap items-end gap-4"><TextField label={t('plans.sortOrder')} type="number" value={String(video.sort_order)} onChange={setV('sort_order')} className="w-32" /><CheckField label={t('settings.published')} checked={video.is_published} onChange={setV('is_published')} /></div>
            </DialogBody>
            <DialogFooter><Button variant="outline" onClick={() => setVideo(null)}>{t('common.cancel')}</Button><Button disabled={!video.title || !video.url || !videoUrlOk} loading={upsert.isPending} onClick={() => upsert.mutate({ table: 'videos', row: video })}>{t('common.save')}</Button></DialogFooter>
          </>
        )}
      </FormDialog>
      <FormDialog open={Boolean(article)} onOpenChange={(o) => !o && setArticle(null)} title={t('settings.article')} size="xl">
        {article && (
          <>
            <DialogBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField label={t('settings.slug')} required value={article.slug} onChange={(e) => setArticle((a) => a && { ...a, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
                <SelectField label={t('settings.category')} value={article.category} onChange={setA('category')}>{['getting_started', 'billing', 'support', 'payroll', 'attendance', 'account'].map((c) => <option key={c} value={c}>{t(`helpCategory.${c}`)}</option>)}</SelectField>
                <TextField label={t('plans.sortOrder')} type="number" value={String(article.sort_order)} onChange={setA('sort_order')} />
                <TextField label={t('settings.titleEn')} required value={article.title} onChange={setA('title')} className="sm:col-span-3" />
                <TextField label={t('settings.titleTa')} lang="ta" value={article.title_ta} onChange={setA('title_ta')} className="sm:col-span-3" />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <TextareaField label={t('settings.bodyEn')} required rows={10} value={article.body} onChange={setA('body')} />
                <TextareaField label={t('settings.bodyTa')} lang="ta" rows={10} value={article.body_ta} onChange={setA('body_ta')} />
              </div>
              <CheckField label={t('settings.published')} checked={article.is_published} onChange={setA('is_published')} />
            </DialogBody>
            <DialogFooter><Button variant="outline" onClick={() => setArticle(null)}>{t('common.cancel')}</Button><Button disabled={!article.slug || !article.title || !article.body} loading={upsert.isPending} onClick={() => upsert.mutate({ table: 'help_articles', row: article })}>{t('common.save')}</Button></DialogFooter>
          </>
        )}
      </FormDialog>
      <ConfirmDialog open={Boolean(del)} onOpenChange={(o) => !o && setDel(null)} title={t('common.delete')} description={t('settings.deleteConfirm')} confirmLabel={t('common.delete')} destructive loading={remove.isPending} onConfirm={() => del && remove.mutate(del)} />
    </div>
  );
}

// ── Marketing campaigns ───────────────────────────────────────────────
const EMPTY_CAMPAIGN = { name: '', channel: 'google_ads', utm_code: '', status: 'draft', budget: '', start_date: '', end_date: '', notes: '' };

export function CampaignsSettings() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const onError = useErr();
  const [form, setForm] = useState<(typeof EMPTY_CAMPAIGN & { id?: string }) | null>(null);
  const query = useQuery({ queryKey: ['campaigns'], queryFn: async () => unwrap(await sb().from('marketing_campaigns').select('*').order('created_at', { ascending: false })) as MarketingCampaign[] });
  const counts = useQuery({ queryKey: ['campaign-leads'], queryFn: async () => unwrap(await sb().from('leads').select('campaign_id, status').not('campaign_id', 'is', null)) as { campaign_id: string; status: string }[] });
  const save = useMutation({
    mutationFn: async () => {
      const { id, ...rest } = form!;
      const row = { ...rest, utm_code: rest.utm_code || null, budget: rest.budget === '' ? null : Number(rest.budget), start_date: rest.start_date || null, end_date: rest.end_date || null, notes: rest.notes || null };
      return unwrap(id ? await sb().from('marketing_campaigns').update(row).eq('id', id).select('id').single() : await sb().from('marketing_campaigns').insert(row).select('id').single());
    },
    onSuccess: async () => { toast.success(t('common.saved')); setForm(null); await qc.invalidateQueries({ queryKey: ['campaigns'] }); },
    onError,
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => f && { ...f, [k]: e.target.value });
  const cols: Column<MarketingCampaign>[] = [
    { key: 'name', header: t('contacts.name'), primary: true, cell: (c) => <div><p className="font-semibold">{c.name}</p>{c.utm_code && <p className="text-xs text-muted-foreground">utm_campaign={c.utm_code}</p>}</div> },
    { key: 'channel', header: t('settings.channel'), cell: (c) => t(`source.${c.channel}`, { defaultValue: c.channel }) },
    { key: 'status', header: t('crm.status'), cell: (c) => <StatusBadge value={c.status} /> },
    { key: 'leads', header: t('reports.leads'), align: 'right', cell: (c) => counts.data?.filter((l) => l.campaign_id === c.id).length ?? 0 },
    { key: 'won', header: t('reports.won'), align: 'right', cell: (c) => counts.data?.filter((l) => l.campaign_id === c.id && l.status === 'won').length ?? 0 },
    { key: 'budget', header: t('settings.budget'), align: 'right', cell: (c) => (c.budget !== null ? new Intl.NumberFormat(i18n.language === 'ta' ? 'ta-IN' : 'en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(c.budget) : '—') },
  ];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('settings.campaignsHint')}</p>
        <Button onClick={() => setForm({ ...EMPTY_CAMPAIGN })}><Plus />{t('settings.newCampaign')}</Button>
      </div>
      <QueryState query={query} empty={<EmptyState icon={Megaphone} title={t('settings.noCampaigns')} />}>
        {(rows) => <DataTable caption={t('settings.campaigns')} columns={cols} rows={rows} rowKey={(c) => c.id} onRowClick={(c) => setForm({ ...EMPTY_CAMPAIGN, ...c, id: c.id, utm_code: c.utm_code ?? '', budget: c.budget === null ? '' : String(c.budget), start_date: c.start_date ?? '', end_date: c.end_date ?? '', notes: c.notes ?? '' })} />}
      </QueryState>
      <FormDialog open={Boolean(form)} onOpenChange={(o) => !o && setForm(null)} title={t('settings.campaign')}>
        {form && (
          <>
            <DialogBody className="space-y-3">
              <TextField label={t('contacts.name')} required value={form.name} onChange={set('name')} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label={t('settings.channel')} value={form.channel} onChange={set('channel')}>{['google_ads', 'facebook', 'instagram', 'whatsapp', 'exhibition', 'referral', 'other'].map((c) => <option key={c} value={c}>{t(`source.${c}`)}</option>)}</SelectField>
                <SelectField label={t('crm.status')} value={form.status} onChange={set('status')}>{['draft', 'active', 'paused', 'completed'].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</SelectField>
                <TextField label={t('settings.utm')} hint={t('settings.utmHint')} value={form.utm_code} onChange={set('utm_code')} />
                <TextField label={t('settings.budget')} type="number" min={0} value={form.budget} onChange={set('budget')} />
                <TextField label={t('settings.start')} type="date" value={form.start_date} onChange={set('start_date')} />
                <TextField label={t('settings.end')} type="date" value={form.end_date} onChange={set('end_date')} />
              </div>
              <TextareaField label={t('billing.notes')} rows={2} value={form.notes} onChange={set('notes')} />
            </DialogBody>
            <DialogFooter><Button variant="outline" onClick={() => setForm(null)}>{t('common.cancel')}</Button><Button disabled={!form.name} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button></DialogFooter>
          </>
        )}
      </FormDialog>
    </>
  );
}

// ── Audit log ─────────────────────────────────────────────────────────
function AuditSettings() {
  const { t, i18n } = useTranslation();
  const query = useQuery({ queryKey: ['audit'], queryFn: async () => unwrap(await sb().from('audit_logs').select('*, actor:profiles(full_name, email)').order('created_at', { ascending: false }).limit(300)) as unknown as AuditLog[] });
  const cols: Column<AuditLog>[] = [
    { key: 'when', header: t('notifications.when'), primary: true, cell: (a) => formatDateTime(a.created_at, i18n.language) },
    { key: 'actor', header: t('settings.actor'), cell: (a) => a.actor?.full_name || a.actor?.email || t('crm.system') },
    { key: 'action', header: t('settings.action'), cell: (a) => <Badge tone="outline">{a.action}</Badge> },
    { key: 'entity', header: t('settings.entity'), cell: (a) => <span className="text-xs">{a.entity_type}{a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ''}</span> },
    { key: 'meta', header: t('settings.details'), cell: (a) => <code className="line-clamp-2 break-all text-xs text-muted-foreground">{Object.keys(a.metadata ?? {}).length ? JSON.stringify(a.metadata) : '—'}</code>, hideOnMobile: true },
  ];
  return <QueryState query={query} empty={<EmptyState icon={History} title={t('settings.noAudit')} />}>{(rows) => <DataTable caption={t('settings.audit')} columns={cols} rows={rows} rowKey={(a) => a.id} />}</QueryState>;
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const isSuper = can('settings.manage');
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
      <Tabs defaultValue={isSuper ? 'general' : 'content'}>
        <TabsList>
          {isSuper && <TabsTrigger value="general"><Settings />{t('settings.general')}</TabsTrigger>}
          {can('team.manage') && <TabsTrigger value="team"><Users />{t('team.title')}</TabsTrigger>}
          {can('content.manage') && <TabsTrigger value="content"><Video />{t('settings.content')}</TabsTrigger>}
          {can('leads.assign') && <TabsTrigger value="campaigns"><Megaphone />{t('settings.campaigns')}</TabsTrigger>}
          {can('audit.view') && <TabsTrigger value="audit"><History />{t('settings.audit')}</TabsTrigger>}
        </TabsList>
        {isSuper && <TabsContent value="general"><GeneralSettings /></TabsContent>}
        {can('team.manage') && <TabsContent value="team"><TeamSettings /></TabsContent>}
        {can('content.manage') && <TabsContent value="content"><ContentSettings /></TabsContent>}
        {can('leads.assign') && <TabsContent value="campaigns"><CampaignsSettings /></TabsContent>}
        {can('audit.view') && <TabsContent value="audit"><AuditSettings /></TabsContent>}
      </Tabs>
    </>
  );
}
