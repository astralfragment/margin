import { create, useStore } from 'zustand';
import { temporal } from 'zundo';
import { toast } from 'sonner';
import type { Comment, CommentImages, Marker, Rect } from '@/lib/model';
import { ask, putImages, queryClient } from '../data';
import { putMarks } from '../quick-marks';
import { confirm } from '../confirm';
import { useReportUi } from '../ui-store';

/**
 * The image editor's state. Markers and the region are what Undo steps through. Everything else, such as the tool,
 * the zoom and a shape being dragged, is left out of the history. Edits save a moment after the last change, and the
 * service worker draws the saved images, so the editor never exports from its canvas.
 */

export type Tool = 'select' | 'dot' | 'box' | 'arrow';
export type Selection = number | 'region' | null;

/** A shape being dragged, drawn in place of the stored one until the drag ends. */
export interface Draft {
  target: number | 'region' | 'new';
  shape: Marker | Rect;
}

interface EditorState {
  commentId: string | null;
  number: number;
  image: HTMLImageElement | null;
  /** The size of the area the image shows in, for Fit. */
  view: { width: number; height: number };
  /** True for comments captured before clean screenshots were kept, whose region is part of the image. */
  hasBox: boolean;
  /** The captured viewport in CSS pixels, the space markers are stored in. */
  width: number;
  height: number;
  marks: Marker[];
  rect: Rect;
  startRect: Rect;
  /** The images cut at the region when the editor opened, which moving the region drops. */
  cut: string[];
  selected: Selection;
  tool: Tool;
  zoom: number;
  fit: boolean;
  draft: Draft | null;
  status: string;
}

const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export const useEditor = create<EditorState>()(
  temporal(
    (): EditorState => ({
      commentId: null,
      number: 0,
      image: null,
      view: { width: 0, height: 0 },
      hasBox: false,
      width: 0,
      height: 0,
      marks: [],
      rect: EMPTY_RECT,
      startRect: EMPTY_RECT,
      cut: [],
      selected: null,
      tool: 'select',
      zoom: 1,
      fit: true,
      draft: null,
      status: '',
    }),
    {
      partialize: ({ marks, rect }) => ({ marks, rect }),
      equality: (past, next) => JSON.stringify(past) === JSON.stringify(next),
      limit: 100,
    },
  ),
);

/** Whether Undo and Redo each have a step to take. */
export function useHistory() {
  const canUndo = useStore(useEditor.temporal, (state) => state.pastStates.length > 0);
  const canRedo = useStore(useEditor.temporal, (state) => state.futureStates.length > 0);
  return { canUndo, canRedo };
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

/**
 * Changes the zoom to a factor, a step, or the size that fits the window.
 * @param next The factor, or in, out or fit.
 */
export function setZoom(next: number | 'in' | 'out' | 'fit') {
  const { zoom, view, width, height } = useEditor.getState();
  if (next === 'fit') {
    if (!view.width || !width) return;
    const fitted = Math.min((view.width - 32) / width, (view.height - 32) / height);
    useEditor.setState({ fit: true, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitted)) });
    return;
  }
  const factor = next === 'in' ? zoom * 1.25 : next === 'out' ? zoom / 1.25 : next;
  useEditor.setState({ fit: false, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor)) });
}

/**
 * Records the size of the area the image shows in, and fits the image again when Fit is on.
 * @param view The area's size.
 */
export function setView(view: { width: number; height: number }) {
  useEditor.setState({ view });
  if (useEditor.getState().fit) setZoom('fit');
}

/**
 * Picks the drawing tool.
 * @param tool The tool.
 */
export const setTool = (tool: Tool) => useEditor.setState({ tool });

/**
 * Selects a marker or the region, or clears the selection.
 * @param selected What to select.
 */
export const select = (selected: Selection) => useEditor.setState({ selected });

/**
 * Adds a marker and selects it.
 * @param mark The marker in page pixels, without its note.
 */
export function addMark(mark: Omit<Marker, 'note'>) {
  const marks = [...useEditor.getState().marks, { note: '', ...mark }];
  useEditor.setState({ marks, selected: marks.length - 1 });
}

/**
 * Removes a marker. The ones after it move up a number.
 * @param index The marker's place.
 */
export function removeMark(index: number) {
  useEditor.setState({ marks: useEditor.getState().marks.filter((_mark, place) => place !== index), selected: null });
}

/**
 * Replaces one marker.
 * @param index The marker's place.
 * @param mark The new marker.
 */
export function replaceMark(index: number, mark: Marker) {
  useEditor.setState({ marks: useEditor.getState().marks.map((old, place) => (place === index ? mark : old)) });
}

/**
 * Moves a marker one place earlier or later in the numbering.
 * @param index The marker's place.
 * @param step -1 for earlier, 1 for later.
 */
export function renumber(index: number, step: number) {
  const marks = [...useEditor.getState().marks];
  const other = index + step;
  const [mark, swapped] = [marks[index], marks[other]];
  if (!mark || !swapped) return;
  marks[index] = swapped;
  marks[other] = mark;
  useEditor.setState({ marks, selected: other });
}

/**
 * Writes a marker's note. Typing is not an Undo step.
 * @param index The marker's place.
 * @param note The note.
 */
export function setNote(index: number, note: string) {
  setMarksQuietly(useEditor.getState().marks.map((mark, place) => (place === index ? { ...mark, note } : mark)));
}

/** Puts the region back where the comment was captured. */
export const resetRegion = () => useEditor.setState({ rect: { ...useEditor.getState().startRect } });

/** Steps back one change. */
export const undo = () => {
  useEditor.temporal.getState().undo();
  useEditor.setState({ selected: null, draft: null });
};

/** Steps forward one change. */
export const redo = () => {
  useEditor.temporal.getState().redo();
  useEditor.setState({ selected: null, draft: null });
};

/**
 * Changes the markers without adding a step to the history, as typing a note does.
 * @param marks The markers.
 */
export function setMarksQuietly(marks: Marker[]) {
  const history = useEditor.temporal.getState();
  history.pause();
  useEditor.setState({ marks });
  history.resume();
}

/**
 * The images a comment has that were cut at its region, named for the confirm message.
 * @param images The comment's images.
 */
function cutAtRegion(images: CommentImages) {
  const widths = Object.values(images.shots ?? {}).filter((shot) => shot?.src).length;
  return [widths ? `the ${widths} width ${widths === 1 ? 'shot' : 'shots'}` : '', images.after ? 'the recheck image' : ''].filter(Boolean);
}

/**
 * Opens the editor on a comment once its clean screenshot has loaded.
 * @param comment The comment.
 * @param number Its number, for the heading.
 */
export async function openEditor(comment: Comment, number: number) {
  try {
    const base = await ask('editorBase', { id: comment.id });
    const image = new Image();
    image.src = base.src;
    await image.decode();
    const images = queryClient.getQueryData<CommentImages>(['images', comment.id]) ?? {};
    const width = comment.viewport.width;
    useEditor.setState({
      commentId: comment.id,
      number,
      image,
      hasBox: base.hasBox,
      width,
      height: (width * image.naturalHeight) / image.naturalWidth,
      marks: structuredClone(comment.marks ?? []),
      rect: { ...comment.rect },
      startRect: { ...comment.rect },
      cut: cutAtRegion(images),
      selected: null,
      tool: 'select',
      fit: true,
      draft: null,
      status: base.hasBox ? 'Captured before clean screenshots were kept, so the region is fixed. Annotations still work.' : '',
    });
    useEditor.temporal.getState().clear();
    useReportUi.setState({ editorId: comment.id });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

/** True when the region has moved since the editor opened. */
const regionMoved = () => {
  const { hasBox, rect, startRect } = useEditor.getState();
  return !hasBox && JSON.stringify(rect) !== JSON.stringify(startRect);
};

/** The pending save: its timer, whether there is anything to save, and the save in flight. */
const pending = { timer: 0, dirty: false, saving: Promise.resolve() };

/**
 * Stores the markers and region, and puts the redrawn images in the report.
 * @param drop True on the last save when the region moved, which drops the images cut at the old region.
 */
function save(drop = false) {
  clearTimeout(pending.timer);
  const { commentId, marks, rect, hasBox, cut } = useEditor.getState();
  if (!commentId || (!pending.dirty && !drop)) return pending.saving;
  pending.dirty = false;
  pending.saving = pending.saving.then(async () => {
    useEditor.setState({ status: 'Saving' });
    try {
      const reply = await ask('annotate', { id: commentId, marks, rect, drop });
      putImages(commentId, { ...reply, ...(drop ? { after: null, shots: null } : {}) });
      putMarks(commentId, marks);
      if (!hasBox) {
        queryClient.setQueriesData<Comment[]>({ queryKey: ['comments'] }, (list) => list?.map((comment) => (comment.id === commentId ? { ...comment, rect } : comment)));
      }
      if (useEditor.getState().commentId !== commentId) return;
      const blank = marks.filter((mark) => !mark.note?.trim()).length;
      useEditor.setState({
        status:
          regionMoved() && cut.length
            ? `Saved. Closing with the region moved drops ${cut.join(' and ')}.`
            : blank
              ? `Saved. Write a note for ${blank} so ${blank === 1 ? 'it shows' : 'they show'} in the list.`
              : 'Saved',
      });
    } catch (error) {
      useEditor.setState({ status: error instanceof Error ? error.message : String(error) });
    }
  });
  return pending.saving;
}

useEditor.subscribe((state, previous) => {
  if (!state.commentId || state.commentId !== previous.commentId) return;
  if (state.marks === previous.marks && state.rect === previous.rect) return;
  pending.dirty = true;
  clearTimeout(pending.timer);
  pending.timer = window.setTimeout(() => save(), 500);
});

/**
 * Closes the editor after the last save. When the region moved and images were cut at the old one, asks first
 * whether to keep the move, which drops them, or put the region back.
 * @returns False when the reviewer chose to keep editing.
 */
export async function closeEditor() {
  const { commentId, cut, startRect } = useEditor.getState();
  if (!commentId) return true;
  let drop = false;
  if (regionMoved() && cut.length) {
    const choice = await confirm({
      title: 'Keep the moved region?',
      body: `Moving the region drops ${cut.join(' and ')}, which were cut at the old region. Capture them again from the page afterwards.`,
      choices: [
        { label: 'Keep editing', value: null },
        { label: 'Put the region back', value: 'back', variant: 'outline' },
        { label: 'Keep the move', value: 'keep' },
      ],
    });
    if (!choice) return false;
    if (choice === 'back') useEditor.setState({ rect: { ...startRect } });
    drop = choice === 'keep';
  } else {
    drop = regionMoved();
  }
  await save(drop);
  useEditor.setState({ commentId: null, draft: null });
  useReportUi.setState({ editorId: null });
  return true;
}
