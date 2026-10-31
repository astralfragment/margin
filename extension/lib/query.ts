import { QueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Chrome storage is the source of truth, so cached reads never go stale on a timer.
 * They are refreshed when the storage keys they read change, from any page or the worker.
 */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } },
});

/** The storage keys a query reads. A key ending in * matches every key with that prefix, such as img:*. */
export type StorageMeta = { storage: string[] };

/**
 * True when a storage change touches a key. A key ending in * matches a prefix.
 * @param key The key.
 * @param changed The keys that changed.
 */
const reads = (key: string, changed: string[]) =>
  key.endsWith('*') ? changed.some((c) => c.startsWith(key.slice(0, -1))) : changed.includes(key);

let watching = false;

/** Invalidates every query whose meta.storage names a key that just changed. Safe to call more than once. */
export function watchStorage() {
  if (watching) return;
  watching = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const changed = Object.keys(changes);
    queryClient.invalidateQueries({
      predicate: (query) => ((query.meta as StorageMeta | undefined)?.storage ?? []).some((key) => reads(key, changed)),
    });
  });
}

/** Query options for something read from storage, refreshed whenever those keys change. */
export function storageQuery<T>(queryKey: QueryKey, storage: string[], queryFn: () => Promise<T>) {
  return { queryKey, queryFn, meta: { storage } satisfies StorageMeta };
}
