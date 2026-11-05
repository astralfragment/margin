import { useRef, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect as KonvaRect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ArrowDownToLine, ArrowUpToLine, Copy, Maximize, MoveUpRight, NotebookPen, RotateCcw, Scan, Square, Trash2, CircleDot } from 'lucide-react';
import { MARK_COLOUR } from '@/lib/marks.js';
import type { Marker, Rect } from '@/lib/model';
import { cn } from '@/lib/utils';
import {
  addMark,
  removeMark,
  renumber,
  replaceMark,
  resetRegion,
  select,
  setTool,
  setView,
  setZoom,
  useEditor,
  type Draft,
} from './editor-store';
import { arrowHead, arrowTo, boxAround, clamp, discRadius, handlePoints, handleSize, HANDLES, moved, resized, type Point } from './geometry';

const MARKER = MARK_COLOUR;
const HALO = 'rgba(255,255,255,0.92)';
/** The light theme --ink purple as a literal, since Konva cannot read CSS variables. Selection is UI, so it is purple while the marks stay red. */
const SELECTION = '#7549d2';

/** What a pointer landed on, read from the shape's name. */
interface Hit {
  index: number | null;
  region: boolean;
  part: 'body' | 'badge' | null;
  handle: string | null;
}

/** A drag in progress, kept outside React state since only its result is stored. */
interface Drag {
  mode: 'create' | 'move' | 'resize';
  kind?: 'box' | 'arrow';
  target: number | 'region' | 'new';
  handle?: string;
  start: Point;
  orig?: Marker | Rect;
  moved: boolean;
}

/** What the right-click menu acts on. */
type MenuTarget = { kind: 'mark'; index: number } | { kind: 'region'; point: Point } | { kind: 'empty'; point: Point };

/**
 * Reads what a Konva shape name says it is: a marker part, a handle or the region.
 * @param name The shape name, such as mark:2:badge or handle:region:nw.
 */
function hitOf(name: string | undefined): Hit {
  const [kind, target, part] = (name ?? '').split(':');
  if (kind === 'mark') return { index: Number(target), region: false, part: part === 'badge' ? 'badge' : 'body', handle: null };
  if (kind === 'handle') return { index: target === 'region' ? null : Number(target), region: target === 'region', part: null, handle: part ?? null };
  if (kind === 'region') return { index: null, region: true, part: null, handle: null };
  return { index: null, region: false, part: null, handle: null };
}

/**
 * A rectangle drawn twice, a white halo under the marker colour, so it reads on any background.
 * @param props.rect The rectangle.
 * @param props.name The name hits are read from.
 * @param props.selected True to draw it thicker.
 * @param props.dashed True for the comment's region, which is dashed to set it apart from boxes and takes clicks on
 * its edge only, so a stray drag inside it never moves it.
 */
function HaloRect({ rect, name, selected, dashed }: { rect: Rect; name: string; selected?: boolean; dashed?: boolean }) {
  return (
    <>
      <KonvaRect {...rect} width={rect.w} height={rect.h} stroke={HALO} strokeWidth={dashed ? 3 : 5} strokeScaleEnabled={false} listening={false} />
      <KonvaRect
        {...rect}
        width={rect.w}
        height={rect.h}
        name={name}
        stroke={MARKER}
        strokeWidth={selected ? 3 : 2}
        strokeScaleEnabled={false}
        dash={dashed ? [8, 5] : undefined}
        fillEnabled={!dashed}
        hitStrokeWidth={14}
      />
    </>
  );
}

/**
 * One marker: a box or an arrow if it has one, and its numbered disc.
 * @param props.mark The marker.
 * @param props.index Its place, shown as its number.
 * @param props.zoom The zoom, which keeps the disc readable.
 * @param props.selected True when selected.
 */
function MarkShape({ mark, index, zoom, selected }: { mark: Marker; index: number; zoom: number; selected: boolean }) {
  const radius = discRadius(zoom);
  const name = `mark:${index}`;
  return (
    <Group>
      {mark.kind === 'box' && <HaloRect rect={{ x: mark.x, y: mark.y, w: mark.w ?? 0, h: mark.h ?? 0 }} name={`${name}:body`} selected={selected} />}
      {mark.kind === 'arrow' && (
        <>
          {[HALO, MARKER].map((colour) => (
            <Group key={colour} listening={colour === MARKER}>
              <Line
                points={[mark.x, mark.y, mark.x2 ?? mark.x, mark.y2 ?? mark.y]}
                name={`${name}:body`}
                stroke={colour}
                strokeWidth={colour === HALO ? 5 : selected ? 3 : 2}
                strokeScaleEnabled={false}
                hitStrokeWidth={14}
                lineCap="round"
              />
              <Line points={arrowHead(mark, radius)} name={`${name}:body`} stroke={colour} strokeWidth={colour === HALO ? 5 : selected ? 3 : 2} strokeScaleEnabled={false} lineCap="round" lineJoin="round" />
            </Group>
          ))}
        </>
      )}
      <Circle
        x={mark.x}
        y={mark.y}
        radius={radius + (selected ? 3 : 2) / zoom}
        fill={HALO}
        stroke={selected ? SELECTION : undefined}
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        name={`${name}:badge`}
      />
      <Circle x={mark.x} y={mark.y} radius={radius} fill={MARKER} name={`${name}:badge`} />
      <Text
        x={mark.x - radius}
        y={mark.y - radius}
        width={radius * 2}
        height={radius * 2}
        text={String(index + 1)}
        align="center"
        verticalAlign="middle"
        fontSize={radius * 1.15}
        fontStyle="800"
        fontFamily="Manrope, 'Segoe UI', sans-serif"
        fill="#ffffff"
        name={`${name}:badge`}
      />
    </Group>
  );
}

/**
 * The handles of the selected box, arrow end or region. A box has no top left handle, because its number sits there.
 * @param props.target What the handles resize.
 * @param props.shape Its shape.
 * @param props.zoom The zoom, which keeps the handles the same size on screen.
 */
function Handles({ target, shape, zoom }: { target: number | 'region'; shape: Marker | Rect; zoom: number }) {
  const size = handleSize(zoom);
  const square = (point: Point, handle: string) => (
    <KonvaRect
      key={handle}
      x={point.x - size / 2}
      y={point.y - size / 2}
      width={size}
      height={size}
      fill="#ffffff"
      stroke={SELECTION}
      strokeWidth={1.5}
      strokeScaleEnabled={false}
      name={`handle:${target}:${handle}`}
    />
  );
  if ('kind' in shape && shape.kind === 'arrow') return square({ x: shape.x2 ?? shape.x, y: shape.y2 ?? shape.y }, 'end');
  if ('kind' in shape && shape.kind !== 'box') return null;
  const rect = { x: shape.x, y: shape.y, w: shape.w ?? 0, h: shape.h ?? 0 };
  const points = handlePoints(rect);
  const shown = 'kind' in shape ? HANDLES.filter((handle) => handle !== 'nw') : HANDLES;
  return <>{shown.map((handle) => square(points[handle], handle))}</>;
}

/**
 * Turns a drag's movement into the shape it gives.
 * @param drag The drag.
 * @param point Where the pointer is now.
 */
function shapeOf(drag: Drag, point: Point): Draft['shape'] | null {
  const { width, height } = useEditor.getState();
  const bounds = { width, height };
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  if (drag.mode === 'create') {
    if (drag.kind === 'box') return { kind: 'box', note: '', ...resized({ ...drag.start, w: 0, h: 0 }, 'se', dx, dy, bounds) };
    return { kind: 'arrow', note: '', x: drag.start.x, y: drag.start.y, x2: point.x, y2: point.y };
  }
  if (!drag.orig) return null;
  if (drag.mode === 'move') return moved(drag.orig, dx, dy);
  if (drag.handle === 'end' && 'x2' in drag.orig) return { ...drag.orig, x2: (drag.orig.x2 ?? 0) + dx, y2: (drag.orig.y2 ?? 0) + dy };
  const next = resized({ x: drag.orig.x, y: drag.orig.y, w: drag.orig.w ?? 0, h: drag.orig.h ?? 0 }, drag.handle ?? 'se', dx, dy, bounds);
  return 'kind' in drag.orig ? { ...drag.orig, ...next } : next;
}

/**
 * The menu a right-click opens, for the marker, the region or the empty image under it.
 * @param props.target What was right-clicked.
 * @param props.onNote Focuses a marker's note.
 */
function CanvasMenu({ target, onNote }: { target: MenuTarget | null; onNote: (index: number) => void }) {
  const { width, height, marks, hasBox } = useEditor();
  const bounds = { width, height };
  if (!target) return null;
  if (target.kind === 'mark') {
    const { index } = target;
    const mark = marks[index];
    return (
      <>
        <ContextMenuGroup>
          <ContextMenuLabel>Mark {index + 1}</ContextMenuLabel>
          <ContextMenuItem onClick={() => onNote(index)}>
            <NotebookPen />
            Write a note
          </ContextMenuItem>
          <ContextMenuItem onClick={() => mark && addMark(moved(mark, 16, 16))}>
            <Copy />
            Duplicate
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuLabel>Order</ContextMenuLabel>
          <ContextMenuItem disabled={index === 0} onClick={() => renumber(index, -1)}>
            <ArrowUpToLine />
            Move up the list
          </ContextMenuItem>
          <ContextMenuItem disabled={index === marks.length - 1} onClick={() => renumber(index, 1)}>
            <ArrowDownToLine />
            Move down the list
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => removeMark(index)}>
          <Trash2 />
          Delete mark {index + 1}
        </ContextMenuItem>
      </>
    );
  }
  const { point } = target;
  return (
    <>
      <ContextMenuGroup>
        <ContextMenuLabel>Add here</ContextMenuLabel>
        <ContextMenuItem onClick={() => addMark({ kind: 'dot', x: point.x, y: point.y })}>
          <CircleDot />
          Numbered marker
        </ContextMenuItem>
        <ContextMenuItem onClick={() => addMark({ kind: 'box', ...boxAround(point, bounds) })}>
          <Square />
          Box
        </ContextMenuItem>
        <ContextMenuItem onClick={() => addMark({ kind: 'arrow', ...arrowTo(point, bounds) })}>
          <MoveUpRight />
          Arrow pointing here
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      {target.kind === 'region' ? (
        <ContextMenuGroup>
          <ContextMenuLabel>Region</ContextMenuLabel>
          <ContextMenuItem disabled={hasBox} onClick={resetRegion}>
            <RotateCcw />
            {hasBox ? 'Fixed on older captures' : 'Move it back'}
          </ContextMenuItem>
        </ContextMenuGroup>
      ) : (
        <ContextMenuGroup>
          <ContextMenuLabel>View</ContextMenuLabel>
          <ContextMenuItem onClick={() => setZoom('fit')}>
            <Maximize />
            Fit to window
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setZoom(1)}>
            <Scan />
            Actual size
          </ContextMenuItem>
        </ContextMenuGroup>
      )}
    </>
  );
}

/**
 * Takes Ctrl or Cmd with the wheel as zoom.
 * @param event The wheel event.
 */
function zoomOnWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  setZoom(event.deltaY < 0 ? 'in' : 'out');
}

/**
 * Watches the scroll area's size for Fit and its wheel for zoom, until it unmounts.
 * @param node The scroll area.
 */
function scrollArea(node: HTMLDivElement | null) {
  if (!node) return;
  const observer = new ResizeObserver(([entry]) => entry && setView({ width: entry.contentRect.width, height: entry.contentRect.height }));
  observer.observe(node);
  node.addEventListener('wheel', zoomOnWheel, { passive: false });
  return () => {
    observer.disconnect();
    node.removeEventListener('wheel', zoomOnWheel);
  };
}

/**
 * The screenshot with its region and markers. Click or drag with a tool to add, drag to move, use the handles to
 * resize, and right-click for actions.
 * @param props.onNote Focuses a marker's note in the side list.
 */
export function EditorCanvas({ onNote }: { onNote: (index: number) => void }) {
  const { image, width, height, zoom, marks, rect, selected, draft, tool, hasBox } = useEditor();
  const stage = useRef<Konva.Stage>(null);
  const drag = useRef<Drag | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  /**
   * The point under the pointer in page pixels, and what it landed on.
   * @param event The pointer event.
   */
  const locate = (event: React.MouseEvent) => {
    const current = stage.current;
    if (!current) return null;
    current.setPointersPositions(event.nativeEvent);
    const position = current.getPointerPosition() ?? { x: 0, y: 0 };
    const point = { x: clamp(position.x / zoom, 0, width), y: clamp(position.y / zoom, 0, height) };
    return { point, hit: hitOf(current.getIntersection(position)?.name()) };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const found = locate(event);
    if (!found) return;
    const { point, hit } = found;
    const drawing = tool !== 'select' && hit.part !== 'badge' && !hit.handle;
    if (drawing && tool === 'dot') {
      addMark({ kind: 'dot', ...point });
      setTool('select');
      return;
    }
    if (drawing) {
      drag.current = { mode: 'create', kind: tool === 'box' ? 'box' : 'arrow', target: 'new', start: point, moved: false };
    } else if (hit.handle) {
      const target = hit.region ? 'region' : (hit.index ?? 0);
      drag.current = { mode: 'resize', target, handle: hit.handle, start: point, orig: target === 'region' ? rect : marks[target], moved: false };
    } else if (hit.index !== null) {
      select(hit.index);
      drag.current = { mode: 'move', target: hit.index, start: point, orig: marks[hit.index], moved: false };
    } else if (hit.region) {
      select('region');
      if (hasBox) useEditor.setState({ status: 'This comment was captured before clean screenshots were kept, so its region is fixed.' });
      else drag.current = { mode: 'move', target: 'region', start: point, orig: rect, moved: false };
    } else {
      select(null);
    }
    if (drag.current) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const found = current && locate(event);
    if (!current || !found) return;
    const distance = Math.hypot(found.point.x - current.start.x, found.point.y - current.start.y) * zoom;
    if (!current.moved && distance < 3) return;
    current.moved = true;
    const shape = shapeOf(current, found.point);
    if (shape) useEditor.setState({ draft: { target: current.target, shape } });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    const found = locate(event);
    if (!current || !found) return;
    const shape = current.moved ? shapeOf(current, found.point) : null;
    useEditor.setState({ draft: null });
    if (current.mode === 'create') {
      const bounds = { width, height };
      if (current.kind === 'box') addMark(shape && 'kind' in shape ? shape : { kind: 'box', ...boxAround(current.start, bounds) });
      else addMark(shape && 'kind' in shape ? shape : { kind: 'arrow', ...arrowTo(current.start, bounds) });
      setTool('select');
      return;
    }
    if (!shape) return;
    if (current.target === 'region') useEditor.setState({ rect: { x: shape.x, y: shape.y, w: shape.w ?? 0, h: shape.h ?? 0 } });
    else if (typeof current.target === 'number' && 'kind' in shape) replaceMark(current.target, shape);
  };

  const onContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    const found = locate(event);
    if (!found) return;
    const { point, hit } = found;
    if (hit.index !== null) {
      select(hit.index);
      setMenu({ kind: 'mark', index: hit.index });
    } else if (hit.region) {
      select('region');
      setMenu({ kind: 'region', point });
    } else {
      select(null);
      setMenu({ kind: 'empty', point });
    }
  };

  const shown = marks.map((mark, index) => (draft?.target === index && 'kind' in draft.shape ? draft.shape : mark));
  const region = draft?.target === 'region' ? (draft.shape as Rect) : rect;
  const creating = draft?.target === 'new' && 'kind' in draft.shape ? draft.shape : null;
  const selectedShape = selected === 'region' ? region : typeof selected === 'number' ? shown[selected] : undefined;

  return (
    <div ref={scrollArea} className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl bg-muted">
      <ContextMenu>
        <ContextMenuTrigger
          className={cn('mx-auto my-4 w-fit touch-none select-none', tool === 'select' ? 'cursor-default' : 'cursor-crosshair')}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={onContextMenu}
          onDoubleClick={(event) => {
            const index = locate(event)?.hit.index;
            if (index !== null && index !== undefined) onNote(index);
          }}
        >
          <Stage ref={stage} width={width * zoom} height={height * zoom} scaleX={zoom} scaleY={zoom} aria-label="Screenshot being annotated">
            <Layer>
              {image && <KonvaImage image={image} width={width} height={height} listening={false} />}
              <HaloRect rect={region} name="region" selected={selected === 'region'} dashed />
              {shown.map((mark, index) => (
                <MarkShape key={index} mark={mark} index={index} zoom={zoom} selected={selected === index} />
              ))}
              {creating && <MarkShape mark={creating} index={marks.length} zoom={zoom} selected />}
              {selectedShape && !(selected === 'region' && hasBox) && <Handles target={selected === 'region' ? 'region' : Number(selected)} shape={selectedShape} zoom={zoom} />}
            </Layer>
          </Stage>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <CanvasMenu target={menu} onNote={onNote} />
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}
