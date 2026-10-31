import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { pad } from './controller';

/** A region's number, in the red every region and marker uses so it reads on any site. */
export function RegionNumber({ n, draft, className, ...props }: ComponentProps<'span'> & { n: number; draft?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-6 items-center justify-center rounded-sm px-1 text-xs leading-none font-semibold ring-2 ring-background',
        draft ? 'bg-background text-destructive ring-destructive ring-inset' : 'bg-destructive text-background',
        className,
      )}
      {...props}
    >
      {pad(n)}
    </span>
  );
}

/** A numbered marker inside a region. */
export function MarkerDot({ n, ghost, className, ...props }: ComponentProps<'span'> & { n: number; ghost?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive text-xs leading-none font-semibold text-background ring-2 ring-background',
        ghost && 'opacity-50',
        className,
      )}
      {...props}
    >
      {n}
    </span>
  );
}
