import { Circle, CircleCheck, CircleSlash, type LucideIcon } from 'lucide-react';
import { statusOf } from '@/lib/status.js';
import { cn } from '@/lib/utils';

const STYLES: Record<'open' | 'fixed' | 'wontfix', { icon: LucideIcon; text: string }> = {
  open: { icon: Circle, text: 'text-foreground' },
  fixed: { icon: CircleCheck, text: 'text-success' },
  wontfix: { icon: CircleSlash, text: 'text-muted-foreground' },
};

/** The status as its icon and label: Open, Fixed or Won't fix. */
export function StatusLabel({ status, className }: { status?: string; className?: string }) {
  const { key, label } = statusOf(status);
  const { icon: Icon, text } = STYLES[key as keyof typeof STYLES];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap', text, className)}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}
