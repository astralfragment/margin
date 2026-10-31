import { useQuery } from '@tanstack/react-query';
import { queryClient, storageQuery } from '@/lib/query';
import type { PageComment, Review } from './store';

const SETTINGS = {
  pickElement: { key: 'selectorMode', fallback: false },
  markers: { key: 'markerMode', fallback: true },
  severity: { key: 'lastSeverity', fallback: 'major' },
  theme: { key: 'theme', fallback: 'system' },
  accent: { key: 'accent', fallback: 'lime' },
} as const;

type Setting = keyof typeof SETTINGS;
type Value<K extends Setting> = (typeof SETTINGS)[K]['fallback'] extends boolean ? boolean : string;

/** One stored setting, shared with Margin's pages through the same query key. */
export function settingQuery<K extends Setting>(name: K) {
  const { key, fallback } = SETTINGS[name];
  return storageQuery(['storage', key], [key], async () => ((await chrome.storage.local.get(key))[key] as Value<K> | undefined) ?? (fallback as Value<K>));
}

export const useSetting = <K extends Setting>(name: K) => useQuery(settingQuery(name)).data ?? (SETTINGS[name].fallback as Value<K>);

/** A setting as last read, for the pointer and key handlers that run outside React. */
export const readSetting = <K extends Setting>(name: K) =>
  queryClient.getQueryData<Value<K>>(settingQuery(name).queryKey) ?? (SETTINGS[name].fallback as Value<K>);

/** Changes a setting at once for every reader, then stores it. */
export function writeSetting<K extends Setting>(name: K, value: Value<K>) {
  queryClient.setQueryData(settingQuery(name).queryKey, value);
  chrome.storage.local.set({ [SETTINGS[name].key]: value }).catch(() => {});
}

export type PageData = { review: Review | null; comments: PageComment[]; total: number };

const EMPTY: PageData = { review: null, comments: [], total: 0 };

/** The active review and the comments saved on this page, as the background lists them. */
export const pageQuery = () =>
  storageQuery(['overlay', 'page', location.href], ['issues', 'groups', 'activeGroupId'], async (): Promise<PageData> => {
    const ask = <T>(msg: object) => (chrome.runtime.sendMessage(msg) as Promise<T>).catch(() => null);
    const [active, page] = await Promise.all([
      ask<{ group?: Review; id?: string }>({ type: 'activeReview' }),
      ask<{ comments?: PageComment[]; total?: number }>({ type: 'pageComments', url: location.href }),
    ]);
    const comments = Array.isArray(page?.comments) ? page.comments : [];
    return { review: active?.group ?? (active?.id ? (active as Review) : null), comments, total: page?.total ?? comments.length };
  });

/** This page's review, comments and settings. */
export const usePage = () => useQuery(pageQuery()).data ?? EMPTY;

/** This page's data from the cache, for code outside React. */
export const readPage = () => queryClient.getQueryData<PageData>(pageQuery().queryKey) ?? EMPTY;

/** Reads the review and this page's comments again, as after a capture or a save. */
export const refreshPage = () => queryClient.fetchQuery({ ...pageQuery(), staleTime: 0 }).catch(() => EMPTY);
