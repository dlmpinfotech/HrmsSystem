import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

interface FieldShellProps {
  label: React.ReactNode;
  /** i18n key (from the zod schema) or already-translated text. */
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
}

function useFieldIds(id?: string) {
  const auto = React.useId();
  const fieldId = id ?? auto;
  return { fieldId, errorId: `${fieldId}-error`, hintId: `${fieldId}-hint` };
}

function Shell({ label, error, hint, required, className, fieldId, errorId, hintId, children }: FieldShellProps & { fieldId: string; errorId: string; hintId: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={fieldId}>
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
      </Label>
      {children}
      {hint && !error && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={errorId} role="alert" className="text-xs font-medium text-destructive">{t(error, { defaultValue: error })}</p>}
    </div>
  );
}

const describe = (error: string | undefined, hint: React.ReactNode, errorId: string, hintId: string) => (error ? errorId : hint ? hintId : undefined);

export const TextField = React.forwardRef<HTMLInputElement, FieldShellProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> & { inputClassName?: string }>(
  ({ label, error, hint, required, className, inputClassName, id, ...props }, ref) => {
    const ids = useFieldIds(id);
    return (
      <Shell label={label} error={error} hint={hint} required={required} className={className} {...ids}>
        <Input ref={ref} id={ids.fieldId} aria-invalid={Boolean(error)} aria-required={required} aria-describedby={describe(error, hint, ids.errorId, ids.hintId)} className={inputClassName} {...props} />
      </Shell>
    );
  },
);
TextField.displayName = 'TextField';

export const TextareaField = React.forwardRef<HTMLTextAreaElement, FieldShellProps & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>>(
  ({ label, error, hint, required, className, id, ...props }, ref) => {
    const ids = useFieldIds(id);
    return (
      <Shell label={label} error={error} hint={hint} required={required} className={className} {...ids}>
        <Textarea ref={ref} id={ids.fieldId} aria-invalid={Boolean(error)} aria-required={required} aria-describedby={describe(error, hint, ids.errorId, ids.hintId)} {...props} />
      </Shell>
    );
  },
);
TextareaField.displayName = 'TextareaField';

export const SelectField = React.forwardRef<HTMLSelectElement, FieldShellProps & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'>>(
  ({ label, error, hint, required, className, id, children, ...props }, ref) => {
    const ids = useFieldIds(id);
    return (
      <Shell label={label} error={error} hint={hint} required={required} className={className} {...ids}>
        <Select ref={ref} id={ids.fieldId} aria-invalid={Boolean(error)} aria-required={required} aria-describedby={describe(error, hint, ids.errorId, ids.hintId)} {...props}>
          {children}
        </Select>
      </Shell>
    );
  },
);
SelectField.displayName = 'SelectField';

export interface RadioOption {
  value: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
}

/**
 * Vertical list of round radio buttons (native inputs, so react-hook-form's register works).
 * Pass the register() result as `inputProps`; it is spread onto every radio in the group.
 */
export function RadioGroupField({ label, options, error, className, inputProps }: { label: React.ReactNode; options: RadioOption[]; error?: string; className?: string; inputProps: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & { ref?: React.Ref<HTMLInputElement> } }) {
  const { t } = useTranslation();
  const groupId = React.useId();
  return (
    <fieldset className={cn('space-y-1', className)} aria-describedby={error ? `${groupId}-error` : undefined}>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      {options.map((o) => (
        <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg px-1 py-2 text-sm transition-colors hover:bg-muted/50">
          <input
            type="radio"
            value={o.value}
            {...inputProps}
            className="mt-0.5 size-5 shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-card shadow-sm transition-all checked:border-[6px] checked:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <span className="leading-snug">
            <span className="block font-medium">{o.label}</span>
            {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
          </span>
        </label>
      ))}
      {error && <p id={`${groupId}-error`} role="alert" className="text-xs font-medium text-destructive">{t(error, { defaultValue: error })}</p>}
    </fieldset>
  );
}

/** Native checkbox (works directly with react-hook-form's register) with a large touch target. */
export const CheckField = React.forwardRef<HTMLInputElement, { label: React.ReactNode; error?: string; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>>(
  ({ label, error, className, id, ...props }, ref) => {
    const { t } = useTranslation();
    const ids = useFieldIds(id);
    return (
      <div className={cn('space-y-1', className)}>
        <label htmlFor={ids.fieldId} className="flex min-h-9 cursor-pointer items-start gap-2.5 text-sm">
          <input ref={ref} id={ids.fieldId} type="checkbox" aria-invalid={Boolean(error)} aria-describedby={error ? ids.errorId : undefined} className="mt-0.5 size-5 shrink-0 cursor-pointer rounded border-input accent-[hsl(var(--primary))]" {...props} />
          <span className="leading-snug">{label}</span>
        </label>
        {error && <p id={ids.errorId} role="alert" className="text-xs font-medium text-destructive">{t(error, { defaultValue: error })}</p>}
      </div>
    );
  },
);
CheckField.displayName = 'CheckField';
