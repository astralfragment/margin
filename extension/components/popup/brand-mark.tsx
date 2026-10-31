import { cn } from '@/lib/utils';

/** Margin's mark: a dashed frame with a pin. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 18" fill="none" aria-hidden className={cn('h-4 w-[19px] shrink-0', className)}>
      <rect x="0.875" y="5" width="15" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" strokeDasharray="3 2" />
      <circle cx="16.375" cy="4.5" r="4.5" fill="currentColor" />
    </svg>
  );
}
