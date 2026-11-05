/* oxlint-disable react/react-in-jsx-scope -- React 19 uses the automatic JSX runtime. The rule belongs off in .oxlintrc.json. */
import { icon } from '@/lib/icons.js';
import { cn } from '@/lib/utils';

export type MarginIconName = 'mark' | 'jira' | 'figma' | 'sevBlocker' | 'sevMajor' | 'sevMinor' | 'sevNit';

/**
 * An icon from the set the other Margin screens draw with: the mark, the Jira and Figma logos and the severity shapes.
 * Lucide has no brand logos, and the severity shapes keep severity readable without colour.
 * @param props.name The icon.
 * @param props.className Sizing and colour.
 */
export function MarginIcon({ name, className }: { name: MarginIconName; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 [&_.ico]:flex [&_.ico]:size-full [&_svg]:size-full', className)}
      dangerouslySetInnerHTML={{ __html: icon(name) }}
    />
  );
}
