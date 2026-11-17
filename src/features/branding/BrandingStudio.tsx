import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Building2, Home, ImagePlus, LifeBuoy, Loader2, Monitor, RotateCcw, Smartphone, Tablet, Trash2, Undo2, Users, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { SelectField, TextField } from '@/components/shared/Field';
import { ErrorState, ListSkeleton } from '@/components/shared/states';
import { ConfirmDialog, PageHeader } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { applyBrandingVars, useTheme } from '@/features/branding/ThemeProvider';
import { brandingKey, useCompanyBranding } from '@/features/branding/useBranding';
import { errorKey } from '@/lib/api';
import { publicAssetUrl, sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  ANIMATION_PREFS, BUTTON_STYLES, DEFAULT_APPEARANCE, DEFAULT_COLORS, FONTS, NAV_LAYOUTS, SIDEBAR_STYLES, THEME_MODES,
  brandingSchema, contrastRatio, resolveMode, validateLogo, type BrandColors, type Branding,
} from '@shared/branding';

type AssetKind = 'logo_path' | 'logo_light_path' | 'logo_dark_path' | 'favicon_path';
type Device = 'desktop' | 'tablet' | 'mobile';
const DEVICE_WIDTH: Record<Device, number> = { desktop: 1180, tablet: 820, mobile: 390 };

/** Colour presets, so non-designers can start from something that already works. */
const PRESETS: { key: string; colors: Partial<BrandColors> }[] = [
  { key: 'indigo', colors: { primary: '#4f46e5', secondary: '#0ea5e9', accent: '#f59e0b', sidebar: '#0f172a', button: '#4f46e5' } },
  { key: 'temple', colors: { primary: '#b45309', secondary: '#7c2d12', accent: '#facc15', sidebar: '#431407', button: '#b45309' } },
  { key: 'coast', colors: { primary: '#0e7490', secondary: '#0284c7', accent: '#f97316', sidebar: '#083344', button: '#0e7490' } },
  { key: 'paddy', colors: { primary: '#15803d', secondary: '#65a30d', accent: '#eab308', sidebar: '#052e16', button: '#15803d' } },
  { key: 'rose', colors: { primary: '#be123c', secondary: '#9333ea', accent: '#f59e0b', sidebar: '#4c0519', button: '#be123c' } },
];

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const id = `color-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1" />
        <input
          id={id}
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          onBlur={() => setText(value)}
          className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 font-mono text-sm uppercase"
        />
      </div>
    </div>
  );
}

function AssetUpload({ label, hint, path, busy, onPick, onClear, dark }: { label: string; hint: string; path: string | null; busy: boolean; onPick: (f: File) => void; onClear: () => void; dark?: boolean }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const url = publicAssetUrl(path);
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) onPick(f); }}
        className={cn('flex items-center gap-3 rounded-xl border border-dashed p-3 transition-colors', dragOver && 'border-primary bg-primary/5')}
      >
        <div className={cn('flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border', dark ? 'bg-slate-900' : 'bg-white')}>
          {busy ? <Loader2 className="size-5 animate-spin text-primary" /> : url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-5 text-slate-400" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{hint}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>{url ? t('branding.replace') : t('branding.upload')}</Button>
            {url && <Button type="button" size="sm" variant="ghost" onClick={onClear} aria-label={t('branding.remove')}><Trash2 /></Button>}
          </div>
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/x-icon,.ico" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
      </div>
    </div>
  );
}

/** A miniature of the real portal, rendered with the draft branding's CSS variables. */
function LivePreview({ branding, device, systemDark }: { branding: Branding; device: Device; systemDark: boolean }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const resolved = resolveMode(branding, systemDark);
  const keys = useRef<string[]>([]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const k of keys.current) el.style.removeProperty(k);
    keys.current = applyBrandingVars(el, branding, resolved);
  }, [branding, resolved]);

  const logo = publicAssetUrl(resolved === 'dark' ? branding.logo_dark_path ?? branding.logo_path : branding.logo_light_path ?? branding.logo_path);
  const sidebarLogo = publicAssetUrl(branding.logo_dark_path ?? branding.logo_path);
  const nav = [{ icon: Home, label: t('portal.nav.dashboard') }, { icon: Building2, label: t('portal.nav.company') }, { icon: Users, label: t('team.users') }, { icon: LifeBuoy, label: t('support.title') }];
  const mobile = device === 'mobile';
  const topbar = branding.appearance.navLayout === 'topbar' || mobile;
  const compact = branding.appearance.compact;
  const Mark = ({ src }: { src: string | null }) => (src ? <img src={src} alt="" className="h-6 max-w-[90px] object-contain" /> : <span className="inline-flex size-6 items-center justify-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">{branding.display_name.slice(0, 1)}</span>);

  return (
    <div className="flex justify-center overflow-hidden rounded-xl border bg-muted/50 p-3 sm:p-5">
      <motion.div layout transition={{ type: 'spring', stiffness: 260, damping: 30 }} style={{ width: '100%', maxWidth: DEVICE_WIDTH[device] }} className={cn('overflow-hidden border shadow-xl', mobile ? 'rounded-[2rem] border-8 border-slate-800' : 'rounded-xl')}>
        <div ref={ref} className={cn(resolved === 'dark' ? 'dark' : 'light', 'bg-background text-foreground')} style={{ fontFamily: 'var(--font-sans)', fontSize: compact ? 13 : 14 }} aria-label={t('branding.preview')} role="img">
          <div className="flex" style={{ minHeight: mobile ? 560 : 420 }}>
            {!topbar && (
              <aside className="flex w-44 shrink-0 flex-col bg-sidebar p-3 text-sidebar-foreground">
                <div className="mb-4 flex items-center gap-2"><Mark src={sidebarLogo} /><span className="truncate text-xs font-bold">{branding.display_name}</span></div>
                {nav.map((n, i) => (
                  <div key={n.label} className={cn('mb-1 flex items-center gap-2 rounded-md px-2 text-xs', compact ? 'py-1' : 'py-1.5', i === 0 ? 'bg-sidebar-foreground/[0.12] font-semibold' : 'opacity-70')}><n.icon className="size-3.5" />{n.label}</div>
                ))}
              </aside>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 border-b bg-card px-4 py-2.5">
                {topbar && <><Mark src={logo} /><span className="truncate text-xs font-bold">{branding.display_name}</span></>}
                {topbar && !mobile && <div className="ml-3 flex gap-1">{nav.map((n, i) => <span key={n.label} className={cn('rounded-md px-2 py-1 text-[11px]', i === 0 ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground')}>{n.label}</span>)}</div>}
                <span className="ml-auto size-6 rounded-full bg-primary/20" />
              </div>
              <div className={cn('space-y-3', compact ? 'p-3' : 'p-4')}>
                <div>
                  <p className="text-sm font-bold">{t('portal.welcome', { company: branding.display_name })}</p>
                  {branding.tagline && <p className="text-xs text-muted-foreground">{branding.tagline}</p>}
                </div>
                <div className={cn('grid gap-2', mobile ? 'grid-cols-2' : 'grid-cols-3')}>
                  {[t('preview.employees'), t('preview.present'), t('preview.onLeave')].slice(0, mobile ? 2 : 3).map((l, i) => (
                    <div key={l} className="rounded-lg border bg-card p-2.5" style={{ borderRadius: 'var(--radius)' }}>
                      <p className="text-[10px] text-muted-foreground">{l}</p>
                      <p className="text-lg font-bold" style={{ color: i === 0 ? 'hsl(var(--primary))' : i === 1 ? 'hsl(var(--brand-secondary))' : 'hsl(var(--brand-accent))' }}>{[248, 231, 12][i]}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border bg-card p-3" style={{ borderRadius: 'var(--radius)' }}>
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold"><BarChart3 className="size-3.5 text-primary" />{t('preview.attendanceTrend')}</div>
                  <div className="flex h-16 items-end gap-1.5">{[40, 60, 52, 75, 66, 85].map((h, i) => <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: i % 2 ? 'hsl(var(--primary))' : 'hsl(var(--brand-secondary))' }} />)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex h-8 items-center bg-button px-3 text-xs font-semibold text-button-foreground" style={{ borderRadius: 'var(--btn-radius)' }}>{t('branding.sampleButton')}</span>
                  <span className="inline-flex h-8 items-center border bg-card px-3 text-xs font-semibold" style={{ borderRadius: 'var(--btn-radius)' }}>{t('common.cancel')}</span>
                  <Badge tone="primary">{t('status.active')}</Badge>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function BrandingStudioPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeCompany, isCompanyAdmin } = useAuth();
  const { setBranding, resolved } = useTheme();
  const companyId = activeCompany?.id;
  const query = useCompanyBranding(companyId, activeCompany?.name);
  const [draft, setDraft] = useState<Branding | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [uploading, setUploading] = useState<AssetKind | null>(null);
  const [confirmDefaults, setConfirmDefaults] = useState(false);
  const uploadedThisSession = useRef<string[]>([]);

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data);
  }, [query.data, draft]);

  const saved = query.data;
  const dirty = useMemo(() => Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)), [draft, saved]);
  const parsed = draft ? brandingSchema.safeParse(draft) : null;
  const lowContrast = draft ? contrastRatio(draft.colors.button, draft.colors.buttonText) < 4.5 : false;
  const lowTextContrast = draft?.theme_mode === 'custom' && contrastRatio(draft.colors.background, draft.colors.text) < 4.5;

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const save = useMutation({
    mutationFn: async () => {
      const value = brandingSchema.parse(draft);
      unwrap(
        await sb()
          .from('company_branding')
          .upsert({ company_id: companyId, ...value, tagline: value.tagline || null }, { onConflict: 'company_id' })
          .select('company_id')
          .single(),
      );
      // Remove superseded uploads that are no longer referenced.
      const keep = new Set([value.logo_path, value.logo_light_path, value.logo_dark_path, value.favicon_path].filter(Boolean));
      const orphans = uploadedThisSession.current.filter((p) => !keep.has(p));
      if (orphans.length) await sb().storage.from('branding').remove(orphans);
      uploadedThisSession.current = [];
      return value;
    },
    onSuccess: async (value) => {
      toast.success(t('branding.saved'));
      qc.setQueryData(brandingKey(companyId), value);
      setDraft(value);
      setBranding(value);
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });

  if (!isCompanyAdmin) return <ErrorState error={new Error('errors.forbidden')} />;
  if (query.isPending || !draft) return <ListSkeleton rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const update = (patch: Partial<Branding>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setColor = (key: keyof BrandColors) => (v: string) => setDraft((d) => (d ? { ...d, colors: { ...d.colors, [key]: v } } : d));
  const setAppearance = <K extends keyof Branding['appearance']>(key: K, v: Branding['appearance'][K]) => setDraft((d) => (d ? { ...d, appearance: { ...d.appearance, [key]: v } } : d));

  const upload = async (kind: AssetKind, file: File) => {
    const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const check = validateLogo(file, header);
    if (!check.ok) {
      toast.error(t(check.error));
      return;
    }
    if (kind !== 'favicon_path' && check.ext === 'ico') {
      toast.error(t('upload.badType'));
      return;
    }
    setUploading(kind);
    try {
      // Path is always inside this tenant's folder; storage policies enforce the same rule.
      const path = `${companyId}/${kind.replace('_path', '')}-${Date.now()}.${check.ext}`;
      const { error } = await sb().storage.from('branding').upload(path, file, { contentType: check.mime, cacheControl: '31536000', upsert: false });
      if (error) throw error;
      uploadedThisSession.current.push(path);
      update({ [kind]: path } as Partial<Branding>);
    } catch (err) {
      toast.error(t(errorKey(err), { defaultValue: t('upload.failed') }));
    } finally {
      setUploading(null);
    }
  };

  const discard = () => {
    if (uploadedThisSession.current.length) void sb().storage.from('branding').remove(uploadedThisSession.current);
    uploadedThisSession.current = [];
    setDraft(saved ?? null);
  };

  return (
    <>
      <PageHeader title={t('branding.title')} description={t('branding.subtitle')} />
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,460px)_1fr]">
        <div className="space-y-5">
          <Tabs defaultValue="identity">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="identity">{t('branding.identity')}</TabsTrigger>
              <TabsTrigger value="colors">{t('branding.colors')}</TabsTrigger>
              <TabsTrigger value="appearance">{t('branding.appearance')}</TabsTrigger>
            </TabsList>
            <TabsContent value="identity" className="space-y-5">
              <Section title={t('branding.identity')}>
                <TextField label={t('form.companyName')} value={activeCompany?.name ?? ''} disabled readOnly hint={t('branding.companyNameHint')} />
                <TextField label={t('branding.displayName')} required value={draft.display_name} onChange={(e) => update({ display_name: e.target.value })} error={parsed && !parsed.success ? parsed.error.issues.find((i) => i.path[0] === 'display_name')?.message : undefined} />
                <TextField label={t('branding.tagline')} value={draft.tagline ?? ''} maxLength={140} onChange={(e) => update({ tagline: e.target.value })} />
                <SelectField label={t('company.defaultLanguage')} value={draft.default_language} onChange={(e) => update({ default_language: e.target.value as 'en' | 'ta' })} hint={t('company.defaultLanguageHint')}>
                  <option value="en">English</option>
                  <option value="ta">தமிழ்</option>
                </SelectField>
              </Section>
              <Section title={t('branding.logos')}>
                <p className="text-xs text-muted-foreground">{t('branding.uploadRules')}</p>
                <AssetUpload label={t('branding.logo')} hint={t('branding.logoHint')} path={draft.logo_path} busy={uploading === 'logo_path'} onPick={(f) => void upload('logo_path', f)} onClear={() => update({ logo_path: null })} />
                <AssetUpload label={t('branding.logoLight')} hint={t('branding.logoLightHint')} path={draft.logo_light_path} busy={uploading === 'logo_light_path'} onPick={(f) => void upload('logo_light_path', f)} onClear={() => update({ logo_light_path: null })} />
                <AssetUpload dark label={t('branding.logoDark')} hint={t('branding.logoDarkHint')} path={draft.logo_dark_path} busy={uploading === 'logo_dark_path'} onPick={(f) => void upload('logo_dark_path', f)} onClear={() => update({ logo_dark_path: null })} />
                <AssetUpload label={t('branding.favicon')} hint={t('branding.faviconHint')} path={draft.favicon_path} busy={uploading === 'favicon_path'} onPick={(f) => void upload('favicon_path', f)} onClear={() => update({ favicon_path: null })} />
              </Section>
            </TabsContent>
            <TabsContent value="colors" className="space-y-5">
              <Section title={t('branding.theme')}>
                <div role="radiogroup" aria-label={t('branding.theme')} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {THEME_MODES.map((m) => (
                    <button key={m} role="radio" aria-checked={draft.theme_mode === m} onClick={() => update({ theme_mode: m })} className={cn('min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors', draft.theme_mode === m ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>
                      {t(`theme.${m}`)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t(`branding.themeHint.${draft.theme_mode}`)}</p>
                <div>
                  <p className="mb-2 text-sm font-medium">{t('branding.presets')}</p>
                  <div className="flex flex-wrap gap-2">
                    {PRESETS.map((p) => (
                      <button key={p.key} onClick={() => update({ colors: { ...draft.colors, ...p.colors } })} className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        <span className="flex -space-x-1">{[p.colors.primary, p.colors.secondary, p.colors.accent].map((c) => <span key={c} className="size-4 rounded-full border-2 border-card" style={{ background: c }} />)}</span>
                        {t(`branding.preset.${p.key}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </Section>
              <Section title={t('branding.brandColors')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ColorField label={t('branding.color.primary')} value={draft.colors.primary} onChange={setColor('primary')} />
                  <ColorField label={t('branding.color.secondary')} value={draft.colors.secondary} onChange={setColor('secondary')} />
                  <ColorField label={t('branding.color.accent')} value={draft.colors.accent} onChange={setColor('accent')} />
                  <ColorField label={t('branding.color.sidebar')} value={draft.colors.sidebar} onChange={setColor('sidebar')} />
                  <ColorField label={t('branding.color.button')} value={draft.colors.button} onChange={setColor('button')} />
                  <ColorField label={t('branding.color.buttonText')} value={draft.colors.buttonText} onChange={setColor('buttonText')} />
                </div>
                {lowContrast && <p role="status" className="rounded-lg bg-warning/10 p-2.5 text-xs text-warning">{t('branding.lowContrast')}</p>}
              </Section>
              <Section title={t('branding.customColors')}>
                <p className="text-xs text-muted-foreground">{t('branding.customColorsHint')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ColorField label={t('branding.color.background')} value={draft.colors.background} onChange={setColor('background')} />
                  <ColorField label={t('branding.color.surface')} value={draft.colors.surface} onChange={setColor('surface')} />
                  <ColorField label={t('branding.color.text')} value={draft.colors.text} onChange={setColor('text')} />
                </div>
                {lowTextContrast && <p role="status" className="rounded-lg bg-warning/10 p-2.5 text-xs text-warning">{t('branding.lowTextContrast')}</p>}
              </Section>
            </TabsContent>
            <TabsContent value="appearance" className="space-y-5">
              <Section title={t('branding.appearance')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField label={t('branding.sidebarStyle')} value={draft.appearance.sidebarStyle} onChange={(e) => setAppearance('sidebarStyle', e.target.value as Branding['appearance']['sidebarStyle'])}>
                    {SIDEBAR_STYLES.map((s) => <option key={s} value={s}>{t(`branding.sidebar.${s}`)}</option>)}
                  </SelectField>
                  <SelectField label={t('branding.navLayout')} value={draft.appearance.navLayout} onChange={(e) => setAppearance('navLayout', e.target.value as Branding['appearance']['navLayout'])}>
                    {NAV_LAYOUTS.map((s) => <option key={s} value={s}>{t(`branding.nav.${s}`)}</option>)}
                  </SelectField>
                  <SelectField label={t('branding.buttonStyle')} value={draft.appearance.buttonStyle} onChange={(e) => setAppearance('buttonStyle', e.target.value as Branding['appearance']['buttonStyle'])}>
                    {BUTTON_STYLES.map((s) => <option key={s} value={s}>{t(`branding.button.${s}`)}</option>)}
                  </SelectField>
                  <SelectField label={t('branding.typography')} value={draft.appearance.font} onChange={(e) => setAppearance('font', e.target.value as Branding['appearance']['font'])}>
                    {FONTS.map((s) => <option key={s} value={s}>{t(`branding.font.${s}`)}</option>)}
                  </SelectField>
                  <SelectField label={t('branding.animations')} value={draft.appearance.animations} onChange={(e) => setAppearance('animations', e.target.value as Branding['appearance']['animations'])}>
                    {ANIMATION_PREFS.map((s) => <option key={s} value={s}>{t(`branding.motion.${s}`)}</option>)}
                  </SelectField>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="radius">{t('branding.radius')}: <span className="tabular">{draft.appearance.radius}px</span></Label>
                  <input id="radius" type="range" min={0} max={24} step={1} value={draft.appearance.radius} onChange={(e) => setAppearance('radius', Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
                </div>
                <label className="flex items-center justify-between gap-3 text-sm font-medium">{t('branding.compact')}<Switch checked={draft.appearance.compact} onCheckedChange={(v) => setAppearance('compact', v)} /></label>
              </Section>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-3 2xl:sticky 2xl:top-20 2xl:self-start">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t('branding.preview')}</h2>
            <div role="radiogroup" aria-label={t('branding.device')} className="inline-flex rounded-lg bg-muted p-1">
              {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
                <button key={d} role="radio" aria-checked={device === d} onClick={() => setDevice(d)} className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm', device === d ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground')}>
                  <Icon className="size-4" aria-hidden /><span className="hidden sm:inline">{t(`branding.devices.${d}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <LivePreview branding={draft} device={device} systemDark={resolved === 'dark'} />
        </div>
      </div>

      {/* Sticky action bar */}
      <AnimatePresence>
        <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="glass sticky bottom-3 z-20 mt-5 flex flex-col gap-2 rounded-xl p-3 shadow-xl sm:flex-row sm:items-center">
          <p className="flex-1 text-sm" aria-live="polite">{dirty ? <span className="font-medium text-warning">{t('branding.unsaved')}</span> : <span className="text-muted-foreground">{t('branding.allSaved')}</span>}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmDefaults(true)}><Wand2 />{t('branding.restoreDefaults')}</Button>
            <Button variant="outline" size="sm" disabled={!dirty} onClick={discard}><RotateCcw />{t('branding.reset')}</Button>
            <Button variant="outline" size="sm" onClick={() => { discard(); navigate('/portal'); }}><Undo2 />{t('common.cancel')}</Button>
            <Button size="sm" disabled={!dirty || !parsed?.success || Boolean(uploading)} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
          </div>
        </motion.div>
      </AnimatePresence>

      <ConfirmDialog
        open={confirmDefaults}
        onOpenChange={setConfirmDefaults}
        title={t('branding.restoreDefaults')}
        description={t('branding.restoreDefaultsBody')}
        confirmLabel={t('branding.restoreDefaults')}
        onConfirm={() => {
          setDraft({ ...draft, theme_mode: 'system', colors: DEFAULT_COLORS, appearance: DEFAULT_APPEARANCE, logo_path: null, logo_light_path: null, logo_dark_path: null, favicon_path: null, tagline: '' });
          setConfirmDefaults(false);
        }}
      />
    </>
  );
}
