import { useCallback, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { ArrowUpRight, Maximize, Minus, MousePointer2, Plus, Redo2, Square, Trash2, Undo2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MARK_LABELS } from '@/lib/marks.js';
import { cn } from '@/lib/utils';
import { useConfirm } from '../confirm';
import { PointMenu, type Anchor } from '../point-menu';
import type { Issue, Mark, Rect } from '../types';
import { plural, send } from '../util';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { EditorEngine, type EngineState, type MenuItem, type Tool } from './engine';
import './editor.css';

/** A numbered marker icon, Lucide has none. */
function MarkerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M11 9.5l1.5-1V16" />
    </svg>
  );
}

const TOOLS: { tool: Tool; label: string; key: string; icon: LucideIcon | typeof MarkerIcon }[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { tool: 'dot', label: 'Marker', key: 'M', icon: MarkerIcon },
  { tool: 'box', label: 'Box', key: 'B', icon: Square },
  { tool: 'arrow', label: 'Arrow', key: 'A', icon: ArrowUpRight },
];

export type ImageEditorHandle = {
  /** Closes the editor the way Done does. False when the reviewer chose to keep editing. */
  requestClose: () => Promise<boolean>;
};

type Props = {
  issue: Issue | null;
  label: string;
  /** True over another dialog. Otherwise the editor covers the preview and leaves the sidebar usable. */
  modal?: boolean;
  onSaved: (id: string, patch: Partial<Issue>) => void;
  onClosed: () => void;
  ref?: Ref<ImageEditorHandle>;
};

/** The images cut at the region when the editor opened, which no longer match once the region moves. */
function cutAtRegion(issue: Issue) {
  const widths = Object.values(issue.shots ?? {}).filter((shot) => shot?.src).length;
  return [widths ? `the ${widths} width ${widths === 1 ? 'shot' : 'shots'}` : '', issue.after ? 'the recheck image' : ''].filter(Boolean);
}

/**
 * Draw numbered markers, boxes and arrows on a comment's screenshot and move or resize its region.
 * Every change saves a moment later, so there is no Save button.
 */
export function ImageEditor({ issue, label, modal = false, onSaved, onClosed, ref }: Props) {
  const confirm = useConfirm();
  const baseQuery = useQuery({
    queryKey: ['editor-base', issue?.id],
    enabled: Boolean(issue),
    gcTime: 0,
    queryFn: async () => {
      const res = await send('editorBase', { id: issue!.id });
      if (!res || res.error) throw new Error(res?.error ?? 'This comment has no screenshot');
      return res as { src: string; hasBox: boolean };
    },
  });
  const base = baseQuery.data;
  const [state, setState] = useState<EngineState | null>(null);
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState<{ at: Anchor; items: MenuItem[] } | null>(null);
  const engine = useRef<EditorEngine | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const notes = useRef<(HTMLTextAreaElement | null)[]>([]);
  const save = useRef({ timer: 0, dirty: false, chain: Promise.resolve(), dropCut: false });
  const live = useRef({ issue, onSaved });
  live.current = { issue, onSaved };

  /** Stores every annotation and the region, then has the background redraw the comment's images. */
  const flush = useCallback(
    async (closing = false) => {
      const ed = engine.current;
      const current = live.current.issue;
      if (!ed || !current || !save.current.dirty) return save.current.chain;
      clearTimeout(save.current.timer);
      save.current.dirty = false;
      const drop = closing && save.current.dropCut;
      const marks: Mark[] = JSON.parse(JSON.stringify(ed.marks));
      const rect: Rect = { ...ed.rect };
      save.current.chain = save.current.chain.then(async () => {
        setNote('Saving');
        const res = await send('annotate', { id: current.id, marks, rect, drop });
        if (res?.error) return setNote(res.error);
        const patch: Partial<Issue> = { marks, shot: res.shot, detail: res.detail };
        if (!ed.hasBox) patch.rect = rect;
        if (drop) Object.assign(patch, { after: null, checkedAt: null, change: null, shots: null, shotsAt: null });
        live.current.onSaved(current.id, patch);
        if (engine.current !== ed) return;
        const blank = marks.filter((m) => !m.note?.trim()).length;
        const cut = ed.regionMoved() ? cutAtRegion(current) : [];
        if (cut.length) setNote(`Saved. Closing with the region moved drops ${cut.join(' and ')}.`);
        else setNote(blank ? `Saved. Write a note for ${blank} so ${blank === 1 ? 'it shows' : 'they show'} in the list.` : 'Saved');
      });
      return save.current.chain;
    },
    [],
  );

  const schedule = useCallback(() => {
    save.current.dirty = true;
    clearTimeout(save.current.timer);
    save.current.timer = window.setTimeout(() => flush(), 500);
  }, [flush]);

  const requestClose = useCallback(async () => {
    const ed = engine.current;
    const current = live.current.issue;
    if (!ed || !current) {
      onClosed();
      return true;
    }
    const cut = ed.regionMoved() ? cutAtRegion(current) : [];
    if (cut.length) {
      const choice = await confirm({
        title: 'Keep the moved region?',
        body: `Moving the region drops ${cut.join(' and ')}, which were cut at the old region. Capture them again from the page afterwards.`,
        buttons: [
          { label: 'Keep editing', value: null },
          { label: 'Put the region back', value: 'back' },
          { label: 'Keep the move', value: 'keep', kind: 'primary' },
        ],
      });
      if (engine.current !== ed) return true;
      if (!choice) return false;
      if (choice === 'back') ed.rect = { ...ed.startRect };
      save.current.dropCut = choice === 'keep';
      save.current.dirty = true;
    } else if (ed.regionMoved()) {
      save.current.dropCut = true;
      save.current.dirty = true;
    }
    await flush(true);
    ed.destroy();
    engine.current = null;
    setState(null);
    setMenu(null);
    setNote('');
    onClosed();
    return true;
  }, [confirm, flush, onClosed]);

  useImperativeHandle(ref, () => ({ requestClose }), [requestClose]);

  const onImageLoad = () => {
    if (!issue || !base || engine.current || !canvas.current || !stage.current || !img.current || !svg.current) return;
    save.current = { timer: 0, dirty: false, chain: Promise.resolve(), dropCut: false };
    engine.current = new EditorEngine(
      { canvas: canvas.current, stage: stage.current, img: img.current, svg: svg.current },
      { marks: issue.marks ?? [], rect: issue.rect, viewportWidth: issue.viewport.width, hasBox: base.hasBox },
      {
        onState: setState,
        onDirty: schedule,
        onNote: setNote,
        onMenu: (at, items) => setMenu({ at, items }),
        onCloseMenu: () => setMenu(null),
        focusNote: (i) => {
          notes.current[i]?.scrollIntoView({ block: 'nearest' });
          notes.current[i]?.focus();
        },
        onEscape: () => requestClose(),
      },
    );
    canvas.current.focus({ preventScroll: true });
  };

  const ed = engine.current;
  const open = Boolean(issue);

  return (
    <Dialog open={open} modal={modal} onOpenChange={(next) => !next && requestClose()} disablePointerDismissal>
      <DialogPrimitive.Portal>
        {modal && <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/10" />}
        <DialogPrimitive.Popup
          data-slot="image-editor"
          initialFocus={canvas}
          onKeyDown={(e) => !menu && engine.current?.onKey(e.nativeEvent)}
          className={cn(
            'fixed right-0 bottom-0 z-50 flex flex-col bg-background text-sm outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
            modal ? 'top-0 left-0' : 'top-0 left-0 md:top-14 md:left-72 md:border-l',
          )}
        >
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
            <DialogTitle className="mr-auto truncate text-sm font-semibold">{label}</DialogTitle>
            <ToggleGroup value={state ? [state.tool] : []} onValueChange={(v) => v[0] && engine.current?.setTool(v[0] as Tool)} aria-label="Tools">
              {TOOLS.map(({ tool, label: name, key, icon: Icon }) => (
                <Tip key={tool} label={name} keys={[key]}>
                  <ToggleGroupItem value={tool} aria-label={name}>
                    <Icon className="size-4" />
                    <span className="hidden lg:inline">{name}</span>
                  </ToggleGroupItem>
                </Tip>
              ))}
            </ToggleGroup>
            <div className="flex items-center gap-0.5" role="group" aria-label="History">
              <Tip label="Undo" keys={['Ctrl', 'Z']}>
                <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!state?.canUndo} onClick={() => engine.current?.travel(false)}>
                  <Undo2 />
                </Button>
              </Tip>
              <Tip label="Redo" keys={['Ctrl', 'Shift', 'Z']}>
                <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!state?.canRedo} onClick={() => engine.current?.travel(true)}>
                  <Redo2 />
                </Button>
              </Tip>
            </div>
            <div className="flex items-center gap-0.5" role="group" aria-label="Zoom">
              <Tip label="Zoom out" keys={['-']}>
                <Button variant="ghost" size="icon-sm" aria-label="Zoom out" onClick={() => engine.current?.setZoom('out')}>
                  <Minus />
                </Button>
              </Tip>
              <span className="w-11 text-center text-sm font-medium text-muted-foreground tabular-nums" aria-live="polite">
                {state ? `${Math.round(state.zoom * 100)}%` : ''}
              </span>
              <Tip label="Zoom in" keys={['+']}>
                <Button variant="ghost" size="icon-sm" aria-label="Zoom in" onClick={() => engine.current?.setZoom('in')}>
                  <Plus />
                </Button>
              </Tip>
              <Tip label="Fit to window" keys={['0']}>
                <Button variant="ghost" size="icon-sm" aria-label="Fit to window" aria-pressed={state?.fit ?? true} onClick={() => engine.current?.setZoom('fit')}>
                  <Maximize />
                </Button>
              </Tip>
              <Tip label="Actual size" keys={['1']}>
                <Button variant="ghost" size="sm" aria-pressed={Boolean(state && !state.fit && state.zoom === 1)} onClick={() => engine.current?.setZoom(1)}>
                  100%
                </Button>
              </Tip>
            </div>
            <Button onClick={() => requestClose()}>Done</Button>
          </header>

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,40%)] md:grid-cols-[minmax(0,1fr)_300px] md:grid-rows-1">
            <div ref={canvas} data-slot="editor-canvas" data-tool="select" tabIndex={-1} className="overflow-auto bg-muted p-4 outline-none">
              <div ref={stage} className="relative mx-auto">
                {base && (
                  <img
                    ref={img}
                    src={base.src}
                    alt="Screenshot being annotated"
                    draggable={false}
                    onLoad={onImageLoad}
                    className="pointer-events-none block h-auto w-full rounded-md shadow-sm select-none"
                  />
                )}
                <svg ref={svg} aria-label="Annotations" />
              </div>
            </div>
            <aside className="grid min-h-0 content-start gap-3 overflow-y-auto border-t p-4 md:border-t-0 md:border-l">
              {state && state.marks.length === 0 ? (
                <div className="grid gap-2 rounded-xl border border-dashed p-4 text-sm font-medium text-muted-foreground">
                  <p className="font-semibold text-foreground">Nothing drawn yet</p>
                  <p>Pick Marker, Box or Arrow, then click or drag on the image. Each one gets a number and a note, and the notes export as a numbered list.</p>
                </div>
              ) : (
                <ol className="grid gap-2" aria-label="Annotations">
                  {state?.marks.map((m, i) => (
                    <li
                      key={i}
                      aria-current={state.sel === i}
                      onClick={(e) => e.target === e.currentTarget && ed?.select(i)}
                      className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2 rounded-lg border p-2 transition-colors aria-current:border-ring"
                    >
                      <span className="mt-0.5 grid size-6 place-items-center rounded-full bg-(--marker) text-xs font-medium text-white">{i + 1}</span>
                      <div className="grid min-w-0 gap-1">
                        <span className="text-xs font-medium">{MARK_LABELS[m.kind] ?? 'Marker'}</span>
                        <Textarea
                          ref={(node) => {
                            notes.current[i] = node;
                          }}
                          rows={2}
                          value={m.note ?? ''}
                          placeholder="What this number points out"
                          aria-label={`Note for ${i + 1}`}
                          onFocus={() => ed?.select(i)}
                          onChange={(e) => ed?.setNote(i, e.target.value)}
                          className="min-h-11 text-sm"
                        />
                        {!m.note?.trim() && <span className="text-sm font-medium text-muted-foreground">Shows on the image. Write a note to list it.</span>}
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${i + 1}`} onClick={() => ed?.removeMark(i)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ol>
              )}
              <p className="text-sm font-medium text-muted-foreground">Right-click a number, a box, an arrow, the region or empty space for its actions. Double-click an item to write its note.</p>
            </aside>
          </div>

          <footer className="flex min-h-10 items-center gap-3 border-t px-4 py-2 text-sm font-medium text-muted-foreground" role="status" aria-live="polite">
            {baseQuery.error?.message ||
              note ||
              (base?.hasBox ? 'Captured before clean screenshots were kept, so the region is fixed. Annotations still work.' : state ? plural(state.marks.length, 'annotation', 'annotations') : 'Loading the screenshot')}
          </footer>
          <PointMenu at={menu?.at ?? null} onClose={() => setMenu(null)} label="Image actions" returnFocus={() => canvas.current}>
            {menu?.items.map((item, i) =>
              item ? (
                <DropdownMenuItem key={item.label} disabled={item.disabled} onClick={() => item.action()}>
                  {item.label}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuSeparator key={`sep-${i}`} />
              ),
            )}
          </PointMenu>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

/**
 * A tooltip that shows a tool name and its key.
 * @param props The label, keys and trigger.
 */
function Tip({ label, keys, children }: { label: string; keys: string[]; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children as React.ReactElement} />
      <TooltipContent>
        {label}
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
