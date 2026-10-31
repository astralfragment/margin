import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { plural } from './model';

type Props = {
  open: boolean;
  name: string;
  count: number;
  finalFocus: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onDelete: () => void;
};

/** Asks before deleting a review, naming it and how many comments go with it. */
export function DeleteReviewDialog({ open, name, count, finalFocus, onCancel, onDelete }: Props) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent showCloseButton={false} finalFocus={finalFocus} role="alertdialog" className="max-w-[calc(100%-2rem)] gap-3">
        <DialogHeader>
          <DialogTitle className="font-semibold">Delete {name}?</DialogTitle>
          <DialogDescription>
            {count ? `Its ${plural(count, 'comment')} ${count === 1 ? 'goes' : 'go'} with it.` : 'It has no comments.'} This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end">
          <Button variant="outline" autoFocus onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDelete}>
            Delete review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
