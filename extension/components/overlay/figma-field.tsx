import { Check, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { pickerView, pickFrame, removeFrame, removeLink, setField, setPicker } from './controller';
import { usePage } from './queries';
import { useOverlay, type Card } from './store';

/** The frame linked from the review's Figma file, with a way to remove it. */
function FrameRow({ frame }: { frame: NonNullable<Card['frame']> }) {
  const file = usePage().review?.figma?.name;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted py-2 pr-1 pl-3">
      <div className="grid min-w-0 flex-1">
        <span className="text-xs text-muted-foreground">Frame</span>
        <b className="truncate text-sm font-semibold">{frame.name}</b>
        <span className="truncate text-xs text-muted-foreground">{[frame.page, file].filter(Boolean).join(' in ')}</span>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Remove the frame" onClick={removeFrame}>
        <X />
      </Button>
    </div>
  );
}

/** Searches the frames of the review's Figma file, opening on the page that best matches this one. */
function FramePicker() {
  const picker = useOverlay((s) => s.card?.picker);
  const picked = useOverlay((s) => s.card?.frame?.nodeId);
  const fileName = usePage().review?.figma?.name ?? 'Figma';
  const { visible, groups, query, active } = pickerView();
  if (!picker) return null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    setPicker({ active: active + (e.key === 'ArrowDown' ? 1 : -1) });
  };
  return (
    <div className="grid gap-2 rounded-lg bg-muted p-2">
      <Input
        data-focus="search"
        value={picker.query}
        onChange={(e) => setPicker({ query: e.target.value, active: 0 })}
        onKeyDown={onKeyDown}
        placeholder={`Search frames in ${fileName}`}
        aria-label="Search frames"
        className="bg-background text-sm md:text-sm dark:bg-background"
      />
      <div role="listbox" aria-label="Frames" className="grid max-h-56 gap-0.5 overflow-y-auto">
        {groups.map((group) =>
          group.frames.length ? (
            <div key={group.page} className="grid gap-0.5">
              <span className="px-2 pt-1 text-xs font-semibold text-muted-foreground">{group.page || 'Frames'}</span>
              {group.frames.map((frame) => {
                const i = visible.indexOf(frame);
                return (
                  <button
                    key={frame.id}
                    type="button"
                    role="option"
                    aria-selected={picked === frame.id}
                    data-active={i === active ? '' : undefined}
                    onClick={() => pickFrame(frame)}
                    className={cn(
                      'flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-background focus-visible:ring-3 focus-visible:ring-ring/50',
                      i === active && 'bg-background',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{frame.name}</span>
                    {picked === frame.id && <Check className="size-4" />}
                  </button>
                );
              })}
            </div>
          ) : (
            !query && (
              <button
                key={group.page}
                type="button"
                onClick={() => setPicker({ page: group.page, active: 0 })}
                className="h-7 justify-self-start rounded-md px-2 text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {group.page || 'Other frames'}, {group.count} {group.count === 1 ? 'frame' : 'frames'}
              </button>
            )
          ),
        )}
        {!visible.length && query && <span className="p-2 text-xs text-muted-foreground">No frames match</span>}
      </div>
    </div>
  );
}

/** The Figma frame or pasted link for the comment, whichever applies. */
export function FigmaField({ card }: { card: Card }) {
  return (
    <>
      {card.frame && <FrameRow frame={card.frame} />}
      {card.showLink && (
        <div className="flex items-center gap-2">
          <Input
            data-focus="link"
            value={card.link}
            onChange={(e) => setField('link', e.target.value)}
            placeholder="Paste a Figma link"
            aria-label="Figma link"
            className="flex-1 text-sm md:text-sm"
          />
          <Button variant="ghost" size="icon-sm" aria-label="Remove the Figma link" onClick={removeLink}>
            <X />
          </Button>
        </div>
      )}
      <FramePicker />
    </>
  );
}
