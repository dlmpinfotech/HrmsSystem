import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorKey } from '@/lib/api';
import { sb, unwrap } from '@/lib/supabase';
import type { Lead, LeadActivity, LeadTask } from '@/types/db';
import type { LeadStatus } from '@shared/constants';
import type { LeadFormValues } from '@shared/schemas';

export interface LeadFilters {
  search: string;
  status: string;
  source: string;
  city: string;
  assigned: string; // '' | 'me' | 'unassigned' | <uuid>
  priority: string;
}

export const EMPTY_FILTERS: LeadFilters = { search: '', status: '', source: '', city: '', assigned: '', priority: '' };

/** Escapes a value for PostgREST `ilike` inside an `or=(...)` filter. */
export function ilikeTerm(term: string): string {
  return term.replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()"]/g, ' ').trim();
}

export function useLeads(filters: LeadFilters, userId: string | undefined) {
  return useQuery({
    queryKey: ['leads', filters, userId],
    queryFn: async () => {
      let q = sb().from('leads').select('*, assignee:profiles!leads_assigned_to_fkey(id, full_name)').order('created_at', { ascending: false }).limit(1000);
      const term = ilikeTerm(filters.search);
      if (term) q = q.or(`company_name.ilike.%${term}%,contact_person.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.source) q = q.eq('source', filters.source);
      if (filters.city) q = q.eq('city', filters.city);
      if (filters.priority) q = q.eq('priority', filters.priority);
      if (filters.assigned === 'me' && userId) q = q.eq('assigned_to', userId);
      else if (filters.assigned === 'unassigned') q = q.is('assigned_to', null);
      else if (filters.assigned && filters.assigned !== 'me') q = q.eq('assigned_to', filters.assigned);
      return unwrap(await q) as unknown as Lead[];
    },
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: ['lead', id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await sb().from('leads').select('*, assignee:profiles!leads_assigned_to_fkey(id, full_name)').eq('id', id!).single()) as unknown as Lead,
  });
}

export function useLeadActivities(id: string | undefined) {
  return useQuery({
    queryKey: ['lead-activities', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await sb().from('lead_activities').select('*, author:profiles!lead_activities_created_by_fkey(full_name)').eq('lead_id', id!).order('created_at', { ascending: false }).limit(200)) as unknown as LeadActivity[],
  });
}

export function useLeadTasks(id: string | undefined) {
  return useQuery({
    queryKey: ['lead-tasks', id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await sb().from('lead_tasks').select('*').eq('lead_id', id!).order('completed_at', { nullsFirst: true }).order('due_at')) as LeadTask[],
  });
}

export interface DuplicateLead {
  id: string;
  company_name: string;
  contact_person: string;
  status: LeadStatus;
  assigned_to_name: string | null;
  created_at: string;
}

/** Checks all leads (across owners) via a SECURITY DEFINER function that returns minimal fields. */
export async function findDuplicates(phone: string, email: string | undefined, excludeId?: string): Promise<DuplicateLead[]> {
  const { data, error } = await sb().rpc('find_duplicate_leads', { p_phone: phone, p_email: email ?? null, p_exclude: excludeId ?? null });
  if (error) return [];
  return (data ?? []) as DuplicateLead[];
}

/** Common invalidation after any lead change. */
export function useInvalidateLeads() {
  const qc = useQueryClient();
  return (id?: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['leads'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      id ? qc.invalidateQueries({ queryKey: ['lead', id] }) : null,
      id ? qc.invalidateQueries({ queryKey: ['lead-activities', id] }) : null,
    ]);
}

export function useSaveLead() {
  const { t } = useTranslation();
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: async ({ id, values, userId }: { id?: string; values: LeadFormValues; userId: string }) => {
      const row = { ...values, email: values.email ?? null, city: values.city ?? null, industry: values.industry ?? null, employee_count: values.employee_count ?? null, existing_hrms: values.existing_hrms ?? null, remarks: values.remarks ?? null };
      if (id) return unwrap(await sb().from('leads').update(row).eq('id', id).select('id').single()) as { id: string };
      const created = unwrap(await sb().from('leads').insert({ ...row, created_by: userId }).select('id').single()) as { id: string };
      if (values.communication_consent) {
        await sb().from('communication_consents').insert({ lead_id: created.id, phone: values.phone, email: values.email ?? null, channel: 'phone', granted: true, source: 'staff_entry', wording: 'Consent confirmed by sales staff' });
      }
      return created;
    },
    onSuccess: async (res, vars) => {
      toast.success(vars.id ? t('crm.updated') : t('crm.leadCreated'));
      await invalidate(res.id);
    },
    onError: (err) => toast.error(t(errorKey(err), { defaultValue: t('errors.generic') })),
  });
}

/** Optimistic status change (used by the Kanban board). */
export function useUpdateLeadStatus() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invalidate = useInvalidateLeads();
  return useMutation({
    mutationFn: async ({ id, status, lost_reason }: { id: string; status: LeadStatus; lost_reason?: string }) =>
      unwrap(await sb().from('leads').update({ status, ...(lost_reason !== undefined ? { lost_reason } : {}) }).eq('id', id).select('id').single()),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const snapshots = qc.getQueriesData<Lead[]>({ queryKey: ['leads'] });
      for (const [key, data] of snapshots) if (data) qc.setQueryData(key, data.map((l) => (l.id === id ? { ...l, status } : l)));
      return { snapshots };
    },
    onError: (err, _v, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(t(errorKey(err), { defaultValue: t('errors.generic') }));
    },
    onSettled: (_d, _e, vars) => invalidate(vars.id),
  });
}
