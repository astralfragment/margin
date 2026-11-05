import { QueryClient, queryOptions, useMutation, useSuspenseQuery } from '@tanstack/react-query';
import type { WxtStorageItem } from 'wxt/utils/storage';
import {
  commentsItem,
  connectionsItem,
  markerModeItem,
  reviewSheetDraftItem,
  selectorModeItem,
  themeItem,
} from '@/lib/storage';

type Item<Value> = WxtStorageItem<Value, Record<string, unknown>>;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});

/**
 * The query that reads one storage item.
 * @param item The storage item.
 */
export const itemQuery = <Value>(item: Item<Value>) =>
  queryOptions({ queryKey: ['storage', item.key], queryFn: () => item.getValue() });

/** The storage items these pages show. A change from any screen refreshes them here. */
export const pageItems = [themeItem, selectorModeItem, markerModeItem, connectionsItem, reviewSheetDraftItem] as const;

for (const item of pageItems) {
  item.watch(() => queryClient.invalidateQueries({ queryKey: ['storage', item.key] }));
}

/** The shortcut that toggles annotation, empty when none is set. Read again whenever the tab comes back into focus. */
export const shortcutQuery = queryOptions({
  queryKey: ['shortcut'],
  queryFn: async () => (await chrome.commands.getAll()).find((command) => command.name === 'toggle-annotate')?.shortcut ?? '',
  staleTime: 0,
  refetchOnWindowFocus: 'always',
});

/** How many comments are stored and how many bytes Margin uses on this computer. */
export const usageQuery = queryOptions({
  queryKey: ['usage'],
  queryFn: async () => {
    const [comments, bytes] = await Promise.all([commentsItem.getValue(), chrome.storage.local.getBytesInUse(null)]);
    return { comments: comments.length, bytes };
  },
});

commentsItem.watch(() => queryClient.invalidateQueries({ queryKey: usageQuery.queryKey }));

/** Reads everything the pages show before the first render, so no control draws with a placeholder value. */
export function preloadPage() {
  return Promise.all([
    ...pageItems.map((item) => queryClient.ensureQueryData(itemQuery<unknown>(item))),
    queryClient.ensureQueryData(shortcutQuery),
    queryClient.ensureQueryData(usageQuery),
  ]);
}

/**
 * The current value of a storage item.
 * @param item The storage item.
 */
export const useStored = <Value>(item: Item<Value>) => useSuspenseQuery(itemQuery(item)).data;

/**
 * Saves a single-key setting, showing the new value at once and the stored one again if the write fails.
 * @param item The storage item.
 */
export function useSaveStored<Value>(item: Item<Value>) {
  const { queryKey } = itemQuery(item);
  return useMutation({
    mutationFn: (value: Value) => item.setValue(value),
    onMutate: (value) => queryClient.setQueryData(queryKey, value),
    onError: () => queryClient.invalidateQueries({ queryKey }),
  });
}
