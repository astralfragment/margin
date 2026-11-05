import { useRef } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  ChevronDown,
  ClipboardCopy,
  ClipboardList,
  Compass,
  Crop,
  Download,
  Ellipsis,
  FileCode,
  FileDown,
  FileText,
  FolderOpen,
  Layers,
  Pencil,
  Plus,
  Printer,
  Save,
  ScanSearch,
  Send,
  Settings,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ALL_REVIEWS, ask, useSettings } from './data';
import { confirm } from './confirm';
import { copyForAgents, copyForDocs, copyMarkdown, downloadHtml, downloadMarkdown, downloadWord, printPdf, saveReviewFile, type ExportSource } from './exports';
import { FigmaIcon, JiraIcon } from './brand-icons';
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

/**
 * A count at the end of a menu row.
 * @param props.value The count.
 */
const RowCount = ({ value }: { value: number }) => <span className="ml-auto pl-4 text-xs text-muted-foreground tabular-nums">{value}</span>;

/**
 * The review shown, as a button that opens the list of reviews to switch between, then New review, and Edit and
 * Delete for the one shown.
 */
function ReviewSwitcher() {
  const { reviews, review, key } = useReviews();
  const total = reviews.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="max-w-[min(18rem,50vw)] min-w-0 justify-between" data-tour="review" />}>
        <span className="truncate">{review?.name ?? (key === ALL_REVIEWS ? 'All reviews' : 'Reviews')}</span>
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Reviews</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={key} onValueChange={(value: string) => showReview(value)}>
            {reviews.map((entry) => (
              <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                <ClipboardList />
                <span className="truncate">{entry.name}</span>
                <RowCount value={entry.count} />
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem value={ALL_REVIEWS}>
              <Layers />
              All reviews
              <RowCount value={total} />
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuItem onClick={() => openDialog('newReview')}>
            <Plus />
            New review
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {review && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>This review</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => openDialog('editReview')}>
                <Pencil />
                Edit name and links
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => deleteReview(review)}>
                <Trash2 />
                Delete review
              </DropdownMenuItem>
            </DropdownMenuGroup>
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

/**
 * Runs an export once the review and its settings have loaded.
 * @param source The export source, or null while it loads.
 * @param action The export.
 */
const runWith = (source: ExportSource | null, action: (from: ExportSource) => unknown) => () => source && action(source);

/**
 * The download, copy and settings items of the Export menu.
 * @param props.source The export source.
 */
function ExportItems({ source }: { source: ExportSource | null }) {
  const { key } = useReviews();
  const empty = !source?.comments.length;
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>Download</DropdownMenuLabel>
        <DropdownMenuItem disabled={empty} onClick={runWith(source, downloadWord)}>
          <FileText />
          Word file (.doc)
        </DropdownMenuItem>
        <DropdownMenuItem disabled={empty} onClick={runWith(source, printPdf)}>
          <Printer />
          PDF or print
        </DropdownMenuItem>
        <DropdownMenuItem disabled={empty} onClick={runWith(source, downloadHtml)}>
          <FileCode />
          HTML file
        </DropdownMenuItem>
        <DropdownMenuItem disabled={empty} onClick={runWith(source, downloadMarkdown)}>
          <FileDown />
          Markdown file (.md)
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Copy</DropdownMenuLabel>
        <DropdownMenuItem disabled={empty} onClick={runWith(source, copyMarkdown)}>
          <ClipboardCopy />
          Copy as Markdown
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Options</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => openDialog('options')}>
          <SlidersHorizontal />
          What exports include
        </DropdownMenuItem>
        <DropdownMenuItem disabled={empty || !key} onClick={() => key && redoCrops(key)}>
          <Crop />
          Redo crops
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

/**
 * The Send to Jira and Send to Figma items.
 * @param props.empty True when the review has no comments.
 */
function SendItems({ empty }: { empty: boolean }) {
  return (
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
  );
}

/** Narrow bars show only the icon of the Export and Send buttons, square like an icon button. */
const ICON_WHEN_NARROW = 'max-lg:w-8 max-lg:px-0!';

/**
 * Downloads and copies other than the two copy buttons, in a menu beside them.
 * @param props.source The export source.
 */
function ExportMenu({ source }: { source: ExportSource | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" aria-label="Export" className={ICON_WHEN_NARROW} />}>
        <Download />
        <span className="max-lg:hidden">Export</span>
        <ChevronDown data-icon="inline-end" className="max-lg:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <ExportItems source={source} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Send to Jira or Figma, in a menu beside the copy buttons.
 * @param props.empty True when the review has no comments.
 */
function SendMenu({ empty }: { empty: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" disabled={empty} aria-label="Send" className={ICON_WHEN_NARROW} />}>
        <Send />
        <span className="max-lg:hidden">Send</span>
        <ChevronDown data-icon="inline-end" className="max-lg:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <SendItems empty={empty} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Review files and help. Below 1280px it also holds Recheck and Copy for agents, which the bar has no room for.
 * @param props.source The export source.
 */
function MoreMenu({ source }: { source: ExportSource | null }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const empty = !source?.comments.length;
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
        <Tooltip>
          <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="More" data-tour="more" />} />}>
            <Ellipsis />
          </TooltipTrigger>
          <TooltipContent>More</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuGroup className="xl:hidden">
            <DropdownMenuLabel>Review</DropdownMenuLabel>
            <DropdownMenuItem disabled={empty} onClick={() => startRecheck()}>
              <ScanSearch />
              Recheck this page
            </DropdownMenuItem>
            <DropdownMenuItem disabled={empty} onClick={runWith(source, copyForAgents)}>
              <Bot />
              Copy for agents
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator className="xl:hidden" />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Review file</DropdownMenuLabel>
            <DropdownMenuItem disabled={empty} onClick={runWith(source, saveReviewFile)}>
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

/**
 * The bar across the top: brand and review switcher, then the actions. Copy for Docs is the one main action, Copy for
 * agents, Export and Send sit beside it, and the rest is under More. The review's linked ticket and file sit under its
 * heading instead, so the bar never runs out of room for them.
 */
export function TopBar() {
  const source = useExportSource();
  const empty = !source?.comments.length;
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <span className="mr-2 hidden text-base font-extrabold tracking-tight sm:inline">Margin</span>
      <ReviewSwitcher />
      <span className="flex-1" />
      <Button variant="ghost" className="hidden xl:inline-flex" disabled={empty} onClick={() => startRecheck()} title="Recheck every comment on the page you last opened Margin on">
        <ScanSearch />
        Recheck this page
      </Button>
      <div className="flex items-center gap-2" data-tour="export">
        <ExportMenu source={source} />
        <SendMenu empty={empty} />
      </div>
      <Separator orientation="vertical" className="mx-1 hidden data-vertical:h-5 data-vertical:self-center sm:block" />
      <Button variant="outline" className="hidden xl:inline-flex" disabled={empty} onClick={runWith(source, copyForAgents)} title="Copy the review as a task list for a coding agent">
        <Bot />
        Copy for agents
      </Button>
      <Button variant="action" disabled={empty} onClick={runWith(source, copyForDocs)} data-tour="copy" title="Copy the review to paste into Google Docs">
        <ClipboardCopy />
        <span className="hidden sm:inline">Copy for Docs</span>
        <span className="sm:hidden">Copy</span>
      </Button>
      <MoreMenu source={source} />
    </header>
  );
}
