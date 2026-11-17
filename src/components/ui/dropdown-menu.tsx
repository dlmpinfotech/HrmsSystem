import * as React from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof Menu.Content>, React.ComponentPropsWithoutRef<typeof Menu.Content>>(
  ({ className, sideOffset = 6, align = 'end', ...props }, ref) => (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-[11rem] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

const itemClass =
  'relative flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof Menu.Item>,
  React.ComponentPropsWithoutRef<typeof Menu.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <Menu.Item ref={ref} className={cn(itemClass, destructive && 'text-destructive', className)} {...props} />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof Menu.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof Menu.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <Menu.CheckboxItem ref={ref} className={cn(itemClass, 'pl-8', className)} {...props}>
    <span className="absolute left-2.5 inline-flex size-4 items-center justify-center">
      <Menu.ItemIndicator>
        <Check />
      </Menu.ItemIndicator>
    </span>
    {children}
  </Menu.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

export const DropdownMenuLabel = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Menu.Label>) => (
  <Menu.Label className={cn('px-2.5 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...props} />
);

export const DropdownMenuSeparator = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof Menu.Separator>) => (
  <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
);
