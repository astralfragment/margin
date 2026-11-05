import { useHotkeys } from 'react-hotkeys-hook';
import { CircleDot, Maximize, MousePointer2, MoveUpRight, Redo2, Square, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MARK_LABELS } from '../shared';
import { pad } from '../format';
import { EditorCanvas } from './editor-canvas';
import { moved } from './geometry';
import { closeEditor, redo, removeMark, replaceMark, select, setNote, setTool, setZoom, undo, useEditor, useHistory, type Tool } from './editor-store';

const TOOLS: { value: Tool; label: string; key: string; Icon: typeof Square }[] = [
  { value: 'select', label: 'Select', key: 'V', Icon: MousePointer2 },
  { value: 'dot', label: 'Marker', key: 'M', Icon: CircleDot },
  { value: 'box', label: 'Box', key: 'B', Icon: Square },
  { value: 'arrow', label: 'Arrow', key: 'A', Icon: MoveUpRight },
];

/**
 * Focuses the note field of a marker in the side list.
 * @param index The marker's place.
 */
function focusNote(index: number) {
  const note = document.getElementById(`editor-note-${index}`);
  note?.scrollIntoView({ block: 'nearest' });
  note?.focus();
}

/**
 * A toolbar button with its shortcut in a tooltip.
 * @param props.label What it does.
 * @param props.shortcut Its key.
 */
function ToolButton({ label, shortcut, ...props }: React.ComponentProps<typeof Button> & { label: string; shortcut: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} {...props} />} />
      <TooltipContent>
        {label} ({shortcut})
      </TooltipContent>
    </Tooltip>
  );
}

/** Pick a tool, undo and redo, and zoom. */
function Toolbar() {
  const { tool, zoom, fit } = useEditor();
  const { canUndo, canRedo } = useHistory();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup aria-label="Tools" value={[tool]} onValueChange={(next) => next[0] && setTool(next[0] as Tool)} variant="outline" size="sm" spacing={0}>
        {TOOLS.map(({ value, label, key, Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger render={<ToggleGroupItem value={value} aria-label={label} />}>
              <Icon />
              <span className="hidden md:inline">{label}</span>
            </TooltipTrigger>
            <TooltipContent>
              {label} ({key})
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <div className="flex items-center">
        <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo}>
          <Undo2 />
        </ToolButton>
        <ToolButton label="Redo" shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
          <Redo2 />
        </ToolButton>
      </div>
      <div className="flex items-center">
        <ToolButton label="Zoom out" shortcut="-" onClick={() => setZoom('out')}>
          <ZoomOut />
        </ToolButton>
        <span className="w-12 text-center text-xs text-muted-foreground tabular-nums" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <ToolButton label="Zoom in" shortcut="+" onClick={() => setZoom('in')}>
          <ZoomIn />
        </ToolButton>
        <Button variant={fit ? 'secondary' : 'ghost'} size="sm" onClick={() => setZoom('fit')} title="Fit to window (0)">
          <Maximize />
          Fit
        </Button>
        <Button variant={!fit && zoom === 1 ? 'secondary' : 'ghost'} size="sm" onClick={() => setZoom(1)} title="Actual size (1)">
          100%
        </Button>
      </div>
    </div>
  );
}

/** The numbered markers with their notes. */
function MarkerList() {
  const { marks, selected } = useEditor();
  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto md:w-80 md:shrink-0">
      <p className="text-xs text-muted-foreground">
        Right-click a number, a box, an arrow, the region or empty space for its actions. Double-click an item to write its note. Delete removes the selected item.
      </p>
      {!marks.length && <p className="text-sm text-muted-foreground">Pick Marker, Box or Arrow, then click or drag on the image. Each one gets a number and a note, and the notes export as a numbered list.</p>}
      <ol className="grid gap-2">
        {marks.map((mark, index) => (
          <li
            key={index}
            className={cn('grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-2 rounded-lg border p-2', selected === index && 'border-ring ring-2 ring-ring/30')}
            onPointerDown={() => select(index)}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-marker text-xs font-extrabold text-white">{index + 1}</span>
            <div className="grid gap-1">
              <b className="text-xs">{MARK_LABELS[mark.kind] ?? 'Marker'}</b>
              <Textarea
                id={`editor-note-${index}`}
                value={mark.note ?? ''}
                rows={2}
                placeholder="What this number points out"
                className="field-sizing-content min-h-14 text-sm"
                onFocus={() => select(index)}
                onChange={(event) => setNote(index, event.target.value)}
              />
              {!mark.note?.trim() && <span className="text-xs text-muted-foreground">Shows on the image. Write a note to list it.</span>}
            </div>
            <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Remove ${index + 1}`} title={`Remove ${index + 1}`} onClick={() => removeMark(index)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/**
 * Moves the selected marker or the region with the arrow keys.
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
 * @param props.commentId The comment open in the editor.
 */
export default function EditorDialog({ commentId }: { commentId: string }) {
  const { number, status, commentId: openId } = useEditor();
  useEditorKeys();
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
      <DialogContent className="flex h-[calc(100dvh-2rem)] w-full max-w-[min(1400px,calc(100%-2rem))] flex-col sm:max-w-[min(1400px,calc(100%-2rem))]" showCloseButton={false}>
        <DialogHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <DialogTitle>Edit image, comment {pad(number)}</DialogTitle>
          <Toolbar />
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
          <EditorCanvas onNote={focusNote} />
          <MarkerList />
        </div>
        <DialogFooter className="items-center">
          <span className="mr-auto text-sm text-muted-foreground" role="status">
            {status}
          </span>
          <Button onClick={() => closeEditor()}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
