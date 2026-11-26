import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { addMonths } from '@shared/pickers';
import { formatMinutes, type DayStatus } from '@shared/hr';
import { istWeekday } from '@shared/slots';

/** One colour language for attendance, built from theme tokens. */
export const STATUS_STYLE: Record<DayStatus, { cell: string; dot: string; bar: string }> = {
  present: { cell: 'bg-success/10 border-success/30', dot: 'bg-success', bar: 'bg-success' },
  late: { cell: 'bg-warning/10 border-warning/35', dot: 'bg-warning', bar: 'bg-warning' },
  half_day: { cell: 'bg-warning/10 border-warning/35', dot: 'bg-warning', bar: 'bg-warning/60' },
  absent: { cell: 'bg-destructive/10 border-destructive/25', dot: 'bg-destructive', bar: 'bg-destructive' },
  on_leave: { cell: 'bg-brand-2/15 border-brand-2/40', dot: 'bg-brand-2', bar: 'bg-brand-2' },
  holiday: { cell: 'bg-primary/10 border-primary/30', dot: 'bg-primary', bar: 'bg-primary' },
  weekly_off: { cell: 'bg-muted/60 border-transparent', dot: 'bg-muted-foreground/40', bar: 'bg-muted-foreground/30' },
  upcoming: { cell: 'border-dashed', dot: 'bg-transparent', bar: 'bg-transparent' },
  not_joined: { cell: 'border-transparent opacity-40', dot: 'bg-transparent', bar: 'bg-transparent' },
};

const TILE_TONE = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-brand-2/15 text-foreground',
  primary: 'bg-primary/10 text-primary',
  neutral: 'bg-muted text-muted-foreground',
} as const;
export type TileTone = keyof typeof TILE_TONE;

/** Compact summary tile. With onClick it also works as a filter button. */
export function StatTile({ label, value, icon: Icon, tone, active, onClick }: { label: string; value: React.ReactNode; icon: LucideIcon; tone: TileTone; active?: boolean; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick, 'aria-pressed': Boolean(active) } : {})}
      className={cn(
        'flex min-w-0 flex-col items-start gap-2 rounded-xl border bg-card p-3 text-left shadow-sm sm:flex-row sm:items-center sm:gap-3',
        onClick && 'transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active && 'border-primary bg-primary/5 ring-1 ring-primary',
      )}
    >
      <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-lg', TILE_TONE[tone])}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block font-display text-xl font-extrabold leading-tight tabular">{value}</span>
        <span className="block break-words text-xs leading-snug text-muted-foreground">{label}</span>
      </span>
    </Tag>
  );
}

export function MonthSwitcher({ month, max, onChange, label }: { month: string; max: string; onChange: (month: string) => void; label: string }) {
  const { t } = useTranslation();
  const step = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const next = addMonths(y, m, delta);
    onChange(`${next.y}-${String(next.m).padStart(2, '0')}`);
  };
  return (
    <div className="flex w-full items-center gap-1.5 sm:w-auto">
      <Button variant="outline" size="icon" className="shrink-0" aria-label={t('leave.prevMonth')} onClick={() => step(-1)}><ChevronLeft /></Button>
      <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">
        <Input type="month" required aria-label={label} value={month} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} />
      </div>
      <Button variant="outline" size="icon" className="shrink-0" aria-label={t('leave.nextMonth')} disabled={month >= max} onClick={() => step(1)}><ChevronRight /></Button>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon: LucideIcon }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border bg-muted/50 p-1">
      {options.map(({ value: v, label: text, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', value === v ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          <Icon className="size-4" aria-hidden />
          {text}
        </button>
      ))}
    </div>
  );
}

export interface CalendarDay {
  date: string;
  status: DayStatus;
  minutes: number | null | undefined;
}

/** Month at a glance. Weeks start on Sunday, like the date picker. */
export function AttendanceCalendar({ days, selected, today, onSelect, formatDay }: { days: CalendarDay[]; selected: string; today: string; onSelect: (date: string) => void; formatDay: (date: string) => string }) {
  const { t, i18n } = useTranslation();
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(i18n.language === 'ta' ? 'ta-IN' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 1, 1 + i))));
  const offset = days.length ? istWeekday(days[0].date) : 0;
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:gap-2" aria-hidden>
        {weekdays.map((w) => <span key={w} className="truncate">{w}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} aria-hidden />)}
        {days.map((d) => {
          const style = STATUS_STYLE[d.status];
          const quiet = d.status === 'upcoming' || d.status === 'not_joined';
          return (
            <button
              key={d.date}
              type="button"
              disabled={quiet}
              aria-pressed={selected === d.date}
              aria-label={`${formatDay(d.date)}${quiet ? '' : ` · ${t(`dayStatus.${d.status}`)}`}`}
              onClick={() => onSelect(d.date)}
              className={cn(
                'relative flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg border p-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:-translate-y-0.5 enabled:hover:shadow-md disabled:cursor-default sm:min-h-[4.5rem] sm:items-start sm:justify-between sm:p-2',
                style.cell,
                selected === d.date && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
              )}
            >
              <span className={cn('text-sm font-bold tabular leading-none', d.date === today && 'inline-flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground')}>{Number(d.date.slice(8))}</span>
              {!quiet && <span className={cn('size-1.5 rounded-full sm:hidden', style.dot)} aria-hidden />}
              {!quiet && (
                <span className="hidden w-full items-center gap-1.5 text-[11px] font-medium sm:flex">
                  <span className={cn('size-2 shrink-0 rounded-full', style.dot)} aria-hidden />
                  <span className="truncate">{d.minutes ? formatMinutes(d.minutes) : t(`dayStatus.${d.status}`)}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(['present', 'late', 'half_day', 'absent', 'on_leave', 'holiday', 'weekly_off'] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5"><span className={cn('size-2.5 rounded-full', STATUS_STYLE[s].dot)} aria-hidden />{t(`dayStatus.${s}`)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Date block + status + in → out + hours. Used by the list view and the calendar's selected day. */
export function DayRow({ date, status, inTime, outTime, minutes, badges, action }: { date: string; status: DayStatus; inTime: string; outTime: string; minutes: number | null | undefined; badges: React.ReactNode; action?: React.ReactNode }) {
  const { i18n } = useTranslation();
  const at = new Date(`${date}T00:00:00Z`);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(i18n.language === 'ta' ? 'ta-IN' : 'en-GB', { ...o, timeZone: 'UTC' }).format(at);
  const worked = Boolean(inTime || outTime);
  return (
    <div className="relative flex items-center gap-3 py-3 pl-4 pr-3">
      <span className={cn('absolute inset-y-2 left-0 w-1 rounded-full', STATUS_STYLE[status].bar)} aria-hidden />
      <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-muted/70 py-1.5">
        <span className="font-display text-lg font-extrabold leading-none tabular">{Number(date.slice(8))}</span>
        <span className="mt-0.5 text-[10px] font-semibold uppercase text-muted-foreground">{part({ weekday: 'short' })}</span>
      </span>
      <div className="min-w-0 flex-1 gap-3 md:flex md:items-center">
        <div className="flex flex-wrap items-center gap-1 md:w-56">{badges}</div>
        {worked && (
          <p className="mt-1 flex items-center gap-2 text-sm tabular md:mt-0">
            <span>{inTime || '—'}</span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span>{outTime || '—'}</span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {worked && <span className="text-sm font-bold tabular">{formatMinutes(minutes)}</span>}
        {action}
      </div>
    </div>
  );
}
