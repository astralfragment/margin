import type { Comment, Review } from '@/lib/model';
import { routeOf } from '@/lib/report-template.js';

/** Pages Chrome keeps closed to extensions: its own pages, blank tabs and the Web Store. */
const RESTRICTED = /^(chrome|edge|about|devtools|chrome-extension|view-source|data):|^https:\/\/chrome\.google\.com\/webstore|^https:\/\/chromewebstore\.google\.com/;

const NAME_MAX = 120;

/**
 * True when Margin may not run on a page.
 * @param url The page address.
 */
export const isRestricted = (url: string) => !url || RESTRICTED.test(url);

/**
 * The host of an address, or an empty string.
 * @param url The address.
 */
export function hostOf(url: string | undefined) {
  try {
    return new URL(url ?? '').host;
  } catch {
    return '';
  }
}

/**
 * True when two addresses are the same page, ignoring the query and hash.
 * @param first One address.
 * @param second The other.
 */
export function samePage(first: string | undefined, second: string | undefined) {
  try {
    const one = new URL(first ?? '');
    const other = new URL(second ?? '');
    return one.origin === other.origin && one.pathname === other.pathname;
  } catch {
    return false;
  }
}

/**
 * The short name of a page, such as Home or Pricing.
 * @param page The page address and title.
 */
export const pageName = (page: { url: string; title?: string }): string => routeOf(page).split(' > ').at(-1) ?? '';

/**
 * Cuts a page title to the review name limit at a word, so a long title never ends mid-word.
 * @param text The title.
 */
export function trimName(text: string) {
  const clean = text.trim();
  if (clean.length <= NAME_MAX) return clean;
  const cut = clean.slice(0, NAME_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > NAME_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:|-]+$/, '');
}

/**
 * A count with its word, such as 1 comment or 3 comments.
 * @param count How many.
 * @param word The singular word.
 */
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * A comment number padded to two digits, as the overlay and report show it.
 * @param number The number.
 */
export const padNumber = (number: number) => String(number).padStart(2, '0');

/**
 * True when a review was started on this site, was picked here, has comments here, or is empty and tied to no site.
 * @param review The review.
 * @param comments Its comments.
 * @param host The host of the open tab.
 */
export function belongsHere(review: Review, comments: Comment[], host: string) {
  if (!review.site && !comments.length) return true;
  return review.site === host || Boolean(review.pickedOn?.includes(host)) || comments.some((comment) => hostOf(comment.page?.url) === host);
}
