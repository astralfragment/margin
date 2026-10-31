import { useLayoutEffect, useRef } from 'react';
import { browser } from 'wxt/browser';
import { CircleHelp, FileText, Info, SquareDashedMousePointer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAnnotateShortcut } from '@/components/margin/shortcut';
import { reviewName } from '@/lib/review-name.js';
import { reportProblem } from '@/lib/feedback.js';
import { usePopupActions } from './actions';
import { BrandMark } from './brand-mark';
import { ControlsPanel } from './controls-panel';
import { DeleteReviewDialog } from './delete-review-dialog';
import { draftIn, type Draft } from './draft';
import { IconButton } from './icon-button';
import { openReport, openSettings, openUrl, send, type PopupData } from './io';
import { LeadAction, Notice, StartAlert } from './lead-action';
import { LinkRows } from './link-rows';
import { belongsHere, hostOf, isRestricted, pageName, pageView, pagesLabel, plural, type Issue, type TabInfo } from './model';
import { PageComments } from './page-comments';
import { useAnnotating, useConnected, useDraft, useLinkRefresh, usePopupData, useRun, useTab, useToursDone } from './queries';
import { ReviewMenu } from './review-menu';
import { ReviewPicker } from './review-picker';
import { ReviewSheet } from './review-sheet';
import { usePopup, type View } from './store';
import { Tour, type TourStep } from './tour';

const SHELL = 'flex max-h-[600px] w-[344px] flex-col overflow-hidden bg-background text-foreground';

/** Caps the popup at the height Chrome gives it, which is less than 600 px on a short screen, so the list scrolls instead. */
function useFitHeight() {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = root.current;
      if (!el) return;
      el.style.maxHeight = '';
      if (innerHeight >= 200 && document.documentElement.scrollHeight > innerHeight) el.style.maxHeight = `${innerHeight}px`;
    };
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  });
  return root;
}

export function PopupApp() {
  const root = useFitHeight();
  const tab = useTab();
  const data = usePopupData();
  const connected = useConnected();
  const draft = useDraft();
  const tours = useToursDone();
  if (!tab.data || !data.data || !connected.data || draft.isPending || !tours.data) return <div ref={root} className="h-40 w-[344px]" aria-busy="true" />;
  return (
    <TooltipProvider>
      <div ref={root} className={SHELL}>
        <Popup tab={tab.data} data={data.data} connected={connected.data} draft={draft.data ?? null} toursDone={tours.data} />
      </div>
    </TooltipProvider>
  );
}

type Props = {
  tab: TabInfo;
  data: PopupData;
  connected: Record<'jira' | 'figma', boolean>;
  draft: Draft | null;
  toursDone: Record<string, boolean>;
};

function Popup({ tab, data, connected, draft, toursDone }: Props) {
  const host = hostOf(tab.url);
  const restricted = isRestricted(tab.url);
  const group = data.groups.find((g) => g.id === data.activeId) ?? data.groups.at(-1) ?? null;
  const open = Boolean(group) && (restricted || belongsHere(group!, data.issues, host));
  const draftScope = `popup:${tab.id ?? 0}:${host}`;
  const kept = draftIn(draft, draftScope);

  const store = usePopup();
  const shortcut = useAnnotateShortcut();
  const annotating = useAnnotating(tab.id, open && !restricted);
  const links = useLinkRefresh(open ? group : null);
  const run = useRun(group?.id);
  const actions = usePopupActions({ tab, data, group, host, restricted, open });
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);

  const view: View = store.view ?? (kept && (kept.mode === 'new' || (kept.groupId === group?.id && open)) ? { name: 'sheet', mode: kept.mode, focus: 'name' } : { name: 'home' });

  if (view.name === 'controls') {
    return (
      <ControlsPanel
        onBack={() => {
          store.show({ name: 'home' });
          requestAnimationFrame(() => helpButton.current?.focus());
        }}
        onSettings={() => openSettings()}
      />
    );
  }

  if (view.name === 'sheet') {
    return (
      <ReviewSheet
        mode={view.mode}
        focus={view.focus}
        group={view.mode === 'edit' ? group : null}
        defaultName={reviewName(tab, data.groups.map((g) => g.name))}
        draft={kept}
        draftScope={draftScope}
        connected={connected}
        onClose={() => {
          store.show({ name: 'home' });
          requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-tour="lead"]')?.focus());
        }}
        onSubmit={(result) => actions.submitSheet(view.mode, result)}
      />
    );
  }

  const deleted = store.deleted;
  const reviewLive = open && group ? data.issues.filter((issue) => issue.groupId === group.id) : [];
  const reviewAll = [...reviewLive];
  for (const d of Object.values(deleted).sort((a, b) => a.reviewIndex - b.reviewIndex)) {
    if (d.issue.groupId === group?.id) reviewAll.splice(Math.min(d.reviewIndex, reviewAll.length), 0, d.issue);
  }
  const rows = pageView(reviewAll, tab, store.width);
  const live = pageView(reviewLive, tab, store.width);
  const counts = new Map<string, number>();
  for (const issue of data.issues) counts.set(issue.groupId, (counts.get(issue.groupId) ?? 0) + 1);
  const current = open ? group : null;
  const subtitle = current ? (reviewLive.length ? `${plural(reviewLive.length, 'comment')} on ${pagesLabel(reviewLive)}` : 'No comments yet') : '';
  const reportQuery = (commentId?: string) => `group=${encodeURIComponent(group!.id)}${commentId ? `&comment=${encodeURIComponent(commentId)}` : ''}`;
  const welcome = () => {
    openUrl(browser.runtime.getURL('/welcome.html'));
    window.close();
  };
  const verifyError = (actions.verify.data as { error?: string } | undefined)?.error ?? '';
  const touring = open && !restricted && !toursDone.popup;

  const tourSteps: TourStep[] = [
    { target: '[data-tour="lead"]', title: 'Start here', body: `Opens annotation mode on this tab.${shortcut ? ` ${shortcut.split('+').join(' ')} does the same.` : ''}` },
    { target: '[data-tour="picker"]', title: 'Pick the review', body: 'New comments land in this review. Start a new one for each round of feedback.' },
    {
      target: '[data-tour="list"]',
      title: 'Your comments',
      body: live.shown.length ? 'The comments on this page. Recheck captures them again for a before and after.' : 'The comments you make on this page show here.',
    },
    { target: '[data-tour="report"]', title: 'The report', body: 'Number details on screenshots, tidy the wording and export the review.' },
    { target: '[data-tour="controls"]', title: 'Controls', body: 'Every key and gesture, and your start shortcut. Settings are one click further.' },
  ];

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-1 pr-2 pl-4">
        <BrandMark className="mr-1" />
        <ReviewPicker
          groups={data.groups}
          counts={counts}
          current={current}
          title={current?.name ?? (host || 'This tab')}
          subtitle={subtitle}
          renaming={store.renaming}
          onPick={(id) => actions.pick.mutate(id)}
          onNew={() => store.show({ name: 'sheet', mode: 'new', focus: 'name' })}
          onRenameStart={() => store.setRenaming(true)}
          onRename={(name) => actions.rename.mutate(name)}
        />
        <IconButton label="Controls" ref={helpButton} data-tour="controls" onClick={() => store.show({ name: 'controls' })}>
          <CircleHelp />
        </IconButton>
        <ReviewMenu
          open={open}
          hasLinks={Boolean(group?.jira || group?.figma)}
          hasReviews={data.groups.length > 0}
          triggerRef={menuTrigger}
          onRename={() => store.setRenaming(true)}
          onLinks={() => store.show({ name: 'sheet', mode: 'edit', focus: 'jira' })}
          onNew={() => store.show({ name: 'sheet', mode: 'new', focus: 'name' })}
          onAll={() => openReport('group=all')}
          onSettings={() => openSettings()}
          onProblem={() => reportProblem('popup').finally(() => window.close())}
          onDelete={() => store.setConfirmingDelete(true)}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-3 px-4 pt-1 pb-4 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
          {restricted ? (
            <>
              <Notice icon={<Info />} title="Open a website to annotate">
                <p>Margin works on regular web pages. Chrome pages, the Web Store and new tabs are off limits to extensions.</p>
                {reviewLive.length > 0 && (
                  <p className="text-foreground">
                    {plural(reviewLive.length, 'comment')} so far on {pagesLabel(reviewLive)}.
                  </p>
                )}
              </Notice>
              {open ? (
                <Button size="lg" className="h-10 w-full" onClick={() => openReport(reportQuery())}>
                  <FileText />
                  Open report
                </Button>
              ) : (
                <Button variant="outline" className="h-10 w-full" onClick={welcome}>
                  See how a review works
                </Button>
              )}
            </>
          ) : open && group ? (
            <>
              <LinkRows
                group={group}
                connected={connected}
                refreshing={links.refreshing}
                failed={links.failed}
                onRefresh={links.refresh}
                onConnect={(kind) => openSettings(kind)}
                onOpen={openUrl}
              />
              {store.alert && <StartAlert {...store.alert} />}
              <LeadAction annotating={annotating.data ?? false} shortcut={shortcut} busy={actions.toggle.isPending} onClick={() => actions.toggle.mutate()} />
              <PageComments
                pageTitle={pageName({ url: tab.url, title: tab.title })}
                rows={rows}
                live={live}
                number={(issue: Issue) => reviewAll.indexOf(issue) + 1}
                deleted={new Set(Object.keys(deleted))}
                run={run}
                verifyError={verifyError}
                onVerify={() => actions.verify.mutate(live.multi ? live.width : undefined)}
                onCancelVerify={() => send('verifyCancel')}
                onWidth={store.setWidth}
                onOpen={(id) => openReport(reportQuery(id))}
                onDelete={(issue) => actions.deleteComment.mutate({ issue, reviewIndex: reviewAll.indexOf(issue) })}
                onUndo={(id) => actions.undoDelete.mutate(id)}
                onWelcome={welcome}
              />
            </>
          ) : (
            <>
              <Notice icon={<SquareDashedMousePointer />} title={`No review on ${host} yet`}>
                <p>Start one, then drag over anything that looks wrong.</p>
              </Notice>
              {store.alert && <StartAlert {...store.alert} />}
              <LeadAction annotating={false} shortcut={shortcut} busy={actions.startReview.isPending} label="Start review" onClick={() => actions.startReview.mutate()} />
              <p className="text-center text-xs font-medium text-muted-foreground">
                Named <span className="text-foreground">{reviewName(tab, data.groups.map((g) => g.name))}</span>. Rename it any time, or{' '}
                <button
                  type="button"
                  className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => store.show({ name: 'sheet', mode: 'new', focus: 'jira' })}
                >
                  add links first
                </button>
                .
              </p>
              {group && (
                <p className="text-center text-xs font-medium text-muted-foreground">
                  The shortcut and the right-click menu still add to {group.name}. Pick it above to see it here.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {open && !restricted && (
        <footer className="shrink-0 border-t px-4 py-3">
          <Button data-tour="report" variant="outline" className="h-9 w-full" onClick={() => openReport(reportQuery())}>
            <FileText />
            Open report
          </Button>
        </footer>
      )}

      {group && (
        <DeleteReviewDialog
          open={store.confirmingDelete}
          name={group.name}
          count={reviewLive.length}
          finalFocus={menuTrigger}
          onCancel={() => store.setConfirmingDelete(false)}
          onDelete={() => actions.deleteReview.mutate()}
        />
      )}
      {touring && <Tour name="popup" steps={tourSteps} />}
    </>
  );
}
