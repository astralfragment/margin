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
  const SHOT_TIMEOUT = 10000;
  const FONT = 'Margin Manrope';
  const THEME_KEY = 'theme';
  const SELECTORS_KEY = 'selectorMode';
  const MARKERS_KEY = 'markerMode';
  const asset = (path) => `url("${chrome.runtime.getURL(path)}")`;
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const isField = (el) => el?.localName === 'input' || el?.localName === 'textarea';
  const isEditable = (el) => Boolean(el && (el.isContentEditable || ['input', 'textarea', 'select'].includes(el.localName)));

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
      --seg-track: var(--surface-3); --seg-edge: transparent; --saved-line: 1.5px;
      --shadow: 0 2px 8px 0 rgba(13, 10, 23, 0.14);
      --tail: ${asset('icons/ui/tail.svg')};
      position: fixed; inset: 0; z-index: 2147483647;
      cursor: crosshair; color: var(--fg);
      background: rgba(13, 10, 23, 0.12); box-shadow: inset 0 0 0 2px var(--ink);
      font-size: 14px; line-height: 20px; font-weight: 500; font-variant-numeric: tabular-nums;
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
      --seg-track: var(--surface-1); --seg-edge: var(--float-border); --saved-line: 2px;
      --tail: ${asset('icons/ui/tail-dark.svg')};
    }
    .root[hidden] { display: none; }
    .root.capturing { background: transparent; box-shadow: none; }
    .root.capturing > * { visibility: hidden; }
    .root.capturing { pointer-events: none; }
    .root.busy { cursor: progress; }
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
      font-size: 13px; line-height: 16px; font-weight: 600; color: var(--muted-fg);
      background: var(--surface-3); border: 1px solid var(--divider); border-radius: 4px;
    }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none;
      height: 32px; padding: 0 8px; border-radius: 6px; white-space: nowrap;
      font-size: 14px; line-height: 20px; font-weight: 600; color: var(--fg);
    }
    .btn:hover { background: var(--surface-3); }
    .btn.primary { padding: 0 12px; color: var(--primary-fg); background: var(--primary); }
    .btn.primary:hover { opacity: 0.88; }
    .btn.primary:disabled { color: var(--muted-fg); background: var(--surface-3); opacity: 1; cursor: not-allowed; }
    .btn.secondary { padding: 0 12px; background: var(--surface-1); border: 1px solid var(--input-border); }
    .btn.secondary:disabled { color: var(--muted-fg); border-color: var(--divider); cursor: not-allowed; }
    .btn.danger { color: var(--destructive); }
    .btn:focus-visible, .chip:focus-visible, .remove:focus-visible, .toggle:focus-visible, .ctx button:focus-visible,
    .picker-row:focus-visible, .picker-more:focus-visible, .saved .flag:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }

    .hover {
      position: fixed; pointer-events: none;
      border: 1.5px solid var(--ink); border-radius: 6px;
    }
    .hover.full::after, .hover.frame::after {
      content: "Fills the whole view"; position: absolute; left: 8px; top: 8px; padding: 1px 8px; border-radius: 4px;
      font-size: 13px; line-height: 18px; font-weight: 600; color: var(--on-ink); background: var(--ink);
    }
    .hover.frame::after { content: "Frame, drag to mark inside it"; }
    .band {
      position: fixed; pointer-events: none;
      border: 2px solid var(--ink); border-radius: 6px; box-shadow: inset 0 0 0 3px var(--on-ink);
    }
    .flag {
      position: fixed; display: inline-flex; align-items: center; height: 20px; padding: 0 6px;
      font-size: 13px; line-height: 16px; font-weight: 800; white-space: nowrap;
      color: var(--on-ink); background: var(--ink); border: 2px solid var(--on-ink);
      border-radius: 4px 4px 4px 0; cursor: default;
    }
    .flag.draft { color: var(--ink); background: var(--on-ink); border: 1.5px solid var(--ink); }
    .panel-head .flag, .toast .flag { position: static; }
    .saved { position: fixed; pointer-events: none; }
    .saved .halo, .saved .outline { position: absolute; inset: 0; border-radius: 6px; }
    .saved .halo { border: 4px solid var(--on-ink); }
    .saved .outline { border: var(--saved-line) dashed var(--ink); }
    .saved[data-status="fixed"] .outline { border-color: var(--fixed); }
    .saved[data-status="wontfix"] .outline { border-color: var(--muted-fg); }
    .saved.hot .outline { border-style: solid; }
    .saved .flag { position: absolute; left: 0; pointer-events: auto; cursor: pointer; }
    .pin {
      display: grid; place-items: center; flex: none; min-width: 22px; height: 22px; padding: 0 4px;
      font-size: 13px; line-height: 16px; font-weight: 800; color: var(--on-ink);
      background: var(--ink); border: 2px solid var(--on-ink); border-radius: 11px 11px 11px 3px;
    }
    .root > .pin { position: fixed; transform: translateY(-100%); cursor: context-menu; }
    .pin.ghost { opacity: 0.45; }

    .tip {
      position: fixed; display: grid; gap: 4px; max-width: 320px; padding: 8px 12px; pointer-events: none;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 6px; box-shadow: var(--shadow);
    }
    .tip b, .tip .note { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; overflow-wrap: anywhere; }
    .tip b { font-size: 14px; line-height: 20px; font-weight: 600; }
    .tip .note { font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    .tip .meta { display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 18px; }
    .tip .meta .status { margin-left: 2px; color: var(--muted-fg); }
    .tip .meta .status[data-status="fixed"] { color: var(--fixed); }
    .tip .where { font-size: 13px; line-height: 18px; color: var(--muted-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .hint {
      position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px; height: 40px; max-width: calc(var(--vw, 100vw) - 32px);
      padding: 4px 4px 4px 12px; overflow: hidden; white-space: nowrap; cursor: default;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 10px; box-shadow: var(--shadow);
    }
    .hint.top { top: 16px; bottom: auto; }
    .hint.top ~ .toast.plain { top: ${HINT_SPACE}px; bottom: auto; }
    .review { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .review .mark { flex: none; width: 16.7px; height: 14.4px; background: var(--ink); mask: ${asset('icons/ui/mark.svg')} center / contain no-repeat; }
    .review b { font-size: 14px; line-height: 20px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
    .review .count { font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    .hint .divider { flex: none; width: 1px; height: 20px; background: var(--divider); }
    .hint .gap { flex: none; width: 4px; }
    .toggle {
      display: flex; align-items: center; gap: 8px; flex: none; height: 32px; padding: 0 4px; border-radius: 6px;
      font-size: 13px; line-height: 18px; font-weight: 500;
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
    .pass { display: flex; align-items: center; gap: 6px; flex: none; font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    .root.passing .pass { color: var(--ink); }
    @media (max-width: 1023px) {
      .hint .pass, .hint .pass-divider, .hint [data-view] { display: none; }
    }
    @media (max-width: 640px) {
      .hint { gap: 8px; }
      .review b, .review .count, .hint kbd, .hint .gap, .hint .divider, .hint [data-report], .hint .pass { display: none; }
    }

    .panel {
      position: fixed; width: 360px; max-width: calc(var(--vw, 100vw) - 16px); display: flex; flex-direction: column;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 10px; box-shadow: var(--shadow);
      overflow: hidden; cursor: default;
    }
    .panel-head {
      display: flex; align-items: center; gap: 8px; flex: none; min-height: 45px; padding: 8px 12px;
      border-bottom: 1px solid var(--divider);
    }
    .panel.nudge { animation: nudge 0.3s ease-in-out; }
    @keyframes nudge { 25% { translate: -6px 0; } 75% { translate: 6px 0; } }
    @media (prefers-reduced-motion: reduce) { .panel.nudge { animation: none; } }
    .panel-head h2 { font-size: 16px; line-height: 22px; font-weight: 800; letter-spacing: -0.01em; white-space: nowrap; }
    .panel-head .spacer { flex: 1; }
    .chip {
      display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px; border-radius: 6px;
      font-size: 13px; line-height: 18px; font-weight: 600; white-space: nowrap;
    }
    .chip:hover { background: var(--surface-3); }
    .square { width: 28px; padding: 0; justify-content: center; }
    .error {
      display: grid; gap: 8px; flex: none; padding: 12px 12px 12px 13px;
      background: var(--destructive-tint); border-left: 3px solid var(--destructive);
    }
    .error p { font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    .error .head { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--fg); }
    .error .btn { justify-self: start; }
    .panel-body { display: flex; flex-direction: column; gap: 12px; min-height: 0; padding: 16px 12px; overflow: auto; }
    .field { display: grid; gap: 6px; }
    .field-hint { font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    input[type="text"], textarea {
      display: block; width: 100%; min-width: 0; height: 32px; padding: 0 12px;
      font-size: 14px; line-height: 20px; font-weight: 500; color: var(--fg);
      background: var(--surface-1); border: 1px solid var(--input-border); border-radius: 6px; outline: none;
    }
    textarea { height: 76px; min-height: 76px; max-height: 200px; padding: 7px 11px; resize: none; }
    textarea.line { height: 32px; min-height: 32px; max-height: 128px; padding: 5px 11px; overflow-y: auto; }
    [data-title] { font-size: 15px; }
    input[type="text"]:focus, textarea:focus { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
    ::placeholder { color: var(--muted-fg); opacity: 1; }
    .seg { display: flex; gap: 2px; padding: 2px; background: var(--seg-track); border-radius: 6px; box-shadow: inset 0 0 0 1px var(--seg-edge); }
    .seg button {
      display: flex; align-items: center; justify-content: center; gap: 4px; flex: 1; min-width: 0; height: 28px; border-radius: 4px;
      font-size: 13px; line-height: 18px; font-weight: 600;
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
    .place-hint { font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    .frame-row .text { display: grid; flex: 1; min-width: 0; }
    .frame-row .text span, .frame-row .text b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .frame-row .label { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--muted-fg); }
    .frame-row b { font-size: 14px; line-height: 20px; font-weight: 600; }
    .frame-row .meta { font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    .picker { display: grid; gap: 4px; padding: 8px; background: var(--surface-2); border-radius: 6px; }
    .picker-list { display: grid; gap: 4px; max-height: 232px; overflow: auto; }
    .picker-page { padding-top: 2px; font-size: 13px; line-height: 18px; font-weight: 600; color: var(--muted-fg); }
    .picker-row {
      display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 8px; border-radius: 6px; text-align: left;
      font-size: 14px; line-height: 20px; font-weight: 500;
    }
    .picker-row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .picker-row:hover, .picker-row.active { background: var(--surface-3); }
    .picker-row[aria-selected="true"] { background: var(--ink-tint); }
    .picker-row .icon { display: none; color: var(--ink); }
    .picker-row[aria-selected="true"] .icon { display: block; }
    .picker-more { justify-self: start; font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    .picker-more:hover { color: var(--fg); text-decoration: underline; }
    .picker-empty { padding: 4px; font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    .quiet { display: flex; align-items: center; gap: 2px; margin-left: -4px; }
    .quiet .chip { padding: 0 4px; }
    .quiet .chip[aria-expanded="true"] { color: var(--ink); background: var(--ink-tint); }
    .panel-foot {
      display: flex; align-items: center; gap: 8px; flex: none; padding: 12px; border-top: 1px solid var(--divider);
    }
    .panel-foot .spacer { flex: 1; }
    .save-hint { font-size: 13px; line-height: 18px; color: var(--muted-fg); white-space: nowrap; }
    .panel-foot.ask { flex-direction: column; align-items: stretch; }
    .ask-q { font-size: 14px; line-height: 20px; font-weight: 600; }
    .ask-row { display: flex; align-items: center; gap: 8px; }
    .tail { position: fixed; width: 8px; height: 14px; pointer-events: none; background: var(--tail) center / contain no-repeat; }
    .more-menu {
      position: fixed; display: grid; min-width: 220px; padding: 4px;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 10px; box-shadow: var(--shadow); cursor: default;
    }

    .ctx {
      position: fixed; width: 340px; max-width: calc(var(--vw, 100vw) - 16px); padding: 4px; display: grid;
      background: var(--float); border: 1px solid var(--float-border); border-radius: 10px;
      box-shadow: var(--shadow); cursor: default;
    }
    .ctx button, .more-menu button {
      height: 32px; padding: 0 10px; text-align: left; white-space: nowrap;
      font-size: 14px; line-height: 20px; font-weight: 500; color: var(--fg);
      border: 2px solid transparent; border-radius: 6px;
    }
    .ctx button:hover, .more-menu button:hover { background: var(--surface-3); }
    .ctx button:focus, .more-menu button:focus { background: var(--surface-3); border-color: var(--ink); outline: none; }
    .more-menu button:disabled { color: var(--muted-fg); cursor: default; }
    .more-menu .why { padding: 0 12px 6px; font-size: 13px; line-height: 18px; color: var(--muted-fg); }
    .ctx hr { height: 1px; margin: 4px 0; border: 0; background: var(--divider); }

    .toast {
      position: fixed; display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 4px 12px;
      font-size: 14px; line-height: 20px; font-weight: 600; white-space: nowrap; cursor: default;
      color: var(--primary-fg); background: var(--primary); border-radius: 10px; box-shadow: var(--shadow);
    }
    .toast.plain { left: 50%; bottom: ${HINT_SPACE}px; transform: translateX(-50%); max-width: calc(var(--vw, 100vw) - 32px); white-space: normal; }
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
      <b class="flag draft" data-saving hidden>Saving</b>
      <div class="hint" role="toolbar" aria-label="Margin annotation, Shift+F10 opens the actions menu">
        <span class="review"><i class="mark"></i><b data-group>Margin</b><span class="count" data-count></span></span>
        <span class="divider"></span>
        <button type="button" class="toggle" data-selectors aria-pressed="false"><span class="switch"></span><span>Selectors</span><kbd>S</kbd></button>
        <button type="button" class="toggle" data-markers aria-pressed="true"><span class="switch"></span><span>Markers</span><kbd>M</kbd></button>
        <span class="divider pass-divider"></span>
        <span class="pass">Hold <kbd>Alt</kbd> to use the page</span>
        <span class="gap"></span>
        <button type="button" class="btn" data-view title="Comment on the whole visible area">Visible area<kbd>V</kbd></button>
        <button type="button" class="btn" data-report>Open report</button>
        <button type="button" class="btn stop" data-stop><span>Stop</span><kbd>Esc</kbd></button>
      </div>
    </div>
  `;
  const root = shadow.querySelector('.root');
  const layer = shadow.querySelector('[data-layer]');
  const hoverBox = shadow.querySelector('.hover');
  const band = shadow.querySelector('.band');
  const savingFlag = shadow.querySelector('[data-saving]');
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
    escAt: 0,
    keyMenuAt: 0,
  };

  const SHIELDED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend'];
  const LAYERED = ['toggle', 'close', 'fullscreenchange', 'focusin'];
  const COPIED = ['clientX', 'clientY', 'screenX', 'screenY', 'button', 'buttons', 'detail', 'ctrlKey', 'shiftKey', 'altKey', 'metaKey', 'pointerId', 'pointerType', 'isPrimary'];

  /**
   * Keeps presses on the overlay away from the page, so its click-outside and blur handlers never fire.
   * The press is stopped at the window, then a copy that cannot leave the shadow root is replayed on the element under the pointer,
   * or on the focused element when the click came from the keyboard. A real press that reached the page instead went
   * through the overlay, so it is cancelled, the overlay is raised again, and the copy goes to the overlay root.
   * @param {Event} e A press event caught at the window during the capture phase.
   */
  function shield(e) {
    if (passing) return;
    if (e.target !== host) {
      if (!e.isTrusted || (e instanceof MouseEvent && (e.clientX >= root.clientWidth * scale || e.clientY >= root.clientHeight * scale))) return;
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
    if (inner && shadow.contains(inner)) replay(e, inner);
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
    const modal = deepAll('dialog:modal').at(-1) ?? null;
    const parent = modal ?? document.documentElement;
    if (host.parentNode !== parent) parent.append(host);
    if (holder !== modal) {
      holder?.removeEventListener('close', raiseAgain);
      modal?.addEventListener('close', raiseAgain);
      holder = modal;
    }
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover?.();
    hostWatch.disconnect();
    for (let node = host.parentNode; node; node = node.parentNode ?? node.host) hostWatch.observe(node, { childList: true });
    if (focused && shadow.activeElement !== focused) focused.focus({ preventScroll: true });
    fitZoom();
  }

  let holder = null;

  /** Raises the overlay again once the dialog holding it closes, since a closed dialog hides everything inside it. */
  const raiseAgain = () => state.active && raise();

  /**
   * Finds elements matching a selector in the document and in every open shadow root, where components such as the MDN
   * search keep their dialogs.
   * @param {string} selector A CSS selector.
   */
  function deepAll(selector) {
    const found = [];
    const search = (scope) => {
      found.push(...scope.querySelectorAll(selector));
      for (const el of scope.querySelectorAll('*')) if (el.shadowRoot && el !== host) search(el.shadowRoot);
    };
    search(document);
    return found;
  }

  let tabZoom = 1;
  let scale = 1;

  /**
   * Cancels the CSS zoom the overlay inherits from the page and the tab's browser zoom, so the overlay keeps the same
   * physical size on every page. While browser zoom is countered, one overlay pixel is `scale` page pixels.
   */
  function fitZoom() {
    const parent = host.parentElement ?? document.documentElement;
    const zoom = parent.currentCSSZoom ?? (Number(getComputedStyle(parent).zoom) || 1);
    scale = tabZoom > 0 ? 1 / tabZoom : 1;
    const own = scale / (zoom > 0 ? zoom : 1);
    host.style.zoom = own !== 1 ? String(own) : '';
    root.style.setProperty('--vw', `${innerWidth / scale}px`);
  }

  /** Applies a new browser zoom, then moves the saved regions, the open card and its band, flag and pins to match. */
  function refit() {
    fitZoom();
    closeMenu();
    hideTip();
    placeSaved();
    placeDraft();
  }

  /**
   * Turns a length in page pixels into a CSS length in the overlay's own pixels.
   * @param {number} value Page pixels, as event coordinates and page element boxes are measured.
   */
  const px = (value) => `${value / scale}px`;

  /**
   * The size of an overlay element in page pixels.
   * @param {HTMLElement} el The overlay element.
   */
  const sizeOf = (el) => ({ w: el.offsetWidth * scale, h: el.offsetHeight * scale });

  const openWatch = new MutationObserver((records) => {
    if (records.some((r) => r.target !== host && r.target.hasAttribute('open'))) raise();
  });

  /**
   * Raises the overlay again when the page opens a popover or dialog of its own, changes fullscreen, closes the dialog
   * the overlay sits in, or hides the overlay. Focus moving into a modal dialog inside a component's shadow root, whose
   * own toggle events never leave it, raises it too. A re-raise of another overlay shows as open to open and is
   * ignored, so two overlays never take turns forever.
   * @param {Event} e A toggle, close, fullscreenchange or focusin event caught at the window.
   */
  function onLayer(e) {
    if (e.target === host) {
      if (e.newState === 'closed' && state.active) raise();
      return;
    }
    if (e.type === 'focusin') {
      const modal = deepAll('dialog:modal').at(-1);
      if (modal && host.parentNode !== modal) raise();
      return;
    }
    const opened = e.type === 'toggle' && e.oldState === 'closed' && e.newState === 'open';
    const holding = e.target instanceof Element && e.target.contains(host);
    if (opened || holding || e.type === 'fullscreenchange') raise();
  }

  /**
   * Feeds pointer moves that land on the page, over or around the overlay, to the hover outline and the drag band.
   * @param {MouseEvent} e A mousemove caught at the window.
   */
  function onStrayMove(e) {
    if (e.target !== host && e.isTrusted && !passing) onMove(e);
  }

  let passing = false;

  /**
   * Hands the pointer to the page while Alt is held, so hover states, menus and inner scrolling work, and takes it back
   * when Alt is let go or the window loses focus.
   * @param {boolean} next Whether the page gets the pointer.
   */
  function passThrough(next) {
    if (passing === next) return;
    passing = next;
    host.style.pointerEvents = next ? 'none' : '';
    root.classList.toggle('passing', next);
    if (!next) return;
    state.drag = null;
    band.hidden = !state.panel;
    hoverBox.hidden = true;
  }

  /**
   * Ends the Alt hold on release. The release is cancelled so Chrome does not move focus to its menu.
   * @param {KeyboardEvent} e A keyup caught at the window.
   */
  function onKeyUp(e) {
    if (e.key !== 'Alt') return;
    e.preventDefault();
    passThrough(false);
  }

  /** Ends the Alt hold when the window loses focus, since the release then never arrives. */
  const endPass = () => passThrough(false);

  /**
   * Scrolls the scrollable page element under the pointer. The overlay covers the page, so without this every wheel
   * scrolls the document and inner panels never move.
   * @param {WheelEvent} e A wheel event on the overlay.
   */
  function onWheel(e) {
    if (e.ctrlKey) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const top = document.scrollingElement;
    for (let el = elementAt(e.clientX, e.clientY); el && el !== top && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      const room = (overflow, pos, size, full, delta) =>
        delta !== 0 && /auto|scroll|overlay/.test(overflow) && (delta > 0 ? pos + size < full - 1 : pos > 0);
      const canY = room(style.overflowY, el.scrollTop, el.clientHeight, el.scrollHeight, dy);
      const canX = room(style.overflowX, el.scrollLeft, el.clientWidth, el.scrollWidth, dx);
      if (canY || canX) {
        e.preventDefault();
        el.scrollBy({ left: canX ? dx : 0, top: canY ? dy : 0 });
        return;
      }
    }
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
  shadow.querySelector('[data-view]').addEventListener('click', captureViewport);
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

  /**
   * Registers Margin's bundled Manrope with the page under its own family name, so the shadow root can use it.
   * Text shows at once in the fallback font and swaps to Manrope when it arrives, so the overlay never waits on it.
   */
  function loadFont() {
    if (fontsAdded || !document.fonts || typeof FontFace !== 'function') return;
    fontsAdded = true;
    for (const weight of [500, 600, 800]) {
      try {
        const face = new FontFace(FONT, asset(`fonts/manrope-latin-${weight}-normal.woff2`), { weight: String(weight), display: 'swap' });
        document.fonts.add(face);
        face.load().catch(() => {});
      } catch {}
    }
  }
  loadFont();

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

  /** Writes how many comments the review holds, leaving out a draft that is still open, or how to start when there are none. */
  function paintCount() {
    const draft = state.panel?.id && !state.panel.reopened && state.comments.some((c) => c.id === state.panel.id) ? 1 : 0;
    const n = Math.max(0, state.total - draft);
    countLabel.textContent = n ? `${n} ${n === 1 ? 'comment' : 'comments'}` : 'Drag over anything to comment';
  }

  /**
   * Finds where a saved comment's region sits now, by its anchor element when the window width changed, else by the scroll offset.
   * Returns null when the region is entirely out of view.
   * @param {{rect: object, anchor: object | null, viewport: object}} comment A comment from pageComments.
   */
  function regionOf(comment) {
    const box = liveBox(comment);
    if (box.y + box.h < 0 || box.y > innerHeight || box.x > innerWidth || box.x + box.w < 0) return null;
    return box;
  }

  /**
   * Where a captured region sits now in viewport pixels, whether or not it is in view: by its anchor element when the
   * window width changed, else moved by how far the page scrolled since the capture.
   * @param {{rect: object, anchor: object | null, viewport: object}} comment A comment, or the card's draft.
   */
  function liveBox(comment) {
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
    return box;
  }

  /**
   * Puts a flag above a region, below it when there is no room above, or inside its top edge when the region fills the view.
   * @param {HTMLElement} flag The flag.
   * @param {{x:number,y:number,w:number,h:number}} rect The region in viewport pixels.
   * @param {boolean} [inside] True when the flag is placed relative to the region box rather than the viewport.
   * @param {boolean} [below] False when something else sits under the region, such as the card, so the flag goes inside.
   */
  function placeFlag(flag, rect, inside = false, below = true) {
    const lift = 22 * scale;
    let top = Math.max(0, -rect.y) + 2 * scale;
    if (rect.y >= lift + 2 * scale) top = -lift;
    else if (below && rect.y + rect.h + lift <= innerHeight - 2 * scale) top = rect.h + 2 * scale;
    flag.style.left = inside ? '0px' : px(Math.max(2 * scale, rect.x));
    flag.style.top = px(inside ? top : rect.y + top);
  }

  /** Draws the dashed regions and numbered flags of the comments saved on this page. */
  function paintSaved() {
    hideTip();
    const hidden = [state.panel?.id, state.pending?.old?.id];
    layer.replaceChildren(
      ...state.comments
        .filter((c) => !hidden.includes(c.id))
        .map((comment) => {
          const node = document.createElement('div');
          node.className = 'saved';
          node.dataset.status = comment.status ?? 'open';
          node.innerHTML = `<i class="halo"></i><i class="outline"></i><button type="button" class="flag" aria-label="Edit comment ${pad(comment.n)}, ${esc(comment.title || 'Untitled comment')}">${pad(comment.n)}</button>`;
          const flag = node.querySelector('.flag');
          flag.addEventListener('mouseenter', () => showTip(comment, node, flag));
          flag.addEventListener('mouseleave', hideTip);
          flag.addEventListener('focus', () => showTip(comment, node, flag));
          flag.addEventListener('blur', hideTip);
          flag.addEventListener('click', () => editSaved(comment));
          stopPresses(flag);
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
      place(node, box);
      placeFlag(node.querySelector('.flag'), box, true);
    }
  }

  let scrollFrame = 0;

  /** Repositions the saved flags and the open card's area, flag, pins and card once per frame while the page scrolls or resizes. */
  function onScroll() {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      placeSaved();
      placeDraft();
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
    const note = comment.note && comment.note !== comment.title ? comment.note : '';
    tip.innerHTML = `
      <b>${esc(comment.title || 'Untitled comment')}</b>
      ${note ? `<span class="note">${esc(note)}</span>` : ''}
      <span class="meta"><i class="icon glyph"></i>${sev.label}<span class="status" data-status="${status}">${STATUS_LABELS[status]}</span></span>
      ${comment.frame ? `<span class="where">${esc(comment.frame)}</span>` : ''}
    `;
    root.append(tip);
    const f = flag.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const size = sizeOf(tip);
    const edge = EDGE * scale;
    const gap = 8 * scale;
    const clampX = (x) => Math.min(Math.max(edge, x), innerWidth - size.w - edge);
    const clampY = (y) => Math.min(Math.max(edge, y), innerHeight - size.h - edge);
    const spots = [
      { left: r.right + gap, top: clampY(f.top), fits: r.right + gap + size.w <= innerWidth - edge },
      { left: r.left - gap - size.w, top: clampY(f.top), fits: r.left - gap - size.w >= edge },
      { left: clampX(f.left), top: r.top - gap - size.h, fits: r.top - gap - size.h >= edge },
      { left: clampX(f.left), top: r.bottom + gap, fits: r.bottom + gap + size.h <= innerHeight - edge },
    ];
    const spot = spots.find((s) => s.fits) ?? { left: clampX(f.right + gap), top: clampY(f.top) };
    tip.style.left = px(spot.left);
    tip.style.top = px(spot.top);
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
      const pick = pickAt(rect.x + rect.w / 2, rect.y + rect.h / 2, true);
      return describe(pick?.el, pick?.frame);
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
    return pickAt(x, y)?.el ?? null;
  }

  /**
   * Finds the page element a person points at. Hit testing skips layers with pointer-events: none, so on many sites the
   * hit is a canvas, video, gradient or full-bleed background in front of or behind the text. When the hit fills most of
   * the view, or is a large empty surface, the page is searched by element boxes and text instead, so the smallest
   * visible element holding the point wins. `full` is true when even that pick fills the view.
   * @param {number} x Viewport x of the point.
   * @param {number} y Viewport y of the point.
   * @param {boolean} [deep] True to look inside a frame under the point.
   */
  function pickAt(x, y, deep = false) {
    const hits = document.elementsFromPoint(x, y).filter((el) => el !== host);
    if (!hits.length) return null;
    const view = innerWidth * innerHeight;
    const area = (box) => box.width * box.height;
    let el = hits[0];
    let r = el.getBoundingClientRect();
    const surface = area(r) >= view * 0.2 && !el.childElementCount && !el.textContent.trim();
    if ((area(r) >= view * 0.6 || surface) && document.body) {
      const found = smallestAt(document.body, x, y);
      const box = found?.getBoundingClientRect();
      if (box && area(box) < area(r) * 0.8) {
        el = found;
        r = box;
      }
    }
    const full = r.width >= innerWidth * 0.95 && r.height >= innerHeight * 0.95;
    const pick = { el, full, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
    return deep && el.localName === 'iframe' ? inFrame(pick, x, y) : pick;
  }

  /**
   * Looks inside a frame for the element under a point. A same-origin frame gives its own element, with its box in this
   * page's viewport pixels and the frame kept for the selector. A frame Margin cannot read stays picked as a whole and
   * is marked so the outline can say so.
   * @param {{el: HTMLIFrameElement, full: boolean, rect: object}} pick The frame as picked.
   * @param {number} x Viewport x of the point.
   * @param {number} y Viewport y of the point.
   */
  function inFrame(pick, x, y) {
    const frame = pick.el;
    let doc = null;
    try {
      doc = frame.contentDocument;
    } catch {}
    if (!doc) return { ...pick, frame: true };
    const box = frame.getBoundingClientRect();
    const zoom = frame.currentCSSZoom ?? 1;
    const left = box.left + frame.clientLeft * zoom;
    const top = box.top + frame.clientTop * zoom;
    const inner = doc.elementFromPoint((x - left) / zoom, (y - top) / zoom);
    if (!inner || inner === doc.documentElement || inner === doc.body) return pick;
    const r = inner.getBoundingClientRect();
    return { el: inner, full: false, frame: frame, rect: { x: left + r.left * zoom, y: top + r.top * zoom, w: r.width * zoom, h: r.height * zoom } };
  }

  /**
   * Searches below an element for the smallest visible element whose box, or whose own text, holds a point, whatever its
   * pointer-events. Only branches whose box holds the point are walked, within a fixed budget.
   * @param {Element} start Where the search begins.
   * @param {number} x Viewport x of the point.
   * @param {number} y Viewport y of the point.
   */
  function smallestAt(start, x, y) {
    const holds = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    let best = null;
    let bestArea = Infinity;
    let budget = 1500;
    const consider = (el, area) => {
      if (area > bestArea || el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return;
      best = el;
      bestArea = area;
    };
    const visit = (el) => {
      for (const node of el.childNodes) {
        if (--budget < 0) return;
        if (node.nodeType === Node.TEXT_NODE) {
          if (!node.data.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const line = [...range.getClientRects()].find(holds);
          const own = el.getBoundingClientRect();
          if (line) consider(el, Math.min(line.width * line.height, own.width * own.height));
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE || node === host) continue;
        const r = node.getBoundingClientRect();
        if (!r.width && !r.height) {
          if (node.checkVisibility?.() !== false) visit(node);
        }
        else if (holds(r)) {
          consider(node, r.width * r.height);
          visit(node);
        }
      }
    };
    visit(start);
    return best;
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

  /**
   * Captures the facts about an element that a developer needs to find it again.
   * @param {Element | null} el The element.
   * @param {Element | boolean} [frame] The same-origin frame the element sits in, whose path leads the selector.
   */
  function describe(el, frame) {
    if (!el) return null;
    const style = (el.ownerDocument.defaultView ?? window).getComputedStyle(el);
    return {
      selector: frame instanceof Element ? `${cssPath(frame)} >> ${cssPath(el)}` : cssPath(el),
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
    el.style.left = px(rect.x);
    el.style.top = px(rect.y);
    el.style.width = px(rect.w);
    el.style.height = px(rect.h);
    el.hidden = false;
  }

  /** Removes the toast on screen, if any, keeping keyboard focus in the overlay when it was on the toast. */
  function clearToast() {
    clearTimeout(state.toast?.timer);
    const focused = state.toast?.node.contains(shadow.activeElement);
    state.toast?.node.remove();
    state.toast = null;
    if (focused && !state.panel) selectorsBtn.focus({ preventScroll: true });
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
   * Confirms a saved comment where its card was, with Edit to reopen it and a link to the report. Focus moves to Edit,
   * and the toast stays while the pointer is on it.
   * @param {{number: number, box: DOMRect}} saved The comment number and the card's last position.
   */
  function savedToast(saved) {
    clearToast();
    const node = document.createElement('div');
    node.className = 'toast saved-toast';
    node.setAttribute('role', 'status');
    node.innerHTML = `
      <b class="flag">${pad(saved.number)}</b><span>Comment ${pad(saved.number)} saved</span>
      <span class="actions"><button type="button" class="btn" data-undo>Edit</button><button type="button" class="btn" data-open>Open report</button></span>
    `;
    node.addEventListener('mouseenter', () => clearTimeout(state.toast?.timer));
    node.addEventListener('mouseleave', () => {
      if (state.toast?.node === node) state.toast.timer = setTimeout(clearToast, 2500);
    });
    stopPresses(node);
    node.querySelector('[data-undo]').addEventListener('click', undoSave);
    node.querySelector('[data-open]').addEventListener('click', () => {
      clearToast();
      chrome.runtime.sendMessage({ type: 'openReport' }).catch(() => {});
    });
    root.append(node);
    const size = sizeOf(node);
    const left = Math.min(Math.max(EDGE * scale, saved.box.left + 12 * scale), innerWidth - size.w - EDGE * scale);
    node.style.left = px(left);
    node.style.top = px(Math.min(saved.box.bottom, innerHeight - HINT_SPACE * scale) - size.h);
    state.toast = { node, timer: setTimeout(clearToast, 5000) };
    node.querySelector('[data-undo]').focus({ preventScroll: true });
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const left = Math.max(0, rect.x);
    const top = Math.max(0, rect.y);
    const right = Math.min(window.innerWidth, rect.x + rect.w);
    const bottom = Math.min(window.innerHeight, rect.y + rect.h);
    return {
      x: Math.round(left),
      y: Math.round(top),
      w: Math.max(0, Math.round(right - left)),
      h: Math.max(0, Math.round(bottom - top)),
    };
  }

  /**
   * Draws a region a little inside the edges of the view it touches, so an area as big as the view still reads as a
   * selection instead of merging with the overlay's frame.
   * @param {{x:number,y:number,w:number,h:number}} rect The region in viewport pixels.
   */
  function inset(rect) {
    const k = 4 * scale;
    const left = rect.x <= 4 ? k : 0;
    const top = rect.y <= 4 ? k : 0;
    const right = rect.x + rect.w >= innerWidth - 4 ? k : 0;
    const bottom = rect.y + rect.h >= innerHeight - 4 ? k : 0;
    return { x: rect.x + left, y: rect.y + top, w: Math.max(2, rect.w - left - right), h: Math.max(2, rect.h - top - bottom) };
  }

  /** Captures the whole visible area as one comment, unless an open card would lose work. */
  function captureViewport() {
    if (state.panel && !replaceable()) {
      holdCard();
      return;
    }
    closePanel(true);
    capture(fitRect({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }));
  }

  /**
   * Captures the part of the element under a point that is in view, with its selector, whether or not selector capture is on.
   * @param {number} x Viewport x of the point.
   * @param {number} y Viewport y of the point.
   */
  function captureElementAt(x, y) {
    const pick = pickAt(x, y, true);
    if (!pick) return;
    let element = null;
    try {
      element = describe(pick.el, pick.frame);
    } catch {}
    const rect = fitRect(pick.rect);
    if (rect.w < 2 || rect.h < 2) {
      toast('That element is out of view. Scroll to it first.', 2400);
      return;
    }
    capture(rect, element);
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
    const pick = pickAt(x, y);
    const target = pick?.el.getBoundingClientRect();
    if (pick) outline(pick);
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
      button.addEventListener('mousemove', () => shadow.activeElement !== button && button.focus({ preventScroll: true }));
      menu.append(button);
    }
    stopPresses(menu);
    menu.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    root.append(menu);
    const size = sizeOf(menu);
    const edge = EDGE * scale;
    const floor = innerHeight - (hint.classList.contains('top') ? edge : HINT_SPACE * scale);
    let top = y + 8 * scale;
    const fitsBelow = target && target.height < innerHeight / 3 && target.bottom + 6 * scale + size.h <= floor;
    if (fitsBelow) top = target.bottom + 6 * scale;
    menu.style.left = px(Math.max(edge, Math.min(x + 6 * scale, window.innerWidth - size.w - edge)));
    menu.style.top = px(Math.max(edge, Math.min(top, floor - size.h)));
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

  /**
   * Opens the annotation menu on right-click, unless a comment is being dragged. With a card open it says to finish the
   * card first. The contextmenu event Chrome sends after Shift+F10 or the menu key is skipped, since the key opened the menu.
   */
  function onContext(e) {
    e.preventDefault();
    if (state.drag || performance.now() - state.keyMenuAt < 1000) return;
    if (state.panel) {
      holdCard();
      return;
    }
    openMenu(e.clientX, e.clientY);
  }

  /** Opens the annotation menu from the keyboard, at the focused page element or else the middle of the view. */
  function openKeyMenu() {
    state.keyMenuAt = performance.now();
    if (state.panel) {
      holdCard();
      return;
    }
    const focused = document.activeElement;
    const box = focused && focused !== host && focused !== document.body && focused !== document.documentElement ? focused.getBoundingClientRect() : null;
    const visible = box && box.width && box.bottom > 0 && box.top < innerHeight;
    openMenu(visible ? box.left + Math.min(box.width / 2, 24) : innerWidth / 2, visible ? box.top + box.height / 2 : innerHeight / 2);
  }

  /**
   * True when the open card can give way to a new capture without losing anything: a new draft with nothing typed or placed.
   */
  function replaceable() {
    const p = state.panel;
    return Boolean(p && !p.reopened && !hasWork());
  }

  /** Says the open card has to be saved or discarded first, gives it a small shake and puts focus back in it. */
  function holdCard() {
    const p = state.panel;
    if (!p) return;
    toast(`Save or discard comment ${pad(p.number)} first`, 2400);
    p.node.classList.remove('nudge');
    void p.node.offsetWidth;
    p.node.classList.add('nudge');
    if (!p.node.contains(shadow.activeElement)) p.title.focus({ preventScroll: true });
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
    host.style.cursor = 'progress';
    await Promise.race([nextFrame(), wait(1000)]);
    await wait(60);
    let res;
    if (document.visibilityState !== 'visible') {
      res = { error: 'The tab was in the background, so Margin did not take the screenshot' };
    } else {
      const sent = chrome.runtime.sendMessage(msg).then((answer) => answer ?? {}, (err) => ({ error: String(err.message ?? err) }));
      res = await Promise.race([sent, wait(SHOT_TIMEOUT)]);
      if (!res) {
        res = { error: 'Margin waited too long for the screenshot' };
        sent.then((late) => late?.id && chrome.runtime.sendMessage({ type: 'discard', id: late.id }).catch(() => {}));
      }
    }
    root.classList.remove('capturing');
    host.style.cursor = '';
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
    showSaving(rect);
    const pending = state.pending;
    state.pending = null;
    if (pending?.old?.id && res.id) chrome.runtime.sendMessage({ type: 'discard', id: pending.old.id }).catch(() => {});
    if (res.id) await refreshReview();
    showSaving(null);
    const carried = pending?.draft?.pageMarks ?? [];
    const marks = carried
      .map((m) => ({ x: Math.round(m.px - scrollX), y: Math.round(m.py - scrollY), note: m.note }))
      .filter((m) => m.x >= rect.x && m.x <= rect.x + rect.w && m.y >= rect.y && m.y <= rect.y + rect.h);
    openPanel({ id: res.id ?? null, rect, element, msg, error: res.error, draft: pending?.draft && { ...pending.draft, marks } });
    const dropped = carried.length - marks.length;
    if (dropped) toast(`${dropped} ${dropped === 1 ? 'marker was' : 'markers were'} outside the new area and ${dropped === 1 ? 'was' : 'were'} removed`, 3600);
  }

  /**
   * Marks a region as saving, with its band, a Saving flag and a busy cursor, until the card opens.
   * It is only shown after the screenshot is back, so it never appears in the shot.
   * @param {{x:number,y:number,w:number,h:number} | null} rect The region, or null to clear the state.
   */
  function showSaving(rect) {
    root.classList.toggle('busy', Boolean(rect));
    savingFlag.hidden = !rect;
    if (!rect) return;
    place(band, inset(rect));
    placeFlag(savingFlag, rect);
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
   * @param {object} [opts.viewport] The viewport the area was captured in, with its scroll offset.
   * @param {object | null} [opts.anchor] The element the area was recorded against, to find it after a resize.
   * @param {object[]} [opts.extraMarks] Boxes and arrows drawn in the report's editor, kept as they are when the card saves.
   */
  function openPanel({ id, rect, element, msg = null, error, draft = {}, number, reopened = false, hasShot = Boolean(id), viewport = msg?.viewport, anchor = msg?.anchor ?? null, extraMarks = [] }) {
    closePanel(false);
    closeMenu();
    clearToast();
    const n = number ?? state.comments.find((c) => c.id === id)?.n ?? state.total + 1;
    const files = state.review?.figma;
    const linkLabel = files?.frames?.length ? 'Frame' : 'Figma link';
    const heading = reopened ? 'Edit comment' : 'New comment';
    const node = document.createElement('div');
    node.className = 'panel';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', `${heading} ${pad(n)}`);
    node.innerHTML = `
      <div class="panel-head">
        <b class="flag draft">${pad(n)}</b><h2>${heading}</h2><span class="spacer"></span>
        <button type="button" class="chip" data-redraw title="Drag a new area and keep this draft, key R">Redraw</button>
        <button type="button" class="chip square" data-more aria-label="More actions" aria-haspopup="menu"><i class="icon i-more"></i></button>
      </div>
      <div class="error" data-error hidden>
        <span class="head"><i class="icon i-alert"></i><span data-error-head></span></span>
        <p data-error-body></p>
        <span class="ask-row"><button type="button" class="btn primary" data-retry>Try again</button><span class="save-hint">Enter tries again</span></span>
      </div>
      <div class="panel-body">
        <div class="field">
          <textarea class="line" rows="1" data-title placeholder="What is wrong" aria-label="What is wrong"></textarea>
          <span class="field-hint" data-title-hint>Add a title or a note to save</span>
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

    const p = {
      id,
      rect,
      element,
      msg,
      viewport: viewport ?? { width: innerWidth, height: innerHeight, scrollY: Math.round(scrollY) },
      anchor,
      extraMarks,
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
    p.original = JSON.stringify(readDraft());

    for (const button of node.querySelectorAll('.seg button')) button.addEventListener('click', () => setSeverity(button.dataset.sev));
    q('.seg').addEventListener('keydown', onSegKey);
    p.title.addEventListener('input', () => {
      oneLine(p.title);
      refreshSave();
    });
    node.addEventListener('focusin', (e) => {
      if (p.more && e.target !== q('[data-more]')) closeMore();
    });
    for (const type of ['click', 'input']) {
      node.addEventListener(type, (e) => {
        if (p.asking && state.panel === p && !q('[data-foot]').contains(e.target)) stopAsking();
      });
    }
    node.addEventListener('mousedown', (e) => {
      if (p.more && !q('[data-more]').contains(e.target)) closeMore();
    });
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
    oneLine(p.title);
    paintMarks();
    paintFrame();
    paintFoot();
    placeDraft();
    p.observer = new ResizeObserver(placeTail);
    p.observer.observe(node);
    paintCount();
    paintSaved();
    p.title.focus();
  }

  /**
   * Where the open card's area sits now in viewport pixels. It follows the page as it scrolls, and its anchor element
   * when the window width changes, so the band, flag, pins and card stay on the content that was captured.
   * @param {object} p The open card.
   */
  function liveRect(p) {
    return liveBox({ rect: p.rect, anchor: p.anchor, viewport: p.viewport });
  }

  /**
   * Turns a point stored against the captured area into where it shows now, or back again with `back`.
   * Markers are stored in the capture's viewport pixels, since that is how the screenshot is drawn on.
   * @param {object} p The open card.
   * @param {{x:number,y:number}} point The point.
   * @param {boolean} [back] True to turn a point on screen now into capture pixels.
   */
  function mapPoint(p, point, back = false) {
    const live = liveRect(p);
    const from = back ? live : p.rect;
    const to = back ? p.rect : live;
    return { x: to.x + ((point.x - from.x) * to.w) / from.w, y: to.y + ((point.y - from.y) * to.h) / from.h };
  }

  /** Moves the open card's band, flag, pins and the card itself to where its area sits now, and the hint bar out of its way. */
  function placeDraft() {
    const p = state.panel;
    if (!p) return;
    const live = liveRect(p);
    placeHint(live);
    place(band, inset(live));
    placePanel();
    placeFlag(p.flag, live, false, p.side !== 'below');
    placePins();
  }

  /**
   * Puts the hint bar at the top of the view while an area or a drag reaches into the strip it covers at the bottom.
   * @param {{x:number,y:number,w:number,h:number} | null} rect The area, or null to put the bar back at the bottom.
   */
  function placeHint(rect) {
    const strip = HINT_SPACE * scale;
    const low = Boolean(rect) && rect.y + rect.h > innerHeight - strip && rect.y > strip && rect.y < innerHeight;
    hint.classList.toggle('top', low);
  }

  /**
   * Keeps a one line field to one paragraph and grows it with its text.
   * @param {HTMLTextAreaElement} field The field.
   */
  function oneLine(field) {
    if (/\n/.test(field.value)) field.value = field.value.replace(/\s*\n\s*/g, ' ');
    field.style.height = '';
    field.style.height = `${field.scrollHeight + 2}px`;
  }

  /**
   * Moves the severity choice with the arrow keys, as in a radio group.
   * @param {KeyboardEvent} e The key press inside the severity row.
   */
  function onSegKey(e) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const at = SEVERITIES.findIndex((s) => s.key === (e.target.dataset?.sev ?? state.panel.severity));
    const next = SEVERITIES[(at + step + SEVERITIES.length) % SEVERITIES.length].key;
    setSeverity(next);
    state.panel.node.querySelector(`.seg [data-sev="${next}"]`).focus();
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
    const line = target?.localName === 'input' || target?.classList?.contains('line');
    if (!line && !ctrl) return;
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
    const save = p.node.querySelector('[data-save], [data-no-shot]');
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
      const ask = {
        discard: [`Discard comment ${pad(p.number)}${parts.length ? `, ${parts.join(' and ')}` : ''}?`, 'Discard', 'Keep editing'],
        delete: [`Delete comment ${pad(p.number)}?`, 'Delete', 'Keep it'],
        changes: [`Discard your changes to comment ${pad(p.number)}?`, 'Discard changes', 'Keep editing'],
      }[p.asking];
      foot.innerHTML = `
        <span class="ask-q">${esc(ask[0])}</span>
        <span class="ask-row"><span class="save-hint">Esc again keeps it</span><span class="spacer"></span>
          <button type="button" class="btn danger" data-confirm>${ask[1]}</button>
          <button type="button" class="btn primary" data-keep>${ask[2]}</button></span>
      `;
      foot.querySelector('[data-confirm]').addEventListener('click', () => closePanel(p.asking !== 'changes'));
      foot.querySelector('[data-keep]').addEventListener('click', keepEditing);
      foot.querySelector('[data-keep]').focus();
      return;
    }
    const cancel = p.reopened ? '<button type="button" class="btn danger" data-cancel>Delete</button>' : '<button type="button" class="btn" data-cancel>Discard</button>';
    foot.innerHTML = p.error
      ? `${cancel}<span class="spacer"></span>
         <button type="button" class="btn secondary" data-no-shot>Save without screenshot</button>`
      : `${cancel}<span class="spacer"></span>
         <span class="save-hint">Enter to save</span><button type="button" class="btn primary" data-save>Save comment</button>`;
    foot.querySelector('[data-cancel]').addEventListener('click', askDiscard);
    foot.querySelector('[data-save]')?.addEventListener('click', save);
    foot.querySelector('[data-no-shot]')?.addEventListener('click', saveWithoutShot);
    refreshSave();
  }

  /**
   * Discards an untouched draft at once, or asks in place of the footer when something would be lost. On a saved
   * comment the button deletes it, after asking.
   */
  function askDiscard() {
    const p = state.panel;
    if (!p) return;
    if (p.reopened) p.asking = 'delete';
    else if (hasWork()) p.asking = 'discard';
    else {
      closePanel(true);
      return;
    }
    paintFoot();
  }

  /** Closes the question in the footer and goes back to the title. */
  function keepEditing() {
    stopAsking();
    state.panel.title.focus();
  }

  /** Closes the question in the footer without moving focus, as when the card is used while it is showing. */
  function stopAsking() {
    const p = state.panel;
    p.asking = false;
    paintFoot();
  }

  /** True when the fields of a reopened comment differ from what was saved. */
  function changed() {
    const p = state.panel;
    return JSON.stringify(readDraft()) !== p.original;
  }

  /**
   * Steps back one level on Esc: the More menu, the frame list, marker placing, the question in the footer, then the card.
   * A saved comment closes as it was, after asking when it has changes.
   */
  function escapePanel() {
    const p = state.panel;
    if (p.more) closeMore();
    else if (p.picker) togglePicker();
    else if (p.placing) {
      p.placing = false;
      paintMarks();
    } else if (p.asking) keepEditing();
    else if (!p.reopened) askDiscard();
    else if (changed()) {
      p.asking = 'changes';
      paintFoot();
    } else closePanel(false);
  }

  /**
   * Places the card beside where its area sits now: right of the area, then left, below and above, 12px from the area
   * and clear of the hint bar, always inside the window. In the top half of the viewport it grows down from its top edge.
   * In the bottom half its footer stays put and it grows up.
   */
  function placePanel() {
    const p = state.panel;
    const { node } = p;
    const r = liveRect(p);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const edge = EDGE * scale;
    const gap = GAP * scale;
    const atTop = hint.classList.contains('top');
    const ceil = atTop ? HINT_SPACE * scale : edge;
    const floor = vh - HINT_SPACE * scale;
    node.style.top = '';
    node.style.bottom = '';
    node.style.maxHeight = '';
    const { w, h } = sizeOf(node);
    const clampX = (x) => Math.min(Math.max(edge, x), vw - w - edge);
    const right = r.x + r.w + gap;
    const left = r.x - gap - w;
    let side;
    if (right + w <= vw - edge) side = 'right';
    else if (left >= edge) side = 'left';
    else if (r.y + r.h + gap + h <= floor) side = 'below';
    else if (r.y - gap - h >= ceil) side = 'above';
    else side = 'inside';
    p.side = side;
    const anchorTop = (top) => {
      const at = Math.min(Math.max(ceil, top), Math.max(ceil, floor - h));
      node.style.top = px(at);
      node.style.maxHeight = px(floor - at);
    };
    const anchorBottom = (bottom) => {
      const at = Math.min(floor, Math.max(bottom, h + ceil));
      node.style.bottom = px(vh - at);
      node.style.maxHeight = px(at - ceil);
    };
    if (side === 'right' || side === 'left') {
      node.style.left = px(side === 'right' ? right : left);
      if (r.y + r.h / 2 < vh / 2) anchorTop(r.y);
      else anchorBottom(Math.min(r.y + r.h, floor));
    } else if (side === 'below') {
      node.style.left = px(clampX(r.x));
      anchorTop(r.y + r.h + gap);
    } else if (side === 'above') {
      node.style.left = px(clampX(r.x));
      anchorBottom(r.y - gap);
    } else {
      node.style.left = px(vw - w - 16 * scale);
      anchorBottom(floor);
    }
    placeTail();
  }

  /** Points the small tail on the card's edge at the middle of the area. */
  function placeTail() {
    const p = state.panel;
    if (!p) return;
    const box = p.node.getBoundingClientRect();
    const r = liveRect(p);
    const { tail } = p;
    tail.hidden = p.side === 'inside';
    if (tail.hidden) return;
    const k = scale;
    const cy = Math.min(Math.max(r.y + r.h / 2, box.top + 16 * k), box.bottom - 16 * k);
    const cx = Math.min(Math.max(r.x + r.w / 2, box.left + 16 * k), box.right - 16 * k);
    const spots = {
      left: { left: box.right, top: cy - 7 * k, turn: 'none' },
      right: { left: box.left - 8 * k, top: cy - 7 * k, turn: 'scaleX(-1)' },
      below: { left: cx - 4 * k, top: box.top - 11 * k, turn: 'rotate(-90deg)' },
      above: { left: cx - 4 * k, top: box.bottom - 3 * k, turn: 'rotate(90deg)' },
    };
    const spot = spots[p.side];
    tail.style.left = px(spot.left);
    tail.style.top = px(spot.top);
    tail.style.transform = spot.turn;
  }

  /** Redraws the numbered pins on the page, their note rows in the card and the placing hint. */
  function paintMarks() {
    const p = state.panel;
    root.querySelectorAll(':scope > .pin').forEach((pin) => pin.remove());
    p.marks.forEach((m, i) => {
      const pin = Object.assign(document.createElement('b'), { className: 'pin', textContent: String(i + 1) });
      pin.mark = m;
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
        row.innerHTML = `<b class="pin">${i + 1}</b><textarea class="line" rows="1" placeholder="What marker ${i + 1} points out" aria-label="Note for marker ${i + 1}"></textarea>
          <button type="button" class="remove" aria-label="Remove marker ${i + 1}"><i class="icon i-close"></i></button>`;
        const input = row.querySelector('textarea');
        input.value = m.note;
        input.addEventListener('input', () => {
          oneLine(input);
          m.note = input.value;
        });
        row.querySelector('.remove').addEventListener('click', () => removeMark(i, true));
        return row;
      }),
    );
    list.querySelectorAll('textarea').forEach(oneLine);
    const placing = p.node.querySelector('[data-place]');
    placing.hidden = !p.placing;
    placing.innerHTML = `<b class="pin ghost">${p.marks.length + 1}</b>Click inside the area to place marker ${p.marks.length + 1}`;
    paintQuiet();
    placePins();
  }

  /** Puts each numbered pin where its marker sits on the page now. */
  function placePins() {
    const p = state.panel;
    for (const pin of root.querySelectorAll(':scope > .pin')) {
      const at = mapPoint(p, pin.mark);
      pin.style.left = px(at.x);
      pin.style.top = px(at.y);
    }
  }

  /**
   * Removes one numbered marker and renumbers the rest. From the card, focus moves to the next marker's note, or to
   * Add marker when none is left after it.
   * @param {number} index The marker's position.
   * @param {boolean} [fromCard] True when the remove button in the card was used.
   */
  function removeMark(index, fromCard = false) {
    const p = state.panel;
    p.marks.splice(index, 1);
    paintMarks();
    if (!fromCard) return;
    const rows = p.node.querySelectorAll('.mrow textarea');
    (rows[index] ?? rows[index - 1] ?? p.node.querySelector('[data-add-marker]'))?.focus();
  }

  /**
   * Drops the next numbered marker at a point inside the area and focuses its note. The point is stored in the
   * capture's viewport pixels, however far the page has scrolled since.
   * @param {number} x Viewport x of the click.
   * @param {number} y Viewport y of the click.
   */
  function addMark(x, y) {
    const p = state.panel;
    const at = mapPoint(p, { x, y }, true);
    p.marks.push({ x: Math.round(at.x), y: Math.round(at.y), note: '' });
    p.placing = false;
    paintMarks();
    p.node.querySelector('.mrow:last-child textarea')?.focus();
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

  /** Opens or closes the card's More menu, which holds the capture at three widths. It opens beside the card, so it never hides a field. */
  function toggleMore() {
    const p = state.panel;
    if (p.more) {
      closeMore();
      return;
    }
    const menu = document.createElement('div');
    menu.className = 'more-menu';
    menu.setAttribute('role', 'menu');
    const ready = p.id && p.hasShot;
    menu.innerHTML = `<button type="button" role="menuitem" data-widths${ready ? '' : ' disabled title="Needs a screenshot"'}>Capture at mobile, tablet and desktop widths</button>${ready ? '' : '<span class="why">Needs a screenshot of the area first</span>'}`;
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
    const card = p.node.getBoundingClientRect();
    const { w } = sizeOf(menu);
    const edge = EDGE * scale;
    const gap = 4 * scale;
    const spots = [
      { left: card.right + gap, fits: card.right + gap + w <= innerWidth - edge },
      { left: card.left - gap - w, fits: card.left - gap - w >= edge },
    ];
    if (p.side === 'left') spots.reverse();
    const spot = spots.find((s) => s.fits);
    menu.style.left = px(spot ? spot.left : Math.max(edge, at.right - w));
    menu.style.top = px(spot ? at.top : at.bottom + gap);
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
    const pageMarks = p.marks.map((m) => {
      const at = mapPoint(p, m);
      return { px: at.x + scrollX, py: at.y + scrollY, note: m.note };
    });
    const draft = { ...readDraft(), marks: [], pageMarks };
    state.pending = { draft, old: { ...reopenArgs(p), error: p.error, draft: readDraft() } };
    closePanel(false);
    const kept = pageMarks.length ? ' Markers inside it are kept.' : '';
    toast(`Drag over the new area.${kept} Esc keeps the old one.`, 4200);
  }

  /**
   * What reopening a card needs to bring it back on the same area.
   * @param {object} p The card.
   */
  function reopenArgs(p) {
    return { id: p.id, rect: p.rect, element: p.element, msg: p.msg, number: p.number, reopened: p.reopened, hasShot: p.hasShot, viewport: p.viewport, anchor: p.anchor, extraMarks: p.extraMarks };
  }

  /** Brings back the card a redraw left, with its old area and fields. */
  function cancelRedraw() {
    const { old } = state.pending;
    state.pending = null;
    clearToast();
    if (old) openPanel({ ...old });
    else paintSaved();
  }

  /**
   * Turns the card's fields into what is stored: the comment fields, the markers, and whether the images need redrawing.
   * @param {object} p The card.
   * @param {object} [draft] The fields, read from the card unless given.
   */
  function patchFor(p, draft = readDraft()) {
    const note = draft.note.trim();
    const dots = draft.marks.map((m) => ({ kind: 'dot', x: m.x, y: m.y, note: m.note.trim() })).filter((m) => m.note);
    const marks = [...p.extraMarks, ...dots];
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
    const moved = JSON.stringify(draft.marks) !== JSON.stringify(JSON.parse(p.original).marks);
    const redrawImages = p.hasShot && (p.reopened ? moved : dots.length > 0);
    return { draft, patch, marks, redrawImages };
  }

  /** Saves the card's fields to the draft comment, with markers drawn into its images, then shows the saved toast. */
  async function save() {
    const p = state.panel;
    if (!p?.id || !filled() || p.saving) return;
    p.saving = true;
    const { draft, patch, marks, redrawImages } = patchFor(p);
    try {
      await chrome.runtime.sendMessage({ type: 'update', id: p.id, patch });
      if (redrawImages) await chrome.runtime.sendMessage({ type: 'annotate', id: p.id, marks });
    } catch (err) {
      p.saving = false;
      toast(`Could not save. ${String(err.message ?? err)}`, 4200);
      return;
    }
    const box = p.node.getBoundingClientRect();
    state.saved = { ...reopenArgs(p), draft, box };
    closePanel(false);
    await refreshReview();
    savedToast(state.saved);
  }

  /** Reopens the comment just saved for editing, with its fields as they were, and hides its flag while it is edited. */
  function undoSave() {
    const saved = state.saved;
    clearToast();
    if (!saved) return;
    state.saved = null;
    openPanel({ ...saved, reopened: true });
  }

  /**
   * Opens a saved comment from its flag for editing, with its fields, markers and area as stored.
   * @param {object} comment The comment from pageComments.
   */
  async function editSaved(comment) {
    if (state.panel) {
      if (state.panel.id === comment.id) return;
      if (!replaceable()) {
        holdCard();
        return;
      }
      closePanel(true);
    }
    hideTip();
    const full = await chrome.runtime.sendMessage({ type: 'comment', id: comment.id }).catch(() => null);
    if (!full?.id || !state.active || state.panel) return;
    const figma = full.figmaFrame?.nodeId ? full.figmaFrame : null;
    const frameLink = figma ? frameUrl(figma) : '';
    const marks = full.marks ?? [];
    openPanel({
      id: full.id,
      rect: full.rect,
      element: full.element ?? null,
      number: comment.n,
      reopened: true,
      hasShot: full.hasShot,
      viewport: full.viewport,
      anchor: full.anchor ?? null,
      extraMarks: marks.filter((m) => m.kind && m.kind !== 'dot'),
      draft: {
        title: full.title ?? '',
        note: full.note ?? '',
        severity: full.severity ?? 'major',
        marks: marks.filter((m) => !m.kind || m.kind === 'dot').map((m) => ({ x: m.x, y: m.y, note: m.note ?? '' })),
        frame: figma,
        link: (full.links ?? []).filter((link) => link !== frameLink).join(' '),
      },
    });
  }

  /**
   * Keeps what was typed in the open card when the page goes away. A card with a title or note is saved with its
   * markers and the next page says so. An empty new draft is dropped, and edits to a saved comment are let go.
   */
  function onLeave() {
    const p = state.panel;
    const old = state.pending?.old;
    const card = p ?? (old && { ...old, extraMarks: old.extraMarks ?? [], hadFrame: false, original: JSON.stringify({ marks: [] }) });
    const draft = p ? readDraft() : old?.draft;
    if (card?.id && !card.reopened) {
      if (draft.title.trim() || draft.note.trim()) {
        const { patch, marks, redrawImages } = patchFor(card, draft);
        const notice = `Comment ${pad(card.number)} was saved when the page changed`;
        chrome.runtime.sendMessage({ type: 'keep', id: card.id, patch, marks: redrawImages ? marks : null, notice }).catch(() => {});
      } else chrome.runtime.sendMessage({ type: 'discard', id: card.id }).catch(() => {});
    }
    state.pending = null;
    closePanel(false);
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
    placeHint(null);
    if (discard && p.id) {
      chrome.runtime
        .sendMessage({ type: 'discard', id: p.id })
        .catch(() => {})
        .then(refreshReview);
    }
    paintCount();
    paintSaved();
  }

  /**
   * Follows the pointer with the drag band, or with the element outline when selector capture is on. Over Margin's own
   * bar, card, menus and flags there is no outline.
   * @param {MouseEvent} e A mousemove on the overlay or the page.
   */
  function onMove(e) {
    if (state.drag) {
      const x = Math.min(e.clientX, state.drag.x);
      const y = Math.min(e.clientY, state.drag.y);
      const rect = { x, y, w: Math.abs(e.clientX - state.drag.x), h: Math.abs(e.clientY - state.drag.y) };
      place(band, rect);
      placeHint(rect);
      return;
    }
    if (state.panel || state.menu || !state.selectors) return;
    if (e.target instanceof Element && root.contains(e.target) && e.target.closest('.hint, .toast, .ctx, .panel, .more-menu, .flag')) {
      hoverBox.hidden = true;
      return;
    }
    outline(pickAt(e.clientX, e.clientY, true));
  }

  /**
   * Outlines a picked element, saying so when it fills the whole view or is a frame Margin cannot look into, or hides
   * the outline when nothing was picked.
   * @param {{rect: object, full: boolean, frame?: Element | boolean} | null} pick The pick from pickAt.
   */
  function outline(pick) {
    if (!pick) {
      hoverBox.hidden = true;
      return;
    }
    hoverBox.classList.toggle('frame', pick.frame === true && !pick.full);
    hoverBox.classList.toggle('full', pick.full);
    place(hoverBox, pick.rect);
  }

  /**
   * Starts a drag, or with a card open drops a marker when the press lands inside its area. A press outside the area
   * starts a drag that replaces an empty draft, and focus stays in the card. A press that only closes the More menu
   * does nothing else.
   * @param {MouseEvent} e A mousedown on the overlay.
   */
  function onDown(e) {
    if (state.menu) {
      e.preventDefault();
      if (e.button === 0) closeMenu();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    hideTip();
    if (state.panel) {
      const p = state.panel;
      if (p.more) {
        closeMore();
        return;
      }
      const r = liveRect(p);
      const inside = e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
      if (inside) {
        if ((state.markers || p.placing) && !p.asking) addMark(e.clientX, e.clientY);
        return;
      }
    }
    state.drag = { x: e.clientX, y: e.clientY };
    hoverBox.hidden = true;
  }

  /**
   * Finishes a drag and captures the area, or the element under the pointer for a click with selector capture on.
   * With a card open, a drag replaces an empty draft and is refused for one with work in it.
   * @param {MouseEvent} e A mouseup on the overlay.
   */
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
    const tiny = rect.w < MIN_DRAG || rect.h < MIN_DRAG;
    if (state.panel) {
      placeDraft();
      if (tiny) return;
      if (!replaceable()) {
        holdCard();
        return;
      }
      const severity = state.panel.severity;
      closePanel(true);
      state.pending = { draft: { severity }, old: null };
      rect = fitRect(rect);
      if (rect.w >= 2 && rect.h >= 2) capture(rect);
      else state.pending = null;
      return;
    }
    placeHint(null);
    if (tiny) {
      if (!state.selectors) {
        toast('Drag over an area to comment, or press S to pick elements', 2400);
        return;
      }
      const pick = pickAt(e.clientX, e.clientY, true);
      if (!pick) return;
      rect = pick.rect;
    }
    rect = fitRect(rect);
    if (rect.w < 2 || rect.h < 2) return;
    capture(rect);
  }

  /**
   * Keyboard shortcuts while annotating: S and M toggle modes, V comments on the visible area, 1 to 4 and R act on the
   * open card, Ctrl+Z takes back the last marker, arrows walk menus, Tab stays inside Margin, Shift+F10 and the menu key
   * open the annotation menu, Esc steps back, and holding Alt hands the pointer to the page. Letters and digits typed
   * into a page field stay there. With nothing of Margin's open, Esc pressed twice stops annotating, and an Esc meant
   * for the page, with a page dialog or field open or handled by the page, never does.
   * @param {KeyboardEvent} e A keydown caught at the window.
   */
  function onKey(e) {
    if (e.key === 'Alt') {
      e.preventDefault();
      passThrough(true);
      return;
    }
    const pageField = isEditable(document.activeElement) || isEditable(e.composedPath()[0]);
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !pageField;
    const key = e.key?.toLowerCase();
    const menu = state.menu ?? state.panel?.more;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      stop();
      stepMenu(menu, e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey && !pageField) {
      stop();
      stepFocus(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      stop();
      openKeyMenu();
      return;
    }
    if (state.panel && (e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey && undoMarkKey()) {
      stop();
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
    if (plain && !state.panel && !state.menu && !state.pending && key === 'v' && !e.shiftKey) {
      stop();
      captureViewport();
      return;
    }
    if (e.key !== 'Escape') return;
    if (!state.menu && !state.panel && !state.pending) {
      if (pageField || pageLayerOpen()) return;
      window.addEventListener('keydown', (after) => after === e && !e.defaultPrevented && escapeToStop(), { once: true });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (state.menu) closeMenu();
    else if (state.panel) escapePanel();
    else cancelRedraw();
  }

  /** Stops annotating on the second Esc within a moment, and says so after the first. */
  function escapeToStop() {
    const now = performance.now();
    if (now - state.escAt < 1600) {
      state.escAt = 0;
      setActive(false);
      return;
    }
    state.escAt = now;
    toast('Press Esc again to stop annotating', 1600);
  }

  /**
   * Takes back the last marker on Ctrl+Z when focus is not in a field with text to undo, or is in the last marker's
   * empty note. Returns true when a marker was removed.
   */
  function undoMarkKey() {
    const p = state.panel;
    if (!p.marks.length) return false;
    const active = shadow.activeElement;
    const notes = p.node.querySelectorAll('.mrow textarea');
    const lastEmpty = active === notes[notes.length - 1] && !active.value;
    if (isField(active) && !lastEmpty) return false;
    removeMark(p.marks.length - 1);
    p.title.focus();
    return true;
  }

  /**
   * Moves keyboard focus to the next or previous control, staying inside the open menu, the open card, or else the
   * hint bar, the toast and the saved flags, so Tab never wanders into the page hidden under the overlay.
   * @param {number} step 1 for Tab, -1 for Shift+Tab.
   */
  function stepFocus(step) {
    const scope = state.menu ? [state.menu] : state.panel?.more ? [state.panel.more] : state.panel ? [state.panel.node] : [hint, state.toast?.node, layer];
    const items = scope
      .filter(Boolean)
      .flatMap((el) => [...el.querySelectorAll('button, input, textarea, [tabindex]')])
      .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (!items.length) return;
    const at = items.indexOf(shadow.activeElement);
    const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    items[next].focus({ preventScroll: true });
  }

  /** True when the page has its own modal dialog, popover or fullscreen element open, which Esc should close first. */
  function pageLayerOpen() {
    return Boolean(document.fullscreenElement) || deepAll('dialog:modal, :popover-open').some((el) => el !== host);
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
      SHIELDED.forEach((type) => window.addEventListener(type, shield, true));
      LAYERED.forEach((type) => window.addEventListener(type, onLayer, true));
      window.addEventListener('mousemove', onStrayMove, true);
      window.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('blur', endPass);
      root.addEventListener('wheel', onWheel, { passive: false });
      openWatch.observe(document, { subtree: true, attributes: true, attributeFilter: ['open'] });
      root.addEventListener('mousemove', onMove);
      root.addEventListener('mousedown', onDown);
      root.addEventListener('mouseup', onUp);
      root.addEventListener('contextmenu', onContext);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      window.addEventListener('resize', onScroll);
      window.addEventListener('resize', fitZoom);
      window.addEventListener('pagehide', onLeave);
      refreshReview();
      if (!isEditable(document.activeElement)) selectorsBtn.focus({ preventScroll: true });
    } else {
      closeMenu();
      closePanel(!state.panel?.reopened);
      if (state.pending?.old?.id && !state.pending.old.reopened) chrome.runtime.sendMessage({ type: 'discard', id: state.pending.old.id }).catch(() => {});
      state.pending = null;
      state.saved = null;
      clearToast();
      hideTip();
      state.drag = null;
      showSaving(null);
      band.hidden = true;
      hoverBox.hidden = true;
      layer.replaceChildren();
      SHIELDED.forEach((type) => window.removeEventListener(type, shield, true));
      LAYERED.forEach((type) => window.removeEventListener(type, onLayer, true));
      window.removeEventListener('mousemove', onStrayMove, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', endPass);
      root.removeEventListener('wheel', onWheel);
      openWatch.disconnect();
      passThrough(false);
      holder?.removeEventListener('close', raiseAgain);
      holder = null;
      hostWatch.disconnect();
      root.removeEventListener('mousemove', onMove);
      root.removeEventListener('mousedown', onDown);
      root.removeEventListener('mouseup', onUp);
      root.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('resize', fitZoom);
      window.removeEventListener('pagehide', onLeave);
      placeHint(null);
      host.remove();
    }
    chrome.runtime.sendMessage({ type: 'annotating', active: next }).catch(() => {});
    return state.active;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ping') sendResponse({ ok: true, active: state.active });
    else if (msg?.type === 'toggle') {
      if (msg.groupName) groupLabel.textContent = msg.groupName;
      if (msg.zoom) tabZoom = msg.zoom;
      sendResponse({ active: setActive(!state.active) });
    }
    else if (msg?.type === 'zoom') {
      tabZoom = msg.zoom || 1;
      if (state.active) refit();
      sendResponse({ ok: true });
    }
    else if (msg?.type === 'start') {
      if (msg.groupName) groupLabel.textContent = msg.groupName;
      if (msg.zoom) tabZoom = msg.zoom;
      sendResponse({ active: setActive(true) });
      if (msg.notice) toast(msg.notice, 4200);
    }
    else if (msg?.type === 'stop') sendResponse({ active: setActive(false) });
    else if (msg?.type === 'toast') {
      if (state.active) toast(msg.text, 4200);
      sendResponse({ ok: true });
    }
    else if (msg?.type === 'captureViewport') {
      if (msg.groupName) groupLabel.textContent = msg.groupName;
      if (msg.zoom) tabZoom = msg.zoom;
      setActive(true);
      fitZoom();
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
