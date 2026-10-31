import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { storageQuery, queryClient } from '@/lib/query';
import { readExportConfig, writeExportConfig } from '@/lib/export-config.js';
import { connection } from '@/lib/oauth.js';
import { refreshLinks } from '@/lib/review-links.js';
import { hydrate, issuesInGroup, patchGroup } from '@/lib/store.js';
import { tourSeen } from '@/lib/tour.js';
import type { ExportConfig } from './export/config';
import type { Group, Issue, VerifyRun } from './types';
import { hostOf, send } from './util';

/** The review the address asks for: ?group=<id>, ?group=all, or the active review when there is none. */
const wanted = new URL(location.href).searchParams.get('group');

export type ReviewSummary = Group & { sites: string[] };

/**
 * Every review with its sites and comment count, and the one this page shows (null for All reviews).
 * A review opened with ?created=1 says once where new comments go.
 */
export function useReviewList() {
  return useQuery(
    storageQuery(['report', 'reviews'], ['groups', 'issues', 'activeGroupId'], async () => {
      const [{ groups, activeId }, every] = await Promise.all([send('groups') as Promise<{ groups: Group[]; activeId: string }>, issuesInGroup(null) as Promise<Issue[]>]);
      const groupId = wanted === 'all' ? null : groups.find((g) => g.id === wanted)?.id ?? activeId;
      const sites = (id: string) => [...new Set(every.filter((i) => i.groupId === id).map((i) => hostOf(i.page?.url)).filter(Boolean))];
      const group = groups.find((g) => g.id === groupId) ?? null;
      const opened = new URL(location.href);
      if (opened.searchParams.get('created') && group) {
        opened.searchParams.delete('created');
        history.replaceState(null, '', opened);
        toast(`New comments from the page now go to ${group.name}.`, { duration: 9000 });
      }
      return { groups: groups.map((g) => ({ ...g, sites: sites(g.id) })) as ReviewSummary[], groupId, group };
    }),
  );
}

/** The comments of a review, or of every review, with their images. */
export function useComments(groupId: string | null | undefined) {
  return useQuery({
    ...storageQuery(['report', 'comments', groupId ?? 'all'], ['issues', 'img:*'], async () => (await hydrate(await issuesInGroup(groupId ?? null))) as Issue[]),
    enabled: groupId !== undefined,
  });
}

/**
 * Looks the review's Jira ticket and Figma file up again when their details are old, and stores what changed.
 * The review list refreshes from the storage write.
 */
export function useLinkRefresh(group: Group | null) {
  return useQuery({
    queryKey: ['report', 'link-refresh', group?.id],
    enabled: Boolean(group),
    queryFn: async () => {
      const { patch } = (await refreshLinks(group as object)) as { patch: Partial<Group> };
      if (Object.keys(patch).length) await patchGroup(group!.id, patch);
      return true;
    },
  });
}

/** The saved export settings. */
export const useExportConfig = () => useQuery(storageQuery(['export-config'], ['exportConfig'], () => readExportConfig() as Promise<ExportConfig>));

/** Saves the export settings. */
export const useSaveExportConfig = () => useMutation({ mutationFn: (config: ExportConfig) => writeExportConfig(config) as Promise<ExportConfig> });

/**
 * Whether a guided tour has been seen.
 * @param name The tour.
 */
export const useTourSeen = (name: string) => useQuery(storageQuery(['tour-seen', name], ['tours'], () => tourSeen(name) as Promise<boolean>));

export const useConnection = <T,>(provider: 'jira' | 'figma', enabled = true) =>
  useQuery({ ...storageQuery(['connection', provider], ['connections'], async () => ((await connection(provider)) as T | null) ?? null), enabled });

/** The recheck that is running, if any. */
export const useVerifyRun = () =>
  useQuery(storageQuery(['verify-run'], ['verifyRun'], async () => ((await chrome.storage.local.get('verifyRun')).verifyRun as VerifyRun | undefined) ?? null));

/**
 * Stores a change to one comment. The cached comments change at once, so an edit on the card shows without
 * waiting for the background, and the storage watcher brings in the stored result.
 */
export function useUpdateComment() {
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Issue> }) => send('update', { id, patch }),
    onMutate: ({ id, patch }) => patchCached(id, patch),
  });
}

/** Changes one comment in every cached list of comments, for changes the background has made or is making. */
export function patchCached(id: string, patch: Partial<Issue>) {
  queryClient.setQueriesData<Issue[]>({ queryKey: ['report', 'comments'] }, (list) => list?.map((issue) => (issue.id === id ? { ...issue, ...patch } : issue)));
}
