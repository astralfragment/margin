import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { markTourSeen } from '@/lib/tour.js';
import { Popover, PopoverContent } from './ui/popover';

export type TourStep = {
  /** A selector, or a function that measures the spot to point at. */
  target: string | (() => DOMRect | null);
  /** Scrolls the spot into view before the step shows. */
  reveal?: () => void;
  title: string;
  body: string;
};

const PAD = 4;

/**
 * The box of a tour step's target.
 * @param step The tour step.
 */
function measure(step: TourStep) {
  if (typeof step.target === 'function') return step.target();
  const el = document.querySelector(step.target);
  return el?.getClientRects().length ? el.getBoundingClientRect() : null;
}

/**
 * Scrolls a tour step's target into view.
 * @param step The tour step.
 */
function reveal(step: TourStep) {
  if (step.reveal) step.reveal();
  else if (typeof step.target === 'string') document.querySelector(step.target)?.scrollIntoView({ block: 'nearest' });
}

/** Re-renders on window resize, so the spotlight follows its target. */
const useWindowSize = () =>
  useSyncExternalStore(
    (onChange) => {
      addEventListener('resize', onChange);
      return () => removeEventListener('resize', onChange);
    },
    () => `${innerWidth}x${innerHeight}`,
  );

/**
 * Walks through steps that point at real controls, dimming the rest of the page. Steps whose target is missing
 * are skipped. Finishing, skipping, Escape or a click outside marks the tour seen.
 */
export function Tour({ name, steps, onDone }: { name: string; steps: TourStep[]; onDone: () => void }) {
  const [live] = useState(() => {
    const found = steps.filter((step) => measure(step));
    if (found[0]) reveal(found[0]);
    return found;
  });
  const [index, setIndex] = useState(0);
  useWindowSize();
  const step = live[index];
  const rect = step ? measure(step) : null;
  if (!step || !rect) return null;

  const last = index === live.length - 1;
  const finish = () => {
    markTourSeen(name);
    onDone();
  };
  const go = (next: number) => {
    const target = live[next];
    if (!target) return finish();
    reveal(target);
    setIndex(next);
  };

  return (
    <Popover open modal onOpenChange={(open) => !open && finish()}>
      <div aria-hidden className="fixed inset-0 z-50" onClick={finish}>
        <div
          className="pointer-events-none fixed rounded-lg shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] ring-2 ring-ring transition-all duration-200 motion-reduce:transition-none"
          style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      </div>
      <PopoverContent
        anchor={{ getBoundingClientRect: () => new DOMRect(rect.left - PAD, rect.top - PAD, rect.width + PAD * 2, rect.height + PAD * 2) }}
        side="bottom"
        sideOffset={12}
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        initialFocus={() => document.getElementById('tour-next')}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(index + 1);
          else if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
        }}
        className="grid w-80 gap-3 rounded-xl p-4"
      >
        <h2 id="tour-title" className="text-sm font-semibold">
          {step.title}
        </h2>
        <p id="tour-body" className="text-sm font-medium text-muted-foreground">
          {step.body}
        </p>
        <div className="flex items-center gap-2">
          <span className="mr-auto text-sm font-medium text-muted-foreground tabular-nums">
            {index + 1} of {live.length}
          </span>
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>
          {index > 0 && (
            <Button variant="outline" size="sm" onClick={() => go(index - 1)}>
              Back
            </Button>
          )}
          <Button id="tour-next" size="sm" onClick={() => go(index + 1)}>
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
