import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SeverityIcon } from '@/components/margin/severity';
import { StatusLabel } from '@/components/margin/status';
import { severityOf } from '@/lib/severity.js';
import { IconButton } from './icon-button';
import { pad, recheckState, type Issue } from './model';

type Props = { issue: Issue; n: number; onOpen: () => void; onDelete: () => void };

/** List rows share this inner padding, so their text keeps the popup's 16px left edge inside a -mx-2 list. */
export const ROW = 'rounded-md px-2 py-2';

/** One comment: severity, title over status and details, which open it in the report, and delete on hover or focus. */
export function CommentRow({ issue, n, onOpen, onDelete }: Props) {
  const title = issue.title || 'Untitled comment';
  const meta = [pad(n), issue.jira?.key && `Jira ${issue.jira.key}`, recheckState(issue)].filter(Boolean).join(', ');
  return (
    <li data-comment={issue.id} className={`group/row relative flex items-start gap-2 transition-colors hover:bg-muted focus-within:bg-muted ${ROW}`}>
      <span className="flex h-5 w-4 shrink-0 items-center justify-center" title={severityOf(issue.severity).label}>
        <SeverityIcon severity={issue.severity} />
        <span className="sr-only">{severityOf(issue.severity).label}</span>
      </span>
      <button
        type="button"
        onClick={onOpen}
        title={`${title}. Opens it in the report.`}
        className="grid min-w-0 flex-1 gap-1 text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
      >
        <span className="line-clamp-2 text-sm font-medium">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <StatusLabel status={issue.status} className="font-medium" />
          <span className="truncate">{meta}</span>
        </span>
      </button>
      <IconButton
        label={`Delete comment ${pad(n)}`}
        side="left"
        onClick={onDelete}
        className="relative -my-1 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 hover:text-destructive"
      >
        <Trash2 />
      </IconButton>
    </li>
  );
}

/** A deleted comment's place in the list, with Undo for a few seconds. */
export function UndoRow({ id, n, onUndo }: { id: string; n: number; onUndo: () => void }) {
  return (
    <li data-comment={id} className={`flex items-center gap-2 bg-muted text-sm font-medium text-muted-foreground animate-in fade-in-0 motion-reduce:animate-none ${ROW}`}>
      <span className="flex-1 pl-6" role="status">
        Comment {pad(n)} deleted
      </span>
      <Button size="sm" variant="outline" autoFocus onClick={onUndo}>
        Undo
      </Button>
    </li>
  );
}
