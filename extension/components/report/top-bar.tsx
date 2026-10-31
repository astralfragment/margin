import type { ReactNode } from 'react';
import {
  ChevronDown,
  CircleHelp,
  Code,
  Compass,
  Copy,
  Crop,
  Ellipsis,
  FileText,
  Flag,
  FolderOpen,
  Link2,
  Hash,
  PanelLeft,
  Pencil,
  Printer,
  RefreshCw,
  Rows3,
  Save,
  Settings,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Kbd } from '@/components/ui/kbd';
import { FigmaIcon, JiraIcon, MarginMark } from './brand-icons';
import { LinkChips } from './link-chips';
import { ReviewPicker } from './review-picker';
import type { Group } from './types';
import type { ReviewSummary } from './queries';

export type Actions = {
  copyDocs: () => void;
  word: () => void;
  html: () => void;
  markdown: () => void;
  print: () => void;
  jira: () => void;
  figma: () => void;
  saveFile: () => void;
  openFile: () => void;
  exportSettings: () => void;
  recheck: () => void;
  rename: () => void;
  editLinks: () => void;
  editComments: () => void;
  recrop: () => void;
  tour: () => void;
  reportProblem: () => void;
  help: () => void;
  controls: () => void;
  deleteReview: () => void;
  newReview: () => void;
  pickReview: (id: string) => void;
  toggleSidebar: () => void;
};

type Props = {
  groups: ReviewSummary[];
  groupId: string | null;
  group: Group | null;
  empty: boolean;
  rechecking: boolean;
  actions: Actions;
};

function Item({ icon: Icon, onClick, disabled, children, destructive }: { icon: LucideIcon | typeof JiraIcon; onClick: () => void; disabled?: boolean; children: ReactNode; destructive?: boolean }) {
  return (
    <DropdownMenuItem onClick={onClick} disabled={disabled} variant={destructive ? 'destructive' : 'default'}>
      <Icon className="size-4" />
      {children}
    </DropdownMenuItem>
  );
}

/** Brand, review picker and links on the left. Recheck, Share, help and the review menu on the right. */
export function TopBar({ groups, groupId, group, empty, rechecking, actions }: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Show comments" onClick={actions.toggleSidebar}>
        <PanelLeft />
      </Button>
      <span className="hidden items-center gap-2 pr-2 text-sm font-semibold lg:flex">
        <MarginMark />
        Margin
      </span>
      <ReviewPicker groups={groups} groupId={groupId} onPick={actions.pickReview} onNew={actions.newReview} />
      <LinkChips group={group} />
      <span className="flex-1" />

      <Tooltip>
        <TooltipTrigger
          render={<Button variant="outline" disabled={empty || rechecking} onClick={actions.recheck} aria-label="Recheck this page" data-tour="recheck" />}
        >
          <RefreshCw className={rechecking ? 'animate-spin motion-reduce:animate-none' : undefined} />
          <span className="hidden lg:inline">Recheck</span>
        </TooltipTrigger>
        <TooltipContent>Recheck every comment on the page you last opened Margin on</TooltipContent>
      </Tooltip>

      <div className="flex" data-tour="share">
        <Button disabled={empty} onClick={actions.copyDocs} className="rounded-r-none bg-action text-action-foreground hover:bg-action/85">
          <Copy />
          <span className="hidden sm:inline">Copy for Docs</span>
          <span className="sm:hidden">Copy</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={empty}
            render={<Button size="icon" aria-label="More ways to share" className="rounded-l-none border-l border-l-action-foreground/15 bg-action text-action-foreground hover:bg-action/85" />}
          >
            <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Share</DropdownMenuLabel>
              <Item icon={Copy} onClick={actions.copyDocs}>
                Copy for Google Docs
              </Item>
              <Item icon={FileText} onClick={actions.word}>
                Word file
              </Item>
              <Item icon={Code} onClick={actions.html}>
                HTML file
              </Item>
              <Item icon={Hash} onClick={actions.markdown}>
                Copy as Markdown
              </Item>
              <Item icon={Printer} onClick={actions.print}>
                Print
              </Item>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Send</DropdownMenuLabel>
              <Item icon={JiraIcon} onClick={actions.jira}>
                Send to Jira
              </Item>
              <Item icon={FigmaIcon} onClick={actions.figma}>
                Send to Figma
              </Item>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <Item icon={Save} onClick={actions.saveFile}>
              Save review file
            </Item>
            <Item icon={SlidersHorizontal} onClick={actions.exportSettings}>
              Export settings
            </Item>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Controls and shortcuts" onClick={actions.controls} />}>
          <CircleHelp />
        </TooltipTrigger>
        <TooltipContent>
          Controls <Kbd>?</Kbd>
        </TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Review menu" data-tour="more" />}>
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {group && (
            <>
              <Item icon={Pencil} onClick={actions.rename}>
                Rename review
              </Item>
              <Item icon={Link2} onClick={actions.editLinks}>
                Edit links
              </Item>
            </>
          )}
          <Item icon={Rows3} onClick={actions.editComments} disabled={empty}>
            Edit comments
          </Item>
          <Item icon={Crop} onClick={actions.recrop} disabled={empty}>
            Redo crops
          </Item>
          <Item icon={FolderOpen} onClick={actions.openFile}>
            Open review file
          </Item>
          <DropdownMenuSeparator />
          <Item icon={Compass} onClick={actions.tour}>
            Take the tour
          </Item>
          <Item icon={Flag} onClick={actions.reportProblem}>
            Report a problem
          </Item>
          <Item icon={Settings} onClick={actions.help}>
            Help and settings
          </Item>
          {group && (
            <>
              <DropdownMenuSeparator />
              <Item icon={Trash2} onClick={actions.deleteReview} destructive>
                Delete review
              </Item>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
