import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { refreshLinks, statusTone } from './shared';
import { ask } from './data';
import { FigmaIcon, JiraIcon } from './brand-icons';
import { jiraToneClass } from './badges';
import { useReviews } from './use-report';

/**
 * Opens a linked ticket or file, or Help and settings when the link has no address yet.
 * @param url The address.
 */
const openLink = (url: string | undefined) => (url ? chrome.tabs.create({ url }) : chrome.runtime.openOptionsPage());

/**
 * The review's linked Jira ticket and Figma file under its heading, refreshed when Jira or Figma is connected and the
 * details are old.
 * @param props.className Classes for the row.
 */
export function LinkChips({ className }: { className?: string }) {
  const { review } = useReviews();
  useQuery({
    queryKey: ['links', review?.id],
    enabled: Boolean(review?.jira?.key || review?.figma?.fileKey),
    queryFn: async () => {
      if (!review) return {};
      const { patch } = await refreshLinks(review);
      if (Object.keys(patch).length) await ask('patchReview', { id: review.id, patch });
      return patch;
    },
  });
  if (!review?.jira?.key && !review?.figma?.fileKey) return null;
  const tone = statusTone(review.jira?.statusCategory);
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>
      {review.jira?.key && (
        <Button variant="outline" size="sm" onClick={() => openLink(review.jira?.url)} title={review.jira.url ? `Open ${review.jira.key}` : 'Connect in Help and settings to bring in details'}>
          <JiraIcon className="size-3.5" />
          {review.jira.key}
          {review.jira.status && <span className={cn('text-xs', jiraToneClass(tone))}>{review.jira.status}</span>}
        </Button>
      )}
      {review.figma?.fileKey && (
        <Button variant="outline" size="sm" className="max-w-64" onClick={() => openLink(review.figma?.url)} title={`Open ${review.figma.name || 'Figma file'}`}>
          <FigmaIcon className="size-3.5" />
          <span className="truncate">{review.figma.name || 'Figma file'}</span>
        </Button>
      )}
    </div>
  );
}
