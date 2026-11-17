/**
 * Demo slot computation. Availability is defined in Asia/Kolkata wall-clock time;
 * everything is stored and exchanged in UTC. IST has a fixed +05:30 offset (no DST).
 */
export const IST_OFFSET_MINUTES = 330;

export interface Availability {
  salesperson_id: string;
  weekday: number; // 0 = Sunday
  start_time: string; // HH:MM[:SS]
  end_time: string;
  slot_minutes: number;
  is_active: boolean;
}

export interface BookedSlot {
  salesperson_id: string | null;
  starts_at: string;
  ends_at: string;
}

export interface Slot {
  starts_at: string; // ISO UTC
  ends_at: string;
  salesperson_ids: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Converts an IST calendar date + wall-clock minutes to a UTC Date. */
export function istToUtc(date: string, time: string | number): Date {
  const [y, m, d] = date.split('-').map(Number);
  const minutes = typeof time === 'number' ? time : timeToMinutes(time);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes - IST_OFFSET_MINUTES));
}

/** YYYY-MM-DD of the given instant in IST. */
export function istDateString(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Day of week (0 = Sunday) for an IST calendar date. */
export function istWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** UTC range [start, end) covering one IST calendar day. */
export function istDayRange(date: string): { start: Date; end: Date } {
  return { start: istToUtc(date, 0), end: istToUtc(date, 24 * 60) };
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface SlotOptions {
  now: Date;
  /** Minimum notice before a slot can be booked. */
  minLeadMinutes?: number;
}

/**
 * Open slots for one IST date. A slot is offered when at least one salesperson is
 * available and has no overlapping live booking.
 */
export function generateSlots(
  date: string,
  availability: Availability[],
  booked: BookedSlot[],
  { now, minLeadMinutes = 0 }: SlotOptions,
): Slot[] {
  if (!isValidDateString(date)) return [];
  const weekday = istWeekday(date);
  const earliest = now.getTime() + minLeadMinutes * 60_000;
  const slots = new Map<string, Slot>();

  for (const rule of availability) {
    if (!rule.is_active || rule.weekday !== weekday || rule.slot_minutes <= 0) continue;
    const startMin = timeToMinutes(rule.start_time);
    const endMin = timeToMinutes(rule.end_time);
    const busy = booked
      .filter((b) => b.salesperson_id === rule.salesperson_id)
      .map((b) => [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()] as const);

    for (let t = startMin; t + rule.slot_minutes <= endMin; t += rule.slot_minutes) {
      const start = istToUtc(date, t).getTime();
      const end = start + rule.slot_minutes * 60_000;
      if (start < earliest) continue;
      if (busy.some(([bs, be]) => overlaps(start, end, bs, be))) continue;

      const key = `${start}-${end}`;
      const existing = slots.get(key);
      if (existing) {
        if (!existing.salesperson_ids.includes(rule.salesperson_id)) existing.salesperson_ids.push(rule.salesperson_id);
      } else {
        slots.set(key, {
          starts_at: new Date(start).toISOString(),
          ends_at: new Date(end).toISOString(),
          salesperson_ids: [rule.salesperson_id],
        });
      }
    }
  }

  return [...slots.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

/** Picks the available salesperson with the fewest upcoming demos (stable tie-break by id). */
export function pickSalesperson(candidates: string[], load: Record<string, number>): string | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (load[a] ?? 0) - (load[b] ?? 0) || a.localeCompare(b))[0];
}

export function formatIst(iso: string, locale = 'en-IN'): { date: string; time: string; weekday: string } {
  const d = new Date(iso);
  return {
    date: new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(d),
    time: new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(d),
    weekday: new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(d),
  };
}
