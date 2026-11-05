import { useRef } from 'react';
import { create } from 'zustand';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Diff, Equal, ExternalLink, Info, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { orderIssues, recheckCaption, routeOf, STATUSES, statusOf } from './shared';
import { commentsInReview } from '@/lib/review-store';
import { verifyRunItem } from '@/lib/storage';
import type { Comment, CommentStatus, VerifyRun } from '@/lib/model';
import { ALL_REVIEWS, ask, queryClient, useImages } from './data';
import { SeverityBadge, StatusBadge } from './badges';
import { opened, useReportUi } from './ui-store';
import { currentReviewKey, useReportComments } from './use-report';
import { pad, plural, samePage } from './format';

/**
 * Recheck fixes: one run captures every comment of the review again on the page Margin was last opened on, then a
 * walk shows each region before and after so the reviewer sets its status. The pixel hint never sets a status.
 */

const STALE_RUN_MS = 60_000;
const CHANGED_SHARE = 0.003;

interface Change {
  from: CommentStatus;
  to: CommentStatus;
}

interface RecheckState {
  phase: 'noTab' | 'progress' | 'stopped' | 'walk' | null;
  /** True between starting a run and its end, so storage updates from other runs are ignored. */
  awaiting: boolean;
  stopping: boolean;
  run: VerifyRun | null;
  /** The comments the walk shows, in report order, fixed when the walk starts. */
  list: Comment[];
  /** Every comment the run checked, for the include resolved option. */
  checked: Comment[];
  includeResolved: boolean;
  changes: Record<string, Change>;
  at: number;
}

const useRecheck = create<RecheckState>(() => ({
  phase: null,
  awaiting: false,
  stopping: false,
  run: null,
  list: [],
  checked: [],
  includeResolved: false,
  changes: {},
  at: 0,
}));

/**
 * The comments to walk: the open ones, or every checked one when asked.
 * @param checked The comments the run checked.
 * @param includeResolved True to include those already Fixed or Won't fix.
 * @param changes Statuses already changed in this walk.
 */
const walkList = (checked: Comment[], includeResolved: boolean, changes: Record<string, Change>) =>
  checked.filter((comment) => includeResolved || (changes[comment.id]?.from ?? statusOf(comment.status).key) === 'open');

/**
 * Opens the walk over the comments a run checked, in the order the report lists them.
 * @param run The finished run.
 */
async function showWalk(run: VerifyRun) {
  const stored = await commentsInReview(run.groupId);
  const checked = (orderIssues(stored, useReportUi.getState().sort) as Comment[]).filter((comment) => run.checked.includes(comment.id));
  for (const id of run.checked) queryClient.invalidateQueries({ queryKey: ['images', id] });
  useRecheck.setState({ phase: 'walk', run, checked, includeResolved: false, changes: {}, at: 0, list: walkList(checked, false, {}) });
}

/**
 * Takes in a run record as the service worker updates it.
 * @param run The run record.
 */
function onRun(run: VerifyRun | null) {
  if (!run || !useRecheck.getState().awaiting) return;
  if (run.state === 'running') {
    useRecheck.setState({ phase: 'progress', run });
    return;
  }
  useRecheck.setState({ awaiting: false, stopping: false, run });
  if (run.state === 'cancelled' && run.done < run.total) useRecheck.setState({ phase: 'stopped' });
  else showWalk(run);
}

/** Follows recheck runs, and picks up a run the report was opened for. Call once at start. */
export async function followRecheck() {
  verifyRunItem.watch(onRun);
  if (!opened.verify) return;
  const url = new URL(location.href);
  url.searchParams.delete('verify');
  history.replaceState(null, '', url);
  const run = await verifyRunItem.getValue();
  if (run?.state === 'running' && Date.now() - run.at < STALE_RUN_MS) {
    useRecheck.setState({ awaiting: true, phase: 'progress', run });
  } else if (run && run.state !== 'running') {
    useRecheck.setState({ run });
    await showWalk(run);
  }
}

/**
 * Starts a recheck run on the page Margin was last opened on.
 * @param ids Only these comments, as when checking the ones a stopped run missed.
 */
export async function startRecheck(ids?: string[]) {
  const key = currentReviewKey();
  if (!key || key === ALL_REVIEWS) {
    toast.info('Pick one review to recheck. All reviews can not be rechecked at once.');
    return;
  }
  try {
    const reply = await ask('verifyStart', { groupId: key, ids });
    const page = useRecheck.getState().run?.page ?? '';
    useRecheck.setState({
      awaiting: true,
      phase: 'progress',
      run: { state: 'running', groupId: key, page, title: '', total: reply.total, done: 0, checked: [], failed: [], at: Date.now() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'noTab') useRecheck.setState({ phase: 'noTab' });
    else toast.error(message === 'A check is already running' ? 'A recheck is already running' : `Recheck failed. ${message}`);
  }
}

/** Stops the run after the capture in progress. */
async function cancelRun() {
  useRecheck.setState({ stopping: true });
  try {
    await ask('verifyCancel', undefined);
  } catch (error) {
    toast.error(`The recheck did not stop. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Sets one comment's status and records the change, so the summary can undo it.
 * @param comment The comment.
 * @param status The status picked.
 */
async function setStatus(comment: Comment, status: CommentStatus) {
  const { changes } = useRecheck.getState();
  const from = changes[comment.id]?.from ?? statusOf(comment.status).key;
  try {
    await ask('update', { id: comment.id, patch: { status } });
  } catch (error) {
    toast.error(`The status was not saved. ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
  const next = { ...useRecheck.getState().changes };
  if (from === status) delete next[comment.id];
  else next[comment.id] = { from, to: status };
  useRecheck.setState({ changes: next });
  return true;
}

/**
 * Saves the status picked for the comment on screen and moves on.
 * @param status The status.
 */
async function pick(status: CommentStatus) {
  const { list, at } = useRecheck.getState();
  const comment = list[at];
  if (comment && (await setStatus(comment, status))) useRecheck.setState({ at: at + 1 });
}

/**
 * Steps the walk forward or back, stopping at the first comment and at the summary.
 * @param step 1 for the next, -1 for the one before.
 */
const move = (step: number) => {
  const { list, at } = useRecheck.getState();
  useRecheck.setState({ at: Math.max(0, Math.min(list.length, at + step)) });
};

/**
 * What the pixel comparison suggests, with an icon. Only a hint, never a status.
 * @param comment The rechecked comment.
 */
function changeHint(comment: Comment) {
  if (typeof comment.change !== 'number') return { Icon: Info, text: 'No comparison for this one, because the window size or the first screenshot is different.' };
  if (comment.change < CHANGED_SHARE) return { Icon: Equal, text: 'The marked area looks the same as before.' };
  const percent = Math.round(comment.change * 100);
  return { Icon: Diff, text: `The marked area looks different, ${percent ? `about ${percent}%` : 'under 1%'} of it changed.` };
}

/**
 * The review's pages other than one, each with its comment count and a link to open it.
 * @param props.except A page to leave out.
 * @param props.heading The line above the list.
 */
function OtherPages({ except, heading }: { except?: string; heading: string }) {
  const { ordered } = useReportComments();
  const pages: { url: string; title: string; count: number }[] = [];
  for (const comment of ordered) {
    if (!comment.page?.url || samePage(comment.page.url, except)) continue;
    const found = pages.find((page) => samePage(page.url, comment.page.url));
    if (found) found.count += 1;
    else pages.push({ url: comment.page.url, title: comment.page.title, count: 1 });
  }
  if (!pages.length) return null;
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-medium">{heading}</h3>
      <ul className="grid divide-y">
        {pages.map((page) => (
          <li key={page.url} className="flex items-center gap-3 py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{routeOf(page)}</span>
              <span className="text-xs text-muted-foreground">{plural(page.count, 'comment', 'comments')}</span>
            </span>
            <Button size="sm" variant="outline" render={<a href={page.url} target="_blank" rel="noopener" />} nativeButton={false}>
              <ExternalLink />
              Open page
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One screenshot of the region. Before and after are cut at the same region, so they line up side by side.
 * @param props.label The line above it.
 * @param props.src The image, if there is one.
 * @param props.alt Its text alternative.
 */
function Shot({ label, src, alt }: { label: string; src?: string | null; alt: string }) {
  return (
    <figure className="m-0 grid min-w-0 content-start gap-2">
      <figcaption className="truncate text-xs font-medium text-muted-foreground">{label}</figcaption>
      {src ? (
        <img src={src} alt={alt} className="block w-full rounded-xl ring-1 ring-foreground/10" />
      ) : (
        <p className="flex aspect-video items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">No image yet</p>
      )}
    </figure>
  );
}

/**
 * The before and after of the comment the walk is on.
 * @param props.comment The comment.
 * @param props.number Its number.
 */
function WalkItem({ comment, number }: { comment: Comment; number: number }) {
  const images = useImages(comment.id).data ?? {};
  const hint = changeHint(comment);
  return (
    <div className="grid gap-4">
      <div className="flex items-start gap-3">
        <span className="pt-0.5 text-xs font-extrabold text-muted-foreground tabular-nums">{pad(number)}</span>
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="text-base font-semibold">{comment.title || 'Untitled comment'}</h3>
          {comment.note && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{comment.note}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SeverityBadge severity={comment.severity} />
          <StatusBadge status={comment.status} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Shot label="Before" src={images.detail} alt={`Marked region before, comment ${number}`} />
        <Shot label={recheckCaption(comment)} src={images.after} alt={`Same region now, comment ${number}`} />
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <hint.Icon className="size-4 shrink-0" aria-hidden="true" />
        {hint.text}
      </p>
    </div>
  );
}

/**
 * A status button with its key in the tooltip.
 * @param props.shortcut The key that does the same.
 */
function StatusButton({ shortcut, ...props }: React.ComponentProps<typeof Button> & { shortcut: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-keyshortcuts={shortcut} {...props} />} />
      <TooltipContent>Shortcut {shortcut}</TooltipContent>
    </Tooltip>
  );
}

/** The option to walk the comments already Fixed or Won't fix too. */
function IncludeResolved() {
  const { checked, includeResolved, changes } = useRecheck();
  const count = checked.filter((comment) => (changes[comment.id]?.from ?? statusOf(comment.status).key) !== 'open').length;
  if (!count) return null;
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="recheck-resolved"
        checked={includeResolved}
        onCheckedChange={(next) => useRecheck.setState({ includeResolved: next === true, list: walkList(checked, next === true, changes), at: 0 })}
      />
      <Label htmlFor="recheck-resolved" className="font-normal">
        Also show the {count} already marked Fixed or Won't fix
      </Label>
    </div>
  );
}

/** The walk: one comment at a time, then the summary of what changed. */
function Walk() {
  const { list, at, run, changes } = useRecheck();
  const { all, numberOf } = useReportComments();
  const fresh = (comment: Comment) => all.find((entry) => entry.id === comment.id) ?? comment;
  const current = list[at];
  const done = !current;
  useHotkeys('f', () => pick('fixed'), { enabled: !done }, [done]);
  useHotkeys('o', () => pick('open'), { enabled: !done }, [done]);
  useHotkeys('w', () => pick('wontfix'), { enabled: !done }, [done]);
  useHotkeys('right', () => move(1));
  useHotkeys('left', () => move(-1));

  if (done) {
    const changed = Object.entries(changes);
    return (
      <>
        <div className="-mx-6 grid min-h-0 gap-6 overflow-y-auto px-6">
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Status changes</h3>
            {changed.length ? (
              <ul className="grid divide-y">
                {changed.map(([id, change]) => {
                  const comment = all.find((entry) => entry.id === id);
                  if (!comment) return null;
                  return (
                    <li key={id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <span className="text-xs font-extrabold text-muted-foreground tabular-nums">{pad(numberOf(comment))}</span>
                      <span className="min-w-0 flex-1 truncate">{comment.title || 'Untitled comment'}</span>
                      <span className="flex items-center gap-2">
                        <StatusBadge status={change.from} />
                        <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" />
                        <StatusBadge status={change.to} />
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => setStatus(comment, change.from)}>
                        <Undo2 />
                        Undo
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No status changed.</p>
            )}
          </section>
          {run && run.failed.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="size-4 shrink-0" aria-hidden="true" />
              {plural(run.failed.length, 'comment', 'comments')} could not be captured. Open the page and press Recheck in the Margin popup to try again.
            </p>
          )}
          <IncludeResolved />
          <OtherPages except={run?.page} heading="Comments on other pages" />
        </div>
        <DialogFooter className="items-center">
          <Button variant="ghost" className="sm:mr-auto" disabled={!list.length} onClick={() => move(-1)}>
            <ArrowLeft />
            Back
          </Button>
          <Button onClick={() => useRecheck.setState({ phase: null })}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  const comment = fresh(current);
  return (
    <>
      <div className="-mx-6 grid min-h-0 gap-6 overflow-y-auto px-6">
        <WalkItem comment={comment} number={numberOf(comment)} />
        {at === 0 && <IncludeResolved />}
        <OtherPages except={run?.page} heading="Comments on other pages" />
      </div>
      <DialogFooter className="items-center">
        <div className="flex gap-2 sm:mr-auto">
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" disabled={!at} onClick={() => move(-1)} aria-keyshortcuts="ArrowLeft" />}>
              <ArrowLeft />
              Back
            </TooltipTrigger>
            <TooltipContent>Shortcut Left arrow</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" onClick={() => move(1)} aria-keyshortcuts="ArrowRight" />}>
              Skip
              <ArrowRight />
            </TooltipTrigger>
            <TooltipContent>Shortcut Right arrow</TooltipContent>
          </Tooltip>
        </div>
        <StatusButton variant="outline" shortcut="W" onClick={() => pick('wontfix')}>
          Won't fix
        </StatusButton>
        <StatusButton variant="outline" shortcut="O" onClick={() => pick('open')}>
          Still open
        </StatusButton>
        <StatusButton shortcut="F" onClick={() => pick('fixed')}>
          Fixed
        </StatusButton>
      </DialogFooter>
    </>
  );
}

/** Says a run stopped early, names what it missed, and offers to check those or review the rest. */
function Stopped() {
  const { run } = useRecheck();
  const { ordered, numberOf } = useReportComments();
  if (!run) return null;
  const missed = ordered.filter((comment) => samePage(comment.page?.url, run.page) && !run.checked.includes(comment.id) && !run.failed.includes(comment.id));
  const checked = run.checked.length;
  return (
    <>
      <div className="-mx-6 grid min-h-0 gap-4 overflow-y-auto px-6">
        <p className="text-sm">
          {missed.length} {missed.length === 1 ? 'comment was' : 'comments were'} not checked.
          {checked > 0 && ` You can still go through the ${checked} that ${checked === 1 ? 'was' : 'were'} checked.`}
        </p>
        <ul className="grid divide-y">
          {missed.map((comment) => (
            <li key={comment.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="text-xs font-extrabold text-muted-foreground tabular-nums">{pad(numberOf(comment))}</span>
              <span className="min-w-0 flex-1 truncate">{comment.title || 'Untitled comment'}</span>
            </li>
          ))}
        </ul>
      </div>
      <DialogFooter className="items-center">
        <Button variant="ghost" className="sm:mr-auto" onClick={() => useRecheck.setState({ phase: null })}>
          Close
        </Button>
        {missed.length > 0 && (
          <Button variant={checked > 0 ? 'outline' : 'default'} onClick={() => startRecheck(missed.map((comment) => comment.id))}>
            Check the other {missed.length}
          </Button>
        )}
        {checked > 0 && <Button onClick={() => showWalk(run)}>Go through {checked}</Button>}
      </DialogFooter>
    </>
  );
}

/**
 * The summary line once the walk is over: how many were checked and where their statuses stand now.
 * @param list The comments the walk showed.
 * @param all The report's comments, which carry the statuses picked.
 */
function summaryLine(list: Comment[], all: Comment[]) {
  if (!list.length) return "Nothing to check. Every rechecked comment is already marked Fixed or Won't fix.";
  const statuses = list.map((comment) => statusOf((all.find((entry) => entry.id === comment.id) ?? comment).status).key);
  const tally = STATUSES.map((entry) => `${statuses.filter((key) => key === entry.key).length} ${entry.label.toLowerCase()}`).filter((entry) => !entry.startsWith('0 '));
  const joined = tally.length > 1 ? `${tally.slice(0, -1).join(', ')} and ${tally.at(-1)}` : tally.join('');
  return `Checked ${plural(list.length, 'comment', 'comments')}. Now ${joined}.`;
}

/**
 * The line under the sheet's title: how far the run or the walk has got.
 * @param state The recheck state, with the report's comments for the summary.
 */
function headerLine({ phase, run, stopping, list, at, all }: Pick<RecheckState, 'phase' | 'run' | 'stopping' | 'list' | 'at'> & { all: Comment[] }) {
  if (phase === 'walk') return at < list.length ? `Comment ${at + 1} of ${list.length}. Compare before and after, then pick a status.` : summaryLine(list, all);
  if (phase === 'noTab') return 'Margin has no page to capture yet.';
  if (!run) return '';
  if (phase === 'progress') return stopping ? 'Stopping after this capture' : 'Margin captures each marked area again on the page.';
  if (phase === 'stopped') return `Stopped after ${run.done} of ${run.total}.`;
  return '';
}

/** The recheck sheet: no page to check, the run's progress, a stopped run, or the walk. */
export function RecheckDialog() {
  const { phase, run, stopping, list, at } = useRecheck();
  const { all } = useReportComments();
  const state = headerLine({ phase, run, stopping, list, at, all });
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open={phase !== null}
      onOpenChange={(open) => {
        if (open) return;
        if (useRecheck.getState().awaiting) cancelRun();
        else useRecheck.setState({ phase: null });
      }}
    >
      <DialogContent ref={popup} initialFocus={popup} className="flex max-h-[90vh] flex-col sm:max-w-3xl" showCloseButton={phase !== 'progress'}>
        <DialogHeader className="gap-1 pr-8">
          <DialogTitle>Recheck fixes</DialogTitle>
          <DialogDescription>{state}</DialogDescription>
        </DialogHeader>
        {phase === 'noTab' && (
          <>
            <div className="-mx-6 grid min-h-0 gap-6 overflow-y-auto px-6">
              <p className="text-sm">Open the page in a tab, click Margin in the toolbar, then press Recheck there.</p>
              <OtherPages heading="Pages in this review" />
            </div>
            <DialogFooter>
              <Button onClick={() => useRecheck.setState({ phase: null })}>Close</Button>
            </DialogFooter>
          </>
        )}
        {phase === 'progress' && run && (
          <>
            <div className="grid gap-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Spinner />
                Checking {Math.min(run.done + 1, run.total)} of {run.total}
                {run.page ? ` on ${routeOf({ url: run.page, title: run.title })}` : ''}
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full origin-left bg-foreground transition-transform duration-200 motion-reduce:transition-none"
                  style={{ transform: `scaleX(${run.total ? run.done / run.total : 0})` }}
                />
              </div>
              <p className="text-sm text-muted-foreground">Keep the page's tab open. Cancel stops after the capture in progress.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={stopping} onClick={cancelRun}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}
        {phase === 'stopped' && <Stopped />}
        {phase === 'walk' && <Walk />}
      </DialogContent>
    </Dialog>
  );
}
