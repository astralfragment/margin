import { create } from 'zustand';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
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
 * What the pixel comparison suggests. Only a hint, never a status.
 * @param comment The rechecked comment.
 */
function changeHint(comment: Comment) {
  if (typeof comment.change !== 'number') return 'No change hint for this one, the window size or the first screenshot differs.';
  if (comment.change < CHANGED_SHARE) return 'Looks unchanged.';
  const percent = Math.round(comment.change * 100);
  return `Looks changed, ${percent ? `about ${percent}%` : 'under 1%'} of the marked region differs.`;
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
    <div className="grid grid-cols-1 gap-2">
      <p className="text-xs font-medium text-muted-foreground">{heading}</p>
      <ul className="grid grid-cols-1 gap-1.5">
        {pages.map((page) => (
          <li key={page.url} className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <span className="flex min-w-0 flex-1 flex-col">
              <b className="truncate text-sm">{routeOf(page)}</b>
              <span className="text-xs text-muted-foreground">{plural(page.count, 'comment', 'comments')}</span>
            </span>
            <Button size="sm" variant="outline" render={<a href={page.url} target="_blank" rel="noopener" />} nativeButton={false}>
              <ExternalLink />
              Open this page to verify
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The before and after of the comment the walk is on.
 * @param props.comment The comment.
 * @param props.number Its number.
 */
function WalkItem({ comment, number }: { comment: Comment; number: number }) {
  const images = useImages(comment.id).data ?? {};
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-extrabold text-muted-foreground tabular-nums">{pad(number)}</span>
        <b className="min-w-0 flex-1 truncate">{comment.title || 'Untitled comment'}</b>
        <SeverityBadge severity={comment.severity} />
        <StatusBadge status={comment.status} />
      </div>
      {comment.note && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{comment.note}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <figure className="m-0">
          {images.detail ? <img src={images.detail} alt={`Marked region before, comment ${number}`} className="block max-w-full rounded-lg border" /> : <p className="text-sm text-muted-foreground">No image of the region</p>}
          <figcaption className="mt-1 text-xs font-semibold text-muted-foreground">Before</figcaption>
        </figure>
        <figure className="m-0">
          {images.after ? <img src={images.after} alt={`Same region now, comment ${number}`} className="block max-w-full rounded-lg border" /> : <p className="text-sm text-muted-foreground">No image of the region</p>}
          <figcaption className="mt-1 text-xs font-semibold text-muted-foreground">{recheckCaption(comment)}</figcaption>
        </figure>
      </div>
      <p className="text-sm text-muted-foreground">{changeHint(comment)}</p>
    </div>
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
        Include the {count} already marked Fixed or Won't fix
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
    const statuses = list.map((comment) => statusOf(fresh(comment).status).key);
    const tally = STATUSES.map((entry) => `${statuses.filter((key) => key === entry.key).length} ${entry.label.toLowerCase()}`).join(', ');
    const changed = Object.entries(changes);
    return (
      <>
        <div className="grid grid-cols-1 gap-4 overflow-y-auto">
          <p>{list.length ? `${plural(list.length, 'comment', 'comments')} checked, ${tally}.` : "Every rechecked comment is already marked Fixed or Won't fix."}</p>
          <IncludeResolved />
          {changed.length ? (
            <div className="grid grid-cols-1 gap-2">
              <p className="text-xs font-medium text-muted-foreground">Changed</p>
              <ul className="grid grid-cols-1 gap-1.5">
                {changed.map(([id, change]) => {
                  const comment = all.find((entry) => entry.id === id);
                  if (!comment) return null;
                  return (
                    <li key={id} className="flex items-center gap-3 text-sm">
                      <span className="text-xs font-extrabold text-muted-foreground tabular-nums">{pad(numberOf(comment))}</span>
                      <span className="min-w-0 flex-1 truncate">{comment.title || 'Untitled comment'}</span>
                      <span className="text-xs text-muted-foreground">
                        {statusOf(change.from).label} to {statusOf(change.to).label}
                      </span>
                      <Button size="xs" variant="ghost" onClick={() => setStatus(comment, change.from)}>
                        Undo
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No status changed.</p>
          )}
          {run && run.failed.length > 0 && <p className="text-sm text-muted-foreground">{run.failed.length} could not be captured. Try Recheck from the popup on those.</p>}
          <OtherPages except={run?.page} heading="Comments on other pages" />
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={!list.length} onClick={() => move(-1)}>
            Previous
          </Button>
          <Button autoFocus onClick={() => useRecheck.setState({ phase: null })}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  const comment = fresh(current);
  return (
    <>
      <div className="grid grid-cols-1 gap-4 overflow-y-auto">
        <WalkItem comment={comment} number={numberOf(comment)} />
        {at === 0 && <IncludeResolved />}
        <OtherPages except={run?.page} heading="Comments on other pages" />
      </div>
      <DialogFooter className="flex-wrap items-center">
        <span className="mr-auto hidden flex-wrap items-center gap-1 text-xs text-muted-foreground md:flex">
          <Kbd>F</Kbd> fixed <Kbd>O</Kbd> still open <Kbd>W</Kbd> won't fix <Kbd>
            <ArrowLeft />
          </Kbd>
          <Kbd>
            <ArrowRight />
          </Kbd>{' '}
          move
        </span>
        <Button variant="ghost" disabled={!at} onClick={() => move(-1)}>
          Previous
        </Button>
        <Button variant="ghost" onClick={() => move(1)}>
          Skip
        </Button>
        <Button variant="outline" onClick={() => pick('wontfix')}>
          Won't fix
        </Button>
        <Button variant="outline" onClick={() => pick('open')}>
          Still open
        </Button>
        <Button className="bg-action text-action-foreground hover:bg-action/80" onClick={() => pick('fixed')}>
          Fixed
        </Button>
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
      <div className="grid gap-3">
        <p>
          Stopped after {run.done} of {run.total}. {missed.length} {missed.length === 1 ? 'comment was' : 'comments were'} not checked.
        </p>
        <ul className="grid gap-1 text-sm">
          {missed.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <span className="text-xs font-extrabold text-muted-foreground tabular-nums">{pad(numberOf(comment))}</span>
              {comment.title || 'Untitled comment'}
            </li>
          ))}
        </ul>
        {checked > 0 && <p className="text-sm text-muted-foreground">You can review the {checked} that {checked === 1 ? 'was' : 'were'} checked now.</p>}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={() => useRecheck.setState({ phase: null })}>
          Close
        </Button>
        {missed.length > 0 && (
          <Button variant="outline" onClick={() => startRecheck(missed.map((comment) => comment.id))}>
            Check the other {missed.length}
          </Button>
        )}
        {checked > 0 && (
          <Button autoFocus onClick={() => showWalk(run)}>
            Review {checked}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

/**
 * The line under the sheet's title: how far the run or the walk has got.
 * @param state The recheck state.
 */
function headerLine({ phase, run, stopping, list, at }: Pick<RecheckState, 'phase' | 'run' | 'stopping' | 'list' | 'at'>) {
  if (phase === 'walk') return at < list.length ? `${at + 1} of ${list.length}` : `${list.length} checked`;
  if (!run) return '';
  if (phase === 'progress') return stopping ? 'Stopping after this capture' : `${run.done} of ${run.total} checked`;
  if (phase === 'stopped') return `Stopped after ${run.done} of ${run.total}`;
  return '';
}

/** The recheck sheet: no page to check, the run's progress, a stopped run, or the walk. */
export function RecheckDialog() {
  const { phase, run, stopping, list, at } = useRecheck();
  const state = headerLine({ phase, run, stopping, list, at });
  return (
    <Dialog
      open={phase !== null}
      onOpenChange={(open) => {
        if (open) return;
        if (useRecheck.getState().awaiting) cancelRun();
        else useRecheck.setState({ phase: null });
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl" showCloseButton={phase !== 'progress'}>
        <DialogHeader>
          <DialogTitle>Recheck fixes</DialogTitle>
          <DialogDescription>{state}</DialogDescription>
        </DialogHeader>
        {phase === 'noTab' && (
          <>
            <div className="grid grid-cols-1 gap-4 overflow-y-auto">
              <p className="text-sm text-muted-foreground">
                Margin can capture a page only after you open Margin on it. Open the page, click Margin in the toolbar and press Recheck there.
              </p>
              <OtherPages heading="Pages in this review" />
            </div>
            <DialogFooter>
              <Button onClick={() => useRecheck.setState({ phase: null })}>Close</Button>
            </DialogFooter>
          </>
        )}
        {phase === 'progress' && run && (
          <>
            <div className="grid gap-2">
              <p>
                Checking {Math.min(run.done + 1, run.total)} of {run.total}
                {run.page ? ` on ${routeOf({ url: run.page, title: run.title })}` : ''}
              </p>
              <p className="text-sm text-muted-foreground">Press Cancel or Escape to stop after the capture in progress. Switching away from the page's tab stops it too.</p>
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
