/* oxlint-disable react/react-in-jsx-scope -- React 19 uses the automatic JSX runtime. The rule belongs off in .oxlintrc.json. */
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { RefreshCwIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Review } from '@/lib/model';
import { sendMessage } from '@/lib/protocol';
import { detailsAt, refreshLinks, statusTone, timeAgo } from '@/lib/review-links.js';
import { cn } from '@/lib/utils';
import { openSettings, openUrl } from './actions';
import { MarginIcon } from './margin-icon';
import { connectedQuery } from './queries';

const TONE_CLASS: Record<string, string> = {
  done: 'text-success',
  progress: 'text-info',
  todo: 'text-muted-foreground',
};

/**
 * The review's linked Jira ticket and Figma file, as quiet rows that open them. Details older than five minutes are
 * looked up again when the popup opens, and the refresh button looks them up now.
 * @param props.review The review shown.
 */
export function ReviewLinks({ review }: { review: Review }) {
  const { data: connected } = useSuspenseQuery(connectedQuery);
  const hasLinks = Boolean(review.jira?.key || review.figma?.fileKey);

  const autoRefresh = useQuery({
    queryKey: ['linkDetails', review.id],
    enabled: hasLinks,
    queryFn: () => refreshDetails(review, false),
  });
  const refreshNow = useMutation({ mutationFn: () => refreshDetails(review, true) });
  const refreshing = autoRefresh.isFetching || refreshNow.isPending;
  const failed = refreshNow.data?.failed ?? autoRefresh.data?.failed;

  if (!hasLinks) return null;
  const at = detailsAt(linksOf(review));
  const disconnected = (['jira', 'figma'] as const).find((service) => review[service]?.fetchedAt && !connected[service]);

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border px-1 py-1">
      {review.jira?.key && (
        <LinkRow
          service="jira"
          title={review.jira.key}
          url={review.jira.url}
          detail={review.jira.summary}
          known={Boolean(review.jira.fetchedAt)}
          stale={!connected.jira}
          trailing={review.jira.status && <span className={cn('max-w-[40%] truncate text-xs', TONE_CLASS[statusTone(review.jira.statusCategory)])}>{review.jira.status}</span>}
        />
      )}
      {review.figma?.fileKey && (
        <LinkRow service="figma" title={review.figma.name || 'Figma file'} url={review.figma.url} known={Boolean(review.figma.fetchedAt)} stale={!connected.figma} />
      )}
      <div className="flex items-center gap-1 px-2 text-xs text-muted-foreground">
        <span className="flex-1">
          {freshness(refreshing, Boolean(failed), at)}
        </span>
        {disconnected ? (
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => openSettings(disconnected)}>
            Connect to refresh
          </button>
        ) : (
          at && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Refresh details"
              title="Refresh details"
              disabled={refreshing}
              onClick={() => refreshNow.mutate()}
            >
              <RefreshCwIcon className={cn(refreshing && 'animate-spin')} />
            </Button>
          )
        )}
      </div>
    </div>
  );
}

/**
 * How fresh the linked details are, or that they are being refreshed or could not be.
 * @param refreshing Whether a lookup is running.
 * @param failed Whether the last lookup failed.
 * @param at When the details were last brought in.
 */
function freshness(refreshing: boolean, failed: boolean, at: number | null) {
  if (refreshing) return 'Refreshing details';
  if (failed) return 'Could not refresh the details';
  if (at) return `Details from ${timeAgo(at)}`;
  return '';
}

/**
 * Looks the review's links up again and has the background store what changed.
 * @param review The review.
 * @param force Look up even when the details are under five minutes old.
 */
async function refreshDetails(review: Review, force: boolean) {
  const { patch, failed } = await refreshLinks(linksOf(review), force);
  if (Object.keys(patch).length) await sendMessage('patchReview', { id: review.id, patch });
  return { failed };
}

/**
 * A review's links in the shape the link helpers take, with a removed link left out.
 * @param review The review.
 */
const linksOf = (review: Review) => ({ jira: review.jira ?? undefined, figma: review.figma ?? undefined });

interface LinkRowProps {
  service: 'jira' | 'figma';
  title: string;
  url: string;
  detail?: string;
  /** Whether details were ever brought in. */
  known: boolean;
  /** Details kept from before the service was disconnected show dimmed. */
  stale: boolean;
  trailing?: React.ReactNode;
}

/**
 * One linked ticket or file. Without details it offers to connect instead.
 * @param props.service Jira or Figma.
 */
function LinkRow({ service, title, url, detail, known, stale, trailing }: LinkRowProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 px-2 py-1 text-sm', stale && known && 'opacity-70')}>
      <MarginIcon name={service} className="size-3.5 text-muted-foreground" />
      <button type="button" className="shrink-0 font-medium hover:underline disabled:no-underline" disabled={!url} title={url} onClick={() => openUrl(url)}>
        {title}
      </button>
      {known ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={detail}>
          {detail}
        </span>
      ) : (
        <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => openSettings(service)}>
          Connect to bring in details
        </button>
      )}
      {known && trailing}
    </div>
  );
}
