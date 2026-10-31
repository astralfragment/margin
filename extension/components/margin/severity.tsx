import { Circle, CircleDashed, Square, Triangle, type LucideIcon } from 'lucide-react';
import { severityOf } from '@/lib/severity.js';
import { cn } from '@/lib/utils';

export type SeverityKey = 'blocker' | 'major' | 'minor' | 'nit';

/** Each severity has its own shape as well as its colour, so it never rests on colour alone. */
const SHAPES: Record<SeverityKey, { icon: LucideIcon; fill: boolean; text: string; tint: string }> = {
  blocker: { icon: Square, fill: true, text: 'text-sev-blocker', tint: 'bg-sev-blocker-tint' },
  major: { icon: Triangle, fill: true, text: 'text-sev-major', tint: 'bg-sev-major-tint' },
  minor: { icon: Circle, fill: true, text: 'text-sev-minor', tint: 'bg-sev-minor-tint' },
  nit: { icon: CircleDashed, fill: false, text: 'text-sev-nit', tint: 'bg-sev-nit-tint' },
};

export function severityStyle(key?: string) {
  const { key: k } = severityOf(key) as { key: SeverityKey };
  return SHAPES[k];
}

export function SeverityIcon({ severity, className }: { severity?: string; className?: string }) {
  const { icon: Icon, fill, text } = severityStyle(severity);
  return <Icon aria-hidden className={cn('size-3 shrink-0', text, fill && 'fill-current', className)} />;
}

/** The severity as its shape and label, in its colour. */
export function SeverityLabel({ severity, className }: { severity?: string; className?: string }) {
  const { label } = severityOf(severity);
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap', severityStyle(severity).text, className)}>
      <SeverityIcon severity={severity} />
      {label}
    </span>
  );
}
