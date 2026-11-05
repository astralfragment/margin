/**
 * The React overlay, loaded by content.js as an ES module the first time annotation starts on a page. It mounts once
 * into a closed shadow root and registers its API on window, in the content script's isolated world.
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import sonnerStyles from 'sonner/dist/styles.css?inline';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { OverlayApi } from './api';
import { App } from './components/App';
import { createOverlayHost, type OverlayHost } from './page/host';
import { queryClient, watchStorage } from './query';
import { overlayStore } from './store';
import overlayStyles from './overlay.css?inline';

const FONT_FAMILY = 'Margin Manrope';

/**
 * Registers Margin's bundled Manrope with the page under its own family name, so the shadow root can use it without
 * touching the page's fonts. Text shows at once in the fallback font and swaps to Manrope when it arrives.
 */
function loadFont() {
  for (const weight of [500, 600, 800]) {
    const face = new FontFace(FONT_FAMILY, `url("${chrome.runtime.getURL(`/fonts/manrope-latin-${weight}-normal.woff2`)}")`, { weight: String(weight), display: 'swap' });
    document.fonts.add(face);
    face.load().catch((error: unknown) => console.warn('Margin: a font did not load, so the overlay uses the system font', error));
  }
}

/** Mounts the overlay and returns its API. */
async function mount(): Promise<OverlayApi> {
  const context = new ContentScriptContext('margin-overlay');
  let host: OverlayHost | null = null;
  const ui = await createShadowRootUi(context, {
    name: 'margin-overlay',
    mode: 'closed',
    // WXT's own reset is `:host { all: initial !important }`, which beats the host's inline zoom. overlay.css resets
    // the host without !important instead.
    inheritStyles: true,
    position: 'inline',
    anchor: () => document.documentElement,
    css: `${sonnerStyles}\n${overlayStyles}`,
    onMount: (container, shadow, shadowHost) => {
      host = createOverlayHost(shadowHost, shadow, container);
      const root = createRoot(container);
      // A plain render is time-sliced and can still be running when the first press arrives on a busy machine.
      flushSync(() =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>,
        ),
      );
      const stopWatching = watchStorage();
      return () => {
        stopWatching();
        root.unmount();
      };
    },
  });
  ui.mount();
  loadFont();
  if (!host) throw new Error('The Margin overlay did not mount');
  const mounted: OverlayHost = host;
  context.onInvalidated(() => mounted.detach());
  return {
    setActive: (active, start) => overlayStore.getState().setActive(active, start),
    isActive: () => overlayStore.getState().active,
    setZoom: (zoom) => mounted.setZoom(zoom),
    toast: (text) => void toast(text, { duration: 4200 }),
    captureViewport: () => overlayStore.getState().captureViewport(),
    hideForCapture: (hidden) => mounted.hideForCapture(hidden),
  };
}

window.__marginOverlay ??= await mount();
