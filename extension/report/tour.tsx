import { create } from 'zustand';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { toursSeenItem } from '@/lib/storage';

/**
 * The report's guided tour: a few tips that point at real controls, with the rest of the page dimmed. Steps whose
 * control is hidden at this width are skipped.
 */

interface Step {
  target: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  { target: '[data-tour="review"]', title: 'One review per round', body: 'Each review holds one round of comments. Switch, edit or start a new one here.' },
  { target: '[data-tour="sidebar"]', title: 'Every comment', body: 'Sorted by severity or by number. Filter or search to jump to one in the report.' },
  { target: '[data-comment-id] img', title: 'Number the details', body: 'Click a screenshot to drop a numbered marker. Use Open editor for boxes and arrows.' },
  { target: '[data-tour="edit"]', title: 'Tidy the wording', body: 'Fix titles, notes and severity for every comment in one place.' },
  { target: '[data-tour="copy"]', title: 'Hand it over', body: 'Paste the whole review into Google Docs. Numbered notes stay numbered.' },
  { target: '[data-tour="more"]', title: 'More ways out', body: 'Word, PDF, HTML and Markdown, review files to share, Jira and Figma, report options, and this tour again.' },
];

const useTour = create<{ steps: Step[]; at: number; rect: DOMRect | null }>(() => ({ steps: [], at: 0, rect: null }));

/**
 * The visible element a step points at, or null when it is hidden at this width.
 * @param step The step.
 */
function targetOf(step: Step) {
  const element = document.querySelector<HTMLElement>(step.target);
  return element && element.getClientRects().length ? element : null;
}

/**
 * Shows one step, scrolled into view and measured.
 * @param at The step's place.
 */
function show(at: number) {
  const { steps } = useTour.getState();
  const element = steps[at] && targetOf(steps[at]);
  if (!element) {
    finish();
    return;
  }
  element.scrollIntoView({ block: 'nearest' });
  useTour.setState({ at, rect: element.getBoundingClientRect() });
}

/** Ends the tour and remembers it was seen. */
async function finish() {
  useTour.setState({ steps: [], rect: null });
  try {
    await toursSeenItem.setValue({ ...(await toursSeenItem.getValue()), report: true });
  } catch (error) {
    console.error('The tour could not be marked as seen', error);
  }
}

/** Starts the tour from the first step. */
export function startTour() {
  useTour.setState({ steps: STEPS.filter((step) => targetOf(step)) });
  show(0);
}

const offered = { done: false };

/** Starts the tour once, the first time the report shows comments, unless it was seen before. */
export async function startTourOnce() {
  if (offered.done) return;
  offered.done = true;
  if ((await toursSeenItem.getValue()).report) return;
  requestAnimationFrame(startTour);
}

/** The dimmed page, the ring round the control and the tip beside it. */
export function Tour() {
  const { steps, at, rect } = useTour();
  const step = steps[at];
  if (!rect || !step) return null;
  const last = at === steps.length - 1;
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-40 rounded-lg ring-2 ring-ring transition-all motion-reduce:transition-none"
        style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8, boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.45)' }}
      />
      <Popover open onOpenChange={(open) => !open && finish()}>
        <PopoverTrigger
          nativeButton={false}
          render={<span aria-hidden="true" className="pointer-events-none fixed" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />}
        />
        <PopoverContent side="bottom" align="start" sideOffset={12} className="w-80">
          <PopoverHeader>
            <PopoverTitle>{step.title}</PopoverTitle>
            <PopoverDescription>{step.body}</PopoverDescription>
          </PopoverHeader>
          <div className="flex items-center gap-2">
            <span className="mr-auto text-xs text-muted-foreground">
              {at + 1} of {steps.length}
            </span>
            <Button size="sm" variant="ghost" onClick={finish}>
              Skip
            </Button>
            {at > 0 && (
              <Button size="sm" variant="outline" onClick={() => show(at - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" className="bg-action text-action-foreground hover:bg-action/80" autoFocus onClick={() => (last ? finish() : show(at + 1))}>
              {last ? 'Done' : 'Next'}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}
