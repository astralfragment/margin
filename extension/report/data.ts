import { QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { commentsInReview, readImages } from '@/lib/review-store';
import {
  activeReviewIdItem,
  commentsItem,
  connectionsItem,
  factFieldsItem,
  reviewsItem,
  shotModeItem,
  widthModeItem,
} from '@/lib/storage';
import { sendMessage, type MessageData, type MessageName, type MessageReply } from '@/lib/protocol';
import { connection, withDefaults } from './shared';
import type { CommentImages, Connection, FactField, Provider, ShotMode } from '@/lib/model';

/**
 * Everything the report reads, as React Query queries. Storage watchers set up once in `followStorage` mark the
 * queries stale when another screen or the service worker writes, so no component syncs state by hand.
 */

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } },
});

/** The key that names every review at once. */
export const ALL_REVIEWS = 'all';

/** The report options: which detail rows, which screenshots and whether width shots show. */
export interface ReportSettings {
  fields: Record<FactField, boolean>;
  shots: ShotMode;
  widths: boolean;
}

/**
 * The reviews with their comment counts, and the one new comments go to. On a fresh profile the service worker reads
 * the list while it creates the first review, so a reply that leaves out the active review is asked for once more.
 */
export const reviewsQuery = queryOptions({
  queryKey: ['reviews'],
  queryFn: async () => {
    const reply = await sendMessage('groups', undefined);
    return reply.groups.some((review) => review.id === reply.activeId) ? reply : sendMessage('groups', undefined);
  },
});

/**
 * The comments of one review, or of every review, oldest first and without images.
 * @param reviewKey A review id, or ALL_REVIEWS.
 */
export const commentsQuery = (reviewKey: string) =>
  queryOptions({
    queryKey: ['comments', reviewKey],
    queryFn: () => commentsInReview(reviewKey === ALL_REVIEWS ? null : reviewKey),
  });

/**
 * One comment's images, read apart from the list so cards paint before their images arrive.
 * @param id The comment id.
 */
export const imagesQuery = (id: string) =>
  queryOptions<CommentImages>({
    queryKey: ['images', id],
    queryFn: () => readImages(id),
  });

export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: async (): Promise<ReportSettings> => {
    const [fields, shots, widths] = await Promise.all([factFieldsItem.getValue(), shotModeItem.getValue(), widthModeItem.getValue()]);
    return { fields: withDefaults(fields), shots, widths: widths === 'show' };
  },
});

/**
 * The signed-in Jira or Figma account, or null.
 * @param provider The service.
 */
export const connectionQuery = (provider: Provider) =>
  queryOptions({
    queryKey: ['connection', provider],
    queryFn: async (): Promise<Connection | null> => (await connection(provider)) ?? null,
  });

/**
 * Reads one comment's images.
 * @param id The comment id.
 */
export const useImages = (id: string) => useQuery(imagesQuery(id));

/** Reads the report options. */
export const useSettings = () => useQuery(settingsQuery);

/**
 * Merges images a background reply carries into the cache, so the card redraws without another read.
 * @param id The comment id.
 * @param images The images that changed.
 */
export function putImages(id: string, images: CommentImages) {
  queryClient.setQueryData<CommentImages>(['images', id], (old) => ({ ...old, ...images }));
}

/**
 * Sends a message to the service worker and turns an `{ error }` reply into a thrown Error, so no failure is silent.
 * @param name The message.
 * @param data Its data.
 */
export async function ask<Name extends MessageName>(name: Name, data: MessageData<Name>): Promise<Exclude<MessageReply<Name>, { error: string }>> {
  const reply = await sendMessage(name, data);
  if (reply && typeof reply === 'object' && 'error' in reply && typeof reply.error === 'string') throw new Error(reply.error);
  return reply as Exclude<MessageReply<Name>, { error: string }>;
}

/**
 * A storage listener that marks some queries stale.
 * @param queryKey The queries.
 */
const refresh = (queryKey: string[]) => () => queryClient.invalidateQueries({ queryKey });

/** Marks queries stale whenever their storage changes, from any screen. Call once at start. */
export function followStorage() {
  commentsItem.watch(refresh(['comments']));
  commentsItem.watch(refresh(['reviews']));
  reviewsItem.watch(refresh(['reviews']));
  activeReviewIdItem.watch(refresh(['reviews']));
  factFieldsItem.watch(refresh(['settings']));
  shotModeItem.watch(refresh(['settings']));
  widthModeItem.watch(refresh(['settings']));
  connectionsItem.watch(refresh(['connection']));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(changes)) {
      if (key.startsWith('img:')) queryClient.invalidateQueries({ queryKey: ['images', key.slice(4)] });
    }
  });
}
