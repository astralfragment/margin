import { useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { CircleDot, Maximize, MousePointer2, MoveUpRight, Redo2, Square, Trash2, TriangleAlert, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MARK_LABELS } from '../shared';
import { pad } from '../format';
import { EditorCanvas } from './editor-canvas';
import { moved } from './geometry';
import {
  closeEditor,
  oldRegionSentence,
  redo,
  removeMark,
  replaceMark,
  resetRegion,
  select,
  setNote,
  setTool,
  setZoom,
  undo,
  useDroppedImages,
  useEditor,
  useHistory,
  type Tool,
} from './editor-store';

const TOOLS: { value: Tool; label: string; key: string; Icon: typeof Square; hint: string }[] = [
  { value: 'select', label: 'Select', key: 'V', Icon: MousePointer2, hint: 'Drag a mark or the dashed frame to move it. Right-click for more.' },
  { value: 'dot', label: 'Marker', key: 'M', Icon: CircleDot, hint: 'Click the image to place a numbered marker.' },
  { value: 'box', label: 'Box', key: 'B', Icon: Square, hint: 'Drag across the image to draw a box.' },
  { value: 'arrow', label: 'Arrow', key: 'A', Icon: MoveUpRight, hint: 'Drag from the start of the arrow to what it points at.' },
];

/**
 * Focuses the note field of a mark in the side list.
 * @param index The mark's place.
 */
function focusNote(index: number) {
  const note = document.getElementById(`editor-note-${index}`);
  note?.scrollIntoView({ block: 'nearest' });
  note?.focus();
}

/**
 * An icon button with its name and shortcut in a tooltip.
 * @param props.label What it does.
 * @param props.shortcut Its key.
 */
function ToolButton({ label, shortcut, ...props }: React.ComponentProps<typeof Button> & { label: string; shortcut: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />} />
      <TooltipContent>
        {label} ({shortcut})
      </TooltipContent>
    </Tooltip>
  );
}

/** The tools, undo and redo on the left, and the zoom on the right. */
function Toolbar() {
  const { tool, zoom, fit } = useEditor();
  const { canUndo, canRedo } = useHistory();
  const view: string[] = [];
  if (fit) view.push('fit');
  else if (zoom === 1) view.push('actual');
  return (
    <div role="toolbar" aria-label="Image tools" className="flex flex-wrap items-center gap-2">
      <ToggleGroup aria-label="Tool" value={[tool]} onValueChange={(next) => next[0] && setTool(next[0] as Tool)} variant="outline" size="sm" spacing={1}>
        {TOOLS.map(({ value, label, key, Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} />}>
              <Icon />
              {label}
            </TooltipTrigger>
            <TooltipContent>Shortcut {key}</TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <Separator orientation="vertical" className="mx-1 data-vertical:h-5 data-vertical:self-center" />
      <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo}>
        <Undo2 />
      </ToolButton>
      <ToolButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
        <Redo2 />
      </ToolButton>
      <div className="ml-auto flex items-center gap-1">
        <ToolButton label="Zoom out" shortcut="-" onClick={() => setZoom('out')}>
          <ZoomOut />
        </ToolButton>
        <span className="w-10 text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <ToolButton label="Zoom in" shortcut="+" onClick={() => setZoom('in')}>
          <ZoomIn />
        </ToolButton>
        <ToggleGroup aria-label="Zoom" value={view} onValueChange={(next) => next[0] && setZoom(next[0] === 'fit' ? 'fit' : 1)} variant="outline" size="sm" spacing={1} className="ml-1">
          <ToggleGroupItem value="fit" aria-label="Fit to window (0)">
            <Maximize />
            Fit
          </ToggleGroupItem>
          <ToggleGroupItem value="actual" aria-label="Actual size (1)">
            100%
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}

/** The numbered marks with their notes, or how to add the first one. */
function MarkList() {
  const { marks, selected } = useEditor();
  return (
    <aside aria-label="Marks" className="flex min-h-0 flex-col gap-3 md:w-80 md:shrink-0">
      <h3 className="text-sm font-semibold">Marks</h3>
      {!marks.length ? (
        <p className="text-sm text-muted-foreground">No marks yet. Pick Marker, Box or Arrow, then click or drag on the image. Each mark gets a number and a note.</p>
      ) : (
        <>
          <ol className="grid min-h-0 content-start gap-3 overflow-y-auto p-1">
            {marks.map((mark, index) => {
              const kind = (MARK_LABELS[mark.kind] ?? 'Marker').toLowerCase();
              return (
                <li key={index} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3" onPointerDown={() => select(index)}>
                  <span
                    className={cn(
                      'mt-1 flex size-6 items-center justify-center rounded-full bg-mark text-xs font-extrabold text-white',
                      selected === index && 'ring-2 ring-ink ring-offset-2 ring-offset-background',
                    )}
                  >
                    {index + 1}
                  </span>
                  <Textarea
                    id={`editor-note-${index}`}
                    aria-label={`Note for ${kind} ${index + 1}`}
                    value={mark.note ?? ''}
                    rows={2}
                    placeholder={`Note for this ${kind}`}
                    className="field-sizing-content min-h-16"
                    onFocus={() => select(index)}
                    onChange={(event) => setNote(index, event.target.value)}
                  />
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete ${kind} ${index + 1}`} title={`Delete ${kind} ${index + 1}`} onClick={() => removeMark(index)}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-muted-foreground">Marks with a note are listed under the comment in the report.</p>
        </>
      )}
    </aside>
  );
}

/** The save state on the left of the footer, or the warning once the region has moved. */
function SaveState() {
  const status = useEditor((state) => state.status);
  const dropped = useDroppedImages();
  if (!dropped.length) {
    return (
      <span className="mr-auto text-sm text-muted-foreground" role="status">
        {status || 'Changes save as you go'}
      </span>
    );
  }
  return (
    <div className="mr-auto flex flex-wrap items-center gap-3" role="status">
      <span className="flex items-center gap-2 text-sm text-major">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        {oldRegionSentence(dropped)}
      </span>
      <Button size="sm" variant="outline" onClick={resetRegion}>
        Move it back
      </Button>
    </div>
  );
}

/**
 * Moves the selected mark or the region with the arrow keys.
 * @param dx Horizontal step.
 * @param dy Vertical step.
 */
function nudge(dx: number, dy: number) {
  const { selected, marks, rect, hasBox } = useEditor.getState();
  if (selected === 'region' && !hasBox) useEditor.setState({ rect: moved(rect, dx, dy) });
  const mark = typeof selected === 'number' ? marks[selected] : undefined;
  if (mark && typeof selected === 'number') replaceMark(selected, moved(mark, dx, dy));
}

/** The editor's keys. Typing in a note leaves them alone. */
function useEditorKeys() {
  const options = { enableOnFormTags: false, preventDefault: true } as const;
  useHotkeys('v', () => setTool('select'), options);
  useHotkeys('m', () => setTool('dot'), options);
  useHotkeys('b', () => setTool('box'), options);
  useHotkeys('a', () => setTool('arrow'), options);
  useHotkeys('mod+z', undo, options);
  useHotkeys('mod+shift+z, mod+y', redo, options);
  useHotkeys('equal, shift+equal, plus', () => setZoom('in'), options);
  useHotkeys('minus', () => setZoom('out'), options);
  useHotkeys('0', () => setZoom('fit'), options);
  useHotkeys('1', () => setZoom(1), options);
  useHotkeys(
    'delete, backspace',
    () => {
      const { selected } = useEditor.getState();
      if (typeof selected === 'number') removeMark(selected);
    },
    options,
  );
  useHotkeys('left', () => nudge(-1, 0), options);
  useHotkeys('right', () => nudge(1, 0), options);
  useHotkeys('up', () => nudge(0, -1), options);
  useHotkeys('down', () => nudge(0, 1), options);
  useHotkeys('shift+left', () => nudge(-10, 0), options);
  useHotkeys('shift+right', () => nudge(10, 0), options);
  useHotkeys('shift+up', () => nudge(0, -10), options);
  useHotkeys('shift+down', () => nudge(0, 10), options);
}

/**
 * The image editor for one comment: boxes, arrows and numbered markers on its clean screenshot, and its region.
 * Changes save as they are made, and Done saves what is left and closes.
 * @param props.commentId The comment open in the editor.
 */
export default function EditorDialog({ commentId }: { commentId: string }) {
  const { number, title, tool, closing, commentId: openId } = useEditor();
  useEditorKeys();
  const hint = TOOLS.find((entry) => entry.value === tool)?.hint;
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog
      open={openId === commentId}
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === 'escape-key' && useEditor.getState().selected !== null) {
          details.cancel();
          select(null);
          return;
        }
        closeEditor();
      }}
    >
      <DialogContent
        ref={popup}
        initialFocus={popup}
        className="flex h-[calc(100dvh-2rem)] w-full max-w-[min(1400px,calc(100%-2rem))] flex-col sm:max-w-[min(1400px,calc(100%-2rem))]" showCloseButton={false}>
        <DialogHeader className="gap-1">
          <DialogTitle>Edit image</DialogTitle>
          <DialogDescription className="truncate">
            Comment {pad(number)}, {title}
          </DialogDescription>
        </DialogHeader>
        <Toolbar />
        <div className="flex min-h-0 flex-1 flex-col gap-6 md:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <EditorCanvas onNote={focusNote} />
            <p className="truncate text-xs text-muted-foreground">{hint}</p>
          </div>
          <MarkList />
        </div>
        <DialogFooter className="items-center">
          <SaveState />
          <Button disabled={closing} onClick={() => closeEditor()}>
            {closing && <Spinner />}
            {closing ? 'Saving' : 'Done'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
