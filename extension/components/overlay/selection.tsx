import { cn } from '@/lib/utils';
import { boxStyle, flagOffset, inset } from './geometry';
import { useOverlay } from './store';

const HOVER_NOTE = { full: 'Fills the whole view', frame: 'Frame, drag to mark inside it' };

/** The band while dragging, the outline of the element under the pointer, and the area being saved. */
export function Selection() {
  const drag = useOverlay((s) => s.drag);
  const hover = useOverlay((s) => s.hover);
  const saving = useOverlay((s) => s.saving);
  const scale = useOverlay((s) => s.scale);
  const note = hover?.full ? HOVER_NOTE.full : hover?.frame === true ? HOVER_NOTE.frame : null;
  return (
    <>
      {hover && (
        <div aria-hidden className="pointer-events-none fixed rounded-md border-[1.5px] border-destructive" style={boxStyle(hover.rect, scale)}>
          {note && <span className="absolute top-2 left-2 rounded-sm bg-destructive px-2 py-0.5 text-xs font-semibold text-background">{note}</span>}
        </div>
      )}
      {(drag ?? saving) && (
        <div
          aria-hidden
          className={cn('pointer-events-none fixed rounded-md border-2 border-destructive shadow-[inset_0_0_0_2px_var(--background)]', saving && 'cursor-progress')}
          style={boxStyle(drag ?? inset(saving!, scale), scale)}
        />
      )}
      {saving && (
        <span
          role="status"
          className="pointer-events-none fixed inline-flex h-5 items-center rounded-sm bg-background px-1.5 text-xs font-semibold text-destructive ring-2 ring-destructive ring-inset"
          style={{ left: Math.max(2, saving.x) / scale, top: (saving.y + flagOffset(saving, scale)) / scale }}
        >
          Saving
        </span>
      )}
    </>
  );
}
