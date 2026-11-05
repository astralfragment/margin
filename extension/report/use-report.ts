import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { numbering, orderIssues, severityOf, statusOf } from './shared';
import type { Comment } from '@/lib/model';
import { ALL_REVIEWS, commentsQuery, queryClient, reviewsQuery } from './data';
import { useReportUi } from './ui-store';
import { hostOf, pad } from './format';

/**
 * The key of the review shown, for code outside components, or null before the reviews have loaded.
 */
export function currentReviewKey() {
  const data = queryClient.getQueryData(reviewsQuery.queryKey);
  const wanted = useReportUi.getState().reviewKey;
  if (wanted === ALL_REVIEWS) return ALL_REVIEWS;
  return data?.groups.find((review) => review.id === wanted)?.id ?? data?.activeId ?? null;
}

/** The reviews, with the one shown, the one new comments go to and its key for queries. */
export function useReviews() {
  const reviews = useQuery(reviewsQuery);
  const wanted = useReportUi((state) => state.reviewKey);
  const list = reviews.data?.groups ?? [];
  const activeId = reviews.data?.activeId ?? null;
  const key = wanted === ALL_REVIEWS ? ALL_REVIEWS : (list.find((review) => review.id === wanted)?.id ?? activeId);
  const review = list.find((entry) => entry.id === key) ?? null;
  return { reviews: list, activeId, key, review, isPending: reviews.isPending, error: reviews.error };
}

/**
 * The text a comment is found by in the sidebar search.
 * @param comment The comment.
 * @param number Its number.
 */
const searchText = (comment: Comment, number: number) =>
  [pad(number), comment.title, comment.note, comment.element?.selector, comment.jira?.key, hostOf(comment.page?.url)].join(' ').toLowerCase();

/** The comments of the review shown: numbered, in the sort order picked, and the subset the filters leave. */
export function useReportComments() {
  const { key } = useReviews();
  const comments = useQuery({ ...commentsQuery(key ?? ALL_REVIEWS), enabled: key !== null });
  const { sort, search, severity, status } = useReportUi();
  const all = useMemo(() => comments.data ?? [], [comments.data]);
  const numberOf = useMemo(() => numbering(all) as (comment: { id: string }) => number, [all]);
  const ordered = useMemo(() => orderIssues(all, sort) as Comment[], [all, sort]);
  const term = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      ordered.filter(
        (comment) =>
          (severity === 'all' || severityOf(comment.severity).key === severity) &&
          (status === 'all' || statusOf(comment.status).key === status) &&
          (!term || searchText(comment, numberOf(comment)).includes(term)),
      ),
    [ordered, severity, status, term, numberOf],
  );
  return { all, ordered, shown, numberOf, isPending: comments.isPending || key === null, error: comments.error };
}
