import type { Anchor, ElementInfo, FigmaFrame, Marker, Rect, Severity, Viewport } from '@/lib/model';
import type { CaptureRequest } from '@/lib/protocol';

/** A numbered marker the card places, in the capture's viewport pixels, which is how the screenshot is drawn on. */
export interface MarkerDraft {
  x: number;
  y: number;
  note: string;
}

/** The fields a person fills in on the card. */
export interface CardFields {
  title: string;
  note: string;
  severity: Severity;
  frame: FigmaFrame | null;
  /** Reference links pasted by hand, separated by spaces or commas. */
  link: string;
}

/** Fields to open a card with, after a redraw, an Edit from the saved toast, or a saved comment. */
export type CardDraft = Partial<CardFields> & { marks?: MarkerDraft[] };

/** What the footer is asking before something is lost. */
export type Asking = 'discard' | 'delete' | 'changes';

/** What opening a card needs. */
export interface OpenCardOptions {
  /** The stored draft or comment, or null when the capture failed. */
  id: string | null;
  rect: Rect;
  element: ElementInfo | null;
  /** The capture request, kept for Try again and for saving without a screenshot. */
  request?: CaptureRequest | null;
  error?: string | null;
  draft?: CardDraft;
  number?: number;
  /** True when the card reopens a comment that was already saved. */
  reopened?: boolean;
  hasShot?: boolean;
  viewport?: Viewport;
  anchor?: Anchor | null;
  /** Boxes and arrows drawn in the report's editor, kept as they are when the card saves. */
  extraMarks?: Marker[];
}

/** The comment card. */
export interface Card extends CardFields {
  id: string | null;
  request: CaptureRequest | null;
  rect: Rect;
  viewport: Viewport;
  anchor: Anchor | null;
  element: ElementInfo | null;
  extraMarks: Marker[];
  number: number;
  reopened: boolean;
  hasShot: boolean;
  /** True when the comment had a Figma frame when the card opened, so removing it is saved. */
  hadFrame: boolean;
  error: string | null;
  noteOpen: boolean;
  linkOpen: boolean;
  framePickerOpen: boolean;
  moreOpen: boolean;
  asking: Asking | null;
  busy: 'saving' | 'retrying' | null;
  /** The fields as they were when the card opened, to tell whether a saved comment changed. */
  original: string;
}

/** A card closed for a redraw, with what the new card starts from and the old card to bring back on Esc. */
export interface PendingRedraw {
  draft: CardDraft & { pageMarks: { pageX: number; pageY: number; note: string }[] };
  old: (OpenCardOptions & { draft: CardDraft }) | null;
}
