import { statusTone } from '@/lib/review-links.js';
import { cn } from '@/lib/utils';

const TONES: Record<string, string> = {
  todo: 'text-muted-foreground',
  progress: 'text-foreground',
  done: 'text-success',
};

/** A Jira status as text: To do quiet, In progress plain, Done green. */
export function JiraStatus({ status, category }: { status: string; category?: string }) {
  return (
    <span title={status} className={cn('max-w-24 shrink-0 truncate text-xs font-semibold', TONES[statusTone(category)])}>
      {status}
    </span>
  );
}
