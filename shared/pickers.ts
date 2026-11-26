/** Pure helpers for the date, month and time pickers. Values use the same text formats as native inputs. */

const pad = (n: number) => String(n).padStart(2, '0');

export interface Ymd {
  y: number;
  m: number; // 1–12
  d: number;
}

export function parseDate(value: string | null | undefined): Ymd | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? { y, m, d } : null;
}

export const toDateValue = ({ y, m, d }: Ymd) => `${y}-${pad(m)}-${pad(d)}`;

export function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1 };
}

export function shiftDays(value: string, delta: number): string {
  const p = parseDate(value)!;
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d + delta));
  return toDateValue({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });
}

/** Six Sunday-first weeks covering the month, as date values. */
export function calendarGrid(y: number, m: number): string[] {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = `${y}-${pad(m)}-01`;
  const offset = first.getUTCDay();
  return Array.from({ length: 42 }, (_, i) => shiftDays(start, i - offset));
}

/** True when `value` is outside the min / max given to the field. Works for dates and months. */
export function outOfRange(value: string, min?: string | number, max?: string | number): boolean {
  const lo = min ? String(min).slice(0, value.length) : '';
  const hi = max ? String(max).slice(0, value.length) : '';
  return (lo !== '' && value < lo) || (hi !== '' && value > hi);
}

export interface Time12 {
  hour: number; // 1–12
  minute: number;
  pm: boolean;
}

export function parseTime(value: string | null | undefined): Time12 | null {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const h = Number(match[1]);
  const minute = Number(match[2]);
  if (h > 23 || minute > 59) return null;
  return { hour: h % 12 === 0 ? 12 : h % 12, minute, pm: h >= 12 };
}

export const toTimeValue = ({ hour, minute, pm }: Time12) => `${pad((hour % 12) + (pm ? 12 : 0))}:${pad(minute)}`;

const locale = (lang: string) => (lang === 'ta' ? 'ta-IN' : 'en-GB');

export function monthName(m: number, lang: string, style: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat(locale(lang), { month: style, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 1))).replace(/^Sept$/, 'Sep');
}

/** "13-Nov-2026" */
export function displayDate(value: string, lang: string): string {
  const p = parseDate(value);
  return p ? `${pad(p.d)}-${monthName(p.m, lang)}-${p.y}` : '';
}

/** "November 2026" */
export function displayMonth(value: string, lang: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? `${monthName(Number(match[2]), lang, 'long')} ${match[1]}` : '';
}

/** "09:30 AM" */
export function displayTime(value: string): string {
  const t = parseTime(value);
  return t ? `${pad(t.hour)}:${pad(t.minute)} ${t.pm ? 'PM' : 'AM'}` : '';
}
