import { useMutation, useQuery } from '@tanstack/react-query';
import { browser } from 'wxt/browser';
import { storageQuery } from '@/lib/query';
import { patchGroup } from '@/lib/store.js';
import { refreshLinks } from '@/lib/review-links.js';
import type { Draft } from './draft';
import { activeTab, annotatingNow, connectedServices, loadData, type RunState } from './io';
import type { Group } from './model';

/** How long a finished recheck keeps showing its outcome. */
const RUN_SHOWN_MS = 60_000;

/** The active tab. */
export const useTab = () => useQuery({ queryKey: ['active-tab'], queryFn: activeTab });

/** The reviews, comments and active review, without creating a review, so a site with none can say so. */
export const usePopupData = () => useQuery(storageQuery(['popup-data'], ['groups', 'issues', 'activeGroupId'], loadData));

/** Which of Jira and Figma are connected. */
export const useConnected = () => useQuery(storageQuery(['connected'], ['connections'], connectedServices));

/**
 * Whether Margin is running on a tab.
 * @param tabId The tab.
 * @param enabled Whether to ask.
 */
export const useAnnotating = (tabId: number | undefined, enabled: boolean) =>
  useQuery({ queryKey: ['annotating', tabId], queryFn: () => annotatingNow(tabId), enabled });

/** The saved popup draft. */
export const useDraft = () =>
  useQuery(storageQuery(['review-draft'], ['reviewDraft'], async () => ((await browser.storage.local.get('reviewDraft')).reviewDraft as Draft | undefined) ?? null));

/** Which guided tours have been seen. */
export const useToursDone = () =>
  useQuery(storageQuery(['tours'], ['tours'], async () => ((await browser.storage.local.get('tours')).tours ?? {}) as Record<string, boolean>));

/** A recheck of this review that is running, or finished in the last minute. */
export function useRun(groupId: string | undefined) {
  const { data } = useQuery(storageQuery(['verify-run'], ['verifyRun'], async () => ((await browser.storage.local.get('verifyRun')).verifyRun as RunState | undefined) ?? null));
  if (!data || data.groupId !== groupId) return null;
  return data.state === 'running' || Date.now() - data.at < RUN_SHOWN_MS ? data : null;
}

/** Brings the linked ticket and file up to date once per popup, when they are older than five minutes. */
export function useLinkRefresh(group: Group | null) {
  const auto = useQuery({
    queryKey: ['link-refresh', group?.id],
    queryFn: () => refreshAndStore(group!, false),
    enabled: Boolean(group?.jira || group?.figma),
  });
  const now = useMutation({ mutationFn: () => refreshAndStore(group!, true) });
  return { refreshing: now.isPending, failed: now.data ?? (now.isIdle ? auto.data : false) ?? false, refresh: () => now.mutate() };
}

/** Looks the links up and stores what changed. Resolves true when a lookup failed. */
async function refreshAndStore(group: Group, force: boolean) {
  const { patch, failed } = (await refreshLinks(group, force)) as { patch: object; failed: boolean };
  if (Object.keys(patch).length) await patchGroup(group.id, patch);
  return failed;
}
