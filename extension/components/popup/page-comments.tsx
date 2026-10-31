import { ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { RunState } from './io';
import { CommentRow, ROW, UndoRow } from './comment-row';
import { pagesLabel, plural, type Issue, type PageView } from './model';

type Props = {
  pageTitle: string;
  /** The page with deleted comments still in it, so their rows can offer Undo. */
  rows: PageView;
  /** The page without them, for the counts and the recheck. */
  live: PageView;
  number: (issue: Issue) => number;
  deleted: Set<string>;
  run: RunState | null;
  verifyError: string;
  onVerify: () => void;
  onCancelVerify: () => void;
  onWidth: (width: number) => void;
  onOpen: (commentId: string) => void;
  onDelete: (issue: Issue) => void;
  onUndo: (id: string) => void;
  onWelcome: () => void;
};

/** The comments on the open page, the recheck, and the rest of the review folded into one line each. */
export function PageComments(props: Props) {
  const { pageTitle, rows, live, number, deleted, onOpen, onDelete, onUndo, onWelcome, onWidth } = props;
  const atWindow = live.width === live.windowWidth;
  const count = live.shown.length;
  return (
    <section aria-labelledby="page-heading" className="grid gap-2">
      <header className="flex h-8 items-center gap-2">
        <h2 id="page-heading" className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-base font-semibold">On {pageTitle}</span>
          <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
            {atWindow ? plural(count, 'comment') : `${plural(count, 'comment')} at ${live.width} px`}
          </span>
        </h2>
        <span className="flex-1" />
        {count > 0 && atWindow && <Recheck {...props} />}
      </header>
      {count > 0 && !atWindow && (
        <p className="text-xs font-medium text-muted-foreground">Recheck works on the {live.windowWidth} px comments, the width of this window.</p>
      )}
      {rows.shown.length ? (
        <ul className="-mx-2 grid" data-tour="list">
          {rows.shown.map((issue) =>
            deleted.has(issue.id) ? (
              <UndoRow key={issue.id} id={issue.id} n={number(issue)} onUndo={() => onUndo(issue.id)} />
            ) : (
              <CommentRow key={issue.id} issue={issue} n={number(issue)} onOpen={() => onOpen(issue.id)} onDelete={() => onDelete(issue)} />
            ),
          )}
        </ul>
      ) : (
        <div className="grid justify-items-start gap-1 rounded-xl bg-muted p-3 text-sm font-medium text-muted-foreground" data-tour="list">
          <p>No comments on this page yet. Drag over anything that looks wrong.</p>
          <button type="button" className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={onWelcome}>
            See how a review works
          </button>
        </div>
      )}
      <Folds live={live} onWidth={onWidth} onOpen={onOpen} />
    </section>
  );
}

/**
 * The recheck button and its progress for this page.
 * @param props The page, the run and handlers.
 */
function Recheck({ live, run, verifyError, onVerify, onCancelVerify }: Props) {
  const edge = '-mr-2';
  if (run?.state === 'running') {
    return (
      <span className={`flex items-center gap-1 ${edge}`}>
        <span role="status" className="flex items-center gap-2 text-xs font-medium text-muted-foreground tabular-nums">
          <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" />
          {Math.min(run.done + 1, run.total)} of {run.total}
        </span>
        <Button size="sm" variant="ghost" onClick={onCancelVerify}>
          Cancel
        </Button>
      </span>
    );
  }
  if (run) {
    return (
      <span role="status" className="text-xs font-medium text-muted-foreground">
        {run.state === 'cancelled' ? 'Stopped' : 'Done'}, {run.checked.length} checked
      </span>
    );
  }
  if (verifyError) {
    return (
      <span role="alert" className="text-xs font-medium text-destructive" title={verifyError === 'noTab' ? '' : verifyError}>
        {verifyError === 'noTab' ? 'No comments on this page' : 'Recheck failed'}
      </span>
    );
  }
  const count = live.shown.length;
  const skipped = live.onPage.length - count;
  const tip = `Captures ${count === 1 ? 'this comment' : `these ${count} comments`} again.${skipped ? ` ${plural(skipped, 'comment')} at other widths ${skipped === 1 ? 'is' : 'are'} left out.` : ''} The report opens with before and after when it is done.`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="sm" variant="ghost" className={edge} onClick={onVerify}>
            <RefreshCw className="size-4" />
            Recheck {count}
          </Button>
        }
      />
      <TooltipContent side="bottom" className="max-w-60">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * This page's comments grouped by the width they were captured at.
 * @param props The page and handlers.
 */
function Folds({ live, onWidth, onOpen }: { live: PageView; onWidth: (width: number) => void; onOpen: (commentId: string) => void }) {
  const first = live.elsewhere[0];
  if (!live.otherWidths.size && !first) return null;
  const fold = `flex w-full items-center justify-between text-left text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 ${ROW}`;
  return (
    <div className="-mx-2 grid border-t pt-2">
      {[...live.otherWidths].map(([width, n]) => (
        <button key={width} type="button" className={fold} onClick={() => onWidth(width)}>
          {n} more at {width} px
          <ChevronRight className="size-4" />
        </button>
      ))}
      {first && (
        <button type="button" className={fold} title="Opens the report at the first of them" onClick={() => onOpen(first.id)}>
          <span className="truncate">
            {live.elsewhere.length} more on {pagesLabel(live.elsewhere, true)}
          </span>
          <ChevronRight className="size-4 shrink-0" />
        </button>
      )}
    </div>
  );
}
