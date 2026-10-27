(() => {
  if (window.__uiAnnotator) return;

  const SEVERITIES = [
    { key: 'blocker', label: 'Blocker' },
    { key: 'major', label: 'Major' },
    { key: 'minor', label: 'Minor' },
    { key: 'nit', label: 'Nit' },
  ];
  const STATUS_LABELS = { open: 'Open', fixed: 'Fixed', wontfix: "Won't fix" };
  const MIN_DRAG = 6;
  const GAP = 12;
  const EDGE = 8;
  const HINT_SPACE = 64;
  const FONT = 'Margin Manrope';
  const THEME_KEY = 'theme';
  const SELECTORS_KEY = 'selectorMode';
  const MARKERS_KEY = 'markerMode';
  const asset = (path) => `url("${chrome.runtime.getURL(path)}")`;
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const isField = (el) => el?.localName === 'input' || el?.localName === 'textarea';

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; font-family: "${FONT}", Manrope, ui-sans-serif, system-ui, "Segoe UI", sans-serif; }
    [hidden] { display: none !important; }
    button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
    .root {
      --ink: #7549d2; --on-ink: #ffffff; --float: #ffffff; --float-border: #cfc8ea; --divider: #e2ddf5;
      --surface-1: #ffffff; --surface-2: #f7f6fc; --surface-3: #f0eefe; --ink-tint: #ece6fb; --input-border: #857e9f;
      --fg: #000000; --muted-fg: #5b5670; --primary: #000000; --primary-fg: #ffffff;
      --destructive: #ce2c31; --destructive-tint: #feebec;
      --sev-blocker: #ce2c31; --tint-blocker: #feebec;
      --sev-major: #c2410c; --tint-major: #ffefd6;
      --sev-minor: #0d74ce; --tint-minor: #e6f4fe;
      --sev-nit: #60646c; --tint-nit: #f0f0f3;
      --fixed: #18794e;
      --shadow: 0 2px 8px 0 rgba(13, 10, 23, 0.14);
      --tail: ${asset('icons/ui/tail.svg')};
      position: fixed; inset: 0; z-index: 2147483647;
      cursor: crosshair; color: var(--fg);
      background: rgba(13, 10, 23, 0.12); box-shadow: inset 0 0 0 2px var(--ink);
      font-size: 13px; line-height: 20px; font-weight: 500; font-variant-numeric: tabular-nums;
      -webkit-font-smoothing: antialiased;
    }
    .root[data-theme="dark"] {
      --ink: #c1b0fe; --on-ink: #0d0b16; --float: #1c1830; --float-border: #4a4366; --divider: #2f2a45;
      --surface-1: #0d0b16; --surface-2: #15121f; --surface-3: #1c1830; --ink-tint: #2b2346; --input-border: #6b6488;
      --fg: #ffffff; --muted-fg: #ada7c4; --primary: #ffffff; --primary-fg: #000000;
      --destructive: #ff9592; --destructive-tint: #3b1219;
      --sev-blocker: #ff9592; --tint-blocker: #3b1219;
      --sev-major: #ffa057; --tint-major: #331e0b;
      --sev-minor: #70b8ff; --tint-minor: #0d2847;
      --sev-nit: #b0b4ba; --tint-nit: #212225;
      --fixed: #3dd68c;
      --tail: ${asset('icons/ui/tail-dark.svg')};
    }
    .root[hidden] { display: none; }
    .root.capturing { background: transparent; box-shadow: none; }
    .root.capturing > * { visibility: hidden; }
    [data-sev="blocker"] { --sev: var(--sev-blocker); --tint: var(--tint-blocker); --glyph: ${asset('icons/ui/glyph-blocker.svg')}; }
    [data-sev="major"] { --sev: var(--sev-major); --tint: var(--tint-major); --glyph: ${asset('icons/ui/glyph-major.svg')}; }
    [data-sev="minor"] { --sev: var(--sev-minor); --tint: var(--tint-minor); --glyph: ${asset('icons/ui/glyph-minor.svg')}; }
    [data-sev="nit"] { --sev: var(--sev-nit); --tint: var(--tint-nit); --glyph: ${asset('icons/ui/glyph-nit.svg')}; }

    .icon { display: block; flex: none; width: 14px; height: 14px; background: currentColor; mask: var(--icon) center / contain no-repeat; }
    .i-close { --icon: ${asset('icons/ui/close.svg')}; }
    .i-plus { --icon: ${asset('icons/ui/plus.svg')}; }
    .i-link { --icon: ${asset('icons/ui/link.svg')}; }
    .i-check { --icon: ${asset('icons/ui/check.svg')}; }
    .i-more { --icon: ${asset('icons/ui/more.svg')}; width: 16px; height: 16px; }
    .i-alert { --icon: ${asset('icons/ui/alert.svg')}; width: 16px; height: 16px; color: var(--destructive); }
    .glyph { width: 10px; height: 10px; color: var(--sev); --icon: var(--glyph); }

    kbd {
      display: inline-flex; align-items: center; justify-content: center; height: 18px; min-width: 18px; padding: 0 4px;
      font-size: 12px; line-height: 16px; font-weight: 600; color: var(--muted-fg);
      background: var(--surface-3); border: 1px solid var(--divider); border-radius: 4px;
    }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none;
      height: 32px; padding: 0 8px; border-radius: 6px; white-space: nowrap;
      font-size: 13px; line-height: 18px; font-weight: 600; color: var(--fg);
    }
    .btn:hover { background: var(--surface-3); }
    .btn.primary { padding: 0 12px; color: var(--primary-fg); background: var(--primary); }
    .btn.primary:hover { opacity: 0.88; }
    .btn.primary:disabled { color: var(--muted-fg); background: var(--surface-3); opacity: 1; cursor: not-allowed; }
    .btn.secondary { padding: 0 12px; background: var(--surface-1); border: 1px solid var(--input-border); }
    .btn.danger { color: var(--destructive); }
    .btn:focus-visible, .chip:focus-visible, .remove:focus-visible, .toggle:focus-visible, .ctx button:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }

    .hover {
      position: fixed; pointer-events: none;
      border: 1.5px solid var(--ink); border-radius: 6px;
    }
    .band {
      position: fixed; pointer-events: none;
      border: 2px solid var(--ink); border-radius: 6px; box-shadow: inset 0 0 0 3px var(--on-ink);
    }
    .flag {
      position: fixed; display: inline-flex; align-items: center; height: 20px; padding: 0 6px;
      font-size: 12px; line-height: 16px; font-weight: 800; white-space: nowrap;
      color: var(--on-ink); background: var(--ink); border: 2px solid var(--on-ink);
      border-radius: 4px 4px 4px 0; cursor: default;
    }
    .flag.draft { color: var(--ink); background: var(--on-ink); border: 1.5px solid var(--ink); }
    .panel-head .flag, .toast .flag { position: static; }
    .saved { position: fixed; pointer-events: none; }
    .saved .halo, .saved .outline { position: absolute; inset: 0; border-radius: 6px; }
    .saved .halo { border: 4px solid var(--on-ink); }
    .saved .outline { border: 1.5px dashed var(--ink); }
    .saved[data-status="fixed"] .outline { border-color: var(--fixed); }
    .saved[data-status="wontfix"] .outline { border-color: var(--muted-fg); }
    .saved.hot .outline { border-style: solid; }
    .saved .flag { position: absolute; left: 0; pointer-events: auto; }
    .pin {
      display: grid; place-items: center; flex: none; width: 22px; height: 22px;
      font-size: 12px; line-height: 16px; font-weight: 800; color: var(--on-ink);
      background: var(--ink); border: 2px solid var(--on-ink); border-radius: 11px 11px 11px 3px;
    }
    .root > .pin { position: fixed; transform: translateY(-100%); cursor: context-menu; }
    .pin.ghost { opacity: 0.45; }

    .tip {
      position: fixed; display: grid; gap: 4px; max-width: 320px; padding: 8px 12px; pointer-events: none;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 6px; box-shadow: var(--shadow);
    }
    .tip b { font-size: 13px; line-height: 18px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tip .meta { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; }
    .tip .meta .status { margin-left: 2px; color: var(--muted-fg); }
    .tip .meta .status[data-status="fixed"] { color: var(--fixed); }
    .tip .where { font-size: 12px; line-height: 16px; color: var(--muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .hint {
      position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px; height: 40px; max-width: calc(100vw - 32px);
      padding: 4px 4px 4px 12px; overflow: hidden; white-space: nowrap; cursor: default;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 10px; box-shadow: var(--shadow);
    }
    .review { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .review .mark { flex: none; width: 16.7px; height: 14.4px; background: var(--ink); mask: ${asset('icons/ui/mark.svg')} center / contain no-repeat; }
    .review b { font-size: 13px; line-height: 18px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
    .review .count { font-size: 12px; line-height: 16px; color: var(--muted-fg); }
    .hint .divider { flex: none; width: 1px; height: 20px; background: var(--divider); }
    .hint .gap { flex: none; width: 4px; }
    .toggle {
      display: flex; align-items: center; gap: 8px; flex: none; height: 32px; padding: 0 4px; border-radius: 6px;
      font-size: 12px; line-height: 16px; font-weight: 500;
    }
    .toggle:hover { background: var(--surface-3); }
    .switch {
      position: relative; flex: none; width: 28px; height: 16px; border-radius: 8px;
      background: var(--surface-3); box-shadow: inset 0 0 0 1px var(--input-border);
    }
    .switch::after {
      content: ""; position: absolute; top: 2px; left: 3px; width: 12px; height: 12px; border-radius: 50%; background: var(--muted-fg);
    }
    .toggle[aria-pressed="true"] .switch { background: var(--ink); box-shadow: none; }
    .toggle[aria-pressed="true"] .switch::after { left: 14px; background: var(--on-ink); }
    .stop { gap: 4px; }
    @media (max-width: 640px) {
      .hint { gap: 8px; }
      .review b, .review .count, .hint kbd, .hint .gap, .hint .divider, .hint [data-report] { display: none; }
    }

    .panel {
      position: fixed; width: 340px; max-width: calc(100vw - 16px); display: flex; flex-direction: column;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 10px; box-shadow: var(--shadow);
      overflow: hidden; cursor: default;
    }
    .panel-head {
      display: flex; align-items: center; gap: 8px; flex: none; min-height: 45px; padding: 8px 12px;
      border-bottom: 1px solid var(--divider);
    }
    .panel-head h2 { font-size: 15px; line-height: 20px; font-weight: 800; letter-spacing: -0.01em; white-space: nowrap; }
    .panel-head .spacer { flex: 1; }
    .chip {
      display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px; border-radius: 6px;
      font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap;
    }
    .chip:hover { background: var(--surface-3); }
    .square { width: 28px; padding: 0; justify-content: center; }
    .error {
      display: grid; gap: 8px; flex: none; padding: 12px 12px 12px 13px;
      background: var(--destructive-tint); border-left: 3px solid var(--destructive);
    }
    .error p { font-size: 12px; line-height: 16px; color: var(--muted-fg); }
    .error .head { display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 18px; font-weight: 600; color: var(--fg); }
    .error .btn { justify-self: start; }
    .panel-body { display: flex; flex-direction: column; gap: 12px; min-height: 0; padding: 16px 12px; overflow: auto; }
    .field { display: grid; gap: 6px; }
    .field-hint { font-size: 12px; line-height: 16px; color: var(--muted-fg); }
    input[type="text"], textarea {
      display: block; width: 100%; min-width: 0; height: 32px; padding: 0 12px;
      font-size: 13px; line-height: 20px; font-weight: 500; color: var(--fg);
      background: var(--surface-1); border: 1px solid var(--input-border); border-radius: 6px; outline: none;
    }
    textarea { height: 76px; min-height: 76px; max-height: 200px; padding: 7px 11px; resize: none; }
    input[type="text"]:focus, textarea:focus { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
    ::placeholder { color: var(--muted-fg); opacity: 1; }
    .seg { display: flex; gap: 2px; padding: 2px; background: var(--surface-3); border-radius: 6px; }
    .seg button {
      display: flex; align-items: center; justify-content: center; gap: 4px; flex: 1; min-width: 0; height: 28px; border-radius: 4px;
      font-size: 12px; line-height: 16px; font-weight: 600;
    }
    .seg button:hover { background: var(--float); }
    .seg button .icon { display: none; width: 12px; height: 12px; }
    .seg button[aria-pressed="true"] { color: var(--sev); background: var(--tint); }
    .seg button[aria-pressed="true"] .icon { display: block; }
    .seg button:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
    .marks { display: grid; gap: 8px; }
    .mrow, .place-hint, .frame-row, .link-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .remove { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: 6px; }
    .remove:hover { background: var(--surface-3); }
    .place-hint { font-size: 12px; line-height: 16px; color: var(--muted-fg); }
    .frame-row .text { display: grid; flex: 1; min-width: 0; }
    .frame-row .text span, .frame-row .text b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .frame-row .label { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--muted-fg); }
    .frame-row b { font-size: 13px; line-height: 18px; font-weight: 600; }
    .frame-row .meta { font-size: 12px; line-height: 16px; color: var(--muted-fg); }
    .picker { display: grid; gap: 4px; padding: 8px; background: var(--surface-2); border-radius: 6px; }
    .picker-list { display: grid; gap: 4px; max-height: 232px; overflow: auto; }
    .picker-page { padding-top: 2px; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--muted-fg); }
    .picker-row {
      display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 8px; border-radius: 6px; text-align: left;
      font-size: 13px; line-height: 20px; font-weight: 500;
    }
    .picker-row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .picker-row:hover, .picker-row.active { background: var(--surface-3); }
    .picker-row[aria-selected="true"] { background: var(--ink-tint); }
    .picker-row .icon { display: none; color: var(--ink); }
    .picker-row[aria-selected="true"] .icon { display: block; }
    .picker-more { justify-self: start; font-size: 12px; line-height: 16px; color: var(--muted-fg); }
    .picker-more:hover { color: var(--fg); text-decoration: underline; }
    .picker-empty { padding: 4px; font-size: 12px; line-height: 16px; color: var(--muted-fg); }
    .quiet { display: flex; align-items: center; gap: 2px; margin-left: -4px; }
    .quiet .chip { padding: 0 4px; }
    .quiet .chip[aria-expanded="true"] { color: var(--ink); background: var(--ink-tint); }
    .panel-foot {
      display: flex; align-items: center; gap: 8px; flex: none; padding: 12px; border-top: 1px solid var(--divider);
    }
    .panel-foot .spacer { flex: 1; }
    .save-hint { font-size: 12px; line-height: 16px; color: var(--muted-fg); white-space: nowrap; }
    .panel-foot.ask { flex-direction: column; align-items: stretch; }
    .ask-q { font-size: 13px; line-height: 18px; font-weight: 600; }
    .ask-row { display: flex; align-items: center; gap: 8px; }
    .tail { position: fixed; width: 8px; height: 14px; pointer-events: none; background: var(--tail) center / contain no-repeat; }
    .more-menu {
      position: fixed; display: grid; min-width: 220px; padding: 4px;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 10px; box-shadow: var(--shadow); cursor: default;
    }

    .ctx {
      position: fixed; width: 340px; max-width: calc(100vw - 16px); padding: 4px; display: grid;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 10px;
      box-shadow: var(--shadow); cursor: default;
    }
    .ctx button, .more-menu button {
      height: 32px; padding: 0 10px; text-align: left; white-space: nowrap;
      font-size: 13px; line-height: 20px; font-weight: 500; color: var(--fg);
      border: 2px solid transparent; border-radius: 6px;
    }
    .ctx button:hover, .more-menu button:hover { background: var(--surface-3); }
    .ctx button:focus, .more-menu button:focus { background: var(--surface-3); border-color: var(--ink); outline: none; }
    .more-menu button:disabled { color: var(--muted-fg); cursor: default; }
    .ctx hr { height: 1px; margin: 4px 0; border: 0; background: var(--divider); }

    .toast {
      position: fixed; display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 4px 12px;
      font-size: 13px; line-height: 18px; font-weight: 600; white-space: nowrap; cursor: default;
      color: var(--primary-fg); background: var(--primary); border-radius: 10px; box-shadow: var(--shadow);
    }
    .toast.plain { left: 50%; bottom: ${HINT_SPACE}px; transform: translateX(-50%); max-width: calc(100vw - 32px); white-space: normal; }
    .toast.saved-toast { padding-right: 4px; }
    .toast .actions { display: flex; }
    .toast .btn { color: var(--primary-fg); }
    .toast .btn:hover { background: color-mix(in srgb, var(--primary-fg) 14%, transparent); }
  `;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  host.setAttribute('popover', 'manual');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>${STYLE}</style>
    <div class="root" hidden data-theme="light">
      <div class="layer" data-layer></div>
      <div class="hover" hidden></div>
      <div class="band" hidden></div>
      <div class="hint">
        <span class="review"><i class="mark"></i><b data-group>Margin</b><span class="count" data-count></span></span>
        <span class="divider"></span>
        <button type="button" class="toggle" data-selectors aria-pressed="false"><span class="switch"></span><span>Selectors</span><kbd>S</kbd></button>
        <button type="button" class="toggle" data-markers aria-pressed="true"><span class="switch"></span><span>Markers</span><kbd>M</kbd></button>
        <span class="gap"></span>
        <button type="button" class="btn" data-report>Open report</button>
        <button type="button" class="btn stop" data-stop><span>Stop</span><kbd>Esc</kbd></button>
      </div>
    </div>
  `;
  const root = shadow.querySelector('.root');
  const layer = shadow.querySelector('[data-layer]');
  const hoverBox = shadow.querySelector('.hover');
  const band = shadow.querySelector('.band');
  const hint = shadow.querySelector('.hint');
  const selectorsBtn = shadow.querySelector('[data-selectors]');
  const markersBtn = shadow.querySelector('[data-markers]');
  const groupLabel = shadow.querySelector('[data-group]');
  const countLabel = shadow.querySelector('[data-count]');

  const state = {
    active: false,
    drag: null,
    panel: null,
    menu: null,
    selectors: false,
    markers: true,
    review: null,
    total: 0,
    comments: [],
    pending: null,
    saved: null,
    toast: null,
    tip: null,
  };

  const SHIELDED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend'];
  const LAYERED = ['toggle', 'close', 'fullscreenchange'];
  const COPIED = ['clientX', 'clientY', 'screenX', 'screenY', 'button', 'buttons', 'detail', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'pointerId', 'pointerType', 'isPrimary'];

  /**
   * Keeps presses on the overlay away from the page, so its click-outside and blur handlers never fire.
   * The press is stopped at the window, then a copy that cannot leave the shadow root is replayed on the element under the pointer,
   * or on the focused element when the click came from the keyboard. A real press that reached the page instead went
   * through the overlay, so it is cancelled, the overlay is raised again, and the copy goes to the overlay root.
   * @param {Event} e A press event caught at the window during the capture phase.
   */
  function shield(e) {
    if (e.target !== host) {
      if (!e.isTrusted || (e instanceof MouseEvent && (e.clientX >= root.clientWidth || e.clientY >= root.clientHeight))) return;
      e.stopImmediatePropagation();
      if (e.cancelable && !/^(pointer|touch)/.test(e.type)) e.preventDefault();
      raise();
      if (e instanceof MouseEvent) replay(e, root);
      return;
    }
    e.stopImmediatePropagation();
    if (!(e instanceof MouseEvent)) return;
    const fromKeyboard = e.type === 'click' && e.detail === 0 && shadow.activeElement;
    const inner = fromKeyboard ? shadow.activeElement : shadow.elementFromPoint(e.clientX, e.clientY);
    if (inner) replay(e, inner);
  }

  /**
   * Dispatches a copy of a mouse event inside the shadow root, where it cannot reach the page.
   * @param {MouseEvent} e The original event.
   * @param {Element} inner The overlay element that receives the copy.
   */
  function replay(e, inner) {
    const init = { bubbles: e.bubbles, cancelable: e.cancelable, composed: false };
    for (const key of COPIED) if (key in e) init[key] = e[key];
    const copy = new e.constructor(e.type, init);
    inner.dispatchEvent(copy);
    if (copy.defaultPrevented) e.preventDefault();
  }

  let rescues = 0;
  const hostWatch = new MutationObserver(() => {
    if (!state.active || host.isConnected || rescues > 2) return;
    if (!rescues) requestAnimationFrame(() => (rescues = 0));
    rescues++;
    raise();
  });

  /**
   * Puts the overlay back above everything on the page. It goes back into the document if the page removed it, and into
   * the open modal dialog when there is one, because a modal dialog makes everything outside it inert and presses would
   * pass through. Hiding and showing the popover again makes it the newest top layer entry, above later popovers,
   * dialogs and fullscreen elements. Focus inside the overlay is kept.
   */
  function raise() {
    const focused = shadow.activeElement;
    const modal = [...document.querySelectorAll('dialog:modal')].at(-1);
    const parent = modal ?? document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover?.();
    hostWatch.disconnect();
    for (let node = host.parentNode; node; node = node.parentNode) hostWatch.observe(node, { childList: true });
    if (focused && shadow.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  /**
   * Raises the overlay again when the page opens a popover or dialog of its own, changes fullscreen, closes the dialog
   * the overlay sits in, or hides the overlay. A re-raise of another overlay shows as open to open and is ignored,
   * so two overlays never take turns forever.
   * @param {Event} e A toggle, close or fullscreenchange event caught at the window.
   */
  function onLayer(e) {
    if (e.target === host) {
      if (e.newState === 'closed' && state.active) raise();
      return;
    }
    const opened = e.type === 'toggle' && e.oldState === 'closed' && e.newState === 'open';
    const holder = e.target instanceof Element && e.target.contains(host);
    if (opened || holder || e.type === 'fullscreenchange') raise();
  }

  /**
   * Feeds pointer moves that land on the page, over or around the overlay, to the hover outline and the drag band.
   * @param {MouseEvent} e A mousemove caught at the window.
   */
  function onStrayMove(e) {
    if (e.target !== host && e.isTrusted) onMove(e);
  }

  /**
   * Keeps a press inside an overlay control from starting a drag on the page underneath.
   * @param {HTMLElement} el The control or container.
   */
  function stopPresses(el) {
    for (const type of ['mousedown', 'mouseup']) el.addEventListener(type, (e) => e.stopPropagation());
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
    if (persist) chrome.storage.local.set({ [MARKERS_KEY]: next }).catch(() => {});
  }

  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  let themeChoice;

  /** Shows the overlay in the theme Margin's own pages use: light unless the stored setting says dark, or system on a dark OS. */
  function paintTheme() {
    const dark = themeChoice === 'dark' || (themeChoice === 'system' && systemDark.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
  }
  systemDark.addEventListener('change', () => themeChoice === 'system' && paintTheme());

  let refreshTimer = 0;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (SELECTORS_KEY in changes) setSelectors(changes[SELECTORS_KEY].newValue === true, false);
    if (MARKERS_KEY in changes) setMarkers(changes[MARKERS_KEY].newValue !== false, false);
    if (THEME_KEY in changes) {
      themeChoice = changes[THEME_KEY].newValue;
      paintTheme();
    }
    if (state.active && ['issues', 'groups', 'activeGroupId'].some((key) => key in changes)) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshReview, 120);
    }
  });

  stopPresses(hint);
  selectorsBtn.addEventListener('click', () => setSelectors(!state.selectors));
  markersBtn.addEventListener('click', () => setMarkers(!state.markers));
  shadow.querySelector('[data-report]').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openReport' }).catch(() => {}));
  shadow.querySelector('[data-stop]').addEventListener('click', () => setActive(false));
  chrome.storage.local
    .get([SELECTORS_KEY, MARKERS_KEY, THEME_KEY])
    .then((bag) => {
      setSelectors(bag[SELECTORS_KEY] === true, false);
      setMarkers(bag[MARKERS_KEY] !== false, false);
      themeChoice = bag[THEME_KEY];
      paintTheme();
    })
    .catch(() => {});

  let fontsAdded = false;

  /** Registers Margin's bundled Manrope with the page under its own family name, so the shadow root can use it. */
  function loadFont() {
    if (fontsAdded || !document.fonts || typeof FontFace !== 'function') return;
    fontsAdded = true;
    for (const weight of [500, 600, 800]) {
      try {
        const face = new FontFace(FONT, asset(`fonts/manrope-latin-${weight}-normal.woff2`), { weight: String(weight) });
        document.fonts.add(face);
        face.load().catch(() => {});
      } catch {}
    }
  }

  /** Reads the active review and the comments saved on this page, then redraws the hint bar and the flags. */
  async function refreshReview() {
    const ask = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);
    const [review, page] = await Promise.all([ask({ type: 'activeReview' }), ask({ type: 'pageComments', url: location.href })]);
    const group = review?.group ?? (review?.id ? review : null);
    if (group) {
      state.review = group;
      groupLabel.textContent = group.name;
    }
    if (Array.isArray(page?.comments)) {
      state.total = page.total ?? page.comments.length;
      state.comments = page.comments;
    }
    paintCount();
    paintSaved();
  }

  /** Writes how many comments the review holds, leaving out a draft that is still open. */
  function paintCount() {
    const draft = state.panel?.id && !state.panel.reopened && state.comments.some((c) => c.id === state.panel.id) ? 1 : 0;
    const n = Math.max(0, state.total - draft);
    countLabel.textContent = `${n} ${n === 1 ? 'comment' : 'comments'}`;
  }

  /**
   * Finds where a saved comment's region sits now, by its anchor element when the window width changed, else by the scroll offset.
   * Returns null when the region is entirely out of view.
   * @param {{rect: object, anchor: object | null, viewport: object}} comment A comment from pageComments.
   */
  function regionOf(comment) {
    let box = null;
    const sameWidth = Math.abs((comment.viewport?.width ?? innerWidth) - innerWidth) < 2;
    if (!sameWidth && comment.anchor) {
      try {
        const el = document.querySelectorAll(comment.anchor.selector)[comment.anchor.nth];
        const r = el?.getBoundingClientRect();
        if (r?.width && r.height) {
          const f = comment.anchor.box;
          box = { x: r.left + f.fx * r.width, y: r.top + f.fy * r.height, w: f.fw * r.width, h: f.fh * r.height };
        }
      } catch {}
    }
    box ??= {
      x: comment.rect.x,
      y: comment.rect.y + (comment.viewport?.scrollY ?? 0) - window.scrollY,
      w: comment.rect.w,
      h: comment.rect.h,
    };
    if (box.y + box.h < 0 || box.y > innerHeight || box.x > innerWidth || box.x + box.w < 0) return null;
    return box;
  }

  /**
   * Puts a flag above a region, or below it when there is no room above.
   * @param {HTMLElement} flag The flag.
   * @param {{x:number,y:number,w:number,h:number}} rect The region in viewport pixels.
   * @param {boolean} [inside] True when the flag is placed relative to the region box rather than the viewport.
   */
  function placeFlag(flag, rect, inside = false) {
    const above = rect.y >= 24;
    const top = above ? -22 : rect.h + 2;
    flag.style.left = inside ? '0px' : `${Math.max(2, rect.x)}px`;
    flag.style.top = inside ? `${top}px` : `${rect.y + top}px`;
  }

  /** Draws the dashed regions and numbered flags of the comments saved on this page. */
  function paintSaved() {
    hideTip();
    const hidden = state.panel?.id;
    layer.replaceChildren(
      ...state.comments
        .filter((c) => c.id !== hidden)
        .map((comment) => {
          const node = document.createElement('div');
          node.className = 'saved';
          node.dataset.status = comment.status ?? 'open';
          node.innerHTML = `<i class="halo"></i><i class="outline"></i><b class="flag">${pad(comment.n)}</b>`;
          const flag = node.querySelector('.flag');
          flag.addEventListener('mouseenter', () => showTip(comment, node, flag));
          flag.addEventListener('mouseleave', hideTip);
          node.comment = comment;
          return node;
        }),
    );
    placeSaved();
  }

  /** Moves the saved regions and flags to where their comments sit after a scroll or resize. */
  function placeSaved() {
    for (const node of layer.children) {
      const box = regionOf(node.comment);
      node.hidden = !box;
      if (!box) continue;
      Object.assign(node.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
      placeFlag(node.querySelector('.flag'), box, true);
    }
  }

  let scrollFrame = 0;

  /** Repositions the saved flags once per frame while the page scrolls or resizes. */
  function onScroll() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      placeSaved();
    });
  }

  /**
   * Shows a saved comment's title, severity, status and Figma frame beside its flag.
   * @param {object} comment The comment from pageComments.
   * @param {HTMLElement} node The comment's region.
   * @param {HTMLElement} flag The flag being hovered.
   */
  function showTip(comment, node, flag) {
    hideTip();
    node.classList.add('hot');
    const sev = SEVERITIES.find((s) => s.key === comment.severity) ?? SEVERITIES[1];
    const status = STATUS_LABELS[comment.status] ? comment.status : 'open';
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.dataset.sev = sev.key;
    tip.innerHTML = `
      <b>${esc(comment.title || 'Untitled comment')}</b>
      <span class="meta"><i class="icon glyph"></i>${sev.label}<span class="status" data-status="${status}">${STATUS_LABELS[status]}</span></span>
      ${comment.frame ? `<span class="where">${esc(comment.frame)}</span>` : ''}
    `;
    root.append(tip);
    const f = flag.getBoundingClientRect();
    const right = f.right + 8;
    tip.style.left = `${right + tip.offsetWidth > innerWidth - EDGE ? Math.max(EDGE, f.left - 8 - tip.offsetWidth) : right}px`;
    tip.style.top = `${Math.min(Math.max(EDGE, f.top), innerHeight - tip.offsetHeight - EDGE)}px`;
    state.tip = { tip, node };
  }

  /** Hides the flag tooltip. */
  function hideTip() {
    state.tip?.tip.remove();
    state.tip?.node.classList.remove('hot');
    state.tip = null;
  }

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

  /**
   * Records how to find a region again after the layout reflows, whatever selector capture is set to.
   * The anchor is the element under the region's centre, widened until it covers a quarter of the region,
   * with the region stored as fractions of that element's box. Returns null when nothing sits under the region.
   * @param {{x:number,y:number,w:number,h:number}} rect The captured region in viewport pixels.
   */
  function anchorFor(rect) {
    try {
      let el = elementAt(rect.x + rect.w / 2, rect.y + rect.h / 2);
      const area = (box) => box.width * box.height;
      while (el && el.parentElement && el !== document.body && area(el.getBoundingClientRect()) < (rect.w * rect.h) / 4) {
        el = el.parentElement;
      }
      if (!el) return null;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      const selector = cssPath(el);
      const round = (v) => Math.round(v * 10000) / 10000;
      return {
        selector,
        nth: Math.max(0, [...document.querySelectorAll(selector)].indexOf(el)),
        tag: el.localName,
        text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        box: {
          fx: round((rect.x - box.left) / box.width),
          fy: round((rect.y - box.top) / box.height),
          fw: round(rect.w / box.width),
          fh: round(rect.h / box.height),
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Returns the page element under a viewport point, skipping our own overlay without hiding it.
   * @param {number} x Viewport x of the point.
   * @param {number} y Viewport y of the point.
   */
  function elementAt(x, y) {
    return document.elementsFromPoint(x, y).find((el) => el !== host) ?? null;
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

  /**
   * Sizes and shows an outline element over a region.
   * @param {HTMLElement} el The outline.
   * @param {{x:number,y:number,w:number,h:number}} rect The region in viewport pixels.
   */
  function place(el, rect) {
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    el.hidden = false;
  }

  /** Removes the toast on screen, if any. */
  function clearToast() {
    clearTimeout(state.toast?.timer);
    state.toast?.node.remove();
    state.toast = null;
  }

  /**
   * Shows a short message above the hint bar.
   * @param {string} text The message.
   * @param {number} [ms] How long it stays.
   */
  function toast(text, ms = 1600) {
    clearToast();
    const node = document.createElement('div');
    node.className = 'toast plain';
    node.setAttribute('role', 'status');
    node.textContent = text;
    root.append(node);
    state.toast = { node, timer: setTimeout(clearToast, ms) };
  }

  /**
   * Confirms a saved comment where its card was, with Undo to reopen the draft and a link to the report.
   * @param {{number: number, box: DOMRect}} saved The comment number and the card's last position.
   */
  function savedToast(saved) {
    clearToast();
    const node = document.createElement('div');
    node.className = 'toast saved-toast';
    node.setAttribute('role', 'status');
    node.innerHTML = `
      <b class="flag">${pad(saved.number)}</b><span>Comment ${pad(saved.number)} saved</span>
      <span class="actions"><button type="button" class="btn" data-undo>Undo</button><button type="button" class="btn" data-open>Open report</button></span>
    `;
    stopPresses(node);
    node.querySelector('[data-undo]').addEventListener('click', undoSave);
    node.querySelector('[data-open]').addEventListener('click', () => {
      clearToast();
      chrome.runtime.sendMessage({ type: 'openReport' }).catch(() => {});
    });
    root.append(node);
    const left = Math.min(Math.max(EDGE, saved.box.left + 12), innerWidth - node.offsetWidth - EDGE);
    node.style.left = `${left}px`;
    node.style.top = `${Math.min(saved.box.bottom, innerHeight - HINT_SPACE) - node.offsetHeight}px`;
    state.toast = { node, timer: setTimeout(clearToast, 5000) };
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  /** Splits pasted reference links on whitespace or commas, keeping real URLs. */
  function parseLinks(value) {
    return value
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter((part) => /^https?:\/\//i.test(part));
  }

  /**
   * The link to a Figma frame, which the Post to Figma flow reads back as a file key and node id.
   * @param {{fileKey: string, nodeId: string}} frame The frame.
   */
  function frameUrl(frame) {
    return `https://www.figma.com/design/${frame.fileKey}/?node-id=${frame.nodeId.replace(/:/g, '-')}`;
  }

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

  /**
   * Asks the background to capture comments again at mobile, tablet and desktop widths, then reports how it went.
   * @param {{ ids?: string[], page?: boolean }} which The comments to capture, or every comment on this page.
   */
  async function captureWidths(which) {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'captureWidths', ...which });
    } catch (err) {
      res = { error: String(err.message ?? err) };
    }
    toast(res?.error ?? res?.message ?? 'Widths captured', 4200);
    return res;
  }

  /** Closes the right-click menu and the element outline it drew. */
  function closeMenu() {
    if (state.menu && !state.selectors) hoverBox.hidden = true;
    state.menu?.remove();
    state.menu = null;
  }

  /**
   * Opens the right-click menu of annotation actions at a point, outlining the element under it.
   * @param {number} x Viewport x of the click.
   * @param {number} y Viewport y of the click.
   */
  function openMenu(x, y) {
    closeMenu();
    const target = elementAt(x, y)?.getBoundingClientRect();
    if (target) place(hoverBox, { x: target.left, y: target.top, w: target.width, h: target.height });
    const items = [
      ['Comment on this element', () => captureElementAt(x, y)],
      ['Comment on the whole visible area', captureViewport],
      ['Capture comments on this page at three widths', () => captureWidths({ page: true })],
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
    stopPresses(menu);
    menu.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    root.append(menu);
    let top = y + 8;
    const fitsBelow = target && target.height < innerHeight / 3 && target.bottom + 6 + menu.offsetHeight <= innerHeight - EDGE;
    if (fitsBelow) top = target.bottom + 6;
    menu.style.left = `${Math.max(EDGE, Math.min(x + 6, window.innerWidth - menu.offsetWidth - EDGE))}px`;
    menu.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - menu.offsetHeight - EDGE))}px`;
    state.menu = menu;
    menu.querySelector('button').focus();
  }

  /**
   * Moves keyboard focus through a menu's items.
   * @param {HTMLElement} menu The menu.
   * @param {number} step 1 for down, -1 for up.
   */
  function stepMenu(menu, step) {
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const at = items.indexOf(shadow.activeElement);
    items[(at + step + items.length) % items.length]?.focus();
  }

  /** Opens the annotation menu on right-click, unless a comment is being written or dragged. */
  function onContext(e) {
    e.preventDefault();
    if (state.panel || state.drag) return;
    openMenu(e.clientX, e.clientY);
  }

  /**
   * Asks the background to screenshot a region and store it as a draft comment, with the overlay hidden for the shot.
   * @param {object} msg The capture message.
   */
  async function takeShot(msg) {
    band.hidden = true;
    hoverBox.hidden = true;
    hideTip();
    root.classList.add('capturing');
    await nextFrame();
    await new Promise((r) => setTimeout(r, 60));
    let res;
    try {
      res = await chrome.runtime.sendMessage(msg);
    } catch (err) {
      res = { error: String(err.message ?? err) };
    }
    root.classList.remove('capturing');
    return res?.id ? res : { error: res?.error ?? 'Screenshot failed' };
  }

  /**
   * Captures a region and opens the comment card beside it. A failed capture still opens the card, with the error and Try again.
   * A pending redraw carries its draft into the new card and drops the old capture once the new one is stored.
   * @param {{x:number,y:number,w:number,h:number}} rect The region in viewport pixels.
   * @param {object | null} [element] The element description when selector capture applies.
   */
  async function capture(rect, element = elementFor(rect)) {
    const msg = {
      type: 'capture',
      rect,
      element,
      anchor: anchorFor(rect),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollY: Math.round(window.scrollY),
        dpr: window.devicePixelRatio,
      },
    };
    const res = await takeShot(msg);
    const pending = state.pending;
    state.pending = null;
    if (pending?.old.id && res.id) chrome.runtime.sendMessage({ type: 'discard', id: pending.old.id }).catch(() => {});
    if (res.id) await refreshReview();
    openPanel({ id: res.id ?? null, rect, element, msg, error: res.error, draft: pending?.draft });
  }

  /**
   * Turns a capture error into the heading and advice the card shows.
   * @param {string} error The error from the background.
   */
  function errorCopy(error) {
    if (/permission|activeTab|all_urls|cannot be scripted|not allowed/i.test(error)) {
      return ['Chrome blocked the screenshot.', 'Click the Margin icon in the Chrome toolbar once, then try again. Your draft is kept.'];
    }
    return ['The screenshot failed.', `${error.replace(/\.$/, '')}. Your draft is kept.`];
  }

  /**
   * Opens the comment card beside a region, never over it, with the region kept highlighted.
   * @param {object} opts What the card is for.
   * @param {string | null} opts.id The stored draft comment, or null when the capture failed.
   * @param {{x:number,y:number,w:number,h:number}} opts.rect The region in viewport pixels.
   * @param {object | null} opts.element The element description, if any.
   * @param {object} [opts.msg] The capture message, kept for Try again and for saving without a screenshot.
   * @param {string} [opts.error] The capture error, which opens the card in its error state.
   * @param {object} [opts.draft] Fields to start from, after a redraw or an undo.
   * @param {number} [opts.number] The comment number, when reopening a saved comment.
   * @param {boolean} [opts.reopened] True when the card reopens a comment that was already saved.
   * @param {boolean} [opts.hasShot] False for a comment saved without a screenshot.
   */
  function openPanel({ id, rect, element, msg = null, error, draft = {}, number, reopened = false, hasShot = Boolean(id) }) {
    closePanel(false);
    closeMenu();
    clearToast();
    const n = number ?? state.comments.find((c) => c.id === id)?.n ?? state.total + 1;
    const files = state.review?.figma;
    const linkLabel = files?.frames?.length ? 'Frame' : 'Figma link';
    const node = document.createElement('div');
    node.className = 'panel';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', `New comment ${pad(n)}`);
    node.innerHTML = `
      <div class="panel-head">
        <b class="flag draft">${pad(n)}</b><h2>New comment</h2><span class="spacer"></span>
        <button type="button" class="chip" data-redraw title="Drag a new area and keep this draft, key R">Redraw</button>
        <button type="button" class="chip square" data-more aria-label="More actions" aria-haspopup="menu"><i class="icon i-more"></i></button>
      </div>
      <div class="error" data-error hidden>
        <span class="head"><i class="icon i-alert"></i><span data-error-head></span></span>
        <p data-error-body></p>
        <button type="button" class="btn primary" data-retry>Try again</button>
      </div>
      <div class="panel-body">
        <div class="field">
          <input type="text" data-title placeholder="What is wrong" aria-label="What is wrong" />
          <span class="field-hint" data-title-hint>Add a title to save</span>
        </div>
        <div class="seg" role="group" aria-label="Severity">
          ${SEVERITIES.map((s, i) => `<button type="button" data-sev="${s.key}" aria-pressed="false" title="${s.label}, key ${i + 1}"><i class="icon i-check"></i>${s.label}</button>`).join('')}
        </div>
        <textarea data-note placeholder="What you expected, what happened" aria-label="Note" hidden></textarea>
        <div class="marks" data-marks hidden></div>
        <div class="place-hint" data-place hidden></div>
        <div class="frame-row" data-frame hidden></div>
        <div class="link-row" data-link-row hidden>
          <input type="text" data-links placeholder="Paste a Figma link" aria-label="Figma link" />
          <button type="button" class="remove" data-link-remove aria-label="Remove the Figma link"><i class="icon i-close"></i></button>
        </div>
        <div class="picker" data-picker hidden>
          <input type="text" data-search placeholder="Search frames in ${esc(files?.name ?? 'Figma')}" aria-label="Search frames" />
          <div class="picker-list" data-picker-list role="listbox" aria-label="Frames"></div>
        </div>
        <div class="quiet">
          <button type="button" class="chip" data-add-note><i class="icon i-plus"></i>Add note</button>
          <button type="button" class="chip" data-add-marker><i class="icon i-plus"></i>Add marker</button>
          <button type="button" class="chip" data-add-frame aria-expanded="false"><i class="icon i-link"></i>${linkLabel}</button>
        </div>
      </div>
      <div class="panel-foot" data-foot></div>
    `;
    const tail = document.createElement('i');
    tail.className = 'tail';
    const flag = document.createElement('b');
    flag.className = 'flag draft';
    flag.textContent = pad(n);
    root.append(flag, node, tail);
    place(band, rect);
    placeFlag(flag, rect);

    const p = {
      id,
      rect,
      element,
      msg,
      node,
      tail,
      flag,
      number: n,
      reopened,
      hasShot,
      hadFrame: Boolean(draft.frame),
      error: error ?? null,
      severity: draft.severity ?? 'major',
      marks: (draft.marks ?? []).map((m) => ({ ...m })),
      frame: draft.frame ?? null,
      placing: false,
      asking: false,
      picker: null,
      saving: false,
      more: null,
    };
    state.panel = p;
    const q = (sel) => node.querySelector(sel);
    p.title = q('[data-title]');
    p.note = q('[data-note]');
    p.links = q('[data-links]');
    p.title.value = draft.title ?? '';
    p.note.value = draft.note ?? '';
    p.note.hidden = !draft.note;
    p.links.value = draft.link ?? '';
    q('[data-link-row]').hidden = !draft.link;

    for (const button of node.querySelectorAll('.seg button')) button.addEventListener('click', () => setSeverity(button.dataset.sev));
    p.title.addEventListener('input', refreshSave);
    p.note.addEventListener('input', () => {
      fitNote();
      refreshSave();
    });
    q('[data-add-note]').addEventListener('click', () => {
      p.note.hidden = false;
      p.note.focus();
      paintQuiet();
    });
    q('[data-add-marker]').addEventListener('click', () => {
      p.placing = true;
      paintMarks();
    });
    q('[data-add-frame]').addEventListener('click', () => {
      if (files?.frames?.length) togglePicker();
      else {
        q('[data-link-row]').hidden = false;
        p.links.focus();
        paintQuiet();
      }
    });
    q('[data-link-remove]').addEventListener('click', () => {
      p.links.value = '';
      q('[data-link-row]').hidden = true;
      paintQuiet();
    });
    q('[data-search]').addEventListener('input', () => {
      p.picker.active = 0;
      paintPicker();
    });
    q('[data-search]').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      p.picker.active += e.key === 'ArrowDown' ? 1 : -1;
      paintPicker();
    });
    q('[data-retry]').addEventListener('click', retry);
    q('[data-redraw]').addEventListener('click', redraw);
    q('[data-more]').addEventListener('click', toggleMore);
    node.addEventListener('keydown', onPanelKey);
    stopPresses(node);

    setSeverity(p.severity);
    fitNote();
    paintMarks();
    paintFrame();
    paintFoot();
    placePanel();
    p.observer = new ResizeObserver(placeTail);
    p.observer.observe(node);
    paintCount();
    paintSaved();
    p.title.focus();
  }

  /**
   * Handles Enter inside the card: it saves from the title and marker fields, adds a line in the note unless Ctrl is held,
   * picks the highlighted frame in the frame search, and retries a failed capture.
   * @param {KeyboardEvent} e The key press.
   */
  function onPanelKey(e) {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const p = state.panel;
    const target = shadow.activeElement;
    if (target?.hasAttribute('data-search')) {
      e.preventDefault();
      pickFrame(p.picker.visible[p.picker.active]);
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (target?.localName === 'textarea' && !ctrl) return;
    if (target?.localName !== 'input' && target?.localName !== 'textarea' && !ctrl) return;
    e.preventDefault();
    if (p.error) retry();
    else save();
  }

  /**
   * Picks a severity in the card.
   * @param {string} key blocker, major, minor or nit.
   */
  function setSeverity(key) {
    const p = state.panel;
    if (!p) return;
    p.severity = key;
    for (const button of p.node.querySelectorAll('.seg button')) button.setAttribute('aria-pressed', String(button.dataset.sev === key));
  }

  /** Grows the note field with its text, from three lines up to its maximum height. */
  function fitNote() {
    const { note } = state.panel;
    if (note.hidden) return;
    note.style.height = '';
    note.style.height = `${note.scrollHeight + 2}px`;
  }

  /** True when the card holds a title or a note, the least a comment needs to be saved. */
  function filled() {
    const p = state.panel;
    return Boolean(p && (p.title.value.trim() || p.note.value.trim()));
  }

  /** True when discarding would lose anything typed or placed. */
  function hasWork() {
    const p = state.panel;
    return Boolean(filled() || p.marks.length || p.frame || p.links.value.trim());
  }

  /** Enables Save once there is a title or note, and shows why while there is not. */
  function refreshSave() {
    const p = state.panel;
    if (!p) return;
    const ok = filled();
    p.node.querySelector('[data-title-hint]').hidden = ok;
    const save = p.node.querySelector('[data-save]');
    if (save) {
      save.disabled = !ok;
      save.title = ok ? '' : 'Add a title or a note first';
    }
  }

  /** Shows only the quiet actions that still have something to add. */
  function paintQuiet() {
    const p = state.panel;
    const q = (sel) => p.node.querySelector(sel);
    q('[data-add-note]').hidden = !p.note.hidden;
    q('[data-add-marker]').hidden = p.placing;
    const frameBtn = q('[data-add-frame]');
    frameBtn.hidden = Boolean(p.frame) || !q('[data-link-row]').hidden;
    frameBtn.setAttribute('aria-expanded', String(Boolean(p.picker)));
  }

  /** Draws the footer for the card's state: editing, asking before a discard, or a failed capture. */
  function paintFoot() {
    const p = state.panel;
    const foot = p.node.querySelector('[data-foot]');
    p.node.querySelector('[data-error]').hidden = !p.error;
    if (p.error) {
      const [head, body] = errorCopy(p.error);
      p.node.querySelector('[data-error-head]').textContent = head;
      p.node.querySelector('[data-error-body]').textContent = body;
    }
    foot.className = `panel-foot${p.asking ? ' ask' : ''}`;
    if (p.asking) {
      const parts = [p.note.value.trim() && 'its note', p.marks.length && `${p.marks.length} ${p.marks.length === 1 ? 'marker' : 'markers'}`].filter(Boolean);
      foot.innerHTML = `
        <span class="ask-q">Discard comment ${pad(p.number)}${parts.length ? `, ${parts.join(' and ')}` : ''}?</span>
        <span class="ask-row"><span class="save-hint">Esc again keeps it</span><span class="spacer"></span>
          <button type="button" class="btn danger" data-confirm>Discard</button>
          <button type="button" class="btn primary" data-keep>Keep editing</button></span>
      `;
      foot.querySelector('[data-confirm]').addEventListener('click', () => closePanel(true));
      foot.querySelector('[data-keep]').addEventListener('click', keepEditing);
      foot.querySelector('[data-keep]').focus();
      return;
    }
    foot.innerHTML = p.error
      ? `<button type="button" class="btn" data-cancel>Discard</button><span class="spacer"></span>
         <button type="button" class="btn secondary" data-no-shot>Save without screenshot</button>`
      : `<button type="button" class="btn" data-cancel>Discard</button><span class="spacer"></span>
         <span class="save-hint">Enter to save</span><button type="button" class="btn primary" data-save>Save comment</button>`;
    foot.querySelector('[data-cancel]').addEventListener('click', askDiscard);
    foot.querySelector('[data-save]')?.addEventListener('click', save);
    foot.querySelector('[data-no-shot]')?.addEventListener('click', saveWithoutShot);
    refreshSave();
  }

  /** Discards an untouched draft at once, or asks in place of the footer when something would be lost. */
  function askDiscard() {
    const p = state.panel;
    if (!p) return;
    if (!hasWork()) {
      closePanel(true);
      return;
    }
    p.asking = true;
    paintFoot();
  }

  /** Closes the discard question and goes back to the title. */
  function keepEditing() {
    const p = state.panel;
    p.asking = false;
    paintFoot();
    p.title.focus();
  }

  /** Steps back one level on Esc: the More menu, the frame list, marker placing, the discard question, then the draft. */
  function escapePanel() {
    const p = state.panel;
    if (p.more) closeMore();
    else if (p.picker) togglePicker();
    else if (p.placing) {
      p.placing = false;
      paintMarks();
    } else if (p.asking) keepEditing();
    else askDiscard();
  }

  /**
   * Places the card once, when it opens: right of the area, then left, below and above, 12px from the area and clear of the hint bar.
   * In the top half of the viewport it grows down from its top edge. In the bottom half its footer stays put and it grows up.
   */
  function placePanel() {
    const p = state.panel;
    const { node, rect: r } = p;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const floor = vh - HINT_SPACE;
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const clampX = (x) => Math.min(Math.max(EDGE, x), vw - w - EDGE);
    const right = r.x + r.w + GAP;
    const left = r.x - GAP - w;
    let side;
    if (right + w <= vw - EDGE) side = 'right';
    else if (left >= EDGE) side = 'left';
    else if (r.y + r.h + GAP + h <= floor) side = 'below';
    else if (r.y - GAP - h >= EDGE) side = 'above';
    else side = 'inside';
    p.side = side;
    const anchorTop = (top) => {
      const at = Math.min(Math.max(EDGE, top), Math.max(EDGE, floor - h));
      node.style.top = `${at}px`;
      node.style.maxHeight = `${floor - at}px`;
    };
    const anchorBottom = (bottom) => {
      const at = Math.min(floor, Math.max(bottom, h + EDGE));
      node.style.bottom = `${vh - at}px`;
      node.style.maxHeight = `${at - EDGE}px`;
    };
    if (side === 'right' || side === 'left') {
      node.style.left = `${side === 'right' ? right : left}px`;
      if (r.y + r.h / 2 < vh / 2) anchorTop(r.y);
      else anchorBottom(Math.min(r.y + r.h, floor));
    } else if (side === 'below') {
      node.style.left = `${clampX(r.x)}px`;
      anchorTop(r.y + r.h + GAP);
    } else if (side === 'above') {
      node.style.left = `${clampX(r.x)}px`;
      anchorBottom(r.y - GAP);
    } else {
      node.style.left = `${vw - w - 16}px`;
      anchorBottom(floor);
    }
    placeTail();
  }

  /** Points the small tail on the card's edge at the middle of the area. */
  function placeTail() {
    const p = state.panel;
    if (!p) return;
    const box = p.node.getBoundingClientRect();
    const r = p.rect;
    const { tail } = p;
    tail.hidden = p.side === 'inside';
    if (tail.hidden) return;
    const cy = Math.min(Math.max(r.y + r.h / 2, box.top + 16), box.bottom - 16);
    const cx = Math.min(Math.max(r.x + r.w / 2, box.left + 16), box.right - 16);
    const spots = {
      left: { left: box.right, top: cy - 7, turn: 'none' },
      right: { left: box.left - 8, top: cy - 7, turn: 'scaleX(-1)' },
      below: { left: cx - 4, top: box.top - 11, turn: 'rotate(-90deg)' },
      above: { left: cx - 4, top: box.bottom - 3, turn: 'rotate(90deg)' },
    };
    const spot = spots[p.side];
    tail.style.left = `${spot.left}px`;
    tail.style.top = `${spot.top}px`;
    tail.style.transform = spot.turn;
  }

  /** Redraws the numbered pins on the page, their note rows in the card and the placing hint. */
  function paintMarks() {
    const p = state.panel;
    root.querySelectorAll(':scope > .pin').forEach((pin) => pin.remove());
    p.marks.forEach((m, i) => {
      const pin = Object.assign(document.createElement('b'), { className: 'pin', textContent: String(i + 1) });
      pin.style.left = `${m.x}px`;
      pin.style.top = `${m.y}px`;
      pin.title = 'Right-click to remove';
      pin.addEventListener('mousedown', (e) => e.stopPropagation());
      pin.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeMark(i);
      });
      root.append(pin);
    });
    const list = p.node.querySelector('[data-marks]');
    list.hidden = !p.marks.length;
    list.replaceChildren(
      ...p.marks.map((m, i) => {
        const row = Object.assign(document.createElement('div'), { className: 'mrow' });
        row.innerHTML = `<b class="pin">${i + 1}</b><input type="text" placeholder="What marker ${i + 1} points out" aria-label="Note for marker ${i + 1}" />
          <button type="button" class="remove" aria-label="Remove marker ${i + 1}"><i class="icon i-close"></i></button>`;
        const input = row.querySelector('input');
        input.value = m.note;
        input.addEventListener('input', () => (m.note = input.value));
        row.querySelector('.remove').addEventListener('click', () => removeMark(i));
        return row;
      }),
    );
    const placeHint = p.node.querySelector('[data-place]');
    placeHint.hidden = !p.placing;
    placeHint.innerHTML = `<b class="pin ghost">${p.marks.length + 1}</b>Click inside the area to place marker ${p.marks.length + 1}`;
    paintQuiet();
  }

  /**
   * Removes one numbered marker and renumbers the rest.
   * @param {number} index The marker's position.
   */
  function removeMark(index) {
    state.panel.marks.splice(index, 1);
    paintMarks();
  }

  /**
   * Drops the next numbered marker at a point inside the area and focuses its note.
   * @param {number} x Viewport x of the click.
   * @param {number} y Viewport y of the click.
   */
  function addMark(x, y) {
    const p = state.panel;
    p.marks.push({ x: Math.round(x), y: Math.round(y), note: '' });
    p.placing = false;
    paintMarks();
    p.node.querySelector('.mrow:last-child input')?.focus();
  }

  /** Draws the linked Figma frame row, or hides it when no frame is picked. */
  function paintFrame() {
    const p = state.panel;
    const row = p.node.querySelector('[data-frame]');
    row.hidden = !p.frame;
    if (p.frame) {
      const file = state.review?.figma?.name;
      row.innerHTML = `
        <span class="text"><span class="label">Frame</span><b>${esc(p.frame.name)}</b>
          <span class="meta">${esc([p.frame.page, file].filter(Boolean).join(' in '))}</span></span>
        <button type="button" class="remove" aria-label="Remove the frame"><i class="icon i-close"></i></button>
      `;
      row.querySelector('.remove').addEventListener('click', () => {
        p.frame = null;
        paintFrame();
      });
    }
    paintQuiet();
  }

  /**
   * Scores how well a Figma page name matches this page's address and title, so the likeliest page opens first.
   * @param {string} page The Figma page name.
   */
  function pageScore(page) {
    const words = `${location.pathname} ${document.title}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const name = page.toLowerCase();
    const home = location.pathname.replace(/\/+$/, '') === '' && /home|landing|index/.test(name) ? 2 : 0;
    return home + words.filter((w) => name.includes(w)).length;
  }

  /** Opens or closes the list of frames in the review's Figma file. */
  function togglePicker() {
    const p = state.panel;
    const box = p.node.querySelector('[data-picker]');
    if (p.picker) {
      p.picker = null;
      box.hidden = true;
      paintQuiet();
      p.node.querySelector('[data-add-frame]').focus();
      return;
    }
    const pages = [...new Set(state.review.figma.frames.map((f) => f.page ?? ''))];
    const best = pages.reduce((a, b) => (pageScore(b) > pageScore(a) ? b : a), pages[0]);
    p.picker = { page: best, active: 0, visible: [] };
    box.hidden = false;
    box.querySelector('[data-search]').value = '';
    paintPicker();
    paintQuiet();
    box.querySelector('[data-search]').focus();
  }

  /** Lists the frames of the open page, or every frame that matches the search, grouped by page. */
  function paintPicker() {
    const p = state.panel;
    const list = p.node.querySelector('[data-picker-list]');
    const query = p.node.querySelector('[data-search]').value.trim().toLowerCase();
    const frames = state.review.figma.frames;
    const pages = [...new Set(frames.map((f) => f.page ?? ''))];
    const shown = query ? pages : [p.picker.page];
    p.picker.visible = frames.filter((f) => shown.includes(f.page ?? '') && (!query || f.name.toLowerCase().includes(query)));
    const count = p.picker.visible.length;
    p.picker.active = count ? ((p.picker.active % count) + count) % count : 0;
    const parts = [];
    for (const page of pages) {
      const inPage = frames.filter((f) => (f.page ?? '') === page);
      const visible = p.picker.visible.filter((f) => (f.page ?? '') === page);
      if (visible.length) {
        parts.push(`<span class="picker-page">${esc(page || 'Frames')}</span>`);
        for (const f of visible) {
          const i = p.picker.visible.indexOf(f);
          const picked = p.frame?.nodeId === f.id;
          parts.push(`<button type="button" class="picker-row${i === p.picker.active ? ' active' : ''}" role="option" aria-selected="${picked}" data-i="${i}"><span>${esc(f.name)}</span><i class="icon i-check"></i></button>`);
        }
      } else if (!query) {
        parts.push(`<button type="button" class="picker-more" data-page="${esc(page)}">${esc(page || 'Other frames')}, ${inPage.length} ${inPage.length === 1 ? 'frame' : 'frames'}</button>`);
      }
    }
    list.innerHTML = parts.join('') || '<span class="picker-empty">No frames match</span>';
    for (const row of list.querySelectorAll('[data-i]')) row.addEventListener('click', () => pickFrame(p.picker.visible[Number(row.dataset.i)]));
    for (const more of list.querySelectorAll('[data-page]')) {
      more.addEventListener('click', () => {
        p.picker.page = more.dataset.page;
        p.picker.active = 0;
        paintPicker();
      });
    }
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * Links a frame from the review's Figma file to the comment and closes the list.
   * @param {{id: string, name: string, page: string} | undefined} frame The picked frame.
   */
  function pickFrame(frame) {
    const p = state.panel;
    if (!frame) return;
    const file = state.review.figma;
    p.frame = { fileKey: file.fileKey, nodeId: frame.id, name: frame.name, page: frame.page ?? '' };
    togglePicker();
    paintFrame();
    p.title.focus();
  }

  /** Opens or closes the card's More menu, which holds the capture at three widths. */
  function toggleMore() {
    const p = state.panel;
    if (p.more) {
      closeMore();
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'more-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `<button type="button" role="menuitem" data-widths${p.id && p.hasShot ? '' : ' disabled'}>Capture at mobile, tablet and desktop widths</button>`;
    stopPresses(menu);
    menu.addEventListener('keydown', (e) => e.stopPropagation());
    const widths = menu.querySelector('[data-widths]');
    widths.addEventListener('click', async () => {
      widths.disabled = true;
      widths.textContent = 'Capturing';
      const res = await captureWidths({ ids: [p.id] });
      widths.textContent = res?.error ? 'Capture failed' : 'Widths saved';
      setTimeout(closeMore, 900);
    });
    root.append(menu);
    const at = p.node.querySelector('[data-more]').getBoundingClientRect();
    menu.style.left = `${Math.max(EDGE, at.right - menu.offsetWidth)}px`;
    menu.style.top = `${at.bottom + 4}px`;
    p.more = menu;
    widths.focus();
  }

  /** Closes the card's More menu. */
  function closeMore() {
    state.panel?.more?.remove();
    if (state.panel) state.panel.more = null;
  }

  /** Reads the card's fields, so a redraw or an undo can bring them back. */
  function readDraft() {
    const p = state.panel;
    return {
      title: p.title.value,
      note: p.note.value,
      severity: p.severity,
      marks: p.marks.map((m) => ({ ...m })),
      frame: p.frame,
      link: p.links.value,
    };
  }

  /** Captures the area again after a failed screenshot, keeping everything typed in the card. */
  async function retry() {
    const p = state.panel;
    if (!p?.msg || p.retrying) return;
    p.retrying = true;
    const res = await takeShot(p.msg);
    p.retrying = false;
    if (state.panel !== p) return;
    place(band, p.rect);
    if (res.id) {
      p.id = res.id;
      p.hasShot = true;
      p.error = null;
      await refreshReview();
    } else p.error = res.error;
    paintFoot();
    p.title.focus();
  }

  /** Stores the comment without a screenshot when Chrome keeps refusing one, then saves it. */
  async function saveWithoutShot() {
    const p = state.panel;
    if (!p?.msg || !filled()) {
      p?.title.focus();
      return;
    }
    let res;
    try {
      res = await chrome.runtime.sendMessage({ ...p.msg, skipShot: true });
    } catch (err) {
      res = { error: String(err.message ?? err) };
    }
    if (!res?.id) {
      toast(res?.error ?? 'Could not save the comment', 4200);
      return;
    }
    Object.assign(p, { id: res.id, hasShot: false, error: null });
    await save();
  }

  /**
   * Closes the card and waits for a new area, keeping the draft. The old capture stays until the new one is stored,
   * so Esc brings the card back as it was.
   */
  function redraw() {
    const p = state.panel;
    if (!p) return;
    const draft = { ...readDraft(), marks: [] };
    state.pending = { draft, old: { id: p.id, rect: p.rect, element: p.element, msg: p.msg, error: p.error, number: p.number, reopened: p.reopened, hasShot: p.hasShot, draft: readDraft() } };
    closePanel(false);
    toast('Drag over the new area. Esc keeps the old one.', 4200);
  }

  /** Brings back the card a redraw left, with its old area and fields. */
  function cancelRedraw() {
    const { old } = state.pending;
    state.pending = null;
    clearToast();
    openPanel({ ...old });
  }

  /** Saves the card's fields to the draft comment, with markers drawn into its images, then shows the saved toast. */
  async function save() {
    const p = state.panel;
    if (!p?.id || !filled() || p.saving) return;
    p.saving = true;
    const draft = readDraft();
    const note = draft.note.trim();
    const marks = draft.marks.map((m) => ({ kind: 'dot', x: m.x, y: m.y, note: m.note.trim() })).filter((m) => m.note);
    const links = [...new Set([...parseLinks(draft.link), ...(draft.frame ? [frameUrl(draft.frame)] : [])])];
    const patch = {
      severity: draft.severity,
      title: draft.title.trim() || note.split('\n')[0].slice(0, 80),
      note,
      links,
    };
    if (draft.frame) patch.figmaFrame = { ...draft.frame };
    else if (p.hadFrame) patch.figmaFrame = null;
    if (!p.hasShot) patch.marks = marks;
    try {
      await chrome.runtime.sendMessage({ type: 'update', id: p.id, patch });
      if (p.hasShot && (marks.length || p.reopened)) await chrome.runtime.sendMessage({ type: 'annotate', id: p.id, marks });
    } catch (err) {
      p.saving = false;
      toast(`Could not save. ${String(err.message ?? err)}`, 4200);
      return;
    }
    const box = p.node.getBoundingClientRect();
    state.saved = { id: p.id, rect: p.rect, element: p.element, msg: p.msg, number: p.number, hasShot: p.hasShot, draft, box };
    closePanel(false);
    await refreshReview();
    savedToast(state.saved);
  }

  /** Reopens the comment just saved, with its fields as they were, and hides its flag while it is edited. */
  function undoSave() {
    const saved = state.saved;
    clearToast();
    if (!saved) return;
    state.saved = null;
    openPanel({ ...saved, reopened: true });
  }

  /**
   * Closes the comment card. When `discard` is true the draft comment is deleted.
   * @param {boolean} discard Whether to delete the stored draft.
   */
  function closePanel(discard) {
    const p = state.panel;
    if (!p) return;
    state.panel = null;
    closeMore();
    p.observer?.disconnect();
    p.node.remove();
    p.tail.remove();
    p.flag.remove();
    root.querySelectorAll(':scope > .pin').forEach((pin) => pin.remove());
    band.hidden = true;
    if (discard && p.id) {
      chrome.runtime
        .sendMessage({ type: 'discard', id: p.id })
        .catch(() => {})
        .then(refreshReview);
    }
    paintCount();
    paintSaved();
  }

  /** Follows the pointer with the drag band, or with the element outline when selector capture is on. */
  function onMove(e) {
    if (state.drag) {
      const x = Math.min(e.clientX, state.drag.x);
      const y = Math.min(e.clientY, state.drag.y);
      place(band, { x, y, w: Math.abs(e.clientX - state.drag.x), h: Math.abs(e.clientY - state.drag.y) });
      return;
    }
    if (state.panel || state.menu || !state.selectors) return;
    const el = elementAt(e.clientX, e.clientY);
    if (!el) {
      hoverBox.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    place(hoverBox, { x: r.left, y: r.top, w: r.width, h: r.height });
  }

  /** Starts a drag, or drops a marker when a card is open and the press lands inside its area. */
  function onDown(e) {
    if (state.menu) {
      e.preventDefault();
      if (e.button === 0) closeMenu();
      return;
    }
    if (e.button !== 0) return;
    if (state.panel) {
      const p = state.panel;
      closeMore();
      const r = p.rect;
      const inside = e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
      if (inside && (state.markers || p.placing)) {
        e.preventDefault();
        addMark(e.clientX, e.clientY);
      }
      return;
    }
    e.preventDefault();
    hideTip();
    state.drag = { x: e.clientX, y: e.clientY };
    hoverBox.hidden = true;
  }

  /** Finishes a drag and captures the area, or the element under the pointer for a click with selector capture on. */
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

  /** Keyboard shortcuts while annotating: S and M toggle modes, 1 to 4 and R act on the open card, arrows walk menus, Esc steps back. */
  function onKey(e) {
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    const key = e.key?.toLowerCase();
    const menu = state.menu ?? state.panel?.more;
    if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      e.stopPropagation();
      stepMenu(menu, e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (state.panel && plain && !isField(shadow.activeElement)) {
      if (/^[1-4]$/.test(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        setSeverity(SEVERITIES[Number(e.key) - 1].key);
        return;
      }
      if (key === 'r' && !state.panel.asking) {
        e.preventDefault();
        e.stopPropagation();
        redraw();
        return;
      }
    }
    if (plain && !state.panel && !state.menu && key === 's') {
      e.preventDefault();
      e.stopPropagation();
      setSelectors(!state.selectors);
      return;
    }
    if (plain && !state.panel && !state.menu && key === 'm') {
      e.preventDefault();
      e.stopPropagation();
      setMarkers(!state.markers);
      return;
    }
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    if (state.menu) closeMenu();
    else if (state.panel) escapePanel();
    else if (state.pending) cancelRedraw();
    else setActive(false);
  }

  /**
   * Starts or stops annotation mode on this page.
   * @param {boolean} next Whether annotation mode should be on.
   */
  function setActive(next) {
    if (state.active === next) return state.active;
    state.active = next;
    root.hidden = !next;
    if (next) {
      raise();
      loadFont();
      SHIELDED.forEach((type) => window.addEventListener(type, shield, true));
      LAYERED.forEach((type) => window.addEventListener(type, onLayer, true));
      window.addEventListener('mousemove', onStrayMove, true);
      root.addEventListener('mousemove', onMove);
      root.addEventListener('mousedown', onDown);
      root.addEventListener('mouseup', onUp);
      root.addEventListener('contextmenu', onContext);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      window.addEventListener('resize', onScroll);
      refreshReview();
    } else {
      closeMenu();
      closePanel(!state.panel?.reopened);
      if (state.pending?.old.id && !state.pending.old.reopened) chrome.runtime.sendMessage({ type: 'discard', id: state.pending.old.id }).catch(() => {});
      state.pending = null;
      state.saved = null;
      clearToast();
      hideTip();
      state.drag = null;
      band.hidden = true;
      hoverBox.hidden = true;
      layer.replaceChildren();
      SHIELDED.forEach((type) => window.removeEventListener(type, shield, true));
      LAYERED.forEach((type) => window.removeEventListener(type, onLayer, true));
      window.removeEventListener('mousemove', onStrayMove, true);
      hostWatch.disconnect();
      root.removeEventListener('mousemove', onMove);
      root.removeEventListener('mousedown', onDown);
      root.removeEventListener('mouseup', onUp);
      root.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      host.remove();
    }
    return state.active;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ping') sendResponse({ ok: true });
    else if (msg?.type === 'toggle') {
      if (msg.groupName) groupLabel.textContent = msg.groupName;
      sendResponse({ active: setActive(!state.active) });
    }
    else if (msg?.type === 'stop') sendResponse({ active: setActive(false) });
    else if (msg?.type === 'toast') {
      if (state.active) toast(msg.text, 4200);
      sendResponse({ ok: true });
    }
    else if (msg?.type === 'captureViewport') {
      if (msg.groupName) groupLabel.textContent = msg.groupName;
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
