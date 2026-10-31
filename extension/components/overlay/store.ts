import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { SeverityKey } from '@/components/margin/severity';

export type Rect = { x: number; y: number; w: number; h: number };

export type Viewport = { width: number; height: number; scrollY: number; dpr?: number };

export type Anchor = {
  selector: string;
  nth: number;
  tag: string;
  text: string;
  box: { fx: number; fy: number; fw: number; fh: number };
};

export type ElementInfo = {
  selector: string;
  tag: string;
  id: string;
  classes: string;
  text: string;
  styles: { color: string; background: string; font: string };
};

/** A page element under the pointer, as hit testing found it. `frame` is true for a frame Margin cannot look into. */
export type Picked = { el: Element; rect: Rect; full: boolean; frame?: Element | boolean };

export type Mark = { x: number; y: number; note: string };

export type FigmaFrame = { fileKey: string; nodeId: string; name: string; page: string };

export type FigmaFile = { name?: string; fileKey: string; frames?: { id: string; name: string; page?: string }[] };

export type Review = { id: string; name: string; figma?: FigmaFile };

/** A comment saved on this page, as the background lists it. */
export type PageComment = {
  id: string;
  n: number;
  title?: string;
  note?: string;
  severity?: string;
  status?: string;
  frame?: string;
  rect: Rect;
  anchor?: Anchor | null;
  viewport?: Viewport;
};

export type CaptureMsg = { type: 'capture'; rect: Rect; element: ElementInfo | null; anchor: Anchor | null; viewport: Viewport };

/** The fields a person fills in on the composer. */
export type Draft = {
  title: string;
  note: string;
  severity: SeverityKey;
  marks: Mark[];
  frame: FigmaFrame | null;
  link: string;
};

export type Asking = 'discard' | 'delete' | 'changes';

/** The open composer: the captured area, what it is stored as, and the fields being edited. */
export type Card = Draft & {
  id: string | null;
  rect: Rect;
  element: ElementInfo | null;
  msg: CaptureMsg | null;
  viewport: Viewport;
  anchor: Anchor | null;
  extraMarks: object[];
  number: number;
  reopened: boolean;
  hasShot: boolean;
  hadFrame: boolean;
  error: string | null;
  original: string;
  showLink: boolean;
  placing: boolean;
  picker: { page: string; query: string; active: number } | null;
  asking: Asking | null;
  saving: boolean;
  retrying: boolean;
  more: boolean;
  widths: 'idle' | 'busy' | 'done' | 'failed';
};

export type Toast =
  | { kind: 'plain'; id: number; text: string }
  | { kind: 'saved'; id: number; number: number; box: { left: number; bottom: number } };

export type OverlayState = {
  active: boolean;
  /** Page pixels per overlay pixel, which counters the tab's browser zoom. */
  scale: number;
  /** Bumped once per frame while the page scrolls or resizes, so anything placed on the page follows it. */
  frame: number;
  /** The review name the background sent with start, shown until the review itself loads. */
  reviewName: string;
  passing: boolean;
  capturing: boolean;
  saving: Rect | null;
  drag: Rect | null;
  hover: Picked | null;
  barAtTop: boolean;
  card: Card | null;
  menu: { x: number; y: number; target: Rect | null } | null;
  popover: 'options' | 'help' | null;
  toast: Toast | null;
  tip: string | null;
  /** Set while a redraw waits for a new area, with the comment whose old area is kept until then. */
  pending: { oldId: string | null } | null;
};

/**
 * The overlay's own state, shared by the React UI and the plain TypeScript pointer and hit testing code, which use
 * the vanilla store API. Settings and saved comments are read from storage through React Query instead.
 */
const overlayStore = createStore<OverlayState>()(() => ({
  active: false,
  scale: 1,
  frame: 0,
  reviewName: 'Margin',
  passing: false,
  capturing: false,
  saving: null,
  drag: null,
  hover: null,
  barAtTop: false,
  card: null,
  menu: null,
  popover: null,
  toast: null,
  tip: null,
  pending: null,
}));

export const getState = overlayStore.getState;

export const setState = (patch: Partial<OverlayState>) => overlayStore.setState(patch);

/** Changes the open composer, if there is one. */
export function patchCard(patch: Partial<Card> | ((card: Card) => Partial<Card>)) {
  const card = getState().card;
  if (!card) return;
  setState({ card: { ...card, ...(typeof patch === 'function' ? patch(card) : patch) } });
}

/** Reads one slice of the overlay state and re-renders only when that slice changes. */
export const useOverlay = <T,>(select: (s: OverlayState) => T): T => useStore(overlayStore, select);
