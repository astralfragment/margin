import { toast } from 'sonner';
import type { Comment, CommentImages, Marker } from '@/lib/model';
import { ask, putImages, queryClient } from './data';
import { useReportUi } from './ui-store';
import { pad } from './format';

/**
 * Numbered markers placed straight on the report's screenshots: a click adds one and asks for its note, a right-click
 * removes the nearest, and every removal offers Undo. The service worker redraws the images and replies with them.
 */

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
 * Adds a marker where a screenshot was clicked, or removes the one nearest a right-click.
 * @param comment The comment the screenshot belongs to.
 * @param number Its number.
 * @param image Which of its images was clicked.
 * @param event The click.
 * @param action Add or remove.
 */
export async function quickMark(
  comment: Comment,
  number: number,
  image: 'detail' | 'shot',
  event: React.MouseEvent<HTMLImageElement>,
  action: 'add' | 'remove',
) {
  const img = event.currentTarget;
  const box = img.getBoundingClientRect();
  const at = { x: event.clientX, y: event.clientY };
  await closeNote();
  const before = structuredClone(comment.marks ?? []);
  try {
    const reply = await ask('quickMark', {
      id: comment.id,
      action,
      image,
      fx: (at.x - box.left) / box.width,
      fy: (at.y - box.top) / box.height,
      aspect: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0,
      reach: 18 / box.width,
    });
    if (reply.stale) {
      apply(comment.id, reply);
      toast.info('The image was redrawn with the current crop. Click again to place the marker.');
      return;
    }
    if (reply.index == null) {
      if (action === 'remove') toast.info('No marker here. Right-click on a number to remove it.');
      return;
    }
    apply(comment.id, reply);
    if (action === 'add') useReportUi.setState({ note: { commentId: comment.id, index: reply.index, fresh: true, ...at } });
    else offerUndo(comment, before, reply.index, number);
  } catch (error) {
    fail(error);
  }
}
