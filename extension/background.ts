import type {
  Anchor,
  Comment,
  CommentPatch,
  CommentWithImages,
  Marker,
  MarkerKind,
  Rect,
  Screenshot,
  VerifyRun,
  Viewport,
  WidthKey,
  WidthShots,
} from './lib/model';
import { onMessage, type ActionName, type MessageData, type MessageReply } from './lib/protocol';
import {
  activeReview,
  addReview,
  commentsInReview,
  editDrafts,
  findComment,
  migrateImages,
  patchComment,
  patchReview,
  queueWrite,
  readComments,
  readDrafts,
  readImages,
  readReviews,
  readScreenshot,
  removeComment,
  removeReview,
  selectReview,
  withImages,
  writeImages,
  writeScreenshot,
  type WriteSteps,
} from './lib/review-store';
import { storage } from 'wxt/utils/storage';
import { annotatingNoticesItem, annotatingTabsItem, RETIRED_KEYS, verifyRunItem } from './lib/storage';
import { serveStoreWrites } from './lib/store-server';
import { parseReviewFile } from './lib/review-file.js';
import { WIDTHS, widthShots } from './lib/widths.js';

declare global {
  interface Window {
    /** The overlay's hook for hiding itself while a screenshot is taken. */
    __uiAnnotator?: { hideForCapture(hidden: boolean): void };
    /** The Escape listener a recheck run adds to the page it checks. */
    __marginVerifyKey?: (event: KeyboardEvent) => void;
  }
  interface Screen {
    /** Chrome's left edge of the usable screen area, not in TypeScript's DOM types. */
    availLeft?: number;
  }
  interface Navigator {
    /** Chrome's client hints, not yet in TypeScript's DOM types. */
    userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string };
  }
}

const HIGHLIGHT = '#e5484d';
const MAX_SHOT_WIDTH = 1400;
const MAX_DETAIL_WIDTH = 900;
const MAX_SCREENSHOT_WIDTH = 2400;
const MAX_WIDTH_SHOT = 900;
const DETAIL_PADDING = 72;
const MIN_DETAIL_WIDTH = 640;
const MIN_DETAIL_HEIGHT = 360;
const DRAFT_AGE = 24 * 60 * 60_000;
const CAPTURE_GAP = 600;
const DIFF_WIDTH = 240;
const DIFF_CELL = 2;
const DIFF_LEVEL = 32;
const MARK_KINDS: MarkerKind[] = ['dot', 'box', 'arrow'];
const MENU_CONTEXTS: NonNullable<chrome.contextMenus.CreateProperties['contexts']> = ['page', 'selection', 'link', 'image', 'video', 'audio', 'editable', 'frame'];

/** A tab that has an id, which every tab Margin works on does. */
type TabWithId = chrome.tabs.Tab & { id: number };

let lastCaptureAt = 0;
let widthsBusy = false;
let liveVerify: { cancelled: boolean } | null = null;

/**
 * Waits a while.
 * @param milliseconds How long.
 */
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * The readable text of a thrown value.
 * @param error What was thrown.
 */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Runs a clean-up step whose failure must not hide the error or result before it, and reports a failure.
 * @param step The clean-up.
 * @param what What it does, for the report.
 */
async function bestEffort(step: Promise<unknown>, what: string) {
  try {
    await step;
  } catch (error) {
    console.warn(`Margin: could not ${what}`, error);
  }
}

/**
 * A tab's zoom factor. A tab that closed meanwhile reads as 1, which only sizes the overlay of a page that is gone.
 * @param tabId The tab.
 */
const zoomOf = (tabId: number) => chrome.tabs.getZoom(tabId).catch(() => 1);

/**
 * Injects the overlay if the tab does not have it yet, then tells it to toggle annotation. Returns whether it is on.
 * @param tab The tab.
 */
async function toggleTab(tab: chrome.tabs.Tab | undefined) {
  if (!tab?.id) return false;
  await ensureContent(tab);
  const reply = await chrome.tabs.sendMessage(tab.id, { type: 'toggle', groupName: (await activeReview()).name, zoom: await zoomOf(tab.id) });
  return reply?.active === true;
}

chrome.tabs.onZoomChange.addListener(({ tabId, newZoomFactor }) => {
  // Most tabs have no overlay to tell, so a refused message is expected.
  chrome.tabs.sendMessage(tabId, { type: 'zoom', zoom: newZoomFactor }).catch(() => undefined);
});

/**
 * Changes the session record of tabs that are annotating, in the write queue.
 * @param change Edits the tab ids and the notices in place.
 */
function editAnnotatingTabs(change: (record: { tabs: number[]; notices: Record<number, string> }) => void) {
  return queueWrite(async () => {
    const [tabs, notices] = await Promise.all([annotatingTabsItem.getValue(), annotatingNoticesItem.getValue()]);
    const record = { tabs, notices };
    change(record);
    await Promise.all([annotatingTabsItem.setValue([...new Set(record.tabs)]), annotatingNoticesItem.setValue(record.notices)]);
  }).catch((error) => console.error('Margin: could not update the tabs that are annotating', error));
}

/**
 * Remembers whether a tab is annotating, so annotation comes back on after the tab loads a new page.
 * @param tabId The tab.
 * @param on Whether annotation is on in it.
 */
function markTab(tabId: number, on: boolean) {
  return editAnnotatingTabs((record) => {
    record.tabs = on ? [...record.tabs, tabId] : record.tabs.filter((id) => id !== tabId);
    if (!on) delete record.notices[tabId];
  });
}

/**
 * Turns annotation back on in a tab that just loaded a page while annotation was on, with any note about a comment
 * kept from the page before.
 * @param tabId The tab.
 * @param info What changed.
 * @param tab The tab.
 */
async function resumeTab(tabId: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) {
  if (info.status !== 'complete') return;
  const [tabs, notices] = await Promise.all([annotatingTabsItem.getValue(), annotatingNoticesItem.getValue()]);
  if (!tabs.includes(tabId)) return;
  const notice = notices[tabId] ?? '';
  try {
    await ensureContent(tab);
    await chrome.tabs.sendMessage(tabId, { type: 'start', groupName: (await activeReview()).name, zoom: await zoomOf(tabId), notice });
    if (notice) await editAnnotatingTabs((record) => delete record.notices[tabId]);
  } catch {
    // The new page cannot take the overlay, such as a chrome:// page, so annotation ends for this tab.
    await markTab(tabId, false);
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  resumeTab(tabId, info, tab).catch((error) => console.error('Margin: could not turn annotation back on', error));
});
chrome.tabs.onRemoved.addListener((tabId) => markTab(tabId, false));

/**
 * The review a draft should be saved into: its own, or the active review when its own was deleted while the card was open.
 * @param steps The write steps of the running task.
 * @param reviewId The draft's review id.
 */
async function liveReviewId(steps: WriteSteps, reviewId: string) {
  return (await readReviews()).some((review) => review.id === reviewId) ? reviewId : (await steps.activeReview()).id;
}

/**
 * True when a draft holds typed work: a title, a note or markers.
 * @param draft The draft.
 */
const hasTypedWork = (draft: Comment) => Boolean(draft.title?.trim() || draft.note?.trim() || draft.marks?.length);

/**
 * Clears out drafts older than `age`. Every draft counts as old when `age` is 0, as after a browser restart, when no
 * card can still be open. A draft with typed work is kept as a comment, so it is never lost. Only an empty draft is
 * removed, with its images.
 * @param age The oldest a draft may be, in milliseconds.
 */
function sweepDrafts(age: number) {
  return queueWrite(async (steps) => {
    const empty = await steps.editDrafts(async (drafts) => {
      const removed: string[] = [];
      for (const [id, draft] of Object.entries(drafts)) {
        if (age && Date.now() - Date.parse(draft.createdAt) <= age) continue;
        if (hasTypedWork(draft)) await steps.addComment({ ...draft, groupId: await liveReviewId(steps, draft.groupId) });
        else removed.push(id);
        delete drafts[id];
      }
      return removed;
    });
    await steps.removeStoredImages(empty);
  });
}

/**
 * Moves a draft into the comment list with the card's fields, which makes it a comment. Returns false when there is
 * no such draft, as for a comment that is already saved.
 * @param id The comment id.
 * @param patch The fields the card saved.
 */
function promoteDraft(id: string, patch: CommentPatch) {
  return queueWrite((steps) =>
    steps.editDrafts(async (drafts) => {
      const draft = drafts[id];
      if (!draft) return false;
      await steps.addComment({ ...draft, ...patch, groupId: await liveReviewId(steps, draft.groupId) });
      delete drafts[id];
      return true;
    }),
  );
}

/**
 * Changes a comment or an open draft. Width shots go to the comment's image key either way.
 * @param id The comment id.
 * @param patch Fields to change.
 */
function patchCommentOrDraft(id: string, patch: CommentPatch) {
  return queueWrite(async (steps): Promise<CommentWithImages | null> => {
    const saved = await steps.patchComment(id, patch);
    if (saved) return saved;
    const { shots, ...fields } = patch;
    if (shots !== undefined) await steps.putImages([{ id, images: { shots } }], false);
    return steps.editDrafts((drafts) => {
      const draft = drafts[id];
      if (!draft) return null;
      Object.assign(draft, fields);
      return { ...draft, shots };
    });
  });
}

/**
 * Injects the overlay into a tab unless it is already there.
 * @param tab The tab to prepare.
 */
async function ensureContent(tab: chrome.tabs.Tab) {
  if (!tab.id || /^(chrome|edge|about|devtools):|^https:\/\/chrome\.google\.com\/webstore|^https:\/\/chromewebstore\.google\.com/.test(tab.url ?? '')) {
    throw new Error('This page does not allow extensions to run.');
  }
  let ready = false;
  try {
    ready = (await chrome.tabs.sendMessage(tab.id, { type: 'ping' }))?.ok === true;
  } catch {
    // No overlay answers yet, which is what the injection below is for.
    ready = false;
  }
  if (!ready) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
}

/** Adds Margin's items to Chrome's right-click menu, replacing any left from an earlier run. */
async function createMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'margin-toggle', title: 'Start or stop annotating', contexts: MENU_CONTEXTS });
  chrome.contextMenus.create({ id: 'margin-viewport', title: 'Comment on the whole visible area', contexts: MENU_CONTEXTS });
  chrome.contextMenus.create({ id: 'margin-widths', title: 'Capture comments on this page at three widths', contexts: MENU_CONTEXTS });
  chrome.contextMenus.create({ id: 'margin-report', title: 'Open the review report', contexts: MENU_CONTEXTS });
}

/**
 * Runs the right-click menu item that was picked.
 * @param info Which item.
 * @param tab The tab it was picked on.
 */
async function runMenuItem(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined) {
  if (info.menuItemId === 'margin-toggle') await toggleTab(tab);
  else if (info.menuItemId === 'margin-report') await handlers.openReport(undefined, {});
  else if (info.menuItemId === 'margin-viewport' && tab?.id) {
    await ensureContent(tab);
    await chrome.tabs.sendMessage(tab.id, { type: 'captureViewport', groupName: (await activeReview()).name, zoom: await zoomOf(tab.id) });
  } else if (info.menuItemId === 'margin-widths' && tab?.id) {
    const reply = await handlers.captureWidths({ page: true }, { tab }).catch((error: unknown) => ({ error: messageOf(error) }));
    await chrome.tabs.sendMessage(tab.id, { type: 'toast', text: 'error' in reply ? reply.error : reply.message });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  runMenuItem(info, tab).catch((error) => console.error('Margin: the menu action failed', error));
});

/**
 * Turns a Blob into a data URL without FileReader, which keeps this worker-safe.
 * @param blob The image.
 */
async function toDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

/**
 * A 2D drawing context for an offscreen canvas.
 * @param canvas The canvas.
 * @param settings Context settings.
 */
function context2d(canvas: OffscreenCanvas, settings?: CanvasRenderingContext2DSettings) {
  const context = canvas.getContext('2d', settings);
  if (!context) throw new Error('Chrome could not draw the screenshot');
  return context;
}

/** A marker with every coordinate in canvas pixels. */
interface CanvasMark {
  kind: MarkerKind;
  x: number;
  y: number;
  w: number;
  h: number;
  x2: number;
  y2: number;
}

/**
 * Draws the numbered markers, shapes first and then a numbered disc for each, in list order. Boxes carry their
 * number on the top left corner, arrows on their tail.
 * @param context The canvas to draw on.
 * @param marks Markers with every coordinate already in canvas pixels.
 */
function drawMarks(context: OffscreenCanvasRenderingContext2D, marks: CanvasMark[]) {
  const radius = Math.round(Math.min(16, Math.max(10, context.canvas.width / 70)));
  const lineWidth = Math.max(2, Math.round(context.canvas.width / 600));
  const haloed = (trace: () => void) => {
    context.lineWidth = lineWidth + 3;
    context.strokeStyle = 'rgba(255,255,255,0.92)';
    trace();
    context.stroke();
    context.lineWidth = lineWidth;
    context.strokeStyle = HIGHLIGHT;
    trace();
    context.stroke();
  };
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const mark of marks) {
    if (mark.kind === 'box') {
      haloed(() => {
        context.beginPath();
        context.rect(mark.x, mark.y, mark.w, mark.h);
      });
    } else if (mark.kind === 'arrow') {
      const angle = Math.atan2(mark.y2 - mark.y, mark.x2 - mark.x);
      const head = radius * 1.2;
      haloed(() => {
        context.beginPath();
        context.moveTo(mark.x, mark.y);
        context.lineTo(mark.x2, mark.y2);
        context.moveTo(mark.x2 - head * Math.cos(angle - 0.45), mark.y2 - head * Math.sin(angle - 0.45));
        context.lineTo(mark.x2, mark.y2);
        context.lineTo(mark.x2 - head * Math.cos(angle + 0.45), mark.y2 - head * Math.sin(angle + 0.45));
      });
    }
  }
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `700 ${Math.round(radius * 1.15)}px Manrope, "Segoe UI", sans-serif`;
  marks.forEach((mark, index) => {
    context.beginPath();
    context.arc(mark.x, mark.y, radius + 2, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255,255,255,0.92)';
    context.fill();
    context.beginPath();
    context.arc(mark.x, mark.y, radius, 0, Math.PI * 2);
    context.fillStyle = HIGHLIGHT;
    context.fill();
    context.fillStyle = '#ffffff';
    context.fillText(String(index + 1), mark.x, mark.y + 1);
  });
}

/**
 * Draws a part of the screenshot with the marked region outlined on top.
 * @param bitmap The screenshot.
 * @param source The part of the bitmap to draw, in bitmap pixels.
 * @param box The marked region, in bitmap pixels.
 * @param maxWidth The widest the output image may be.
 * @param marks Numbered markers, in viewport CSS pixels.
 * @param scale Bitmap pixels per viewport CSS pixel.
 */
async function drawRegion(bitmap: ImageBitmap, source: Rect, box: Rect, maxWidth: number, marks: Marker[] = [], scale = 1) {
  const factor = Math.min(1, maxWidth / source.w);
  const canvas = new OffscreenCanvas(Math.round(source.w * factor), Math.round(source.h * factor));
  const context = context2d(canvas);
  context.drawImage(bitmap, source.x, source.y, source.w, source.h, 0, 0, canvas.width, canvas.height);

  const x = (box.x - source.x) * factor;
  const y = (box.y - source.y) * factor;
  const w = box.w * factor;
  const h = box.h * factor;
  context.lineWidth = 4;
  context.strokeStyle = 'rgba(255,255,255,0.92)';
  context.strokeRect(x - 2, y - 2, w + 4, h + 4);
  context.lineWidth = 2;
  context.strokeStyle = HIGHLIGHT;
  context.strokeRect(x, y, w, h);

  const canvasX = (value: number) => (value * scale - source.x) * factor;
  const canvasY = (value: number) => (value * scale - source.y) * factor;
  drawMarks(
    context,
    marks.map((mark) => ({
      kind: mark.kind,
      x: canvasX(mark.x),
      y: canvasY(mark.y),
      w: (mark.w ?? 0) * scale * factor,
      h: (mark.h ?? 0) * scale * factor,
      x2: canvasX(mark.x2 ?? mark.x),
      y2: canvasY(mark.y2 ?? mark.y),
    })),
  );

  return toDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
}

/** What the comment images are drawn from: the region, the viewport it was captured in and the markers. */
type DrawnComment = Pick<Comment, 'rect' | 'viewport' | 'marks'>;

/**
 * Draws both stored images of a comment from a screenshot: the whole viewport for context, and a padded crop of the
 * region for detail, each with the region and markers.
 * @param bitmap The screenshot.
 * @param comment The comment's region, viewport and markers.
 */
async function renderImages(bitmap: ImageBitmap, comment: DrawnComment) {
  const scale = bitmap.width / comment.viewport.width;
  const { box, crop } = cropAround(bitmap, comment.rect, scale);
  const marks = comment.marks ?? [];
  const full = { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  return {
    shot: await drawRegion(bitmap, full, box, MAX_SHOT_WIDTH, marks, scale),
    detail: await drawRegion(bitmap, crop, box, MAX_DETAIL_WIDTH, marks, scale),
  };
}

/**
 * Encodes the untouched screenshot, so the images can be redrawn later with a moved region or new markers.
 * @param bitmap The captured screenshot.
 */
async function encodeScreenshot(bitmap: ImageBitmap) {
  const factor = Math.min(1, MAX_SCREENSHOT_WIDTH / bitmap.width);
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * factor), Math.round(bitmap.height * factor));
  context2d(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return toDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }));
}

/**
 * Decodes an image from a data URL.
 * @param src The data URL.
 */
const decodeImage = async (src: string) => createImageBitmap(await (await fetch(src)).blob());

/**
 * Grabs the visible tab and returns the clean screenshot plus the two marked images.
 * @param tab The tab to capture.
 * @param comment The region and viewport being captured.
 */
async function captureShots(tab: chrome.tabs.Tab, comment: DrawnComment) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 92 });
  const bitmap = await decodeImage(dataUrl);
  const images = await renderImages(bitmap, comment);
  const screenshot = await encodeScreenshot(bitmap);
  bitmap.close();
  return { screenshot, ...images };
}

/**
 * Works out the padded crop around a marked region, in image pixels.
 * @param image The image's size.
 * @param rect The region in viewport CSS pixels.
 * @param scale Image pixels per CSS pixel.
 */
function cropAround(image: { width: number; height: number }, rect: Rect, scale: number) {
  const box = { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale };
  const padX = Math.max(DETAIL_PADDING, (MIN_DETAIL_WIDTH - rect.w) / 2) * scale;
  const padY = Math.max(DETAIL_PADDING, (MIN_DETAIL_HEIGHT - rect.h) / 2) * scale;
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  return {
    box,
    crop: { x, y, w: Math.min(image.width - x, box.w + padX * 2), h: Math.min(image.height - y, box.h + padY * 2) },
  };
}

/**
 * Loads the screenshot a comment is redrawn from. Comments captured before clean screenshots were kept fall back to
 * their viewport image, copied once so it is never re-encoded twice.
 * @param comment The stored comment.
 * @param steps The write steps, when called inside a queued write.
 */
async function screenshotFor(comment: Comment, steps?: WriteSteps): Promise<Screenshot | null> {
  const stored = await readScreenshot(comment.id);
  if (stored) return stored;
  const [hydrated] = await withImages([comment]);
  if (!hydrated?.shot) return null;
  const screenshot = { src: hydrated.shot, hasBox: true };
  if (steps) await steps.writeScreenshot(comment.id, screenshot);
  else await writeScreenshot(comment.id, screenshot);
  return screenshot;
}

/**
 * Redraws both images of a comment from its base screenshot.
 * @param comment The comment, with the region and markers to draw.
 */
async function rerender(comment: Comment) {
  const screenshot = await screenshotFor(comment);
  if (!screenshot) return null;
  const bitmap = await decodeImage(screenshot.src);
  const images = await renderImages(bitmap, comment);
  bitmap.close();
  return images;
}

/**
 * True for a value the editor sent that looks like a marker.
 * @param value One entry of the markers the editor sent.
 */
function isMarkerLike(value: unknown): value is { kind: MarkerKind } & Record<string, unknown> {
  return typeof value === 'object' && value !== null && 'kind' in value && MARK_KINDS.some((kind) => kind === value.kind);
}

/**
 * A number the editor sent, rounded to a whole pixel, or 0 when it is not a number.
 * @param value The value.
 */
const whole = (value: unknown) => Math.round(Number(value) || 0);

/**
 * Rounds an anchor fraction to four places.
 * @param value The fraction.
 */
const roundFraction = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Keeps only well formed markers from the editor, rounded to whole pixels.
 * @param marks The markers the editor sent.
 */
function cleanMarks(marks: unknown): Marker[] {
  if (!Array.isArray(marks)) return [];
  return marks.filter(isMarkerLike).map((mark): Marker => {
    const note = String(mark.note ?? '').slice(0, 2000);
    if (mark.kind === 'box') return { kind: 'box', x: whole(mark.x), y: whole(mark.y), w: Math.max(4, whole(mark.w)), h: Math.max(4, whole(mark.h)), note };
    if (mark.kind === 'arrow') return { kind: 'arrow', x: whole(mark.x), y: whole(mark.y), x2: whole(mark.x2), y2: whole(mark.y2), note };
    return { kind: 'dot', x: whole(mark.x), y: whole(mark.y), note };
  });
}

/**
 * Rounds an edited region and keeps it inside the viewport.
 * @param rect The region the editor sent.
 * @param viewport The viewport it was captured in.
 */
function cleanRect(rect: Rect, viewport: Viewport): Rect {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  return {
    x,
    y,
    w: Math.max(4, Math.min(Math.round(rect.w), viewport.width - x)),
    h: Math.max(4, Math.min(Math.round(rect.h), viewport.height - y)),
  };
}

/**
 * Points a selection anchor at a moved region. The anchor element's box is worked out from the old region and its
 * fractions, so the new region is stored against the same element.
 * @param anchor The comment's anchor.
 * @param from The region the anchor was recorded for.
 * @param to The region after the move.
 */
function rebaseAnchor(anchor: Anchor | null, from: Rect, to: Rect): Anchor | null {
  if (!anchor?.box?.fw || !anchor.box.fh) return anchor ?? null;
  const elementWidth = from.w / anchor.box.fw;
  const elementHeight = from.h / anchor.box.fh;
  const left = from.x - anchor.box.fx * elementWidth;
  const top = from.y - anchor.box.fy * elementHeight;
  return {
    ...anchor,
    box: {
      fx: roundFraction((to.x - left) / elementWidth),
      fy: roundFraction((to.y - top) / elementHeight),
      fw: roundFraction(to.w / elementWidth),
      fh: roundFraction(to.h / elementHeight),
    },
  };
}

/** Keeps the toolbar badge in step with the stored comment count, unless a recheck run is showing its progress there. */
async function refreshBadge() {
  if (liveVerify) return;
  const count = (await readComments()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#1f2937' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

/**
 * The browser, system and zoom a comment was captured with, the details a developer asks for first.
 * @param tab The tab being captured.
 */
async function environmentOf(tab: chrome.tabs.Tab) {
  const agent = navigator.userAgentData;
  const brand = agent?.brands?.find((entry) => !/not.?a.?brand|chromium/i.test(entry.brand)) ?? agent?.brands?.find((entry) => /chromium/i.test(entry.brand));
  const zoom = tab.id ? await zoomOf(tab.id) : 1;
  return { browser: brand ? `${brand.brand} ${brand.version}` : 'Chrome', os: agent?.platform || '', zoom: Math.round(zoom * 100) };
}

/**
 * Runs a self contained function in the tab and returns its result.
 * @param tabId The tab to run in.
 * @param func The function.
 * @param args Its arguments.
 */
async function inTab<Args extends unknown[], Result>(tabId: number, func: (...args: Args) => Result, args: Args): Promise<Awaited<Result>> {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!injection) throw new Error('The page did not run the Margin script');
  return injection.result as Awaited<Result>;
}

/**
 * The tab's layout width.
 * @param tabId The tab.
 */
const layoutWidth = (tabId: number) => inTab(tabId, () => window.innerWidth, []);

/**
 * Waits for the tab's layout width to move off its old value and then hold still, and returns it. A resize that
 * changes nothing is given about a second before the old width is accepted.
 * @param tabId The tab being resized.
 * @param before The width before the resize.
 */
async function settledWidth(tabId: number, before: number) {
  let last = before;
  let steady = 0;
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(100);
    const width = await layoutWidth(tabId);
    steady = width === last ? steady + 1 : 0;
    last = width;
    if (steady >= (width === before ? 10 : 2)) break;
  }
  return last;
}

/**
 * Resizes a window until its tab lays out at a width, or until Chrome will not go further. Returns the width reached.
 * The window frame is measured rather than assumed, and the first resize can stop short, so it tries a few times.
 * @param windowId The window to resize.
 * @param tabId The tab whose layout width is measured.
 * @param width The layout width wanted, in CSS pixels.
 */
async function fitWidth(windowId: number, tabId: number, width: number) {
  const frame = await chrome.windows.get(windowId);
  let asked = frame.width ?? width;
  let reached = await layoutWidth(tabId);
  let best = { asked, reached };
  const resize = async (next: number) => {
    let size = next;
    try {
      await chrome.windows.update(windowId, { width: size });
    } catch {
      // Chrome refuses a window that would run off the screen, so it is moved back on and sized to fit.
      const screen = await inTab(tabId, () => ({ left: window.screen.availLeft ?? 0, width: window.screen.availWidth }), []);
      size = Math.min(size, screen.width);
      await chrome.windows.update(windowId, { left: Math.max(screen.left, Math.min(frame.left ?? 0, screen.left + screen.width - size)), width: size });
    }
    asked = size;
    reached = await settledWidth(tabId, reached);
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (reached === width) break;
    const before = reached;
    const next = Math.max(100, asked + width - reached);
    if (next === asked) break;
    await resize(next);
    if (Math.abs(width - reached) < Math.abs(width - best.reached)) best = { asked, reached };
    if (reached === before && Math.abs(width - reached) > 2) break;
  }
  if (reached !== best.reached) await resize(best.asked);
  await sleep(400);
  return reached;
}

interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Puts a window back to its saved position and size. Display scaling can round the first try by a pixel, so it
 * checks and tries again.
 * @param windowId The window to restore.
 * @param bounds Where it was.
 */
async function restoreBounds(windowId: number, bounds: Bounds) {
  const sides = ['left', 'top', 'width', 'height'] as const;
  for (let attempt = 0; attempt < 3; attempt++) {
    const frame = await chrome.windows.get(windowId);
    const changed = sides.filter((side) => frame[side] !== bounds[side]);
    if (!changed.length) return;
    await chrome.windows.update(windowId, Object.fromEntries(changed.map((side) => [side, bounds[side] + (attempt ? bounds[side] - (frame[side] ?? 0) : 0)])));
    await sleep(150);
  }
}

/**
 * Runs in the page. Finds a comment's anchor at the current width, scrolls it into view, and returns where the region
 * sits now. Falls back to the saved page position when the anchor is hidden or gone.
 * @param anchor The anchor recorded when the comment was made.
 * @param rect The region as saved, in viewport pixels.
 * @param savedScrollY How far the page was scrolled when the comment was made.
 */
/* oxlint-disable unicorn/consistent-function-scoping -- locateRegion runs in the page, so its helpers must live inside it. */
async function locateRegion(anchor: Anchor | null, rect: Rect, savedScrollY: number) {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 350));
  const viewWidth = document.documentElement.clientWidth || window.innerWidth;
  const viewHeight = window.innerHeight;
  const clamp = (region: Rect) => {
    const w = Math.max(4, Math.min(region.w, viewWidth));
    const h = Math.max(4, Math.min(region.h, viewHeight));
    const x = Math.min(Math.max(0, region.x), viewWidth - w);
    const y = Math.min(Math.max(0, region.y), viewHeight - h);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  };
  const find = () => {
    if (!anchor?.selector) return null;
    let matches: Element[] = [];
    try {
      matches = [...document.querySelectorAll(anchor.selector)];
    } catch {
      // A selector saved on an older version of the page may no longer parse, which counts as no match.
      matches = [];
    }
    const sameText = (element: Element) => (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80) === anchor.text;
    if (matches.length > 1 && anchor.text) matches = matches.filter(sameText).length ? matches.filter(sameText) : matches;
    if (!matches.length && anchor.text && anchor.tag) matches = [...document.getElementsByTagName(anchor.tag)].filter(sameText);
    return matches[Math.min(anchor.nth ?? 0, matches.length - 1)] ?? null;
  };
  const regionOn = (element: Element, box: Anchor['box']) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + box.fx * bounds.width, y: bounds.top + box.fy * bounds.height, w: box.fw * bounds.width, h: box.fh * bounds.height };
  };
  const element = find();
  const bounds = element?.getBoundingClientRect();
  if (element && bounds && bounds.width > 0 && bounds.height > 0 && anchor?.box) {
    const first = regionOn(element, anchor.box);
    window.scrollTo({ top: window.scrollY + first.y - Math.max(0, (viewHeight - Math.min(first.h, viewHeight)) / 2), behavior: 'instant' });
    await settle();
    return { rect: clamp(regionOn(element, anchor.box)), placed: 'found' as const };
  }
  const pageY = rect.y + savedScrollY;
  window.scrollTo({ top: pageY - Math.max(0, (viewHeight - Math.min(rect.h, viewHeight)) / 2), behavior: 'instant' });
  await settle();
  return { rect: clamp({ ...rect, y: pageY - window.scrollY }), placed: element ? ('hidden' as const) : ('lost' as const) };
}
/* oxlint-enable unicorn/consistent-function-scoping */

/**
 * Captures each comment's region in the tab at its current width.
 * @param tab The tab.
 * @param windowId The window the tab is in now.
 * @param comments The comments to capture.
 * @param width The layout width reached.
 * @param key Which width this is, such as mobile.
 * @param shotsById Captured shots by comment id, filled in place.
 */
async function captureAtWidth(tab: TabWithId, windowId: number, comments: Comment[], width: number, key: WidthKey, shotsById: Record<string, WidthShots>) {
  for (const comment of comments) {
    const { rect, placed } = await inTab(tab.id, locateRegion, [comment.anchor ?? null, comment.rect, comment.viewport?.scrollY ?? 0]);
    const bitmap = await decodeImage(await throttledCapture(windowId));
    const { box, crop } = cropAround(bitmap, rect, bitmap.width / width);
    const shots = (shotsById[comment.id] ??= {});
    shots[key] = { src: await drawRegion(bitmap, crop, box, MAX_WIDTH_SHOT), width, placed };
    bitmap.close();
  }
}

/**
 * Moves a tab into a narrow popup window, which Chrome lets go below the smallest normal window. A window left with
 * no tabs would close, so a blank tab holds its place first.
 * @param tab The tab to move.
 * @param home The window it comes from.
 * @param width The window width to open at.
 */
async function intoPopup(tab: TabWithId, home: chrome.windows.Window, width: number) {
  const siblings = await chrome.tabs.query({ windowId: home.id });
  const placeholder = siblings.length === 1 ? await chrome.tabs.create({ windowId: home.id, url: 'about:blank', active: false }) : null;
  const popup = await chrome.windows.create({ tabId: tab.id, type: 'popup', focused: true, width, height: Math.min(home.height ?? 900, 900), left: home.left, top: home.top });
  if (popup?.id === undefined) throw new Error('Chrome did not open the narrow window');
  return { popupId: popup.id, placeholderId: placeholder?.id ?? null };
}

/**
 * Captures comments at mobile, tablet and desktop widths, then puts the window and tab back exactly as they were, even
 * when a step fails. Tablet and desktop resize the window. Mobile moves the tab into a narrow popup window, and when
 * capture is refused there it falls back to the narrowest the normal window goes.
 * @param tab The tab the comments were made on.
 * @param comments The comments to capture.
 */
async function captureWidths(tab: TabWithId, comments: Comment[]) {
  const home = await chrome.windows.get(tab.windowId);
  const homeId = tab.windowId;
  const live = await chrome.tabs.get(tab.id);
  const spot = { index: live.index, pinned: live.pinned, groupId: live.groupId ?? -1 };
  const shotsById: Record<string, WidthShots> = Object.fromEntries(comments.map((comment) => [comment.id, {}]));
  const page = await inTab(
    tab.id,
    () => {
      window.__uiAnnotator?.hideForCapture(true);
      return { scrollX: window.scrollX, scrollY: window.scrollY };
    },
    [],
  );
  let bounds: Bounds | null = null;
  let moved: { popupId: number; placeholderId: number | null } | null = null;
  try {
    if (home.state !== 'normal') {
      await chrome.windows.update(homeId, { state: 'normal' });
      await sleep(400);
    }
    const normal = await chrome.windows.get(homeId);
    bounds = { left: normal.left ?? 0, top: normal.top ?? 0, width: normal.width ?? 0, height: normal.height ?? 0 };

    for (const target of WIDTHS.toReversed().filter((entry) => entry.key !== 'mobile')) {
      const reached = await fitWidth(homeId, tab.id, target.width);
      await captureAtWidth(tab, homeId, comments, reached, target.key as WidthKey, shotsById);
    }

    const mobile = WIDTHS.find((entry) => entry.key === 'mobile');
    if (!mobile) throw new Error('Margin has no mobile width set');
    let mobileDone = false;
    try {
      moved = await intoPopup(tab, normal, mobile.width);
      const reached = await fitWidth(moved.popupId, tab.id, mobile.width);
      await captureAtWidth(tab, moved.popupId, comments, reached, 'mobile', shotsById);
      mobileDone = true;
    } catch (error) {
      // Some pages refuse capture in a popup window. The narrowest normal window below is the fallback.
      console.warn('Margin: mobile capture in a narrow window failed, using the normal window', error);
    }
    if (moved) {
      await backHome(tab, homeId, spot, moved);
      moved = null;
    }
    if (!mobileDone) {
      const reached = await fitWidth(homeId, tab.id, mobile.width);
      await captureAtWidth(tab, homeId, comments, reached, 'mobile', shotsById);
    }
  } finally {
    if (moved) await bestEffort(backHome(tab, homeId, spot, moved), 'put the tab back in its window');
    if (bounds) await bestEffort(restoreBounds(homeId, bounds), 'restore the window size');
    if (home.state && home.state !== 'normal') await bestEffort(chrome.windows.update(homeId, { state: home.state }), 'restore the window state');
    await bestEffort(chrome.windows.update(homeId, { focused: true }), 'focus the window');
    await sleep(300);
    await bestEffort(
      inTab(
        tab.id,
        (left: number, top: number) => {
          window.scrollTo({ left, top, behavior: 'instant' });
          window.__uiAnnotator?.hideForCapture(false);
        },
        [page.scrollX, page.scrollY],
      ),
      'restore the page scroll and overlay',
    );
  }
  return shotsById;
}

/**
 * Moves a tab from the popup back to its place in its window, with its pin and tab group, and removes the placeholder.
 * @param tab The tab to return.
 * @param windowId The window it came from.
 * @param spot Where it sat.
 * @param moved The popup and placeholder made for the move.
 */
async function backHome(
  tab: TabWithId,
  windowId: number,
  spot: { index: number; pinned: boolean; groupId: number },
  moved: { popupId: number; placeholderId: number | null },
) {
  await chrome.tabs.move(tab.id, { windowId, index: spot.index });
  await chrome.tabs.update(tab.id, { active: true, pinned: spot.pinned });
  if (spot.groupId !== -1) await bestEffort(chrome.tabs.group({ groupId: spot.groupId, tabIds: [tab.id] }), 'put the tab back in its group');
  if (moved.placeholderId !== null) await bestEffort(chrome.tabs.remove(moved.placeholderId), 'close the placeholder tab');
  await bestEffort(chrome.windows.remove(moved.popupId), 'close the narrow window');
}

/**
 * A short account of a width capture, naming any width where an element could not be found.
 * @param saved The comments as saved with their new shots.
 */
function widthsMessage(saved: (CommentWithImages | null)[]) {
  const count = `${saved.length} ${saved.length === 1 ? 'comment' : 'comments'}`;
  const shots = saved.flatMap((comment) => (comment?.shots ? widthShots({ shots: comment.shots }) : []));
  const reached = WIDTHS.map((entry) => shots.find((shot) => shot.key === entry.key)?.width ?? entry.width);
  const missed = [...new Set(shots.filter((shot) => shot.placed !== 'found').map((shot) => shot.label.toLowerCase()))];
  const where = missed.length > 1 ? `${missed.slice(0, -1).join(', ')} and ${missed.at(-1)}` : missed[0];
  const note = missed.length ? ` At ${where} the element was hidden or missing, so those shots use the saved position.` : '';
  return `Captured ${count} at ${reached.slice(0, -1).join(', ')} and ${reached.at(-1)}px.${note}`;
}

/**
 * The tab a message came from, or the active tab when it came from the popup.
 * @param sender The sender.
 */
async function senderTab(sender: chrome.runtime.MessageSender) {
  return sender.tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

/**
 * True for a tab with an id.
 * @param tab The tab.
 */
const hasId = (tab: chrome.tabs.Tab | undefined): tab is TabWithId => tab?.id !== undefined;

type Handlers = {
  [Name in ActionName]: (data: MessageData<Name>, sender: chrome.runtime.MessageSender) => Promise<MessageReply<Name>>;
};

/** What the service worker does for the screens, besides the store writes in lib/store-server.ts. */
const handlers: Handlers = {
  async toggle(_data, sender) {
    return { active: await toggleTab(await senderTab(sender)) };
  },

  /**
   * Stores a draft for a marked region, with its screenshots unless `skipShot` asks to save it without one. The draft
   * becomes a comment when its card is saved.
   */
  async capture(request, sender) {
    const tab = sender.tab;
    if (!tab) throw new Error('Capture needs a tab');
    const images = request.skipShot ? null : await captureShots(tab, request);
    const comment: Comment = {
      id: crypto.randomUUID(),
      groupId: (await activeReview()).id,
      createdAt: new Date().toISOString(),
      severity: 'major',
      status: 'open',
      title: '',
      note: '',
      page: { url: tab.url ?? '', title: tab.title ?? '' },
      viewport: request.viewport,
      env: await environmentOf(tab),
      element: request.element,
      anchor: request.anchor ?? null,
      rect: request.rect,
    };
    if (images) {
      await writeScreenshot(comment.id, { src: images.screenshot, hasBox: false });
      await writeImages(comment.id, { shot: images.shot, detail: images.detail });
    }
    await editDrafts((drafts) => {
      drafts[comment.id] = comment;
    });
    sweepDrafts(DRAFT_AGE).catch((error) => console.error('Margin: could not clear out old drafts', error));
    return { id: comment.id };
  },

  /** Saves a card's fields. A draft becomes a comment here, at the end of the list. */
  async update({ id, patch }) {
    if (!(await promoteDraft(id, patch))) await patchComment(id, patch);
    return { ok: true };
  },

  /**
   * Saves a card that was still open when its page went away: its fields, then its markers drawn into the images.
   * The tab is told on its next page which comment was kept.
   */
  async keep({ id, patch, marks, notice }, sender) {
    await handlers.update({ id, patch }, sender);
    if (marks) await handlers.annotate({ id, marks }, sender);
    const tabId = sender.tab?.id;
    if (tabId && notice) await editAnnotatingTabs((record) => (record.notices[tabId] = notice));
    return { ok: true };
  },

  /** Drops a draft or a comment, with its images. */
  async discard({ id }) {
    await editDrafts((drafts) => {
      delete drafts[id];
    });
    await removeComment(id);
    await refreshBadge();
    return { ok: true };
  },

  /** Records that annotation went on or off in the sender's tab. */
  async annotating({ active }, sender) {
    if (sender.tab?.id) await markTab(sender.tab.id, active === true);
    return { ok: true };
  },

  /** One saved comment's fields for editing on the page, without images, and whether it has a screenshot. */
  async comment({ id }) {
    const comment = await findComment(id);
    if (!comment) return { error: 'Comment not found' };
    const images = await readImages(id);
    return { ...comment, hasShot: Boolean(images.shot || (await readScreenshot(id))) };
  },

  async openReport() {
    await chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
    return { ok: true };
  },

  async groups() {
    const [reviews, active, comments] = await Promise.all([readReviews(), activeReview(), readComments()]);
    return {
      activeId: active.id,
      groups: reviews.map((review) => ({ ...review, count: comments.filter((comment) => comment.groupId === review.id).length })),
    };
  },

  async groupCreate({ name }) {
    return { group: await addReview(name) };
  },

  async groupSelect({ id }) {
    await selectReview(id);
    return { ok: true };
  },

  async groupRename({ id, name }) {
    return { group: await patchReview(id, { name }) };
  },

  async groupDelete({ id }) {
    await removeReview(id);
    await refreshBadge();
    return { ok: true };
  },

  /**
   * Captures comments again at mobile, tablet and desktop widths: the ones named by id, or with `page` every comment
   * in the active review made on the tab's page.
   */
  async captureWidths({ ids, page }, sender) {
    const tab = await senderTab(sender);
    if (!hasId(tab)) return { error: 'Open the page these comments were made on' };
    if (widthsBusy) return { error: 'Already capturing at three widths' };
    if (liveVerify) return { error: 'Wait for the check that is running to finish' };
    const review = await activeReview();
    const drafts = page ? [] : Object.values(await readDrafts());
    const comments = [...(await readComments()), ...drafts].filter((comment) =>
      page ? comment.groupId === review.id && samePage(tab.url, comment.page?.url) : ids?.includes(comment.id),
    );
    if (!comments.length) return { error: page ? 'No comments on this page in the current review' : 'Comment not found' };
    if (!comments.every((comment) => samePage(tab.url, comment.page?.url))) return { error: 'Open the page this comment was made on' };
    widthsBusy = true;
    try {
      const shots = await captureWidths(tab, comments);
      const takenAt = new Date().toISOString();
      const saved: (CommentWithImages | null)[] = [];
      for (const comment of comments) saved.push(await patchCommentOrDraft(comment.id, { shots: shots[comment.id] ?? {}, shotsAt: takenAt }));
      return { message: widthsMessage(saved) };
    } catch (error) {
      return { error: `Capture at three widths stopped, and the window was put back. ${messageOf(error)}` };
    } finally {
      widthsBusy = false;
    }
  },

  /** Adds a review from a saved review file, leaving the review new comments go to unchanged. */
  async importReview({ contents }) {
    const parsed = parseReviewFile(contents);
    if ('error' in parsed && parsed.error) return { error: parsed.error };
    if (!('issues' in parsed) || !parsed.issues) return { error: 'That file is not a Margin review file' };
    const imported: (Omit<CommentWithImages, 'id' | 'groupId'> & { raw: Screenshot | null })[] = parsed.issues;
    const review = await queueWrite(async (steps) => {
      const previous = await steps.activeReview();
      const created = await steps.addReview(`${parsed.name} (imported)`);
      const linked = parsed.jira || parsed.figma ? await steps.patchReview(created.id, { jira: parsed.jira, figma: parsed.figma }) : created;
      await steps.selectReview(previous.id);
      const added = imported.map(({ raw, ...comment }) => ({ comment: { ...comment, id: crypto.randomUUID(), groupId: created.id }, raw }));
      for (const { comment, raw } of added) if (raw) await steps.writeScreenshot(comment.id, raw);
      await steps.saveComments([...(await readComments()), ...added.map((entry) => entry.comment)]);
      return linked ?? created;
    });
    await refreshBadge();
    return { group: review, count: imported.length };
  },

  /** The review new comments go to, as stored, with its linked ticket and file. */
  async activeReview() {
    return activeReview();
  },

  /** The base screenshot the image editor draws on, and whether its region can still move. */
  async editorBase({ id }) {
    const comment = await findComment(id);
    if (!comment) return { error: 'Comment not found' };
    const screenshot = await screenshotFor(comment);
    if (!screenshot) return { error: 'This comment has no screenshot' };
    return { src: screenshot.src, hasBox: screenshot.hasBox };
  },

  /**
   * Saves the image editor's markers and region, then redraws both images. The region stays put on comments whose
   * base screenshot already shows it, and the anchor moves with the region. The recheck image and the width shots
   * were cut at the old region. They are kept while the editor is open, so Undo can still put the region back, and
   * are dropped only when the editor closes with the region moved and sends `drop`.
   */
  async annotate({ id, marks, rect, drop }) {
    const comment = await findComment(id);
    if (!comment) return { error: 'Comment not found' };
    const screenshot = await screenshotFor(comment);
    if (!screenshot) return { error: 'This comment has no screenshot' };
    const region = rect && !screenshot.hasBox ? cleanRect(rect, comment.viewport) : comment.rect;
    const cleaned = cleanMarks(marks);
    const bitmap = await decodeImage(screenshot.src);
    const images = await renderImages(bitmap, { ...comment, rect: region, marks: cleaned });
    bitmap.close();
    const moved = JSON.stringify(region) !== JSON.stringify(comment.rect) ? { anchor: rebaseAnchor(comment.anchor, comment.rect, region) } : {};
    const dropped = drop && !screenshot.hasBox ? { after: null, checkedAt: null, change: null, shots: null, shotsAt: null } : {};
    await patchComment(id, { rect: region, marks: cleaned, ...images, ...moved, ...dropped });
    return images;
  },

  /**
   * Adds a numbered marker where a report screenshot was clicked, or removes the marker nearest a right-click, then
   * redraws both images. A click on an image cut with older padding cannot be mapped, so the image is refreshed
   * instead. The whole read, redraw and save runs in the write queue, so two quick clicks never lose a marker.
   */
  async quickMark(request) {
    return queueWrite(async (steps) => {
      const comment = await findComment(request.id);
      if (!comment) return { error: 'Comment not found' };
      const screenshot = await screenshotFor(comment, steps);
      if (!screenshot) return { error: 'This comment has no screenshot' };
      const bitmap = await decodeImage(screenshot.src);
      const scale = bitmap.width / comment.viewport.width;
      const area = request.image === 'shot' ? { x: 0, y: 0, w: bitmap.width, h: bitmap.height } : cropAround(bitmap, comment.rect, scale).crop;
      const stale = Boolean(request.aspect) && Math.abs(area.w / area.h - (request.aspect ?? 0)) / (area.w / area.h) > 0.02;
      const point = { x: (area.x + request.fx * area.w) / scale, y: (area.y + request.fy * area.h) / scale };
      const marks = [...(comment.marks ?? [])];
      let index: number | null = null;
      if (!stale && request.action === 'add') {
        marks.push({ kind: 'dot', x: Math.round(point.x), y: Math.round(point.y), note: '' });
        index = marks.length - 1;
      } else if (request.action === 'drop' && request.index !== undefined && marks[request.index]) {
        marks.splice(request.index, 1);
        index = request.index;
      } else if (!stale && request.action === 'remove') {
        const reach = ((request.reach ?? 0.03) * area.w) / scale;
        const nearest = marks
          .map((mark, position) => ({ position, distance: Math.hypot(mark.x - point.x, mark.y - point.y) }))
          .toSorted((first, second) => first.distance - second.distance)[0];
        if (!nearest || nearest.distance > reach) {
          bitmap.close();
          return { removed: null, marks };
        }
        marks.splice(nearest.position, 1);
        index = nearest.position;
      }
      const images = await renderImages(bitmap, { ...comment, marks });
      bitmap.close();
      await steps.patchComment(comment.id, { marks, ...images });
      return { ...images, marks, index, stale };
    });
  },

  /** Saves the note of one numbered marker without redrawing the images. */
  async markNote({ id, index, note }) {
    return queueWrite(async (steps) => {
      const comment = await findComment(id);
      const marks = [...(comment?.marks ?? [])];
      const mark = marks[index];
      if (!comment || !mark) return { error: 'Marker not found' };
      marks[index] = { ...mark, note: String(note ?? '').slice(0, 2000) };
      await steps.patchComment(id, { marks });
      return { marks };
    });
  },

  /** Widens the detail crops of a review that was captured with older padding. */
  async recropGroup({ groupId }) {
    let updated = 0;
    for (const comment of await commentsInReview(groupId)) {
      const images = await rerender(comment);
      if (!images) continue;
      await patchComment(comment.id, images);
      updated += 1;
    }
    return { updated };
  },

  /**
   * Captures a comment's region again on the page it came from, scrolled to where it was, so the report can show it
   * before and after the fix. The region is cut at the same page coordinates, so a different window width gives a
   * shifted crop.
   */
  async recheck({ id }) {
    const comment = await findComment(id);
    if (!comment) return { error: 'Comment not found' };
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!hasId(tab) || !samePage(tab.url, comment.page?.url)) return { error: 'Open the page this comment was made on' };
    await setOverlayHidden(tab.id, true);
    let patch: CommentPatch;
    try {
      patch = await recaptureRegion(tab, comment);
    } finally {
      await setOverlayHidden(tab.id, false);
    }
    await patchComment(id, patch);
    return { ok: true };
  },

  /**
   * Starts rechecking every comment in a review whose page is open. From the popup that is the active tab. From the
   * report it is the most recent tab in the window that Margin may capture, since Chrome only shows the address of
   * tabs Margin was opened on. `ids` limits the run to some comments, as when checking the ones a stopped run did
   * not reach. Replies at once, and the run reports through storage. With `width`, only comments captured at that
   * width are rechecked, since others would be cut from the wrong layout.
   */
  async verifyStart({ groupId, ids, width }, sender) {
    if (liveVerify) return { error: 'A check is already running' };
    if (widthsBusy) return { error: 'Wait for the capture at three widths to finish' };
    const comments = (await commentsInReview(groupId)).filter((comment) => !width || !comment.viewport?.width || comment.viewport.width === width);
    const report = sender.tab?.url?.startsWith(chrome.runtime.getURL('')) ? sender.tab : null;
    const candidates = report
      ? (await chrome.tabs.query({ windowId: report.windowId })).filter((candidate) => candidate.id !== report.id)
      : await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = candidates
      .filter(hasId)
      .filter((candidate) => comments.some((comment) => samePage(candidate.url, comment.page?.url)))
      .toSorted((first, second) => (second.lastAccessed ?? 0) - (first.lastAccessed ?? 0))[0];
    if (!tab) return { error: 'noTab' };
    const targets = comments.filter((comment) => samePage(tab.url, comment.page?.url) && (!ids?.length || ids.includes(comment.id)));
    if (!targets.length) return { error: 'Nothing left to check on this page' };
    const run = { cancelled: false };
    liveVerify = run;
    runVerify(run, tab, targets, groupId, report).catch((error) => console.error('Margin: the check stopped', error));
    return { started: true, total: targets.length };
  },

  /** Stops the recheck run after the capture in progress. */
  async verifyCancel() {
    if (liveVerify) liveVerify.cancelled = true;
    return { ok: true };
  },

  /**
   * The active review's comments made on one page, without their images, numbered in the order they were made, plus
   * how many comments the review holds. The overlay draws these as flags.
   */
  async pageComments({ url }, sender) {
    const review = await activeReview();
    const comments = await commentsInReview(review.id);
    const pageUrl = url ?? sender.tab?.url;
    return {
      total: comments.length,
      comments: comments
        .map((comment, index) => ({ comment, number: index + 1 }))
        .filter(({ comment }) => samePage(pageUrl, comment.page?.url))
        .map(({ comment, number }) => ({
          id: comment.id,
          number,
          title: comment.title,
          note: (comment.note ?? '').trim().split('\n')[0]?.slice(0, 160) ?? '',
          severity: comment.severity,
          status: comment.status,
          rect: comment.rect,
          anchor: comment.anchor ?? null,
          viewport: comment.viewport,
          frame: comment.figmaFrame?.name ?? '',
        })),
    };
  },
};

/**
 * Captures the visible tab no sooner than CAPTURE_GAP after the previous capture, because Chrome allows about two a
 * second, and tries once more after a longer pause if Chrome still refuses.
 * @param windowId The window whose visible tab is captured.
 */
async function throttledCapture(windowId: number) {
  for (let attempt = 0; ; attempt += 1) {
    const wait = lastCaptureAt + CAPTURE_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastCaptureAt = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 92 });
    } catch (error) {
      if (attempt > 0 || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(messageOf(error))) throw error;
      await sleep(CAPTURE_GAP * 2);
    }
  }
}

/**
 * Hides or shows Margin's overlay on a tab, so it stays out of the capture.
 * @param tabId The tab.
 * @param hidden True to hide it.
 */
async function setOverlayHidden(tabId: number, hidden: boolean) {
  await chrome.scripting.executeScript({ target: { tabId }, func: (hide: boolean) => window.__uiAnnotator?.hideForCapture(hide), args: [hidden] });
}

/**
 * Scrolls a tab to where a comment was made and cuts the same region from a fresh capture. The change hint is left
 * out when the window width differs, because the crop is shifted then.
 * @param tab The tab showing the comment's page.
 * @param comment The stored comment.
 */
async function recaptureRegion(tab: TabWithId, comment: Comment) {
  const width = await inTab(
    tab.id,
    async (top: number) => {
      window.scrollTo({ top, behavior: 'instant' });
      await new Promise((resolve) => setTimeout(resolve, 350));
      return window.innerWidth;
    },
    [comment.viewport?.scrollY ?? 0],
  );
  const bitmap = await decodeImage(await throttledCapture(tab.windowId));
  const { box, crop } = cropAround(bitmap, comment.rect, bitmap.width / width);
  const after = await drawRegion(bitmap, crop, box, MAX_DETAIL_WIDTH);
  const change = width === comment.viewport?.width ? await regionChange(comment, bitmap, box) : null;
  bitmap.close();
  return { after, checkedAt: new Date().toISOString(), change };
}

/**
 * How much a comment's region differs between its clean base screenshot and a new capture, from 0 to 1. Both are
 * shrunk to a grey grid of about DIFF_CELL CSS pixels a cell, at most DIFF_WIDTH cells wide, and the share of cells
 * that moved by more than DIFF_LEVEL is returned. Null when the base has the region outline burned in or is missing.
 * @param comment The stored comment.
 * @param bitmap The new capture.
 * @param box The region in the new capture.
 */
async function regionChange(comment: Comment, bitmap: ImageBitmap, box: Rect) {
  const screenshot = await readScreenshot(comment.id);
  if (!screenshot || screenshot.hasBox) return null;
  const base = await decodeImage(screenshot.src);
  const width = Math.max(1, Math.min(DIFF_WIDTH, Math.round(comment.rect.w / DIFF_CELL)));
  const height = Math.max(1, Math.round((width * comment.rect.h) / comment.rect.w));
  const grey = (image: ImageBitmap, source: Rect) => {
    const context = context2d(new OffscreenCanvas(width, height), { willReadFrequently: true });
    context.drawImage(image, source.x, source.y, source.w, source.h, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    return Array.from({ length: width * height }, (_, cell) => (data[cell * 4] ?? 0) * 0.299 + (data[cell * 4 + 1] ?? 0) * 0.587 + (data[cell * 4 + 2] ?? 0) * 0.114);
  };
  const before = grey(base, cropAround(base, comment.rect, base.width / comment.viewport.width).box);
  base.close();
  const now = grey(bitmap, box);
  const moved = before.filter((value, cell) => Math.abs(value - (now[cell] ?? 0)) > DIFF_LEVEL).length;
  return Math.round((moved / before.length) * 1000) / 1000;
}

/**
 * Rechecks each comment in turn on one tab, with the overlay hidden, and puts the scroll position back after. Escape
 * on the page, the Cancel button or leaving the tab stops it. Progress shows on the badge and in storage. When it ends
 * the report opens on the check view, or the report that started it comes back to the front.
 * @param run The live run, flagged when cancelled.
 * @param tab The tab being checked.
 * @param targets The comments made on that tab's page.
 * @param groupId The review they belong to.
 * @param report The report tab that started the run, if it was not the popup.
 */
async function runVerify(run: { cancelled: boolean }, tab: TabWithId, targets: Comment[], groupId: string, report: chrome.tabs.Tab | null) {
  const state: Omit<VerifyRun, 'at'> = { state: 'running', groupId, page: tab.url ?? '', title: tab.title ?? '', total: targets.length, done: 0, checked: [], failed: [] };
  const publish = () => verifyRunItem.setValue({ ...state, at: Date.now() });
  let left = false;
  let startY = 0;
  await publish();
  try {
    if (report) await chrome.tabs.update(tab.id, { active: true });
    startY = await inTab(
      tab.id,
      () => {
        window.__uiAnnotator?.hideForCapture(true);
        window.__marginVerifyKey = (event) => {
          if (event.key === 'Escape') chrome.runtime.sendMessage({ type: 'verifyCancel' });
        };
        window.addEventListener('keydown', window.__marginVerifyKey, true);
        return window.scrollY;
      },
      [],
    );
    for (const comment of targets) {
      const [front] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      left = front?.id !== tab.id;
      if (run.cancelled || left) break;
      await chrome.action.setBadgeText({ text: `${state.done + 1}/${state.total}` });
      try {
        await patchComment(comment.id, await recaptureRegion(tab, comment));
        state.checked.push(comment.id);
      } catch (error) {
        console.warn(`Margin: could not recheck comment ${comment.id}`, error);
        state.failed.push(comment.id);
      }
      state.done += 1;
      await publish();
    }
  } finally {
    await bestEffort(
      inTab(
        tab.id,
        (top: number) => {
          if (window.__marginVerifyKey) window.removeEventListener('keydown', window.__marginVerifyKey, true);
          delete window.__marginVerifyKey;
          window.__uiAnnotator?.hideForCapture(false);
          window.scrollTo({ top, behavior: 'instant' });
        },
        [startY ?? 0],
      ),
      'restore the checked page',
    );
    state.state = run.cancelled || left ? 'cancelled' : 'done';
    await publish();
    liveVerify = null;
    await refreshBadge();
    if (report?.id && !left) await bestEffort(chrome.tabs.update(report.id, { active: true }), 'bring the report back');
    else if (!report && !left && state.checked.length) {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?group=${groupId}&verify=1`) });
    }
  }
}

/**
 * True when two addresses are the same page, ignoring the query and hash.
 * @param first One address.
 * @param second The other.
 */
function samePage(first: string | undefined, second: string | undefined) {
  if (!first || !second) return false;
  try {
    const one = new URL(first);
    const other = new URL(second);
    return one.origin === other.origin && one.pathname === other.pathname;
  } catch {
    // An address that does not parse, such as an empty page title used as a URL, is never the same page.
    return false;
  }
}

/**
 * Answers one typed message with its handler.
 * @param name The message name.
 */
function serve<Name extends ActionName>(name: Name) {
  onMessage(name, ({ data, sender }) => handlers[name](data, sender));
}

serveStoreWrites();
(Object.keys(handlers) as ActionName[]).forEach(serve);

/** The messages the older screens send as `{ type, ...data }`. Store writes are typed messages only. */
const LEGACY_NAMES = new Set<ActionName>([
  'toggle',
  'capture',
  'update',
  'keep',
  'discard',
  'annotating',
  'comment',
  'openReport',
  'groups',
  'groupCreate',
  'groupSelect',
  'groupRename',
  'groupDelete',
  'captureWidths',
  'importReview',
  'activeReview',
  'editorBase',
  'annotate',
  'quickMark',
  'markNote',
  'recropGroup',
  'recheck',
  'verifyStart',
  'verifyCancel',
  'pageComments',
]);

/**
 * True for a message from an older screen. Typed messages carry a numeric timestamp and are answered by `serve`.
 * @param message What arrived.
 */
function isLegacyMessage(message: unknown): message is { type: ActionName } {
  if (typeof message !== 'object' || message === null || !('type' in message) || 'timestamp' in message) return false;
  return LEGACY_NAMES.has(message.type as ActionName);
}

/**
 * Answers one message from an older screen. Its fields are the handler's data, as the older screens send them.
 * @param name The message name.
 * @param data The message.
 * @param sender Where it came from.
 */
function answerLegacy<Name extends ActionName>(name: Name, data: MessageData<Name>, sender: chrome.runtime.MessageSender) {
  return handlers[name](data, sender);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isLegacyMessage(message)) return false;
  answerLegacy(message.type, message as MessageData<ActionName>, sender).then(sendResponse, (error: unknown) => sendResponse({ error: messageOf(error) }));
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-annotate') return;
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => toggleTab(tab))
    .catch((error) => console.error('Margin: the shortcut could not toggle annotation', error));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.issues) refreshBadge().catch((error) => console.error('Margin: could not update the badge', error));
});

/** Puts comments captured before reviews existed into one, so none are hidden. */
async function migrateOrphans() {
  await queueWrite(async (steps) => {
    const orphans = (await readComments()).filter((comment) => !comment.groupId);
    if (!orphans.length) return;
    const review = (await readReviews()).find((entry) => entry.name === 'Earlier comments') ?? (await steps.addReview('Earlier comments'));
    for (const orphan of orphans) await steps.patchComment(orphan.id, { groupId: review.id });
  });
}

let migration: Promise<boolean> | null = null;

/**
 * Moves images out of the comment list, once per worker start. It runs when the worker starts for any reason, so a
 * migration cut short by a stopped worker carries on at the next start, and returns at once when there is nothing to move.
 */
function migrateOnce() {
  migration ??= migrateImages((line) => console.warn(line)).catch((error) => {
    console.error('Margin: image migration stopped, it will run again on the next start', error);
    migration = null;
    return false;
  });
  return migration;
}

migrateOnce();

/** Sets up menus, migrations, drafts and the badge when the browser starts or Margin is installed or updated. */
async function boot() {
  await migrateOnce();
  await createMenus();
  await storage.removeItems(RETIRED_KEYS);
  await migrateOrphans();
  await sweepDrafts(0);
  await refreshBadge();
}

chrome.runtime.onStartup.addListener(() => {
  boot().catch((error) => console.error('Margin: start-up stopped', error));
});
chrome.runtime.onInstalled.addListener(({ reason }) => {
  boot()
    .then(async () => {
      if (reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    })
    .catch((error) => console.error('Margin: set-up after install stopped', error));
});
