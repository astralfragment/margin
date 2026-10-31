import type { Anchor, Rect, Viewport } from './store';

/** Space the capture bar keeps clear at the bottom (or top) of the view, in overlay pixels. */
export const BAR_SPACE = 72;
/** Closest an overlay surface comes to the edge of the view, in overlay pixels. */
export const EDGE = 8;

type Placed = { rect: Rect; anchor?: Anchor | null; viewport?: Viewport };

/**
 * Where a captured region sits now in viewport pixels, whether or not it is in view: by its anchor element when the
 * window width changed, else moved by how far the page scrolled since the capture.
 */
export function liveBox({ rect, anchor, viewport }: Placed): Rect {
  const sameWidth = Math.abs((viewport?.width ?? innerWidth) - innerWidth) < 2;
  if (!sameWidth && anchor) {
    try {
      const el = document.querySelectorAll(anchor.selector)[anchor.nth];
      const r = el?.getBoundingClientRect();
      if (r?.width && r.height) {
        const f = anchor.box;
        return { x: r.left + f.fx * r.width, y: r.top + f.fy * r.height, w: f.fw * r.width, h: f.fh * r.height };
      }
    } catch {
      // A selector the page no longer accepts falls back to the scroll offset.
    }
  }
  return { x: rect.x, y: rect.y + (viewport?.scrollY ?? 0) - scrollY, w: rect.w, h: rect.h };
}

/** Where a saved comment's region sits now, or null when it is entirely out of view. */
export function regionOf(comment: Placed) {
  const box = liveBox(comment);
  if (box.y + box.h < 0 || box.y > innerHeight || box.x > innerWidth || box.x + box.w < 0) return null;
  return box;
}

/** Rounds a region to whole pixels and keeps it inside the viewport. */
export function fitRect(rect: Rect): Rect {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(innerWidth, rect.x + rect.w);
  const bottom = Math.min(innerHeight, rect.y + rect.h);
  return { x: Math.round(left), y: Math.round(top), w: Math.max(0, Math.round(right - left)), h: Math.max(0, Math.round(bottom - top)) };
}

/**
 * Draws a region a little inside the edges of the view it touches, so an area as big as the view still reads as a
 * selection instead of merging with the overlay's frame.
 */
export function inset(rect: Rect, scale: number): Rect {
  const k = 4 * scale;
  const left = rect.x <= 4 ? k : 0;
  const top = rect.y <= 4 ? k : 0;
  const right = rect.x + rect.w >= innerWidth - 4 ? k : 0;
  const bottom = rect.y + rect.h >= innerHeight - 4 ? k : 0;
  return { x: rect.x + left, y: rect.y + top, w: Math.max(2, rect.w - left - right), h: Math.max(2, rect.h - top - bottom) };
}

/**
 * Turns a point stored against the captured area into where it shows now, or back again with `back`.
 * Markers are stored in the capture's viewport pixels, since that is how the screenshot is drawn on.
 */
export function mapPoint(rect: Rect, live: Rect, point: { x: number; y: number }, back = false) {
  const from = back ? live : rect;
  const to = back ? rect : live;
  return { x: to.x + ((point.x - from.x) * to.w) / from.w, y: to.y + ((point.y - from.y) * to.h) / from.h };
}

/**
 * How far above a region its number flag sits: above it, below it when there is no room above, or inside its top edge.
 * @param below False when something else sits under the region, such as the composer.
 */
export function flagOffset(rect: Rect, scale: number, below = true) {
  const lift = 26 * scale;
  if (rect.y >= lift + 2 * scale) return -lift;
  if (below && rect.y + rect.h + lift <= innerHeight - 2 * scale) return rect.h + 4 * scale;
  return Math.max(0, -rect.y) + 4 * scale;
}

/** True when a region reaches into the strip the capture bar covers at the bottom of the view. */
export function reachesBar(rect: Rect | null, scale: number) {
  const strip = BAR_SPACE * scale;
  return Boolean(rect) && rect!.y + rect!.h > innerHeight - strip && rect!.y > strip && rect!.y < innerHeight;
}

/** CSS for an element covering a region given in page pixels, inside the overlay's own pixels. */
export const boxStyle = (rect: Rect, scale: number) => ({
  left: rect.x / scale,
  top: rect.y / scale,
  width: rect.w / scale,
  height: rect.h / scale,
});
