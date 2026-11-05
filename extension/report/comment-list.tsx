import type { ReactNode } from 'react';
import { ClipboardCopy, PenTool, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { environmentText, hexColour, linkName, linksLabel, recheckCaption, routeOf, markList, widthCaption, widthShots } from './shared';
import { cn } from '@/lib/utils';
import type { Comment, CommentImages } from '@/lib/model';
import { useImages, useSettings, type ReportSettings } from './data';
import { SeverityBadge, StatusBadge } from './badges';
import { copyComment, namesOf } from './exports';
import { quickMark, removeMarker } from './quick-marks';
import { clearFilters, opened, useReportUi } from './ui-store';
import { useReportComments, useReviews } from './use-report';
import { pad, plural } from './format';
import { openEditor } from './editor/editor-store';
import { startTourOnce } from './tour';

/** When the report opened, which its heading shows like the exports show when they were made. */
const OPENED_AT = new Date();
let spyHeldUntil = 0;
let openedJumpDone = false;

/**
 * Scrolls the report to a comment and highlights its row.
 * @param id The comment id.
 * @param behavior Smooth for a click, instant on load.
 */
export function scrollToComment(id: string, behavior: ScrollBehavior = 'smooth') {
  spyHeldUntil = Date.now() + 1200;
  useReportUi.setState({ currentId: id });
  document.getElementById(`c-${id}`)?.scrollIntoView({ behavior, block: 'start' });
}

/**
 * Follows the report's scroll in the sidebar, so the highlighted row is the comment at the top.
 * @param event The scroll of the report.
 */
export function followScroll(event: React.UIEvent<HTMLElement>) {
  if (Date.now() < spyHeldUntil) return;
  const top = event.currentTarget.getBoundingClientRect().top;
  const cards = event.currentTarget.querySelectorAll<HTMLElement>('[data-comment-id]');
  const first = [...cards].find((card) => card.getBoundingClientRect().bottom > top + 72);
  const id = first?.dataset.commentId ?? null;
  if (id && id !== useReportUi.getState().currentId) useReportUi.setState({ currentId: id });
}

/**
 * The detail rows under a comment, the same rows the exports show.
 * @param props.comment The comment.
 * @param props.fields Which rows to show.
 */
function Facts({ comment, fields }: { comment: Comment; fields: ReportSettings['fields'] }) {
  const el = comment.element;
  const rows: [string, ReactNode][] = [];
  const links = comment.links ?? [];
  if (fields.figma && links.length) {
    rows.push([
      linksLabel(links),
      links.map((url, index) => (
        <span key={url}>
          {index > 0 && ', '}
          <a href={url} target="_blank" rel="noopener" className="underline decoration-border underline-offset-3 hover:decoration-current">
            {linkName(url, index, comment)}
          </a>
        </span>
      )),
    ]);
  }
  if (fields.selector && el?.selector) rows.push(['Selector', <code key="selector" className="font-mono text-[11.5px]">{el.selector}</code>]);
  if (fields.element && el) rows.push(['Element', <code key="element" className="font-mono text-[11.5px]">{`${el.tag}${el.classes ? `.${el.classes.split(' ').join('.')}` : ''}`}</code>]);
  if (fields.text && el?.text) rows.push(['Text', el.text]);
  if (fields.styles && el?.styles) rows.push(['Styles', <span key="styles" className="font-mono text-[11.5px]">{`${el.styles.font}, ${hexColour(el.styles.color)}`}</span>]);
  if (fields.position) {
    const { rect, viewport } = comment;
    rows.push(['Position', <span key="position" className="font-mono text-[11.5px]">{`${rect.w} x ${rect.h} at ${rect.x}, ${rect.y} in ${viewport.width} x ${viewport.height} at ${viewport.dpr}x`}</span>]);
  }
  if (fields.captured) rows.push(['Captured', new Date(comment.createdAt).toLocaleString()]);
  if (fields.browser && comment.env) rows.push(['Browser', environmentText(comment)]);
  if (!rows.length) return null;
  return (
    <dl className="mt-3 grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-semibold text-muted-foreground">{term}</dt>
          <dd className="m-0 [overflow-wrap:anywhere]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A screenshot that takes quick markers: a click adds one, a right-click removes the nearest.
 * @param props.comment The comment it belongs to.
 * @param props.number Its number.
 * @param props.image Which image it is.
 * @param props.src The image.
 * @param props.alt Its description.
 */
function MarkableImage({ comment, number, image, src, alt }: { comment: Comment; number: number; image: 'detail' | 'shot'; src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      title="Click to add a numbered marker. Right-click a marker to remove it."
      className="block max-w-full cursor-crosshair rounded-lg border hover:outline-2 hover:outline-offset-2 hover:outline-marker"
      onClick={(event) => quickMark(comment, number, image, event, 'add')}
      onContextMenu={(event) => {
        event.preventDefault();
        quickMark(comment, number, image, event, 'remove');
      }}
    />
  );
}

/**
 * A figure with a caption under the image.
 * @param props.children The image.
 * @param props.caption The caption.
 */
function Figure({ children, caption, className }: { children: ReactNode; caption?: string; className?: string }) {
  return (
    <figure className={cn('m-0 w-fit max-w-full', className)}>
      {children}
      {caption && <figcaption className="mt-1 text-xs font-semibold text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

/**
 * The marked region, or the region before and after a recheck side by side.
 * @param props.comment The comment.
 * @param props.images Its images.
 * @param props.number Its number.
 */
function RegionImages({ comment, images, number }: { comment: Comment; images: CommentImages; number: number }) {
  const detail = images.detail!;
  const before = <MarkableImage comment={comment} number={number} image="detail" src={detail} alt={`Marked region for comment ${number}`} />;
  if (!images.after) return <Figure className="mt-4">{before}</Figure>;
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Figure caption="Before">{before}</Figure>
      <Figure caption={recheckCaption(comment)}>
        <img src={images.after} alt={`Same region after recheck for comment ${number}`} className="block max-w-full rounded-lg border" />
      </Figure>
    </div>
  );
}

/**
 * The region at mobile, tablet and desktop widths in one row.
 * @param props.images The comment's images.
 * @param props.number Its number.
 */
function WidthImages({ images, number }: { images: CommentImages; number: number }) {
  const shots = widthShots(images);
  if (!shots.length) return null;
  return (
    <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-3">
      {shots.map((shot) => (
        <Figure key={shot.key} caption={widthCaption(shot)}>
          <img src={shot.src} alt={`${shot.label} width for comment ${number}`} className="block max-w-full rounded-lg border" />
        </Figure>
      ))}
    </div>
  );
}

/**
 * The numbered marker notes under a comment, each with Edit and Remove.
 * @param props.comment The comment.
 * @param props.number Its number.
 */
function MarkerNotes({ comment, number }: { comment: Comment; number: number }) {
  const items = markList(comment);
  if (!items.length) return null;
  return (
    <ol className="mt-2 max-w-[68ch] list-decimal pl-6 marker:font-extrabold marker:text-marker">
      {items.map((item) => (
        <li key={item.n} value={item.n} className="group/note pl-1 whitespace-pre-wrap">
          {item.note}
          <span className="ml-2 inline-flex gap-1 align-middle opacity-0 transition-opacity group-hover/note:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Edit note ${item.n}`}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                useReportUi.setState({ note: { commentId: comment.id, index: item.n - 1, fresh: false, x: box.left, y: box.bottom } });
              }}
            >
              <Pencil />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove marker ${item.n}`} onClick={() => removeMarker(comment, item.n - 1, number)}>
              <X />
            </Button>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One comment: its heading, note, marker notes, screenshots and details, the way the exports lay it out.
 * @param props.comment The comment.
 * @param props.number Its number.
 * @param props.settings The report options.
 */
function CommentCard({ comment, number, settings }: { comment: Comment; number: number; settings: ReportSettings }) {
  const images = useImages(comment.id).data ?? {};
  const { fields, shots, widths } = settings;
  const region = Boolean(images.detail) && shots !== 'viewport';
  const full = Boolean(images.shot) && shots !== 'detail';
  const jumpRef = (node: HTMLElement | null) => {
    if (!node || openedJumpDone || opened.comment !== comment.id) return;
    openedJumpDone = true;
    requestAnimationFrame(() => scrollToComment(comment.id, 'instant'));
  };
  const fullImage = images.shot && <MarkableImage comment={comment} number={number} image="shot" src={images.shot} alt={`Full viewport for comment ${number}`} />;
  return (
    <article ref={jumpRef} id={`c-${comment.id}`} data-comment-id={comment.id} className="scroll-mt-4 border-t py-6 first:border-t-0 first:pt-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-6 text-xs font-extrabold text-muted-foreground tabular-nums">{pad(number)}</span>
        <h2 className="min-w-[12ch] flex-1 text-base font-extrabold tracking-tight">{comment.title || 'Untitled comment'}</h2>
        {fields.jira && comment.jira?.key && (
          <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            <a href={comment.jira.url} target="_blank" rel="noopener" className="font-semibold underline decoration-border underline-offset-3">
              {comment.jira.key}
            </a>
            {comment.jira.status && <span className="text-muted-foreground">{comment.jira.status}</span>}
          </span>
        )}
        <StatusBadge status={comment.status} />
        <SeverityBadge severity={comment.severity} />
        <Button size="xs" variant="ghost" onClick={() => copyComment(comment, settings)} title="Copy this comment for Slack, Jira, GitHub or a doc" aria-label={`Copy comment ${pad(number)}`}>
          <ClipboardCopy />
          Copy
        </Button>
      </header>
      <div className="sm:ml-9">
        {fields.page && comment.page?.url && (
          <p className="mt-0.5 text-xs">
            <a href={comment.page.url} target="_blank" rel="noopener" className="text-muted-foreground underline decoration-border underline-offset-3 hover:text-foreground">
              {routeOf(comment.page)}
            </a>
          </p>
        )}
        {comment.note && <p className="mt-2 max-w-[68ch] whitespace-pre-wrap">{comment.note}</p>}
        <MarkerNotes comment={comment} number={number} />
        {region && <RegionImages comment={comment} images={images} number={number} />}
        {images.shot && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Click a screenshot to add a numbered marker. Right-click a marker to remove it.</span>
            <Button size="xs" variant="outline" onClick={() => openEditor(comment, number)}>
              <PenTool />
              Open editor for boxes and arrows
            </Button>
          </div>
        )}
        {widths && <WidthImages images={images} number={number} />}
        <Facts comment={comment} fields={fields} />
        {full &&
          (region ? (
            <Collapsible className="mt-3">
              <CollapsibleTrigger className="w-fit cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">Show full screenshot</CollapsibleTrigger>
              <CollapsibleContent keepMounted className="mt-2 data-closed:hidden">
                <Figure caption="Full viewport">{fullImage}</Figure>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <Figure caption="Full viewport" className="mt-4">
              {fullImage}
            </Figure>
          ))}
      </div>
    </article>
  );
}

/** The report itself: the heading, then every comment the filters leave, or the empty and no match messages. */
export function CommentList() {
  const { review } = useReviews();
  const { all, shown, numberOf, isPending, error } = useReportComments();
  const settings = useSettings().data;
  if (error) return <p className="p-6 text-sm text-destructive">The comments could not be read. {error.message}</p>;
  if (isPending || !settings) return <p className="p-6 text-sm text-muted-foreground">Loading comments</p>;
  const pages = new Set(all.map((comment) => comment.page?.url).filter(Boolean)).size;
  return (
    <div className="mx-auto max-w-[1040px] px-4 py-6 md:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-[22px] font-extrabold tracking-tight">{namesOf({ review, comments: all }).title}</h1>
        <p className="text-xs text-muted-foreground">
          {OPENED_AT.toLocaleDateString()}, {plural(all.length, 'comment', 'comments')} on {plural(pages, 'page', 'pages')}
        </p>
      </header>
      {!all.length && (
        <p className="mt-6 rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          No comments yet. Open the page you want to review and press Alt+Shift+M to add a comment.
        </p>
      )}
      {all.length > 0 && !shown.length && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          <p>No comments match these filters</p>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear search and filters
          </Button>
        </div>
      )}
      <div className="mt-2" ref={(node) => void (node && shown.length && startTourOnce())}>
        {shown.map((comment) => (
          <CommentCard key={comment.id} comment={comment} number={numberOf(comment)} settings={settings} />
        ))}
      </div>
    </div>
  );
}
