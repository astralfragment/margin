import css from './overlay.css?inline';
import { getState, setState } from './store';

/** The family name Margin's Inter is registered under, so it never replaces an Inter the page loads itself. */
const FONT = 'Margin Inter';

/**
 * Adapts the Tailwind build to a shadow root on someone else's page. Tokens move from :root to the shadow host and
 * the themed element, so tokens mixed from the accent follow data-accent there, rem becomes px so the page's root font size cannot resize Margin, and the fallback for
 * registered custom properties always applies, since @property is ignored inside a shadow root.
 */
function shadowCss(source: string) {
  return source
    .replace(/@font-face\{[^}]*\}/g, '')
    .replace(/@layer properties\{@supports [^{]+\{/, '@layer properties{@media all{')
    .replace(/:root\[data-theme=["']?dark["']?\]/g, '[data-theme=dark]')
    .replace(/:root/g, ':host,[data-theme]')
    .replace(/(?<![\w\\.-])(?<!\\[\s\S])(-?\d*\.?\d+)rem\b/g, (_, n: string) => `${+(Number(n) * 16).toFixed(3)}px`)
    .replace(/Inter,/g, `"${FONT}",Inter,`);
}

/** Inline styles the page cannot override, so its own rules for custom elements or `*` never move or paint the host. */
const HOST_STYLE: Record<string, string> = {
  all: 'initial',
  display: 'block',
  position: 'fixed',
  inset: '0',
  width: 'auto',
  height: 'auto',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'transparent',
  'box-shadow': 'none',
  outline: 'none',
  opacity: '1',
  visibility: 'visible',
  transform: 'none',
  filter: 'none',
  'clip-path': 'none',
  overflow: 'visible',
  'z-index': '2147483647',
};

export let host: HTMLElement;
export let shadow: ShadowRoot;
/** Where React renders. It covers the view, and its size is the overlay's own viewport. */
export let container: HTMLDivElement;

/** Builds the host element, its closed shadow root with Margin's styles, and the element React renders into. */
export function createHost() {
  host = document.createElement('margin-overlay');
  for (const [name, value] of Object.entries(HOST_STYLE)) host.style.setProperty(name, value, 'important');
  host.setAttribute('popover', 'manual');
  shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = shadowCss(css);
  container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;';
  shadow.append(style, container);
}

/** Sets one of the host's guarded inline styles. */
export const hostStyle = (name: string, value: string) => host.style.setProperty(name, value || HOST_STYLE[name] || '', 'important');

/**
 * Registers Margin's bundled Inter with the page under its own family name, since @font-face does nothing inside a
 * shadow root. Text shows at once in the fallback font and swaps when the font arrives.
 */
export function loadFont() {
  if (!document.fonts || typeof FontFace !== 'function') return;
  try {
    const url = chrome.runtime.getURL('/fonts/inter-latin-wght-normal.woff2');
    const face = new FontFace(FONT, `url("${url}")`, { weight: '100 900', display: 'swap' });
    document.fonts.add(face);
    face.load().catch(() => {});
  } catch {
    // Pages with a strict font policy keep the fallback font.
  }
}

/**
 * Finds elements matching a selector in the document and in every open shadow root, where components such as the MDN
 * search keep their dialogs.
 */
export function deepAll(selector: string) {
  const found: Element[] = [];
  const search = (scope: Document | ShadowRoot) => {
    found.push(...scope.querySelectorAll(selector));
    for (const el of scope.querySelectorAll('*')) if (el.shadowRoot && el !== host) search(el.shadowRoot);
  };
  search(document);
  return found;
}

let tabZoom = 1;

/**
 * Keeps the overlay at its own size when the page's zoom changes.
 * @param zoom The tab zoom factor.
 */
export const setTabZoom = (zoom: number) => {
  tabZoom = zoom || 1;
};

/**
 * Cancels the CSS zoom the overlay inherits from the page and the tab's browser zoom, so the overlay keeps the same
 * physical size on every page. While browser zoom is countered, one overlay pixel is `scale` page pixels.
 */
export function fitZoom() {
  const parent = host.parentElement ?? document.documentElement;
  const zoom = parent.currentCSSZoom ?? (Number(getComputedStyle(parent).zoom) || 1);
  const scale = tabZoom > 0 ? 1 / tabZoom : 1;
  const own = scale / (zoom > 0 ? zoom : 1);
  host.style.setProperty('zoom', own !== 1 ? String(own) : '1', 'important');
  if (getState().scale !== scale) setState({ scale });
}

let holder: Element | null = null;
let rescues = 0;

/** Raises the overlay again once the dialog holding it closes, since a closed dialog hides everything inside it. */
const raiseAgain = () => getState().active && raise();

let hostWatch: MutationObserver | undefined;

/**
 * Puts the overlay back above everything on the page. It goes back into the document if the page removed it, and into
 * the open modal dialog when there is one, because a modal dialog makes everything outside it inert. Hiding and
 * showing the popover again makes it the newest top layer entry. Focus inside the overlay is kept.
 */
function raise() {
  const focused = shadow.activeElement as HTMLElement | null;
  const modal = deepAll('dialog:modal').at(-1) ?? null;
  const parent = modal ?? document.documentElement;
  if (host.parentNode !== parent) parent.append(host);
  if (holder !== modal) {
    holder?.removeEventListener('close', raiseAgain);
    modal?.addEventListener('close', raiseAgain);
    holder = modal;
  }
  if (host.matches(':popover-open')) host.hidePopover();
  host.showPopover?.();
  hostWatch ??= new MutationObserver(() => {
    if (!getState().active || host.isConnected || rescues > 2) return;
    if (!rescues) requestAnimationFrame(() => (rescues = 0));
    rescues++;
    raise();
  });
  hostWatch.disconnect();
  for (let node: Node | null = host.parentNode; node; node = node.parentNode ?? (node as ShadowRoot).host ?? null) {
    hostWatch.observe(node, { childList: true });
  }
  if (focused && shadow.activeElement !== focused) focused.focus({ preventScroll: true });
  fitZoom();
}

let openWatch: MutationObserver | undefined;

/**
 * Raises the overlay again when the page opens a popover or dialog of its own, changes fullscreen, closes the dialog
 * the overlay sits in, or hides the overlay. Focus moving into a modal dialog inside a component's shadow root raises
 * it too. A re-raise of another overlay shows as open to open and is ignored, so two overlays never take turns forever.
 */
function onLayer(e: Event) {
  const toggle = e as ToggleEvent;
  if (e.target === host) {
    if (toggle.newState === 'closed' && getState().active) raise();
    return;
  }
  if (e.type === 'focusin') {
    const modal = deepAll('dialog:modal').at(-1);
    if (modal && host.parentNode !== modal) raise();
    return;
  }
  const opened = e.type === 'toggle' && toggle.oldState === 'closed' && toggle.newState === 'open';
  const holding = e.target instanceof Element && e.target.contains(host);
  if (opened || holding || e.type === 'fullscreenchange') raise();
}

const COPIED = ['clientX', 'clientY', 'screenX', 'screenY', 'button', 'buttons', 'detail', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'pointerId', 'pointerType', 'isPrimary'] as const;

/** Dispatches a copy of a mouse event inside the shadow root, where it cannot reach the page. */
function replay(e: MouseEvent, inner: Element) {
  const init: Record<string, unknown> = { bubbles: e.bubbles, cancelable: e.cancelable, composed: false };
  for (const key of COPIED) if (key in e) init[key] = e[key as keyof MouseEvent];
  const copy = new (e.constructor as typeof MouseEvent)(e.type, init);
  inner.dispatchEvent(copy);
  if (copy.defaultPrevented) e.preventDefault();
}

/**
 * Keeps presses on the overlay away from the page, so its click-outside and blur handlers never fire.
 * The press is stopped at the window, then a copy that cannot leave the shadow root is replayed on the element under the
 * pointer, or on the focused element when the click came from the keyboard. A real press that reached the page instead
 * went through the overlay, so it is cancelled, the overlay is raised again, and the copy goes to the overlay itself.
 */
function shield(e: Event) {
  if (getState().passing) return;
  const scale = getState().scale;
  if (e.target !== host) {
    if (!e.isTrusted || (e instanceof MouseEvent && (e.clientX >= container.clientWidth * scale || e.clientY >= container.clientHeight * scale))) return;
    e.stopImmediatePropagation();
    if (e.cancelable && !/^(pointer|touch)/.test(e.type)) e.preventDefault();
    raise();
    if (e instanceof MouseEvent) replay(e, shadow.elementFromPoint(e.clientX, e.clientY) ?? container);
    return;
  }
  e.stopImmediatePropagation();
  if (!(e instanceof MouseEvent)) return;
  const fromKeyboard = e.type === 'click' && e.detail === 0 && shadow.activeElement;
  const inner = fromKeyboard ? shadow.activeElement : shadow.elementFromPoint(e.clientX, e.clientY);
  if (inner && shadow.contains(inner)) replay(e, inner);
}

const SHIELDED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend'];
const LAYERED = ['toggle', 'close', 'fullscreenchange', 'focusin'];

/** Shows the host above the page and starts guarding it, or takes it off the page. */
export function attachHost(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  for (const type of SHIELDED) window[method](type, shield, true);
  for (const type of LAYERED) window[method](type, onLayer, true);
  if (on) {
    raise();
    openWatch ??= new MutationObserver((records) => {
      if (records.some((r) => r.target !== host && (r.target as Element).hasAttribute('open'))) raise();
    });
    openWatch.observe(document, { subtree: true, attributes: true, attributeFilter: ['open'] });
    return;
  }
  openWatch?.disconnect();
  hostWatch?.disconnect();
  holder?.removeEventListener('close', raiseAgain);
  holder = null;
  host.remove();
}
