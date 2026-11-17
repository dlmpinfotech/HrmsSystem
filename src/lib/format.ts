import { TIMEZONE } from '@shared/constants';

const localeOf = (lang: string) => (lang === 'ta' ? 'ta-IN' : 'en-IN');

export function formatCurrency(amount: number | null | undefined, lang = 'en', currency = 'INR'): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—';
  return new Intl.NumberFormat(localeOf(lang), { style: 'currency', currency, maximumFractionDigits: Number(amount) % 1 === 0 ? 0 : 2 }).format(Number(amount));
}

export function formatNumber(value: number | null | undefined, lang = 'en'): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(localeOf(lang)).format(value);
}

export function formatCompact(value: number, lang = 'en'): string {
  return new Intl.NumberFormat(localeOf(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number, digits = 0): string {
  return `${(Number.isFinite(value) ? value * 100 : 0).toFixed(digits)}%`;
}

/** Dates are stored in UTC and always displayed in Asia/Kolkata. */
export function formatDate(iso: string | null | undefined, lang = 'en'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(localeOf(lang), { timeZone: TIMEZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined, lang = 'en'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined, lang = 'en'): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(localeOf(lang), { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

export function formatRelative(iso: string | null | undefined, lang = 'en'): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(localeOf(lang), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60_000) return rtf.format(0, 'minute');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return formatDate(iso, lang);
}

/** Value for <input type="datetime-local"> representing the instant in IST. */
export function toIstInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

/** Parses a datetime-local value entered as IST wall-clock time into a UTC ISO string. */
export function fromIstInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(`${value.length === 16 ? `${value}:00` : value}Z`);
  return Number.isNaN(ms) ? null : new Date(ms - 330 * 60_000).toISOString();
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
