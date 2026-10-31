import { useMutation, useQuery } from '@tanstack/react-query';
import { storageQuery } from '@/lib/query';

/** One chrome.storage.local value, kept in step with changes from any page. */
export function useStorageValue<T>(key: string, fallback: T) {
  const query = useQuery(storageQuery(['storage', key], [key], async () => ((await chrome.storage.local.get(key))[key] as T | undefined) ?? fallback));
  return { ...query, data: query.data ?? fallback };
}

/** Writes one chrome.storage.local value. Readers refresh through the storage watcher. */
export function useSetStorageValue<T>(key: string) {
  return useMutation({ mutationFn: (value: T) => chrome.storage.local.set({ [key]: value }) });
}
