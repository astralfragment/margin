import { liveBox, mapBetween, type Point } from '../page/geometry';
import { currentHost } from '../page/host';
import { markerHistory, type OverlaySlice } from '.';
import type { MarkerDraft } from './types';

export interface MarkersSlice {
  /** The open card's numbered markers. Their positions are the undo history. */
  markers: MarkerDraft[];
  /** True after Add marker, until the next press inside the area places one. */
  placing: boolean;
  setPlacing(placing: boolean): void;
  addMarker(point: Point): void;
  removeMarker(index: number, fromCard?: boolean): void;
  setMarkerNote(index: number, note: string): void;
  undoMarker(): boolean;
}

/**
 * Focuses a marker's note in the card, or Add marker when there is none, once React has drawn it.
 * @param index The marker's position.
 */
function focusMarker(index: number) {
  requestAnimationFrame(() => {
    const shadow = currentHost()?.shadow;
    const target = shadow?.querySelector<HTMLElement>(`[data-marker-note="${index}"]`) ?? shadow?.querySelector<HTMLElement>('[data-add-marker]');
    target?.focus({ preventScroll: true });
  });
}

export const createMarkersSlice: OverlaySlice<MarkersSlice> = (set, get) => ({
  markers: [],
  placing: false,

  setPlacing(placing) {
    set({ placing });
  },

  /**
   * Drops the next numbered marker at a point inside the area and focuses its note. The point is stored in the
   * capture's viewport pixels, however far the page has scrolled since.
   */
  addMarker(point) {
    const { card, markers } = get();
    if (!card) return;
    const at = mapBetween(point, liveBox(card), card.rect);
    set({ markers: [...markers, { x: Math.round(at.x), y: Math.round(at.y), note: '' }], placing: false });
    focusMarker(markers.length);
  },

  /** Removes one marker and renumbers the rest. From the card, focus moves to the next marker's note. */
  removeMarker(index, fromCard = false) {
    set({ markers: get().markers.filter((_, at) => at !== index) });
    if (fromCard) focusMarker(Math.min(index, get().markers.length - 1));
  },

  setMarkerNote(index, note) {
    set({ markers: get().markers.map((marker, at) => (at === index ? { ...marker, note } : marker)) });
  },

  /** Takes back the last marker change, and says whether there was one. */
  undoMarker() {
    const history = markerHistory();
    if (!history.pastStates.length) return false;
    history.undo();
    return true;
  },
});
