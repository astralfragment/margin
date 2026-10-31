import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { CircleAlert, Ellipsis, Link2, MapPin, SquareDashed } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import {
  addFrame,
  askDiscard,
  captureCardWidths,
  confirmAsk,
  keepEditing,
  markOnPage,
  pad,
  pickerView,
  pickFrame,
  redraw,
  removeMark,
  retry,
  save,
  saveWithoutShot,
  setField,
  setSeverity,
  startPlacing,
} from './controller';
import { FigmaField } from './figma-field';
import { Hint, MenuContent } from './floating';
import { BAR_SPACE, EDGE, boxStyle, flagOffset, inset, liveBox } from './geometry';
import { MarkerList } from './marker-list';
import { MarkerDot, RegionNumber } from './marks';
import { usePage } from './queries';
import { SeverityPicker } from './severity-picker';
import { patchCard, useOverlay, type Card } from './store';

type Side = 'right' | 'left' | 'below' | 'above' | 'inside';

const GAP = 12;

/** Turns a capture error into the heading and advice the composer shows. */
function errorCopy(error: string) {
  if (/permission|activeTab|all_urls|cannot be scripted|not allowed/i.test(error)) {
    return ['Chrome blocked the screenshot', 'Click the Margin icon in the Chrome toolbar once, then try again. Your draft is kept.'];
  }
  return ['The screenshot failed', `${error.replace(/\.$/, '')}. Your draft is kept.`];
}

const filled = (card: Card) => Boolean(card.title.trim() || card.note.trim());

/**
 * Places the composer beside its area, never over it: right, then left, below and above, clear of the capture bar
 * and inside the window. Beside the area it grows down from its top edge in the top half of the view and up from
 * its bottom edge in the bottom half, so the footer stays put while it grows.
 */
function usePlacement(node: RefObject<HTMLDivElement | null>, card: Card) {
  const [side, setSide] = useState<Side>('right');
  const scale = useOverlay((s) => s.scale);
  const atTop = useOverlay((s) => s.barAtTop);
  useOverlay((s) => s.frame);
  useLayoutEffect(() => {
    const el = node.current;
    if (!el) return;
    const r = liveBox(card);
    const vw = innerWidth;
    const vh = innerHeight;
    const edge = EDGE * scale;
    const gap = GAP * scale;
    const ceil = atTop ? BAR_SPACE * scale : edge;
    const floor = vh - BAR_SPACE * scale;
    Object.assign(el.style, { top: '', bottom: '', maxHeight: '' });
    const w = el.offsetWidth * scale;
    const h = el.offsetHeight * scale;
    const px = (v: number) => `${v / scale}px`;
    const clampX = (x: number) => Math.min(Math.max(edge, x), vw - w - edge);
    const right = r.x + r.w + gap;
    const left = r.x - gap - w;
    let next: Side;
    if (right + w <= vw - edge) next = 'right';
    else if (left >= edge) next = 'left';
    else if (r.y + r.h + gap + h <= floor) next = 'below';
    else if (r.y - gap - h >= ceil) next = 'above';
    else next = 'inside';
    const fromTop = (top: number) => {
      const at = Math.min(Math.max(ceil, top), Math.max(ceil, floor - h));
      Object.assign(el.style, { top: px(at), maxHeight: px(floor - at) });
    };
    const fromBottom = (bottom: number) => {
      const at = Math.min(floor, Math.max(bottom, h + ceil));
      Object.assign(el.style, { bottom: px(vh - at), maxHeight: px(at - ceil) });
    };
    if (next === 'right' || next === 'left') {
      el.style.left = px(next === 'right' ? right : left);
      if (r.y + r.h / 2 < vh / 2) fromTop(r.y);
      else fromBottom(Math.min(r.y + r.h, floor));
    } else if (next === 'below') {
      el.style.left = px(clampX(r.x));
      fromTop(r.y + r.h + gap);
    } else if (next === 'above') {
      el.style.left = px(clampX(r.x));
      fromBottom(r.y - gap);
    } else {
      el.style.left = px(vw - w - 16 * scale);
      fromBottom(floor);
    }
    setSide(next);
  });
  return side;
}

/** The area being commented on, its number and its numbered markers, following the page as it scrolls. */
function DraftRegion({ card, side }: { card: Card; side: Side }) {
  const scale = useOverlay((s) => s.scale);
  useOverlay((s) => s.frame);
  const live = liveBox(card);
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed rounded-md border-2 border-destructive shadow-[inset_0_0_0_2px_var(--background)]" style={boxStyle(inset(live, scale), scale)} />
      <RegionNumber
        n={card.number}
        draft
        aria-hidden
        className="pointer-events-none fixed"
        style={{ left: Math.max(2 * scale, live.x) / scale, top: (live.y + flagOffset(live, scale, side !== 'below')) / scale }}
      />
      {card.marks.map((mark, i) => {
        const at = markOnPage(card, mark);
        return (
          <MarkerDot
            key={i}
            n={i + 1}
            title="Right-click to remove"
            className="fixed -translate-x-1/2 -translate-y-1/2 cursor-context-menu"
            style={{ left: at.x / scale, top: at.y / scale }}
            onContextMenu={(e) => {
              e.preventDefault();
              removeMark(i);
            }}
          />
        );
      })}
    </>
  );
}

/** Capture at three widths, beside the composer so it never hides a field. */
function MoreMenu({ card, side }: { card: Card; side: Side }) {
  const ready = Boolean(card.id && card.hasShot);
  const label = { idle: 'Capture at mobile, tablet and desktop widths', busy: 'Capturing', done: 'Widths saved', failed: 'Capture failed' }[card.widths];
  return (
    <MenuPrimitive.Root open={card.more} onOpenChange={(more) => patchCard({ more })} modal={false}>
      <Hint label="More actions">
        <MenuPrimitive.Trigger data-scope="more-trigger" data-focus="more" render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
          <Ellipsis />
        </MenuPrimitive.Trigger>
      </Hint>
      <MenuContent side={side === 'left' ? 'left' : 'right'} sideOffset={GAP + 4} alignOffset={-8} className="w-64">
        <DropdownMenuItem disabled={!ready || card.widths !== 'idle'} closeOnClick={false} onClick={captureCardWidths}>
          {label}
        </DropdownMenuItem>
        {!ready && <p className="px-1.5 pb-1 text-xs text-muted-foreground">Needs a screenshot of the area first</p>}
      </MenuContent>
    </MenuPrimitive.Root>
  );
}

function Footer({ card }: { card: Card }) {
  if (card.asking) {
    const parts = [card.note.trim() && 'its note', card.marks.length && `${card.marks.length} ${card.marks.length === 1 ? 'marker' : 'markers'}`].filter(Boolean);
    const [question, confirm, keep] = {
      discard: [`Discard comment ${pad(card.number)}${parts.length ? `, ${parts.join(' and ')}` : ''}?`, 'Discard', 'Keep editing'],
      delete: [`Delete comment ${pad(card.number)}?`, 'Delete', 'Keep it'],
      changes: [`Discard your changes to comment ${pad(card.number)}?`, 'Discard changes', 'Keep editing'],
    }[card.asking];
    return (
      <div className="grid gap-3 border-t px-4 py-3">
        <p className="text-sm font-semibold">{question}</p>
        <div className="flex items-center gap-2">
          <span className="flex-1 text-xs text-muted-foreground">Esc keeps it</span>
          <Button variant="destructive" onClick={confirmAsk}>
            {confirm}
          </Button>
          <Button data-focus="keep" onClick={keepEditing}>
            {keep}
          </Button>
        </div>
      </div>
    );
  }
  const ready = filled(card);
  return (
    <div className="flex items-center gap-2 border-t px-4 py-3">
      <Button variant="ghost" className={cn('-ml-2.5', card.reopened && 'text-destructive hover:text-destructive')} onClick={askDiscard}>
        {card.reopened ? 'Delete' : 'Discard'}
      </Button>
      <span className="flex-1" />
      {card.error ? (
        <Button variant="outline" disabled={!ready} onClick={saveWithoutShot}>
          Save without screenshot
        </Button>
      ) : (
        <>
          <span id="margin-save-hint" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {ready ? <Kbd>Enter</Kbd> : 'Add a title to save'}
          </span>
          <Button
            disabled={!ready || card.saving}
            aria-describedby="margin-save-hint"
            className="bg-action text-action-foreground hover:bg-action/85 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            onClick={save}
          >
            Save comment
          </Button>
        </>
      )}
    </div>
  );
}

function ErrorNotice({ error, retrying }: { error: string; retrying: boolean }) {
  const [head, body] = errorCopy(error);
  return (
    <div role="alert" className="mx-4 grid gap-2 rounded-lg bg-destructive/10 p-3">
      <span className="flex items-center gap-2 text-sm font-semibold">
        <CircleAlert className="size-4 text-destructive" />
        {head}
      </span>
      <p className="text-xs text-muted-foreground">{body}</p>
      <span className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={retrying} onClick={retry}>
          Try again
        </Button>
        <span className="text-xs text-muted-foreground">Enter tries again</span>
      </span>
    </div>
  );
}

/**
 * Enter saves from any field and Shift+Enter starts a new line in the note. In the frame search Enter picks the
 * highlighted frame, and after a failed capture it tries again.
 */
function onCardKey(e: KeyboardEvent<HTMLDivElement>, card: Card) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
  const target = e.target as HTMLElement;
  if (target.dataset.focus === 'search') {
    e.preventDefault();
    const { visible, active } = pickerView();
    pickFrame(visible[active]);
    return;
  }
  if (target.localName !== 'textarea' && target.localName !== 'input') return;
  if (e.shiftKey && target.dataset.focus === 'note') return;
  e.preventDefault();
  if (e.shiftKey) return;
  if (card.error) retry();
  else save();
}

/** The comment form beside the area: title and note, severity, markers, Figma link, then Discard and Save. */
function ComposerCard({ card }: { card: Card }) {
  const ref = useRef<HTMLDivElement>(null);
  const side = usePlacement(ref, card);
  const hasFrames = Boolean(usePage().review?.figma?.frames?.length);
  const heading = card.reopened ? 'Edit comment' : 'New comment';

  return (
    <>
      <DraftRegion card={card} side={side} />
      <div
        ref={ref}
        data-scope="card"
        role="dialog"
        aria-label={`${heading} ${pad(card.number)}`}
        onKeyDown={(e) => onCardKey(e, card)}
        className="fixed flex w-90 max-w-[calc(var(--vw)-16px)] cursor-default flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 duration-150"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
          <RegionNumber n={card.number} draft />
          <h2 className="flex-1 text-base font-semibold">{heading}</h2>
          <Hint label="Redraw the area" keys={<Kbd>R</Kbd>}>
            <Button variant="ghost" size="icon-sm" aria-label="Redraw the area" onClick={redraw}>
              <SquareDashed />
            </Button>
          </Hint>
          <MoreMenu card={card} side={side} />
        </div>
        {card.error && <ErrorNotice error={card.error} retrying={card.retrying} />}
        <div className="grid min-h-0 gap-3 overflow-y-auto px-4 pt-1 pb-4" onMouseDown={() => card.asking && patchCard({ asking: null })}>
          <div className="rounded-lg border border-input transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
            <textarea
              data-focus="title"
              rows={1}
              value={card.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="What is wrong"
              aria-label="What is wrong"
              className="block max-h-32 w-full resize-none bg-transparent px-3 pt-2 pb-1 text-sm leading-5 font-semibold outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
            <textarea
              data-focus="note"
              rows={1}
              value={card.note}
              onChange={(e) => setField('note', e.target.value)}
              placeholder="What you expected, what happened"
              aria-label="Note"
              className="block max-h-48 min-h-6 w-full resize-none bg-transparent px-3 pt-0 pb-2 text-sm leading-5 outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
          </div>
          <SeverityPicker value={card.severity} onChange={setSeverity} />
          <MarkerList marks={card.marks} placing={card.placing} />
          <FigmaField card={card} />
          {(!card.placing || (!card.frame && !card.showLink)) && (
            <div className="-ml-2 flex items-center gap-1">
              {!card.placing && (
                <Button variant="ghost" size="sm" data-focus="addMarker" className="text-muted-foreground" onClick={startPlacing}>
                  <MapPin />
                  Add marker
                </Button>
              )}
              {!card.frame && !card.showLink && (
                <Button variant="ghost" size="sm" data-focus="addFrame" aria-expanded={Boolean(card.picker)} className="text-muted-foreground" onClick={addFrame}>
                  <Link2 />
                  {hasFrames ? 'Link a frame' : 'Add Figma link'}
                </Button>
              )}
            </div>
          )}
        </div>
        <Footer card={card} />
      </div>
    </>
  );
}

export function Composer() {
  const card = useOverlay((s) => s.card);
  return card ? <ComposerCard card={card} /> : null;
}
