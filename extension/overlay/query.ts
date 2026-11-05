import { QueryCache, QueryClient, queryOptions } from '@tanstack/react-query';
import { toast } from 'sonner';
import { sendMessage } from '@/lib/protocol';
import { activeReviewIdItem, commentsItem, markerModeItem, reviewsItem, selectorModeItem, themeItem } from '@/lib/storage';
import type { ThemeChoice } from '@/lib/model';

/**
 * The text of an error, for a toast.
 * @param error What was thrown.
 */
export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the overlay reads from the service worker and storage. Every failure shows as a toast saying what failed. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: 1, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({
    onError: (error, query) => toast.error(`Margin could not ${String(query.meta?.task ?? 'load its data')}`, { description: messageOf(error) }),
  }),
});

/** The review new comments go to, whose name the bar shows and whose Figma file the card picks frames from. */
export const reviewQuery = queryOptions({
  queryKey: ['overlay', 'review'],
  queryFn: () => sendMessage('activeReview'),
  meta: { task: 'read the current review' },
});

/** The comments of the current review made on this page, for the flags, and how many the review holds. */
export const pageCommentsQuery = queryOptions({
  queryKey: ['overlay', 'pageComments'],
  queryFn: () => sendMessage('pageComments', { url: location.href }),
  meta: { task: 'read the comments on this page' },
});

/** The overlay's settings: its theme and its two switches. */
export interface OverlaySettings {
  theme: ThemeChoice;
  selectorMode: boolean;
  markerMode: boolean;
}

export const settingsQuery = queryOptions({
  queryKey: ['overlay', 'settings'],
  queryFn: async (): Promise<OverlaySettings> => {
    const [theme, selectorMode, markerMode] = await Promise.all([themeItem.getValue(), selectorModeItem.getValue(), markerModeItem.getValue()]);
    return { theme, selectorMode, markerMode };
  },
  meta: { task: 'read its settings' },
});

/** Reads the review and the page's comments again, as after a save. */
export const refreshComments = () =>
  Promise.all([queryClient.invalidateQueries({ queryKey: reviewQuery.queryKey }), queryClient.invalidateQueries({ queryKey: pageCommentsQuery.queryKey })]);

/** Reads the comments and reviews again after storage changed under them. */
const commentsChanged = () => void refreshComments();

/** Reads the settings again after storage changed under them. */
const settingsChanged = () => void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey });

/** Keeps the queries current while storage changes under them, from the popup, the report or another tab. */
export function watchStorage() {
  const stops = [
    commentsItem.watch(commentsChanged),
    reviewsItem.watch(commentsChanged),
    activeReviewIdItem.watch(commentsChanged),
    themeItem.watch(settingsChanged),
    selectorModeItem.watch(settingsChanged),
    markerModeItem.watch(settingsChanged),
  ];
  return () => stops.forEach((stop) => stop());
}

/** The settings as last read, before the first read finishes too. */
export const currentSettings = (): OverlaySettings =>
  queryClient.getQueryData(settingsQuery.queryKey) ?? { theme: 'system', selectorMode: false, markerMode: true };

/**
 * Flips one of the overlay's switches at once and saves it through the service worker, putting it back if the save fails.
 * @param mode Which switch.
 * @param value Its new value.
 */
export async function saveMode(mode: 'selectorMode' | 'markerMode', value: boolean) {
  const before = currentSettings();
  queryClient.setQueryData(settingsQuery.queryKey, { ...before, [mode]: value });
  try {
    await sendMessage('saveOverlayModes', { [mode]: value });
  } catch (error) {
    queryClient.setQueryData(settingsQuery.queryKey, before);
    toast.error('Margin could not save that switch', { description: messageOf(error) });
  }
}
