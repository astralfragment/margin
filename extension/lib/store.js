import * as reviewStore from './review-store.ts';
import { sendMessage } from './protocol.ts';

/**
 * The store as the older screens call it, with their names. Reads go straight to storage. Writes run in the service
 * worker, which queues every write, so a page never overwrites what another page or the worker saved a moment before.
 */

const inWorker = typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope;

export const readIssues = reviewStore.readComments;
export const readImages = reviewStore.readImages;
export const hydrate = reviewStore.withImages;
export const readRaw = reviewStore.readScreenshot;
export const readGroups = reviewStore.readReviews;
export const issuesInGroup = reviewStore.commentsInReview;

/**
 * Replaces the whole comment list.
 * @param {object[]} issues The comments to store.
 */
export const writeIssues = (issues) => (inWorker ? reviewStore.saveComments(issues) : sendMessage('saveComments', issues));

/**
 * Drops one comment with its images and clean screenshot.
 * @param {string} id The comment id.
 */
export const removeIssue = (id) => (inWorker ? reviewStore.removeComment(id) : sendMessage('removeComment', id));

/**
 * Merges image fields into one comment's stored images. A field set to null removes that image.
 * @param {string} id The comment id.
 * @param {object} images Image fields to change.
 */
export const writeImages = (id, images) => (inWorker ? reviewStore.writeImages(id, images) : sendMessage('writeImages', { id, images }));

/**
 * Stores a comment's clean screenshot.
 * @param {string} id The comment id.
 * @param {{ src: string, hasBox: boolean }} screenshot The screenshot.
 */
export const writeRaw = (id, screenshot) => (inWorker ? reviewStore.writeScreenshot(id, screenshot) : sendMessage('writeScreenshot', { id, screenshot }));

/**
 * Creates a review and makes it the one new comments go to.
 * @param {string} [name] The name.
 */
export const addGroup = (name) => (inWorker ? reviewStore.addReview(name) : sendMessage('addReview', name ?? null));

/**
 * Merges a patch into one review, returning it or null when it is gone.
 * @param {string} id The review id.
 * @param {object} patch Fields to change.
 */
export const patchGroup = (id, patch) => (inWorker ? reviewStore.patchReview(id, patch) : sendMessage('patchReview', { id, patch }));

/**
 * Makes a review the one new comments go to.
 * @param {string} id The review id.
 */
export const setActiveGroup = (id) => (inWorker ? reviewStore.selectReview(id) : sendMessage('selectReview', id));
