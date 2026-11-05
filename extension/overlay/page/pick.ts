import { finder } from '@medv/finder';
import type { Anchor, ElementInfo, Rect } from '@/lib/model';
import { getHostElement } from './host-element';

/** The page element a person points at, with its box in viewport pixels. */
export interface Pick {
  element: Element;
  rect: Rect;
  /** True when the element fills the whole view. */
  full: boolean;
  /** The same-origin frame the element sits in, or true for a frame Margin cannot look into. */
  frame?: HTMLIFrameElement | true;
}

/**
 * The area of a box.
 * @param box The box.
 */
const area = (box: DOMRect) => box.width * box.height;

/**
 * Rounds a fraction to four places, which keeps anchors short.
 * @param value The fraction.
 */
const round = (value: number) => Math.round(value * 10000) / 10000;

/**
 * A short unique CSS selector for an element, or null when none is found in time on a very large page.
 * @param element The element.
 */
function selectorFor(element: Element): string | null {
  try {
    return finder(element, { root: element.ownerDocument.body ?? element.ownerDocument.documentElement, timeoutMs: 300 });
  } catch (error) {
    console.warn('Margin: no unique selector was found for the element', error);
    return null;
  }
}

/**
 * Finds the page element under a viewport point, skipping the overlay. Hit testing skips layers with pointer-events:
 * none, so on many sites the hit is a canvas, video or full-bleed background in front of or behind the text. When the
 * hit fills most of the view, or is a large empty surface, the page is searched by element boxes and text instead, so
 * the smallest visible element holding the point wins.
 * @param x Viewport x of the point.
 * @param y Viewport y of the point.
 * @param deep True to look inside a frame under the point.
 */
export function pickAt(x: number, y: number, deep = false): Pick | null {
  const host = getHostElement();
  let element = document.elementsFromPoint(x, y).find((hit) => hit !== host);
  if (!element) return null;
  const view = innerWidth * innerHeight;
  let box = element.getBoundingClientRect();
  const surface = area(box) >= view * 0.2 && !element.childElementCount && !element.textContent?.trim();
  if ((area(box) >= view * 0.6 || surface) && document.body) {
    const found = smallestAt(document.body, x, y);
    const foundBox = found?.getBoundingClientRect();
    if (found && foundBox && area(foundBox) < area(box) * 0.8) {
      element = found;
      box = foundBox;
    }
  }
  const pick: Pick = {
    element,
    full: box.width >= innerWidth * 0.95 && box.height >= innerHeight * 0.95,
    rect: { x: box.left, y: box.top, w: box.width, h: box.height },
  };
  return deep && element instanceof HTMLIFrameElement ? inFrame(pick, element, x, y) : pick;
}

/**
 * The page element under a point, skipping the overlay.
 * @param x Viewport x of the point.
 * @param y Viewport y of the point.
 */
export const elementAt = (x: number, y: number) => pickAt(x, y)?.element ?? null;

/**
 * Looks inside a frame for the element under a point. A same-origin frame gives its own element, with its box in this
 * page's viewport pixels. A frame Margin cannot read stays picked as a whole and is marked so the outline says so.
 * @param pick The frame as picked.
 * @param frame The frame element.
 * @param x Viewport x of the point.
 * @param y Viewport y of the point.
 */
function inFrame(pick: Pick, frame: HTMLIFrameElement, x: number, y: number): Pick {
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    // A cross-origin frame throws here, which is what the `frame: true` marking below is for.
    doc = null;
  }
  if (!doc) return { ...pick, frame: true };
  const box = frame.getBoundingClientRect();
  const zoom = frame.currentCSSZoom ?? 1;
  const left = box.left + frame.clientLeft * zoom;
  const top = box.top + frame.clientTop * zoom;
  const inner = doc.elementFromPoint((x - left) / zoom, (y - top) / zoom);
  if (!inner || inner === doc.documentElement || inner === doc.body) return pick;
  const innerBox = inner.getBoundingClientRect();
  return {
    element: inner,
    full: false,
    frame,
    rect: { x: left + innerBox.left * zoom, y: top + innerBox.top * zoom, w: innerBox.width * zoom, h: innerBox.height * zoom },
  };
}

/**
 * Searches below an element for the smallest visible element whose box, or whose own text, holds a point, whatever
 * its pointer-events. Only branches whose box holds the point are walked, within a fixed budget.
 * @param start Where the search begins.
 * @param x Viewport x of the point.
 * @param y Viewport y of the point.
 */
function smallestAt(start: Element, x: number, y: number): Element | null {
  const host = getHostElement();
  const contains = (box: DOMRect) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  let best: Element | null = null;
  let bestArea = Infinity;
  let budget = 1500;
  const consider = (element: Element, size: number) => {
    if (size > bestArea || element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return;
    best = element;
    bestArea = size;
  };
  const visit = (parent: Element) => {
    for (const node of parent.childNodes) {
      if (--budget < 0) return;
      if (node instanceof Text) {
        if (!node.data.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const line = [...range.getClientRects()].find(contains);
        const own = parent.getBoundingClientRect();
        if (line) consider(parent, Math.min(line.width * line.height, own.width * own.height));
        continue;
      }
      if (!(node instanceof Element) || node === host) continue;
      const box = node.getBoundingClientRect();
      if (!box.width && !box.height) {
        if (node.checkVisibility?.() !== false) visit(node);
      } else if (contains(box)) {
        consider(node, box.width * box.height);
        visit(node);
      }
    }
  };
  visit(start);
  return best;
}

/**
 * The facts about an element a developer needs to find it again, or null when no selector could be made.
 * @param element The element.
 * @param frame The same-origin frame it sits in, whose selector leads.
 */
export function describeElement(element: Element, frame?: HTMLIFrameElement | true): ElementInfo | null {
  const selector = selectorFor(element);
  if (!selector) return null;
  const framePath = frame instanceof HTMLIFrameElement ? selectorFor(frame) : null;
  const style = (element.ownerDocument.defaultView ?? window).getComputedStyle(element);
  return {
    selector: framePath ? `${framePath} >> ${selector}` : selector,
    tag: element.localName,
    id: element.id || '',
    classes: [...element.classList].slice(0, 6).join(' '),
    text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    styles: {
      color: style.color,
      background: style.backgroundColor,
      font: `${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily.split(',')[0]}`,
    },
  };
}

/**
 * Records how to find a region again after the layout reflows. The anchor is the element under the region's centre,
 * widened until it covers a quarter of the region, with the region stored as fractions of that element's box.
 * Returns null when nothing sits under the region.
 * @param rect The captured region in viewport pixels.
 */
export function anchorFor(rect: Rect): Anchor | null {
  let element = elementAt(rect.x + rect.w / 2, rect.y + rect.h / 2);
  while (element?.parentElement && element !== document.body && area(element.getBoundingClientRect()) < (rect.w * rect.h) / 4) {
    element = element.parentElement;
  }
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const selector = selectorFor(element);
  if (!selector) return null;
  return {
    selector,
    nth: Math.max(0, [...document.querySelectorAll(selector)].indexOf(element)),
    tag: element.localName,
    text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    box: {
      fx: round((rect.x - box.left) / box.width),
      fy: round((rect.y - box.top) / box.height),
      fw: round(rect.w / box.width),
      fh: round(rect.h / box.height),
    },
  };
}

/**
 * True for an element a person types into.
 * @param element The element, if any.
 */
export const isEditable = (element: EventTarget | null | undefined) =>
  element instanceof HTMLElement && (element.isContentEditable || ['input', 'textarea', 'select'].includes(element.localName));
