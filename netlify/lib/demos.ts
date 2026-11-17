import type { SupabaseClient } from '@supabase/supabase-js';
import type { Language } from '../../shared/constants';
import {
  addDays,
  formatIst,
  generateSlots,
  istDateString,
  istDayRange,
  pickSalesperson,
  type Availability,
  type BookedSlot,
  type Slot,
} from '../../shared/slots';
import { HttpError } from './http';
import { getDemoSettings } from './settings';

/** Active availability rules belonging to active sales users only. */
async function loadAvailability(db: SupabaseClient): Promise<Availability[]> {
  const [{ data: rules }, { data: sales }] = await Promise.all([
    db.from('demo_availability').select('salesperson_id, weekday, start_time, end_time, slot_minutes, is_active').eq('is_active', true),
    db.from('user_roles').select('user_id, profiles!user_roles_user_id_fkey(is_active)').in('role_key', ['super_admin', 'sales_admin', 'sales_executive']),
  ]);
  const active = new Set(
    (sales ?? [])
      .filter((r) => {
        const p = r.profiles as { is_active?: boolean } | { is_active?: boolean }[] | null;
        return Array.isArray(p) ? p[0]?.is_active : p?.is_active;
      })
      .map((r) => r.user_id as string),
  );
  return ((rules ?? []) as Availability[]).filter((r) => active.has(r.salesperson_id));
}

async function loadBooked(db: SupabaseClient, fromIso: string, toIso: string, excludeId?: string): Promise<BookedSlot[]> {
  let q = db
    .from('demo_bookings')
    .select('id, salesperson_id, starts_at, ends_at')
    .eq('status', 'scheduled')
    .lt('starts_at', toIso)
    .gt('ends_at', fromIso);
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q;
  return (data ?? []) as BookedSlot[];
}

export async function slotsForDates(
  db: SupabaseClient,
  from: string,
  days: number,
  excludeBookingId?: string,
): Promise<{ date: string; slots: Slot[] }[]> {
  const settings = await getDemoSettings(db);
  const now = new Date();
  const today = istDateString(now);
  const lastAllowed = addDays(today, settings.max_days_ahead);
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    if (d >= today && d <= lastAllowed) dates.push(d);
  }
  if (dates.length === 0) return [];

  const [availability, booked] = await Promise.all([
    loadAvailability(db),
    loadBooked(db, istDayRange(dates[0]).start.toISOString(), istDayRange(dates[dates.length - 1]).end.toISOString(), excludeBookingId),
  ]);
  return dates.map((date) => ({
    date,
    slots: generateSlots(date, availability, booked, { now, minLeadMinutes: settings.min_lead_hours * 60 }),
  }));
}

/** Finds the requested slot among currently open slots, or throws 409. */
export async function resolveSlot(db: SupabaseClient, startsAt: string, excludeBookingId?: string): Promise<Slot> {
  const date = istDateString(new Date(startsAt));
  const [day] = await slotsForDates(db, date, 1, excludeBookingId);
  const wanted = new Date(startsAt).getTime();
  const slot = day?.slots.find((s) => new Date(s.starts_at).getTime() === wanted);
  if (!slot) throw new HttpError(409, 'slot_unavailable', 'That time is no longer available. Please choose another slot.');
  return slot;
}

/** Candidates ordered by lightest upcoming workload. */
export async function rankSalespeople(db: SupabaseClient, candidates: string[]): Promise<string[]> {
  const { data } = await db
    .from('demo_bookings')
    .select('salesperson_id')
    .eq('status', 'scheduled')
    .gte('starts_at', new Date().toISOString())
    .in('salesperson_id', candidates);
  const load: Record<string, number> = {};
  for (const row of data ?? []) load[row.salesperson_id as string] = (load[row.salesperson_id as string] ?? 0) + 1;
  const ordered: string[] = [];
  const pool = [...candidates];
  while (pool.length) {
    const next = pickSalesperson(pool, load)!;
    ordered.push(next);
    pool.splice(pool.indexOf(next), 1);
  }
  return ordered;
}

export interface BookingRow {
  id: string;
  starts_at: string;
  ends_at: string;
  contact_name: string;
  company_name: string;
  email: string | null;
  phone: string;
  language: Language;
  mode: string;
  meeting_url: string | null;
  manage_token: string;
  lead_id: string | null;
  salesperson_id: string | null;
  status: string;
  reschedule_count: number;
}

/** Template variables shared by all demo notifications. */
export function demoVars(booking: BookingRow, site: string, modeLabel?: string) {
  const locale = booking.language === 'ta' ? 'ta-IN' : 'en-IN';
  const when = formatIst(booking.starts_at, locale);
  return {
    name: booking.contact_name,
    company: booking.company_name,
    date: `${when.weekday}, ${when.date}`,
    time: when.time,
    mode: modeLabel ?? booking.mode,
    meeting_line: booking.meeting_url ? `Link: ${booking.meeting_url}` : '',
    manage_url: `${site}/demo/manage/${booking.manage_token}`,
    demo_url: `${site}/book-demo`,
  };
}
