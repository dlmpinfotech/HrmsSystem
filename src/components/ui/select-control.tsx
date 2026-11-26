import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { controlClass, fieldTitle, PickerPanel, useNativeBridge } from './picker-base';

interface Option {
  value: string;
  label: string;
  disabled: boolean;
}
interface SelectState {
  value: string;
  options: Option[];
}

const readSelect = (el: HTMLSelectElement): SelectState => ({
  value: el.value,
  options: Array.from(el.options, (o) => ({ value: o.value, label: o.textContent ?? '', disabled: o.disabled })),
});

/** Searchable drop-down with the same props as a native <select>. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, id, disabled, onBlur, 'aria-label': ariaLabel, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy, ...props }, forwarded) => {
    const { t } = useTranslation();
    const { ref, trigger, node, state, commit } = useNativeBridge<HTMLSelectElement, SelectState>(forwarded, readSelect, { value: '', options: [] }, 'change');
    const wrap = React.useRef<HTMLDivElement>(null);
    const list = React.useRef<HTMLUListElement>(null);
    const search = React.useRef<HTMLInputElement>(null);
    const listId = React.useId();
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [active, setActive] = React.useState(0);

    const selected = state.options.find((o) => o.value === state.value);
    const clearable = !disabled && state.value !== '' && state.options.some((o) => o.value === '' && !o.disabled);
    const shown = state.options.filter((o) => !query || o.label.toLowerCase().includes(query.trim().toLowerCase()));

    const setOpenState = (next: boolean) => {
      if (disabled) return;
      if (next) {
        setQuery('');
        setActive(Math.max(0, state.options.findIndex((o) => o.value === state.value)));
      } else if (node.current) onBlur?.({ target: node.current, currentTarget: node.current, type: 'blur' } as unknown as React.FocusEvent<HTMLSelectElement>);
      setOpen(next);
    };
    const pick = (o: Option | undefined) => {
      if (!o || o.disabled) return;
      commit(o.value);
      setOpenState(false);
    };

    React.useEffect(() => {
      if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [open, active]);

    const onKeys = (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), Math.max(shown.length - 1, 0)));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(shown[active]);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        setActive(e.key === 'Home' ? 0 : Math.max(shown.length - 1, 0));
      }
    };

    return (
      <div className="relative" ref={wrap}>
        <button
          ref={trigger}
          id={id}
          type="button"
          role="combobox"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          onClick={() => setOpenState(!open)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpenState(true);
            }
          }}
          className={cn(controlClass, clearable ? 'pr-16' : 'pr-9', className)}
        >
          <span className={cn('min-w-0 flex-1 truncate', (!selected || selected.value === '') && 'text-muted-foreground')}>{selected?.label || t('picker.select')}</span>
        </button>
        {clearable && (
          <button type="button" onClick={() => commit('')} aria-label={t('picker.clear')} className="absolute right-8 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        )}
        <ChevronDown className={cn('pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden />
        <select ref={ref} className="sr-only" tabIndex={-1} aria-hidden disabled={disabled} {...props}>
          {children}
        </select>

        <PickerPanel
          open={open}
          onOpenChange={setOpenState}
          anchor={wrap}
          title={open ? fieldTitle(ariaLabel, id, t('picker.select')) : ''}
          width="anchor"
          height={320}
          onOpenAutoFocus={(e) => {
            // Don't pop up the keyboard on touch screens just by opening the list.
            e.preventDefault();
            if (window.matchMedia('(pointer: fine)').matches) search.current?.focus();
            else list.current?.focus();
          }}
        >
          {/* Flat search row: tinted icon tile flush to the edge, no box around the typing area. */}
          <div className="flex h-12 shrink-0 items-stretch border-b focus-within:border-primary/50" onKeyDown={onKeys}>
            <span className="inline-flex w-11 shrink-0 items-center justify-center bg-primary/10 text-primary"><Search className="size-[18px]" aria-hidden /></span>
            <input
              ref={search}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder={t('common.search')}
              aria-label={t('common.search')}
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              autoComplete="off"
              className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <ul ref={list} id={listId} role="listbox" tabIndex={-1} onKeyDown={onKeys} className="scroll-thin max-h-[min(17rem,55dvh)] min-h-0 flex-1 overflow-y-auto p-1.5 outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t('picker.noResults')}</li>}
            {shown.map((o, i) => {
              const isSelected = o.value === state.value;
              return (
                <li
                  key={`${o.value}-${i}`}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  onClick={() => pick(o)}
                  onPointerMove={() => setActive(i)}
                  className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm sm:min-h-10', i === active && 'bg-primary/10', isSelected && 'font-semibold', o.disabled && 'cursor-not-allowed opacity-50')}
                >
                  <span className={cn('inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border-2', isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/35')} aria-hidden>
                    {isSelected && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                  </span>
                  <span className="min-w-0 break-words">{o.label}</span>
                </li>
              );
            })}
          </ul>
        </PickerPanel>
      </div>
    );
  },
);
Select.displayName = 'Select';
