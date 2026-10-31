import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { figmaMessage, figmaTargets, postComment } from '@/lib/figma.js';
import { cn } from '@/lib/utils';
import { useConnection } from '../queries';
import { Checkbox } from '../ui/checkbox';
import type { Group, Issue } from '../types';
import { pad, plural, send } from '../util';
import { ConnectCard } from './connect-card';

type Target = { fileKey: string; nodeId: string; url?: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ordered: Issue[];
  numberOf: (issue: Issue) => number;
  group: Group | null;
};

type Account = { account?: { name?: string; email?: string } };

/** Posts each comment on the Figma frame its link points at, or on a frame picked from the review's linked file. */
export function FigmaDialog({ open, onOpenChange, ...rest }: Props) {
  const connection = useConnection<Account>('figma', open);
  const [running, setRunning] = useState(false);
  const current = connection.isPending ? undefined : connection.data;
  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent showCloseButton={!running} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b p-5 pr-12">
          <DialogTitle>Send to Figma</DialogTitle>
          <DialogDescription>
            {current === undefined ? 'Checking your Figma connection' : current ? `Connected as ${current.account?.name || current.account?.email || 'your Figma account'}` : 'Not connected'}
          </DialogDescription>
        </DialogHeader>
        <Body {...rest} current={current} running={running} onRunning={setRunning} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

type BodyProps = Omit<Props, 'open' | 'onOpenChange'> & { current: Account | null | undefined; running: boolean; onRunning: (running: boolean) => void; onClose: () => void };

/** The list and the Post button, mounted each time the dialog opens, so the ticks start from the comments as they are. */
function Body({ ordered, numberOf, group, current, running, onRunning, onClose }: BodyProps) {
  const [picks, setPicks] = useState<Map<string, string>>(new Map());
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(ordered.filter((issue) => figmaTargets(issue).targets.length && !issue.figmaPosts?.length).map((issue) => issue.id)));
  const [postedNow, setPostedNow] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<string[]>([]);
  const [state, setState] = useState('');
  const linkedFile = group?.figma?.fileKey ? group.figma : null;
  const picking = Boolean(linkedFile?.frames?.length);

  const targetsFor = (issue: Issue): Target[] => {
    const own = figmaTargets(issue).targets as Target[];
    if (own.length || !picks.has(issue.id) || !linkedFile) return own;
    return [{ fileKey: linkedFile.fileKey, nodeId: picks.get(issue.id)!, url: linkedFile.url }];
  };

  const frameName = (t: Target) => linkedFile?.fileKey === t.fileKey ? linkedFile.frames?.find((f) => f.id === t.nodeId)?.name ?? `Frame ${t.nodeId}` : `Frame ${t.nodeId}`;
  const rows = ordered.map((issue) => ({ issue, ...(figmaTargets(issue) as { targets: Target[]; skipped: { url: string; reason: string }[] }) })).filter((row) => picking || row.targets.length || row.skipped.length);
  const without = ordered.length - rows.length;
  const ready = rows.filter((row) => ticked.has(row.issue.id) && targetsFor(row.issue).length).length;
  const pages = [...new Set((linkedFile?.frames ?? []).map((f) => f.page))];

  /** Posts every ticked comment to each frame it links to and records what was posted. */
  const run = async () => {
    onRunning(true);
    const now = new Set<string>();
    const failed: string[] = [];
    let posted = 0;
    for (const { issue } of rows) {
      if (!ticked.has(issue.id)) continue;
      const posts = [...(issue.figmaPosts ?? [])];
      for (const target of targetsFor(issue)) {
        try {
          const id = await postComment(target, figmaMessage(issue));
          posts.push({ fileKey: target.fileKey, nodeId: target.nodeId, commentId: id, at: new Date().toISOString() });
          now.add(issue.id);
          posted += 1;
        } catch (err) {
          failed.push(`${pad(numberOf(issue))} ${issue.title || 'Untitled comment'}. ${(err as Error).message}`);
        }
        setState(`Posted ${posted}`);
      }
      if (posts.length !== (issue.figmaPosts ?? []).length) {
        await send('update', { id: issue.id, patch: { figmaPosts: posts } });
      }
    }
    setPostedNow(now);
    setFailures(failed);
    setTicked(new Set());
    setState(`Posted ${plural(posted, 'comment', 'comments')} to Figma`);
    onRunning(false);
  };

  const toggle = (id: string, on: boolean) =>
    setTicked((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto p-5">
        {current === null && (
          <ConnectCard
            provider="figma"
            name="Figma"
            body="Margin posts each comment on the frame its Figma link points at, with the numbered marker notes as a list. It takes one sign-in."
          />
        )}
        {current && (
          <>
            {failures.length > 0 && (
              <div className="grid gap-1 rounded-lg border border-destructive/50 p-3">
                <p className="text-sm font-semibold">Some comments did not post</p>
                {failures.map((f) => (
                  <p key={f} className="text-sm font-medium text-muted-foreground">
                    {f}
                  </p>
                ))}
              </div>
            )}
            {linkedFile && (
              <p className="text-sm">
                Posting to <b className="font-semibold">{linkedFile.name || 'the linked Figma file'}</b>
                {picking ? '. Comments without a frame can pick one here, for this send only.' : '.'}
              </p>
            )}
            {rows.length ? (
              <ul className="grid divide-y rounded-lg border">
                {rows.map(({ issue, targets, skipped }) => {
                  const canPost = targetsFor(issue).length > 0;
                  const last = (issue.figmaPosts ?? []).at(-1);
                  return (
                    <li key={issue.id} className={cn('grid gap-2 px-3 py-3', !canPost && 'text-muted-foreground')}>
                      <label className={cn('flex items-center gap-3 text-sm font-medium', canPost ? 'cursor-pointer' : 'cursor-not-allowed')}>
                        <Checkbox checked={ticked.has(issue.id) && canPost} disabled={!canPost || running} onCheckedChange={(on) => toggle(issue.id, Boolean(on))} />
                        <span className="text-xs font-medium text-muted-foreground tabular-nums">{pad(numberOf(issue))}</span>
                        <span className="min-w-0 truncate">{issue.title || 'Untitled comment'}</span>
                      </label>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-sm font-medium text-muted-foreground">
                        {targets.map((t) => (
                          <span key={t.nodeId}>{frameName(t)}</span>
                        ))}
                        {!targets.length && picking && linkedFile?.frames && (
                          <Select
                            value={picks.get(issue.id) ?? null}
                            onValueChange={(v) => {
                              setPicks((m) => new Map(m).set(issue.id, v as string));
                              toggle(issue.id, true);
                            }}
                          >
                            <SelectTrigger size="sm" aria-label={`Pick a frame for comment ${pad(numberOf(issue))}`} className="min-w-44">
                              <SelectValue placeholder="Pick a frame">{(v: string) => linkedFile.frames!.find((f) => f.id === v)?.name ?? 'Pick a frame'}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {pages.map((page) => (
                                <SelectGroup key={page}>
                                  <SelectLabel>{page}</SelectLabel>
                                  {linkedFile.frames!
                                    .filter((f) => f.page === page)
                                    .map((f) => (
                                      <SelectItem key={f.id} value={f.id}>
                                        {f.name}
                                      </SelectItem>
                                    ))}
                                </SelectGroup>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        {postedNow.has(issue.id) && last ? (
                          <a
                            className="inline-flex items-center gap-1 text-success underline underline-offset-3"
                            href={`https://www.figma.com/design/${last.fileKey}?node-id=${String(last.nodeId).replace(':', '-')}#${last.commentId}`}
                            target="_blank"
                            rel="noopener"
                          >
                            Posted just now, open in Figma
                            <ExternalLink className="size-4" />
                          </a>
                        ) : (
                          issue.figmaPosts?.length ? <span>Posted before</span> : null
                        )}
                      </div>
                      {skipped.map((s) => (
                        <p key={s.url} className="pl-7 text-sm font-medium text-muted-foreground">
                          Skipped {s.url}. {s.reason === 'no-node' ? 'This link has no frame in it. In Figma, right-click the frame and choose Copy link to selection.' : 'This is not a Figma file link.'}
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm font-medium text-muted-foreground">No comment in this review has a Figma link. Add one in Edit comments, then send again.</p>
            )}
            {rows.length > 0 && without > 0 && (
              <p className="text-sm font-medium text-muted-foreground">
                {plural(without, 'comment has', 'comments have')} no Figma link and {without === 1 ? 'is' : 'are'} left out.
              </p>
            )}
          </>
        )}
      </div>
      <DialogFooter className="m-0 items-center rounded-b-xl">
        <p className="mr-auto text-sm font-medium text-muted-foreground" role="status">
          {state}
        </p>
        <Button variant="outline" onClick={onClose} disabled={running}>
          Close
        </Button>
        {current && (
          <Button onClick={run} disabled={!ready || running}>
            {ready ? `Post ${plural(ready, 'comment', 'comments')}` : 'Post comments'}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
