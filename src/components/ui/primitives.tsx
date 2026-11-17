import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { Check } from 'lucide-react';
import { cn, initials } from '@/lib/utils';

// ── Label ─────────────────────────────────────────────────────────────
export const Label = React.forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>>(
  ({ className, ...props }, ref) => <LabelPrimitive.Root ref={ref} className={cn('text-sm font-medium leading-none text-foreground', className)} {...props} />,
);
Label.displayName = 'Label';

// ── Tabs ──────────────────────────────────────────────────────────────
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.List
      ref={ref}
      className={cn('scroll-thin inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1', className)}
      {...props}
    />
  ),
);
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-4',
        className,
      )}
      {...props}
    />
  ),
);
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  ({ className, ...props }, ref) => (
    <TabsPrimitive.Content
      ref={ref}
      className={cn('mt-4 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200', className)}
      {...props}
    />
  ),
);
TabsContent.displayName = 'TabsContent';

// ── Switch ────────────────────────────────────────────────────────────
export const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  ),
);
Switch.displayName = 'Switch';

// ── Checkbox ──────────────────────────────────────────────────────────
export const Checkbox = React.forwardRef<React.ElementRef<typeof CheckboxPrimitive.Root>, React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(
  ({ className, ...props }, ref) => (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex size-5 shrink-0 items-center justify-center rounded border border-input bg-card transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground aria-[invalid=true]:border-destructive disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  ),
);
Checkbox.displayName = 'Checkbox';

// ── Tooltip ───────────────────────────────────────────────────────────
export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ label, children, side = 'top' }: { label: React.ReactNode; children: React.ReactElement; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-lg animate-in fade-in-0 zoom-in-95"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────
export function Avatar({ name, src, className }: { name?: string | null; src?: string | null; className?: string }) {
  return (
    <AvatarPrimitive.Root className={cn('inline-flex size-9 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-primary/15 text-xs font-bold text-primary', className)}>
      {src && <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback delayMs={src ? 300 : 0}>{initials(name)}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

// ── Separator ─────────────────────────────────────────────────────────
export const Separator = ({ className, orientation = 'horizontal', ...props }: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) => (
  <SeparatorPrimitive.Root
    decorative
    orientation={orientation}
    className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    {...props}
  />
);

// ── Skeleton ──────────────────────────────────────────────────────────
export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div aria-hidden className={cn('skeleton h-4 w-full', className)} {...props} />
);
