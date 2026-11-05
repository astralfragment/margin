import { lazy, Suspense } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialog } from './confirm';
import { TopBar } from './top-bar';
import { Sidebar, FilterBar, ListHeader } from './sidebar';
import { CommentList, followScroll } from './comment-list';
import { MarkerNote } from './marker-note';
import { OptionsDialog } from './options-dialog';
import { ReviewSheetDialog } from './review-sheet';
import { RecheckDialog } from './recheck';
import { useShownTheme } from './theme';
import { Tour } from './tour';
import { useReportUi } from './ui-store';
import { useReviews } from './use-report';

const EditorDialog = lazy(() => import('./editor/editor-dialog'));
const JiraDialog = lazy(() => import('./send/jira-dialog'));
const FigmaDialog = lazy(() => import('./send/figma-dialog'));

/** The review report: a top bar, the comment index, the comments with their screenshots, and every dialog. */
export function App() {
  const theme = useShownTheme((state) => state.shown);
  const { review, key } = useReviews();
  const dialog = useReportUi((state) => state.dialog);
  const editorId = useReportUi((state) => state.editorId);

  return (
    <TooltipProvider>
      <title>{review?.name ?? (key === 'all' ? 'All reviews' : 'Margin review')}</title>
      <a
        href="#comments"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 outline-none focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Skip to comments
      </a>
      <div className="flex h-full flex-col">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main id="comments" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto outline-none" onScroll={followScroll}>
            <div className="flex flex-col gap-3 border-b p-4 md:hidden">
              <FilterBar />
              <ListHeader />
            </div>
            <CommentList />
          </main>
        </div>
      </div>
      <MarkerNote />
      <OptionsDialog />
      <ReviewSheetDialog />
      <RecheckDialog />
      <Suspense>
        {editorId && <EditorDialog commentId={editorId} />}
        {dialog === 'jira' && <JiraDialog />}
        {dialog === 'figma' && <FigmaDialog />}
      </Suspense>
      <ConfirmDialog />
      <Tour />
      <Toaster theme={theme} position="bottom-center" />
    </TooltipProvider>
  );
}
