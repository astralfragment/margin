import { onMessage, type MessageData, type MessageReply, type StoreWriteName } from './protocol';
import {
  addComment,
  addReview,
  clearComments,
  patchComment,
  patchReview,
  removeComment,
  removeReview,
  saveComments,
  queueWrite,
  selectReview,
  writeImages,
  writeScreenshot,
} from './review-store';
import { markerModeItem, selectorModeItem } from './storage';

/**
 * Saves the overlay's switches that were sent, leaving the other as it is.
 * @param modes The switches to save.
 */
function saveOverlayModes({ selectorMode, markerMode }: { selectorMode?: boolean; markerMode?: boolean }) {
  return queueWrite(async () => {
    if (selectorMode !== undefined) await selectorModeItem.setValue(selectorMode);
    if (markerMode !== undefined) await markerModeItem.setValue(markerMode);
  });
}

type StoreWriteHandlers = { [Name in StoreWriteName]: (data: MessageData<Name>) => Promise<MessageReply<Name>> };

/** Runs each store write a page sends. Every one of them goes through the write queue in lib/review-store.ts. */
const storeWriteHandlers: StoreWriteHandlers = {
  saveComments: (comments) => saveComments(comments),
  addComment: (comment) => addComment(comment),
  patchComment: ({ id, patch }) => patchComment(id, patch),
  removeComment: (id) => removeComment(id),
  clearComments: () => clearComments(),
  writeImages: ({ id, images }) => writeImages(id, images),
  writeScreenshot: ({ id, screenshot }) => writeScreenshot(id, screenshot),
  addReview: (name) => addReview(name),
  patchReview: ({ id, patch }) => patchReview(id, patch),
  removeReview: (id) => removeReview(id),
  selectReview: (id) => selectReview(id),
  saveOverlayModes: (modes) => saveOverlayModes(modes),
};

/**
 * Answers one store write message.
 * @param name The message name.
 */
function serveStoreWrite<Name extends StoreWriteName>(name: Name) {
  onMessage(name, ({ data }) => storeWriteHandlers[name](data));
}

/** Makes this context the single writer, answering the store writes pages send. Only the service worker calls it. */
export function serveStoreWrites() {
  (Object.keys(storeWriteHandlers) as StoreWriteName[]).forEach(serveStoreWrite);
}
