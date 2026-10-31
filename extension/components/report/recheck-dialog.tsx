import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { SeverityLabel } from '@/components/margin/severity';
import { StatusLabel } from '@/components/margin/status';
import { recheckCaption, routeOf } from '@/lib/review-model.js';
import { STATUSES, statusOf } from '@/lib/status.js';
import { useUpdateComment, useVerifyRun } from './queries';
import { CLOSED_RECHECK, useReportUi, type Recheck } from './store';
import { Checkbox } from './ui/checkbox';
import type { Issue, VerifyRun } from './types';
import { pad, plural, samePage, send } from './util';

const STALE_RUN_MS = 60_000;
const CHANGED_SHARE = 0.003;
const KEYS: Record<string, string> = { f: 'fixed', o: 'open', w: 'wontfix' };

type Props = { groupId: string | null; ordered: Issue[]; numberOf: (issue: Issue) => number };
type View =
  | { kind: 'closed' }
  | { kind: 'noTab' }
  | { kind: 'progress'; run: Pick<VerifyRun, 'done' | 'total' | 'page' | 'title'> }
  | { kind: 'stopped'; run: VerifyRun }
  | { kind: 'walk'; run: VerifyRun };

/** What the pixel comparison suggests for one comment. It is only a hint and never sets a status. */
function changeHint(issue: Issue) {
  if (typeof issue.change !== 'number') return 'No change hint for this one, the window size or the first screenshot differs.';
  if (issue.change < CHANGED_SHARE) return 'Looks unchanged.';
  const percent = Math.round(issue.change * 100);
  return `Looks changed, ${percent ? `about ${percent}%` : 'under 1%'} of the marked region differs.`;
}

/**
 * Which part of the recheck shows, from what was asked and the run record the background keeps in storage.
 * A run counts once it was written after Recheck was pressed, so an older finished run never shows as this one.
 */
function viewOf(recheck: Recheck, run: VerifyRun | null, groupId: string | null): View {
  if (recheck.mode === 'closed') return { kind: 'closed' };
  if (recheck.mode === 'noTab') return { kind: 'noTab' };
  if (recheck.mode === 'review') return recheck.run ? { kind: 'walk', run: recheck.run } : { kind: 'closed' };
  if (recheck.mode === 'resume') {
    if (run?.state === 'running' && recheck.startedAt - run.at < STALE_RUN_MS) return { kind: 'progress', run };
    if (run && run.state !== 'running' && run.groupId === groupId) return { kind: 'walk', run };
    return { kind: 'closed' };
  }
  const current = run && run.at >= recheck.startedAt ? run : null;
  if (!current || current.state === 'running') return { kind: 'progress', run: current ?? { done: 0, total: recheck.total, page: '' } };
  if (current.state === 'cancelled' && current.done < current.total) return { kind: 'stopped', run: current };
  return { kind: 'walk', run: current };
}

/** True while a run is going, so Recheck shows it is busy. */
export function useRecheckBusy(groupId: string | null) {
  const recheck = useReportUi((s) => s.recheck);
  const run = useVerifyRun().data ?? null;
  return viewOf(recheck, run, groupId).kind === 'progress';
}

/**
 * Starts a recheck run on the page Margin was last opened on.
 * @returns A message when the run could not start, for a toast or the dialog.
 */
export async function startRecheck(groupId: string | null, ids?: string[]) {
  const set = useReportUi.getState().set;
  const startedAt = Date.now();
  const res = await send('verifyStart', { groupId, ids });
  if (res?.error === 'noTab') return set({ recheck: { mode: 'noTab', startedAt, total: 0 } });
  if (res?.error) return res.error === 'A check is already running' ? 'A recheck is already running' : `Recheck failed. ${res.error}`;
  set({ recheck: { mode: 'running', startedAt, total: res.total } });
}

/**
 * Recheck: captures every comment on the open page again, then walks through the before and after of each,
 * where the reviewer marks it Fixed, Still open or Won't fix. Only the reviewer sets a status.
 */
export function RecheckDialog({ groupId, ordered, numberOf }: Props) {
  const recheck = useReportUi((s) => s.recheck);
  const set = useReportUi((s) => s.set);
  const run = useVerifyRun().data ?? null;
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const view = viewOf(recheck, run, groupId);
  const close = () => set({ recheck: CLOSED_RECHECK });
  const cancelRun = () => {
    setStopping(true);
    send('verifyCancel');
  };

  /** The pages of this review other than one, each with how many comments it has. */
  const others = (except?: string, heading = 'Comments on other pages') => {
    const pages: { page: { url: string; title?: string }; count: number }[] = [];
    for (const issue of ordered) {
      if (!issue.page?.url || samePage(issue.page.url, except)) continue;
      const found = pages.find((p) => samePage(p.page.url, issue.page!.url));
      if (found) found.count += 1;
      else pages.push({ page: issue.page, count: 1 });
    }
    if (!pages.length) return null;
    return (
      <div className="grid gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{heading}</h3>
        <ul className="grid divide-y rounded-lg border">
          {pages.map(({ page, count }) => (
            <li key={page.url} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="grid min-w-0">
                <span className="truncate text-sm font-medium">{routeOf(page)}</span>
                <span className="text-sm font-medium text-muted-foreground">{plural(count, 'comment', 'comments')}</span>
              </span>
              <Button variant="outline" size="sm" onClick={() => chrome.tabs.create({ url: page.url })}>
                <ExternalLink />
                Open page
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  let content: ReactNode = null;
  if (view.kind === 'noTab') {
    content = (
      <Layout
        state=""
        body={
          <>
            <p className="text-sm">Margin can capture a page only after you open Margin on it. Open the page, click Margin in the toolbar and press Recheck there.</p>
            {others(undefined, 'Pages in this review')}
          </>
        }
        foot={<Button onClick={close}>Close</Button>}
      />
    );
  } else if (view.kind === 'progress') {
    const r = view.run;
    content = (
      <Layout
        state={`${r.done} of ${r.total} checked`}
        body={
          <div className="grid gap-3">
            <p className="text-sm">
              Checking {Math.min(r.done + 1, r.total)} of {r.total}
              {r.page ? ` on ${routeOf({ url: r.page, title: r.title })}` : ''}
            </p>
            <div className="h-1 overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={r.done} aria-label="Recheck progress">
              <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${r.total ? (r.done / r.total) * 100 : 0}%` }} />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Press Cancel or Escape to stop after the capture in progress. Switching away from the page's tab stops it too.</p>
          </div>
        }
        foot={
          <Button variant="outline" onClick={cancelRun} disabled={stopping}>
            {stopping ? 'Stopping after this capture' : 'Cancel'}
          </Button>
        }
      />
    );
  } else if (view.kind === 'stopped') {
    const r = view.run;
    const missed = ordered.filter((i) => samePage(i.page?.url, r.page) && !r.checked.includes(i.id) && !r.failed.includes(i.id));
    const n = r.checked.length;
    content = (
      <Layout
        state={error || `Stopped after ${r.done} of ${r.total}`}
        body={
          <>
            <p className="text-sm">
              {plural(missed.length, 'comment was', 'comments were')} not checked.
              {n ? ` You can review the ${n} that ${n === 1 ? 'was' : 'were'} checked now.` : ''}
            </p>
            <ul className="grid gap-2">
              {missed.map((i) => (
                <li key={i.id} className="flex items-baseline gap-3 text-sm">
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">{pad(numberOf(i))}</span>
                  {i.title || 'Untitled comment'}
                </li>
              ))}
            </ul>
          </>
        }
        foot={
          <>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            {missed.length > 0 && (
              <Button
                variant="outline"
                onClick={async () => {
                  setStopping(false);
                  setError(
                    (await startRecheck(
                      groupId,
                      missed.map((i) => i.id),
                    )) ?? '',
                  );
                }}
              >
                Check the other {missed.length}
              </Button>
            )}
            {n > 0 && (
              <Button autoFocus onClick={() => set({ recheck: { ...CLOSED_RECHECK, mode: 'review', run: r } })}>
                Review {n}
              </Button>
            )}
          </>
        }
      />
    );
  } else if (view.kind === 'walk') {
    content = <Walk key={view.run.at} run={view.run} ordered={ordered} numberOf={numberOf} others={others} onDone={close} />;
  }

  return (
    <Dialog
      open={view.kind !== 'closed'}
      onOpenChange={(open) => {
        if (open) return;
        if (view.kind === 'progress') cancelRun();
        else close();
      }}
      onOpenChangeComplete={(open) => {
        if (open) return;
        setStopping(false);
        setError('');
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-3xl">{content}</DialogContent>
    </Dialog>
  );
}

function Layout({ state, body, foot, onKeyDown }: { state: string; body: ReactNode; foot: ReactNode; onKeyDown?: (e: KeyboardEvent) => void }) {
  return (
    <>
      <DialogHeader className="flex-row items-baseline gap-3 border-b p-5 pr-12">
        <DialogTitle>Recheck fixes</DialogTitle>
        <DialogDescription className="font-medium tabular-nums">{state}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-5 overflow-y-auto p-5" onKeyDown={onKeyDown}>
        {body}
      </div>
      <DialogFooter className="m-0 flex-row flex-wrap items-center justify-end rounded-b-xl" onKeyDown={onKeyDown}>
        {foot}
      </DialogFooter>
    </>
  );
}

type WalkProps = {
  run: VerifyRun;
  ordered: Issue[];
  numberOf: (issue: Issue) => number;
  others: (except?: string) => ReactNode;
  onDone: () => void;
};

/** One comment at a time, before and after, then a summary of what changed with Undo for each. */
function Walk({ run, ordered, numberOf, others, onDone }: WalkProps) {
  const update = useUpdateComment();
  const [at, setAt] = useState(0);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [changes, setChanges] = useState<Map<string, { from: string; to: string }>>(new Map());
  const checked = ordered.filter((issue) => run.checked.includes(issue.id));
  const fromOf = (issue: Issue) => changes.get(issue.id)?.from ?? statusOf(issue.status).key;
  const list = checked.filter((i) => includeResolved || fromOf(i) === 'open');
  const resolvedCount = checked.filter((i) => fromOf(i) !== 'open').length;

  /** Sets one comment's status and records it in the list of changes. */
  const setStatus = (issue: Issue, status: string) => {
    const from = fromOf(issue);
    update.mutate({ id: issue.id, patch: { status } });
    setChanges((all) => {
      const next = new Map(all);
      if (from === status) next.delete(issue.id);
      else next.set(issue.id, { from, to: status });
      return next;
    });
  };
  const pick = (status: string) => {
    const issue = list[at];
    if (!issue) return;
    setStatus(issue, status);
    setAt(at + 1);
  };
  const move = (step: number) => setAt(Math.max(0, Math.min(list.length, at + step)));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || (event.target as Element).closest('input, textarea, select')) return;
    const status = KEYS[event.key.toLowerCase()];
    if (status && at < list.length) {
      event.preventDefault();
      pick(status);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      move(event.key === 'ArrowRight' ? 1 : -1);
    }
  };

  const toggle = resolvedCount > 0 && (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
      <Checkbox
        checked={includeResolved}
        onCheckedChange={(on) => {
          setIncludeResolved(Boolean(on));
          setAt(0);
        }}
      />
      Include the {resolvedCount} already marked Fixed or Won't fix
    </label>
  );

  const issue = list[at];
  if (!issue) {
    const tally = (STATUSES as { key: string; label: string }[]).map((s) => `${list.filter((i) => statusOf(i.status).key === s.key).length} ${s.label.toLowerCase()}`).join(', ');
    return (
      <Layout
        state={`${list.length} checked`}
        onKeyDown={onKeyDown}
        body={
          <>
            <p className="text-sm">{list.length ? `${plural(list.length, 'comment', 'comments')} checked, ${tally}.` : "Every rechecked comment is already marked Fixed or Won't fix."}</p>
            {toggle}
            {changes.size ? (
              <div className="grid gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">Changed</h3>
                <ul className="grid divide-y rounded-lg border">
                  {[...changes].map(([id, { from, to }]) => {
                    const changed = checked.find((i) => i.id === id);
                    if (!changed) return null;
                    return (
                      <li key={id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground tabular-nums">{pad(numberOf(changed))}</span>
                        <span className="grid min-w-0">
                          <span className="truncate text-sm">{changed.title || 'Untitled comment'}</span>
                          <span className="text-sm font-medium text-muted-foreground">
                            {statusOf(from).label} to {statusOf(to).label}
                          </span>
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => setStatus(changed, from)}>
                          Undo
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="text-sm font-medium text-muted-foreground">No status changed.</p>
            )}
            {run.failed.length > 0 && <p className="text-sm font-medium text-muted-foreground">{run.failed.length} could not be captured. Try Recheck from the popup on those.</p>}
            {others(run.page)}
          </>
        }
        foot={
          <>
            <Button variant="ghost" disabled={!list.length} onClick={() => move(-1)}>
              Previous
            </Button>
            <Button autoFocus onClick={onDone}>
              Done
            </Button>
          </>
        }
      />
    );
  }

  const n = pad(numberOf(issue));
  return (
    <Layout
      state={`${at + 1} of ${list.length}`}
      onKeyDown={onKeyDown}
      body={
        <>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-xs font-medium text-muted-foreground tabular-nums">{n}</span>
              <span className="min-w-0 flex-1 text-base font-semibold">{issue.title || 'Untitled comment'}</span>
              <SeverityLabel severity={issue.severity} />
              <StatusLabel status={issue.status} />
            </div>
            {issue.note && <p className="text-sm font-medium whitespace-pre-wrap text-muted-foreground">{issue.note}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Figure src={issue.detail} alt={`Marked region before, comment ${n}`} caption="Before" />
              <Figure src={issue.after ?? undefined} alt={`Same region now, comment ${n}`} caption={recheckCaption(issue as { checkedAt?: string })} />
            </div>
            <p className="text-sm font-medium text-muted-foreground">{changeHint(issue)}</p>
          </div>
          {at === 0 && toggle}
          {others(run.page)}
        </>
      }
      foot={
        <>
          <span className="mr-auto hidden items-center gap-2 text-sm font-medium text-muted-foreground lg:flex">
            <Kbd>F</Kbd> fixed <Kbd>O</Kbd> still open <Kbd>W</Kbd> won't fix
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
          <Button autoFocus onClick={() => pick('fixed')}>
            Fixed
          </Button>
        </>
      }
    />
  );
}

function Figure({ src, alt, caption }: { src?: string; alt: string; caption: string }) {
  return (
    <figure className="grid gap-2">
      {src ? (
        <img src={src} alt={alt} className="w-full rounded-lg border" />
      ) : (
        <div className="grid aspect-video place-items-center rounded-lg border border-dashed text-sm font-medium text-muted-foreground">No image of the region</div>
      )}
      <figcaption className="text-xs font-medium text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
