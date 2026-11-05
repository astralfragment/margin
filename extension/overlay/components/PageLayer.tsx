import { useQuery } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import type { Rect, Severity } from '@/lib/model';
import type { PageComment } from '@/lib/protocol';
import { severityOf } from '@/lib/severity.js';
import { statusOf } from '@/lib/status.js';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { inView, insetFromEdges, liveBox, mapBetween, rectBetween } from '../page/geometry';
import { pageCommentsQuery } from '../query';
import { useOverlay } from '../store';
import { MARKER_PIN, NumberFlag, flagOffset } from './NumberFlag';
import { useLayout } from './use-layout';

/** The solid dot for each severity, written out so Tailwind finds the classes. */
const SEVERITY_DOTS: Record<Severity, string> = {
  blocker: 'bg-blocker-solid',
  major: 'bg-major-solid',
  minor: 'bg-minor-solid',
  nit: 'bg-nit-solid',
};

/**
 * The red dashed edge of a region. A faint white glow follows each dash, so the edge reads on dark and red pages while
 * the gaps stay clear and the red stays the loudest part.
 */
const REGION_EDGE = 'rounded-sm border-2 border-dashed border-mark drop-shadow-[0_0_1px_rgb(255_255_255/0.9)]';

/**
 * The style that puts an overlay element over a region of the page.
 * @param box The region in page pixels.
 * @param toOverlay Converts page pixels to overlay pixels.
 */
const boxStyle = (box: Rect, toOverlay: (value: number) => number) => ({
  left: toOverlay(box.x),
  top: toOverlay(box.y),
  width: toOverlay(box.w),
  height: toOverlay(box.h),
});

/** The dashed regions and numbered flags of the comments saved on this page, which open the comment when clicked. */
export function SavedComments() {
  const { data } = useQuery(pageCommentsQuery);
  const [openId, pendingId] = useOverlay(useShallow((state) => [state.card?.id, state.pending?.old?.id]));
  const { scale, toOverlay } = useLayout();
  return (data?.comments ?? [])
    .filter((comment) => comment.id !== openId && comment.id !== pendingId)
    .map((comment) => {
      const box = liveBox(comment);
      if (!inView(box)) return null;
      return (
        <div key={comment.id} className="group/saved pointer-events-none fixed" style={boxStyle(box, toOverlay)}>
          <i
            className={cn(
              'absolute inset-0 group-has-[[data-popup-open]]/saved:border-solid',
              REGION_EDGE,
              comment.status === 'fixed' && 'border-fixed',
              comment.status === 'wontfix' && 'border-muted-foreground',
            )}
          />
          <SavedFlag comment={comment} top={toOverlay(flagOffset({ y: box.y, h: box.h }, scale))} />
        </div>
      );
    });
}

/**
 * A saved comment's flag, with its title, severity, status and Figma frame shown on hover or focus.
 * @param props The comment and where the flag sits against the region's top, in overlay pixels.
 */
function SavedFlag({ comment, top }: { comment: PageComment; top: number }) {
  const editSaved = useOverlay((state) => state.editSaved);
  const severity = severityOf(comment.severity);
  const status = statusOf(comment.status);
  const note = comment.note && comment.note !== comment.title ? comment.note : '';
  return (
    <Tooltip>
      <TooltipTrigger
        data-margin-float
        aria-label={`Edit comment ${comment.number}, ${comment.title || 'Untitled comment'}`}
        className="pointer-events-auto absolute left-0 cursor-pointer rounded-[4px_4px_4px_0] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        style={{ top }}
        onClick={() => void editSaved(comment)}
      >
        <NumberFlag number={comment.number} />
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="grid max-w-80 gap-1 bg-popover px-3 py-2 text-popover-foreground shadow-md ring-1 ring-foreground/10 [&>div]:hidden">
        <b className="line-clamp-2 text-sm font-semibold break-words">{comment.title || 'Untitled comment'}</b>
        {note && <span className="line-clamp-2 text-[13px] leading-[18px] break-words text-muted-foreground">{note}</span>}
        <span className="flex items-center gap-1.5 text-[13px] leading-[18px]">
          <i className={cn('size-2 rounded-full', SEVERITY_DOTS[comment.severity])} />
          {severity?.label}
          <span className={cn('ml-0.5 text-muted-foreground', comment.status === 'fixed' && 'text-fixed')}>{status?.label}</span>
        </span>
        {comment.frame && <span className="truncate text-[13px] leading-[18px] text-muted-foreground">{comment.frame}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The outline of the element under the pointer, saying so when it fills the view or is a frame Margin cannot look into. */
export function HoverOutline() {
  const hover = useOverlay((state) => state.hover);
  const { toOverlay } = useLayout();
  if (!hover) return null;
  const label = hover.full ? 'Fills the whole view' : hover.frame === true ? 'Frame, drag to mark inside it' : '';
  return (
    <div className={cn('pointer-events-none fixed', REGION_EDGE, 'border-solid')} style={boxStyle(hover.rect, toOverlay)}>
      {label && <span className="absolute top-2 left-2 rounded-sm bg-mark px-2 py-0.5 text-xs font-semibold text-mark-foreground">{label}</span>}
    </div>
  );
}

/** The band around the area being dragged, stored or commented on, with the open card's numbered flag and markers. */
export function AreaBand() {
  const { drag, card, saving, markers } = useOverlay(useShallow((state) => ({ drag: state.drag, card: state.card, saving: state.saving, markers: state.markers })));
  const { scale, toOverlay } = useLayout();
  const live = card ? liveBox(card) : null;
  const box = drag ? rectBetween(drag.from, drag.to) : live ? insetFromEdges(live, scale) : saving ? insetFromEdges(saving, scale) : null;
  if (!box) return null;
  return (
    <>
      <div className={cn('pointer-events-none fixed', REGION_EDGE)} style={boxStyle(box, toOverlay)} />
      {card && !drag && (
        <NumberFlag
          number={card.number}
          className="pointer-events-none fixed"
          style={{ left: toOverlay(Math.max(2 * scale, box.x)), top: toOverlay(box.y + flagOffset(box, scale, false)) }}
        />
      )}
      {saving && !card && !drag && (
        <span
          className="pointer-events-none fixed inline-flex h-5 items-center rounded-[4px_4px_4px_0] bg-mark px-1.5 text-xs font-extrabold text-mark-foreground shadow-[0_0_0_1px_white]"
          style={{ left: toOverlay(Math.max(2 * scale, box.x)), top: toOverlay(box.y + flagOffset(box, scale)) }}
        >
          Saving
        </span>
      )}
      {card && live && markers.map((marker, index) => <Pin key={index} index={index} at={mapBetween(marker, card.rect, live)} toOverlay={toOverlay} />)}
    </>
  );
}

/**
 * A numbered marker on the page. Right-click removes it.
 * @param props Its position in the list, where it sits in page pixels, and the pixel converter.
 */
function Pin({ index, at, toOverlay }: { index: number; at: { x: number; y: number }; toOverlay: (value: number) => number }) {
  const removeMarker = useOverlay((state) => state.removeMarker);
  return (
    <b
      data-margin-float
      title="Right-click to remove"
      className={cn(MARKER_PIN, 'fixed -translate-y-full cursor-context-menu')}
      style={{ left: toOverlay(at.x), top: toOverlay(at.y) }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        removeMarker(index);
      }}
    >
      {index + 1}
    </b>
  );
}
