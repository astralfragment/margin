import { useCallback, type KeyboardEvent } from 'react';
import { CircleAlertIcon, EllipsisIcon } from 'lucide-react';
import { padNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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

/** The More menu, which holds the capture at three widths. */
function MoreMenu({ card }: { card: Card }) {
  const { editCard, captureWidths } = overlayStore.getState();
  const ready = Boolean(card.id && card.hasShot);
  return (
    <DropdownMenu modal={false} open={card.moreOpen} onOpenChange={(open) => editCard({ moreOpen: open })}>
      <DropdownMenuTrigger data-margin-popup render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent data-margin-popup data-margin-float side="right" align="start" sideOffset={8} className="w-60">
        <DropdownMenuItem
          disabled={!ready}
          onClick={() => {
            editCard({ moreOpen: false });
            if (card.id) void captureWidths({ ids: [card.id] });
          }}
        >
          Capture at mobile, tablet and desktop widths
        </DropdownMenuItem>
        {!ready && <p className="px-2 pb-1.5 text-[13px] leading-[18px] text-muted-foreground">Needs a screenshot of the area first</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The card's footer: Save and Discard, a question before something is lost, or saving without a screenshot. */
function CardFooter({ card }: { card: Card }) {
  const markerCount = useOverlay((state) => state.markers.length);
  const { askDiscard, confirmAsk, keepEditing, save, saveWithoutShot } = overlayStore.getState();
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
      <div className="grid gap-2 border-t p-3">
        <span className="font-semibold">{question}</span>
        <span className="flex items-center gap-2">
          <span className="text-[13px] leading-[18px] text-muted-foreground">Esc again keeps it</span>
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
    <div className="flex items-center gap-2 border-t p-3">
      <Button variant={card.reopened ? 'destructive' : 'ghost'} onClick={askDiscard}>
        {card.reopened ? 'Delete' : 'Discard'}
      </Button>
      <span className="flex-1" />
      {card.error ? (
        <Button variant="outline" disabled={!filled || card.busy !== null} title={filled ? '' : 'Add a title or a note first'} onClick={() => void saveWithoutShot()}>
          Save without screenshot
        </Button>
      ) : (
        <>
          <span className="text-[13px] leading-[18px] whitespace-nowrap text-muted-foreground">Enter to save</span>
          <Button disabled={!filled || card.busy !== null} title={filled ? '' : 'Add a title or a note first'} onClick={() => void save()}>
            {card.busy === 'saving' ? 'Saving' : 'Save comment'}
          </Button>
        </>
      )}
    </div>
  );
}

/** The comment card, beside its area and never over it, with the area kept highlighted. Loaded on demand. */
export default function Composer() {
  const card = useOverlay((state) => state.card);
  const { redraw, retry } = overlayStore.getState();
  const follow = useCallback((element: HTMLDivElement | null) => {
    const tail = element?.querySelector<HTMLElement>('[data-card-tail]');
    if (!element || !tail) return;
    return followArea(element, tail);
  }, []);
  if (!card) return null;
  const heading = card.reopened ? 'Edit comment' : 'New comment';
  const [errorHead, errorBody] = card.error ? errorCopy(card.error) : ['', ''];
  return (
    <div
      ref={follow}
      data-margin-card
      data-margin-float
      role="dialog"
      aria-label={`${heading} ${padNumber(card.number)}`}
      className="fixed top-0 left-0 flex w-[360px] max-w-[calc(100vw-16px)] cursor-default flex-col rounded-[10px] border bg-popover text-popover-foreground shadow-md"
      onKeyDown={onCardKey}
    >
      <i data-card-tail className="absolute size-3 border-b border-l bg-popover" />
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b px-3 py-2">
        <NumberFlag draft number={card.number} />
        <h2 className="text-base leading-[22px] font-extrabold tracking-[-0.01em] whitespace-nowrap">{heading}</h2>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" title="Drag a new area and keep this draft, key R" onClick={redraw}>
          Redraw
        </Button>
        <MoreMenu card={card} />
      </div>
      {card.error && (
        <div role="alert" className="grid shrink-0 gap-2 border-l-[3px] border-destructive bg-blocker-tint py-3 pr-3 pl-[13px]">
          <span className="flex items-center gap-2 font-semibold">
            <CircleAlertIcon className="size-4 text-destructive" />
            {errorHead}
          </span>
          <p className="text-[13px] leading-[18px] text-muted-foreground">{errorBody}</p>
          <span className="flex items-center gap-2">
            <Button disabled={card.busy !== null} onClick={() => void retry()}>
              {card.busy === 'retrying' ? 'Trying again' : 'Try again'}
            </Button>
            <span className="text-[13px] leading-[18px] text-muted-foreground">Enter tries again</span>
          </span>
        </div>
      )}
      <div className="flex min-h-0 flex-col gap-3 overflow-auto px-3 py-4">
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
