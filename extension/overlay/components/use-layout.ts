import { useSyncExternalStore } from 'react';
import { layoutSnapshot, subscribeLayout } from '../page/geometry';
import { currentHost } from '../page/host';

/**
 * Redraws the caller whenever the page scrolls, resizes or zooms, and returns a converter from page pixels, as events
 * and element boxes measure them, to the overlay's own pixels.
 */
export function useLayout() {
  useSyncExternalStore(subscribeLayout, layoutSnapshot);
  const scale = currentHost()?.scale ?? 1;
  return { scale, toOverlay: (value: number) => value / scale };
}
