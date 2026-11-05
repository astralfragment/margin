import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot,
  ClipboardCopy,
  Compass,
  Crop,
  Ellipsis,
  FileCode,
  FileDown,
  FileText,
  FolderOpen,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Save,
  Settings,
  SlidersHorizontal,
  Trash2,
  ScanSearch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { refreshLinks, statusTone } from './shared';
import { cn } from '@/lib/utils';
import { ALL_REVIEWS, ask, useSettings } from './data';
import { confirm } from './confirm';
import { copyForAgents, copyForDocs, copyMarkdown, downloadHtml, downloadMarkdown, downloadWord, printPdf, saveReviewFile, type ExportSource } from './exports';
import { FigmaIcon, JiraIcon } from './brand-icons';
import { jiraToneClass } from './badges';
import { openDialog, showReview, useReportUi } from './ui-store';
import { useReportComments, useReviews } from './use-report';
import { startRecheck } from './recheck';
import { startTour } from './tour';
import { plural } from './format';
import type { ReviewWithCount } from '@/lib/protocol';

/** The review shown, its comments and the report options, ready for an export, or null while they load. */
function useExportSource(): ExportSource | null {
  const { review } = useReviews();
  const { all } = useReportComments();
  const settings = useSettings().data;
  return settings ? { review, comments: all, settings } : null;
}

/** Picks the review the report shows, or every review at once. */
function ReviewSwitcher() {
  const { reviews, key } = useReviews();
  const total = reviews.reduce((sum, review) => sum + review.count, 0);
  const items = [
    ...reviews.map((review) => ({ value: review.id, label: `${review.name} (${review.count})` })),
    { value: ALL_REVIEWS, label: `All reviews (${total})` },
  ];
  return (
    <Select items={items} value={key} onValueChange={(value) => value && showReview(value)}>
      <SelectTrigger aria-label="Review" className="max-w-[min(18rem,40vw)] min-w-0" data-tour="review">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** New review, edit the one shown, or delete it. */
function ReviewMenu() {
  const { review } = useReviews();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Review menu" />} />}>
          <MoreHorizontal />
        </TooltipTrigger>
        <TooltipContent>Review menu</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="w-56">
        <DropdownMenuItem onClick={() => openDialog('newReview')}>
          <Plus />
          New review
        </DropdownMenuItem>
        {review && (
          <>
            <DropdownMenuItem onClick={() => openDialog('editReview')}>
              <Pencil />
              Edit name and links
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => deleteReview(review)}>
              <Trash2 />
              Delete review
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Asks, then deletes a review with its comments and screenshots.
 * @param review The review.
 */
async function deleteReview(review: ReviewWithCount) {
  const choice = await confirm({
    title: `Delete ${review.name}?`,
    body: `This deletes the review and its ${plural(review.count, 'comment', 'comments')} with their screenshots. Save a review file first to keep a copy.`,
    choices: [
      { label: 'Cancel', value: null },
      { label: 'Delete review', value: 'delete', variant: 'destructive' },
    ],
  });
  if (choice !== 'delete') return;
  try {
    await ask('groupDelete', { id: review.id });
    useReportUi.setState({ reviewKey: null });
    history.replaceState(null, '', location.pathname);
    toast.success(`Deleted ${review.name}`);
  } catch (error) {
    toast.error(`The review was not deleted. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Opens a linked ticket or file, or Help and settings when the link has no address yet.
 * @param url The address.
 */
const openLink = (url: string | undefined) => (url ? chrome.tabs.create({ url }) : chrome.runtime.openOptionsPage());

/** The review's linked Jira ticket and Figma file, refreshed when Jira or Figma is connected and the details are old. */
function LinkChips() {
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
  if (!review) return null;
  const tone = statusTone(review.jira?.statusCategory);
  return (
    <div className="hidden min-w-0 items-center gap-1 lg:flex">
      {review.jira?.key && (
        <Button variant="outline" size="sm" onClick={() => openLink(review.jira?.url)} title={review.jira.url ? `Open ${review.jira.key}` : 'Connect in Help and settings to bring in details'}>
          <JiraIcon className="size-3.5" />
          {review.jira.key}
          {review.jira.status && (
            <span className={cn('text-xs', jiraToneClass(tone))}>
              {review.jira.status}
            </span>
          )}
        </Button>
      )}
      {review.figma?.fileKey && (
        <Button variant="outline" size="sm" className="max-w-48" onClick={() => openLink(review.figma?.url)} title={`Open ${review.figma.name || 'Figma file'}`}>
          <FigmaIcon className="size-3.5" />
          <span className="truncate">{review.figma.name || 'Figma file'}</span>
        </Button>
      )}
    </div>
  );
}

/**
 * Opens a review file someone saved and shows it as a new review.
 * @param file The picked file.
 */
async function openReviewFile(file: File) {
  try {
    const reply = await ask('importReview', { contents: await file.text() });
    showReview(reply.group.id);
    toast.success(`Opened ${reply.group.name} with ${plural(reply.count, 'comment', 'comments')}`);
  } catch (error) {
    toast.error(`${file.name} could not be opened. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Draws a review's detail crops again with the current padding.
 * @param reviewKey The review id, or all.
 */
async function redoCrops(reviewKey: string) {
  const work = ask('recropGroup', { groupId: reviewKey === ALL_REVIEWS ? '' : reviewKey });
  toast.promise(work, {
    loading: 'Redoing crops',
    success: (reply) => `Redid ${plural(reply.updated, 'crop', 'crops')}`,
    error: (error) => `Redoing crops failed. ${error instanceof Error ? error.message : String(error)}`,
  });
}

/** Every export, share, send and help action, grouped, each with its icon. */
function MoreMenu({ source }: { source: ExportSource | null }) {
  const { key } = useReviews();
  const fileInput = useRef<HTMLInputElement>(null);
  const empty = !source?.comments.length;
  const run = (action: (from: ExportSource) => unknown) => () => source && action(source);
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) openReviewFile(file);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" data-tour="more" />}>
          <Ellipsis />
          More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup className="lg:hidden">
            <DropdownMenuItem disabled={empty} onClick={() => startRecheck()}>
              <ScanSearch />
              Recheck this page
            </DropdownMenuItem>
            <DropdownMenuItem disabled={empty} onClick={() => openDialog('edit')}>
              <ListChecks />
              Edit comments
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </DropdownMenuGroup>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Export</DropdownMenuLabel>
            <DropdownMenuItem disabled={empty} onClick={run(downloadWord)}>
              <FileText />
              Word file (.doc)
            </DropdownMenuItem>
            <DropdownMenuItem disabled={empty} onClick={run(printPdf)}>
              <Printer />
              PDF or print
            </DropdownMenuItem>
            <DropdownMenuItem disabled={empty} onClick={run(downloadHtml)}>
              <FileCode />
              HTML file
            </DropdownMenuItem>
            <DropdownMenuItem disabled={empty} onClick={run(downloadMarkdown)}>
              <FileDown />
              Markdown file (.md)
            </DropdownMenuItem>
            <DropdownMenuItem disabled={empty} onClick={run(copyMarkdown)}>
              <ClipboardCopy />
              Copy as Markdown
            </DropdownMenuItem>
            <DropdownMenuItem disabled={empty} onClick={run(copyForAgents)}>
              <Bot />
              Copy for agents
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDialog('options')}>
              <SlidersHorizontal />
              Report options
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Share</DropdownMenuLabel>
            <DropdownMenuItem disabled={empty} onClick={run(saveReviewFile)}>
              <Save />
              Save review file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInput.current?.click()}>
              <FolderOpen />
              Open review file
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Send</DropdownMenuLabel>
            <DropdownMenuItem disabled={empty} onClick={() => openDialog('jira')}>
              <JiraIcon />
              Send to Jira
            </DropdownMenuItem>
            <DropdownMenuItem disabled={empty} onClick={() => openDialog('figma')}>
              <FigmaIcon />
              Send to Figma
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Images</DropdownMenuLabel>
            <DropdownMenuItem disabled={empty || !key} onClick={() => key && redoCrops(key)}>
              <Crop />
              Redo crops
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Help</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => startTour()}>
              <Compass />
              Take the tour
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => chrome.runtime.openOptionsPage()}>
              <Settings />
              Help and settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** The bar across the top: brand, review switcher and menu, linked ticket and file, and the main actions. */
export function TopBar() {
  const source = useExportSource();
  const empty = !source?.comments.length;
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:px-4">
      <span className="hidden text-base font-extrabold tracking-tight sm:inline">Margin</span>
      <ReviewSwitcher />
      <ReviewMenu />
      <LinkChips />
      <span className="flex-1" />
      <Button
        variant="outline"
        className="hidden lg:inline-flex"
        disabled={empty}
        onClick={() => startRecheck()}
        title="Recheck every comment on the page you last opened Margin on"
      >
        <ScanSearch />
        Recheck this page
      </Button>
      <Button variant="outline" className="hidden lg:inline-flex" disabled={empty} onClick={() => openDialog('edit')} data-tour="edit">
        <ListChecks />
        Edit comments
      </Button>
      <Button
        className="bg-action text-action-foreground hover:bg-action/80"
        disabled={empty}
        onClick={() => source && copyForDocs(source)}
        data-tour="copy"
      >
        <ClipboardCopy />
        <span className="hidden sm:inline">Copy for Docs</span>
        <span className="sm:hidden">Copy</span>
      </Button>
      <MoreMenu source={source} />
    </header>
  );
}
