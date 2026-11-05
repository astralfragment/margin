import { storage } from 'wxt/utils/storage';

/*
 * The service worker's session keys. They live apart from lib/storage.ts because WXT reads an item as soon as it is
 * defined, and content scripts, which import lib/storage.ts for settings, are not allowed to read session storage.
 */

/** Tabs where annotation is on, so it comes back after the tab loads a new page. Cleared when the browser closes. */
export const annotatingTabsItem = storage.defineItem<number[]>('session:annotatingTabs', { fallback: [] });
/** A note per tab about a comment saved when its page went away, shown on the next page. */
export const annotatingNoticesItem = storage.defineItem<Record<number, string>>('session:annotatingNotices', { fallback: {} });
