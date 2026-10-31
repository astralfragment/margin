import { useLayoutEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { browser } from 'wxt/browser';
import { Button } from '@/components/ui/button';

/** Shared with lib/tour.js, so Help and settings can show every tour again. */
const TOURS_KEY = 'tours';
const GAP = 8;
const EDGE = 8;
const PAD = 4;

export type TourStep = { target: string; title: string; body: string };

const rectOf = (step: TourStep | undefined) => {
  const el = step && document.querySelector(step.target);
  return el && el.getClientRects().length ? el.getBoundingClientRect() : null;
};

/**
 * Walks through steps that point at real controls, dimming the rest. Steps whose target is missing are left out.
 * Finishing or skipping marks the tour done, which hides it.
 */
export function Tour({ name, steps }: { name: string; steps: TourStep[] }) {
  const [live, setLive] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<{ spot: DOMRect; left: number; top: number } | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const finish = useMutation({
    mutationFn: async () => {
      const done = (await browser.storage.local.get(TOURS_KEY))[TOURS_KEY] ?? {};
      await browser.storage.local.set({ [TOURS_KEY]: { ...done, [name]: true } });
    },
  });
  const step = live?.[index];
  const last = index === (live?.length ?? 0) - 1;

  /**
   * Finds the steps whose targets are on screen once they have drawn, then measures the current target and places
   * the tip below it, or above when there is no room, again on every resize.
   */
  useLayoutEffect(() => {
    if (!live) {
      setLive(steps.filter((s) => rectOf(s)));
      return;
    }
    const place = () => {
      if (!step || !tip.current) return;
      document.querySelector(step.target)?.scrollIntoView({ block: 'nearest' });
      const r = rectOf(step);
      if (!r) return;
      const w = tip.current.offsetWidth;
      const h = tip.current.offsetHeight;
      const below = r.bottom + PAD + GAP;
      const above = r.top - PAD - GAP - h;
      const top = below + h <= innerHeight - EDGE ? below : above >= EDGE ? above : innerHeight - h - EDGE;
      setBox({ spot: r, left: Math.min(Math.max(EDGE, r.left), innerWidth - w - EDGE), top: Math.min(Math.max(EDGE, top), innerHeight - h - EDGE) });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [live, step]);

  if (!step || finish.isPending || finish.isSuccess) return null;
  const go = (to: number) => (to >= live!.length ? finish.mutate() : setIndex(Math.max(0, to)));
  return (
    <div
      className="fixed inset-0 z-50"
      onClick={(event) => !tip.current?.contains(event.target as Node) && finish.mutate()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish.mutate();
        } else if (event.key === 'ArrowRight') {
          go(index + 1);
        } else if (event.key === 'ArrowLeft') {
          go(index - 1);
        } else if (event.key === 'Tab') {
          const items = [...(tip.current?.querySelectorAll('button') ?? [])];
          const at = items.indexOf(document.activeElement as HTMLButtonElement) + (event.shiftKey ? -1 : 1);
          if (at < 0 || at >= items.length) {
            event.preventDefault();
            items[(at + items.length) % items.length]?.focus();
          }
        }
      }}
    >
      {box && (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-xl shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] outline-2 outline-ring transition-all duration-200 motion-reduce:transition-none"
          style={{ left: box.spot.left - PAD, top: box.spot.top - PAD, width: box.spot.width + PAD * 2, height: box.spot.height + PAD * 2 }}
        />
      )}
      <div
        ref={tip}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className="fixed grid w-64 gap-2 rounded-xl bg-popover p-4 text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-[top,left] duration-200 motion-reduce:transition-none"
        style={{ left: box?.left ?? EDGE, top: box?.top ?? EDGE }}
      >
        <h2 id="tour-title" className="text-sm font-semibold">
          {step.title}
        </h2>
        <p id="tour-body" className="text-sm text-muted-foreground">
          {step.body}
        </p>
        <div className="mt-2 flex items-center gap-1">
          <span className="flex-1 text-xs text-muted-foreground tabular-nums">
            {index + 1} of {live!.length}
          </span>
          <Button size="sm" variant="ghost" onClick={() => finish.mutate()}>
            Skip
          </Button>
          {index > 0 && (
            <Button size="sm" variant="outline" onClick={() => go(index - 1)}>
              Back
            </Button>
          )}
          <Button key={index} size="sm" autoFocus onClick={() => go(index + 1)}>
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
