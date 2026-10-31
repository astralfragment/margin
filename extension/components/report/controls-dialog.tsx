import { Compass, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ControlsReference } from '@/components/margin/controls-reference';

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onTour: () => void };

/** Every key and gesture for the report and the image editor, with the way to the tour and to settings. */
export function ControlsDialog({ open, onOpenChange, onTour }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b p-5">
          <DialogTitle>Controls</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto p-5">
          <ControlsReference />
        </div>
        <DialogFooter className="m-0 rounded-b-xl">
          <Button variant="ghost" onClick={() => chrome.runtime.openOptionsPage()}>
            <Settings />
            Help and settings
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              onTour();
            }}
          >
            <Compass />
            Take the tour
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
