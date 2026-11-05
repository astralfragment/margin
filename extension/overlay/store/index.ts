import { createStore, useStore, type StateCreator } from 'zustand';
import { temporal } from 'zundo';
import { createCaptureSlice, type CaptureSlice } from './capture';
import { createComposerSlice, type ComposerSlice } from './composer';
import { createKeyboardSlice, type KeyboardSlice } from './keyboard';
import { createMarkersSlice, type MarkersSlice } from './markers';

export type OverlayState = CaptureSlice & ComposerSlice & MarkersSlice & KeyboardSlice;

/** One part of the overlay store. Each slice reads the others through `get`. */
export type OverlaySlice<Slice> = StateCreator<OverlayState, [['temporal', unknown]], [], Slice>;

/**
 * True when two states place the same markers, so typing a marker's note never becomes an undo step.
 * @param before One state.
 * @param after The other.
 */
const samePlaces = (before: Pick<OverlayState, 'markers'>, after: Pick<OverlayState, 'markers'>) =>
  before.markers.length === after.markers.length &&
  before.markers.every((marker, index) => marker.x === after.markers[index]?.x && marker.y === after.markers[index]?.y);

/** All of the overlay's state. Undo history covers the markers only. Page code and handlers read it with getState. */
export const overlayStore = createStore<OverlayState>()(
  temporal(
    (...args) => ({
      ...createCaptureSlice(...args),
      ...createComposerSlice(...args),
      ...createMarkersSlice(...args),
      ...createKeyboardSlice(...args),
    }),
    { partialize: (state) => ({ markers: state.markers }), equality: samePlaces, limit: 100 },
  ),
);

/**
 * Reads part of the overlay's state in a component, which redraws when that part changes.
 * @param selector Picks the part.
 */
export function useOverlay<Selected>(selector: (state: OverlayState) => Selected) {
  return useStore(overlayStore, selector);
}

/** The markers' undo history, for the slices that clear it and step back through it. */
export const markerHistory = () => overlayStore.temporal.getState();
