import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  title: ReactNode;
  description?: ReactNode;
  /** Ids so a control can name itself after the row with aria-labelledby and aria-describedby. */
  titleId?: string;
  descriptionId?: string;
  children?: ReactNode;
  className?: string;
};

/** One line of a settings group: what it is and why on the left, its control on the right. Stacks on narrow screens. */
export function SettingRow({ title, description, titleId, descriptionId, children, className }: Props) {
  return (
    <div className={cn('flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6', className)}>
      <div className="grid min-w-0 gap-1">
        <span id={titleId} className="text-sm font-semibold">
          {title}
        </span>
        {description && (
          <div id={descriptionId} className="text-sm leading-5 font-medium text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** A rounded group of setting rows with hairlines between them. */
export function SettingGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('divide-y divide-border overflow-hidden rounded-xl border bg-card', className)}>{children}</div>;
}
