import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Custom controls keep the real <input>/<select> (hidden) as the source of truth, so
 * react-hook-form's ref, native `value`, `onChange` and validation keep working unchanged.
 * This hook watches that element, and `commit` changes it the way a person would.
 */
export function useNativeBridge<T extends HTMLInputElement | HTMLSelectElement, S>(
  forwarded: React.ForwardedRef<T>,
  read: (node: T) => S,
  initial: S,
  eventName: 'input' | 'change',
) {
  const node = React.useRef<T | null>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const [state, setState] = React.useState<S>(initial);
  const readRef = React.useRef(read);
  readRef.current = read;

  const sync = React.useCallback(() => {
    if (!node.current) return;
    const next = readRef.current(node.current);
    setState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, []);

  const ref = React.useCallback(
    (el: T | null) => {
      node.current = el;
      if (typeof forwarded === 'function') forwarded(el);
      else if (forwarded) forwarded.current = el;
    },
    [forwarded],
  );

  // Code such as form.reset() sets `.value` without firing events, so watch the property itself.
  React.useLayoutEffect(() => {
    const el = node.current;
    if (!el) return;
    const own = Object.getOwnPropertyDescriptor(el, 'value');
    const base = own ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!;
    Object.defineProperty(el, 'value', {
      configurable: true,
      enumerable: true,
      get: () => base.get!.call(el),
      set: (v) => {
        base.set!.call(el, v);
        sync();
      },
    });
    // "Focus the first invalid field" should land on the visible control.
    el.focus = () => trigger.current?.focus();
    return () => {
      if (own) Object.defineProperty(el, 'value', own);
      else delete (el as unknown as { value?: string }).value;
    };
  }, [sync]);

  React.useLayoutEffect(sync);

  const commit = React.useCallback(
    (value: string) => {
      const el = node.current;
      if (!el || el.value === value) return;
      // The prototype setter skips React's value tracker, so React sees this as a real change.
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value);
      el.dispatchEvent(new Event(eventName, { bubbles: true }));
      sync();
    },
    [eventName, sync],
  );

  return { ref, trigger, node, state, commit };
}

/** The field's own name (aria-label, else its <label>) — used as the panel title. */
export function fieldTitle(ariaLabel: string | undefined, id: string | undefined, fallback: string): string {
  if (ariaLabel) return ariaLabel;
  const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  return label?.textContent?.replace('*', '').trim() || fallback;
}

export const controlClass =
  'flex h-11 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm text-foreground shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-expanded:border-primary aria-expanded:ring-2 aria-expanded:ring-primary/30 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/30';

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: React.RefObject<HTMLElement>;
  title: string;
  /** Preferred width on larger screens; "anchor" = same width as the field. */
  width: number | 'anchor';
  height: number;
  children: React.ReactNode;
  onOpenAutoFocus?: (e: Event) => void;
}

interface Place {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/**
 * The drop-down panel: anchored under (or above) the field on tablets and computers,
 * a bottom sheet on phones. A nested Radix dialog, so it also works inside pop-ups.
 */
export function PickerPanel({ open, onOpenChange, anchor, title, width, height, children, onOpenAutoFocus }: PanelProps) {
  const [place, setPlace] = React.useState<Place | null>(null);
  const [sheet, setSheet] = React.useState(false);

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const phone = window.innerWidth < 640;
      setSheet(phone);
      if (phone) return setPlace(null);
      const w = Math.min(width === 'anchor' ? Math.max(rect.width, 240) : width, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const goUp = below < height && above > below;
      setPlace(goUp ? { left, bottom: window.innerHeight - rect.top + 6, width: w, maxHeight: above } : { left, top: rect.bottom + 6, width: w, maxHeight: below });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchor, width, height]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn('fixed inset-0 z-[60]', sheet ? 'bg-black/45' : 'bg-transparent')} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            anchor.current?.querySelector<HTMLButtonElement>('button')?.focus();
          }}
          className={cn(
            'fixed z-[61] flex flex-col overflow-hidden border bg-card text-card-foreground shadow-2xl animate-in fade-in-0 duration-150',
            sheet ? 'safe-bottom inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl slide-in-from-bottom' : 'rounded-lg shadow-xl zoom-in-95',
          )}
          style={sheet || !place ? undefined : place}
        >
          <div className={cn('flex items-center justify-between gap-2 border-b px-4 py-2.5', !sheet && 'sr-only')}>
            <DialogPrimitive.Title className="truncate text-sm font-semibold">{title}</DialogPrimitive.Title>
            {sheet && (
              <DialogPrimitive.Close className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label="✕">
                <X className="size-4" aria-hidden />
              </DialogPrimitive.Close>
            )}
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
