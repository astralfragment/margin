import { defineExtensionMessaging, type GetDataType, type GetReturnType } from '@webext-core/messaging';
import type {
  Anchor,
  Comment,
  CommentImages,
  CommentPatch,
  CommentWithImages,
  ElementInfo,
  Marker,
  Rect,
  Review,
  Screenshot,
  Severity,
  CommentStatus,
  Viewport,
} from './model';

/** A failure the screen should show, such as a comment that is gone. */
export interface ErrorReply {
  error: string;
}

export interface Done {
  ok: true;
}

/** A comment as the overlay draws it on its page, numbered in the order the review's comments were made. */
export interface PageComment {
  id: string;
  number: number;
  title: string;
  note: string;
  severity: Severity;
  status: CommentStatus;
  rect: Rect;
  anchor: Anchor | null;
  viewport: Viewport;
  frame: string;
}

export type ReviewWithCount = Review & { count: number };

export interface CaptureRequest {
  rect: Rect;
  element: ElementInfo | null;
  anchor?: Anchor | null;
  viewport: Viewport;
  skipShot?: boolean;
}

export interface QuickMarkRequest {
  id: string;
  /** Which image was clicked: the region crop or the whole viewport. */
  image: 'detail' | 'shot';
  /** Where it was clicked, as fractions of the image. */
  fx: number;
  fy: number;
  /** The clicked image's width over height, to spot images cut with older padding. */
  aspect?: number;
  action: 'add' | 'remove' | 'drop';
  /** The marker to drop. */
  index?: number;
  /** How far from a marker a right-click still removes it, as a fraction of the image width. */
  reach?: number;
}

export interface QuickMarkReply extends CommentImages {
  marks: Marker[];
  index?: number | null;
  stale?: boolean;
  removed?: null;
}

/**
 * The store writes. Pages never write reviews, comments or their images themselves. They send these, and the service
 * worker runs them through its write queue.
 */
export interface StoreWrites {
  saveComments(comments: CommentWithImages[]): void;
  addComment(comment: CommentWithImages): CommentWithImages;
  patchComment(data: { id: string; patch: CommentPatch }): CommentWithImages | null;
  removeComment(id: string): void;
  clearComments(): void;
  writeImages(data: { id: string; images: CommentImages }): void;
  writeScreenshot(data: { id: string; screenshot: Screenshot }): void;
  addReview(name?: string | null): Review;
  patchReview(data: { id: string; patch: Partial<Omit<Review, 'id'>> }): Review | null;
  removeReview(id: string): void;
  selectReview(id: string): void;
}

/**
 * Every message the service worker answers. Screens send them with `sendMessage` from this file. The older screens
 * send the actions as `{ type, ...data }`, which the service worker also answers until they are rebuilt.
 */
export interface ProtocolMap extends StoreWrites {
  /** Annotation on the page. */
  toggle(): { active: boolean };
  annotating(data: { active: boolean }): Done;
  capture(data: CaptureRequest): { id: string };
  update(data: { id: string; patch: CommentPatch }): Done;
  keep(data: { id: string; patch: CommentPatch; marks?: Marker[] | null; notice?: string }): Done;
  discard(data: { id: string }): Done;
  comment(data: { id: string }): (Comment & { hasShot: boolean }) | ErrorReply;
  pageComments(data: { url?: string }): { total: number; comments: PageComment[] };
  captureWidths(data: { ids?: string[]; page?: boolean }): { message: string } | ErrorReply;

  /** Reviews. */
  openReport(): Done;
  groups(): { activeId: string; groups: ReviewWithCount[] };
  groupCreate(data: { name?: string }): { group: Review };
  groupSelect(data: { id: string }): Done;
  groupRename(data: { id: string; name: string }): { group: Review | null };
  groupDelete(data: { id: string }): Done;
  importReview(data: { contents: string }): { group: Review; count: number } | ErrorReply;
  activeReview(): Review;

  /** Screenshots and markers. */
  editorBase(data: { id: string }): Screenshot | ErrorReply;
  annotate(data: { id: string; marks: Marker[]; rect?: Rect; drop?: boolean }): { shot: string; detail: string } | ErrorReply;
  quickMark(data: QuickMarkRequest): QuickMarkReply | ErrorReply;
  markNote(data: { id: string; index: number; note: string }): { marks: Marker[] } | ErrorReply;
  recropGroup(data: { groupId: string }): { updated: number };

  /** Rechecks. */
  recheck(data: { id: string }): Done | ErrorReply;
  verifyStart(data: { groupId: string; ids?: string[]; width?: number }): { started: true; total: number } | ErrorReply;
  verifyCancel(): Done;
}

export type MessageName = keyof ProtocolMap;
export type StoreWriteName = keyof StoreWrites;
export type ActionName = Exclude<MessageName, StoreWriteName>;
export type MessageData<Name extends MessageName> = GetDataType<ProtocolMap[Name]>;
export type MessageReply<Name extends MessageName> = GetReturnType<ProtocolMap[Name]>;

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
