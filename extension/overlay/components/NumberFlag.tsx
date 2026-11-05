import type { ComponentProps } from 'react';
import { padNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A comment's number in Margin's flag shape. Saved comments get a solid flag, the open card an outlined one.
 * @param props The number, whether it is a draft, and any element props.
 */
export function NumberFlag({ number, draft = false, className, ...props }: { number: number; draft?: boolean } & ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-[4px_4px_4px_0] px-1.5 text-[13px] leading-4 font-extrabold whitespace-nowrap',
        draft ? 'border-[1.5px] border-ink bg-ink-foreground text-ink' : 'border-2 border-ink-foreground bg-ink text-ink-foreground',
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
