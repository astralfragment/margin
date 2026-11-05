/* oxlint-disable react/react-in-jsx-scope -- React 19 uses the automatic JSX runtime. The rule belongs off in .oxlintrc.json. */
import { useMutation } from '@tanstack/react-query';
import { ChevronDownIcon, FilesIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
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
import type { Comment, Review } from '@/lib/model';
import { sendMessage } from '@/lib/protocol';
import { openAllReviews, pickReview } from './actions';
import { belongsHere, plural } from './page';

interface ReviewMenuProps {
  reviews: Review[];
  comments: Comment[];
  /** The review the popup shows, or null when this site has none yet. */
  shown: Review | null;
  host: string;
  /** What the picker says when no review is shown. */
  fallbackTitle: string;
  onNew: () => void;
  onEdit: () => void;
}

/**
 * The review picker in the header. It lists every review to switch to, and holds new, edit, all reviews and delete.
 * @param props.shown The review the popup shows.
 */
export function ReviewMenu({ reviews, comments, shown, host, fallbackTitle, onNew, onEdit }: ReviewMenuProps) {
  const [confirming, setConfirming] = useState(false);
  const countOf = (review: Review) => comments.filter((comment) => comment.groupId === review.id).length;

  const pick = useMutation({
    mutationFn: (review: Review) => pickReview(review, host, belongsHere(review, comments.filter((comment) => comment.groupId === review.id), host)),
    onError: (error) => toast.error(`Could not switch reviews. ${error.message}`),
  });

  const remove = useMutation({
    mutationFn: (review: Review) => sendMessage('removeReview', review.id),
    onSuccess: () => setConfirming(false),
    onError: (error) => toast.error(`Could not delete the review. ${error.message}`),
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" className="h-9 min-w-0 flex-1 justify-start gap-1 px-2 text-base font-semibold" data-review-picker>
              <span className="truncate">{shown?.name ?? fallbackTitle}</span>
              <ChevronDownIcon className="text-muted-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-72">
          {reviews.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Reviews</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={shown?.id ?? ''}
                onValueChange={(id) => {
                  const review = reviews.find((entry) => entry.id === id);
                  if (review) pick.mutate(review);
                }}
              >
                <div className="max-h-56 overflow-y-auto">
                  {reviews.toReversed().map((review) => (
                    <DropdownMenuRadioItem key={review.id} value={review.id} title={review.name}>
                      <span className="flex-1 truncate">{review.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{countOf(review)}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </div>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          )}
          {reviews.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={onNew}>
              <PlusIcon /> New review
            </DropdownMenuItem>
            {shown && (
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon /> Rename or edit links
              </DropdownMenuItem>
            )}
            {reviews.length > 0 && (
              <DropdownMenuItem onClick={openAllReviews}>
                <FilesIcon /> All reviews
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {shown && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirming(true)}>
                <Trash2Icon /> Delete review
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {shown?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {plural(shown ? countOf(shown) : 0, 'comment')} and their screenshots go too. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={() => shown && remove.mutate(shown)}>
              Delete review
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
