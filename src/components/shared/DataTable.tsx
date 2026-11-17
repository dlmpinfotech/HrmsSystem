import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Shown as the card heading on phones. */
  primary?: boolean;
  /** Hide in the stacked phone layout (e.g. redundant columns). */
  hideOnMobile?: boolean;
  align?: 'left' | 'right';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  /** Accessible name for the table. */
  caption: string;
  className?: string;
}

/**
 * Adaptive table: a real <table> from the md breakpoint up, stacked label/value
 * cards on phones — so there is never horizontal page overflow.
 */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, caption, className }: DataTableProps<T>) {
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);
  const activate = (row: T) => (e: React.KeyboardEvent) => {
    if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div className={className}>
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('whitespace-nowrap px-4 py-3', c.align === 'right' && 'text-right', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={activate(row)}
                className={cn('border-b last:border-0', onRowClick && 'cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 align-middle', c.align === 'right' && 'text-right tabular', c.className)} style={{ paddingBlock: 'var(--row-pad)' }}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <div
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={activate(row)}
              className={cn('rounded-xl border bg-card p-4 shadow-card', onRowClick && 'cursor-pointer active:bg-muted/60')}
            >
              <div className="mb-2 font-semibold">{primary.cell(row)}</div>
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-sm">
                {rest.map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-xs text-muted-foreground">{c.header}</dt>
                    <dd className="min-w-0 justify-self-end text-right">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
