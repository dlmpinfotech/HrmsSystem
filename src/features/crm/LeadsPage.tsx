import { useMemo, useRef, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, Download, Filter, KanbanSquare, List, Plus, Search, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Avatar, Tabs, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { TextareaField } from '@/components/shared/Field';
import { EmptyState, QueryState } from '@/components/shared/states';
import { ConfirmDialog, PageHeader, StatusBadge } from '@/components/shared/widgets';
import { useAuth } from '@/features/auth/AuthProvider';
import { EMPTY_FILTERS, useLeads, useUpdateLeadStatus, type LeadFilters } from '@/features/crm/api';
import { LeadFormDialog } from '@/features/crm/LeadFormDialog';
import { salesPeople, useStaff } from '@/hooks/useStaff';
import { downloadCsv } from '@/lib/csv';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { cn, storage } from '@/lib/utils';
import type { Lead } from '@/types/db';
import { CITIES, LEAD_PRIORITIES, LEAD_SOURCES, LEAD_STATUSES, type LeadStatus } from '@shared/constants';
import { formatPhone } from '@shared/phone';

const VIEW_KEY = 'hrms.leads-view';

function FollowUp({ iso }: { iso: string | null }) {
  const { i18n } = useTranslation();
  if (!iso) return <span className="text-muted-foreground">—</span>;
  const overdue = new Date(iso).getTime() < Date.now();
  return <span className={cn('inline-flex items-center gap-1 text-xs', overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')}><CalendarClock className="size-3.5" aria-hidden />{formatRelative(iso, i18n.language)}</span>;
}

function KanbanCard({ lead, onOpen }: { lead: Lead; onOpen: () => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id, data: { status: lead.status } });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription={t('crm.draggableLead')}
      aria-label={`${lead.company_name}, ${t(`leadStatus.${lead.status}`)}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
        listeners?.onKeyDown?.(e);
      }}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className={cn('cursor-grab touch-none rounded-lg border bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow-card focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing', isDragging && 'z-50 rotate-2 opacity-90 shadow-xl')}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-semibold">{lead.company_name}</p>
        <StatusBadge value={lead.priority} group="priority" className="shrink-0 text-[10px]" />
      </div>
      <p className="truncate text-xs text-muted-foreground">{lead.contact_person} · {lead.city ?? '—'}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <FollowUp iso={lead.next_follow_up_at} />
        {lead.assignee && <Avatar name={lead.assignee.full_name} className="size-6 text-[10px]" />}
      </div>
    </div>
  );
}

function KanbanColumn({ status, leads, onOpen }: { status: LeadStatus; leads: Lead[]; onOpen: (l: Lead) => void }) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} aria-label={t(`leadStatus.${status}`)} className={cn('flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors', isOver && 'border-primary bg-primary/5')}>
      <header className="flex items-center justify-between px-3 py-2.5">
        <StatusBadge value={status} group="leadStatus" />
        <span className="text-xs font-semibold text-muted-foreground tabular">{leads.length}</span>
      </header>
      <div className="scroll-thin flex max-h-[calc(100dvh-300px)] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {leads.map((l) => <KanbanCard key={l.id} lead={l} onOpen={() => onOpen(l)} />)}
      </div>
    </section>
  );
}

export function LeadsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const { data: staff } = useStaff();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'table' | 'board'>(() => (storage.get(VIEW_KEY) === 'board' ? 'board' : 'table'));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [lostTarget, setLostTarget] = useState<string | null>(null);
  const [lostReason, setLostReason] = useState('');
  const searchTimer = useRef<number | undefined>(undefined);
  const filters: LeadFilters = useMemo(() => ({ ...EMPTY_FILTERS, ...Object.fromEntries([...params.entries()].filter(([k]) => k in EMPTY_FILTERS)) }), [params]);
  const query = useLeads(filters, user?.id);
  const updateStatus = useUpdateLeadStatus();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), useSensor(KeyboardSensor));

  const setFilter = (key: keyof LeadFilters, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const activeFilters = Object.entries(filters).filter(([k, v]) => k !== 'search' && v).length;
  const open = (l: Lead) => navigate(`/admin/leads/${l.id}`);

  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id as LeadStatus | undefined;
    const from = e.active.data.current?.status as LeadStatus | undefined;
    if (!to || to === from) return;
    if (to === 'lost') {
      setLostTarget(String(e.active.id));
      setLostReason('');
      return;
    }
    updateStatus.mutate({ id: String(e.active.id), status: to });
  };

  const columns: Column<Lead>[] = [
    { key: 'company', header: t('form.companyName'), primary: true, cell: (l) => <div className="min-w-0"><p className="truncate font-semibold">{l.company_name}</p><p className="truncate text-xs text-muted-foreground md:block">{l.contact_person}</p></div> },
    { key: 'phone', header: t('form.phone'), cell: (l) => <a href={`tel:${l.phone}`} onClick={(e) => e.stopPropagation()} className="whitespace-nowrap hover:underline">{formatPhone(l.phone)}</a> },
    { key: 'city', header: t('form.city'), cell: (l) => (l.city ? t(`city.${l.city}`, { defaultValue: l.city }) : '—') },
    { key: 'status', header: t('crm.status'), cell: (l) => <StatusBadge value={l.status} group="leadStatus" /> },
    { key: 'priority', header: t('crm.priority'), cell: (l) => <StatusBadge value={l.priority} group="priority" /> },
    { key: 'source', header: t('crm.source'), cell: (l) => t(`source.${l.source}`), hideOnMobile: true },
    { key: 'assigned', header: t('crm.assignedTo'), cell: (l) => l.assignee?.full_name ?? <span className="text-muted-foreground">{t('crm.unassigned')}</span> },
    { key: 'follow', header: t('crm.nextFollowUp'), cell: (l) => <FollowUp iso={l.next_follow_up_at} /> },
    { key: 'created', header: t('crm.created'), cell: (l) => <span className="whitespace-nowrap text-xs">{formatDate(l.created_at, lang)}</span>, hideOnMobile: true },
  ];

  const exportCsv = () =>
    downloadCsv('leads', query.data ?? [], [
      { header: 'Company Name', value: (l) => l.company_name },
      { header: 'Contact Person', value: (l) => l.contact_person },
      { header: 'Phone', value: (l) => l.phone },
      { header: 'Email', value: (l) => l.email },
      { header: 'City', value: (l) => l.city },
      { header: 'Industry', value: (l) => l.industry },
      { header: 'Employee Count', value: (l) => l.employee_count },
      { header: 'Existing HRMS', value: (l) => l.existing_hrms },
      { header: 'Interested Features', value: (l) => l.interested_features.join('; ') },
      { header: 'Lead Source', value: (l) => l.source },
      { header: 'Assigned Employee', value: (l) => l.assignee?.full_name },
      { header: 'Priority', value: (l) => l.priority },
      { header: 'Status', value: (l) => l.status },
      { header: 'Next Follow-up (IST)', value: (l) => (l.next_follow_up_at ? formatDateTime(l.next_follow_up_at) : '') },
      { header: 'Remarks', value: (l) => l.remarks },
      { header: 'Created Date (IST)', value: (l) => formatDateTime(l.created_at) },
      { header: 'Communication Consent', value: (l) => (l.communication_consent ? 'Yes' : 'No') },
    ]);

  return (
    <>
      <PageHeader
        title={t('crm.title')}
        description={t('crm.subtitle')}
        actions={
          <>
            <Tabs value={view} onValueChange={(v) => { setView(v as 'table' | 'board'); storage.set(VIEW_KEY, v); }}>
              <TabsList aria-label={t('crm.view')}>
                <TabsTrigger value="table"><List />{t('crm.table')}</TabsTrigger>
                <TabsTrigger value="board"><KanbanSquare />{t('crm.board')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!query.data?.length}><Download />{t('common.exportCsv')}</Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}><Plus />{t('crm.newLead')}</Button>
          </>
        }
      />

      <div className="mb-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" placeholder={t('crm.searchPlaceholder')} aria-label={t('common.search')} defaultValue={filters.search} className="pl-9" onChange={(e) => { const v = e.target.value; window.clearTimeout(searchTimer.current); searchTimer.current = window.setTimeout(() => setFilter('search', v), 300); }} />
          </div>
          <Button variant="outline" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen} aria-controls="lead-filters">
            <Filter />{t('common.filters')}{activeFilters > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{activeFilters}</span>}
          </Button>
        </div>
        {filtersOpen && (
          <motion.div id="lead-filters" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-3 xl:grid-cols-6">
            <Select aria-label={t('crm.status')} value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">{t('crm.allStatuses')}</option>
              {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(`leadStatus.${s}`)}</option>)}
            </Select>
            <Select aria-label={t('crm.source')} value={filters.source} onChange={(e) => setFilter('source', e.target.value)}>
              <option value="">{t('crm.allSources')}</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{t(`source.${s}`)}</option>)}
            </Select>
            <Select aria-label={t('form.city')} value={filters.city} onChange={(e) => setFilter('city', e.target.value)}>
              <option value="">{t('crm.allCities')}</option>
              {CITIES.map((c) => <option key={c} value={c}>{t(`city.${c}`)}</option>)}
            </Select>
            <Select aria-label={t('crm.priority')} value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
              <option value="">{t('crm.allPriorities')}</option>
              {LEAD_PRIORITIES.map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
            </Select>
            <Select aria-label={t('crm.assignedTo')} value={filters.assigned} onChange={(e) => setFilter('assigned', e.target.value)}>
              <option value="">{t('crm.anyone')}</option>
              <option value="me">{t('crm.assignedToMe')}</option>
              <option value="unassigned">{t('crm.unassigned')}</option>
              {can('leads.assign') && salesPeople(staff).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
            </Select>
            <Button variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}><X />{t('common.clear')}</Button>
          </motion.div>
        )}
      </div>

      <QueryState query={query} empty={<EmptyState icon={Users} title={t('crm.emptyTitle')} description={t('crm.emptyBody')} action={<Button onClick={() => setCreateOpen(true)}><Plus />{t('crm.newLead')}</Button>} />}>
        {(leads) =>
          view === 'table' ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">{t('crm.count', { count: leads.length })}</p>
              <DataTable caption={t('crm.title')} columns={columns} rows={leads} rowKey={(l) => l.id} onRowClick={open} />
            </>
          ) : (
            <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: t('crm.dragInstructions') } }}>
              <div className="scroll-thin -mx-[var(--page-pad)] flex gap-3 overflow-x-auto px-[var(--page-pad)] pb-3">
                {LEAD_STATUSES.map((s) => <KanbanColumn key={s} status={s} leads={leads.filter((l) => l.status === s)} onOpen={open} />)}
              </div>
            </DndContext>
          )
        }
      </QueryState>

      <LeadFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={(id) => navigate(`/admin/leads/${id}`)} />
      <ConfirmDialog
        open={Boolean(lostTarget)}
        onOpenChange={(o) => !o && setLostTarget(null)}
        title={t('crm.markLost')}
        confirmLabel={t('crm.markLost')}
        destructive
        loading={updateStatus.isPending}
        onConfirm={() => { if (lostTarget) updateStatus.mutate({ id: lostTarget, status: 'lost', lost_reason: lostReason }, { onSettled: () => setLostTarget(null) }); }}
      >
        <TextareaField label={t('crm.lostReason')} rows={3} value={lostReason} onChange={(e) => setLostReason(e.target.value)} maxLength={500} />
      </ConfirmDialog>
    </>
  );
}
