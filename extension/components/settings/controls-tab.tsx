import { ControlsReference } from '@/components/margin/controls-reference';
import { Keys } from '@/components/margin/shortcut';

/** Every key and gesture, plus where else to find them. */
export function ControlsTab() {
  return (
    <div className="grid gap-6">
      <p className="max-w-[62ch] text-sm leading-6 font-medium text-muted-foreground">
        Press <Keys keys={['?']} className="align-middle" /> in the report, or the question mark in the Margin menu, to see these any time. Right-click any page for Margin in Chrome's own menu too.
      </p>
      <div className="rounded-xl border bg-card p-4">
        <ControlsReference />
      </div>
    </div>
  );
}
