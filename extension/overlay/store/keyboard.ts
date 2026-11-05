import { toast } from 'sonner';
import { currentHost } from '../page/host';
import { isEditable } from '../page/pick';
import type { OverlaySlice } from '.';

/** The keys the overlay's shortcuts use. Pressed while focus is on the page, outside a field, they go to the overlay. */
const SHORTCUT_KEYS = new Set(['s', 'm', 'v', 'r', '1', '2', '3', '4', 'z']);

/** Two presses of Esc this close together stop annotating. */
const DOUBLE_ESC = 1600;

export interface KeyboardSlice {
  /** When Esc was last pressed with nothing of Margin's open. */
  escAt: number;
  /** When the annotation menu was last opened from the keyboard, so Chrome's contextmenu event after it is skipped. */
  keyMenuAt: number;
  keyDown(event: KeyboardEvent): void;
  keyUp(event: KeyboardEvent): void;
  openKeyMenu(): void;
  stepFocus(step: 1 | -1): void;
}

/**
 * Cancels a key so neither the browser nor the page acts on it.
 * @param event The key event.
 */
function stop(event: KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export const createKeyboardSlice: OverlaySlice<KeyboardSlice> = (set, get) => ({
  escAt: 0,
  keyMenuAt: 0,

  /**
   * The keys that work everywhere while annotating, caught at the window before the page sees them: holding Alt hands
   * the pointer to the page, Tab stays inside Margin, Shift+F10 and the menu key open the annotation menu, and Esc
   * steps back. With nothing of Margin's open, Esc pressed twice stops annotating, and an Esc meant for the page, with
   * a page dialog or field open or handled by the page, never does. The single-letter shortcuts live on the overlay
   * root with react-hotkeys-hook, and get the key handed over when focus is on the page outside a field.
   */
  keyDown(event) {
    const host = currentHost();
    if (!host) return;
    if (event.key === 'Alt') {
      event.preventDefault();
      get().setPassing(true);
      return;
    }
    const inOverlay = host.contains(event);
    const pageField = !inOverlay && (isEditable(document.activeElement) || isEditable(event.composedPath()[0]));
    const modified = event.ctrlKey || event.metaKey || event.altKey;
    const { menu, card, pending } = get();
    if (event.key === 'Tab' && !modified && !pageField && !menu) {
      stop(event);
      get().stepFocus(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      stop(event);
      get().openKeyMenu();
      return;
    }
    if (event.key === 'Escape') {
      if (!menu && !card && !pending) {
        if (pageField || host.pageLayerOpen()) return;
        addEventListener('keydown', (after) => after === event && !event.defaultPrevented && escapeToStop(), { once: true });
        return;
      }
      stop(event);
      if (menu) get().closeMenu();
      else if (card) get().stepBack();
      else get().cancelRedraw();
      return;
    }
    const zUndo = event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey) && !event.altKey;
    if (!inOverlay && !pageField && SHORTCUT_KEYS.has(event.key.toLowerCase()) && (zUndo || !modified)) host.replayKey(event);

    /** Stops annotating on the second Esc within a moment, and says so after the first. */
    function escapeToStop() {
      const now = performance.now();
      if (now - get().escAt < DOUBLE_ESC) {
        set({ escAt: 0 });
        void get().setActive(false);
        return;
      }
      set({ escAt: now });
      toast('Press Esc again to stop annotating', { duration: DOUBLE_ESC });
    }
  },

  /** Ends the Alt hold on release. The release is cancelled so Chrome does not move focus to its menu. */
  keyUp(event) {
    if (event.key !== 'Alt') return;
    event.preventDefault();
    get().setPassing(false);
  },

  /** Opens the annotation menu from the keyboard, at the focused page element or else the middle of the view. */
  openKeyMenu() {
    set({ keyMenuAt: performance.now() });
    if (get().card) {
      get().holdCard();
      return;
    }
    const focused = document.activeElement;
    const box = focused && focused !== currentHost()?.host && focused !== document.body && focused !== document.documentElement ? focused.getBoundingClientRect() : null;
    const visible = box && box.width && box.bottom > 0 && box.top < innerHeight;
    if (visible) get().openMenuAt(box.left + Math.min(box.width / 2, 24), box.top + box.height / 2);
    else get().openMenuAt(innerWidth / 2, innerHeight / 2);
  },

  /**
   * Moves keyboard focus to the next or previous control, staying inside the open card or else the overlay, so Tab
   * never wanders into the page hidden under it.
   */
  stepFocus(step) {
    const shadow = currentHost()?.shadow;
    if (!shadow) return;
    const scope = shadow.querySelector(get().card ? '[data-margin-card]' : '[data-margin]');
    const items = [...(scope?.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]:not([tabindex="-1"])') ?? [])].filter(
      (item) => !item.matches(':disabled') && item.tabIndex >= 0 && item.getClientRects().length > 0,
    );
    if (!items.length) return;
    const at = items.indexOf(shadow.activeElement as HTMLElement);
    const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  },
});
