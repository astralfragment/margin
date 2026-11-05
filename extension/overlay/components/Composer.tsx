import { useCallback, type KeyboardEvent, type ReactNode } from 'react';
import { CircleAlertIcon, MonitorSmartphoneIcon, SquareDashedIcon } from 'lucide-react';
import { padNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useOverlay, overlayStore } from '../store';
import { isFilled } from '../store/composer';
import type { Card } from '../store/types';
import { NumberFlag } from './NumberFlag';
import { AddActions, FigmaField, MarkerNotes, NoteField, SeverityPicker, TitleField } from './composer/CardFields';
import { followArea } from './composer/follow-area';

/**
 * Turns a capture error into the heading and advice the card shows.
 * @param error The error from the service worker.
 */
function errorCopy(error: string) {
  if (/permission|activeTab|all_urls|cannot be scripted|not allowed/i.test(error)) {
    return ['Chrome blocked the screenshot.', 'Click the Margin icon in the Chrome toolbar once, then try again. Your draft is kept.'];
  }
  return ['The screenshot failed.', `${error.replace(/\.$/, '')}. Your draft is kept.`];
}

/**
 * Handles Enter inside the card: it saves from the title, marker notes and link, adds a line in the note unless Ctrl
 * is held, and tries again after a failed capture. Every key stays inside the card, so the page never reacts to typing.
 * @param event The key press.
 */
function onCardKey(event: KeyboardEvent<HTMLElement>) {
  event.stopPropagation();
  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
  const target = event.target as HTMLElement;
  if (target.closest('[data-margin-popup]') || target.localName === 'button') return;
  const line = target.localName === 'input' || target.hasAttribute('data-line');
  if (!line && !event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const { card, retry, save } = overlayStore.getState();
  if (card?.error) void retry();
  else void save();
}

/**
 * An icon button in the card's header, named by its tooltip.
 * @param props The tooltip text, its key, what it does and its icon.
 */
function HeaderButton({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} />}>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Why the screenshot failed and what to do, as plain lines in the card with no box of their own. Try again sits in the
 * footer, and saving without the screenshot is a link in the sentence.
 * @param props The card, which holds the error.
 */
function CaptureError({ card }: { card: Card }) {
  const { saveWithoutShot } = overlayStore.getState();
  const [heading, advice] = errorCopy(card.error ?? '');
  return (
    <div role="alert" className="grid gap-1 px-4 pt-3">
      <span className="flex items-center gap-2 font-semibold text-blocker">
        <CircleAlertIcon className="size-4 shrink-0" />
        {heading}
      </span>
      <p className="text-xs text-muted-foreground">
        {advice}{' '}
        {isFilled(card) ? (
          <button
            type="button"
            disabled={card.busy !== null}
            className="cursor-pointer font-semibold text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
            onClick={() => void saveWithoutShot()}
          >
            Save it without a screenshot
          </button>
        ) : (
          'Or write the comment and save it without one.'
        )}
      </p>
    </div>
  );
}

/** The card's footer: Save and Discard, Try again after a failed screenshot, or a question before something is lost. */
function CardFooter({ card }: { card: Card }) {
  const markerCount = useOverlay((state) => state.markers.length);
  const { askDiscard, confirmAsk, keepEditing, save, retry } = overlayStore.getState();
  const filled = isFilled(card);
  if (card.asking) {
    const parts = [card.note.trim() && 'its note', markerCount && `${markerCount} ${markerCount === 1 ? 'marker' : 'markers'}`].filter(Boolean);
    const number = padNumber(card.number);
    const [question, confirm, keep] = {
      discard: [`Discard comment ${number}${parts.length ? `, ${parts.join(' and ')}` : ''}?`, 'Discard', 'Keep editing'],
      delete: [`Delete comment ${number}?`, 'Delete', 'Keep it'],
      changes: [`Discard your changes to comment ${number}?`, 'Discard changes', 'Keep editing'],
    }[card.asking];
    return (
      <div className="grid gap-3 border-t px-4 py-3">
        <span className="font-semibold">{question}</span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Esc again keeps it</span>
          <span className="flex-1" />
          <Button variant="destructive" onClick={confirmAsk}>
            {confirm}
          </Button>
          <Button autoFocus onClick={keepEditing}>
            {keep}
          </Button>
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-t px-4 py-3">
      <Button variant={card.reopened ? 'destructive' : 'ghost'} className={card.reopened ? '' : '-ml-3'} onClick={askDiscard}>
        {card.reopened ? 'Delete' : 'Discard'}
      </Button>
      <span className="flex-1" />
      {card.error ? (
        <Tooltip>
          <TooltipTrigger render={<Button data-card-retry variant="action" disabled={card.busy !== null} onClick={() => void retry()} />}>
            {card.busy === 'retrying' ? 'Trying again' : 'Try again'}
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Try again <Kbd>Enter</Kbd>
          </TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<Button data-card-save variant="action" disabled={!filled || card.busy !== null} onClick={() => void save()} />}>
            {card.busy === 'saving' ? 'Saving' : 'Save comment'}
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Save <Kbd>Enter</Kbd>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/** The comment card, beside its area and never over it, with the area kept highlighted. */
export default function Composer() {
  const card = useOverlay((state) => state.card);
  const { redraw, captureWidths } = overlayStore.getState();
  const follow = useCallback((element: HTMLDivElement | null) => {
    const tail = element?.querySelector<HTMLElement>('[data-card-tail]');
    if (!element || !tail) return;
    return followArea(element, tail);
  }, []);
  if (!card) return null;
  const heading = card.reopened ? 'Edit comment' : 'New comment';
  const shotId = card.hasShot ? card.id : null;
  return (
    <div
      ref={follow}
      data-margin-card
      data-margin-float
      role="dialog"
      aria-label={`${heading} ${padNumber(card.number)}`}
      className="fixed top-0 left-0 flex w-[380px] max-w-[calc(100vw-16px)] cursor-default flex-col rounded-xl border bg-popover text-popover-foreground shadow-lg"
      onKeyDown={onCardKey}
    >
      <i data-card-tail className="absolute size-3 border-b border-l bg-popover" />
      <div className="flex shrink-0 items-center gap-2 pt-3 pr-3 pl-4">
        <NumberFlag number={card.number} />
        <h2 className="font-semibold whitespace-nowrap">{heading}</h2>
        <span className="flex-1" />
        <HeaderButton label="Draw the area again" shortcut="R" onClick={redraw}>
          <SquareDashedIcon />
        </HeaderButton>
        {shotId && (
          <HeaderButton label="Screenshot at 3 screen sizes" onClick={() => void captureWidths({ ids: [shotId] })}>
            <MonitorSmartphoneIcon />
          </HeaderButton>
        )}
      </div>
      {card.error && <CaptureError card={card} />}
      <div className="flex min-h-0 flex-col gap-3 overflow-auto p-4">
        <TitleField />
        <SeverityPicker />
        <NoteField />
        <MarkerNotes />
        <FigmaField />
        <AddActions />
      </div>
      <CardFooter card={card} />
    </div>
  );
}
