import { elementAt } from './pick';
import { setHostElement } from './host-element';
import { touchLayout } from './geometry';

const SHIELDED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend'];
const LAYERED = ['toggle', 'close', 'fullscreenchange', 'focusin'];
const COPIED_MOUSE = ['clientX', 'clientY', 'screenX', 'screenY', 'button', 'buttons', 'detail', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'pointerId', 'pointerType', 'isPrimary'] as const;
const COPIED_KEY = ['key', 'code', 'location', 'repeat', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey'] as const;

/** What the page tells the overlay while annotation is on. */
export interface PageListeners {
  /** A pointer move that landed on the page around the overlay rather than on it. */
  strayMove(event: MouseEvent): void;
  keyDown(event: KeyboardEvent): void;
  keyUp(event: KeyboardEvent): void;
  /** The window lost focus, so a held Alt will never be released. */
  blur(): void;
  /** The page is going away. */
  leave(): void;
}

let current: OverlayHost | null = null;

/** The overlay's host once it is mounted, for store actions that reach the page. */
export const currentHost = () => current;

/**
 * Makes the element holding the overlay's shadow root its host.
 * @param host The element holding the shadow root.
 * @param shadow The overlay's shadow root.
 * @param root The element inside it that presses are replayed onto until React draws the overlay's own root.
 */
export function createOverlayHost(host: HTMLElement, shadow: ShadowRoot, root: HTMLElement) {
  current = new OverlayHost(host, shadow, root);
  return current;
}

/**
 * True when a scroll container has room to scroll further in a direction.
 * @param overflow Its computed overflow on that axis.
 * @param position How far it is scrolled.
 * @param size Its visible size.
 * @param full Its scrollable size.
 * @param delta Which way the wheel turned.
 */
const hasRoom = (overflow: string, position: number, size: number, full: number, delta: number) =>
  delta !== 0 && /auto|scroll|overlay/.test(overflow) && (delta > 0 ? position + size < full - 1 : position > 0);

/**
 * Finds elements matching a selector in the document and in every open shadow root, where components such as the MDN
 * search keep their dialogs.
 * @param selector A CSS selector.
 * @param skip An element whose shadow root is left out.
 */
export function deepAll(selector: string, skip?: Element | null) {
  const found: Element[] = [];
  const search = (scope: Document | ShadowRoot) => {
    found.push(...scope.querySelectorAll(selector));
    for (const element of scope.querySelectorAll('*')) if (element.shadowRoot && element !== skip) search(element.shadowRoot);
  };
  search(document);
  return found;
}

/**
 * The element that holds the overlay's shadow root, and everything that keeps it above the page and keeps the page
 * from reacting to presses on it.
 */
export class OverlayHost {
  /** Page pixels per overlay pixel. Browser zoom is countered, so at 125% one overlay pixel is 0.8 page pixels. */
  scale = 1;
  private tabZoom = 1;
  private passing = false;
  private holder: HTMLDialogElement | null = null;
  private rescues = 0;
  private listening: AbortController | null = null;
  private readonly hostWatch = new MutationObserver(() => this.rescue());
  private readonly openWatch = new MutationObserver((records) => {
    if (records.some((record) => record.target !== this.host && record.target instanceof Element && record.target.hasAttribute('open'))) this.raise();
  });

  /**
   * @param host The element holding the shadow root.
   * @param shadow The overlay's shadow root.
   * @param root The overlay's root element inside it, which presses are replayed onto.
   */
  constructor(
    readonly host: HTMLElement,
    readonly shadow: ShadowRoot,
    private root: HTMLElement,
  ) {
    host.setAttribute('popover', 'manual');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;margin:0;padding:0;border:0;background:transparent;overflow:visible;width:100vw;height:100vh;';
    setHostElement(host);
  }

  /**
   * Moves press replays to a new root element, as when React renders the overlay's root again.
   * @param root The overlay's root element.
   */
  setRoot(root: HTMLElement) {
    this.root = root;
  }

  /**
   * Starts listening to the page and shows the overlay above it.
   * @param listeners What the overlay does with page events.
   */
  attach(listeners: PageListeners) {
    this.listening?.abort();
    const listening = new AbortController();
    this.listening = listening;
    const { signal } = listening;
    for (const type of SHIELDED) addEventListener(type, this.shield, { capture: true, signal });
    for (const type of LAYERED) addEventListener(type, this.onLayer, { capture: true, signal });
    addEventListener('mousemove', (event) => event.target !== this.host && event.isTrusted && !this.passing && listeners.strayMove(event), { capture: true, signal });
    addEventListener('keydown', listeners.keyDown, { capture: true, signal });
    addEventListener('keyup', listeners.keyUp, { capture: true, signal });
    addEventListener('blur', listeners.blur, { signal });
    addEventListener('pagehide', listeners.leave, { signal });
    addEventListener('resize', () => this.fitZoom(), { signal });
    this.root.addEventListener('wheel', this.onWheel, { passive: false, signal });
    this.openWatch.observe(document, { subtree: true, attributes: true, attributeFilter: ['open'] });
    this.raise();
  }

  /** Stops listening to the page and takes the overlay off it. */
  detach() {
    this.listening?.abort();
    this.listening = null;
    this.openWatch.disconnect();
    this.hostWatch.disconnect();
    this.holder?.removeEventListener('close', this.raiseAgain);
    this.holder = null;
    this.setPassThrough(false);
    this.host.remove();
  }

  /**
   * Hides the overlay while a screenshot is taken, so it stays out of the image.
   * @param hidden True to hide it.
   */
  hideForCapture(hidden: boolean) {
    this.host.style.visibility = hidden ? 'hidden' : '';
  }

  /**
   * Hands the pointer to the page while Alt is held, so hover states, menus and inner scrolling work.
   * @param passing Whether the page gets the pointer.
   */
  setPassThrough(passing: boolean) {
    this.passing = passing;
    this.host.style.pointerEvents = passing ? 'none' : '';
  }

  /**
   * Applies the tab's browser zoom.
   * @param tabZoom The zoom factor, 1 at 100%.
   */
  setZoom(tabZoom: number) {
    this.tabZoom = tabZoom > 0 ? tabZoom : 1;
    this.fitZoom();
  }

  /**
   * Cancels the CSS zoom the overlay inherits from the page and the tab's browser zoom, so the overlay keeps the same
   * physical size on every page.
   */
  fitZoom() {
    const parent = this.host.parentElement ?? document.documentElement;
    const inherited = parent.currentCSSZoom ?? (Number(getComputedStyle(parent).zoom) || 1);
    this.scale = 1 / this.tabZoom;
    const own = this.scale / (inherited > 0 ? inherited : 1);
    this.host.style.zoom = own !== 1 ? String(own) : '';
    touchLayout();
  }

  /**
   * Puts the overlay back above everything on the page. It goes back into the document if the page removed it, and into
   * the open modal dialog when there is one, because a modal dialog makes everything outside it inert. Hiding and
   * showing the popover again makes it the newest top layer entry. Focus inside the overlay is kept.
   */
  raise = () => {
    const focused = this.shadow.activeElement;
    const modal = (deepAll('dialog:modal', this.host).at(-1) as HTMLDialogElement | undefined) ?? null;
    const parent = modal ?? document.documentElement;
    if (this.host.parentNode !== parent) parent.append(this.host);
    if (this.holder !== modal) {
      this.holder?.removeEventListener('close', this.raiseAgain);
      modal?.addEventListener('close', this.raiseAgain);
      this.holder = modal;
    }
    if (this.host.matches(':popover-open')) this.host.hidePopover();
    this.host.showPopover();
    this.hostWatch.disconnect();
    for (let node: Node | null = this.host.parentNode; node; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
      this.hostWatch.observe(node, { childList: true });
    }
    if (focused instanceof HTMLElement && this.shadow.activeElement !== focused) focused.focus({ preventScroll: true });
    this.fitZoom();
  };

  /** Raises the overlay again once the dialog holding it closes, since a closed dialog hides everything inside it. */
  private raiseAgain = () => {
    if (this.listening) this.raise();
  };

  /** Puts the overlay back when the page removes it, at most a few times per frame so two overlays never fight. */
  private rescue() {
    if (!this.listening || this.host.isConnected || this.rescues > 2) return;
    if (!this.rescues) requestAnimationFrame(() => (this.rescues = 0));
    this.rescues += 1;
    this.raise();
  }

  /** True when the page has its own modal dialog, popover or fullscreen element open, which Esc should close first. */
  pageLayerOpen() {
    return Boolean(document.fullscreenElement) || deepAll('dialog:modal, :popover-open', this.host).some((element) => element !== this.host);
  }

  /**
   * True when an event happened inside the overlay.
   * @param event The event.
   */
  contains(event: Event) {
    return event.composedPath().includes(this.host);
  }

  /**
   * Raises the overlay again when the page opens a popover or dialog of its own, changes fullscreen, closes the dialog
   * the overlay sits in, or hides the overlay. Focus moving into a modal dialog inside a component's shadow root, whose
   * own toggle events never leave it, raises it too.
   * @param event A toggle, close, fullscreenchange or focusin event caught at the window.
   */
  private onLayer = (event: Event) => {
    if (event.target === this.host) {
      if (event instanceof ToggleEvent && event.newState === 'closed' && this.listening) this.raise();
      return;
    }
    if (event.type === 'focusin') {
      const modal = deepAll('dialog:modal', this.host).at(-1);
      if (modal && this.host.parentNode !== modal) this.raise();
      return;
    }
    const opened = event instanceof ToggleEvent && event.oldState === 'closed' && event.newState === 'open';
    const holding = event.target instanceof Element && event.target.contains(this.host);
    if (opened || holding || event.type === 'fullscreenchange') this.raise();
  };

  /**
   * Keeps presses on the overlay away from the page, so its click-outside and blur handlers never fire. The press is
   * stopped at the window, then a copy that cannot leave the shadow root is replayed on the element under the pointer,
   * or on the focused element when the click came from the keyboard. A real press that reached the page instead went
   * through the overlay, so it is cancelled, the overlay is raised again, and the copy goes to the overlay root.
   * @param event A press event caught at the window during the capture phase.
   */
  private shield = (event: Event) => {
    if (this.passing) return;
    if (event.target !== this.host) {
      const outside = event instanceof MouseEvent && (event.clientX >= this.root.clientWidth * this.scale || event.clientY >= this.root.clientHeight * this.scale);
      if (!event.isTrusted || outside) return;
      event.stopImmediatePropagation();
      if (event.cancelable && !/^(pointer|touch)/.test(event.type)) event.preventDefault();
      this.raise();
      if (event instanceof MouseEvent) this.replay(event, this.root);
      return;
    }
    event.stopImmediatePropagation();
    if (!(event instanceof MouseEvent)) return;
    const fromKeyboard = event.type === 'click' && event.detail === 0 && this.shadow.activeElement;
    const inner = fromKeyboard ? this.shadow.activeElement : this.shadow.elementFromPoint(event.clientX, event.clientY);
    if (inner && this.shadow.contains(inner)) this.replay(event, inner);
  };

  /**
   * Dispatches a copy of a mouse event inside the shadow root, where it cannot reach the page.
   * @param event The original event.
   * @param inner The overlay element that receives the copy.
   */
  private replay(event: MouseEvent, inner: Element) {
    const init: Record<string, unknown> = { bubbles: event.bubbles, cancelable: event.cancelable, composed: false };
    for (const key of COPIED_MOUSE) if (key in event) init[key] = event[key as keyof MouseEvent];
    const EventType = event.constructor as typeof MouseEvent;
    const copy = new EventType(event.type, init);
    inner.dispatchEvent(copy);
    if (copy.defaultPrevented) event.preventDefault();
  }

  /**
   * Hands a key pressed while focus is on the page to the overlay, whose shortcuts listen on its root. The page never
   * sees it, the same as a press on the overlay.
   * @param event A keydown caught at the window.
   */
  replayKey(event: KeyboardEvent) {
    event.stopImmediatePropagation();
    this.root.focus({ preventScroll: true });
    const init: Record<string, unknown> = { bubbles: true, cancelable: true, composed: false };
    for (const key of COPIED_KEY) init[key] = event[key];
    const copy = new KeyboardEvent(event.type, init);
    this.root.dispatchEvent(copy);
    if (copy.defaultPrevented) event.preventDefault();
  }

  /**
   * Scrolls the scrollable page element under the pointer. The overlay covers the page, so without this every wheel
   * scrolls the document and inner panels never move.
   * @param event A wheel event on the overlay.
   */
  private onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return;
    if (event.target instanceof Element && event.target.closest('[data-margin-float]')) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;
    const top = document.scrollingElement;
    for (let element = elementAt(event.clientX, event.clientY); element && element !== top && element !== document.body; element = element.parentElement) {
      const style = getComputedStyle(element);
      const canY = hasRoom(style.overflowY, element.scrollTop, element.clientHeight, element.scrollHeight, dy);
      const canX = hasRoom(style.overflowX, element.scrollLeft, element.clientWidth, element.scrollWidth, dx);
      if (canY || canX) {
        event.preventDefault();
        element.scrollBy({ left: canX ? dx : 0, top: canY ? dy : 0 });
        return;
      }
    }
  };
}
