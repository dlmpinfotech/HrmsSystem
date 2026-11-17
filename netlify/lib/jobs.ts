import type { SupabaseClient } from '@supabase/supabase-js';
import type { Language } from '../../shared/constants';
import { formatIst } from '../../shared/slots';
import { demoVars, type BookingRow } from './demos';
import { hasWhatsAppConsent, notify, retryDueNotifications } from './notifications';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const inr = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
const locale = (lang: string | null | undefined) => (lang === 'ta' ? 'ta-IN' : 'en-IN');

type One<T> = T | T[] | null | undefined;
const one = <T>(v: One<T>): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

async function primaryContact(db: SupabaseClient, companyId: string) {
  const { data } = await db.from('customer_contacts').select('name, email, phone').eq('company_id', companyId).order('is_primary', { ascending: false }).limit(1);
  return data?.[0] ?? null;
}

/**
 * Periodic housekeeping, run hourly by the scheduled function. Every step is
 * idempotent: a marker column (or a dedupe key) guarantees each reminder goes out once.
 */
export async function runScheduledJobs(db: SupabaseClient, site: string) {
  const now = Date.now();
  const summary = { lifecycle: null as unknown, demo_reminders: 0, trial_reminders: 0, renewal_reminders: 0, task_reminders: 0, retried: 0 };

  // 1. Subscription lifecycle (trial expiry, past-due, cancellations).
  const { data: lifecycle, error: lifecycleError } = await db.rpc('expire_subscriptions');
  if (lifecycleError) console.error('[jobs] expire_subscriptions', lifecycleError.message);
  summary.lifecycle = lifecycle ?? null;

  // 2. Demo reminders: ~24h before and ~1h before.
  const { data: demos } = await db
    .from('demo_bookings')
    .select('*')
    .eq('status', 'scheduled')
    .gt('starts_at', new Date(now).toISOString())
    .lt('starts_at', new Date(now + DAY).toISOString());
  for (const row of demos ?? []) {
    const booking = row as BookingRow & { reminder_24h_at: string | null; reminder_1h_at: string | null };
    const startsIn = new Date(booking.starts_at).getTime() - now;
    const kind = startsIn <= 1.5 * HOUR ? '1h' : '24h';
    if (kind === '1h' ? booking.reminder_1h_at : booking.reminder_24h_at) continue;
    if (kind === '24h' && startsIn < 3 * HOUR) continue; // too close for the day-before reminder; the 1h one will follow

    const vars = demoVars(booking, site);
    const when =
      kind === '1h'
        ? booking.language === 'ta' ? 'சுமார் ஒரு மணி நேரத்தில்' : 'in about an hour'
        : booking.language === 'ta' ? `${vars.date} அன்று ${vars.time} மணிக்கு` : `on ${vars.date} at ${vars.time}`;
    await notify(db, {
      key: 'demo_reminder',
      email: booking.email,
      phone: booking.phone,
      whatsappConsent: await hasWhatsAppConsent(db, booking.phone),
      language: booking.language,
      vars: { ...vars, when },
      leadId: booking.lead_id,
      dedupeKey: `demo-reminder:${booking.id}:${kind}:${booking.reschedule_count}`,
    });
    const stamp = new Date().toISOString();
    // Marking the 1h reminder also closes the 24h one for late bookings.
    await db.from('demo_bookings').update(kind === '1h' ? { reminder_1h_at: stamp, reminder_24h_at: booking.reminder_24h_at ?? stamp } : { reminder_24h_at: stamp }).eq('id', booking.id);
    summary.demo_reminders++;
  }

  // 3. Trials ending within 3 days.
  const { data: trials } = await db
    .from('subscriptions')
    .select('id, company_id, trial_end, companies(name, default_language)')
    .eq('status', 'trialing')
    .is('trial_reminder_at', null)
    .gt('trial_end', new Date(now).toISOString())
    .lt('trial_end', new Date(now + 3 * DAY).toISOString());
  for (const sub of trials ?? []) {
    const company = one(sub.companies as One<{ name: string; default_language: Language }>);
    const contact = await primaryContact(db, sub.company_id);
    if (contact) {
      await notify(db, {
        key: 'trial_expiring',
        email: contact.email,
        phone: contact.phone,
        whatsappConsent: await hasWhatsAppConsent(db, contact.phone),
        language: company?.default_language ?? 'en',
        vars: { name: contact.name, company: company?.name ?? '', trial_end: formatIst(sub.trial_end, locale(company?.default_language)).date, portal_url: `${site}/portal/subscription` },
        companyId: sub.company_id,
        dedupeKey: `trial-expiring:${sub.id}:${sub.trial_end}`,
      });
    }
    await db.from('subscriptions').update({ trial_reminder_at: new Date().toISOString() }).eq('id', sub.id);
    summary.trial_reminders++;
  }

  // 4. Renewals due within 7 days.
  const { data: renewals } = await db
    .from('subscriptions')
    .select('id, company_id, amount, current_period_end, companies(name, default_language), plans(name)')
    .eq('status', 'active')
    .eq('cancel_at_period_end', false)
    .is('renewal_reminder_at', null)
    .gt('current_period_end', new Date(now).toISOString())
    .lt('current_period_end', new Date(now + 7 * DAY).toISOString());
  for (const sub of renewals ?? []) {
    const company = one(sub.companies as One<{ name: string; default_language: Language }>);
    const plan = one(sub.plans as One<{ name: string }>);
    const contact = await primaryContact(db, sub.company_id);
    if (contact) {
      await notify(db, {
        key: 'subscription_renewal',
        email: contact.email,
        phone: contact.phone,
        whatsappConsent: await hasWhatsAppConsent(db, contact.phone),
        language: company?.default_language ?? 'en',
        vars: {
          name: contact.name,
          company: company?.name ?? '',
          plan: plan?.name ?? '',
          renewal_date: formatIst(sub.current_period_end, locale(company?.default_language)).date,
          amount: inr(Number(sub.amount)),
          portal_url: `${site}/portal/subscription`,
        },
        companyId: sub.company_id,
        dedupeKey: `renewal:${sub.id}:${sub.current_period_end}`,
      });
    }
    await db.from('subscriptions').update({ renewal_reminder_at: new Date().toISOString() }).eq('id', sub.id);
    summary.renewal_reminders++;
  }

  // 5. Follow-up task reminders for the assigned salesperson (internal email).
  const { data: tasks } = await db
    .from('lead_tasks')
    .select('id, title, due_at, assigned_to, leads(id, company_name, contact_person, phone)')
    .is('completed_at', null)
    .is('reminded_at', null)
    .not('assigned_to', 'is', null)
    .lt('due_at', new Date(now + HOUR).toISOString())
    .limit(100);
  for (const task of tasks ?? []) {
    const lead = one(task.leads as One<{ id: string; company_name: string; contact_person: string; phone: string }>);
    const { data: assignee } = await db.from('profiles').select('full_name, email, is_active').eq('id', task.assigned_to).maybeSingle();
    if (lead && assignee?.is_active) {
      await notify(db, {
        key: 'follow_up_reminder',
        channels: ['email'],
        email: assignee.email,
        vars: {
          name: assignee.full_name || 'there',
          company: `${lead.company_name} — ${task.title}`,
          contact: lead.contact_person,
          phone: lead.phone,
          due: `${formatIst(task.due_at).date}, ${formatIst(task.due_at).time}`,
          lead_url: `${site}/admin/leads/${lead.id}`,
        },
        leadId: lead.id,
        dedupeKey: `task-reminder:${task.id}`,
      });
    }
    await db.from('lead_tasks').update({ reminded_at: new Date().toISOString() }).eq('id', task.id);
    summary.task_reminders++;
  }

  // 6. Retry failed notifications whose backoff has elapsed.
  summary.retried = await retryDueNotifications(db);
  return summary;
}
