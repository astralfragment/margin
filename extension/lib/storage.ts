import { storage, type StorageItemKey } from 'wxt/utils/storage';
import type {
  Comment,
  CommentImages,
  Connection,
  Drafts,
  FactField,
  JiraChoice,
  Provider,
  RecentFigmaFile,
  Review,
  ReviewSheetDraft,
  Screenshot,
  ShotMode,
  ThemeChoice,
  VerifyRun,
  WidthMode,
} from './model';

/**
 * Every storage key Margin uses, defined once. The keys keep the names older versions stored, so a comment list
 * lives in `issues` and the reviews in `groups`. Code outside this file uses the item names.
 */

const COMMENTS_KEY: StorageItemKey = 'local:issues';

export const commentsItem = storage.defineItem<Comment[]>(COMMENTS_KEY, { fallback: [] });
export const reviewsItem = storage.defineItem<Review[]>('local:groups', { fallback: [] });
export const activeReviewIdItem = storage.defineItem<string>('local:activeGroupId');
export const draftsItem = storage.defineItem<Drafts>('local:drafts', { fallback: {} });
export const verifyRunItem = storage.defineItem<VerifyRun>('local:verifyRun');

/** The shape the stored data is in. Version 2 keeps images out of the comment list. */
export const storeVersionItem = storage.defineItem<number>('local:storeVersion');
/** Set while the move of images out of the comment list is under way, so a later start resumes it. */
export const storeMigrationItem = storage.defineItem<{ startedAt: string }>('local:storeMigration');

export const themeItem = storage.defineItem<ThemeChoice>('local:theme', { fallback: 'system' });
export const selectorModeItem = storage.defineItem<boolean>('local:selectorMode', { fallback: false });
export const markerModeItem = storage.defineItem<boolean>('local:markerMode', { fallback: true });
export const factFieldsItem = storage.defineItem<Partial<Record<FactField, boolean>>>('local:fields', { fallback: {} });
export const shotModeItem = storage.defineItem<ShotMode>('local:shotMode', { fallback: 'both' });
export const widthModeItem = storage.defineItem<WidthMode>('local:widthMode', { fallback: 'show' });
export const toursSeenItem = storage.defineItem<Record<string, boolean>>('local:tours', { fallback: {} });

export const reviewSheetDraftItem = storage.defineItem<ReviewSheetDraft>('local:reviewDraft');
export const jiraSiteItem = storage.defineItem<string>('local:jiraSite');
export const jiraChoiceItem = storage.defineItem<JiraChoice>('local:jiraChoice');
export const recentFigmaFilesItem = storage.defineItem<RecentFigmaFile[]>('local:figmaRecent', { fallback: [] });
export const connectionsItem = storage.defineItem<Partial<Record<Provider, Connection>>>('local:connections', { fallback: {} });

/** Keys left by the Fragment integration, which has been removed. */
export const RETIRED_KEYS: StorageItemKey[] = ['local:fragment', 'local:fragmentOutbox', 'local:fragmentStatus'];

/**
 * The key one comment's images are stored under.
 * @param id The comment id.
 */
export const imagesKey = (id: string): StorageItemKey => `local:img:${id}`;

/**
 * The key one comment's clean screenshot is stored under.
 * @param id The comment id.
 */
export const screenshotKey = (id: string): StorageItemKey => `local:raw:${id}`;

/**
 * The storage item holding one comment's images.
 * @param id The comment id.
 */
export const imagesItem = (id: string) => storage.defineItem<CommentImages>(imagesKey(id), { fallback: {} });

/**
 * The storage item holding one comment's clean screenshot.
 * @param id The comment id.
 */
export const screenshotItem = (id: string) => storage.defineItem<Screenshot>(screenshotKey(id));

/**
 * Both per-comment keys of each comment, for removing a comment completely.
 * @param ids The comment ids.
 */
export const perCommentKeys = (ids: string[]): StorageItemKey[] => ids.flatMap((id) => [imagesKey(id), screenshotKey(id)]);

/**
 * How many bytes one local key takes, used to check the image migration.
 * @param key The key, with its area prefix.
 */
export const localBytesInUse = (key: StorageItemKey) => chrome.storage.local.getBytesInUse(key.replace(/^local:/, ''));

/** How many bytes the comment list takes. */
export const commentsBytesInUse = () => localBytesInUse(COMMENTS_KEY);
