import { arrow, autoUpdate, computePosition, flip, offset, platform, shift, size, type Placement, type Platform, type VirtualElement } from '@floating-ui/dom';
import { HINT_SPACE, hintAtTop, liveBox } from '../../page/geometry';
import { currentHost } from '../../page/host';
import { overlayStore } from '../../store';

/**
 * How the tail turns for each side of the area the card takes. The tail is a square drawn with its left and bottom
 * borders, so turned 45 degrees its corner points left.
 */
const TAIL_TURN: Record<string, string> = { right: 'rotate(45deg)', left: 'rotate(-135deg)', bottom: 'rotate(135deg)', top: 'rotate(-45deg)' };

/**
 * The size of an element on the page. The overlay counters browser zoom with CSS zoom, so its CSS size is not its
 * size on the page. Its box is.
 * @param element The element.
 */
function pageSize(element: Element) {
  const box = element.getBoundingClientRect();
  return { width: box.width, height: box.height };
}

/**
 * floating-ui measuring everything in the page's viewport pixels. Its own measuring reads the overlay's CSS zoom as a
 * scale on the card's ancestors and mixes the two units.
 */
const pagePlatform: Platform = {
  ...platform,
  getDimensions: pageSize,
  getElementRects: ({ reference, floating }) => {
    const area = reference.getBoundingClientRect();
    return { reference: { x: area.x, y: area.y, width: area.width, height: area.height }, floating: { x: 0, y: 0, ...pageSize(floating) } };
  },
  getClippingRect: () => ({ x: 0, y: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }),
  getOffsetParent: () => window,
  getScale: () => ({ x: 1, y: 1 }),
  convertOffsetParentRelativeRectToViewportRelativeRect: ({ rect }) => rect,
};

/** Where the open card's area sits now in viewport pixels. */
function areaNow() {
  const open = overlayStore.getState().card;
  return open ? liveBox(open) : { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * Keeps the card beside its area as the page scrolls, resizes or zooms and as the card grows: right of the area, then
 * left, below and above, clear of the hint bar and inside the window. In the top half of the view it hangs from its
 * top edge, in the bottom half it grows up. Returns the function that stops following.
 * @param card The card element.
 * @param tail The small tail on the card's edge that points at the area.
 */
export function followArea(card: HTMLElement, tail: HTMLElement) {
  const reference: VirtualElement = {
    getBoundingClientRect: () => {
      const area = areaNow();
      return DOMRect.fromRect({ x: area.x, y: area.y, width: area.w, height: area.h });
    },
  };
  const update = async () => {
    const scale = currentHost()?.scale ?? 1;
    const area = areaNow();
    const atTop = hintAtTop(area, scale);
    const edge = 8 * scale;
    const strip = HINT_SPACE * scale;
    const padding = { top: atTop ? strip : edge, bottom: atTop ? edge : strip, left: edge, right: edge };
    const upper = area.y + area.h / 2 < innerHeight / 2;
    const placement: Placement = upper ? 'right-start' : 'right-end';
    const placed = await computePosition(reference, card, {
      strategy: 'fixed',
      placement,
      platform: pagePlatform,
      middleware: [
        offset(12 * scale),
        flip({ padding, fallbackPlacements: [upper ? 'left-start' : 'left-end', 'bottom-start', 'top-start'] }),
        shift({ padding, crossAxis: true }),
        size({ padding, apply: ({ availableHeight }) => void (card.style.maxHeight = `${Math.max(160, availableHeight / scale)}px`) }),
        arrow({ element: tail, padding: 16 * scale }),
      ],
    });
    card.style.left = `${placed.x / scale}px`;
    card.style.top = `${placed.y / scale}px`;
    const side = placed.placement.split('-')[0] ?? 'right';
    const tailAt = placed.middlewareData.arrow;
    const { width, height } = pageSize(card);
    const overArea = placed.x < area.x + area.w && placed.x + width > area.x && placed.y < area.y + area.h && placed.y + height > area.y;
    tail.hidden = overArea;
    tail.style.left = tailAt?.x != null ? `${tailAt.x / scale}px` : side === 'left' ? 'calc(100% - 6px)' : '-6px';
    tail.style.top = tailAt?.y != null ? `${tailAt.y / scale}px` : side === 'top' ? 'calc(100% - 6px)' : '-6px';
    tail.style.transform = TAIL_TURN[side] ?? '';
  };
  return autoUpdate(reference, card, () => void update(), { layoutShift: false });
}
