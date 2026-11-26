import type { SupabaseClient } from '@supabase/supabase-js';
import type { Language } from '../../shared/constants';
import { notify } from './notifications';

const HOUR = 3_600_000;
export const REMIND_AFTER_HOURS = 24;
export const ESCALATE_AFTER_HOURS = 72;
/** Digests go out once a day, from 9 am IST. */
const SEND_FROM_IST_HOUR = 9;

export interface PendingItem {
  kind: 'leave' | 'comp_off' | 'regularization' | 'encashment' | 'helpdesk';
  companyId: string;
  employeeId: string;
  employeeName: string;
  createdAt: string;
  label: string;
  /** Who can act on it first: the reporting manager (two-step leave, step 1) or HR. */
  managerUserId: string | null;
}

type Row = Record<string, unknown> & { company_id: string; employee_id: string; created_at: string; employees?: { full_name?: string; reporting_manager_id?: string | null } | null };

const istDate = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
const istHour = (ms: number) => new Date(ms + 330 * 60_000).getUTCHours();
const hoursWaiting = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / HOUR);

/** One line per item, e.g. "• Leave · Priya · 2026-12-03 – 2026-12-05 · waiting 30 h". */
export function itemLines(items: PendingItem[], now: number, lang: Language): string {
  const kind = lang === 'ta'
    ? { leave: 'விடுப்பு', comp_off: 'மாற்று விடுப்பு', regularization: 'வருகைத் திருத்தம்', encashment: 'விடுப்புப் பணமாக்கல்', helpdesk: 'HR உதவிக் கோரிக்கை' }
    : { leave: 'Leave', comp_off: 'Comp-off', regularization: 'Attendance correction', encashment: 'Leave encashment', helpdesk: 'Helpdesk ticket' };
  const waiting = (h: number) => (lang === 'ta' ? `${h} மணி காத்திருப்பு` : `waiting ${h} h`);
  return items
    .slice(0, 30)
    .map((i) => `• ${kind[i.kind]} · ${i.employeeName} · ${i.label} · ${waiting(hoursWaiting(i.createdAt, now))}`)
    .concat(items.length > 30 ? [lang === 'ta' ? `… மேலும் ${items.length - 30}` : `… and ${items.length - 30} more`] : [])
    .join('\n');
}

async function loadPending(db: SupabaseClient, before: string): Promise<PendingItem[]> {
  const emp = 'employees(full_name, reporting_manager_id)';
  const [leave, comp, regs, enc, desk] = await Promise.all([
    db.from('leave_requests').select(`id, company_id, employee_id, created_at, start_date, end_date, days, hours, approval_step, leave_types(name, approval_levels), ${emp}`).eq('status', 'pending').lt('created_at', before).limit(2000),
    db.from('comp_off_credits').select(`id, company_id, employee_id, created_at, work_date, days, ${emp}`).eq('status', 'pending').lt('created_at', before).limit(1000),
    db.from('attendance_regularizations').select(`id, company_id, employee_id, created_at, work_date, ${emp}`).eq('status', 'pending').lt('created_at', before).limit(1000),
    db.from('leave_encashments').select(`id, company_id, employee_id, created_at, days, year, ${emp}`).eq('status', 'pending').lt('created_at', before).limit(1000),
    // Unanswered helpdesk tickets past their answer-by time. The subject is left out: it can be sensitive.
    db.from('hr_tickets').select(`id, company_id, employee_id, created_at, ticket_no, ${emp}`).eq('status', 'open').is('first_response_at', null).lt('due_at', new Date().toISOString()).lt('created_at', before).limit(1000),
  ]);
  const name = (r: Row) => r.employees?.full_name ?? '—';
  const items: PendingItem[] = [];
  for (const r of (leave.data ?? []) as Row[]) {
    const lt = (r.leave_types ?? {}) as { name?: string; approval_levels?: number };
    const range = r.start_date === r.end_date ? String(r.start_date) : `${r.start_date} – ${r.end_date}`;
    items.push({
      kind: 'leave', companyId: r.company_id, employeeId: r.employee_id, employeeName: name(r), createdAt: r.created_at,
      label: `${lt.name ?? ''} · ${range}`,
      managerUserId: r.approval_step === 1 ? ((r.employees?.reporting_manager_id as string | null) ?? null) : null,
    });
  }
  for (const r of (comp.data ?? []) as Row[]) items.push({ kind: 'comp_off', companyId: r.company_id, employeeId: r.employee_id, employeeName: name(r), createdAt: r.created_at, label: String(r.work_date), managerUserId: null });
  for (const r of (regs.data ?? []) as Row[]) items.push({ kind: 'regularization', companyId: r.company_id, employeeId: r.employee_id, employeeName: name(r), createdAt: r.created_at, label: String(r.work_date), managerUserId: null });
  for (const r of (enc.data ?? []) as Row[]) items.push({ kind: 'encashment', companyId: r.company_id, employeeId: r.employee_id, employeeName: name(r), createdAt: r.created_at, label: `${r.days} · ${r.year}`, managerUserId: null });
  for (const r of (desk.data ?? []) as Row[]) items.push({ kind: 'helpdesk', companyId: r.company_id, employeeId: r.employee_id, employeeName: name(r), createdAt: r.created_at, label: `#${r.ticket_no}`, managerUserId: null });
  return items;
}

/**
 * Daily digest of approvals waiting more than a day (to HR, and to reporting managers
 * for their team's first-step leave), and an escalation to Company Admins for anything
 * waiting more than three days. Each email is deduplicated per person per day.
 */
export async function runHrReminders(db: SupabaseClient, site: string, now = Date.now()) {
  const summary = { digests: 0, escalations: 0 };
  if (istHour(now) < SEND_FROM_IST_HOUR) return summary;
  const today = istDate(now);
  // Companies may set their own limits (hr_settings); load with the smallest possible wait, then filter.
  const { data: settings } = await db.from('hr_settings').select('company_id, remind_after_hours, escalate_after_hours');
  const limits = new Map(((settings ?? []) as { company_id: string; remind_after_hours: number; escalate_after_hours: number }[]).map((s) => [s.company_id, s]));
  const limitFor = (companyId: string) => ({
    remind: limits.get(companyId)?.remind_after_hours ?? REMIND_AFTER_HOURS,
    escalate: limits.get(companyId)?.escalate_after_hours ?? ESCALATE_AFTER_HOURS,
  });
  const smallest = Math.min(REMIND_AFTER_HOURS, ...[...limits.values()].map((s) => s.remind_after_hours));
  const items = (await loadPending(db, new Date(now - smallest * HOUR).toISOString())).filter((i) => hoursWaiting(i.createdAt, now) >= limitFor(i.companyId).remind);
  if (!items.length) return summary;

  const byCompany = new Map<string, PendingItem[]>();
  for (const i of items) byCompany.set(i.companyId, [...(byCompany.get(i.companyId) ?? []), i]);

  for (const [companyId, list] of byCompany) {
    const [{ data: company }, { data: members }] = await Promise.all([
      db.from('companies').select('name, status').eq('id', companyId).maybeSingle(),
      db.from('company_memberships').select('user_id, role, profiles(full_name, email, is_active, preferred_language)').eq('company_id', companyId).in('role', ['customer_admin', 'hr_manager']),
    ]);
    if (!company || ['suspended', 'cancelled'].includes(company.status as string)) continue;
    type M = { user_id: string; role: string; profiles: { full_name: string | null; email: string | null; is_active: boolean; preferred_language: string | null } | null };
    const active = ((members ?? []) as unknown as M[]).filter((m) => m.profiles?.is_active && m.profiles.email);
    const url = `${site}/portal/leave?tab=approvals`;

    // Digest to every HR person.
    for (const m of active) {
      const lang: Language = m.profiles!.preferred_language === 'ta' ? 'ta' : 'en';
      await notify(db, {
        key: 'hr_pending_digest', channels: ['email'], email: m.profiles!.email, language: lang, companyId,
        vars: { name: m.profiles!.full_name || m.profiles!.email!, count: String(list.length), company: company.name as string, items: itemLines(list, now, lang), url },
        dedupeKey: `hr-digest:${companyId}:${m.user_id}:${today}`,
      });
      summary.digests++;
    }

    // Reporting managers (not HR) get their own team's first-step leave.
    const managerEmployeeIds = [...new Set(list.map((i) => i.managerUserId).filter(Boolean))] as string[];
    if (managerEmployeeIds.length) {
      const { data: managers } = await db.from('employees').select('id, user_id, full_name, email, profiles:user_id(is_active, preferred_language)').in('id', managerEmployeeIds).not('user_id', 'is', null);
      for (const mgr of (managers ?? []) as unknown as { id: string; user_id: string; full_name: string; email: string | null; profiles: { is_active: boolean; preferred_language: string | null } | null }[]) {
        if (!mgr.email || !mgr.profiles?.is_active || active.some((a) => a.user_id === mgr.user_id)) continue;
        const mine = list.filter((i) => i.managerUserId === mgr.id);
        const lang: Language = mgr.profiles.preferred_language === 'ta' ? 'ta' : 'en';
        await notify(db, {
          key: 'hr_pending_digest', channels: ['email'], email: mgr.email, language: lang, companyId,
          vars: { name: mgr.full_name, count: String(mine.length), company: company.name as string, items: itemLines(mine, now, lang), url: `${site}/portal/leave?tab=team` },
          dedupeKey: `mgr-digest:${companyId}:${mgr.user_id}:${today}`,
        });
        summary.digests++;
      }
    }

    // Escalate long waits to Company Admins.
    const escalateAfter = limitFor(companyId).escalate;
    const overdue = list.filter((i) => hoursWaiting(i.createdAt, now) >= escalateAfter);
    if (overdue.length) {
      for (const a of active.filter((m) => m.role === 'customer_admin')) {
        const lang: Language = a.profiles!.preferred_language === 'ta' ? 'ta' : 'en';
        await notify(db, {
          key: 'approval_escalation', channels: ['email'], email: a.profiles!.email, language: lang, companyId,
          vars: { name: a.profiles!.full_name || a.profiles!.email!, count: String(overdue.length), hours: String(escalateAfter), company: company.name as string, items: itemLines(overdue, now, lang), url },
          dedupeKey: `hr-escalation:${companyId}:${a.user_id}:${today}`,
        });
        summary.escalations++;
      }
    }
  }
  return summary;
}
