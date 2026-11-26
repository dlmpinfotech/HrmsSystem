import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const Overlay = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Overlay>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>>(
  ({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn('fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0', className)}
      {...props}
    />
  ),
);
Overlay.displayName = 'DialogOverlay';

interface ContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** modal = centred dialog (bottom sheet on phones); left/right = sliding drawer. */
  side?: 'modal' | 'left' | 'right' | 'bottom';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeLabel?: string;
}

const sizes = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' };

export const DialogContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, ContentProps>(
  ({ className, children, side = 'modal', size = 'md', closeLabel = 'Close', ...props }, ref) => (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col bg-card text-card-foreground shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out',
          side === 'modal' &&
            cn(
              'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
              'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
              'sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0',
              sizes[size],
            ),
          side === 'bottom' && 'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          side === 'left' && 'inset-y-0 left-0 w-[86vw] max-w-xs border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
          side === 'right' && cn('inset-y-0 right-0 w-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right', sizes[size]),
          className,
        )}
        {...props}
      >
        {(side === 'bottom' || side === 'modal') && <span className={cn('mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/25', side === 'modal' && 'sm:hidden')} aria-hidden />}
        {children}
        <DialogPrimitive.Close
          className="absolute right-3 top-3 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={closeLabel}
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
DialogContent.displayName = 'DialogContent';

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1 border-b px-5 py-4 pr-14', className)} {...props} />
);

export const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('scroll-thin flex-1 overflow-y-auto px-5 py-4', className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('safe-bottom flex flex-col-reverse gap-2 border-t px-5 pt-4 sm:flex-row sm:justify-end sm:pb-4', className)} {...props} />
);

export const DialogTitle = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  ({ className, ...props }, ref) => <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold leading-snug', className)} {...props} />,
);
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />);
DialogDescription.displayName = 'DialogDescription';
