import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DateTimeControl, type PickerKind } from './date-control';

const base =
  'w-full rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/30';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => {
    if (type === 'password') return <PasswordInput ref={ref} className={className} {...props} />;
    // Date, month and time fields use the app's own calendar / time picker everywhere.
    if (type === 'date' || type === 'month' || type === 'time' || type === 'datetime-local') return <DateTimeControl ref={ref} kind={type as PickerKind} className={className} {...props} />;
    return <input ref={ref} type={type} className={cn(base, 'h-11', className)} {...props} />;
  },
);

/** Every password box gets an eye button to show / hide what was typed. */
const PasswordInput = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(({ className, disabled, ...props }, ref) => {
  const { t } = useTranslation();
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input ref={ref} type={visible ? 'text' : 'password'} disabled={disabled} className={cn(base, 'h-11 pr-11', className)} {...props} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {visible ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
      </button>
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 4, ...props }, ref) => <textarea ref={ref} rows={rows} className={cn(base, 'min-h-[88px] py-2.5', className)} {...props} />,
);
Textarea.displayName = 'Textarea';

/** Every drop-down in the app is the searchable select. */
export { Select } from './select-control';
