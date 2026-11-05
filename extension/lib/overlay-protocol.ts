import { defineExtensionMessaging } from '@webext-core/messaging';
import type { Done } from './protocol';

/** What the overlay is told when annotation starts: the review's name for its bar and the tab's browser zoom. */
export interface OverlayStart {
  reviewName: string;
  zoom: number;
}

/**
 * The messages the service worker sends to the overlay in a tab. They are kept apart from ProtocolMap, which holds
 * what the service worker answers, so neither side ever registers a listener meant for the other.
 */
export interface OverlayProtocolMap {
  ping(): { ok: true; active: boolean };
  toggle(data: OverlayStart): { active: boolean };
  start(data: OverlayStart & { notice?: string }): { active: boolean };
  stop(): { active: boolean };
  zoom(data: { zoom: number }): Done;
  toast(data: { text: string }): Done;
  captureViewport(data: OverlayStart): { active: boolean };
}

export type OverlayMessageName = keyof OverlayProtocolMap;

export const { sendMessage: sendToOverlay, onMessage: onOverlayMessage } = defineExtensionMessaging<OverlayProtocolMap>();
