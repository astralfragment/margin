import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Comment, FigmaFile, FigmaPost } from '@/lib/model';
import { cn } from '@/lib/utils';
import { ask, connectionQuery } from '../data';
import { closeDialog, useReportUi } from '../ui-store';
import { useReportComments, useReviews } from '../use-report';
import { pad } from '../format';
import { figmaMessage, figmaTargets, postComment, type FigmaTarget } from '../shared';
import { ConnectCard, connectionLine } from './connect-card';

/**
 * Send to Figma: posts each comment on the frame its Figma link points at, with its marker notes as a list. Comments
 * without a frame can pick one from the review's linked Figma file, for this send only.
 */

/**
 * Where one posted comment opens in Figma.
 * @param post The post.
 */
const postUrl = (post: FigmaPost) => `https://www.figma.com/design/${post.fileKey}?node-id=${String(post.nodeId).replace(':', '-')}#${post.commentId}`;

/**
 * The frames a comment posts to: its own Figma frame links, or the frame picked here from the linked file.
 * @param comment The comment.
 * @param picked The frame picked for it, if any.
 * @param file The review's linked Figma file.
 */
function targetsFor(comment: Comment, picked: string | undefined, file: FigmaFile | null): Pick<FigmaTarget, 'fileKey' | 'nodeId'>[] {
  const own = figmaTargets(comment).targets;
  if (own.length || !picked || !file) return own;
  return [{ fileKey: file.fileKey, nodeId: picked }];
}

/**
 * Posts each comment to each of its frames and records what was posted on the comment.
 * @param sends The comments with the frames each posts to.
 * @param label Names a comment in a failure.
 * @param onProgress Called with the count posted so far.
 */
async function postAll(
  sends: { comment: Comment; targets: Pick<FigmaTarget, 'fileKey' | 'nodeId'>[] }[],
  label: (comment: Comment) => string,
  onProgress: (posted: number) => void,
) {
  const now = new Set<string>();
  const failed: string[] = [];
  let posted = 0;
  for (const { comment, targets } of sends) {
    const message = figmaMessage(comment);
    const posts = [...(comment.figmaPosts ?? [])];
    for (const target of targets) {
      try {
        const id = await postComment(target, message);
        posts.push({ fileKey: target.fileKey, nodeId: target.nodeId, commentId: id, at: new Date().toISOString() });
        now.add(comment.id);
        posted += 1;
      } catch (error) {
        failed.push(`${label(comment)}. ${error instanceof Error ? error.message : String(error)}`);
      }
      onProgress(posted);
    }
    if (posts.length === (comment.figmaPosts ?? []).length) continue;
    try {
      await ask('update', { id: comment.id, patch: { figmaPosts: posts } });
    } catch (error) {
      failed.push(`${label(comment)} posted, but Margin could not record it. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { now, failed, posted };
}

/**
 * A frame picker over the linked file, grouped by page.
 * @param props.file The linked file.
 * @param props.value The frame picked.
 * @param props.label The comment it is for, for screen readers.
 * @param props.onChange Called with the frame picked.
 */
function FramePicker({ file, value, label, onChange }: { file: FigmaFile; value: string | undefined; label: string; onChange: (frame: string | undefined) => void }) {
  const frames = file.frames ?? [];
  const pages = [...new Set(frames.map((frame) => frame.page))];
  const items = [{ value: '', label: 'Pick a frame' }, ...frames.map((frame) => ({ value: frame.id, label: frame.name }))];
  return (
    <Select items={items} value={value ?? ''} onValueChange={(next) => onChange(next || undefined)}>
      <SelectTrigger size="sm" aria-label={`Pick a frame for comment ${label}`} className="max-w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">Pick a frame</SelectItem>
        {pages.map((page) => (
          <SelectGroup key={page}>
            <SelectLabel>{page}</SelectLabel>
            {frames
              .filter((frame) => frame.page === page)
              .map((frame) => (
                <SelectItem key={frame.id} value={frame.id}>
                  {frame.name}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Every comment with a Figma link, or every comment when the review links a file, ticked unless already posted. */
function FigmaSend() {
  const { review } = useReviews();
  const { ordered, numberOf } = useReportComments();
  const file = review?.figma?.fileKey ? review.figma : null;
  const picking = Boolean(file?.frames?.length);
  const [frames, setFrames] = useState<Map<string, string>>(new Map());
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [postedNow, setPostedNow] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<string[]>([]);
  const [state, setState] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = ordered.map((comment) => ({ comment, ...figmaTargets(comment) })).filter((row) => picking || row.targets.length || row.skipped.length);
  const without = ordered.length - rows.length;
  const label = (comment: Comment) => `${pad(numberOf(comment))} ${comment.title || 'Untitled comment'}`;
  const ready = (comment: Comment) => targetsFor(comment, frames.get(comment.id), file).length > 0;
  const isTicked = (comment: Comment) =>
    ready(comment) && !unticked.has(comment.id) && (ticked.has(comment.id) || !comment.figmaPosts?.length);
  const chosen = rows.filter((row) => isTicked(row.comment));

  const toggle = (comment: Comment, on: boolean) => {
    setUnticked((old) => {
      const next = new Set(old);
      if (on) next.delete(comment.id);
      else next.add(comment.id);
      return next;
    });
    setTicked((old) => {
      const next = new Set(old);
      if (on) next.add(comment.id);
      else next.delete(comment.id);
      return next;
    });
  };

  const run = async () => {
    setBusy(true);
    setFailures([]);
    const { now, failed, posted } = await postAll(
      chosen.map(({ comment }) => ({ comment, targets: targetsFor(comment, frames.get(comment.id), file) })),
      label,
      (count) => setState(`Posted ${count}`),
    );
    setPostedNow(now);
    setUnticked(new Set());
    setTicked(new Set());
    setFailures(failed);
    setState(`Posted ${posted} ${posted === 1 ? 'comment' : 'comments'} to Figma`);
    setBusy(false);
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-3 overflow-y-auto">
        {file && (
          <p className="text-sm text-muted-foreground">
            Posting to <b className="text-foreground">{file.name || 'the linked Figma file'}</b>
            {picking ? '. Comments without a frame can pick one here, for this send only.' : '.'}
          </p>
        )}
        {failures.length > 0 && (
          <div className="grid gap-1 rounded-lg border border-destructive/40 p-3 text-sm">
            <b>Some comments did not post</b>
            {failures.map((failure) => (
              <p key={failure} className="text-xs text-muted-foreground">
                {failure}
              </p>
            ))}
          </div>
        )}
        {!rows.length && <p className="text-sm text-muted-foreground">No comment in this review has a Figma link. Add one in Edit comments, then send again.</p>}
        {rows.map(({ comment, targets, skipped }) => {
          const last = comment.figmaPosts?.at(-1);
          return (
            <div key={comment.id} className={cn('grid gap-2 rounded-lg border p-3', !ready(comment) && 'opacity-80')}>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isTicked(comment)} disabled={!ready(comment)} onCheckedChange={(on) => toggle(comment, on === true)} />
                <b>{label(comment)}</b>
              </label>
              <div className="flex flex-wrap items-center gap-2 pl-6 text-xs">
                {targets.map((target) => (
                  <span key={target.url} className="rounded-full bg-muted px-2 py-0.5">
                    {file?.fileKey === target.fileKey ? (file.frames?.find((frame) => frame.id === target.nodeId)?.name ?? `Frame ${target.nodeId}`) : `Frame ${target.nodeId}`}
                  </span>
                ))}
                {!targets.length && picking && file && (
                  <FramePicker
                    file={file}
                    value={frames.get(comment.id)}
                    label={pad(numberOf(comment))}
                    onChange={(frame) => {
                      setFrames((old) => {
                        const next = new Map(old);
                        if (frame) next.set(comment.id, frame);
                        else next.delete(comment.id);
                        return next;
                      });
                      toggle(comment, Boolean(frame));
                    }}
                  />
                )}
                {postedNow.has(comment.id) && last ? (
                  <>
                    <span className="rounded-full bg-success-tint px-2 py-0.5 text-success">Posted just now</span>
                    <a href={postUrl(last)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline underline-offset-3">
                      <ExternalLink className="size-3" />
                      Open in Figma
                    </a>
                  </>
                ) : (
                  comment.figmaPosts?.length ? <span className="rounded-full bg-muted px-2 py-0.5">Posted before</span> : null
                )}
              </div>
              {skipped.map((skip) => (
                <p key={skip.url} className="pl-6 text-xs text-muted-foreground">
                  Skipped {skip.url}.{' '}
                  {skip.reason === 'no-node' ? 'This link has no frame in it. In Figma, right-click the frame and choose Copy link to selection.' : 'This is not a Figma file link.'}
                </p>
              ))}
            </div>
          );
        })}
        {without > 0 && rows.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {without} {without === 1 ? 'comment has' : 'comments have'} no Figma link and {without === 1 ? 'is' : 'are'} left out.
          </p>
        )}
      </div>
      <DialogFooter className="items-center">
        <span className="mr-auto text-sm text-muted-foreground" role="status">
          {state}
        </span>
        <Button variant="outline" disabled={busy} onClick={closeDialog}>
          Close
        </Button>
        <Button disabled={busy || !chosen.length} onClick={run}>
          {chosen.length ? `Post ${chosen.length} ${chosen.length === 1 ? 'comment' : 'comments'}` : 'Post comments'}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Send to Figma, or the offer to connect it. */
export default function FigmaDialog() {
  const open = useReportUi((state) => state.dialog === 'figma');
  const current = useQuery(connectionQuery('figma'));
  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Send to Figma</DialogTitle>
          <DialogDescription>{connectionLine(current.data, 'your Figma account')}</DialogDescription>
        </DialogHeader>
        {current.data ? (
          <FigmaSend />
        ) : (
          !current.isPending && (
            <>
              <ConnectCard provider="figma" body="Margin posts each comment on the frame its Figma link points at, with the numbered marker notes as a list. It takes one sign-in." />
              <DialogFooter>
                <Button variant="outline" onClick={closeDialog}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
