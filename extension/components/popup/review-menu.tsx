import type { Ref } from 'react';
import { Ellipsis, Files, Flag, Link2, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconButton } from './icon-button';

type Props = {
  /** True when a review is open here, which adds the actions on it. */
  open: boolean;
  hasLinks: boolean;
  hasReviews: boolean;
  triggerRef: Ref<HTMLButtonElement>;
  onRename: () => void;
  onLinks: () => void;
  onNew: () => void;
  onAll: () => void;
  onSettings: () => void;
  onProblem: () => void;
  onDelete: () => void;
};

/** Everything that is not about annotating this page: the review's name and links, other reviews, settings. */
export function ReviewMenu({ open, hasLinks, hasReviews, triggerRef, onRename, onLinks, onNew, onAll, onSettings, onProblem, onDelete }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton label="Review menu" ref={triggerRef}>
            <Ellipsis />
          </IconButton>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        {open && (
          <>
            <DropdownMenuItem onClick={onRename}>
              <Pencil />
              Rename review
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLinks}>
              <Link2 />
              {hasLinks ? 'Edit links' : 'Add Jira or Figma link'}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={onNew}>
          <Plus />
          New review
        </DropdownMenuItem>
        {hasReviews && (
          <DropdownMenuItem onClick={onAll}>
            <Files />
            All reviews
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSettings}>
          <Settings />
          Help and settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onProblem}>
          <Flag />
          Report a problem
        </DropdownMenuItem>
        {open && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 />
              Delete review
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
