import type { Marker, Rect } from '@/lib/model';

/** The eight resize handles of a rectangle, by compass point. */
export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number] | 'end';

export interface Point {
  x: number;
  y: number;
}

/**
 * Keeps a number between two bounds.
 * @param value The number.
 * @param low The lower bound.
 * @param high The upper bound.
 */
export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Radius of a numbered disc in page pixels, never smaller than 10 screen pixels.
 * @param zoom The zoom.
 */
export const discRadius = (zoom: number) => Math.max(13, 10 / zoom);

/**
 * Side of a resize handle in page pixels, the same size on screen at any zoom.
 * @param zoom The zoom.
 */
export const handleSize = (zoom: number) => 9 / zoom;

/**
 * Where each handle of a rectangle sits.
 * @param rect The rectangle.
 */
export function handlePoints(rect: Rect): Record<(typeof HANDLES)[number], Point> {
  const { x, y, w, h } = rect;
  return {
    nw: { x, y },
    'n': { x: x + w / 2, y },
    ne: { x: x + w, y },
    'e': { x: x + w, y: y + h / 2 },
    se: { x: x + w, y: y + h },
    's': { x: x + w / 2, y: y + h },
    sw: { x, y: y + h },
    w: { x, y: y + h / 2 },
  };
}

/**
 * Resizes a rectangle by dragging one handle, keeping it the right way round and inside the image.
 * @param orig The rectangle when the drag started.
 * @param handle The handle dragged.
 * @param dx Horizontal distance in page pixels.
 * @param dy Vertical distance in page pixels.
 * @param bounds The image size.
 */
export function resized(orig: Rect, handle: string, dx: number, dy: number, bounds: { width: number; height: number }): Rect {
  let left = orig.x;
  let top = orig.y;
  let right = orig.x + orig.w;
  let bottom = orig.y + orig.h;
  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;
  const x = clamp(Math.min(left, right), 0, bounds.width);
  const y = clamp(Math.min(top, bottom), 0, bounds.height);
  return {
    x,
    y,
    w: Math.max(4, Math.min(Math.abs(right - left), bounds.width - x)),
    h: Math.max(4, Math.min(Math.abs(bottom - top), bounds.height - y)),
  };
}

/**
 * Moves a marker or the region by a distance.
 * @param orig The shape when the drag started.
 * @param dx Horizontal distance in page pixels.
 * @param dy Vertical distance in page pixels.
 */
export function moved<Shape extends Rect | Marker>(orig: Shape, dx: number, dy: number): Shape {
  const next = { ...orig, x: orig.x + dx, y: orig.y + dy };
  if ('x2' in orig && orig.x2 !== undefined && orig.y2 !== undefined) Object.assign(next, { x2: orig.x2 + dx, y2: orig.y2 + dy });
  return next;
}

/**
 * The arrowhead's three points, the way the saved image draws it.
 * @param mark The arrow.
 * @param radius The disc radius the head scales with.
 */
export function arrowHead(mark: Marker, radius: number) {
  const x2 = mark.x2 ?? mark.x;
  const y2 = mark.y2 ?? mark.y;
  const angle = Math.atan2(y2 - mark.y, x2 - mark.x);
  const head = radius * 1.2;
  return [x2 - head * Math.cos(angle - 0.45), y2 - head * Math.sin(angle - 0.45), x2, y2, x2 - head * Math.cos(angle + 0.45), y2 - head * Math.sin(angle + 0.45)];
}

/**
 * A box placed around a point, for a box added by a click or from the menu.
 * @param point The point.
 * @param bounds The image size.
 */
export const boxAround = (point: Point, bounds: { width: number; height: number }) => resized({ x: point.x - 80, y: point.y - 50, w: 160, h: 100 }, 'se', 0, 0, bounds);

/**
 * An arrow pointing at a point from up and left of it.
 * @param point The point.
 * @param bounds The image size.
 */
export const arrowTo = (point: Point, bounds: { width: number; height: number }) => ({
  x: clamp(point.x - 90, 0, bounds.width),
  y: clamp(point.y - 70, 0, bounds.height),
  x2: point.x,
  y2: point.y,
});
