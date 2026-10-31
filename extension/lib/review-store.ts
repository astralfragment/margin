import { storage, type StorageItemKey } from 'wxt/utils/storage';
import {
  IMAGE_FIELDS,
  type Comment,
  type CommentImages,
  type CommentPatch,
  type CommentWithImages,
  type Drafts,
  type Review,
  type Screenshot,
} from './model';
import {
  activeReviewIdItem,
  commentsBytesInUse,
  commentsItem,
  draftsItem,
  imagesItem,
  imagesKey,
  localBytesInUse,
  perCommentKeys,
  reviewsItem,
  screenshotItem,
  storeMigrationItem,
  storeVersionItem,
} from './storage';

/**
 * Reviews, comments, their images and the open drafts. Only the service worker writes them, and every write runs
 * through one queue, so two saves never read the same list and the second never overwrites the first. Pages reach
 * these writes through lib/store.js, which forwards them to the service worker.
 */

const STORE_VERSION = 2;
const MIGRATION_BATCH_BYTES = 16 * 1024 * 1024;

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Runs a write after every write already queued. Inside the task, use only the steps it is given and never a queued
 * function from this module, because that would wait on the task itself.
 * @param task The read, change and write to run, given the unqueued write steps.
 */
export function queueWrite<Result>(task: (steps: WriteSteps) => Promise<Result>): Promise<Result> {
  const run = writeChain.then(() => task(writeSteps));
  // The caller gets this task's failure from `run`. The chain only needs to move on to the next write.
  writeChain = run.catch(() => undefined);
  return run;
}

/**
 * Splits a comment or a patch into its list fields and its image fields.
 * @param record A comment or a patch.
 */
function splitImages<Input extends object>(record: Input): { fields: Omit<Input, keyof CommentImages>; images: CommentImages } {
  const fields: Record<string, unknown> = {};
  const images: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if ((IMAGE_FIELDS as readonly string[]).includes(key)) images[key] = value;
    else fields[key] = value;
  }
  return { fields: fields as Omit<Input, keyof CommentImages>, images };
}

/**
 * True when a stored comment still carries image fields inside the list, as comments saved before the split do.
 * @param comment A comment from the list.
 */
const holdsImages = (comment: object) => IMAGE_FIELDS.some((field) => field in comment);

/**
 * True when an image set holds at least one image.
 * @param images Image fields by name.
 */
const hasImages = (images: CommentImages) => Object.values(images).some((value) => value != null);

/**
 * Rough size of an image set in bytes, used to keep migration batches bounded.
 * @param images Image fields by name.
 */
function imageBytes(images: CommentImages) {
  let bytes = 0;
  for (const field of ['shot', 'detail', 'after'] as const) bytes += images[field]?.length ?? 0;
  for (const shot of Object.values(images.shots ?? {})) bytes += shot?.src?.length ?? 0;
  return bytes;
}

/**
 * A size in megabytes, for migration progress lines.
 * @param bytes The size in bytes.
 */
const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

/** Reads every stored comment, oldest first, without images. */
export async function readComments(): Promise<Comment[]> {
  const comments = await commentsItem.getValue();
  return Array.isArray(comments) ? comments : [];
}

/**
 * Reads one stored comment without images, or null when it is gone.
 * @param id The comment id.
 */
export async function findComment(id: string): Promise<Comment | null> {
  return (await readComments()).find((comment) => comment.id === id) ?? null;
}

/**
 * Comments made in one review, or every comment when no id is given, without images.
 * @param reviewId The review id.
 */
export async function commentsInReview(reviewId?: string | null): Promise<Comment[]> {
  const comments = await readComments();
  return reviewId ? comments.filter((comment) => comment.groupId === reviewId) : comments;
}

/**
 * Reads one comment's images: shot, detail, after and the width shots, whichever it has.
 * @param id The comment id.
 */
export async function readImages(id: string): Promise<CommentImages> {
  return imagesItem(id).getValue();
}

/**
 * Returns copies of comments with their images added back, in one storage read. Images stored under the comment's
 * key win over any older copy still inside the list.
 * @param comments Comments as read from the list.
 */
export async function withImages(comments: Comment[]): Promise<CommentWithImages[]> {
  if (!comments.length) return [];
  const stored = await storage.getItems(comments.map((comment) => imagesKey(comment.id)));
  return comments.map((comment, index) => ({ ...comment, ...stored[index]?.value }));
}

/**
 * Reads a comment's clean screenshot, or null when it has none.
 * @param id The comment id.
 */
export async function readScreenshot(id: string): Promise<Screenshot | null> {
  return screenshotItem(id).getValue();
}

/** Reads every review, oldest first. */
export async function readReviews(): Promise<Review[]> {
  const reviews = await reviewsItem.getValue();
  return Array.isArray(reviews) ? reviews : [];
}

/** Reads the open drafts by id. */
export async function readDrafts(): Promise<Drafts> {
  return draftsItem.getValue();
}

/**
 * The review new comments go to: the selected one, else the newest, else none yet.
 * @param reviews Every review.
 */
async function pickActive(reviews: Review[]) {
  const activeId = await activeReviewIdItem.getValue();
  return reviews.find((review) => review.id === activeId) ?? reviews.at(-1) ?? null;
}

/**
 * Merges image fields into what is stored for each comment, in one read and one write. A field set to null is kept
 * as null, so a removed image is never brought back from an older copy. The key is removed when only nulls are left.
 * @param entries Each comment's id and its image fields.
 * @param keepStored True to let images already stored win over the given ones, as when moving old inline images out.
 */
async function putImages(entries: { id: string; images: CommentImages }[], keepStored: boolean) {
  if (!entries.length) return;
  const stored = await storage.getItems(entries.map((entry) => imagesKey(entry.id)));
  const write: { key: StorageItemKey; value: CommentImages }[] = [];
  const drop: StorageItemKey[] = [];
  entries.forEach(({ id, images }, index) => {
    const before: CommentImages = stored[index]?.value ?? {};
    const merged = keepStored ? { ...images, ...before } : { ...before, ...images };
    if (hasImages(merged)) write.push({ key: imagesKey(id), value: merged });
    else drop.push(imagesKey(id));
  });
  if (write.length) await storage.setItems(write);
  if (drop.length) await storage.removeItems(drop);
}

/**
 * Stores the comment list as given.
 * @param comments Comments without image fields.
 */
const saveList = (comments: Comment[]) => commentsItem.setValue(comments);

/**
 * Stores the review list as given.
 * @param reviews Every review.
 */
const saveReviews = (reviews: Review[]) => reviewsItem.setValue(reviews);

/**
 * The write steps a queued task may use. None of them queues, so they must only run inside a task.
 */
const writeSteps = {
  putImages,

  /**
   * Replaces the whole comment list. Images found on any entry move to that comment's image key, without replacing
   * images already stored there.
   * @param comments The comments to store.
   */
  async saveComments(comments: CommentWithImages[]) {
    const parts = comments.map((comment) => ({ id: comment.id, ...splitImages(comment) }));
    await putImages(parts.filter((part) => hasImages(part.images)), true);
    await saveList(parts.map((part) => part.fields));
  },

  /**
   * Appends one comment, storing its images under its own key first.
   * @param comment The new comment, which may carry images.
   */
  async addComment(comment: CommentWithImages): Promise<CommentWithImages> {
    const { fields, images } = splitImages(comment);
    if (hasImages(images)) await putImages([{ id: comment.id, images }], false);
    await saveList([...(await readComments()), fields]);
    return comment;
  },

  /**
   * Merges a patch into one comment. Image fields go to the comment's image key, and the list is only rewritten when
   * a list field changed. Returns the comment with the patched images, or null when it is gone.
   * @param id The comment id.
   * @param patch Fields to change.
   */
  async patchComment(id: string, patch: CommentPatch): Promise<CommentWithImages | null> {
    const comments = await readComments();
    const found = comments.find((comment) => comment.id === id);
    if (!found) return null;
    const { fields, images } = splitImages(patch);
    if (Object.keys(images).length) await putImages([{ id, images }], false);
    if (Object.keys(fields).length) {
      Object.assign(found, fields);
      await saveList(comments);
    }
    return { ...found, ...images };
  },

  /**
   * Drops one comment by id, with its images and clean screenshot.
   * @param id The comment id.
   */
  async removeComment(id: string) {
    await saveList((await readComments()).filter((comment) => comment.id !== id));
    await storage.removeItems(perCommentKeys([id]));
  },

  /**
   * Removes the images and clean screenshots of comments or drafts, leaving the comment list alone.
   * @param ids The comment ids.
   */
  async removeStoredImages(ids: string[]) {
    if (ids.length) await storage.removeItems(perCommentKeys(ids));
  },

  /** Drops every comment, with their images and clean screenshots. */
  async clearComments() {
    const comments = await readComments();
    await saveList([]);
    await storage.removeItems(perCommentKeys(comments.map((comment) => comment.id)));
  },

  /**
   * Stores a comment's clean screenshot.
   * @param id The comment id.
   * @param screenshot The screenshot and whether the region is burned into it.
   */
  async writeScreenshot(id: string, screenshot: Screenshot) {
    await screenshotItem(id).setValue(screenshot);
  },

  /**
   * Creates a review and makes it the one new comments go to.
   * @param name The name, or a dated default when empty.
   */
  async addReview(name?: string | null): Promise<Review> {
    const review: Review = {
      id: crypto.randomUUID(),
      name: name?.trim() || `Review ${new Date().toLocaleDateString()}`,
      createdAt: new Date().toISOString(),
    };
    await saveReviews([...(await readReviews()), review]);
    await activeReviewIdItem.setValue(review.id);
    return review;
  },

  /**
   * Merges a patch into one review. Returns the review, or null when it is gone.
   * @param id The review id.
   * @param patch Fields to change.
   */
  async patchReview(id: string, patch: Partial<Omit<Review, 'id'>>): Promise<Review | null> {
    const reviews = await readReviews();
    const found = reviews.find((review) => review.id === id);
    if (!found) return null;
    Object.assign(found, patch);
    await saveReviews(reviews);
    return found;
  },

  /**
   * Removes a review with the comments made in it, their images and clean screenshots.
   * @param id The review id.
   */
  async removeReview(id: string) {
    await saveReviews((await readReviews()).filter((review) => review.id !== id));
    const comments = await readComments();
    await saveList(comments.filter((comment) => comment.groupId !== id));
    await storage.removeItems(perCommentKeys(comments.filter((comment) => comment.groupId === id).map((comment) => comment.id)));
    if ((await activeReviewIdItem.getValue()) === id) await activeReviewIdItem.removeValue();
  },

  /**
   * Makes a review the one new comments go to.
   * @param id The review id.
   */
  async selectReview(id: string) {
    await activeReviewIdItem.setValue(id);
  },

  /** The review new comments go to, created when there is none. */
  async activeReview(): Promise<Review> {
    return (await pickActive(await readReviews())) ?? writeSteps.addReview();
  },

  /**
   * Reads, changes and writes the open drafts.
   * @param change Edits the drafts by id in place and returns a result.
   */
  async editDrafts<Result>(change: (drafts: Drafts) => Result | Promise<Result>): Promise<Result> {
    const drafts = await readDrafts();
    const result = await change(drafts);
    await draftsItem.setValue(drafts);
    return result;
  },
};

export type WriteSteps = typeof writeSteps;

/**
 * Replaces the whole comment list, moving any images on it to the image keys.
 * @param comments The comments to store.
 */
export const saveComments = (comments: CommentWithImages[]) => queueWrite((steps) => steps.saveComments(comments));

/**
 * Appends one comment.
 * @param comment The new comment, which may carry images.
 */
export const addComment = (comment: CommentWithImages) => queueWrite((steps) => steps.addComment(comment));

/**
 * Merges a patch into one comment.
 * @param id The comment id.
 * @param patch Fields to change.
 */
export const patchComment = (id: string, patch: CommentPatch) => queueWrite((steps) => steps.patchComment(id, patch));

/**
 * Drops one comment with its images.
 * @param id The comment id.
 */
export const removeComment = (id: string) => queueWrite((steps) => steps.removeComment(id));

/** Drops every comment with their images. */
export const clearComments = () => queueWrite((steps) => steps.clearComments());

/**
 * Merges image fields into one comment's stored images. A field set to null removes that image.
 * @param id The comment id.
 * @param images Image fields to change.
 */
export const writeImages = (id: string, images: CommentImages) => queueWrite((steps) => steps.putImages([{ id, images }], false));

/**
 * Stores a comment's clean screenshot.
 * @param id The comment id.
 * @param screenshot The screenshot.
 */
export const writeScreenshot = (id: string, screenshot: Screenshot) => queueWrite((steps) => steps.writeScreenshot(id, screenshot));

/**
 * Creates a review and selects it.
 * @param name The name.
 */
export const addReview = (name?: string | null) => queueWrite((steps) => steps.addReview(name));

/**
 * Merges a patch into one review.
 * @param id The review id.
 * @param patch Fields to change.
 */
export const patchReview = (id: string, patch: Partial<Omit<Review, 'id'>>) => queueWrite((steps) => steps.patchReview(id, patch));

/**
 * Removes a review and its comments.
 * @param id The review id.
 */
export const removeReview = (id: string) => queueWrite((steps) => steps.removeReview(id));

/**
 * Selects the review new comments go to.
 * @param id The review id.
 */
export const selectReview = (id: string) => queueWrite((steps) => steps.selectReview(id));

/**
 * Reads, changes and writes the open drafts.
 * @param change Edits the drafts in place and returns a result.
 */
export const editDrafts = <Result>(change: (drafts: Drafts) => Result | Promise<Result>) => queueWrite((steps) => steps.editDrafts(change));

/** The review new comments go to. Only the first use, with no review yet, writes. */
export async function activeReview(): Promise<Review> {
  return (await pickActive(await readReviews())) ?? queueWrite((steps) => steps.activeReview());
}

/**
 * Moves images out of the comment list into one `img:<id>` key per comment, for stores written before images were
 * split out. Works in batches of about MIGRATION_BATCH_BYTES. Each batch reads the list afresh, writes its comments'
 * image keys and then saves the list without those images, so a stop part way loses nothing. The next start resumes
 * with whatever is still inline, and images already moved win over the inline copy. The store is marked done only
 * after a check finds no inline images and an image key for every comment that had them.
 * @param log Where progress lines go.
 * @returns True once the store is in the current shape.
 */
export async function migrateImages(log: (line: string) => void): Promise<boolean> {
  if ((await storeVersionItem.getValue()) === STORE_VERSION) return true;
  const started = await storeMigrationItem.getValue();
  if (started) log(`Margin: resuming the image migration started ${started.startedAt}`);

  const withImageKeys = new Set<string>();
  let moved = 0;
  let movedBytes = 0;
  let startCount: number | null = null;
  for (;;) {
    const step = await queueWrite(async (steps) => {
      const comments: CommentWithImages[] = await readComments();
      const batch: { id: string; images: CommentImages }[] = [];
      let bytes = 0;
      for (const comment of comments.filter(holdsImages)) {
        const { images } = splitImages(comment);
        const size = imageBytes(images);
        if (batch.length && bytes + size > MIGRATION_BATCH_BYTES) break;
        batch.push({ id: comment.id, images });
        bytes += size;
      }
      if (!batch.length) return { done: true as const, total: comments.length };
      if (!started && !moved) {
        log(`Margin: moving images out of the comment list, ${comments.length} comments`);
        await storeMigrationItem.setValue({ startedAt: new Date().toISOString() });
      }
      const filled = batch.filter((entry) => hasImages(entry.images));
      await steps.putImages(filled, true);
      const ids = new Set(batch.map((entry) => entry.id));
      await saveList(comments.map((comment) => (ids.has(comment.id) ? splitImages(comment).fields : comment)));
      filled.forEach((entry) => withImageKeys.add(entry.id));
      const left = comments.filter((comment) => !ids.has(comment.id) && holdsImages(comment)).length;
      return { done: false as const, total: comments.length, count: batch.length, bytes, left };
    });
    startCount ??= step.total;
    if (step.done) break;
    moved += step.count;
    movedBytes += step.bytes;
    log(`Margin: moved images for ${moved} comments, ${megabytes(movedBytes)} so far, ${step.left} of ${step.total} comments still to move`);
  }

  if (!started && !moved) {
    await storeVersionItem.setValue(STORE_VERSION);
    return true;
  }
  const comments = await readComments();
  const inline = comments.filter(holdsImages).length;
  const sizes = await Promise.all([...withImageKeys].map((id) => localBytesInUse(imagesKey(id))));
  const missing = sizes.filter((bytes) => !bytes).length;
  if (inline || missing) {
    log(`Margin: image migration check failed, ${inline} comments still hold images and ${missing} image keys are missing. It will run again on the next start.`);
    return false;
  }
  await storeVersionItem.setValue(STORE_VERSION);
  await storeMigrationItem.removeValue();
  const listBytes = await commentsBytesInUse();
  log(`Margin: image migration done, ${startCount} comments before and ${comments.length} after, ${withImageKeys.size} image keys written this run, list now ${megabytes(listBytes)}`);
  return true;
}
