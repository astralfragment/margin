(() => {
  if (window.__uiAnnotator) return;

  const SEVERITIES = [
    { key: 'blocker', label: 'Blocker', color: '#ff7a7a' },
    { key: 'major', label: 'Major', color: '#fda856' },
    { key: 'minor', label: 'Minor', color: '#65b2f1' },
    { key: 'nit', label: 'Nit', color: '#ada7c4' },
  ];
  const MIN_DRAG = 6;

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: Manrope, ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
    .root {
      position: fixed; inset: 0; z-index: 2147483647;
      cursor: crosshair; background: rgba(0, 0, 0, 0.12);
    }
    .root[hidden] { display: none; }
    .root.capturing { background: transparent; }
    .root.capturing > * { visibility: hidden; }
    .hover, .band {
      position: fixed; pointer-events: none;
      border: 2px solid #e5484d; border-radius: 2px;
    }
    .hover { border-style: dashed; border-color: rgba(229, 72, 77, 0.75); }
    .band { background: rgba(229, 72, 77, 0.12); }
    .hint {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 10px; align-items: center;
      padding: 7px 12px; border-radius: 8px;
      background: #000000; color: #ffffff; border: 1px solid #2f2a45;
      font-size: 12px; line-height: 1; white-space: nowrap;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    .hint b { font-weight: 600; }
    .hint kbd {
      font: 500 11px ui-monospace, Consolas, monospace;
      background: #1c1830; border: 1px solid #2f2a45; border-radius: 4px; padding: 2px 5px;
    }
    .hint button {
      display: flex; gap: 6px; align-items: center;
      padding: 3px 6px; font-size: 12px; font-weight: 600; line-height: 1; cursor: pointer;
      color: #ada7c4; background: #1c1830; border: 1px solid #2f2a45; border-radius: 6px;
    }
    .hint button[aria-pressed="true"] { color: #000000; background: #c1f354; border-color: #c1f354; }
    .hint button[aria-pressed="true"] kbd { color: #ffffff; }
    .panel {
      position: fixed; width: 328px; padding: 12px;
      background: #000000; color: #ffffff;
      border: 1px solid #2f2a45; border-radius: 16px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
      cursor: default; display: grid; gap: 10px;
    }
    .sel {
      font: 500 11px ui-monospace, Consolas, monospace; color: #ada7c4;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    label { display: grid; gap: 5px; font-size: 12px; font-weight: 800; color: #ada7c4; }
    .sevs-label { font-size: 12px; font-weight: 800; color: #ada7c4; margin-bottom: -6px; }
    input[type="text"], textarea {
      width: 100%; padding: 7px 9px; font-size: 13px; color: #ffffff;
      background: #1c1830; border: 1px solid #756c95; border-radius: 12px; outline: none;
    }
    input[type="text"]:focus, textarea:focus { border-color: #c1b0fe; }
    textarea { resize: vertical; min-height: 62px; font-family: inherit; }
    .sevs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
    .sev {
      display: flex; align-items: center; justify-content: center; gap: 5px;
      padding: 6px 4px; font-size: 12px; font-weight: 800; color: var(--sev);
      background: #1c1830; border: 1px solid #756c95; border-radius: 12px; cursor: pointer;
    }
    .sev i { width: 8px; height: 8px; border-radius: 2px; background: currentColor; }
    .sev[aria-pressed="true"] { color: #000000; background: var(--sev); border-color: var(--sev); }
    .row { display: flex; gap: 8px; justify-content: flex-end; }
    button.action {
      padding: 7px 12px; font-size: 13px; font-weight: 800; border-radius: 12px; cursor: pointer;
      background: #1c1830; color: #ada7c4; border: 1px solid #756c95;
    }
    button.action.primary { background: #c1f354; border-color: #c1f354; color: #000000; }
    button.action:disabled { opacity: 0.45; cursor: not-allowed; }
    .panel { max-height: calc(100vh - 16px); overflow: auto; }
    .marks { display: grid; gap: 6px; }
    .marks[hidden], .marks-hint[hidden] { display: none; }
    .mrow { grid-template-columns: 20px 1fr; align-items: center; gap: 8px; }
    .mrow b, .pin {
      display: grid; place-items: center; width: 20px; height: 20px; border-radius: 999px;
      font-size: 11px; font-weight: 800; color: #ffffff; background: #e5484d;
    }
    .marks-hint { font-size: 11px; color: #ada7c4; }
    .pin {
      position: fixed; width: 24px; height: 24px; margin: -12px 0 0 -12px; font-size: 12px;
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.92); cursor: context-menu;
    }
    .ctx {
      position: fixed; min-width: 232px; padding: 4px; display: grid; gap: 2px;
      background: #000000; border: 1px solid #2f2a45; border-radius: 12px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45); cursor: default;
    }
    .ctx button {
      text-align: left; padding: 7px 10px; font-size: 12px; font-weight: 600; color: #ffffff;
      background: transparent; border: 0; border-radius: 8px; cursor: pointer;
    }
    .ctx button:hover { background: #1c1830; }
    .ctx hr { border: 0; height: 1px; margin: 2px 0; background: #2f2a45; }
    .toast {
      position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
      padding: 8px 14px; border-radius: 8px; font-size: 12px;
      background: #000000; color: #ffffff; border: 1px solid #2f2a45;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
  `;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  host.setAttribute('popover', 'manual');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="root" hidden>
      <div class="hover" hidden></div>
      <div class="band" hidden></div>
      <div class="hint">
        <b data-group>Margin</b>
        <span data-instruction>Drag over an area</span>
        <button type="button" data-selectors aria-pressed="false">Selectors <kbd>S</kbd></button>
        <button type="button" data-markers aria-pressed="true">Markers <kbd>M</kbd></button>
        <span><kbd>Esc</kbd> to stop</span>
      </div>
    </div>
  `;
  const root = shadow.querySelector('.root');
  const hoverBox = shadow.querySelector('.hover');
  const band = shadow.querySelector('.band');
  const selectorsBtn = shadow.querySelector('[data-selectors]');
  const markersBtn = shadow.querySelector('[data-markers]');
  const instruction = shadow.querySelector('[data-instruction]');
  const SELECTORS_KEY = 'selectorMode';
  const MARKERS_KEY = 'markerMode';

  const state = { active: false, drag: null, panel: null, menu: null, selectors: false, markers: true };

  const SHIELDED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend'];
  const COPIED = ['clientX', 'clientY', 'screenX', 'screenY', 'button', 'buttons', 'detail', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'pointerId', 'pointerType', 'isPrimary'];

  /**
   * Keeps presses on the overlay away from the page, so its click-outside and blur handlers never fire.
   * The press is stopped at the window, then a copy that cannot leave the shadow root is replayed on the element under the pointer,
   * or on the focused element when the click came from the keyboard.
   * @param {Event} e A press event caught at the window during the capture phase.
   */
  function shield(e) {
    if (e.target !== host) return;
    e.stopImmediatePropagation();
    if (!(e instanceof MouseEvent)) return;
    const fromKeyboard = e.type === 'click' && e.detail === 0 && shadow.activeElement;
    const inner = fromKeyboard ? shadow.activeElement : shadow.elementFromPoint(e.clientX, e.clientY);
    if (!inner) return;
    const init = { bubbles: e.bubbles, cancelable: e.cancelable, composed: false };
    for (const key of COPIED) if (key in e) init[key] = e[key];
    const copy = new e.constructor(e.type, init);
    inner.dispatchEvent(copy);
    if (copy.defaultPrevented) e.preventDefault();
  }

  /**
   * Turns element selector capture on or off and remembers the choice.
   * @param {boolean} next Whether hovering, click-to-pick and selector capture are enabled.
   * @param {boolean} [persist] False when the change came from storage and needs no write back.
   */
  function setSelectors(next, persist = true) {
    state.selectors = next;
    selectorsBtn.setAttribute('aria-pressed', String(next));
    selectorsBtn.title = next ? 'Selector capture is on' : 'Selector capture is off';
    instruction.textContent = next ? 'Click an element or drag over an area' : 'Drag over an area';
    if (!next) hoverBox.hidden = true;
    if (persist) chrome.storage.local.set({ [SELECTORS_KEY]: next }).catch(() => {});
  }

  /**
   * Turns numbered markers inside a fresh selection on or off and remembers the choice.
   * @param {boolean} next Whether a click inside the selection drops a numbered marker.
   * @param {boolean} [persist] False when the change came from storage and needs no write back.
   */
  function setMarkers(next, persist = true) {
    state.markers = next;
    markersBtn.setAttribute('aria-pressed', String(next));
    markersBtn.title = next ? 'Click inside a selection to add numbered markers' : 'Numbered markers are off';
    state.panel?.node.querySelector('[data-marks-hint]')?.toggleAttribute('hidden', !next);
    if (persist) chrome.storage.local.set({ [MARKERS_KEY]: next }).catch(() => {});
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (SELECTORS_KEY in changes) setSelectors(changes[SELECTORS_KEY].newValue === true, false);
    if (MARKERS_KEY in changes) setMarkers(changes[MARKERS_KEY].newValue !== false, false);
  });

  for (const button of [selectorsBtn, markersBtn]) {
    button.addEventListener('mousedown', (e) => e.stopPropagation());
    button.addEventListener('mouseup', (e) => e.stopPropagation());
  }
  selectorsBtn.addEventListener('click', () => setSelectors(!state.selectors));
  markersBtn.addEventListener('click', () => setMarkers(!state.markers));
  chrome.storage.local
    .get([SELECTORS_KEY, MARKERS_KEY])
    .then((bag) => {
      setSelectors(bag[SELECTORS_KEY] === true, false);
      setMarkers(bag[MARKERS_KEY] !== false, false);
    })
    .catch(() => {});

  /**
   * Describes the element at the centre of a region, or returns null when selector capture is off or fails.
   * @param {{x:number,y:number,w:number,h:number}} rect The captured region in viewport pixels.
   */
  function elementFor(rect) {
    if (!state.selectors) return null;
    try {
      return describe(elementAt(rect.x + rect.w / 2, rect.y + rect.h / 2));
    } catch {
      return null;
    }
  }

  /** Returns the page element under a viewport point, ignoring our own overlay. */
  function elementAt(x, y) {
    host.style.display = 'none';
    const el = document.elementFromPoint(x, y);
    host.style.display = '';
    return el;
  }

  /** Builds a short, readable CSS path for an element. */
  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let part = node.localName;
      const classes = [...node.classList]
        .filter((c) => c.length < 24 && !/\d{4,}/.test(c))
        .slice(0, 2);
      if (classes.length) part += `.${classes.map((c) => CSS.escape(c)).join('.')}`;
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.localName === node.localName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  /** Captures the facts about an element that a developer needs to find it again. */
  function describe(el) {
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      selector: cssPath(el),
      tag: el.localName,
      id: el.id || '',
      classes: [...el.classList].slice(0, 6).join(' '),
      text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
      styles: {
        color: style.color,
        background: style.backgroundColor,
        font: `${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily.split(',')[0]}`,
      },
    };
  }

  function place(el, rect) {
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    el.hidden = false;
  }

  function toast(text, ms = 1600) {
    const node = document.createElement('div');
    node.className = 'toast';
    node.textContent = text;
    root.append(node);
    setTimeout(() => node.remove(), ms);
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  /** Splits pasted reference links on whitespace or commas, keeping real URLs. */
  function parseLinks(value) {
    return value
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter((part) => /^https?:\/\//i.test(part));
  }

  /** Screenshots the region, stores a draft issue, then opens the note panel. */
  /**
   * Rounds a region to whole pixels and keeps it inside the viewport.
   * @param {{x:number,y:number,w:number,h:number}} rect The region in viewport pixels.
   */
  function fitRect(rect) {
    return {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      w: Math.round(Math.min(rect.w, window.innerWidth)),
      h: Math.round(Math.min(rect.h, window.innerHeight)),
    };
  }

  /** Captures the whole visible area as one comment. */
  function captureViewport() {
    closePanel(true);
    capture(fitRect({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }));
  }

  /**
   * Captures the element under a point with its selector, whether or not selector capture is on.
   * @param {number} x Viewport x of the point.
   * @param {number} y Viewport y of the point.
   */
  function captureElementAt(x, y) {
    const el = elementAt(x, y);
    if (!el) return;
    const r = el.getBoundingClientRect();
    let element = null;
    try {
      element = describe(el);
    } catch {}
    capture(fitRect({ x: r.left, y: r.top, w: r.width, h: r.height }), element);
  }

  function closeMenu() {
    state.menu?.remove();
    state.menu = null;
  }

  /**
   * Opens the right-click menu of annotation actions at a point.
   * @param {number} x Viewport x of the click.
   * @param {number} y Viewport y of the click.
   */
  function openMenu(x, y) {
    closeMenu();
    const items = [
      ['Comment on this element', () => captureElementAt(x, y)],
      ['Comment on the whole visible area', captureViewport],
      [state.selectors ? 'Turn selector capture off' : 'Turn selector capture on', () => setSelectors(!state.selectors)],
      [state.markers ? 'Turn numbered markers off' : 'Turn numbered markers on', () => setMarkers(!state.markers)],
      null,
      ['Stop annotating', () => setActive(false)],
    ];
    const menu = document.createElement('div');
    menu.className = 'ctx';
    menu.setAttribute('role', 'menu');
    for (const item of items) {
      if (!item) {
        menu.append(document.createElement('hr'));
        continue;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = item[0];
      button.addEventListener('click', () => {
        closeMenu();
        item[1]();
      });
      menu.append(button);
    }
    for (const type of ['mousedown', 'mouseup']) menu.addEventListener(type, (e) => e.stopPropagation());
    menu.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    root.append(menu);
    menu.style.left = `${Math.min(x, window.innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - menu.offsetHeight - 8)}px`;
    state.menu = menu;
  }

  function onContext(e) {
    e.preventDefault();
    if (state.panel || state.drag) return;
    openMenu(e.clientX, e.clientY);
  }

  async function capture(rect, element = elementFor(rect)) {
    band.hidden = true;
    hoverBox.hidden = true;
    root.classList.add('capturing');
    await nextFrame();
    await new Promise((r) => setTimeout(r, 60));

    let res;
    try {
      res = await chrome.runtime.sendMessage({
        type: 'capture',
        rect,
        element,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollY: Math.round(window.scrollY),
          dpr: window.devicePixelRatio,
        },
      });
    } catch (err) {
      res = { error: String(err.message ?? err) };
    }

    root.classList.remove('capturing');
    if (!res || res.error) {
      toast(res?.error ?? 'Screenshot failed');
      return;
    }
    openPanel(res.id, rect, element);
  }

  /**
   * Finds where the note panel can sit without covering the selected region.
   * Tries below, above, right and left in turn, then falls back to the side with the most room.
   * @param {{x:number,y:number,w:number,h:number}} rect The selected region in viewport pixels.
   * @param {number} width The panel width.
   * @param {number} height The panel height.
   */
  function panelSpot(rect, width, height) {
    const gap = 10;
    const edge = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampX = (x) => Math.min(Math.max(edge, x), vw - width - edge);
    const clampY = (y) => Math.min(Math.max(edge, y), vh - height - edge);
    const sides = [
      { room: vh - (rect.y + rect.h) - gap, need: height, left: clampX(rect.x), top: rect.y + rect.h + gap },
      { room: rect.y - gap, need: height, left: clampX(rect.x), top: rect.y - height - gap },
      { room: vw - (rect.x + rect.w) - gap, need: width, left: rect.x + rect.w + gap, top: clampY(rect.y) },
      { room: rect.x - gap, need: width, left: rect.x - width - gap, top: clampY(rect.y) },
    ];
    const fit = sides.find((s) => s.room >= s.need + edge);
    if (fit) return { left: fit.left, top: fit.top };
    const roomiest = sides.reduce((a, b) => (b.room - b.need > a.room - a.need ? b : a));
    return { left: clampX(roomiest.left), top: clampY(roomiest.top) };
  }

  function openPanel(id, rect, element) {
    closePanel(false);
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="sel"></div>
      <label>What is wrong<input type="text" data-title placeholder="Button label wraps at 320px" /></label>
      <label>Note<textarea data-note placeholder="What you expected, what happened"></textarea></label>
      <div class="marks" data-marks hidden></div>
      <span class="marks-hint" data-marks-hint${state.markers ? '' : ' hidden'}>Click inside the box to add numbered markers. Right-click one to remove it. Markers without a note are left out.</span>
      <label>Figma link, optional<input type="text" data-links placeholder="Paste one or more links" /></label>
      <span class="sevs-label">Severity</span>
      <div class="sevs">
        ${SEVERITIES.map(
          (s) =>
            `<button class="sev" type="button" data-sev="${s.key}" style="--sev:${s.color}" aria-pressed="false"><i></i>${s.label}</button>`,
        ).join('')}
      </div>
      <div class="row">
        <button class="action" type="button" data-cancel>Discard</button>
        <button class="action primary" type="button" data-save>Save comment</button>
      </div>
    `;
    panel.querySelector('.sel').textContent = element ? element.selector : 'region';
    root.append(panel);
    state.panel = { id, node: panel, rect, marks: [] };
    placePanel();
    place(band, rect);

    let severity = 'major';
    const chips = [...panel.querySelectorAll('[data-sev]')];
    const paint = () =>
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.sev === severity)));
    chips.forEach((chip) =>
      chip.addEventListener('click', () => {
        severity = chip.dataset.sev;
        paint();
      }),
    );
    paint();

    const titleInput = panel.querySelector('[data-title]');
    const noteInput = panel.querySelector('[data-note]');
    const linksInput = panel.querySelector('[data-links]');

    const saveBtn = panel.querySelector('[data-save]');

    /** A comment with neither a title nor a note is not worth keeping. */
    const filled = () => titleInput.value.trim() || noteInput.value.trim();
    const refreshSave = () => {
      saveBtn.disabled = !filled();
      saveBtn.title = filled() ? '' : 'Add a title or a note first';
    };
    titleInput.addEventListener('input', refreshSave);
    noteInput.addEventListener('input', refreshSave);
    refreshSave();

    const save = async () => {
      if (!filled()) return;
      const note = noteInput.value.trim();
      const marks = state.panel.marks
        .map((m) => ({ kind: 'dot', x: m.x, y: m.y, note: m.note.trim() }))
        .filter((m) => m.note);
      await chrome.runtime.sendMessage({
        type: 'update',
        id,
        patch: {
          severity,
          title: titleInput.value.trim() || note.split('\n')[0].slice(0, 80),
          note,
          links: parseLinks(linksInput.value),
        },
      });
      if (marks.length) await chrome.runtime.sendMessage({ type: 'annotate', id, marks });
      closePanel(false);
      toast('Comment saved');
    };

    panel.querySelector('[data-save]').addEventListener('click', save);
    panel.querySelector('[data-cancel]').addEventListener('click', () => closePanel(true));
    panel.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
      if (e.key === 'Escape') closePanel(true);
    });
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    titleInput.focus();
  }

  /** Moves the open note panel clear of its selection, after it grows or shrinks. */
  function placePanel() {
    const { node, rect } = state.panel;
    const spot = panelSpot(rect, node.offsetWidth, node.offsetHeight);
    node.style.left = `${spot.left}px`;
    node.style.top = `${spot.top}px`;
  }

  /** Redraws the numbered marker pins on the page and their note rows in the panel. */
  function paintMarks() {
    const { node, marks } = state.panel;
    root.querySelectorAll('.pin').forEach((pin) => pin.remove());
    marks.forEach((m, i) => {
      const pin = Object.assign(document.createElement('b'), { className: 'pin', textContent: String(i + 1) });
      pin.style.left = `${m.x}px`;
      pin.style.top = `${m.y}px`;
      pin.title = 'Right-click to remove';
      pin.addEventListener('mousedown', (e) => e.stopPropagation());
      pin.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        marks.splice(i, 1);
        paintMarks();
      });
      root.append(pin);
    });
    const list = node.querySelector('[data-marks]');
    list.hidden = !marks.length;
    list.replaceChildren(
      ...marks.map((m, i) => {
        const row = Object.assign(document.createElement('label'), { className: 'mrow' });
        row.innerHTML = `<b>${i + 1}</b><input type="text" placeholder="What marker ${i + 1} points out" />`;
        const input = row.querySelector('input');
        input.value = m.note;
        input.addEventListener('input', () => (m.note = input.value));
        return row;
      }),
    );
    placePanel();
  }

  /**
   * Drops the next numbered marker at a point inside the open selection and focuses its note.
   * @param {number} x Viewport x of the click.
   * @param {number} y Viewport y of the click.
   */
  function addMark(x, y) {
    state.panel.marks.push({ x: Math.round(x), y: Math.round(y), note: '' });
    paintMarks();
    state.panel.node.querySelector('.mrow:last-child input')?.focus();
  }

  /** Closes the note panel. When `discard` is true the draft issue is deleted. */
  function closePanel(discard) {
    if (!state.panel) return;
    const { id, node } = state.panel;
    state.panel = null;
    node.remove();
    root.querySelectorAll('.pin').forEach((pin) => pin.remove());
    band.hidden = true;
    if (discard) chrome.runtime.sendMessage({ type: 'discard', id });
  }

  function onMove(e) {
    if (state.drag) {
      const x = Math.min(e.clientX, state.drag.x);
      const y = Math.min(e.clientY, state.drag.y);
      place(band, { x, y, w: Math.abs(e.clientX - state.drag.x), h: Math.abs(e.clientY - state.drag.y) });
      return;
    }
    if (state.panel || !state.selectors) return;
    const el = elementAt(e.clientX, e.clientY);
    if (!el) {
      hoverBox.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    place(hoverBox, { x: r.left, y: r.top, w: r.width, h: r.height });
  }

  function onDown(e) {
    if (state.menu) {
      e.preventDefault();
      if (e.button === 0) closeMenu();
      return;
    }
    if (e.button !== 0) return;
    if (state.panel) {
      const r = state.panel.rect;
      const inside = e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
      if (state.markers && inside) {
        e.preventDefault();
        addMark(e.clientX, e.clientY);
      }
      return;
    }
    e.preventDefault();
    state.drag = { x: e.clientX, y: e.clientY };
    hoverBox.hidden = true;
  }

  function onUp(e) {
    if (!state.drag) return;
    const start = state.drag;
    state.drag = null;
    band.hidden = true;

    let rect = {
      x: Math.min(e.clientX, start.x),
      y: Math.min(e.clientY, start.y),
      w: Math.abs(e.clientX - start.x),
      h: Math.abs(e.clientY - start.y),
    };
    if (rect.w < MIN_DRAG || rect.h < MIN_DRAG) {
      if (!state.selectors) return;
      const el = elementAt(e.clientX, e.clientY);
      if (!el) return;
      const r = el.getBoundingClientRect();
      rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
    rect = fitRect(rect);
    if (rect.w < 2 || rect.h < 2) return;
    capture(rect);
  }

  function onKey(e) {
    const plain = !state.panel && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (plain && e.key?.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      setSelectors(!state.selectors);
      return;
    }
    if (plain && e.key?.toLowerCase() === 'm') {
      e.preventDefault();
      e.stopPropagation();
      setMarkers(!state.markers);
      return;
    }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (state.menu) closeMenu();
    else if (state.panel) closePanel(true);
    else setActive(false);
  }

  function setActive(next) {
    if (state.active === next) return state.active;
    state.active = next;
    root.hidden = !next;
    if (next) {
      if (!host.isConnected) document.documentElement.append(host);
      if (!host.matches(':popover-open')) host.showPopover?.();
      SHIELDED.forEach((type) => window.addEventListener(type, shield, true));
      root.addEventListener('mousemove', onMove);
      root.addEventListener('mousedown', onDown);
      root.addEventListener('mouseup', onUp);
      root.addEventListener('contextmenu', onContext);
      window.addEventListener('keydown', onKey, true);
    } else {
      closeMenu();
      closePanel(true);
      state.drag = null;
      band.hidden = true;
      hoverBox.hidden = true;
      SHIELDED.forEach((type) => window.removeEventListener(type, shield, true));
      root.removeEventListener('mousemove', onMove);
      root.removeEventListener('mousedown', onDown);
      root.removeEventListener('mouseup', onUp);
      root.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey, true);
      host.remove();
    }
    return state.active;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ping') sendResponse({ ok: true });
    else if (msg?.type === 'toggle') {
      if (msg.groupName) shadow.querySelector('[data-group]').textContent = msg.groupName;
      sendResponse({ active: setActive(!state.active) });
    }
    else if (msg?.type === 'stop') sendResponse({ active: setActive(false) });
    else if (msg?.type === 'captureViewport') {
      if (msg.groupName) shadow.querySelector('[data-group]').textContent = msg.groupName;
      setActive(true);
      captureViewport();
      sendResponse({ active: true });
    }
    return false;
  });

  window.__uiAnnotator = {
    setActive,
    isActive: () => state.active,
    hideForCapture: (hidden) => root.classList.toggle('capturing', hidden),
  };
})();
