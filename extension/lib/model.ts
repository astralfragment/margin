/**
 * The domain types, named the way the screens talk. Storage keeps older names: a review is stored in `groups`,
 * a comment in `issues`, a comment's review id as `groupId` and its clean screenshot under `raw:<id>`.
 * Only lib/storage.ts knows the stored key names.
 */

/** A region in viewport CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MarkerKind = 'dot' | 'box' | 'arrow';

/** A numbered marker drawn on a comment's screenshot, in viewport CSS pixels. Arrows point from x, y to x2, y2. */
export interface Marker {
  kind: MarkerKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  note: string;
}

export type Severity = 'blocker' | 'major' | 'minor' | 'nit';

export type CommentStatus = 'open' | 'fixed' | 'wontfix';

/** The page a comment was made on. */
export interface PageRef {
  url: string;
  title: string;
}

/** The viewport a comment was captured in. */
export interface Viewport {
  width: number;
  height: number;
  scrollY: number;
  dpr: number;
}

/** The browser, system and zoom a comment was captured with. Zoom is a percentage. */
export interface Environment {
  browser: string;
  os: string;
  zoom: number;
}

/** What a developer needs to find the picked element again. */
export interface ElementInfo {
  selector: string;
  tag: string;
  id?: string;
  classes: string;
  text: string;
  styles?: { color?: string; background?: string; font?: string };
}

/**
 * Ties a comment's region to an element, so it can be found again at another width. The box holds the region as
 * fractions of the element's box.
 */
export interface Anchor {
  selector: string;
  nth: number;
  tag: string;
  text: string;
  box: { fx: number; fy: number; fw: number; fh: number };
}

/** A Jira ticket linked to a review or created for a comment. Only the key and address are always there. */
export interface JiraLink {
  key: string;
  url: string;
  summary?: string;
  status?: string;
  statusCategory?: string;
  assignee?: string;
  description?: string;
  fetchedAt?: string;
}

/** A frame inside the Figma file linked to a review, as listed for picking. */
export interface FigmaFileFrame {
  id: string;
  name: string;
  page: string;
}

/** The Figma file linked to a review. */
export interface FigmaFile {
  fileKey: string;
  url: string;
  name: string;
  frames?: FigmaFileFrame[];
  fetchedAt?: string;
}

/** The Figma frame a comment points at. */
export interface FigmaFrame {
  fileKey: string;
  nodeId: string;
  name: string;
  page: string;
}

/** A comment posted to Figma for a Margin comment. */
export interface FigmaPost {
  fileKey: string;
  nodeId: string;
  commentId: string;
  at: string | null;
}

/** A review groups the comments made in one sitting. Stored in `groups`. */
export interface Review {
  id: string;
  name: string;
  createdAt: string;
  jira?: JiraLink | null;
  figma?: FigmaFile | null;
  /** The site the review was started on. */
  site?: string;
  /** Other sites the review was picked on, so the popup offers it there too. */
  pickedOn?: string[];
}

export type WidthKey = 'mobile' | 'tablet' | 'desktop';

/** Where a region was placed at a width: on its element, at the saved spot because it was hidden, or because it was gone. */
export type Placement = 'found' | 'hidden' | 'lost';

/** A comment's region captured at one width. */
export interface WidthShot {
  src: string;
  width: number;
  placed: Placement;
}

export type WidthShots = Partial<Record<WidthKey, WidthShot>>;

/**
 * A comment's images, stored apart from the comment under `img:<id>` so the comment list stays small.
 * A field set to null has been removed.
 */
export interface CommentImages {
  /** The whole viewport with the region and markers. */
  shot?: string | null;
  /** A padded crop of the region with its markers. */
  detail?: string | null;
  /** The region captured again by a recheck. */
  after?: string | null;
  shots?: WidthShots | null;
}

export const IMAGE_FIELDS = ['shot', 'detail', 'after', 'shots'] as const satisfies readonly (keyof CommentImages)[];

/**
 * The untouched screenshot a comment's images are redrawn from, stored under `raw:<id>`. `hasBox` is true for comments
 * captured before clean screenshots were kept, whose base already shows the region outline.
 */
export interface Screenshot {
  src: string;
  hasBox: boolean;
}

/** A comment on a page region, without its images. Stored in `issues`. Open drafts have the same shape. */
export interface Comment {
  id: string;
  /** The review the comment belongs to. */
  groupId: string;
  createdAt: string;
  severity: Severity;
  status: CommentStatus;
  title: string;
  note: string;
  page: PageRef;
  viewport: Viewport;
  env?: Environment;
  element: ElementInfo | null;
  anchor: Anchor | null;
  rect: Rect;
  marks?: Marker[];
  links?: string[];
  jira?: JiraLink;
  figmaFrame?: FigmaFrame | null;
  figmaPosts?: FigmaPost[];
  /** When the recheck image was taken. */
  checkedAt?: string | null;
  /** How much the region changed in the recheck, from 0 to 1. */
  change?: number | null;
  /** When the width shots were taken. */
  shotsAt?: string | null;
}

/** A comment with its images added back, for screens that show them. */
export type CommentWithImages = Comment & CommentImages;

/** The fields a save may change on a comment, images included. */
export type CommentPatch = Partial<Omit<Comment, 'id'>> & CommentImages;

/** A capture whose card has not been saved yet. Kept in `drafts` by id, so reports and counts never see it. */
export type Drafts = Record<string, Comment>;

export type VerifyState = 'running' | 'done' | 'cancelled';

/** The recheck run in progress or last finished, which the report follows. */
export interface VerifyRun {
  state: VerifyState;
  groupId: string;
  page: string;
  title: string;
  total: number;
  done: number;
  checked: string[];
  failed: string[];
  at: number;
}

export type ThemeChoice = 'light' | 'dark' | 'system';

export type ShotMode = 'both' | 'detail' | 'viewport';

export type WidthMode = 'show' | 'hide';

/** The detail rows a comment can show in the report and exports. */
export type FactField = 'page' | 'figma' | 'jira' | 'selector' | 'element' | 'text' | 'styles' | 'position' | 'captured' | 'browser';

/** The last Jira site, project and issue type a review was sent with. */
export interface JiraChoice {
  siteId: string;
  projectId: string;
  typeId: string;
  mode: string;
}

/** The review sheet's unsaved fields, kept for a while so they survive the popup closing. */
export interface ReviewSheetDraft {
  mode: 'new' | 'edit';
  scope: string | null;
  groupId: string | null;
  name: string;
  jira: string;
  figma: string;
  at: number;
}

/** A Figma file linked before, for the recent files list. */
export interface RecentFigmaFile {
  fileKey: string;
  url: string;
  name: string;
}

/** Signed-in access to Jira or Figma. */
export interface Connection {
  access: string;
  refresh: string | null;
  expiresAt: number;
  account?: { name?: string; email?: string };
  sites?: { id: string; url: string; name?: string }[];
}

export type Provider = 'jira' | 'figma';

/** The choices a person makes in Help and settings and the report. */
export interface Settings {
  theme: ThemeChoice;
  selectorMode: boolean;
  markerMode: boolean;
  fields: Partial<Record<FactField, boolean>>;
  shotMode: ShotMode;
  widthMode: WidthMode;
  /** Guided tours already seen, by name. */
  tours: Record<string, boolean>;
}
