import { OPEN_LEAD_STATUSES, TIMEZONE, type LeadStatus } from '@shared/constants';

/** Pure aggregation helpers for the dashboard and reports (unit-tested). */

export interface DateRange {
  from: Date;
  to: Date;
}

export const RANGE_PRESETS = ['7d', '30d', '90d', '12m', 'ytd'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export function presetRange(preset: RangePreset, now = new Date()): DateRange {
  const to = now;
  const from = new Date(now);
  if (preset === '7d') from.setDate(from.getDate() - 7);
  else if (preset === '30d') from.setDate(from.getDate() - 30);
  else if (preset === '90d') from.setDate(from.getDate() - 90);
  else if (preset === '12m') from.setMonth(from.getMonth() - 12);
  else from.setMonth(0, 1), from.setHours(0, 0, 0, 0);
  return { from, to };
}

export function inRange(iso: string | null | undefined, range: DateRange): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}

export function rate(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function countBy<T>(rows: T[], key: (row: T) => string | null | undefined): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) || 'unknown';
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

/** IST calendar bucket key: day (YYYY-MM-DD) or month (YYYY-MM). */
export function bucketKey(iso: string, unit: 'day' | 'month'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return unit === 'day' ? parts : parts.slice(0, 7);
}

export function bucketUnit(range: DateRange): 'day' | 'month' {
  return range.to.getTime() - range.from.getTime() > 92 * 86_400_000 ? 'month' : 'day';
}

/** Continuous series (zero-filled) of buckets across the range. */
export function timeSeries<T>(rows: T[], dateOf: (r: T) => string | null, range: DateRange, valueOf: (r: T) => number = () => 1) {
  const unit = bucketUnit(range);
  const keys: string[] = [];
  const cursor = new Date(range.from);
  while (cursor <= range.to) {
    const k = bucketKey(cursor.toISOString(), unit);
    if (keys[keys.length - 1] !== k) keys.push(k);
    if (unit === 'day') cursor.setDate(cursor.getDate() + 1);
    else cursor.setMonth(cursor.getMonth() + 1, 1);
  }
  const endKey = bucketKey(range.to.toISOString(), unit);
  if (keys[keys.length - 1] !== endKey) keys.push(endKey);
  const totals = new Map(keys.map((k) => [k, 0]));
  for (const r of rows) {
    const d = dateOf(r);
    if (!d || !inRange(d, range)) continue;
    const k = bucketKey(d, unit);
    if (totals.has(k)) totals.set(k, totals.get(k)! + valueOf(r));
  }
  return keys.map((k) => ({ key: k, value: totals.get(k) ?? 0 }));
}

/** Monthly recurring revenue from active subscriptions (yearly / quarterly normalised to monthly). */
export function computeMrr(subs: { status: string; amount: number; billing_frequency: string }[]): number {
  return subs
    .filter((s) => s.status === 'active' || s.status === 'past_due')
    .reduce((sum, s) => sum + Number(s.amount) / (s.billing_frequency === 'yearly' ? 12 : s.billing_frequency === 'quarterly' ? 3 : 1), 0);
}

export interface LeadLike {
  status: LeadStatus;
  source: string;
  city: string | null;
  industry: string | null;
  assigned_to: string | null;
  created_at: string;
  expected_value?: number | null;
}

export function funnel(leads: LeadLike[]) {
  const reached = (s: LeadStatus) => {
    const order: LeadStatus[] = ['new', 'contacted', 'qualified', 'demo_scheduled', 'demo_completed', 'trial', 'negotiation', 'won'];
    const idx = order.indexOf(s);
    return leads.filter((l) => l.status !== 'lost' && order.indexOf(l.status) >= idx).length;
  };
  return (['new', 'contacted', 'qualified', 'demo_scheduled', 'demo_completed', 'trial', 'negotiation', 'won'] as LeadStatus[]).map((s) => ({ name: s, value: reached(s) }));
}

export function leadSummary(leads: LeadLike[]) {
  const won = leads.filter((l) => l.status === 'won').length;
  const lost = leads.filter((l) => l.status === 'lost').length;
  const open = leads.filter((l) => OPEN_LEAD_STATUSES.includes(l.status)).length;
  return { total: leads.length, won, lost, open, winRate: rate(won, won + lost), conversion: rate(won, leads.length) };
}

/** Per-dimension performance (source, city, industry, salesperson). */
export function performanceBy(leads: LeadLike[], key: (l: LeadLike) => string | null) {
  const map = new Map<string, { name: string; total: number; won: number; lost: number; value: number }>();
  for (const l of leads) {
    const k = key(l) || 'unknown';
    const row = map.get(k) ?? { name: k, total: 0, won: 0, lost: 0, value: 0 };
    row.total++;
    if (l.status === 'won') {
      row.won++;
      row.value += Number(l.expected_value ?? 0);
    }
    if (l.status === 'lost') row.lost++;
    map.set(k, row);
  }
  return [...map.values()].map((r) => ({ ...r, conversion: rate(r.won, r.total) })).sort((a, b) => b.total - a.total);
}
