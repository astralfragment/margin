import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, ClipboardCopy, MousePointerClick, PenTool, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { environmentText, hexColour, linkName, linksLabel, recheckCaption, routeOf, markList, widthCaption, widthShots } from './shared';
import { cn } from '@/lib/utils';
import type { Comment, CommentImages } from '@/lib/model';
import { useImages, useSettings, type ReportSettings } from './data';
import { MarkerNumber, SeverityBadge, StatusBadge } from './badges';
import { copyComment, namesOf } from './exports';
import { addMarker, areaFits, editNote, imageArea, removeMarker, useMarkerHover, type MarkableImage } from './quick-marks';
import { BulkBar, CommentEditor, setSelected, startEditing, useCommentEdit } from './edit-comments';
import { clearFilters, opened, useReportUi } from './ui-store';
import { useReportComments, useReviews } from './use-report';
import { pad, plural } from './format';
import { openEditor } from './editor/editor-store';
import { startTourOnce } from './tour';
import { LinkChips } from './link-chips';

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
    <dl className="mt-4 grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
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
 * A screenshot that takes numbered markers. Every marker shows as a number that opens its note, and a faint next
 * number follows the pointer to show where a click puts one. The next number and its hint only show once the pointer has moved
 * over the image, and hides again on scroll, so it never sits anywhere but under the pointer.
 * @param props.comment The comment it belongs to.
 * @param props.number Its number.
 * @param props.image Which image it is.
 * @param props.src The image.
 * @param props.alt Its description.
 */
function MarkableShot({ comment, number, image, src, alt }: { comment: Comment; number: number; image: MarkableImage; src: string; alt: string }) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [pending, setPending] = useState<{ left: number; top: number } | null>(null);
  const [tracking, setTracking] = useState(false);
  const ghost = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!tracking) return;
    const stop = () => setTracking(false);
    document.addEventListener('scroll', stop, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', stop, { capture: true });
  }, [tracking]);
  const note = useReportUi((state) => state.note);
  const hovered = useMarkerHover((state) => (state?.commentId === comment.id ? state.index : null));
  const area = imageArea(comment, image);
  const fits = natural !== null && areaFits(area, natural.width, natural.height);
  const marks = comment.marks ?? [];

  const place = async (event: React.MouseEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    const box = img.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    setPending({ left: fx * 100, top: fy * 100 });
    await addMarker(comment, image, {
      fx,
      fy,
      aspect: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0,
      x: event.clientX,
      y: event.clientY,
    });
    setPending(null);
  };

  return (
    <div
      className="group/shot relative w-fit max-w-full cursor-crosshair overflow-hidden rounded-xl border"
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        ghost.current?.style.setProperty('transform', `translate(${event.clientX - box.left}px, ${event.clientY - box.top}px)`);
        if (!tracking) setTracking(true);
      }}
      onPointerLeave={() => setTracking(false)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        data-tour="mark"
        className="block max-w-full"
        onLoad={(event) => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        onClick={place}
      />
      {fits &&
        marks.map((mark, index) => {
          const left = ((mark.x - area.x) / area.w) * 100;
          const top = ((mark.y - area.y) / area.h) * 100;
          if (left < 0 || left > 100 || top < 0 || top > 100) return null;
          const active = hovered === index || (note?.commentId === comment.id && note.index === index);
          return (
            <Tooltip key={index} disabled={note?.commentId === comment.id && note.index === index}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-pin
                    data-active={active || undefined}
                    aria-label={`Marker ${index + 1}${mark.note ? `: ${mark.note}` : ''}. Click to change or remove it.`}
                    className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-mark text-xs font-bold text-white shadow-[0_0_0_2px_#fff,0_2px_6px_rgb(0_0_0/0.35)] outline-none transition-transform duration-150 ease-out hover:scale-115 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-active:scale-125 motion-reduce:transition-none"
                    style={{ left: `${left}%`, top: `${top}%` }}
                    onPointerEnter={() => useMarkerHover.setState({ commentId: comment.id, index }, true)}
                    onPointerLeave={() => useMarkerHover.setState(null, true)}
                    onClick={(event) => editNote(comment.id, index, event.currentTarget)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      removeMarker(comment, index, number);
                    }}
                  />
                }
              >
                {index + 1}
              </TooltipTrigger>
              <TooltipContent>{mark.note || 'No note yet'}</TooltipContent>
            </Tooltip>
          );
        })}
      {pending && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-mark text-xs font-bold text-white shadow-[0_0_0_2px_#fff]"
          style={{ left: `${pending.left}%`, top: `${pending.top}%` }}
        >
          {marks.length + 1}
        </span>
      )}
      <span
        ref={ghost}
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-0 left-0 opacity-0 transition-opacity duration-150 group-has-[[data-pin]:hover]/shot:opacity-0 motion-reduce:transition-none',
          tracking && 'opacity-100',
        )}
      >
        <span className="flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed border-white bg-mark/60 text-xs font-bold text-white">
          {marks.length + 1}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-2 left-2 rounded-md bg-background/95 px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-sm transition-opacity duration-150 group-has-[[data-pin]:hover]/shot:opacity-0 motion-reduce:transition-none',
          tracking && 'opacity-100',
        )}
      >
        Click to add marker {marks.length + 1}
      </span>
    </div>
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
      {caption && <figcaption className="mt-2 text-xs font-semibold text-muted-foreground">{caption}</figcaption>}
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
  const before = <MarkableShot comment={comment} number={number} image="detail" src={detail} alt={`Marked region for comment ${number}`} />;
  if (!images.after) return <Figure className="mt-4">{before}</Figure>;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Figure caption="Before">{before}</Figure>
      <Figure caption={recheckCaption(comment)}>
        <img src={images.after} alt={`Same region after recheck for comment ${number}`} className="block max-w-full rounded-xl border" />
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
    <div className="mt-4 grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
      {shots.map((shot) => (
        <Figure key={shot.key} caption={widthCaption(shot)}>
          <img src={shot.src} alt={`${shot.label} width for comment ${number}`} className="block max-w-full rounded-xl border" />
        </Figure>
      ))}
    </div>
  );
}

/**
 * The numbered marker notes under a comment. Each wears its marker's number, lights the marker up while pointed at,
 * and has Change and Remove.
 * @param props.comment The comment.
 * @param props.number Its number.
 */
function MarkerNotes({ comment, number }: { comment: Comment; number: number }) {
  const hovered = useMarkerHover((state) => (state?.commentId === comment.id ? state.index : null));
  const items = markList(comment);
  if (!items.length) return null;
  return (
    <ol className="mt-3 flex max-w-[68ch] flex-col gap-1" aria-label="Marker notes">
      {items.map((item) => (
        <li
          key={item.n}
          data-active={hovered === item.n - 1 || undefined}
          className="group/note -mx-2 flex items-start gap-2 rounded-md px-2 py-1 data-active:bg-muted"
          onPointerEnter={() => useMarkerHover.setState({ commentId: comment.id, index: item.n - 1 }, true)}
          onPointerLeave={() => useMarkerHover.setState(null, true)}
        >
          <MarkerNumber number={item.n} className="mt-0.5" />
          <span className="min-w-0 flex-1 pt-px whitespace-pre-wrap">{item.note}</span>
          <span className="flex gap-1 opacity-0 transition-opacity duration-150 group-hover/note:opacity-100 focus-within:opacity-100 motion-reduce:transition-none">
            <Button size="icon-xs" variant="ghost" aria-label={`Change note ${item.n}`} onClick={(event) => editNote(comment.id, item.n - 1, event.currentTarget)}>
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
 * One comment: its heading, note, marker notes, screenshots and details, the way the exports lay it out, or its
 * editor in the same place while it is being edited.
 * @param props.comment The comment.
 * @param props.number Its number.
 * @param props.settings The report options.
 * @param props.first True for the first comment shown, which the tour points at.
 */
function CommentCard({ comment, number, settings, first }: { comment: Comment; number: number; settings: ReportSettings; first: boolean }) {
  const imagesQuery = useImages(comment.id);
  const images = imagesQuery.data ?? {};
  const imagesRead = !imagesQuery.isPending;
  useEffect(() => {
    if (first && imagesRead) startTourOnce();
  }, [first, imagesRead]);
  const editing = useCommentEdit((state) => state.editingId === comment.id);
  const selected = useCommentEdit((state) => state.selected.includes(comment.id));
  const { fields, shots, widths } = settings;
  const region = Boolean(images.detail) && shots !== 'viewport';
  const full = Boolean(images.shot) && shots !== 'detail';
  const label = pad(number);
  const jumpRef = (node: HTMLElement | null) => {
    if (!node || openedJumpDone || opened.comment !== comment.id) return;
    openedJumpDone = true;
    requestAnimationFrame(() => scrollToComment(comment.id, 'instant'));
  };
  const fullImage = images.shot && <MarkableShot comment={comment} number={number} image="shot" src={images.shot} alt={`Full viewport for comment ${number}`} />;
  return (
    <article
      ref={jumpRef}
      id={`c-${comment.id}`}
      data-comment-id={comment.id}
      className="grid scroll-mt-16 grid-cols-[3.5rem_minmax(0,1fr)] border-t py-6 first:border-t-0 first:pt-4"
    >
      <div className="flex h-7 items-center gap-2">
        <Checkbox checked={selected} onCheckedChange={(on) => setSelected(comment.id, on)} aria-label={`Select comment ${label}`} />
        <span className="text-xs font-extrabold text-muted-foreground tabular-nums">{label}</span>
      </div>
      <div className="min-w-0">
        {editing ? (
          <CommentEditor comment={comment} number={number} />
        ) : (
          <>
            <header className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="min-w-[12ch] flex-1 text-base font-extrabold tracking-tight">{comment.title || 'Untitled comment'}</h2>
              {fields.jira && comment.jira?.key && (
                <span className="flex items-center gap-2 text-xs whitespace-nowrap">
                  <a href={comment.jira.url} target="_blank" rel="noopener" className="font-semibold underline decoration-border underline-offset-3">
                    {comment.jira.key}
                  </a>
                  {comment.jira.status && <span className="text-muted-foreground">{comment.jira.status}</span>}
                </span>
              )}
              <StatusBadge status={comment.status} />
              <SeverityBadge severity={comment.severity} />
              <span className="flex items-center gap-1">
                <Button size="xs" variant="ghost" onClick={() => startEditing(comment.id)} aria-label={`Edit comment ${label}`} data-tour={first ? 'edit' : undefined}>
                  <Pencil />
                  Edit
                </Button>
                <Button size="xs" variant="ghost" onClick={() => copyComment(comment, settings)} title="Copy this comment for Slack, Jira, GitHub or a doc" aria-label={`Copy comment ${label}`}>
                  <ClipboardCopy />
                  Copy
                </Button>
              </span>
            </header>
            {fields.page && comment.page?.url && (
              <p className="mt-1 text-xs">
                <a href={comment.page.url} target="_blank" rel="noopener" className="text-muted-foreground underline decoration-border underline-offset-3 hover:text-foreground">
                  {routeOf(comment.page)}
                </a>
              </p>
            )}
            {comment.note && <p className="mt-3 max-w-[68ch] whitespace-pre-wrap">{comment.note}</p>}
            <MarkerNotes comment={comment} number={number} />
          </>
        )}
        {region && <RegionImages comment={comment} images={images} number={number} />}
        {images.shot && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MousePointerClick className="size-3.5" aria-hidden="true" />
              Click a screenshot to add a numbered note. Click a number to change or remove it.
            </span>
            <Button size="xs" variant="outline" onClick={() => openEditor(comment, number)}>
              <PenTool />
              Draw boxes and arrows
            </Button>
          </div>
        )}
        {widths && <WidthImages images={images} number={number} />}
        <Facts comment={comment} fields={fields} />
        {full &&
          (region ? (
            <Collapsible className="mt-4">
              <CollapsibleTrigger className="group/full inline-flex cursor-pointer items-center gap-1 rounded-md text-xs font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <ChevronRight className="size-3.5 transition-transform duration-150 group-data-panel-open/full:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                Full screenshot
              </CollapsibleTrigger>
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
    <div className="mx-auto max-w-[1040px] px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-[22px] font-extrabold tracking-tight">{namesOf({ review, comments: all }).title}</h1>
        <p className="text-xs text-muted-foreground">
          {OPENED_AT.toLocaleDateString()}, {plural(all.length, 'comment', 'comments')} on {plural(pages, 'page', 'pages')}
        </p>
      </header>
      <LinkChips className="mt-3" />
      {!all.length && (
        <p className="mt-6 rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          No comments yet. Open the page you want to review and press Alt+Shift+M to add a comment.
        </p>
      )}
      {all.length > 0 && !shown.length && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          <p>No comments match these filters</p>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear search and filters
          </Button>
        </div>
      )}
      <div className="mt-4">
        <BulkBar />
        {shown.map((comment, index) => (
          <CommentCard key={comment.id} comment={comment} number={numberOf(comment)} settings={settings} first={index === 0} />
        ))}
      </div>
    </div>
  );
}
