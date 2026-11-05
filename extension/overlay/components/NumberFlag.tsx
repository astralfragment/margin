import type { ComponentProps } from 'react';
import { padNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The red teardrop of a numbered marker, on the page and beside its note in the card. */
export const MARKER_PIN =
  'grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-[11px_11px_11px_3px] border-[1.5px] border-white bg-mark px-1 text-xs leading-4 font-extrabold text-mark-foreground';

/**
 * A comment's number in Margin's red tag, with a thin white edge so it reads on any page.
 * @param props The number and any element props.
 */
export function NumberFlag({ number, className, ...props }: { number: number } & ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-[4px_4px_4px_0] bg-mark px-1.5 text-xs leading-4 font-extrabold whitespace-nowrap text-mark-foreground shadow-[0_0_0_1px_white]',
        className,
      )}
      {...props}
    >
      {padNumber(number)}
    </span>
  );
}

/**
 * Where a flag sits against a region, in page pixels from the region's top: above it, else below it when allowed,
 * else just inside its top edge.
 * @param box The region in viewport pixels.
 * @param scale Page pixels per overlay pixel.
 * @param below False when something else sits under the region, such as the card.
 */
export function flagOffset(box: { y: number; h: number }, scale: number, below = true) {
  const lift = 22 * scale;
  if (box.y >= lift + 2 * scale) return -lift;
  if (below && box.y + box.h + lift <= innerHeight - 2 * scale) return box.h + 2 * scale;
  return Math.max(0, -box.y) + 2 * scale;
}
