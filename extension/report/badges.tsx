import { Circle, CircleCheck, CircleSlash } from 'lucide-react';
import { severityOf, statusOf } from './shared';
import { cn } from '@/lib/utils';
import type { CommentStatus, Severity } from '@/lib/model';

/** Text, tint and solid classes per severity, from the Margin status palette. */
export const SEVERITY_CLASSES: Record<Severity, { text: string; tint: string; dot: string }> = {
  blocker: { text: 'text-sev-blocker', tint: 'bg-sev-blocker-tint', dot: 'bg-sev-blocker-solid' },
  major: { text: 'text-sev-major', tint: 'bg-sev-major-tint', dot: 'bg-sev-major-solid' },
  minor: { text: 'text-sev-minor', tint: 'bg-sev-minor-tint', dot: 'bg-sev-minor-solid' },
  nit: { text: 'text-sev-nit', tint: 'bg-sev-nit-tint', dot: 'bg-sev-nit-solid' },
};

export const STATUS_ICONS = { open: Circle, fixed: CircleCheck, wontfix: CircleSlash };

const STATUS_CLASSES: Record<CommentStatus, string> = {
  open: 'bg-muted text-foreground',
  fixed: 'bg-success-tint text-success',
  wontfix: 'bg-muted text-muted-foreground',
};

const JIRA_TONE_CLASSES = { done: 'text-success', progress: 'text-sev-minor', todo: 'text-muted-foreground' };

/**
 * The text colour of a Jira status: green once done, blue in progress, muted to do.
 * @param tone The status tone from statusTone.
 */
export const jiraToneClass = (tone: keyof typeof JIRA_TONE_CLASSES) => JIRA_TONE_CLASSES[tone];

/**
 * A comment's severity as a solid dot.
 * @param props.severity The stored severity.
 */
export function SeverityDot({ severity, className }: { severity: string; className?: string }) {
  const key = severityOf(severity).key;
  return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', SEVERITY_CLASSES[key].dot, className)} />;
}

/**
 * A comment's severity as a tinted label.
 * @param props.severity The stored severity.
 */
export function SeverityBadge({ severity }: { severity: string }) {
  const sev = severityOf(severity);
  const classes = SEVERITY_CLASSES[sev.key];
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-sm px-2 text-xs font-semibold whitespace-nowrap', classes.text, classes.tint)}>
      <SeverityDot severity={sev.key} />
      {sev.label}
    </span>
  );
}

/**
 * A comment's status with its icon, green once fixed.
 * @param props.status The stored status.
 */
export function StatusBadge({ status }: { status: string | undefined }) {
  const current = statusOf(status);
  const Icon = STATUS_ICONS[current.key];
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-sm px-2 text-xs font-semibold whitespace-nowrap', STATUS_CLASSES[current.key])}>
      <Icon className="size-3.5" aria-hidden="true" />
      {current.label}
    </span>
  );
}

/**
 * A marker's number in the red disc it has on the screenshot, so a note and its place on the image read as one.
 * @param props.number The marker's number.
 * @param props.className Size or emphasis from the caller.
 */
export function MarkerNumber({ number, className }: { number: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-marker text-[11px] font-bold text-white tabular-nums', className)}
    >
      {number}
    </span>
  );
}
