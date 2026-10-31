import { SeverityLabel } from '@/components/margin/severity';
import { StatusLabel } from '@/components/margin/status';
import { cn } from '@/lib/utils';
import { editSaved, pad } from './controller';
import { EDGE, boxStyle, flagOffset, regionOf } from './geometry';
import { RegionNumber } from './marks';
import { usePage } from './queries';
import { getState, setState, useOverlay, type PageComment, type Rect } from './store';

const OUTLINE: Record<string, string> = {
  open: 'border-destructive',
  fixed: 'border-success',
  wontfix: 'border-muted-foreground',
};

/**
 * The outline and number of a saved comment on the page.
 * @param props The comment, its box and whether it is highlighted.
 */
function SavedRegion({ comment, box, hot }: { comment: PageComment; box: Rect; hot: boolean }) {
  const scale = useOverlay((s) => s.scale);
  const show = () => setState({ tip: comment.id });
  const hide = () => getState().tip === comment.id && setState({ tip: null });
  return (
    <div className="pointer-events-none fixed" style={boxStyle(box, scale)}>
      <span aria-hidden className="absolute inset-0 rounded-md border-4 border-background/80" />
      <span aria-hidden className={cn('absolute inset-0 rounded-md border-2', hot ? 'border-solid' : 'border-dashed', OUTLINE[comment.status ?? 'open'] ?? OUTLINE.open)} />
      <button
        type="button"
        aria-label={`Edit comment ${pad(comment.n)}, ${comment.title || 'Untitled comment'}`}
        className="pointer-events-auto absolute left-0 cursor-pointer rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{ top: flagOffset(box, scale) / scale }}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => editSaved(comment)}
      >
        <RegionNumber n={comment.n} />
      </button>
    </div>
  );
}

/** A saved comment's title, note, severity, status and Figma frame, beside its region. */
function RegionTip({ comment, box }: { comment: PageComment; box: Rect }) {
  const scale = useOverlay((s) => s.scale);
  /** Measures the tip once it is drawn and places it beside the region where it fits. */
  const place = (tip: HTMLDivElement | null) => {
    if (!tip) return;
    const w = tip.offsetWidth * scale;
    const h = tip.offsetHeight * scale;
    const edge = EDGE * scale;
    const gap = 8 * scale;
    const flagTop = box.y + flagOffset(box, scale);
    const clampX = (x: number) => Math.min(Math.max(edge, x), innerWidth - w - edge);
    const clampY = (y: number) => Math.min(Math.max(edge, y), innerHeight - h - edge);
    const right = box.x + box.w;
    const bottom = box.y + box.h;
    const spots = [
      { left: right + gap, top: clampY(flagTop), fits: right + gap + w <= innerWidth - edge },
      { left: box.x - gap - w, top: clampY(flagTop), fits: box.x - gap - w >= edge },
      { left: clampX(box.x), top: box.y - gap - h, fits: box.y - gap - h >= edge },
      { left: clampX(box.x), top: bottom + gap, fits: bottom + gap + h <= innerHeight - edge },
    ];
    const spot = spots.find((s) => s.fits) ?? { left: clampX(box.x + 32 * scale), top: clampY(flagTop) };
    tip.style.left = `${spot.left / scale}px`;
    tip.style.top = `${spot.top / scale}px`;
  };
  const note = comment.note && comment.note !== comment.title ? comment.note : '';
  return (
    <div
      ref={place}
      role="tooltip"
      className="pointer-events-none fixed grid w-max max-w-80 gap-1 rounded-lg bg-popover px-3 py-2 text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 duration-100"
    >
      <b className="line-clamp-2 text-sm font-semibold break-words">{comment.title || 'Untitled comment'}</b>
      {note && <span className="line-clamp-2 text-xs break-words text-muted-foreground">{note}</span>}
      <span className="flex items-center gap-3 pt-0.5">
        <SeverityLabel severity={comment.severity} />
        <StatusLabel status={comment.status} className="text-muted-foreground" />
      </span>
      {comment.frame && <span className="truncate text-xs text-muted-foreground">{comment.frame}</span>}
    </div>
  );
}

/** The outlines and numbers of the comments saved on this page, following the page as it scrolls. */
export function SavedRegions() {
  const { comments } = usePage();
  const cardId = useOverlay((s) => s.card?.id);
  const pendingId = useOverlay((s) => s.pending?.oldId);
  const tip = useOverlay((s) => s.tip);
  useOverlay((s) => s.frame);
  const shown = comments
    .filter((c) => c.id !== cardId && c.id !== pendingId)
    .map((comment) => ({ comment, box: regionOf(comment) }))
    .filter((r): r is { comment: PageComment; box: Rect } => Boolean(r.box));
  const hot = shown.find((r) => r.comment.id === tip);
  return (
    <div data-scope="saved">
      {shown.map(({ comment, box }) => (
        <SavedRegion key={comment.id} comment={comment} box={box} hot={comment.id === tip} />
      ))}
      {hot && <RegionTip key={hot.comment.id} comment={hot.comment} box={hot.box} />}
    </div>
  );
}
