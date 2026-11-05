import type { OverlayStart } from '@/lib/overlay-protocol';

/** What the React overlay offers the small content script that loads it. */
export interface OverlayApi {
  /** Turns annotation on or off and resolves to whether it is on. */
  setActive(active: boolean, start?: Partial<OverlayStart>): Promise<boolean>;
  isActive(): boolean;
  setZoom(zoom: number): void;
  toast(text: string): void;
  captureViewport(): void;
  hideForCapture(hidden: boolean): void;
}

/** The hook the service worker and the old popup reach through chrome.scripting in the content script's world. */
export interface AnnotatorHook {
  setActive(active: boolean): Promise<boolean>;
  isActive(): boolean;
  hideForCapture(hidden: boolean): void;
}

declare global {
  interface Window {
    /** Set by content.js, which every injection checks so the overlay loads once per page. */
    __uiAnnotator?: AnnotatorHook;
    /** Set by overlay.js once its module has run. */
    __marginOverlay?: OverlayApi;
  }
}
