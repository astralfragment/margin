import { toast } from 'sonner';
import type { Review } from '@/lib/model';
import { sendMessage } from '@/lib/protocol';
import { padNumber } from './page';
import { usePopup } from './store';

const UNDO_MS = 5000;

/** Deletes waiting for their Undo to run out, by comment id. */
const removeLater = new Map<string, () => void>();

/**
 * Opens one of Margin's pages in a new tab and closes the popup.
 * @param path The page and its query, such as report.html?group=all.
 */
function openPage(path: string) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  window.close();
}

/**
 * Opens the report on a review, at one comment when one is named.
 * @param reviewId The review.
 * @param commentId The comment to scroll to.
 */
export function openReport(reviewId: string, commentId?: string) {
  const query = new URLSearchParams({ group: reviewId, ...(commentId ? { comment: commentId } : {}) });
  openPage(`report.html?${query}`);
}

/** Opens the report on every review. */
export const openAllReviews = () => openPage('report.html?group=all');

/** Opens the welcome tour. */
export const openWelcome = () => openPage('welcome.html');

/**
 * Opens Help and settings, at a service's Connect button when one is named.
 * @param service The service to connect.
 */
export function openSettings(service?: 'jira' | 'figma') {
  if (service) openPage(`options.html#connect-${service}`);
  else {
    chrome.runtime.openOptionsPage();
    window.close();
  }
}

/**
 * Opens a web address in a new tab and closes the popup.
 * @param url The address.
 */
export function openUrl(url: string) {
  chrome.tabs.create({ url });
  window.close();
}

/**
 * Turns annotation on or off on the open tab and closes the popup. A failure stays in the popup, in plain words.
 * @param tabUrl The tab's address, to tell a page that refuses extensions from one that needs a reload.
 */
export async function toggleAnnotating(tabUrl: string) {
  try {
    await sendMessage('toggle', undefined);
    window.close();
  } catch (error) {
    const refused = /cannot be scripted|cannot access|not allow|gallery/i.test(String(error)) || tabUrl.startsWith('file:');
    usePopup
      .getState()
      .setStartError(refused ? 'This page does not let extensions run. Try another page on the site.' : 'Margin could not start here. Reload the page, then try again.');
  }
}

/**
 * Makes a review the one new comments go to. A review picked on a site it was not made on is offered there from then on.
 * @param review The review.
 * @param host The host of the open tab.
 * @param shownHere Whether the popup already offers the review on this site.
 */
export async function pickReview(review: Review, host: string, shownHere: boolean) {
  usePopup.setState({ width: null });
  await sendMessage('selectReview', review.id);
  if (host && !shownHere) await sendMessage('patchReview', { id: review.id, patch: { pickedOn: [...(review.pickedOn ?? []), host] } });
}

/**
 * Deletes a comment after five seconds, with Undo on offer until then. The row goes at once. Closing the popup in
 * those seconds deletes it straight away, so nothing deleted comes back.
 * @param id The comment.
 * @param number Its number in the review.
 */
export function deleteComment(id: string, number: number) {
  const { hideComment, showComment } = usePopup.getState();
  hideComment(id);
  let undone = false;
  const remove = () => {
    if (undone || !usePopup.getState().hiddenIds.includes(id)) return;
    removeLater.delete(id);
    sendMessage('removeComment', id)
      .catch((error) => toast.error(`Comment ${padNumber(number)} could not be deleted. ${String(error)}`))
      .finally(() => showComment(id));
  };
  removeLater.set(id, remove);
  toast(`Comment ${padNumber(number)} deleted`, {
    duration: UNDO_MS,
    action: {
      label: 'Undo',
      onClick: () => {
        undone = true;
        removeLater.delete(id);
        showComment(id);
      },
    },
    onAutoClose: remove,
    onDismiss: remove,
  });
}

/** Runs every waiting delete when the popup closes, since its timers stop with it. */
export function flushDeletesOnClose() {
  addEventListener('pagehide', () => removeLater.forEach((remove) => remove()));
}

