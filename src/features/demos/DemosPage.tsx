import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarDays, CalendarX, Clock, Download, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DialogBody, DialogFooter } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { CheckField, SelectField, TextField, TextareaField } from '@/components/shared/Field';
import { EmptyState, QueryState } from '@/components/shared/states';
import { FilterBar } from '@/components/shared/FilterBar';
import { FormDialog, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { salesPeople, staffName, useStaff } from '@/hooks/useStaff';
import { api, errorKey } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatDateTime, formatTime, fromIstInput, toIstInput } from '@/lib/format';
import { sb, unwrap } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { DemoAvailability, DemoBooking } from '@/types/db';
import { DEMO_OUTCOMES } from '@shared/constants';
import { formatPhone } from '@shared/phone';
import { bucketKey } from '@/features/analytics/metrics';

type Scope = 'upcoming' | 'past' | 'all';

function useDemos(scope: Scope, mine: boolean, userId?: string) {
  return useQuery({
    queryKey: ['demos', scope, mine, userId],
    queryFn: async () => {
      const now = new Date().toISOString();
      let q = sb().from('demo_bookings').select('*').limit(1000);
      if (scope === 'upcoming') q = q.gte('ends_at', now).eq('status', 'scheduled').order('starts_at');
      else if (scope === 'past') q = q.lt('starts_at', now).order('starts_at', { ascending: false });
      else q = q.order('starts_at', { ascending: false });
      if (mine && userId) q = q.eq('salesperson_id', userId);
      return unwrap(await q) as DemoBooking[];
    },
  });
}

function useDemoAction() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/admin/demos', { method: 'POST', body }),
    onSuccess: async () => {
      toast.success(t('common.saved'));
      await Promise.all([qc.invalidateQueries({ queryKey: ['demos'] }), qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['leads'] })]);
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });
}

function DemoActionsDialog({ demo, onClose }: { demo: DemoBooking | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const action = useDemoAction();
  const [tab, setTab] = useState<'complete' | 'reschedule' | 'cancel'>('complete');
  const [form, setForm] = useState({ status: 'completed', outcome: 'interested', feedback_rating: 4, feedback_notes: '', follow_up_at: '', starts_at: '', reason: '', notify: true });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  if (!demo) return null;
  const upcoming = demo.status === 'scheduled' && new Date(demo.starts_at).getTime() > Date.now();

  const submit = () => {
    const done = () => onClose();
    if (tab === 'complete') {
      action.mutate({ action: 'complete', booking_id: demo.id, status: form.status, outcome: form.status === 'completed' ? form.outcome : undefined, feedback_rating: form.status === 'completed' ? Number(form.feedback_rating) : undefined, feedback_notes: form.feedback_notes || undefined, follow_up_at: fromIstInput(form.follow_up_at) }, { onSuccess: done });
    } else if (tab === 'reschedule') {
      const startsAt = fromIstInput(form.starts_at);
      if (startsAt) action.mutate({ action: 'reschedule', booking_id: demo.id, starts_at: startsAt, notify: form.notify }, { onSuccess: done });
    } else {
      action.mutate({ action: 'cancel', booking_id: demo.id, reason: form.reason || undefined, notify: form.notify }, { onSuccess: done });
    }
  };

  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title={demo.company_name} description={`${formatDateTime(demo.starts_at, i18n.language)} · ${demo.contact_name}`}>
      <DialogBody>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="complete"><CalendarCheck />{t('demos.outcome')}</TabsTrigger>
            {demo.status === 'scheduled' && <TabsTrigger value="reschedule"><Clock />{t('manageDemo.reschedule')}</TabsTrigger>}
            {upcoming && <TabsTrigger value="cancel"><CalendarX />{t('common.cancel')}</TabsTrigger>}
          </TabsList>
          <TabsContent value="complete" className="space-y-4">
            <SelectField label={t('crm.status')} value={form.status} onChange={set('status')}>
              <option value="completed">{t('status.completed')}</option>
              <option value="no_show">{t('status.no_show')}</option>
            </SelectField>
            {form.status === 'completed' && (
              <>
                <SelectField label={t('demos.outcome')} value={form.outcome} onChange={set('outcome')}>
                  {DEMO_OUTCOMES.map((o) => <option key={o} value={o}>{t(`demoOutcome.${o}`)}</option>)}
                </SelectField>
                <fieldset>
                  <legend className="mb-1.5 text-sm font-medium">{t('demos.rating')}</legend>
                  <div className="flex gap-1" role="radiogroup">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" role="radio" aria-checked={form.feedback_rating === n} aria-label={String(n)} onClick={() => setForm((f) => ({ ...f, feedback_rating: n }))} className="inline-flex size-10 items-center justify-center rounded-md hover:bg-muted">
                        <Star className={cn('size-6', n <= form.feedback_rating ? 'fill-[hsl(var(--brand-accent))] text-[hsl(var(--brand-accent))]' : 'text-muted-foreground')} />
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            <TextareaField label={t('demos.feedback')} rows={3} value={form.feedback_notes} onChange={set('feedback_notes')} />
            <TextField label={t('demos.followUpAt')} type="datetime-local" hint={t('common.istHint')} value={form.follow_up_at} onChange={set('follow_up_at')} />
          </TabsContent>
          <TabsContent value="reschedule" className="space-y-4">
            <TextField label={t('demos.newTime')} type="datetime-local" hint={t('common.istHint')} value={form.starts_at || toIstInput(demo.starts_at)} onChange={set('starts_at')} />
            <CheckField label={t('demos.notifyCustomer')} checked={form.notify} onChange={set('notify')} />
          </TabsContent>
          <TabsContent value="cancel" className="space-y-4">
            <TextareaField label={t('manageDemo.reason')} rows={3} value={form.reason} onChange={set('reason')} />
            <CheckField label={t('demos.notifyCustomer')} checked={form.notify} onChange={set('notify')} />
          </TabsContent>
        </Tabs>
      </DialogBody>
      <DialogFooter>
        {demo.lead_id && <Button variant="ghost" asChild className="sm:mr-auto"><Link to={`/admin/leads/${demo.lead_id}`}>{t('demos.openLead')}</Link></Button>}
        <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
        <Button variant={tab === 'cancel' ? 'destructive' : 'default'} loading={action.isPending} onClick={submit}>{tab === 'cancel' ? t('manageDemo.cancel') : t('common.save')}</Button>
      </DialogFooter>
    </FormDialog>
  );
}

function AvailabilityEditor() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user, can } = useAuth();
  const { data: staff } = useStaff();
  const isAdmin = can('leads.assign');
  const [person, setPerson] = useState<string>(user?.id ?? '');
  const query = useQuery({
    queryKey: ['availability', person],
    enabled: Boolean(person),
    queryFn: async () => unwrap(await sb().from('demo_availability').select('*').eq('salesperson_id', person).order('weekday').order('start_time')) as DemoAvailability[],
  });
  const [draft, setDraft] = useState({ weekday: 1, start_time: '10:00', end_time: '13:00', slot_minutes: 45 });
  const refresh = () => qc.invalidateQueries({ queryKey: ['availability', person] });
  const onError = (err: unknown) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
  const add = useMutation({ mutationFn: async () => unwrap(await sb().from('demo_availability').insert({ ...draft, salesperson_id: person }).select('id').single()), onSuccess: refresh, onError });
  const toggle = useMutation({ mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => unwrap(await sb().from('demo_availability').update({ is_active }).eq('id', id).select('id').single()), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: async (id: string) => unwrap(await sb().from('demo_availability').delete().eq('id', id).select('id')), onSuccess: refresh, onError });
  const days = [0, 1, 2, 3, 4, 5, 6];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('demos.availability')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('demos.availabilityHint')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && (
          <SelectField label={t('demos.salesperson')} value={person} onChange={(e) => setPerson(e.target.value)} className="max-w-xs">
            {salesPeople(staff).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
          </SelectField>
        )}
        <div className="grid items-end gap-2 sm:grid-cols-5">
          <SelectField label={t('demos.weekday')} value={String(draft.weekday)} onChange={(e) => setDraft((d) => ({ ...d, weekday: Number(e.target.value) }))}>
            {days.map((d) => <option key={d} value={d}>{t(`weekday.${d}`)}</option>)}
          </SelectField>
          <TextField label={t('demos.from')} type="time" value={draft.start_time} onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))} />
          <TextField label={t('demos.to')} type="time" value={draft.end_time} onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))} />
          <SelectField label={t('demos.slotLength')} value={String(draft.slot_minutes)} onChange={(e) => setDraft((d) => ({ ...d, slot_minutes: Number(e.target.value) }))}>
            {[30, 45, 60].map((m) => <option key={m} value={m}>{t('demos.minutes', { count: m })}</option>)}
          </SelectField>
          <Button onClick={() => add.mutate()} loading={add.isPending} disabled={draft.end_time <= draft.start_time}><Plus />{t('common.add')}</Button>
        </div>
        <ul className="divide-y rounded-xl border">
          {query.data?.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">{t('demos.noAvailability')}</li>}
          {query.data?.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="w-24 font-medium">{t(`weekday.${a.weekday}`)}</span>
              <span className="flex-1 tabular">{a.start_time.slice(0, 5)} – {a.end_time.slice(0, 5)} · {t('demos.minutes', { count: a.slot_minutes })}</span>
              <Switch checked={a.is_active} onCheckedChange={(v) => toggle.mutate({ id: a.id, is_active: v })} aria-label={t('common.active')} />
              <Button variant="ghost" size="icon-sm" aria-label={t('common.delete')} onClick={() => remove.mutate(a.id)}><Trash2 /></Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function DemosPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { user, can } = useAuth();
  const { data: staff } = useStaff();
  const [scope, setScope] = useState<Scope>('upcoming');
  const [mine, setMine] = useState(!can('leads.assign'));
  const [selected, setSelected] = useState<DemoBooking | null>(null);
  const [search, setSearch] = useState('');
  const query = useDemos(scope, mine, user?.id);
  const filtered = useMemo(() => (query.data ?? []).filter((d) => !search || `${d.company_name} ${d.contact_name}`.toLowerCase().includes(search.toLowerCase())), [query.data, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, DemoBooking[]>();
    for (const d of filtered) {
      const k = bucketKey(d.starts_at, 'day');
      map.set(k, [...(map.get(k) ?? []), d]);
    }
    return [...map.entries()];
  }, [filtered]);

  const columns: Column<DemoBooking>[] = [
    { key: 'when', header: t('demos.when'), primary: true, cell: (d) => <span className="font-semibold">{formatDateTime(d.starts_at, lang)}</span> },
    { key: 'company', header: t('form.companyName'), cell: (d) => <div><p className="font-medium">{d.company_name}</p><p className="text-xs text-muted-foreground">{d.contact_name}</p></div> },
    { key: 'phone', header: t('form.phone'), cell: (d) => formatPhone(d.phone) },
    { key: 'sales', header: t('demos.salesperson'), cell: (d) => staffName(staff, d.salesperson_id) },
    { key: 'mode', header: t('bookDemo.mode'), cell: (d) => t(`demoMode.${d.mode}`) },
    { key: 'status', header: t('crm.status'), cell: (d) => <StatusBadge value={d.status} /> },
    { key: 'outcome', header: t('demos.outcome'), cell: (d) => (d.outcome ? t(`demoOutcome.${d.outcome}`) : '—'), hideOnMobile: true },
  ];

  const exportCsv = () =>
    downloadCsv('demos', filtered, [
      { header: 'Start (IST)', value: (d) => formatDateTime(d.starts_at) },
      { header: 'Company', value: (d) => d.company_name },
      { header: 'Contact', value: (d) => d.contact_name },
      { header: 'Phone', value: (d) => d.phone },
      { header: 'Email', value: (d) => d.email },
      { header: 'Salesperson', value: (d) => staffName(staff, d.salesperson_id) },
      { header: 'Mode', value: (d) => d.mode },
      { header: 'Status', value: (d) => d.status },
      { header: 'Outcome', value: (d) => d.outcome },
      { header: 'Rating', value: (d) => d.feedback_rating },
      { header: 'Feedback', value: (d) => d.feedback_notes },
      { header: 'Reschedules', value: (d) => d.reschedule_count },
    ]);

  return (
    <>
      <PageHeader title={t('demos.title')} description={t('demos.subtitle')} actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}><Download />{t('common.exportCsv')}</Button>} />
      <Tabs defaultValue="bookings">
        <TabsList><TabsTrigger value="bookings"><CalendarDays />{t('demos.bookings')}</TabsTrigger><TabsTrigger value="availability"><Clock />{t('demos.availability')}</TabsTrigger></TabsList>
        <TabsContent value="bookings">
          <FilterBar
            className="mb-4"
            search={<Input type="search" placeholder={t('common.search')} aria-label={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />}
            activeCount={(scope !== 'upcoming' ? 1 : 0) + (mine ? 1 : 0)}
            onReset={() => { setScope('upcoming'); setMine(false); }}
            filters={[
              {
                label: t('demos.scope'),
                control: (
                  <Select aria-label={t('demos.scope')} value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                    <option value="upcoming">{t('demos.upcoming')}</option>
                    <option value="past">{t('demos.past')}</option>
                    <option value="all">{t('demos.all')}</option>
                  </Select>
                ),
              },
              { label: t('demos.onlyMine'), className: 'md:w-auto', control: <label className="flex min-h-11 items-center gap-2 text-sm"><Switch checked={mine} onCheckedChange={setMine} />{t('demos.onlyMine')}</label> },
            ]}
          />
          <QueryState query={query} isEmpty={() => filtered.length === 0} empty={<EmptyState icon={CalendarDays} title={t('demos.empty')} description={t('demos.emptyBody')} />}>
            {() =>
              scope === 'upcoming' ? (
                <div className="space-y-5">
                  {grouped.map(([day, items]) => (
                    <section key={day}>
                      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{formatDate(`${day}T06:30:00Z`, lang)}</h2>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {items.map((d) => (
                          <button key={d.id} onClick={() => setSelected(d)} className="flex gap-3 rounded-xl border bg-card p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-soft">
                            <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 py-2 text-primary">
                              <span className="text-sm font-bold">{formatTime(d.starts_at, lang)}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-semibold">{d.company_name}</p>
                              <p className="truncate text-sm text-muted-foreground">{d.contact_name} · {t(`demoMode.${d.mode}`)}</p>
                              <p className="truncate text-xs text-muted-foreground">{staffName(staff, d.salesperson_id)}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <DataTable caption={t('demos.title')} columns={columns} rows={filtered} rowKey={(d) => d.id} onRowClick={setSelected} />
              )
            }
          </QueryState>
        </TabsContent>
        <TabsContent value="availability"><AvailabilityEditor /></TabsContent>
      </Tabs>
      <DemoActionsDialog key={selected?.id} demo={selected} onClose={() => setSelected(null)} />
    </>
  );
}
