import { cn } from '@/lib/utils';

const MARK_URL = `url("${chrome.runtime.getURL('/icons/ui/mark.svg')}")`;

/**
 * Margin's mark in the purple accent, drawn as a mask so it follows the theme.
 * @param props Size classes for the mark.
 */
export function MarginMark({ className }: { className: string }) {
  return <i className={cn('shrink-0 bg-ink', className)} style={{ maskImage: MARK_URL, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' }} />;
}
