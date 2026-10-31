/**
 * Styles for the editing controls the report screen adds to the preview. The export markup and its CSS
 * come from lib/report-template.js unchanged, so the preview stays what the HTML file shows.
 * The --m-* colours are the screen's theme tokens, copied in by tokenCss.
 */
export const PREVIEW_EDIT_CSS = `
html { scroll-behavior: auto; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--m-ring); outline-offset: 2px; border-radius: 8px; }
[data-m-edit] { border-radius: 8px; transition: background-color 120ms ease-out, box-shadow 120ms ease-out; }
[data-m-edit="title"], [data-m-edit="note"] { cursor: text; }
[data-m-edit="title"]:hover, [data-m-edit="note"]:hover { background: var(--m-surface); box-shadow: 0 0 0 4px var(--m-surface); }
[data-m-editing] { cursor: text; background: var(--m-bg) !important; box-shadow: 0 0 0 4px var(--m-bg), 0 0 0 6px var(--m-ring) !important; outline: none; }
[data-m-edit="severity"], [data-m-edit="status"] {
  cursor: pointer; padding: 2px 4px 2px 6px; margin: -2px 0; user-select: none;
}
[data-m-edit="severity"]:hover, [data-m-edit="status"]:hover, [data-m-edit][aria-expanded="true"] { background: var(--m-surface); }
[data-m-edit] .m-chev { display: inline-flex; width: 12px; height: 12px; margin-left: -1px; color: var(--m-ink-2); opacity: 0.8; }
[data-m-edit] .m-chev svg { width: 12px; height: 12px; }
.m-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px;
  font: inherit; font-size: 12px; font-weight: 600; color: var(--m-ink-2); cursor: pointer;
  background: transparent; border: 0; border-radius: 10px; transition: background-color 120ms ease-out, color 120ms ease-out, opacity 120ms ease-out;
}
.m-btn:hover { color: var(--m-ink); background: var(--m-surface); }
.m-btn svg { width: 16px; height: 16px; flex: none; }
.m-icon { width: 28px; padding: 0; justify-content: center; margin: -2px 0; }
[data-m-edit="note"]:empty::before { content: "Add a note"; color: var(--m-ink-2); }
.issue:not(:hover) [data-m-edit="note"]:empty:not(:focus-visible):not([data-m-editing]) { opacity: 0; }
[data-m-editing]:empty::before { content: none; }
.m-shot { position: relative; }
.m-shot img { cursor: crosshair; transition: border-color 120ms ease-out; }
.m-shot img:hover { border-color: var(--m-input); }
.m-annotate {
  position: absolute; top: 8px; right: 8px; height: 28px; padding: 0 10px; color: var(--m-ink);
  background: color-mix(in srgb, var(--m-bg) 88%, transparent); backdrop-filter: blur(6px);
  border: 1px solid var(--m-line); box-shadow: var(--shadow);
}
.m-annotate:hover { background: var(--m-bg); border-color: var(--m-input); }
ol.marks li .m-li-tools { display: inline-flex; gap: 2px; margin-left: 6px; vertical-align: middle; opacity: 0; transition: opacity 120ms ease-out; }
ol.marks li:hover .m-li-tools, ol.marks .m-li-tools:focus-within { opacity: 1; }
ol.marks .m-li-tools .m-btn { height: 22px; padding: 0 6px; font-size: 12px; }
.empty .stat, [data-clear-filters] { cursor: pointer; }
@media (hover: none), (max-width: 560px) {
  ol.marks li .m-li-tools { opacity: 1; }
  .issue [data-m-edit="note"]:empty { opacity: 1 !important; }
}
[data-m-editing]::selection { background: color-mix(in srgb, var(--m-ring) 35%, transparent); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
@media print { .m-icon, .m-annotate, .m-li-tools, .m-chev, [data-m-edit="note"]:empty { display: none !important; } }
`;

const TOKENS = { ink: '--foreground', 'ink-2': '--muted-foreground', line: '--border', surface: '--muted', bg: '--background', ring: '--ring', input: '--input' };

/**
 * The page's theme tokens as --m-* variables for the preview document, which cannot see the page's styles.
 * Tokens can be built from other tokens, so each is resolved to a plain colour through a probe element.
 */
export function tokenCss() {
  const probe = document.createElement('span');
  document.body.append(probe);
  const values = Object.entries(TOKENS).map(([name, token]) => {
    probe.style.color = `var(${token})`;
    return `--m-${name}: ${getComputedStyle(probe).color};`;
  });
  probe.remove();
  return `:root { ${values.join(' ')} }`;
}
