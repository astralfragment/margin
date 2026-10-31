import type { Mark, Rect } from '../types';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const TOOL_KEYS: Record<string, Tool> = { v: 'select', m: 'dot', b: 'box', a: 'arrow' };

export type Tool = 'select' | 'dot' | 'box' | 'arrow';
export type Selection = number | 'region' | null;
export type MenuItem = { label: string; action: () => void; disabled?: boolean } | null;

/** What the toolbar and the side list show. */
export type EngineState = {
  marks: Mark[];
  sel: Selection;
  tool: Tool;
  zoom: number;
  fit: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

type Snapshot = { marks: Mark[]; rect: Rect };
type Drag = {
  mode: 'create' | 'move' | 'resize';
  i?: number;
  target?: number | 'region';
  handle?: string;
  start: { x: number; y: number };
  orig?: Mark | Rect;
  moved?: boolean;
};

type Callbacks = {
  onState: (state: EngineState) => void;
  /** Called after every change worth storing, so the caller can save a moment later. */
  onDirty: () => void;
  onNote: (text: string) => void;
  onMenu: (at: { x: number; y: number }, items: MenuItem[]) => void;
  onCloseMenu: () => void;
  focusNote: (i: number) => void;
  onEscape: () => void;
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function el(tag: string, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/**
 * The image editor's drawing surface: numbered markers, boxes and arrows over a screenshot, the marked region,
 * selection, handles, dragging, nudging, zoom and undo. It draws into an SVG it is given and reports its state,
 * so the dialog around it can be React.
 */
export class EditorEngine {
  marks: Mark[];
  rect: Rect;
  readonly startRect: Rect;
  private sel: Selection = null;
  private tool: Tool = 'select';
  private zoom = 1;
  private fit = true;
  private history: Snapshot[] = [];
  private future: Snapshot[] = [];
  private drag: Drag | null = null;
  private readonly vw: number;
  private readonly vh: number;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly els: { canvas: HTMLElement; stage: HTMLElement; img: HTMLImageElement; svg: SVGSVGElement },
    private readonly start: { marks: Mark[]; rect: Rect; viewportWidth: number; hasBox: boolean },
    private readonly cb: Callbacks,
  ) {
    this.marks = clone(start.marks);
    this.rect = clone(start.rect);
    this.startRect = clone(start.rect);
    this.vw = start.viewportWidth;
    this.vh = (this.vw * els.img.naturalHeight) / els.img.naturalWidth;
    this.listen();
    this.setZoom('fit');
    this.render();
  }

  get hasBox() {
    return this.start.hasBox;
  }

  /** True when the region has moved since the editor opened. */
  regionMoved() {
    return !this.hasBox && JSON.stringify(this.rect) !== JSON.stringify(this.startRect);
  }

  destroy() {
    this.cleanup.forEach((off) => off());
  }

  private emit() {
    this.cb.onState({
      marks: this.marks.map((m) => ({ ...m })),
      sel: this.sel,
      tool: this.tool,
      zoom: this.zoom,
      fit: this.fit,
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
    });
  }

  private listen() {
    const { svg, canvas, stage } = this.els;
    const on = <K extends keyof HTMLElementEventMap>(target: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(svg, 'pointerdown', (e: PointerEvent) => this.onPointerDown(e));
    on(svg, 'pointermove', (e: PointerEvent) => this.onPointerMove(e));
    on(svg, 'pointerup', () => this.onPointerUp());
    on(svg, 'pointercancel', () => this.onPointerUp());
    on(svg, 'contextmenu', (e: MouseEvent) => this.onContextMenu(e));
    on(svg, 'dblclick', (e: MouseEvent) => {
      const hit = this.hitOf(e);
      if (hit.i !== null) this.cb.focusNote(hit.i);
    });
    on(canvas, 'contextmenu', (e: MouseEvent) => {
      if (e.target === canvas || e.target === stage) this.onContextMenu(e);
    });
    on(
      canvas,
      'wheel',
      (e: WheelEvent) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        this.setZoom(e.deltaY < 0 ? 'in' : 'out');
      },
      { passive: false },
    );
    const observer = new ResizeObserver(() => {
      if (this.fit) this.setZoom('fit');
    });
    observer.observe(canvas);
    this.cleanup.push(() => observer.disconnect());
  }

  /** A pointer position in viewport CSS pixels of the captured page. */
  private toPage(e: MouseEvent) {
    const { svg } = this.els;
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const p = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: clamp(p.x, 0, this.vw), y: clamp(p.y, 0, this.vh) };
  }

  /** Radius of a numbered disc, in page pixels, never smaller than 10 screen pixels. */
  private discRadius() {
    return Math.max(13, 10 / this.zoom);
  }

  /** Side of a resize handle, in page pixels, a constant size on screen. */
  private handleSize() {
    return 9 / this.zoom;
  }

  /** Records the state before a change, so Undo can put it back. */
  private pushHistory() {
    this.history.push(clone({ marks: this.marks, rect: this.rect }));
    if (this.history.length > 100) this.history.shift();
    this.future = [];
    this.cb.onDirty();
    this.emit();
  }

  /** Steps back, or forward when redoing, through the edit history. */
  travel(forward: boolean) {
    const from = forward ? this.future : this.history;
    const to = forward ? this.history : this.future;
    if (!from.length) return;
    to.push(clone({ marks: this.marks, rect: this.rect }));
    ({ marks: this.marks, rect: this.rect } = from.pop()!);
    this.sel = null;
    this.cb.onDirty();
    this.render();
  }

  /** Draws a shape twice, a white halo under the marker colour, so it reads on any background. */
  private haloed(group: SVGElement, make: (cls: string) => SVGElement) {
    group.append(make('ed-halo'), make('ed-ink'));
  }

  private rectHandles(group: SVGElement, r: Rect) {
    const s = this.handleSize();
    const spots: Record<string, [number, number]> = {
      nw: [r.x, r.y],
      n: [r.x + r.w / 2, r.y],
      ne: [r.x + r.w, r.y],
      e: [r.x + r.w, r.y + r.h / 2],
      se: [r.x + r.w, r.y + r.h],
      s: [r.x + r.w / 2, r.y + r.h],
      sw: [r.x, r.y + r.h],
      w: [r.x, r.y + r.h / 2],
    };
    for (const handle of HANDLES) {
      const [x, y] = spots[handle]!;
      group.append(el('rect', { class: `ed-handle h-${handle}`, x: x - s / 2, y: y - s / 2, width: s, height: s, 'data-handle': handle }));
    }
  }

  /** The arrowhead points of an arrow, matching the exported drawing. */
  private arrowHead(m: Mark) {
    const angle = Math.atan2(m.y2! - m.y, m.x2! - m.x);
    const head = this.discRadius() * 1.2;
    const at = (a: number) => `${m.x2! - head * Math.cos(a)},${m.y2! - head * Math.sin(a)}`;
    return `${at(angle - 0.45)} ${m.x2},${m.y2} ${at(angle + 0.45)}`;
  }

  render() {
    const { svg } = this.els;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${this.vw} ${this.vh}`);

    const region = el('g', { 'data-region': '' });
    this.haloed(region, (cls) => el('rect', { class: `${cls} ed-hit`, x: this.rect.x, y: this.rect.y, width: this.rect.w, height: this.rect.h }));
    svg.append(region);
    const top = el('g', this.sel === 'region' ? { 'data-region': '' } : typeof this.sel === 'number' ? { 'data-i': this.sel } : {});
    if (this.sel === 'region' && !this.hasBox) this.rectHandles(top, this.rect);

    this.marks.forEach((m, i) => {
      const group = el('g', { 'data-i': i, class: this.sel === i ? 'ed-selected' : '' });
      if (m.kind === 'box') {
        this.haloed(group, (cls) => el('rect', { class: `${cls} ed-hit`, x: m.x, y: m.y, width: m.w!, height: m.h!, 'data-part': 'body' }));
        if (this.sel === i) this.rectHandles(top, m as Rect);
      } else if (m.kind === 'arrow') {
        group.append(el('line', { class: 'ed-grab', x1: m.x, y1: m.y, x2: m.x2!, y2: m.y2!, 'data-part': 'body' }));
        this.haloed(group, (cls) => el('line', { class: cls, x1: m.x, y1: m.y, x2: m.x2!, y2: m.y2! }));
        this.haloed(group, (cls) => el('polyline', { class: cls, points: this.arrowHead(m) }));
        if (this.sel === i) {
          const s = this.handleSize();
          top.append(el('rect', { class: 'ed-handle h-move', x: m.x2! - s / 2, y: m.y2! - s / 2, width: s, height: s, 'data-handle': 'end' }));
        }
      }
      const r = this.discRadius();
      if (this.sel === i) group.append(el('circle', { class: 'ed-ring', cx: m.x, cy: m.y, r: r + 4 / this.zoom }));
      const disc = el('g', { class: 'ed-disc', 'data-part': 'badge' });
      disc.append(
        el('circle', { class: 'ed-disc-halo', cx: m.x, cy: m.y, r: r + 2 / this.zoom, 'data-part': 'badge' }),
        el('circle', { class: 'ed-disc-fill', cx: m.x, cy: m.y, r, 'data-part': 'badge' }),
      );
      const label = el('text', { class: 'ed-disc-text', x: m.x, y: m.y, 'font-size': r * 1.15, 'data-part': 'badge' });
      label.textContent = String(i + 1);
      disc.append(label);
      group.append(disc);
      svg.append(group);
    });
    svg.append(top);
    this.emit();
  }

  /** Selects an annotation or the region, or clears the selection. */
  select(target: Selection) {
    if (this.sel === target) return;
    this.sel = target;
    this.render();
  }

  /** Removes one annotation, renumbering the rest. */
  removeMark(i: number) {
    this.pushHistory();
    this.marks.splice(i, 1);
    this.sel = null;
    this.render();
  }

  private addMark(mark: Mark) {
    this.pushHistory();
    this.marks.push({ note: '', ...mark });
    this.sel = this.marks.length - 1;
    this.render();
  }

  /** Changes an annotation's note as it is typed. Notes are not part of the undo history. */
  setNote(i: number, note: string) {
    if (!this.marks[i]) return;
    this.marks[i].note = note;
    this.cb.onDirty();
    this.emit();
  }

  /** Moves an annotation one place earlier or later in the numbering. */
  private renumber(i: number, step: number) {
    const j = i + step;
    if (j < 0 || j >= this.marks.length) return;
    this.pushHistory();
    [this.marks[i], this.marks[j]] = [this.marks[j]!, this.marks[i]!];
    this.sel = j;
    this.render();
  }

  /** A rectangle resized by dragging one handle, kept the right way round and inside the page. */
  private resized(orig: Rect, handle: string, dx: number, dy: number): Rect {
    let x1 = orig.x;
    let y1 = orig.y;
    let x2 = orig.x + orig.w;
    let y2 = orig.y + orig.h;
    if (handle.includes('w')) x1 += dx;
    if (handle.includes('e')) x2 += dx;
    if (handle.includes('n')) y1 += dy;
    if (handle.includes('s')) y2 += dy;
    const x = clamp(Math.min(x1, x2), 0, this.vw);
    const y = clamp(Math.min(y1, y2), 0, this.vh);
    return { x, y, w: Math.max(4, Math.min(Math.abs(x2 - x1), this.vw - x)), h: Math.max(4, Math.min(Math.abs(y2 - y1), this.vh - y)) };
  }

  private moved<T extends Mark | Rect>(orig: T, dx: number, dy: number): T {
    const next = { ...orig, x: orig.x + dx, y: orig.y + dy };
    if ('x2' in orig && orig.x2 !== undefined) Object.assign(next, { x2: orig.x2 + dx, y2: orig.y2! + dy });
    return next;
  }

  /** What a pointer event landed on: an annotation part, a handle, the region, or nothing. */
  private hitOf(e: Event) {
    const target = e.target as Element;
    const group = target.closest?.('[data-i], [data-region]') as SVGElement | null;
    return {
      i: group?.dataset.i !== undefined ? Number(group.dataset.i) : null,
      region: Boolean(group && 'region' in group.dataset),
      part: (target.closest?.('[data-part]') as SVGElement | null)?.dataset.part ?? null,
      handle: (target as SVGElement).dataset?.handle ?? null,
    };
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.cb.onCloseMenu();
    const p = this.toPage(e);
    const hit = this.hitOf(e);
    const drawing = this.tool !== 'select' && hit.part !== 'badge' && !hit.handle;
    if (drawing && this.tool === 'dot') {
      this.addMark({ kind: 'dot', x: p.x, y: p.y });
      this.setTool('select');
      return;
    }
    if (drawing) {
      this.addMark(this.tool === 'box' ? { kind: 'box', x: p.x, y: p.y, w: 0, h: 0 } : { kind: 'arrow', x: p.x, y: p.y, x2: p.x, y2: p.y });
      this.drag = { mode: 'create', i: this.marks.length - 1, start: p };
    } else if (hit.handle) {
      const target = hit.region ? 'region' : hit.i!;
      this.drag = { mode: 'resize', target, handle: hit.handle, start: p, orig: clone(target === 'region' ? this.rect : this.marks[target]!) };
    } else if (hit.i !== null) {
      this.select(hit.i);
      this.drag = { mode: 'move', target: hit.i, start: p, orig: clone(this.marks[hit.i]!) };
    } else if (hit.region) {
      this.select('region');
      if (this.hasBox) this.cb.onNote('This comment was captured before clean screenshots were kept, so its region is fixed.');
      else this.drag = { mode: 'move', target: 'region', start: p, orig: clone(this.rect) };
    } else {
      this.select(null);
    }
    if (this.drag) {
      try {
        this.els.svg.setPointerCapture(e.pointerId);
      } catch {
        // A pointer that already ended cannot be captured, and the drag still works without it.
      }
    }
  }

  private onPointerMove(e: PointerEvent) {
    const drag = this.drag;
    if (!drag) return;
    const p = this.toPage(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) * this.zoom < 3) return;
    if (!drag.moved && drag.mode !== 'create') this.pushHistory();
    drag.moved = true;
    if (drag.mode === 'create') {
      const m = this.marks[drag.i!]!;
      if (m.kind === 'box') Object.assign(m, this.resized({ x: drag.start.x, y: drag.start.y, w: 0, h: 0 }, 'se', dx, dy));
      else Object.assign(m, { x2: p.x, y2: p.y });
    } else if (drag.mode === 'move') {
      if (drag.target === 'region') this.rect = this.moved(drag.orig as Rect, dx, dy);
      else this.marks[drag.target!] = this.moved(drag.orig as Mark, dx, dy);
    } else if (drag.target === 'region') {
      this.rect = this.resized(drag.orig as Rect, drag.handle!, dx, dy);
    } else if (drag.handle === 'end') {
      const orig = drag.orig as Mark;
      Object.assign(this.marks[drag.target!]!, { x2: orig.x2! + dx, y2: orig.y2! + dy });
    } else {
      Object.assign(this.marks[drag.target!]!, this.resized(drag.orig as Rect, drag.handle!, dx, dy));
    }
    this.render();
  }

  private onPointerUp() {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (drag.mode === 'create') {
      const m = this.marks[drag.i!]!;
      if (!drag.moved && m.kind === 'box') Object.assign(m, this.resized({ x: m.x - 80, y: m.y - 50, w: 160, h: 100 }, 'se', 0, 0));
      if (!drag.moved && m.kind === 'arrow') Object.assign(m, { x: clamp(m.x - 90, 0, this.vw), y: clamp(m.y - 70, 0, this.vh) });
      this.setTool('select');
    }
    if (drag.moved || drag.mode === 'create') this.cb.onDirty();
    this.render();
  }

  private onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const hit = this.hitOf(e);
    const p = this.toPage(e);
    const at = { x: e.clientX, y: e.clientY };
    const addHere: MenuItem[] = [
      { label: 'Add a marker here', action: () => this.addMark({ kind: 'dot', x: p.x, y: p.y }) },
      { label: 'Add a box here', action: () => this.addMark({ kind: 'box', ...this.resized({ x: p.x - 80, y: p.y - 50, w: 160, h: 100 }, 'se', 0, 0) }) },
      {
        label: 'Add an arrow pointing here',
        action: () => this.addMark({ kind: 'arrow', x: clamp(p.x - 90, 0, this.vw), y: clamp(p.y - 70, 0, this.vh), x2: p.x, y2: p.y }),
      },
    ];
    if (hit.i !== null) {
      const i = hit.i;
      this.select(i);
      this.cb.onMenu(at, [
        {
          label: `Remove ${i + 1}`,
          action: () => {
            this.removeMark(i);
            this.cb.onNote(`Removed ${i + 1}. Undo brings it back.`);
          },
        },
        null,
        { label: 'Write a note', action: () => this.cb.focusNote(i) },
        { label: 'Duplicate', action: () => this.addMark(this.moved(clone(this.marks[i]!), 16, 16)) },
        { label: 'Move earlier in the list', action: () => this.renumber(i, -1), disabled: i === 0 },
        { label: 'Move later in the list', action: () => this.renumber(i, 1), disabled: i === this.marks.length - 1 },
      ]);
    } else if (hit.region) {
      this.select('region');
      this.cb.onMenu(at, [
        ...addHere,
        null,
        this.hasBox
          ? { label: 'Region is fixed on older captures', action: () => {}, disabled: true }
          : {
              label: 'Reset the region',
              action: () => {
                this.pushHistory();
                this.rect = clone(this.start.rect);
                this.render();
              },
            },
      ]);
    } else {
      this.select(null);
      this.cb.onMenu(at, [...addHere, null, { label: 'Fit to window', action: () => this.setZoom('fit') }, { label: 'Actual size', action: () => this.setZoom(1) }]);
    }
  }

  /** Changes the zoom to a factor, a step in or out, or the size that fits the window. */
  setZoom(next: number | 'fit' | 'in' | 'out') {
    const { canvas, stage } = this.els;
    let zoom: number;
    if (next === 'fit') {
      this.fit = true;
      zoom = Math.min((canvas.clientWidth - 32) / this.vw, (canvas.clientHeight - 32) / this.vh);
    } else {
      this.fit = false;
      zoom = next === 'in' ? this.zoom * 1.25 : next === 'out' ? this.zoom / 1.25 : next;
    }
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    stage.style.width = `${this.vw * this.zoom}px`;
    this.render();
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.els.canvas.dataset.tool = tool;
    this.emit();
  }

  /** Keyboard control while the editor has focus. Returns nothing; handled keys are prevented. */
  onKey(e: KeyboardEvent) {
    const typing = (e.target as Element).closest?.('textarea, input');
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing) this.els.canvas.focus({ preventScroll: true });
      else if (this.sel !== null) this.select(null);
      else this.cb.onEscape();
      return;
    }
    if (typing) return;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') {
      e.preventDefault();
      this.travel(e.shiftKey);
    } else if (mod && key === 'y') {
      e.preventDefault();
      this.travel(true);
    } else if (mod || e.altKey) {
      return;
    } else if (TOOL_KEYS[key]) {
      this.setTool(TOOL_KEYS[key]);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && typeof this.sel === 'number') {
      e.preventDefault();
      this.removeMark(this.sel);
    } else if (e.key === '+' || e.key === '=') {
      this.setZoom('in');
    } else if (e.key === '-') {
      this.setZoom('out');
    } else if (e.key === '0') {
      this.setZoom('fit');
    } else if (e.key === '1') {
      this.setZoom(1);
    } else if (e.key.startsWith('Arrow') && this.sel !== null && !(this.sel === 'region' && this.hasBox)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.pushHistory();
      if (this.sel === 'region') this.rect = this.moved(this.rect, dx, dy);
      else this.marks[this.sel] = this.moved(this.marks[this.sel]!, dx, dy);
      this.render();
    }
  }
}
