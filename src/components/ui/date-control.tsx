import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  addMonths, calendarGrid, displayDate, displayMonth, displayTime, monthName, outOfRange, parseDate, parseTime, shiftDays, toDateValue, toTimeValue, type Time12,
} from '@shared/pickers';
import { istDateString } from '@shared/slots';
import { controlClass, fieldTitle, PickerPanel, useNativeBridge } from './picker-base';

export type PickerKind = 'date' | 'month' | 'time' | 'datetime-local';

const cell = 'inline-flex items-center justify-center rounded-lg text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30';
const chosen = 'bg-primary font-bold text-primary-foreground hover:bg-primary';
const current = 'bg-primary/15 font-bold text-primary';

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={cn(cell, 'size-10 text-muted-foreground hover:bg-muted')}>
      {children}
    </button>
  );
}

/** Days → tap the title for months → tap again for years. */
function Calendar({ value, min, max, monthOnly, onPick }: { value: string; min?: string | number; max?: string | number; monthOnly: boolean; onPick: (value: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const today = istDateString(new Date());
  const start = parseDate(monthOnly && value ? `${value}-01` : value) ?? parseDate(today)!;
  const [view, setView] = React.useState<'days' | 'months' | 'years'>(monthOnly ? 'months' : 'days');
  const [y, setY] = React.useState(start.y);
  const [m, setM] = React.useState(start.m);
  const [focusDay, setFocusDay] = React.useState(toDateValue(start));
  const grid = React.useRef<HTMLDivElement>(null);
  const moved = React.useRef(false);
  const decade = Math.floor(y / 10) * 10;

  React.useEffect(() => {
    if (moved.current) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
    moved.current = false;
  }, [focusDay, m, y, view]);

  const step = (dir: 1 | -1) => {
    if (view === 'days') {
      const next = addMonths(y, m, dir);
      setY(next.y);
      setM(next.m);
      setFocusDay(toDateValue({ ...next, d: 1 }));
    } else setY(y + dir * (view === 'months' ? 1 : 10));
  };
  const title = view === 'days' ? `${monthName(m, lang, 'long')} ${y}` : view === 'months' ? String(y) : `${decade} – ${decade + 9}`;

  const onDayKeys = (e: React.KeyboardEvent) => {
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
    if (!delta) return;
    e.preventDefault();
    const next = shiftDays(focusDay, delta);
    const p = parseDate(next)!;
    moved.current = true;
    setFocusDay(next);
    setY(p.y);
    setM(p.m);
  };

  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 1, 1 + i))).slice(0, 2));
  const days = calendarGrid(y, m);
  const tabbable = days.includes(focusDay) ? focusDay : toDateValue({ y, m, d: 1 });

  return (
    <div className="mx-auto w-full max-w-sm p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <NavButton label={t('picker.previous')} onClick={() => step(-1)}><ChevronLeft className="size-5" aria-hidden /></NavButton>
        <button type="button" disabled={view === 'years'} onClick={() => setView(view === 'days' ? 'months' : 'years')} className={cn(cell, 'h-10 px-4 font-semibold hover:bg-muted disabled:opacity-100')} aria-live="polite">{title}</button>
        <NavButton label={t('picker.next')} onClick={() => step(1)}><ChevronRight className="size-5" aria-hidden /></NavButton>
      </div>

      {view === 'days' && (
        <div ref={grid} onKeyDown={onDayKeys}>
          <div className="grid grid-cols-7 text-center text-xs font-medium text-muted-foreground" aria-hidden>
            {weekdays.map((w, i) => <span key={i} className="py-1.5">{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d) => {
              const other = Number(d.slice(5, 7)) !== m;
              return (
                <button
                  key={d}
                  type="button"
                  data-day={d}
                  tabIndex={d === tabbable ? 0 : -1}
                  disabled={outOfRange(d, min, max)}
                  aria-label={displayDate(d, lang)}
                  aria-pressed={d === value}
                  aria-current={d === today ? 'date' : undefined}
                  onClick={() => onPick(d)}
                  className={cn(cell, 'h-10 tabular hover:bg-muted', other && 'text-muted-foreground/55', d === today && current, d === value && chosen)}
                >
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {view === 'months' && (
        <div className="grid grid-cols-3 gap-2 py-2">
          {Array.from({ length: 12 }, (_, i) => {
            const month = `${y}-${String(i + 1).padStart(2, '0')}`;
            return (
              <button
                key={month}
                type="button"
                disabled={outOfRange(month, min, max)}
                aria-pressed={value.startsWith(month)}
                onClick={() => {
                  if (monthOnly) return onPick(month);
                  setM(i + 1);
                  setFocusDay(`${month}-01`);
                  setView('days');
                }}
                className={cn(cell, 'h-11 hover:bg-muted', today.startsWith(month) && current, value.startsWith(month) && chosen)}
              >
                {monthName(i + 1, lang)}
              </button>
            );
          })}
        </div>
      )}

      {view === 'years' && (
        <div className="grid grid-cols-3 gap-2 py-2">
          {Array.from({ length: 10 }, (_, i) => String(decade + i)).map((year) => (
            <button
              key={year}
              type="button"
              disabled={outOfRange(year, min, max)}
              aria-pressed={value.startsWith(year)}
              onClick={() => {
                setY(Number(year));
                setView('months');
              }}
              className={cn(cell, 'h-11 tabular hover:bg-muted', today.startsWith(year) && current, value.startsWith(year) && chosen)}
            >
              {year}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Column({ label, items, selected, onPick }: { label: string; items: { key: string; text: string }[]; selected: string | null; onPick: (key: string) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const box = ref.current;
    const item = box?.querySelector<HTMLElement>(`[data-key="${selected}"]`);
    if (box && item) box.scrollTop = item.offsetTop - box.clientHeight / 2 + item.clientHeight / 2;
    // Only when the picker opens — not after every tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} role="listbox" aria-label={label} className="scroll-thin relative h-56 flex-1 overflow-y-auto overscroll-contain px-1">
      {items.map((i) => (
        <button key={i.key} type="button" role="option" aria-selected={i.key === selected} data-key={i.key} onClick={() => onPick(i.key)} className={cn(cell, 'my-0.5 h-10 w-full tabular hover:bg-muted', i.key === selected && chosen)}>
          {i.text}
        </button>
      ))}
    </div>
  );
}

const two = (n: number) => String(n).padStart(2, '0');

function TimeColumns({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  const time = parseTime(value);
  const base: Time12 = time ?? { hour: 9, minute: 0, pm: false };
  const set = (patch: Partial<Time12>) => onChange(toTimeValue({ ...base, ...patch }));
  return (
    <div className="flex gap-1 p-2">
      <Column label={t('picker.hour')} selected={time ? String(time.hour) : null} onPick={(k) => set({ hour: Number(k) })} items={Array.from({ length: 12 }, (_, i) => ({ key: String(i + 1), text: two(i + 1) }))} />
      <Column label={t('picker.minute')} selected={time ? String(time.minute) : null} onPick={(k) => set({ minute: Number(k) })} items={Array.from({ length: 60 }, (_, i) => ({ key: String(i), text: two(i) }))} />
      <Column label={t('picker.ampm')} selected={time ? (time.pm ? 'pm' : 'am') : null} onPick={(k) => set({ pm: k === 'pm' })} items={[{ key: 'am', text: 'AM' }, { key: 'pm', text: 'PM' }]} />
    </div>
  );
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { kind: PickerKind };

/** Date, month, time and date-time field with the same props and value format as a native input. */
export const DateTimeControl = React.forwardRef<HTMLInputElement, InputProps>(
  ({ kind, className, id, disabled, required, min, max, placeholder, onBlur, 'aria-label': ariaLabel, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy, 'aria-required': ariaRequired, ...props }, forwarded) => {
    const { t, i18n } = useTranslation();
    const lang = i18n.language;
    const { ref, trigger, node, state: value, commit } = useNativeBridge<HTMLInputElement, string>(forwarded, (el) => el.value, '', 'input');
    const wrap = React.useRef<HTMLDivElement>(null);
    const [open, setOpen] = React.useState(false);
    const valueId = React.useId();
    const isRequired = required || ariaRequired === true || ariaRequired === 'true';
    const datePart = value.slice(0, 10);
    const timePart = kind === 'time' ? value : value.slice(11, 16);

    const text =
      kind === 'date' ? displayDate(value, lang)
      : kind === 'month' ? displayMonth(value, lang)
      : kind === 'time' ? displayTime(value)
      : value ? `${displayDate(datePart, lang)} ${displayTime(timePart)}` : '';
    const hint = t(`picker.placeholder.${kind === 'datetime-local' ? 'datetime' : kind}`);
    const Icon = kind === 'time' ? Clock : CalendarDays;

    const setOpenState = (next: boolean) => {
      if (disabled) return;
      if (!next && node.current) onBlur?.({ target: node.current, currentTarget: node.current, type: 'blur' } as unknown as React.FocusEvent<HTMLInputElement>);
      setOpen(next);
    };
    const finish = (v: string) => {
      commit(v);
      setOpenState(false);
    };
    const today = istDateString(new Date());
    const todayValue = kind === 'month' ? today.slice(0, 7) : today;

    return (
      <div className="relative" ref={wrap}>
        <button
          ref={trigger}
          id={id}
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={ariaLabel ? `${ariaLabel}${text ? `: ${text}` : ''}` : undefined}
          aria-invalid={ariaInvalid}
          aria-describedby={[valueId, ariaDescribedBy].filter(Boolean).join(' ')}
          onClick={() => setOpenState(!open)}
          className={cn(controlClass, 'justify-between', className)}
        >
          <span id={valueId} className={cn('min-w-0 truncate', !text && 'text-muted-foreground')}>{text || placeholder || hint}</span>
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
        <input ref={ref} type={kind} className="sr-only" tabIndex={-1} aria-hidden disabled={disabled} required={required} min={min} max={max} {...props} />

        <PickerPanel open={open} onOpenChange={setOpenState} anchor={wrap} title={open ? fieldTitle(ariaLabel, id, t(`picker.title.${kind === 'datetime-local' ? 'datetime' : kind}`)) : ''} width={kind === 'time' ? 240 : 320} height={kind === 'datetime-local' ? 640 : 380}>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {kind !== 'time' && (
              <Calendar
                value={kind === 'month' ? value : datePart}
                min={min}
                max={max}
                monthOnly={kind === 'month'}
                onPick={(v) => (kind === 'datetime-local' ? commit(`${v}T${timePart || '09:00'}`) : finish(v))}
              />
            )}
            {(kind === 'time' || kind === 'datetime-local') && (
              <div className={cn(kind === 'datetime-local' && 'border-t')}>
                <TimeColumns value={timePart} onChange={(v) => commit(kind === 'time' ? v : `${datePart || today}T${v}`)} />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t px-2.5 py-2">
            {!isRequired && value ? <button type="button" onClick={() => finish('')} className={cn(cell, 'h-9 px-3 text-muted-foreground hover:bg-muted')}>{t('picker.clear')}</button> : <span />}
            {kind === 'date' || kind === 'month' ? (
              <button type="button" disabled={outOfRange(todayValue, min, max)} onClick={() => finish(todayValue)} className={cn(cell, 'h-9 px-3 font-semibold text-primary hover:bg-primary/10')}>{kind === 'month' ? t('leave.thisMonth') : t('picker.today')}</button>
            ) : (
              <button type="button" onClick={() => setOpenState(false)} className={cn(cell, 'h-9 bg-primary px-4 font-semibold text-primary-foreground')}>{t('picker.done')}</button>
            )}
          </div>
        </PickerPanel>
      </div>
    );
  },
);
DateTimeControl.displayName = 'DateTimeControl';
