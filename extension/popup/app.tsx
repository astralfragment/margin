/* oxlint-disable react/react-in-jsx-scope -- React 19 uses the automatic JSX runtime. The rule belongs off in .oxlintrc.json. */
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { AppWindowIcon, CircleAlertIcon, SettingsIcon, SquareDashedMousePointerIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import type { Comment, Review } from '@/lib/model';
import { openAllReviews, openReport, openSettings, openWelcome, pickReview, toggleAnnotating } from './actions';
import { MarginIcon } from './margin-icon';
import { belongsHere, hostOf, isRestricted, plural, trimName } from './page';
import { PageComments } from './page-comments';
import { activeReviewIdQuery, annotatingTabsQuery, commentsQuery, reviewsQuery, shortcutQuery, tabQuery } from './queries';
import { ReviewLinks } from './review-links';
import { ReviewMenu } from './review-menu';
import { ReviewSheet } from './review-sheet';
import { EMPTY_LINK, usePopup } from './store';

/** The toolbar popup: the review for this site, starting and stopping annotation, and this page's comments. */
export function App() {
  const { data: tab } = useSuspenseQuery(tabQuery);
  const { data: reviews } = useSuspenseQuery(reviewsQuery);
  const { data: allComments } = useSuspenseQuery(commentsQuery);
  const { data: activeId } = useSuspenseQuery(activeReviewIdQuery);
  const hiddenIds = usePopup((state) => state.hiddenIds);
  const savedSheet = usePopup((state) => state.sheet);
  const openSheet = usePopup((state) => state.openSheet);

  const url = tab?.url ?? '';
  const host = hostOf(url);
  const restricted = isRestricted(url);
  const scope = `${tab?.id ?? 0}:${host}`;
  const active = reviews.find((review) => review.id === activeId) ?? reviews.at(-1) ?? null;
  const reviewComments = (review: Review) => allComments.filter((comment) => comment.groupId === review.id);
  const shown = active && (restricted || belongsHere(active, reviewComments(active), host)) ? active : null;
  const sheet = savedSheet?.scope === scope ? savedSheet : null;

  /**
   * Opens the review sheet, empty to start a review or filled with the shown one to edit it.
   * @param mode Start or edit.
   */
  function showSheet(mode: 'new' | 'edit') {
    const editing = mode === 'edit' ? shown : null;
    const linkOf = (kind: 'jira' | 'figma') => {
      const value = editing?.[kind];
      if (!value) return EMPTY_LINK;
      return { text: value.url, status: value.fetchedAt ? ('ok' as const) : ('notConnected' as const), value, detail: '' };
    };
    openSheet({
      mode: editing ? 'edit' : 'new',
      scope,
      reviewId: editing?.id ?? null,
      name: editing?.name ?? trimName(tab?.title || host),
      jira: linkOf('jira'),
      figma: linkOf('figma'),
    });
  }

  if (sheet) {
    return <ReviewSheet sheet={sheet} active={active} comments={allComments} tabUrl={url} host={host} restricted={restricted} />;
  }

  const visibleComments = shown ? reviewComments(shown).filter((comment) => !hiddenIds.includes(comment.id)) : [];

  return (
    <div className="flex flex-col gap-3 p-3">
      <header className="flex items-center gap-1">
        <MarginIcon name="mark" className="ml-1 size-5" />
        <ReviewMenu reviews={reviews} comments={allComments} shown={shown} host={host} fallbackTitle={restricted || !host ? 'Margin' : host} onNew={() => showSheet('new')} onEdit={() => showSheet('edit')} />
        <Button variant="ghost" size="icon" aria-label="Help and settings" title="Help and settings" onClick={() => openSettings()}>
          <SettingsIcon />
        </Button>
      </header>

      {restricted && <RestrictedState review={shown} comments={visibleComments} />}
      {!restricted && shown && tab && (
        <>
          <ReviewLinks review={shown} />
          <AnnotateButton tabId={tab.id} tabUrl={url} />
          <PageComments review={shown} comments={visibleComments} tab={tab} />
        </>
      )}
      {!restricted && !shown && (
        <NoReviewHere active={active} activeComments={active ? reviewComments(active) : []} host={host} onStart={() => showSheet('new')} />
      )}

      {shown && !restricted && (
        <Button variant="outline" onClick={() => openReport(shown.id)}>
          Open report
        </Button>
      )}
      {!shown && !restricted && reviews.length > 0 && (
        <Button variant="ghost" className="text-muted-foreground" onClick={openAllReviews}>
          All reviews
        </Button>
      )}
    </div>
  );
}

/**
 * Starts or stops annotation on the open tab, with the shortcut that does the same. A failure shows under it.
 * @param props.tabId The open tab.
 */
function AnnotateButton({ tabId, tabUrl }: { tabId: number | undefined; tabUrl: string }) {
  const { data: annotatingTabs } = useSuspenseQuery(annotatingTabsQuery);
  const { data: shortcut } = useSuspenseQuery(shortcutQuery);
  const startError = usePopup((state) => state.startError);
  const annotating = tabId !== undefined && annotatingTabs.includes(tabId);
  const toggle = useMutation({ mutationFn: () => toggleAnnotating(tabUrl) });

  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" className="h-11 justify-between px-4 text-[0.95rem]" disabled={toggle.isPending} onClick={() => toggle.mutate()} data-toggle>
        <span className="flex items-center gap-2">
          {toggle.isPending && <Spinner />}
          {annotating ? 'Stop annotating' : 'Start annotating'}
        </span>
        {shortcut.length > 0 && (
          <KbdGroup>
            {shortcut.map((key) => (
              <Kbd key={key} className="bg-primary-foreground/15 text-primary-foreground">
                {key}
              </Kbd>
            ))}
          </KbdGroup>
        )}
      </Button>
      {startError && (
        <p className="flex items-start gap-2 px-1 text-sm text-muted-foreground" role="status">
          <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
          {startError}
        </p>
      )}
    </div>
  );
}

/**
 * Shown on browser pages, blank tabs and the Web Store, where Chrome lets no extension run. It says so calmly
 * and keeps the way to the report.
 * @param props.review The review shown, if any.
 */
function RestrictedState({ review, comments }: { review: Review | null; comments: Comment[] }) {
  return (
    <Empty className="gap-3 px-4 py-6" data-restricted>
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-10 rounded-full text-muted-foreground">
          <AppWindowIcon className="size-5" />
        </EmptyMedia>
        <EmptyTitle className="text-base">Open a website to review</EmptyTitle>
        <EmptyDescription>Chrome keeps its own pages and the Web Store closed to extensions. Switch to the site you want to review and click Margin again.</EmptyDescription>
      </EmptyHeader>
      {review && (
        <EmptyContent>
          <Button className="w-full" onClick={() => openReport(review.id)}>
            Open report
          </Button>
          <p className="text-xs text-muted-foreground">
            {review.name} has {plural(comments.length, 'comment')}.
          </p>
        </EmptyContent>
      )}
    </Empty>
  );
}

interface NoReviewHereProps {
  /** The review new comments go to, made on another site, or null before the first review. */
  active: Review | null;
  activeComments: Comment[];
  host: string;
  onStart: () => void;
}

/**
 * Shown on a site with no review yet. Starting one opens the sheet. The review in use elsewhere can be brought here
 * in one click instead.
 * @param props.active The review in use on another site.
 */
function NoReviewHere({ active, activeComments, host, onStart }: NoReviewHereProps) {
  const keep = useMutation({ mutationFn: (review: Review) => pickReview(review, host, belongsHere(review, activeComments, host)) });

  return (
    <Empty className="gap-3 px-4 py-6">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="size-10 rounded-full">
          <SquareDashedMousePointerIcon className="size-5" />
        </EmptyMedia>
        <EmptyTitle className="text-base">{active ? 'No review on this site yet' : 'Start your first review'}</EmptyTitle>
        <EmptyDescription>Start a review, then drag over anything on the page that looks wrong.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="lg" className="w-full" onClick={onStart} data-toggle>
          Start review
        </Button>
        {active ? (
          <Button variant="ghost" size="sm" className="max-w-full text-muted-foreground" disabled={keep.isPending} onClick={() => keep.mutate(active)}>
            <span className="truncate">Add to {active.name} instead</span>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={openWelcome}>
            See how a review works
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}
