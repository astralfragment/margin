import type { Anchor, Rect, Viewport } from '@/lib/model';

/** A captured region and how to find it again: its rect at capture time, its anchor element and the viewport then. */
export interface Placed {
  rect: Rect;
  anchor: Anchor | null;
  viewport?: Viewport | null;
}

/** A point in viewport pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Rounds a region to whole pixels and keeps it inside the viewport.
 * @param rect The region in viewport pixels.
 */
export function fitRect(rect: Rect): Rect {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(innerWidth, rect.x + rect.w);
  const bottom = Math.min(innerHeight, rect.y + rect.h);
  return { x: Math.round(left), y: Math.round(top), w: Math.max(0, Math.round(right - left)), h: Math.max(0, Math.round(bottom - top)) };
}

/**
 * The region between two corners of a drag.
 * @param from Where the drag started.
 * @param to Where the pointer is now.
 */
export const rectBetween = (from: Point, to: Point): Rect => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  w: Math.abs(to.x - from.x),
  h: Math.abs(to.y - from.y),
});

/**
 * Pulls a region a little inside the edges of the view it touches, so an area as big as the view still reads as a
 * selection instead of merging with the overlay's frame.
 * @param rect The region in viewport pixels.
 * @param scale Page pixels per overlay pixel.
 */
export function insetFromEdges(rect: Rect, scale: number): Rect {
  const step = 4 * scale;
  const left = rect.x <= 4 ? step : 0;
  const top = rect.y <= 4 ? step : 0;
  const right = rect.x + rect.w >= innerWidth - 4 ? step : 0;
  const bottom = rect.y + rect.h >= innerHeight - 4 ? step : 0;
  return { x: rect.x + left, y: rect.y + top, w: Math.max(2, rect.w - left - right), h: Math.max(2, rect.h - top - bottom) };
}

/**
 * Where a captured region sits now in viewport pixels, whether or not it is in view: by its anchor element when the
 * window width changed, else moved by how far the page scrolled since the capture.
 * @param placed The region as captured.
 */
export function liveBox(placed: Placed): Rect {
  const capturedWidth = placed.viewport?.width ?? innerWidth;
  if (Math.abs(capturedWidth - innerWidth) >= 2 && placed.anchor) {
    const box = anchorBox(placed.anchor);
    if (box) return box;
  }
  return { ...placed.rect, y: placed.rect.y + (placed.viewport?.scrollY ?? 0) - scrollY };
}

/**
 * The region an anchor describes, on its element as the page lays it out now, or null when the element is gone.
 * @param anchor The anchor.
 */
function anchorBox(anchor: Anchor): Rect | null {
  let element: Element | undefined;
  try {
    element = document.querySelectorAll(anchor.selector)[anchor.nth];
  } catch (error) {
    console.warn('Margin: a saved selector no longer parses', anchor.selector, error);
    return null;
  }
  const box = element?.getBoundingClientRect();
  if (!box?.width || !box.height) return null;
  const { fx, fy, fw, fh } = anchor.box;
  return { x: box.left + fx * box.width, y: box.top + fy * box.height, w: fw * box.width, h: fh * box.height };
}

/**
 * True when any part of a region is inside the view.
 * @param box The region in viewport pixels.
 */
export const inView = (box: Rect) => box.y + box.h >= 0 && box.y <= innerHeight && box.x <= innerWidth && box.x + box.w >= 0;

/**
 * True when a point is inside a region.
 * @param box The region.
 * @param point The point.
 */
export const holds = (box: Rect, point: Point) => point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;

/**
 * Moves a point from one placement of a region to another, keeping it at the same spot inside the region.
 * @param point The point.
 * @param from The region the point is measured against.
 * @param to The region to map it onto.
 */
export function mapBetween(point: Point, from: Rect, to: Rect): Point {
  return { x: to.x + ((point.x - from.x) * to.w) / (from.w || 1), y: to.y + ((point.y - from.y) * to.h) / (from.h || 1) };
}

/** The strip at the bottom of the view the hint bar takes, in overlay pixels. */
export const HINT_SPACE = 64;

/**
 * True when the hint bar should move to the top, because an area reaches into the strip it covers at the bottom.
 * @param box The area in viewport pixels, or null.
 * @param scale Page pixels per overlay pixel.
 */
export function hintAtTop(box: Rect | null, scale: number) {
  const strip = HINT_SPACE * scale;
  return Boolean(box && box.y + box.h > innerHeight - strip && box.y > strip && box.y < innerHeight);
}

/** The viewport now, as a capture records it. */
export const currentViewport = (): Viewport => ({ width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY), dpr: devicePixelRatio });

let frame = 0;
let layoutVersion = 0;
const layoutListeners = new Set<() => void>();

/** Bumps the layout version once per frame while the page scrolls or resizes, and tells the subscribers. */
function onLayoutChange() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    layoutVersion += 1;
    layoutListeners.forEach((listener) => listener());
  });
}

/**
 * Subscribes to scrolls and resizes anywhere on the page, for useSyncExternalStore. Components that draw on the page
 * read live boxes after each change.
 * @param listener Called once per frame while the layout changes.
 */
export function subscribeLayout(listener: () => void) {
  if (!layoutListeners.size) {
    addEventListener('scroll', onLayoutChange, { passive: true, capture: true });
    addEventListener('resize', onLayoutChange);
  }
  layoutListeners.add(listener);
  return () => {
    layoutListeners.delete(listener);
    if (layoutListeners.size) return;
    removeEventListener('scroll', onLayoutChange, { capture: true });
    removeEventListener('resize', onLayoutChange);
  };
}

/** The layout version, which changes whenever positions on the page may have moved. */
export const layoutSnapshot = () => layoutVersion;

/** Marks the layout as changed, as after a zoom change that moves nothing on the page but rescales the overlay. */
export const touchLayout = onLayoutChange;
