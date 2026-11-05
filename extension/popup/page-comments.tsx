/* oxlint-disable react/react-in-jsx-scope -- React 19 uses the automatic JSX runtime. The rule belongs off in .oxlintrc.json. */
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { ChevronRightIcon, CircleCheckIcon, CircleIcon, CircleSlashIcon, MonitorSmartphoneIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Comment, CommentStatus, Review, Severity } from '@/lib/model';
import { sendMessage } from '@/lib/protocol';
import { severityOf } from '@/lib/severity.js';
import { statusOf } from '@/lib/status.js';
import { cn } from '@/lib/utils';
import { deleteComment, openReport, openWelcome } from './actions';
import { MarginIcon, type MarginIconName } from './margin-icon';
import { padNumber, pageName, plural, samePage } from './page';
import { verifyRunQuery } from './queries';
import { usePopup } from './store';

/** How much a region may change in a recheck and still count as the same. */
const CHANGED_SHARE = 0.003;

const SEVERITY_LOOK: Record<Severity, { icon: MarginIconName; className: string }> = {
  blocker: { icon: 'sevBlocker', className: 'text-sev-blocker' },
  major: { icon: 'sevMajor', className: 'text-sev-major' },
  minor: { icon: 'sevMinor', className: 'text-sev-minor' },
  nit: { icon: 'sevNit', className: 'text-sev-nit' },
};

const STATUS_LOOK: Record<CommentStatus, { icon: typeof CircleIcon; className: string }> = {
  open: { icon: CircleIcon, className: 'text-muted-foreground' },
  fixed: { icon: CircleCheckIcon, className: 'text-success' },
  wontfix: { icon: CircleSlashIcon, className: 'text-muted-foreground' },
};

interface PageCommentsProps {
  review: Review;
  /** The review's comments, in the order they were made, without any waiting on Undo. */
  comments: Comment[];
  tab: chrome.tabs.Tab;
}

/**
 * The review's comments on the open page, with recheck and three-width capture for them, and a line to the rest.
 * With comments at more than one width the list shows one width at a time, the window's own to begin with.
 * @param props.review The review shown.
 */
export function PageComments({ review, comments, tab }: PageCommentsProps) {
  const chosenWidth = usePopup((state) => state.width);
  const setWidth = usePopup((state) => state.setWidth);
  const onPage = comments.filter((comment) => samePage(tab.url, comment.page?.url));
  const widths = [...new Set(onPage.flatMap((comment) => (comment.viewport?.width ? [comment.viewport.width] : [])))].toSorted((first, second) => second - first);
  const windowWidth = widths.toSorted((first, second) => Math.abs(first - (tab.width ?? first)) - Math.abs(second - (tab.width ?? second)))[0] ?? 0;
  const width = chosenWidth && widths.includes(chosenWidth) ? chosenWidth : windowWidth;
  const several = widths.length > 1;
  const shown = onPage.filter((comment) => !several || !comment.viewport?.width || comment.viewport.width === width);
  const elsewhere = comments.filter((comment) => !samePage(tab.url, comment.page?.url));
  const firstElsewhere = elsewhere[0];
  const otherPages = new Set(elsewhere.map((comment) => pageName(comment.page ?? { url: '' }))).size;

  return (
    <section className="flex flex-col gap-2" aria-labelledby="page-heading">
      <div className="flex items-baseline gap-2 px-1">
        <h2 id="page-heading" className="truncate text-sm font-semibold">
          On {pageName({ url: tab.url ?? '', title: tab.title })}
        </h2>
        <span className="text-xs text-muted-foreground">{plural(shown.length, 'comment')}</span>
      </div>

      {several && (
        <ToggleGroup
          value={[String(width)]}
          onValueChange={(value) => value[0] && setWidth(Number(value[0]))}
          variant="outline"
          size="sm"
          aria-label="Comment width"
        >
          {widths.map((entry) => (
            <ToggleGroupItem key={entry} value={String(entry)} className="tabular-nums">
              {entry} px
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {shown.length > 0 ? (
        <ul className="-mx-1 flex max-h-64 flex-col overflow-y-auto" data-comment-list>
          {shown.map((comment) => (
            <CommentRow key={comment.id} comment={comment} number={comments.indexOf(comment) + 1} reviewId={review.id} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No comments on this page yet.{' '}
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={openWelcome}>
            See how a review works
          </button>
        </p>
      )}

      {shown.length > 0 && <PageActions review={review} count={shown.length} width={several ? width : undefined} atWindowWidth={width === windowWidth} windowWidth={windowWidth} />}

      {firstElsewhere && (
        <button
          type="button"
          className="flex items-center justify-between rounded-md px-1 py-1 text-sm text-muted-foreground hover:text-foreground"
          title="Opens the report at the first of them"
          onClick={() => openReport(review.id, firstElsewhere.id)}
        >
          {elsewhere.length} more on {otherPages === 1 ? pageName(firstElsewhere.page ?? { url: '' }) : `${otherPages} other pages`}
          <ChevronRightIcon className="size-4" />
        </button>
      )}
    </section>
  );
}

/**
 * One comment: its severity, title, number and recheck state open it in the report. Status sits on the right,
 * and delete shows on hover or focus.
 * @param props.comment The comment.
 */
function CommentRow({ comment, number, reviewId }: { comment: Comment; number: number; reviewId: string }) {
  const severityLabel = severityOf(comment.severity)?.label ?? '';
  const statusLabel = statusOf(comment.status)?.label ?? '';
  const look = STATUS_LOOK[comment.status] ?? STATUS_LOOK.open;
  const severityLook = SEVERITY_LOOK[comment.severity] ?? SEVERITY_LOOK.major;
  const StatusIcon = look.icon;
  const title = comment.title || 'Untitled comment';
  const meta = [padNumber(number), comment.jira?.key && `Jira ${comment.jira.key}`, recheckState(comment)].filter(Boolean).join(', ');

  return (
    <li className="group/row relative flex items-center gap-1 rounded-lg hover:bg-muted focus-within:bg-muted">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none" title={title} onClick={() => openReport(reviewId, comment.id)}>
        <span title={severityLabel} className="flex">
          <MarginIcon name={severityLook.icon} className={cn('size-2.5', severityLook.className)} />
        </span>
        <span className="sr-only">{severityLabel}, </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{meta}</span>
        </span>
      </button>
      <span className={cn('flex shrink-0 items-center gap-1 pr-2 text-xs group-hover/row:hidden group-focus-within/row:hidden', look.className)}>
        <StatusIcon className="size-3.5" />
        {statusLabel}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="mr-1 hidden text-muted-foreground group-hover/row:inline-flex group-focus-within/row:inline-flex hover:text-destructive"
        aria-label={`Delete comment ${padNumber(number)}`}
        onClick={() => deleteComment(comment.id, number)}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}

/**
 * Where a comment stands against its recheck.
 * @param comment The comment.
 */
function recheckState(comment: Comment) {
  if (!comment.checkedAt) return '';
  if (typeof comment.change !== 'number') return 'rechecked';
  return comment.change < CHANGED_SHARE ? 'same as capture' : 'changed since capture';
}

interface PageActionsProps {
  review: Review;
  count: number;
  /** The width rechecked, when the page has comments at several widths. */
  width: number | undefined;
  atWindowWidth: boolean;
  windowWidth: number;
}

/**
 * Recheck captures the listed comments again for a before and after. Three widths captures them at mobile, tablet
 * and desktop. Recheck needs the comments' own width, so it waits when another width is picked.
 * @param props.count How many comments the list shows.
 */
function PageActions({ review, count, width, atWindowWidth, windowWidth }: PageActionsProps) {
  const { data: run } = useSuspenseQuery(verifyRunQuery);
  const running = run?.state === 'running' && run.groupId === review.id;

  const recheck = useMutation({
    mutationFn: () => sendMessage('verifyStart', { groupId: review.id, width }),
    onSuccess: (reply) => {
      if ('error' in reply) toast.error(reply.error === 'noTab' ? 'Open the page these comments were made on.' : reply.error);
    },
    onError: (error) => toast.error(`Recheck could not start. ${error.message}`),
  });

  const widths = useMutation({
    mutationFn: () => sendMessage('captureWidths', { page: true }),
    onSuccess: (reply) => ('error' in reply ? toast.error(reply.error) : toast.success(reply.message)),
    onError: (error) => toast.error(`Capture at three widths stopped. ${error.message}`),
  });

  if (running) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm" role="status">
        <Spinner />
        <span className="flex-1">
          Rechecking {Math.min(run.done + 1, run.total)} of {run.total}
        </span>
        <Button variant="ghost" size="sm" onClick={() => sendMessage('verifyCancel', undefined)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!atWindowWidth || recheck.isPending}
          title="Captures these comments again. The report opens with before and after when it is done."
          onClick={() => recheck.mutate()}
        >
          <RefreshCwIcon /> Recheck {count}
        </Button>
        <Button variant="outline" size="sm" disabled={widths.isPending} title="Captures these comments at mobile, tablet and desktop widths." onClick={() => widths.mutate()}>
          {widths.isPending ? <Spinner /> : <MonitorSmartphoneIcon />} Three widths
        </Button>
      </div>
      {!atWindowWidth && <p className="px-1 text-xs text-muted-foreground">Recheck works on the {windowWidth} px comments, the width of this window.</p>}
    </div>
  );
}
