import { icon } from '@/lib/icons.js';
import { cn } from '@/lib/utils';

/** Jira's or Figma's mark from Margin's icon set. It takes the text colour, since Margin's palette has no blue. */
export function BrandMark({ brand, className }: { brand: 'jira' | 'figma'; className?: string }) {
  return <span aria-hidden className={cn('inline-block shrink-0 [&_svg]:size-full', className)} dangerouslySetInnerHTML={{ __html: icon(brand) }} />;
}
