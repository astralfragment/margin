/**
 * The on-page overlay. The background injects it on demand as content.js, so wxt.config.ts builds it as an unlisted
 * script instead of declaring it in the manifest. A second injection into the same page does nothing.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { hideForCapture, setActive, start } from '@/components/overlay/controller';
import { container, createHost, loadFont } from '@/components/overlay/host';
import { Overlay } from '@/components/overlay/overlay';
import { getState } from '@/components/overlay/store';
import { queryClient, watchStorage } from '@/lib/query';

export default defineUnlistedScript(() => {
  if (window.__uiAnnotator) return;
  window.__uiAnnotator = { setActive, isActive: () => getState().active, hideForCapture };
  createHost();
  loadFont();
  watchStorage();
  start();
  createRoot(container).render(createElement(QueryClientProvider, { client: queryClient }, createElement(Overlay)));
});
