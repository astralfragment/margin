import { MARK_LABELS } from './lib/marks.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const TOOL_KEYS = { v: 'select', m: 'dot', b: 'box', a: 'arrow' };

const dialog = document.querySelector('[data-editor]');
const canvas = dialog.querySelector('[data-editor-canvas]');
const stage = dialog.querySelector('[data-editor-stage]');
const img = dialog.querySelector('[data-editor-img]');
const svg = dialog.querySelector('[data-editor-svg]');
const list = dialog.querySelector('[data-editor-list]');
const empty = dialog.querySelector('[data-editor-empty]');
const menu = dialog.querySelector('[data-editor-menu]');
const zoomEl = dialog.querySelector('[data-editor-zoom]');
const stateEl = dialog.querySelector('[data-editor-state]');
const saveBtn = dialog.querySelector('[data-editor-save]');
const titleEl = dialog.querySelector('[data-editor-title]');

let ed = null;

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Creates an SVG element with attributes.
 * @param {string} tag The SVG tag name.
 * @param {Record<string, string | number>} attrs Attributes to set.
 */
function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/**
 * Converts a pointer position to viewport CSS pixels of the captured page.
 * @param {MouseEvent} e The pointer event.
 */
function toPage(e) {
  const point = svg.createSVGPoint();
  point.x = e.clientX;
  point.y = e.clientY;
  const p = point.matrixTransform(svg.getScreenCTM().inverse());
  return { x: clamp(p.x, 0, ed.vw), y: clamp(p.y, 0, ed.vh) };
}

/** Radius of a numbered disc, in page pixels, never smaller than 10 screen pixels. */
const discRadius = () => Math.max(13, 10 / ed.zoom);

/** Side of a resize handle, in page pixels, a constant size on screen. */
const handleSize = () => 9 / ed.zoom;

function pushHistory() {
  ed.history.push(clone({ marks: ed.marks, rect: ed.rect }));
  if (ed.history.length > 100) ed.history.shift();
  ed.future = [];
  ed.dirty = true;
}

/**
 * Steps back or forward through the edit history.
 * @param {boolean} forward True to redo, false to undo.
 */
function travel(forward) {
  const from = forward ? ed.future : ed.history;
  const to = forward ? ed.history : ed.future;
  if (!from.length) return;
  to.push(clone({ marks: ed.marks, rect: ed.rect }));
  ({ marks: ed.marks, rect: ed.rect } = from.pop());
  ed.sel = null;
  ed.dirty = true;
  render();
  renderList();
}

/**
 * Draws a shape twice, a white halo under the marker colour, so it reads on any background.
 * @param {SVGElement} group The group to draw into.
 * @param {(cls: string) => SVGElement} make Builds the shape with the given class.
 */
function haloed(group, make) {
  group.append(make('ed-halo'), make('ed-ink'));
}

/**
 * Adds the eight resize handles of a rectangle.
 * @param {SVGElement} group The group to draw into.
 * @param {{x:number,y:number,w:number,h:number}} r The rectangle in page pixels.
 */
function rectHandles(group, r) {
  const s = handleSize();
  const spots = {
    nw: [r.x, r.y], n: [r.x + r.w / 2, r.y], ne: [r.x + r.w, r.y], e: [r.x + r.w, r.y + r.h / 2],
    se: [r.x + r.w, r.y + r.h], s: [r.x + r.w / 2, r.y + r.h], sw: [r.x, r.y + r.h], w: [r.x, r.y + r.h / 2],
  };
  for (const handle of HANDLES) {
    const [x, y] = spots[handle];
    group.append(el('rect', { class: `ed-handle h-${handle}`, x: x - s / 2, y: y - s / 2, width: s, height: s, 'data-handle': handle }));
  }
}

/**
 * Builds the arrowhead points for an arrow, matching the exported drawing.
 * @param {{x:number,y:number,x2:number,y2:number}} m The arrow in page pixels.
 */
function arrowHead(m) {
  const angle = Math.atan2(m.y2 - m.y, m.x2 - m.x);
  const head = discRadius() * 1.2;
  const at = (a) => `${m.x2 - head * Math.cos(a)},${m.y2 - head * Math.sin(a)}`;
  return `${at(angle - 0.45)} ${m.x2},${m.y2} ${at(angle + 0.45)}`;
}

function render() {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${ed.vw} ${ed.vh}`);

  const region = el('g', { 'data-region': '' });
  haloed(region, (cls) => el('rect', { class: `${cls} ed-hit`, x: ed.rect.x, y: ed.rect.y, width: ed.rect.w, height: ed.rect.h }));
  svg.append(region);
  const top = el('g', ed.sel === 'region' ? { 'data-region': '' } : typeof ed.sel === 'number' ? { 'data-i': ed.sel } : {});
  if (ed.sel === 'region' && !ed.base.hasBox) rectHandles(top, ed.rect);

  ed.marks.forEach((m, i) => {
    const group = el('g', { 'data-i': i, class: ed.sel === i ? 'ed-selected' : '' });
    if (m.kind === 'box') {
      haloed(group, (cls) => el('rect', { class: `${cls} ed-hit`, x: m.x, y: m.y, width: m.w, height: m.h, 'data-part': 'body' }));
      if (ed.sel === i) rectHandles(top, m);
    } else if (m.kind === 'arrow') {
      group.append(el('line', { class: 'ed-grab', x1: m.x, y1: m.y, x2: m.x2, y2: m.y2, 'data-part': 'body' }));
      haloed(group, (cls) => el('line', { class: cls, x1: m.x, y1: m.y, x2: m.x2, y2: m.y2 }));
      haloed(group, (cls) => el('polyline', { class: cls, points: arrowHead(m) }));
      if (ed.sel === i) {
        const s = handleSize();
        top.append(el('rect', { class: 'ed-handle h-move', x: m.x2 - s / 2, y: m.y2 - s / 2, width: s, height: s, 'data-handle': 'end' }));
      }
    }
    const r = discRadius();
    if (ed.sel === i) group.append(el('circle', { class: 'ed-ring', cx: m.x, cy: m.y, r: r + 4 / ed.zoom }));
    const disc = el('g', { class: 'ed-disc', 'data-part': 'badge' });
    disc.append(
      el('circle', { class: 'ed-disc-halo', cx: m.x, cy: m.y, r: r + 2 / ed.zoom, 'data-part': 'badge' }),
      el('circle', { class: 'ed-disc-fill', cx: m.x, cy: m.y, r, 'data-part': 'badge' }),
    );
    const label = el('text', { class: 'ed-disc-text', x: m.x, y: m.y, 'font-size': r * 1.15, 'data-part': 'badge' });
    label.textContent = String(i + 1);
    disc.append(label);
    group.append(disc);
    svg.append(group);
  });
  svg.append(top);

  list.querySelectorAll('[data-i]').forEach((row) => row.setAttribute('aria-current', String(Number(row.dataset.i) === ed.sel)));
}

function renderList() {
  list.replaceChildren();
  empty.hidden = ed.marks.length > 0;
  ed.marks.forEach((m, i) => {
    const row = document.createElement('li');
    row.className = 'editor-item';
    row.dataset.i = String(i);
    row.innerHTML = `
      <span class="num">${i + 1}</span>
      <span class="stack">
        <b class="kind">${MARK_LABELS[m.kind] ?? 'Marker'}</b>
        <textarea rows="2" placeholder="What this number points out"></textarea>
      </span>
      <button class="icon-btn danger" type="button" title="Remove ${i + 1}" aria-label="Remove ${i + 1}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" /></svg>
      </button>`;
    const note = row.querySelector('textarea');
    note.value = m.note ?? '';
    note.addEventListener('focus', () => select(i));
    note.addEventListener('input', () => {
      ed.marks[i].note = note.value;
      ed.dirty = true;
    });
    row.querySelector('button').addEventListener('click', () => removeMark(i));
    row.addEventListener('click', (e) => {
      if (e.target === row || e.target.classList.contains('num') || e.target.classList.contains('kind')) select(i);
    });
    list.append(row);
  });
  render();
}

/**
 * Selects an annotation or the region, or clears the selection.
 * @param {number | 'region' | null} target What to select.
 */
function select(target) {
  if (ed.sel === target) return;
  ed.sel = target;
  render();
}

/**
 * Removes one annotation, renumbering the rest.
 * @param {number} i Its index.
 */
function removeMark(i) {
  pushHistory();
  ed.marks.splice(i, 1);
  ed.sel = null;
  renderList();
}

/**
 * Adds an annotation and selects it.
 * @param {object} mark The new annotation in page pixels.
 */
function addMark(mark) {
  pushHistory();
  ed.marks.push({ note: '', ...mark });
  ed.sel = ed.marks.length - 1;
  renderList();
}

/**
 * Moves an annotation one place earlier or later in the numbering.
 * @param {number} i Its index.
 * @param {number} step -1 for earlier, 1 for later.
 */
function renumber(i, step) {
  const j = i + step;
  if (j < 0 || j >= ed.marks.length) return;
  pushHistory();
  [ed.marks[i], ed.marks[j]] = [ed.marks[j], ed.marks[i]];
  ed.sel = j;
  renderList();
}

/**
 * Focuses the note field of an annotation in the side list.
 * @param {number} i Its index.
 */
function focusNote(i) {
  const note = list.querySelector(`[data-i="${i}"] textarea`);
  note?.scrollIntoView({ block: 'nearest' });
  note?.focus();
}

/**
 * Resizes a rectangle by dragging one of its handles, keeping it the right way round.
 * @param {{x:number,y:number,w:number,h:number}} orig The rectangle when the drag started.
 * @param {string} handle Which handle is dragged.
 * @param {number} dx Horizontal drag distance in page pixels.
 * @param {number} dy Vertical drag distance in page pixels.
 */
function resized(orig, handle, dx, dy) {
  let x1 = orig.x;
  let y1 = orig.y;
  let x2 = orig.x + orig.w;
  let y2 = orig.y + orig.h;
  if (handle.includes('w')) x1 += dx;
  if (handle.includes('e')) x2 += dx;
  if (handle.includes('n')) y1 += dy;
  if (handle.includes('s')) y2 += dy;
  const x = clamp(Math.min(x1, x2), 0, ed.vw);
  const y = clamp(Math.min(y1, y2), 0, ed.vh);
  return {
    x,
    y,
    w: Math.max(4, Math.min(Math.abs(x2 - x1), ed.vw - x)),
    h: Math.max(4, Math.min(Math.abs(y2 - y1), ed.vh - y)),
  };
}

/**
 * Moves an annotation or the region by a distance from where the drag started.
 * @param {object} orig The item when the drag started.
 * @param {number} dx Horizontal distance in page pixels.
 * @param {number} dy Vertical distance in page pixels.
 */
function moved(orig, dx, dy) {
  const next = { ...orig, x: orig.x + dx, y: orig.y + dy };
  if ('x2' in orig) Object.assign(next, { x2: orig.x2 + dx, y2: orig.y2 + dy });
  return next;
}

/** What a pointer event landed on: an annotation part, a handle, the region, or nothing. */
function hitOf(e) {
  const group = e.target.closest?.('[data-i], [data-region]');
  return {
    i: group?.dataset.i !== undefined ? Number(group.dataset.i) : null,
    region: Boolean(group && 'region' in group.dataset),
    part: e.target.closest?.('[data-part]')?.dataset.part ?? null,
    handle: e.target.dataset?.handle ?? null,
  };
}

function onPointerDown(e) {
  if (e.button !== 0 || !ed) return;
  closeMenu();
  const p = toPage(e);
  const hit = hitOf(e);

  const drawing = ed.tool !== 'select' && hit.part !== 'badge' && !hit.handle;
  if (drawing && ed.tool === 'dot') {
    addMark({ kind: 'dot', x: p.x, y: p.y });
    return;
  }
  if (drawing) {
    const mark = ed.tool === 'box' ? { kind: 'box', x: p.x, y: p.y, w: 0, h: 0 } : { kind: 'arrow', x: p.x, y: p.y, x2: p.x, y2: p.y };
    addMark(mark);
    ed.drag = { mode: 'create', i: ed.marks.length - 1, start: p };
  } else if (hit.handle) {
    const target = hit.region ? 'region' : hit.i;
    ed.drag = { mode: 'resize', target, handle: hit.handle, start: p, orig: clone(target === 'region' ? ed.rect : ed.marks[target]) };
  } else if (hit.i !== null) {
    select(hit.i);
    ed.drag = { mode: 'move', target: hit.i, start: p, orig: clone(ed.marks[hit.i]) };
  } else if (hit.region) {
    select('region');
    if (ed.base.hasBox) note('This comment was captured before clean screenshots were kept, so its region is fixed.');
    else ed.drag = { mode: 'move', target: 'region', start: p, orig: clone(ed.rect) };
  } else {
    select(null);
  }
  if (ed.drag) {
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {}
  }
}

function onPointerMove(e) {
  const drag = ed?.drag;
  if (!drag) return;
  const p = toPage(e);
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  if (!drag.moved && Math.hypot(dx, dy) * ed.zoom < 3) return;
  if (!drag.moved && drag.mode !== 'create') pushHistory();
  drag.moved = true;

  if (drag.mode === 'create') {
    const m = ed.marks[drag.i];
    if (m.kind === 'box') Object.assign(m, resized({ x: drag.start.x, y: drag.start.y, w: 0, h: 0 }, 'se', dx, dy));
    else Object.assign(m, { x2: p.x, y2: p.y });
  } else if (drag.mode === 'move') {
    if (drag.target === 'region') ed.rect = moved(drag.orig, dx, dy);
    else ed.marks[drag.target] = moved(drag.orig, dx, dy);
  } else if (drag.target === 'region') {
    ed.rect = resized(drag.orig, drag.handle, dx, dy);
  } else if (drag.handle === 'end') {
    Object.assign(ed.marks[drag.target], { x2: drag.orig.x2 + dx, y2: drag.orig.y2 + dy });
  } else {
    Object.assign(ed.marks[drag.target], resized(drag.orig, drag.handle, dx, dy));
  }
  render();
}

function onPointerUp() {
  const drag = ed?.drag;
  if (!drag) return;
  ed.drag = null;
  if (drag.mode === 'create') {
    const m = ed.marks[drag.i];
    if (!drag.moved && m.kind === 'box') Object.assign(m, resized({ x: m.x - 80, y: m.y - 50, w: 160, h: 100 }, 'se', 0, 0));
    if (!drag.moved && m.kind === 'arrow') Object.assign(m, { x: clamp(m.x - 90, 0, ed.vw), y: clamp(m.y - 70, 0, ed.vh) });
    setTool('select');
  }
  render();
}

/**
 * Shows a short message in the editor footer.
 * @param {string} text The message.
 */
function note(text) {
  stateEl.textContent = text;
}

function closeMenu() {
  menu.hidden = true;
  menu.replaceChildren();
}

/**
 * Opens the right-click menu with a set of actions at the pointer.
 * @param {MouseEvent} e The contextmenu event.
 * @param {(Array<[string, () => void, boolean?]> | null)[]} items Label, action and whether it is disabled; null draws a separator.
 */
function openMenu(e, items) {
  menu.replaceChildren();
  for (const item of items) {
    if (!item) {
      menu.append(Object.assign(document.createElement('div'), { className: 'menu-sep' }));
      continue;
    }
    const [label, action, disabled] = item;
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'menu-item', textContent: label, disabled: Boolean(disabled) });
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', () => {
      closeMenu();
      action();
    });
    menu.append(button);
  }
  menu.hidden = false;
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}

function onContextMenu(e) {
  e.preventDefault();
  if (!ed) return;
  const hit = hitOf(e);
  const p = toPage(e);

  if (hit.i !== null && hit.part === 'badge') {
    removeMark(hit.i);
    note(`Removed ${hit.i + 1}. Undo with Ctrl+Z.`);
    closeMenu();
    return;
  }
  const addHere = [
    ['Add a marker here', () => addMark({ kind: 'dot', x: p.x, y: p.y })],
    ['Add a box here', () => addMark({ kind: 'box', ...resized({ x: p.x - 80, y: p.y - 50, w: 160, h: 100 }, 'se', 0, 0) })],
    ['Add an arrow pointing here', () => addMark({ kind: 'arrow', x: clamp(p.x - 90, 0, ed.vw), y: clamp(p.y - 70, 0, ed.vh), x2: p.x, y2: p.y })],
  ];

  if (hit.i !== null) {
    const i = hit.i;
    select(i);
    openMenu(e, [
      ['Write a note', () => focusNote(i)],
      ['Duplicate', () => addMark(moved(clone(ed.marks[i]), 16, 16))],
      ['Move earlier in the list', () => renumber(i, -1), i === 0],
      ['Move later in the list', () => renumber(i, 1), i === ed.marks.length - 1],
      null,
      [`Remove ${i + 1}`, () => removeMark(i)],
    ]);
  } else if (hit.region) {
    select('region');
    openMenu(e, [
      ...addHere,
      null,
      ed.base.hasBox
        ? ['Region is fixed on older captures', () => {}, true]
        : ['Reset the region', () => {
            pushHistory();
            ed.rect = clone(ed.issue.rect);
            render();
          }],
    ]);
  } else {
    select(null);
    openMenu(e, [...addHere, null, ['Fit to window', () => setZoom('fit')], ['Actual size', () => setZoom(1)]]);
  }
}

/**
 * Changes the zoom, either to a factor or to fit the window.
 * @param {number | 'fit' | 'in' | 'out'} next The zoom factor or a step.
 */
function setZoom(next) {
  if (next === 'fit') {
    ed.fit = true;
    next = Math.min((canvas.clientWidth - 32) / ed.vw, (canvas.clientHeight - 32) / ed.vh);
  } else {
    ed.fit = false;
    if (next === 'in') next = ed.zoom * 1.25;
    if (next === 'out') next = ed.zoom / 1.25;
  }
  ed.zoom = clamp(next, MIN_ZOOM, MAX_ZOOM);
  stage.style.width = `${ed.vw * ed.zoom}px`;
  zoomEl.textContent = `${Math.round(ed.zoom * 100)}%`;
  render();
}

/**
 * Picks the drawing tool.
 * @param {'select' | 'dot' | 'box' | 'arrow'} tool The tool.
 */
function setTool(tool) {
  ed.tool = tool;
  canvas.dataset.tool = tool;
  dialog.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
}

function onKey(e) {
  if (!ed) return;
  const typing = e.target.closest?.('textarea, input');
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (!menu.hidden) closeMenu();
    else if (ed.sel !== null && !typing) select(null);
    else requestClose();
    return;
  }
  if (typing) return;
  const key = e.key.toLowerCase();
  if (mod && key === 'z') {
    e.preventDefault();
    travel(e.shiftKey);
  } else if (mod && key === 'y') {
    e.preventDefault();
    travel(true);
  } else if (mod) {
    return;
  } else if (TOOL_KEYS[key]) {
    setTool(TOOL_KEYS[key]);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && typeof ed.sel === 'number') {
    e.preventDefault();
    removeMark(ed.sel);
  } else if (e.key === '+' || e.key === '=') {
    setZoom('in');
  } else if (e.key === '-') {
    setZoom('out');
  } else if (e.key === '0') {
    setZoom('fit');
  } else if (e.key === '1') {
    setZoom(1);
  } else if (e.key.startsWith('Arrow') && ed.sel !== null && !(ed.sel === 'region' && ed.base.hasBox)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    pushHistory();
    if (ed.sel === 'region') ed.rect = moved(ed.rect, dx, dy);
    else ed.marks[ed.sel] = moved(ed.marks[ed.sel], dx, dy);
    render();
  }
}

function requestClose() {
  if (ed?.dirty && !confirm('Discard your changes to this image?')) return;
  ed = null;
  closeMenu();
  dialog.close();
}

async function save() {
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving';
  const res = await ed.send('annotate', { id: ed.issue.id, marks: ed.marks, rect: ed.rect });
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save image';
  if (res?.error) {
    note(res.error);
    return;
  }
  const { onSaved, issue, marks, rect } = ed;
  Object.assign(issue, { marks: clone(marks), shot: res.shot, detail: res.detail });
  if (!ed.base.hasBox) issue.rect = clone(rect);
  ed = null;
  dialog.close();
  onSaved(issue);
}

svg.addEventListener('pointerdown', onPointerDown);
svg.addEventListener('pointermove', onPointerMove);
svg.addEventListener('pointerup', onPointerUp);
svg.addEventListener('pointercancel', onPointerUp);
svg.addEventListener('contextmenu', onContextMenu);
svg.addEventListener('dblclick', (e) => {
  const hit = hitOf(e);
  if (hit.i !== null) focusNote(hit.i);
});
canvas.addEventListener('contextmenu', (e) => {
  if (e.target === canvas || e.target === stage) onContextMenu(e);
});
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!ed || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(e.deltaY < 0 ? 'in' : 'out');
  },
  { passive: false },
);
dialog.addEventListener('keydown', onKey);
dialog.addEventListener('cancel', (e) => e.preventDefault());
dialog.addEventListener('pointerdown', (e) => {
  if (!menu.contains(e.target)) closeMenu();
});
dialog.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
dialog.querySelectorAll('[data-zoom]').forEach((b) =>
  b.addEventListener('click', () => {
    const step = b.dataset.zoom;
    setZoom(step === 'actual' ? 1 : step);
  }),
);
dialog.querySelector('[data-editor-cancel]').addEventListener('click', requestClose);
saveBtn.addEventListener('click', save);
new ResizeObserver(() => {
  if (ed?.fit) setZoom('fit');
}).observe(canvas);

/**
 * Opens the image editor on one comment.
 * @param {object} issue The stored comment.
 * @param {{ send: (type: string, payload?: object) => Promise<any>, onSaved: (issue: object) => void, label?: string }} options
 *   How to reach the background, what to do after a save, and a heading for the editor.
 */
export async function openEditor(issue, { send, onSaved, label }) {
  const base = await send('editorBase', { id: issue.id });
  if (!base || base.error) {
    alert(base?.error ?? 'This comment has no screenshot');
    return;
  }
  img.src = base.src;
  await img.decode().catch(() => {});
  const vw = issue.viewport.width;
  ed = {
    issue,
    send,
    onSaved,
    base,
    vw,
    vh: (vw * img.naturalHeight) / img.naturalWidth,
    marks: clone(issue.marks ?? []),
    rect: clone(issue.rect),
    sel: null,
    tool: 'select',
    zoom: 1,
    fit: true,
    history: [],
    future: [],
    drag: null,
    dirty: false,
  };
  titleEl.textContent = label ?? 'Edit image';
  note(base.hasBox ? 'Captured before clean screenshots were kept, so the region is fixed. Annotations still work.' : '');
  closeMenu();
  setTool('select');
  dialog.showModal();
  setZoom('fit');
  renderList();
}
