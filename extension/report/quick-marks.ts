import { create } from 'zustand';
import { toast } from 'sonner';
import type { Comment, CommentImages, Marker, Rect } from '@/lib/model';
import { ask, putImages, queryClient } from './data';
import { useReportUi } from './ui-store';
import { pad } from './format';

/**
 * Numbered markers placed straight on the report's screenshots. A click adds one and asks for its note, a click on a
 * number edits it, and every removal offers Undo. The service worker redraws the images and replies with them.
 */

/** Which image of a comment takes markers: the padded crop round the region, or the whole viewport. */
export type MarkableImage = 'detail' | 'shot';

/** The marker a person is pointing at, in the notes list or on a screenshot, so both light up together. */
export const useMarkerHover = create<{ commentId: string; index: number } | null>(() => null);

/*
 * The padding the service worker cuts round a region for the detail image, in CSS pixels. It matches cropAround in
 * background.ts, and an image whose shape does not match the crop worked out here gets no overlays.
 */
const DETAIL_PADDING = 72;
const MIN_DETAIL_WIDTH = 640;
const MIN_DETAIL_HEIGHT = 360;

/**
 * The part of the viewport an image shows, in viewport CSS pixels.
 * @param comment The comment, with its region and viewport.
 * @param image Which image.
 */
export function imageArea(comment: Pick<Comment, 'rect' | 'viewport'>, image: MarkableImage): Rect {
  const { width, height } = comment.viewport;
  if (image === 'shot') return { x: 0, y: 0, w: width, h: height };
  const { rect } = comment;
  const padX = Math.max(DETAIL_PADDING, (MIN_DETAIL_WIDTH - rect.w) / 2);
  const padY = Math.max(DETAIL_PADDING, (MIN_DETAIL_HEIGHT - rect.h) / 2);
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  return { x, y, w: Math.min(width - x, rect.w + padX * 2), h: Math.min(height - y, rect.h + padY * 2) };
}

/**
 * True when an image has the shape its area says it should, so overlays line up with what is drawn in it.
 * @param area The area from imageArea.
 * @param naturalWidth The image's width.
 * @param naturalHeight The image's height.
 */
export function areaFits(area: Rect, naturalWidth: number, naturalHeight: number) {
  if (!naturalWidth || !naturalHeight || !area.w || !area.h) return false;
  const expected = area.w / area.h;
  return Math.abs(naturalWidth / naturalHeight - expected) / expected < 0.02;
}

/**
 * Puts a comment's new markers into every cached comment list, so the card redraws at once.
 * @param id The comment id.
 * @param marks Its markers.
 */
export function putMarks(id: string, marks: Marker[]) {
  queryClient.setQueriesData<Comment[]>({ queryKey: ['comments'] }, (list) =>
    list?.map((comment) => (comment.id === id ? { ...comment, marks } : comment)),
  );
}

/**
 * Stores what a quick marker reply carries.
 * @param id The comment id.
 * @param reply The markers and any redrawn images.
 */
function apply(id: string, reply: { marks: Marker[] } & CommentImages) {
  const { marks, ...images } = reply;
  putMarks(id, marks);
  if (images.shot || images.detail) putImages(id, { shot: images.shot, detail: images.detail });
}

/**
 * Says what went wrong in a toast.
 * @param error The failure.
 */
const fail = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error));

/**
 * Removes one marker without offering Undo, used for a fresh marker left without a note.
 * @param id The comment id.
 * @param index The marker's place in its list.
 */
async function drop(id: string, index: number) {
  try {
    apply(id, await ask('quickMark', { id, action: 'drop', index, image: 'detail', fx: 0, fy: 0 }));
  } catch (error) {
    fail(error);
  }
}

/**
 * Offers to put a comment's markers back as they were before a removal.
 * @param comment The comment.
 * @param before Its markers before the removal.
 * @param index The removed marker's place.
 * @param number The comment's number.
 */
function offerUndo(comment: Comment, before: Marker[], index: number, number: number) {
  toast(`Removed marker ${index + 1} from comment ${pad(number)}`, {
    action: {
      label: 'Undo',
      onClick: async () => {
        try {
          const reply = await ask('annotate', { id: comment.id, marks: before, rect: comment.rect });
          apply(comment.id, { marks: before, ...reply });
        } catch (error) {
          fail(error);
        }
      },
    },
  });
}

/**
 * Removes a marker and offers Undo.
 * @param comment The comment.
 * @param index The marker's place.
 * @param number The comment's number.
 */
export async function removeMarker(comment: Comment, index: number, number: number) {
  const before = structuredClone(comment.marks ?? []);
  if (useReportUi.getState().note?.commentId === comment.id) useReportUi.setState({ note: null });
  useMarkerHover.setState(null, true);
  await drop(comment.id, index);
  offerUndo(comment, before, index, number);
}

/** Closes the note box. A marker placed a moment ago and still without a note is removed, so blank markers never stay. */
export async function closeNote() {
  const note = useReportUi.getState().note;
  useReportUi.setState({ note: null });
  if (note?.fresh) await drop(note.commentId, note.index);
}

/**
 * Opens the note box of a marker that already exists, under the element that was clicked.
 * @param commentId The comment id.
 * @param index The marker's place.
 * @param anchor The number on the screenshot or the button in the notes list.
 */
export async function editNote(commentId: string, index: number, anchor: Element) {
  await closeNote();
  const box = anchor.getBoundingClientRect();
  useReportUi.setState({ note: { commentId, index, fresh: false, x: box.left + box.width / 2, y: box.top + box.height / 2 } });
}

/**
 * Saves a marker's note.
 * @param commentId The comment id.
 * @param index The marker's place.
 * @param text The note.
 */
export async function saveNote(commentId: string, index: number, text: string) {
  useReportUi.setState({ note: null });
  try {
    const reply = await ask('markNote', { id: commentId, index, note: text });
    putMarks(commentId, reply.marks);
  } catch (error) {
    fail(error);
  }
}

/**
 * Removes the marker whose note box is open: quietly when it was just placed, else with Undo.
 * @param comment The comment.
 * @param number Its number.
 */
export async function removeNoted(comment: Comment, number: number) {
  const note = useReportUi.getState().note;
  if (!note) return;
  useReportUi.setState({ note: null });
  if (note.fresh) await drop(note.commentId, note.index);
  else await removeMarker(comment, note.index, number);
}

/**
 * Adds a numbered marker where a screenshot was clicked and opens its note box there.
 * @param comment The comment the screenshot belongs to.
 * @param image Which of its images was clicked.
 * @param click Where it was clicked as fractions of the image, the image's width over height, and the point on screen.
 */
export async function addMarker(comment: Comment, image: MarkableImage, click: { fx: number; fy: number; aspect: number; x: number; y: number }) {
  await closeNote();
  try {
    const reply = await ask('quickMark', { id: comment.id, action: 'add', image, fx: click.fx, fy: click.fy, aspect: click.aspect });
    if (reply.stale) {
      apply(comment.id, reply);
      toast.info('The image was redrawn with the current crop. Click again to place the marker.');
      return;
    }
    if (reply.index == null) return;
    apply(comment.id, reply);
    useReportUi.setState({ note: { commentId: comment.id, index: reply.index, fresh: true, x: click.x, y: click.y } });
  } catch (error) {
    fail(error);
  }
}
