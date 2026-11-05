import { toast } from 'sonner';
import type { ElementInfo, Rect } from '@/lib/model';
import { sendMessage, type CaptureRequest } from '@/lib/protocol';
import type { OverlayStart } from '@/lib/overlay-protocol';
import { currentViewport, fitRect, holds, liveBox, rectBetween, type Point } from '../page/geometry';
import { currentHost } from '../page/host';
import { anchorFor, describeElement, pickAt, type Pick } from '../page/pick';
import { currentSettings, messageOf, pageCommentsQuery, queryClient, refreshComments, saveMode } from '../query';
import type { OverlaySlice } from '.';
import type { PendingRedraw } from './types';

/** Drags shorter than this on either side count as a click. */
const MIN_DRAG = 6;
/** How long a screenshot may take before the card opens with an error. */
const SHOT_TIMEOUT = 10000;

/** The right-click menu, open at a viewport point. */
export interface PageMenu {
  x: number;
  y: number;
}

export interface CaptureSlice {
  active: boolean;
  reviewName: string;
  /** True while Alt is held and the page has the pointer. */
  passing: boolean;
  drag: { from: Point; to: Point } | null;
  /** The element outlined under the pointer, with selectors on or under the right-click menu. */
  hover: Pick | null;
  /** The area being stored after its screenshot, until its card opens. */
  saving: Rect | null;
  menu: PageMenu | null;
  /** A card closed for a redraw, waiting for the new area. */
  pending: PendingRedraw | null;
  setActive(active: boolean, start?: Partial<OverlayStart>): Promise<boolean>;
  setPassing(passing: boolean): void;
  pointerDown(event: MouseEvent): void;
  pointerMove(event: MouseEvent): void;
  pointerUp(event: MouseEvent): void;
  contextMenu(event: MouseEvent): void;
  openMenuAt(x: number, y: number): void;
  closeMenu(): void;
  captureRegion(rect: Rect, element?: ElementInfo | null): Promise<void>;
  captureViewport(): void;
  captureElementAt(x: number, y: number): void;
  captureWidths(which: { ids?: string[]; page?: boolean }): Promise<boolean>;
  toggleSelectors(): void;
  toggleMarkers(): void;
}

/**
 * Waits for the given time.
 * @param ms Milliseconds.
 */
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits until two frames have been painted, so a hidden overlay is gone from the screen. */
const twoFrames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * Removes a stored draft that is no longer wanted, and says so if that fails.
 * @param id The draft's id.
 */
export function discardDraft(id: string) {
  return sendMessage('discard', { id })
    .then(refreshComments)
    .catch((error: unknown) => {
      toast.error('Margin could not remove the unsaved comment', { description: messageOf(error) });
    });
}

/**
 * Asks the service worker to screenshot a region and store it as a draft, with the overlay hidden for the shot.
 * Resolves to the draft's id or to what went wrong.
 * @param request The capture request.
 */
export async function takeShot(request: CaptureRequest): Promise<{ id: string } | { error: string }> {
  const host = currentHost();
  host?.hideForCapture(true);
  try {
    await Promise.race([twoFrames(), wait(1000)]);
    await wait(60);
    if (document.visibilityState !== 'visible') return { error: 'The tab was in the background, so Margin did not take the screenshot' };
    const sent = sendMessage('capture', request);
    const reply = await Promise.race([sent, wait(SHOT_TIMEOUT).then(() => null)]);
    if (reply) return reply;
    sent.then(
      (late) => discardDraft(late.id),
      (error: unknown) => console.warn('Margin: a screenshot that timed out failed later too', error),
    );
    return { error: 'Margin waited too long for the screenshot' };
  } catch (error) {
    return { error: messageOf(error) };
  } finally {
    host?.hideForCapture(false);
  }
}

/**
 * Describes the element at the centre of a region when selector capture is on.
 * @param rect The region.
 */
function elementAtCentre(rect: Rect) {
  if (!currentSettings().selectorMode) return null;
  const pick = pickAt(rect.x + rect.w / 2, rect.y + rect.h / 2, true);
  return pick ? describeElement(pick.element, pick.frame) : null;
}

/**
 * The point of a mouse event in viewport pixels.
 * @param event The event.
 */
const pointOf = (event: MouseEvent): Point => ({ x: event.clientX, y: event.clientY });

/**
 * True when an event landed on one of the overlay's own controls rather than on the page under it.
 * @param event The event.
 */
const onOwnControl = (event: Event) => event.target instanceof Element && Boolean(event.target.closest('[data-margin-float], [data-sonner-toaster]'));

export const createCaptureSlice: OverlaySlice<CaptureSlice> = (set, get) => ({
  active: false,
  reviewName: '',
  passing: false,
  drag: null,
  hover: null,
  saving: null,
  menu: null,
  pending: null,

  async setActive(active, start) {
    const host = currentHost();
    if (!host) throw new Error('The Margin overlay is not mounted');
    if (start?.reviewName) set({ reviewName: start.reviewName });
    if (start?.zoom) host.setZoom(start.zoom);
    if (get().active === active) return active;
    if (active) {
      set({ active: true });
      host.attach({
        strayMove: (event) => get().pointerMove(event),
        keyDown: (event) => get().keyDown(event),
        keyUp: (event) => get().keyUp(event),
        blur: () => get().setPassing(false),
        leave: () => get().keepOnLeave(),
      });
      void refreshComments();
    } else {
      const { card, pending } = get();
      get().closeCard(Boolean(card && !card.reopened));
      if (pending?.old?.id && !pending.old.reopened) void discardDraft(pending.old.id);
      toast.dismiss();
      set({ active: false, menu: null, pending: null, lastSaved: null, drag: null, hover: null, saving: null, passing: false });
      host.detach();
    }
    sendMessage('annotating', { active }).catch((error: unknown) => {
      if (active) toast.error('Margin will not stay on after this page changes', { description: messageOf(error) });
      else console.error('Margin: could not record that annotation stopped', error);
    });
    return active;
  },

  setPassing(passing) {
    if (get().passing === passing) return;
    currentHost()?.setPassThrough(passing);
    set(passing ? { passing, drag: null, hover: null } : { passing });
  },

  pointerDown(event) {
    const { menu, card, placing } = get();
    if (onOwnControl(event)) {
      if (card?.framePickerOpen && !(event.target as Element).closest('[data-margin-popup]')) {
        get().editCard({ framePickerOpen: false });
      }
      return;
    }
    if (menu) {
      event.preventDefault();
      if (event.button === 0) get().closeMenu();
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    const point = pointOf(event);
    if (card) {
      if (card.framePickerOpen) {
        get().editCard({ framePickerOpen: false });
        return;
      }
      if (holds(liveBox(card), point)) {
        if ((currentSettings().markerMode || placing) && !card.asking) get().addMarker(point);
        return;
      }
    }
    set({ drag: { from: point, to: point }, hover: null });
  },

  pointerMove(event) {
    const { drag, card, menu, passing, hover } = get();
    if (drag) {
      set({ drag: { ...drag, to: pointOf(event) } });
      return;
    }
    if (card || menu || passing || !currentSettings().selectorMode) return;
    if (onOwnControl(event)) {
      if (hover) set({ hover: null });
      return;
    }
    const point = pointOf(event);
    set({ hover: pickAt(point.x, point.y, true) });
  },

  pointerUp(event) {
    const { drag, card } = get();
    if (!drag) return;
    set({ drag: null });
    const point = pointOf(event);
    let rect = rectBetween(drag.from, point);
    const tiny = rect.w < MIN_DRAG || rect.h < MIN_DRAG;
    if (card) {
      if (tiny) return;
      if (!get().replaceable()) {
        get().holdCard();
        return;
      }
      const { severity } = card;
      get().closeCard(true);
      rect = fitRect(rect);
      if (rect.w < 2 || rect.h < 2) return;
      set({ pending: { draft: { severity, pageMarks: [] }, old: null } });
      void get().captureRegion(rect);
      return;
    }
    if (tiny) {
      if (!currentSettings().selectorMode) {
        toast('Drag over an area to comment, or press S to pick elements');
        return;
      }
      const pick = pickAt(point.x, point.y, true);
      if (!pick) return;
      rect = pick.rect;
    }
    rect = fitRect(rect);
    if (rect.w < 2 || rect.h < 2) return;
    void get().captureRegion(rect);
  },

  contextMenu(event) {
    event.preventDefault();
    const { drag, card, keyMenuAt } = get();
    if (onOwnControl(event) || drag || performance.now() - keyMenuAt < 1000) return;
    if (card) {
      get().holdCard();
      return;
    }
    const point = pointOf(event);
    get().openMenuAt(point.x, point.y);
  },

  openMenuAt(x, y) {
    const saved = queryClient.getQueryData(pageCommentsQuery.queryKey)?.comments ?? [];
    const onSaved = saved.some((comment) => holds(liveBox(comment), { x, y }));
    set({ menu: { x, y }, hover: onSaved ? null : pickAt(x, y) });
  },

  closeMenu() {
    set({ menu: null, hover: null });
  },

  async captureRegion(rect, element = elementAtCentre(rect)) {
    const request: CaptureRequest = { rect, element, anchor: anchorFor(rect), viewport: currentViewport() };
    set({ hover: null });
    const reply = await takeShot(request);
    if (!get().active) {
      if ('id' in reply) void discardDraft(reply.id);
      return;
    }
    set({ saving: rect });
    const { pending } = get();
    set({ pending: null });
    if ('id' in reply) {
      if (pending?.old?.id) void discardDraft(pending.old.id);
      await queryClient.refetchQueries({ queryKey: pageCommentsQuery.queryKey });
    }
    set({ saving: null });
    const carried = pending?.draft.pageMarks ?? [];
    const marks = carried
      .map((mark) => ({ x: Math.round(mark.pageX - scrollX), y: Math.round(mark.pageY - scrollY), note: mark.note }))
      .filter((mark) => holds(rect, mark));
    get().openCard({
      id: 'id' in reply ? reply.id : null,
      rect,
      element,
      request,
      error: 'error' in reply ? reply.error : null,
      viewport: request.viewport,
      anchor: request.anchor,
      draft: pending ? { ...pending.draft, marks } : undefined,
    });
    const dropped = carried.length - marks.length;
    if (dropped) toast(`${dropped} ${dropped === 1 ? 'marker was' : 'markers were'} outside the new area and ${dropped === 1 ? 'was' : 'were'} removed`);
  },

  captureViewport() {
    const { card } = get();
    if (card && !get().replaceable()) {
      get().holdCard();
      return;
    }
    get().closeCard(true);
    void get().captureRegion(fitRect({ x: 0, y: 0, w: innerWidth, h: innerHeight }));
  },

  captureElementAt(x, y) {
    const pick = pickAt(x, y, true);
    if (!pick) return;
    const rect = fitRect(pick.rect);
    if (rect.w < 2 || rect.h < 2) {
      toast('That element is out of view. Scroll to it first.');
      return;
    }
    const element = describeElement(pick.element, pick.frame);
    if (!element) toast('Margin could not describe that element, so the comment has no selector');
    void get().captureRegion(rect, element);
  },

  async captureWidths(which) {
    const progress = toast.loading('Capturing at mobile, tablet and desktop widths');
    try {
      const reply = await sendMessage('captureWidths', which);
      if ('error' in reply) {
        toast.error(reply.error, { id: progress });
        return false;
      }
      toast.success(reply.message, { id: progress });
      return true;
    } catch (error) {
      toast.error('Capture at three widths stopped', { id: progress, description: messageOf(error) });
      return false;
    }
  },

  toggleSelectors() {
    void saveMode('selectorMode', !currentSettings().selectorMode);
    set({ hover: null });
  },

  toggleMarkers() {
    void saveMode('markerMode', !currentSettings().markerMode);
  },
});
