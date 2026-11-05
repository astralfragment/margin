import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, ExternalLink, Frame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Comment, FigmaFile, FigmaPost } from '@/lib/model';
import { cn } from '@/lib/utils';
import { ask, connectionQuery } from '../data';
import { closeDialog, useReportUi } from '../ui-store';
import { useReportComments, useReviews } from '../use-report';
import { pad } from '../format';
import { figmaMessage, figmaTargets, postComment, type FigmaTarget } from '../shared';
import { ConnectButton, ConnectIntro, connectionLine, useConnect } from './connect-card';

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

/**
 * The name of the Figma file a link points at, read from the words after the file key, such as Shop in
 * figma.com/design/AbC123/Shop. Empty when the link has none.
 * @param url The Figma link.
 */
function fileNameOf(url: string) {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
    const words = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
    return /^[A-Za-z0-9]{15,}$/.test(words) ? '' : words;
  } catch {
    return '';
  }
}

/**
 * What a frame a comment posts to is called: its name in the linked file, or the file it is in. Never Figma's node id,
 * which nobody recognises.
 * @param target The frame.
 * @param file The review's linked Figma file.
 */
function frameLabel(target: FigmaTarget, file: FigmaFile | null) {
  const named = file?.fileKey === target.fileKey ? file.frames?.find((frame) => frame.id === target.nodeId)?.name : undefined;
  if (named) return named;
  const fileName = file?.fileKey === target.fileKey && file.name ? file.name : fileNameOf(target.url);
  return fileName ? `A frame in ${fileName}` : 'A linked frame';
}

/**
 * Whether a comment was posted in this send or an earlier one.
 * @param props.now True when this send posted it.
 * @param props.before True when it has been posted at any time.
 */
function PostedBadge({ now, before }: { now: boolean; before: boolean }) {
  if (now) return <Badge className="bg-success-tint text-success">Posted just now</Badge>;
  if (before) return <Badge variant="ghost" className="bg-muted text-muted-foreground">Posted before</Badge>;
  return null;
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

  const postLabel = () => {
    if (busy) return 'Posting';
    if (!chosen.length) return 'Post comments';
    return `Post ${chosen.length} ${chosen.length === 1 ? 'comment' : 'comments'}`;
  };

  const run = async () => {
    setBusy(true);
    setFailures([]);
    const sends = chosen.map(({ comment }) => ({ comment, targets: targetsFor(comment, frames.get(comment.id), file) }));
    const total = sends.reduce((sum, entry) => sum + entry.targets.length, 0);
    setState(`Posted 0 of ${total}`);
    const { now, failed, posted } = await postAll(sends, label, (count) => setState(`Posted ${count} of ${total}`));
    setPostedNow(now);
    setUnticked(new Set());
    setTicked(new Set());
    setFailures(failed);
    setState(failed.length ? `Posted ${posted} of ${total}` : `Posted ${posted} ${posted === 1 ? 'comment' : 'comments'} to Figma`);
    setBusy(false);
  };

  return (
    <>
      <div className="-mx-6 grid min-h-0 gap-6 overflow-y-auto px-6">
        <p className="text-sm text-muted-foreground">
          {file ? (
            <>
              Posting to <b className="font-medium text-foreground">{file.name || 'the linked Figma file'}</b>.{' '}
              {picking ? 'A comment without a frame link can pick a frame here, for this send only.' : ''}
            </>
          ) : (
            'Each ticked comment is posted on the Figma frame its link points at, with its marker notes as a numbered list.'
          )}
        </p>
        {failures.length > 0 && (
          <div role="alert" className="grid gap-1 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              Some comments did not post
            </p>
            {failures.map((failure) => (
              <p key={failure} className="pl-6 text-xs text-muted-foreground">
                {failure}
              </p>
            ))}
          </div>
        )}
        {!rows.length && <p className="text-sm">No comment in this review has a Figma link. Add a link to a Figma frame to a comment, then send again.</p>}
        {rows.length > 0 && (
          <section className="grid gap-2">
            <h3 className="text-sm font-medium">Comments to post</h3>
            <ul className="grid divide-y">
              {rows.map(({ comment, targets, skipped }) => {
                const last = comment.figmaPosts?.at(-1);
                return (
                  <li key={comment.id} className="grid gap-2 py-3">
                    <label className={cn('flex items-center gap-3 text-sm', ready(comment) ? 'cursor-pointer' : 'text-muted-foreground')}>
                      <Checkbox checked={isTicked(comment)} disabled={!ready(comment)} onCheckedChange={(on) => toggle(comment, on === true)} />
                      <span className="text-xs font-extrabold text-muted-foreground tabular-nums">{pad(numberOf(comment))}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{comment.title || 'Untitled comment'}</span>
                      <PostedBadge now={postedNow.has(comment.id)} before={Boolean(comment.figmaPosts?.length)} />
                    </label>
                    {(targets.length > 0 || (picking && file) || (postedNow.has(comment.id) && last)) && (
                      <div className="flex flex-wrap items-center gap-2 pl-7 text-xs">
                        {targets.map((target) => (
                          <Badge key={target.url} variant="outline">
                            <Frame />
                            {frameLabel(target, file)}
                          </Badge>
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
                        {postedNow.has(comment.id) && last && (
                          <Button size="xs" variant="ghost" render={<a href={postUrl(last)} target="_blank" rel="noopener" />} nativeButton={false}>
                            Open in Figma
                            <ExternalLink />
                          </Button>
                        )}
                      </div>
                    )}
                    {skipped.map((skip) => (
                      <p key={skip.url} className="pl-7 text-xs text-muted-foreground">
                        {skip.reason === 'no-node'
                          ? 'Its Figma link points at a whole file, not a frame. In Figma, right-click the frame, choose Copy link to selection, and add that link to the comment.'
                          : `${skip.url} is not a Figma file link.`}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {without > 0 && rows.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {without} {without === 1 ? 'comment has' : 'comments have'} no Figma link and {without === 1 ? 'is' : 'are'} left out.
          </p>
        )}
      </div>
      <DialogFooter className="items-center">
        <span className="text-sm text-muted-foreground sm:mr-auto" role="status">
          {state}
        </span>
        <Button variant="outline" disabled={busy} onClick={closeDialog}>
          Close
        </Button>
        <Button disabled={busy || !chosen.length} onClick={run}>
          {busy && <Spinner />}
          {postLabel()}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Not connected: what connecting gives, and the sign-in. */
function ConnectFigma() {
  const connection = useConnect('figma');
  return (
    <>
      <ConnectIntro
        body="Connect Figma and Margin posts each comment on the Figma frame its link points at, with the numbered marker notes as a list. It takes one sign-in."
        state={connection.state}
      />
      <DialogFooter>
        <Button variant="outline" onClick={closeDialog}>
          Close
        </Button>
        <ConnectButton connection={connection} />
      </DialogFooter>
    </>
  );
}

/** Send to Figma, or the offer to connect it. */
export default function FigmaDialog() {
  const open = useReportUi((state) => state.dialog === 'figma');
  const current = useQuery(connectionQuery('figma'));
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent ref={popup} initialFocus={popup} className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader className="gap-1 pr-8">
          <DialogTitle>Send to Figma</DialogTitle>
          <DialogDescription>{connectionLine(current.data, 'your Figma account')}</DialogDescription>
        </DialogHeader>
        {current.data ? <FigmaSend /> : !current.isPending && <ConnectFigma />}
      </DialogContent>
    </Dialog>
  );
}
