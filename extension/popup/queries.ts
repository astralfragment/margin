import { QueryClient, queryOptions } from '@tanstack/react-query';
import {
  activeReviewIdItem,
  commentsItem,
  connectionsItem,
  reviewsItem,
  verifyRunItem,
} from '@/lib/storage';
import { annotatingTabsItem } from '@/lib/session-storage';

/**
 * Everything the popup reads, as React Query options. Storage reads stay fresh through the watchers in
 * `watchStorage`, so none of them refetch on their own.
 */

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } },
});

export const tabQuery = queryOptions({
  queryKey: ['tab'],
  queryFn: async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0] ?? null,
});

export const reviewsQuery = queryOptions({ queryKey: ['reviews'], queryFn: () => reviewsItem.getValue() });

export const commentsQuery = queryOptions({ queryKey: ['comments'], queryFn: () => commentsItem.getValue() });

export const activeReviewIdQuery = queryOptions({
  queryKey: ['activeReviewId'],
  queryFn: async () => (await activeReviewIdItem.getValue()) ?? null,
});

export const annotatingTabsQuery = queryOptions({ queryKey: ['annotatingTabs'], queryFn: () => annotatingTabsItem.getValue() });

export const verifyRunQuery = queryOptions({
  queryKey: ['verifyRun'],
  queryFn: async () => (await verifyRunItem.getValue()) ?? null,
});

/** Which services are signed in. Jira counts only once it has a site. */
export const connectedQuery = queryOptions({
  queryKey: ['connections'],
  queryFn: async () => {
    const connections = await connectionsItem.getValue();
    return { jira: Boolean(connections.jira?.sites?.length), figma: Boolean(connections.figma) };
  },
});

/** The keys of the toggle shortcut as set in Chrome, such as Alt, Shift and M, or none when it is unset. */
export const shortcutQuery = queryOptions({
  queryKey: ['shortcut'],
  queryFn: async () => {
    const command = (await chrome.commands.getAll()).find((entry) => entry.name === 'toggle-annotate');
    return command?.shortcut ? command.shortcut.split('+') : [];
  },
});

/** The queries the popup needs before its first paint, so it opens at its full size in one frame. */
export const loadFirstPaint = () =>
  Promise.all([
    queryClient.ensureQueryData(tabQuery),
    queryClient.ensureQueryData(reviewsQuery),
    queryClient.ensureQueryData(commentsQuery),
    queryClient.ensureQueryData(activeReviewIdQuery),
    queryClient.ensureQueryData(annotatingTabsQuery),
    queryClient.ensureQueryData(verifyRunQuery),
    queryClient.ensureQueryData(connectedQuery),
    queryClient.ensureQueryData(shortcutQuery),
  ]);

/** Puts storage changes straight into the query cache, so every screen shows what the background just wrote. */
export function watchStorage() {
  reviewsItem.watch((reviews) => queryClient.setQueryData(reviewsQuery.queryKey, reviews ?? []));
  commentsItem.watch((comments) => queryClient.setQueryData(commentsQuery.queryKey, comments ?? []));
  activeReviewIdItem.watch((id) => queryClient.setQueryData(activeReviewIdQuery.queryKey, id ?? null));
  annotatingTabsItem.watch((tabs) => queryClient.setQueryData(annotatingTabsQuery.queryKey, tabs ?? []));
  verifyRunItem.watch((run) => queryClient.setQueryData(verifyRunQuery.queryKey, run ?? null));
  connectionsItem.watch(() => queryClient.invalidateQueries({ queryKey: connectedQuery.queryKey }));
}
