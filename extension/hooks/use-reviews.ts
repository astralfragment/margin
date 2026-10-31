import { useQuery } from '@tanstack/react-query';
import { storageQuery } from '@/lib/query';
import { activeGroup, hydrate, issuesInGroup, readGroups, readIssues } from '@/lib/store.js';

/** Every review with its comment count. */
export function useReviews() {
  return useQuery(
    storageQuery(['reviews'], ['groups', 'issues'], async () => {
      const [groups, issues] = await Promise.all([readGroups(), readIssues()]);
      return groups.map((group: { id: string }) => ({ ...group, count: issues.filter((issue: { groupId?: string }) => issue.groupId === group.id).length }));
    }),
  );
}

/** The review new comments go to. */
export function useActiveReview() {
  return useQuery(storageQuery(['active-review'], ['groups', 'activeGroupId'], () => activeGroup()));
}

/**
 * The comments in one review. With images, each comment also carries its screenshots, which are large,
 * so ask for them only where they are shown.
 */
export function useReviewComments(groupId: string | undefined, { images = false } = {}) {
  return useQuery({
    ...storageQuery(['comments', groupId, images], images ? ['issues', 'img:*'] : ['issues'], async () => {
      const issues = await issuesInGroup(groupId);
      return images ? hydrate(issues) : issues;
    }),
    enabled: Boolean(groupId),
  });
}
