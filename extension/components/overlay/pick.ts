import { host } from './host';
import type { Anchor, ElementInfo, Picked, Rect } from './store';

/**
 * The area of a box in square pixels.
 * @param box The box to measure.
 */
const area = (box: { width: number; height: number }) => box.width * box.height;

/** Builds a short, readable CSS path for an element. */
function cssPath(el: Element) {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && parts.length < 4) {
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    let part = node.localName;
    const classes = [...node.classList].filter((c) => c.length < 24 && !/\d{4,}/.test(c)).slice(0, 2);
    if (classes.length) part += `.${classes.map((c) => CSS.escape(c)).join('.')}`;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const name = node.localName;
      const siblings = [...parent.children].filter((c) => c.localName === name);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

/**
 * The facts about an element that a developer needs to find it again.
 * @param frame The same-origin frame the element sits in, whose path leads the selector.
 */
export function describe(el: Element | null | undefined, frame?: Element | boolean): ElementInfo | null {
  if (!el) return null;
  const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
  return {
    selector: frame instanceof Element ? `${cssPath(frame)} >> ${cssPath(el)}` : cssPath(el),
    tag: el.localName,
    id: el.id || '',
    classes: [...el.classList].slice(0, 6).join(' '),
    text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    styles: {
      color: style.color,
      background: style.backgroundColor,
      font: `${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily.split(',')[0]}`,
    },
  };
}

/**
 * Searches below an element for the smallest visible element whose box, or whose own text, holds a point, whatever its
 * pointer-events. Only branches whose box holds the point are walked, within a fixed budget.
 */
function smallestAt(start: Element, x: number, y: number) {
  const holds = (r: DOMRect) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  let best: Element | null = null;
  let bestArea = Infinity;
  let budget = 1500;
  const consider = (el: Element, size: number) => {
    if (size > bestArea || el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return;
    best = el;
    bestArea = size;
  };
  const visit = (el: Element) => {
    for (const node of el.childNodes) {
      if (--budget < 0) return;
      if (node instanceof Text) {
        if (!node.data.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const line = [...range.getClientRects()].find(holds);
        if (line) consider(el, Math.min(area(line), area(el.getBoundingClientRect())));
        continue;
      }
      if (!(node instanceof Element) || node === host) continue;
      const r = node.getBoundingClientRect();
      if (!r.width && !r.height) {
        if (node.checkVisibility?.() !== false) visit(node);
      } else if (holds(r)) {
        consider(node, area(r));
        visit(node);
      }
    }
  };
  visit(start);
  return best as Element | null;
}

/**
 * Looks inside a frame for the element under a point. A same-origin frame gives its own element, with its box in this
 * page's viewport pixels. A frame Margin cannot read stays picked as a whole and is marked so the outline can say so.
 */
function inFrame(pick: Picked, x: number, y: number): Picked {
  const frame = pick.el as HTMLIFrameElement;
  let doc: Document | null = null;
  try {
    doc = frame.contentDocument;
  } catch {
    doc = null;
  }
  if (!doc) return { ...pick, frame: true };
  const box = frame.getBoundingClientRect();
  const zoom = frame.currentCSSZoom ?? 1;
  const left = box.left + frame.clientLeft * zoom;
  const top = box.top + frame.clientTop * zoom;
  const inner = doc.elementFromPoint((x - left) / zoom, (y - top) / zoom);
  if (!inner || inner === doc.documentElement || inner === doc.body) return pick;
  const r = inner.getBoundingClientRect();
  return { el: inner, full: false, frame, rect: { x: left + r.left * zoom, y: top + r.top * zoom, w: r.width * zoom, h: r.height * zoom } };
}

/**
 * Finds the page element a person points at. Hit testing skips layers with pointer-events: none, so on many sites the
 * hit is a canvas, video, gradient or full-bleed background in front of or behind the text. When the hit fills most of
 * the view, or is a large empty surface, the page is searched by element boxes and text instead, so the smallest
 * visible element holding the point wins. `full` is true when even that pick fills the view.
 * @param deep True to look inside a frame under the point.
 */
export function pickAt(x: number, y: number, deep = false): Picked | null {
  const hits = document.elementsFromPoint(x, y).filter((el) => el !== host);
  let el = hits[0];
  if (!el) return null;
  const view = innerWidth * innerHeight;
  let r = el.getBoundingClientRect();
  const surface = area(r) >= view * 0.2 && !el.childElementCount && !el.textContent?.trim();
  if ((area(r) >= view * 0.6 || surface) && document.body) {
    const found = smallestAt(document.body, x, y);
    const box = found?.getBoundingClientRect();
    if (found && box && area(box) < area(r) * 0.8) {
      el = found;
      r = box;
    }
  }
  const full = r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.95;
  const pick: Picked = { el, full, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
  return deep && el.localName === 'iframe' ? inFrame(pick, x, y) : pick;
}

/** The page element under a viewport point, skipping Margin's own overlay without hiding it. */
export const elementAt = (x: number, y: number) => pickAt(x, y)?.el ?? null;

/**
 * Records how to find a region again after the layout reflows. The anchor is the element under the region's centre,
 * widened until it covers a quarter of the region, with the region stored as fractions of that element's box.
 */
export function anchorFor(rect: Rect): Anchor | null {
  try {
    let el = elementAt(rect.x + rect.w / 2, rect.y + rect.h / 2);
    while (el && el.parentElement && el !== document.body && area(el.getBoundingClientRect()) < (rect.w * rect.h) / 4) {
      el = el.parentElement;
    }
    if (!el) return null;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    const selector = cssPath(el);
    const round = (v: number) => Math.round(v * 10000) / 10000;
    return {
      selector,
      nth: Math.max(0, [...document.querySelectorAll(selector)].indexOf(el)),
      tag: el.localName,
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
      box: {
        fx: round((rect.x - box.left) / box.width),
        fy: round((rect.y - box.top) / box.height),
        fw: round(rect.w / box.width),
        fh: round(rect.h / box.height),
      },
    };
  } catch {
    return null;
  }
}

/** Describes the element at the centre of a region, or null when it fails. */
export function elementIn(rect: Rect) {
  try {
    const pick = pickAt(rect.x + rect.w / 2, rect.y + rect.h / 2, true);
    return describe(pick?.el, pick?.frame);
  } catch {
    return null;
  }
}
