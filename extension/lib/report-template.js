import { buildReviewModel, imageSize } from './review-model.js';
import { INTER_WOFF2 } from './report-fonts.js';

/**
 * Escapes text for HTML.
 * @param {unknown} value The text.
 */
export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const esc = escapeHtml;

/** Each severity keeps its own shape as well as its colour, so it never rests on colour alone. */
const SHAPE_SVG = {
  blocker: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor"/></svg>',
  major: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .6 9.6 8.9H.4Z" fill="currentColor" stroke="currentColor" stroke-width=".6" stroke-linejoin="round"/></svg>',
  minor: '<svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4.2" fill="currentColor"/></svg>',
  nit: '<svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.3 1.6"/></svg>',
};

const STATUS_SVG = {
  open: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
  fixed:
    '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/><path d="M3.9 6.1 5.3 7.5 8.1 4.6" fill="none" stroke="var(--paper)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wontfix: '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3 3l6 6" stroke="currentColor" stroke-width="1.5"/></svg>',
};

const DARK_TOKENS = `
  color-scheme: dark;
  --bg: #09090b; --paper: #131316; --tint: #1f1f23; --line: #27272a; --line-2: #3f3f46;
  --ink: #fafafa; --ink-2: #a1a1aa; --focus: #fafafa;
  --marker: #ff7a7a; --shadow: none;
  --sev-blocker: #f87171; --sev-major: #fb923c; --sev-minor: #60a5fa; --sev-nit: #a1a1aa;
  --sev-blocker-tint: #301a1a; --sev-major-tint: #312012; --sev-minor-tint: #182330; --sev-nit-tint: #222224;
  --success: #4ade80; --success-tint: #142c1d;`;

export const REPORT_CSS = `
:root {
  color-scheme: light;
  --bg: #ffffff; --paper: #ffffff; --tint: #f4f4f5; --line: #e4e4e7; --line-2: #d4d4d8;
  --ink: #09090b; --ink-2: #68686f; --focus: #09090b;
  --marker: #e5484d; --shadow: 0 1px 2px rgb(0 0 0 / 0.04);
  --sev-blocker: #dc2626; --sev-major: #c2410c; --sev-minor: #2563eb; --sev-nit: #71717a;
  --sev-blocker-tint: #fbe7e7; --sev-major-tint: #f8eae4; --sev-minor-tint: #e7eefd; --sev-nit-tint: #f4f4f5;
  --success: #15803d; --success-tint: #e5f1ea;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
@media screen and (prefers-color-scheme: dark) { :root:not([data-theme]) {${DARK_TOKENS} } }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; padding: 56px 24px 48px; background: var(--bg); color: var(--ink);
  font: 500 14px/1.55 Inter, ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif;
  font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 920px; margin: 0 auto; }
a { color: inherit; text-decoration: underline; text-decoration-color: var(--line-2); text-underline-offset: 3px; }
a:hover { text-decoration-color: currentColor; }
.eyebrow { margin: 0 0 12px; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.shape { display: inline-flex; flex: none; width: 10px; height: 10px; }
.shape svg, .status svg { display: block; width: 100%; height: 100%; }
[data-sev="blocker"] { --sev: var(--sev-blocker); --sev-tint: var(--sev-blocker-tint); }
[data-sev="major"] { --sev: var(--sev-major); --sev-tint: var(--sev-major-tint); }
[data-sev="minor"] { --sev: var(--sev-minor); --sev-tint: var(--sev-minor-tint); }
[data-sev="nit"] { --sev: var(--sev-nit); --sev-tint: var(--sev-nit-tint); }

.cover { padding-bottom: 28px; border-bottom: 1px solid var(--line); }
.kicker { margin: 0 0 14px; font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-2); }
.cover h1 { margin: 0; font-size: 40px; line-height: 1.1; font-weight: 800; letter-spacing: -0.03em; text-wrap: balance; }
.cover-meta { display: flex; flex-wrap: wrap; gap: 4px 0; margin: 14px 0 0; padding: 0; list-style: none; font-size: 14px; color: var(--ink-2); }
.cover-meta li + li::before { content: ""; display: inline-block; width: 3px; height: 3px; margin: 0 10px; vertical-align: middle; border-radius: 50%; background: var(--line-2); }
.cover-meta b { color: var(--ink); font-weight: 700; }
.cover-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.link-chip {
  display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 12px 4px 4px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--paper); text-decoration: none; font-size: 13px; font-weight: 700;
}
.link-chip:hover { border-color: var(--line-2); background: var(--tint); }
.link-chip .kind { padding: 2px 6px; border-radius: 8px; background: var(--tint); color: var(--ink); font-size: 11px; font-weight: 800; }
.link-chip .sub { font-weight: 500; color: var(--ink-2); }
.cover.compact { padding-bottom: 20px; }
.cover.compact h1 { font-size: 26px; }

.summary {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 1.7fr); margin-top: 28px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--paper); overflow: hidden;
}
.tile { padding: 16px 18px; border-right: 1px solid var(--line); }
.tile-label { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 700; color: var(--sev); }
.tile-count { display: block; margin-top: 6px; font-size: 30px; line-height: 1; font-weight: 800; letter-spacing: -0.02em; }
.tile.zero .tile-count { color: var(--line-2); }
.progress { padding: 16px 20px; background: var(--tint); }
.progress-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; }
.progress-head b { font-size: 20px; font-weight: 800; letter-spacing: -0.01em; }
.progress-head span { font-size: 12px; color: var(--ink-2); }
.bar { display: flex; height: 8px; margin-top: 14px; border-radius: 6px; background: var(--paper); box-shadow: inset 0 0 0 1px var(--line); overflow: hidden; }
.bar span { display: block; height: 100%; }
.bar .fixed { background: var(--success); }
.bar .wontfix { background: var(--line-2); }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 10px 0 0; padding: 0; list-style: none; font-size: 12px; color: var(--ink-2); }
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.legend i { width: 8px; height: 8px; border-radius: 2px; background: var(--paper); box-shadow: inset 0 0 0 1px var(--line-2); }
.legend .fixed i { background: var(--success); box-shadow: none; }
.legend .wontfix i { background: var(--line-2); box-shadow: none; }

.filters {
  position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  margin: 24px -8px 0; padding: 10px 8px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px);
}
.filters .label { margin-right: 4px; font-size: 12px; font-weight: 700; color: var(--ink-2); }
.filters .sep { width: 1px; height: 20px; margin: 0 6px; background: var(--line); }
.stat {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px;
  font: inherit; font-size: 12px; font-weight: 700; color: var(--ink); background: var(--paper);
  border: 1px solid var(--line); border-radius: 10px; cursor: pointer;
}
.stat:hover { border-color: var(--line-2); }
.stat:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.stat .shape { color: var(--sev); width: 9px; height: 9px; }
.stat b { font-weight: 800; color: var(--ink-2); }
.stat[aria-pressed="true"] { color: var(--bg); background: var(--ink); border-color: var(--ink); }
.stat[aria-pressed="true"] b, .stat[aria-pressed="true"] .shape { color: inherit; }

.toc { margin-top: 28px; }
.toc-groups { display: grid; gap: 14px; }
.toc-group { border: 1px solid var(--line); border-radius: 14px; background: var(--paper); overflow: hidden; }
.toc-page { display: flex; align-items: baseline; gap: 10px; margin: 0; padding: 12px 16px; background: var(--tint); font-size: 13px; font-weight: 800; }
.toc-page .count { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.toc ol { margin: 0; padding: 6px; list-style: none; }
.toc a {
  display: grid; grid-template-columns: 28px 12px minmax(0, 1fr) auto; gap: 10px; align-items: center;
  padding: 7px 10px; border-radius: 8px; text-decoration: none; font-size: 13px;
}
.toc a:hover { background: var(--tint); }
.toc a .shape { color: var(--sev); }
.toc .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.toc .st { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.toc .st[data-status="fixed"] { color: var(--success); }
.toc .num, .num { font-size: 12px; font-weight: 800; color: var(--ink-2); }
.comm-n {
  display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 8px;
  background: var(--ink); color: var(--bg); font-size: 11px; font-weight: 800; letter-spacing: 0.04em;
}
.toc .comm-n { height: 20px; font-size: 10px; }

.comm { margin-top: 48px; }
.comm-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.comm-head h2 { margin: 0; font-size: 22px; line-height: 1.25; font-weight: 800; letter-spacing: -0.02em; }
.comm-head .count { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.comm-url { margin: 6px 0 0; font-size: 12px; color: var(--ink-2); overflow-wrap: anywhere; }
.comm.hide, .issue.hide { display: none; }

.issue {
  margin-top: 16px; padding: 22px 24px 18px; border: 1px solid var(--line); border-radius: 14px;
  background: var(--paper); box-shadow: var(--shadow); scroll-margin-top: 64px;
}
.issue-head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: start; }
.issue-head .num {
  display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 28px; padding: 0 6px;
  border-radius: 8px; background: var(--tint); color: var(--ink); font-size: 12px;
}
.issue h3 { margin: 2px 0 0; font-size: 17px; line-height: 1.4; font-weight: 800; letter-spacing: -0.01em; text-wrap: pretty; }
.labels { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; padding-top: 1px; }
.sev, .status {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 8px;
  font-size: 12px; font-weight: 700; white-space: nowrap;
}
.sev { background: var(--sev-tint); color: var(--sev); }
.sev .shape { width: 9px; height: 9px; }
.status { border: 1px solid var(--line); color: var(--ink); }
.status .ico { display: inline-flex; width: 12px; height: 12px; }
.status[data-status="fixed"] { border-color: transparent; background: var(--success-tint); color: var(--success); }
.status[data-status="wontfix"] { border-color: transparent; background: var(--sev-nit-tint); color: var(--ink-2); }
.where { margin: 8px 0 0 46px; font-size: 12px; color: var(--ink-2); }
.note { margin: 14px 0 0; max-width: 70ch; white-space: pre-wrap; font-size: 14.5px; line-height: 1.6; }
.note:empty { margin: 0; }

.evidence { margin-top: 18px; }
.evidence.with-marks { display: grid; grid-template-columns: minmax(0, 1fr) minmax(200px, 32%); gap: 20px; align-items: start; }
figure { margin: 0; }
.frame {
  display: flex; align-items: center; justify-content: center; min-height: 96px; padding: 16px;
  border-radius: 14px; background: var(--tint);
}
.frame img {
  display: block; max-width: 100%; height: auto; border-radius: 4px;
  background: #fff; box-shadow: 0 0 0 1px var(--line-2), 0 2px 8px rgb(0 0 0 / 0.06);
}
figcaption { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.tag { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 8px; background: var(--tint); color: var(--ink); font-size: 11px; font-weight: 800; }
.tag.after { background: var(--success-tint); color: var(--success); }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.pair .frame { height: 100%; }
.pair figure { display: grid; grid-template-rows: 1fr auto; }
ol.marks { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.with-marks ol.marks { padding-top: 4px; }
.pair + ol.marks { margin-top: 16px; }
ol.marks li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; align-items: start; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; }
ol.marks .m {
  display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%;
  background: var(--marker); color: #fff; font-size: 11px; font-weight: 800; line-height: 1;
}
.widths { margin-top: 20px; }
.widths-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.widths figure { display: grid; grid-template-rows: 1fr auto; }
.widths .frame { height: 100%; padding: 10px; min-height: 0; }
.widths figcaption { align-items: flex-start; }

.issue-foot { display: flex; flex-wrap: wrap; gap: 4px 20px; margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line); }
.issue-foot:has(details[open]) { display: block; }
details > summary {
  display: inline-flex; align-items: center; gap: 8px; width: fit-content; list-style: none;
  padding: 4px 0; font-size: 12px; font-weight: 700; color: var(--ink-2); cursor: pointer; user-select: none;
}
details > summary::-webkit-details-marker { display: none; }
details > summary::before {
  content: ""; width: 6px; height: 6px; margin: 0 2px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg); transition: transform 120ms ease-out;
}
details[open] > summary::before { transform: rotate(45deg); }
details > summary:hover { color: var(--ink); }
details > summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
.issue-foot details[open] + details { margin-top: 8px; }
dl.facts { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 6px 16px; margin: 8px 0 6px; font-size: 12.5px; }
dl.facts dt { color: var(--ink-2); font-weight: 700; }
dl.facts dd { margin: 0; overflow-wrap: anywhere; }
dl.facts code { padding: 1px 5px; border-radius: 6px; background: var(--tint); font-family: var(--mono); font-size: 11.5px; }
details.full figure { margin-top: 8px; }
.full-shot { margin-top: 18px; }

.made { margin: 56px 0 0; text-align: center; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.empty { margin-top: 28px; padding: 40px; border: 1px dashed var(--line-2); border-radius: 14px; text-align: center; color: var(--ink-2); }
.empty[hidden] { display: none; }

@media (max-width: 720px) {
  body { padding: 32px 16px; }
  .cover h1 { font-size: 30px; }
  .filters { position: static; }
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile { border-bottom: 1px solid var(--line); }
  .tile:nth-child(2n) { border-right: 0; }
  .progress { grid-column: 1 / -1; }
  .issue { padding: 18px 16px 14px; }
  .issue-head { grid-template-columns: auto minmax(0, 1fr); }
  .labels { grid-column: 2; justify-content: flex-start; }
  .evidence.with-marks, .pair, .widths-row { grid-template-columns: minmax(0, 1fr); }
  .where { margin-left: 0; }
  .toc a { grid-template-columns: 24px 12px minmax(0, 1fr); }
  .toc .st { display: none; }
}
@media print {
  :root { --shadow: none; }
  html, body { background: #fff; }
  body { padding: 0; font-size: 10pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: none; }
  .filters, details > summary { display: none; }
  details::details-content { content-visibility: visible; display: block; }
  .cover h1 { font-size: 30pt; }
  .summary, .toc-group, .issue, figure, .tile { break-inside: avoid; }
  .toc a { padding: 4px 10px; }
  .comm { margin-top: 0; padding-top: 10mm; }
  .toc + .comm { break-before: page; padding-top: 0; }
  .comm-head { break-after: avoid; }
  .comm-url { break-after: avoid; }
  .issue { margin-top: 5mm; }
  dl.facts { margin-top: 0; }
  .issue-foot { display: block; }
  .issue-foot:has(details.full) { display: grid; grid-template-columns: minmax(0, 1fr) 42%; gap: 16px; align-items: start; }
  .issue-foot details.full figure { margin-top: 0; }
  .issue-foot .frame { padding: 8px; }
  .frame { padding: 12px; }
  .made { margin-top: 10mm; }
  a { text-decoration: none; }
}
`;

/**
 * The dark palette for the in-extension preview, keyed off the theme the report screen sets.
 * The exported file follows the viewer's own preference instead, and always prints light.
 */
export const PREVIEW_DARK_CSS = `
@media screen { :root[data-theme="dark"] {${DARK_TOKENS} } }
`;

/** Inter embedded as a data URL, so the file reads the same on any machine. */
const FONT_FACES = `@font-face { font-family: Inter; font-weight: 100 900; font-display: swap; src: url(data:font/woff2;base64,${INTER_WOFF2}) format("woff2"); }`;

/** A value for a CSS string, such as the review name in the printed page margins. */
const cssString = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;

/**
 * The printed page: A4, the review name and site in the top margin, page numbers in the bottom margin.
 * @param {object} model The review model.
 */
function pageCss(model) {
  const box = 'font-family: Inter, Arial, sans-serif; font-size: 8pt; font-weight: 600; color: #5b5670;';
  return `
@page {
  size: A4; margin: 18mm 15mm 18mm;
  @top-left { content: ${cssString(model.title)}; ${box} }
  @top-right { content: ${cssString(model.sites.join(', '))}; ${box} }
  @bottom-left { content: "Made with Margin"; ${box} }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); ${box} }
}
@page :first { @top-left { content: none; } @top-right { content: none; } }`;
}

/**
 * Wires the severity and status filter bar of an exported report, so the file filters on its own, and unfolds every detail before printing.
 * @param {Document} root The report document.
 */
export function wireFilters(root) {
  const picked = { filter: 'all', statusFilter: 'all' };
  const buttons = [...root.querySelectorAll('.filters [data-filter], .filters [data-status-filter]')];
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const axis = 'filter' in btn.dataset ? 'filter' : 'statusFilter';
      picked[axis] = btn.dataset[axis];
      buttons.filter((b) => axis in b.dataset).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      root.querySelectorAll('.issue').forEach((issue) => {
        const bySeverity = picked.filter === 'all' || issue.dataset.sev === picked.filter;
        const byStatus = picked.statusFilter === 'all' || issue.dataset.status === picked.statusFilter;
        issue.classList.toggle('hide', !(bySeverity && byStatus));
      });
      root.querySelectorAll('.comm').forEach((section) => section.classList.toggle('hide', !section.querySelector('.issue:not(.hide)')));
    });
  });
  root.defaultView?.addEventListener('beforeprint', () => {
    root.querySelectorAll('details:not([open])').forEach((d) => {
      d.open = true;
    });
  });
}

/**
 * The shape that marks a severity.
 * @param {string} key The severity key.
 */
const shapeIcon = (key) => `<span class="shape">${SHAPE_SVG[key]}</span>`;

/**
 * The severity of a comment as its shape and label on its tint.
 * @param {{ key: string, label: string }} sev The severity.
 * @param {string} [attrs] Extra attributes, such as the preview's edit hook.
 */
export const severityBadge = (sev, attrs = '') => `<span class="sev" data-sev="${esc(sev.key)}"${attrs}>${shapeIcon(sev.key)}${esc(sev.label)}</span>`;

/**
 * The status of a comment as its icon and label.
 * @param {{ key: string, label: string }} status The status.
 * @param {string} [attrs] Extra attributes, such as the preview's edit hook.
 */
export const statusBadge = (status, attrs = '') =>
  `<span class="status" data-status="${esc(status.key)}"${attrs}><span class="ico">${STATUS_SVG[status.key]}</span>${esc(status.label)}</span>`;

/**
 * The value of a detail row as HTML: its links named and linked, or its text, with code rows wrapped for a monospace face.
 * @param {import('./review-model.js').DetailRow} row The detail row.
 * @param {(html: string) => string} [code] Wraps a code value, since the Docs export can only style inline.
 * @param {string} [linkStyle] Inline style for each link, for documents that cannot take a stylesheet.
 */
export function rowHtml(row, code = (html) => `<code>${html}</code>`, linkStyle = '') {
  if (row.links) {
    const links = row.links.map((l) => (l.url ? `<a href="${esc(l.url)}"${linkStyle ? ` style="${linkStyle}"` : ''}>${esc(l.text)}</a>` : esc(l.text))).join(', ');
    return row.extra ? `${links}, ${esc(row.extra)}` : links;
  }
  return row.code ? code(esc(row.value)) : esc(row.value);
}

/**
 * One framed image with its caption, shown no larger than it was on screen and no taller than the frame allows.
 * @param {string} src The image.
 * @param {string} alt What it shows.
 * @param {{ caption?: string, attrs?: string, dpr?: number, maxHeight?: number }} [options] The caption as HTML, extra attributes on the image,
 *   the pixel ratio it was captured at, and the tallest it may be.
 */
function framed(src, alt, { caption = '', attrs = '', dpr = 1, maxHeight = 460 } = {}) {
  const size = imageSize(src);
  const width = size ? Math.round(Math.min(size.width / dpr, (maxHeight * size.width) / size.height)) : 0;
  const sized = width ? ` width="${width}" height="${Math.round((width * size.height) / size.width)}"` : '';
  return `<figure><div class="frame"><img alt="${esc(alt)}" src="${src}"${sized}${attrs} /></div>${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
}

/**
 * A comment's numbered marker notes.
 * @param {{n: number, note: string}[]} marks The markers.
 */
const markList = (marks) =>
  marks.length ? `<ol class="marks">${marks.map((item) => `<li value="${item.n}"><span class="m">${item.n}</span><span>${esc(item.note)}</span></li>`).join('')}</ol>` : '';

/**
 * The marked region with its numbered marker notes beside it, or the region before and after a recheck side by side with the notes under them.
 * @param {object} comment The comment from the review model.
 */
function evidence({ images, number, marks, dpr }) {
  if (!images.region) return marks.length ? `<div class="evidence">${markList(marks)}</div>` : '';
  const before = (caption) => framed(images.region, `Marked region for comment ${number}`, { caption, attrs: ' data-shot="detail"', dpr });
  if (images.after) {
    const after = framed(images.after, `Same region after recheck for comment ${number}`, {
      caption: `<span class="tag after">After</span>${esc(images.afterCaption.replace(/^After,?\s*/, ''))}`,
      attrs: ' class="after"',
      dpr,
    });
    return `<div class="evidence"><div class="pair">${before('<span class="tag">Before</span>')}${after}</div>${markList(marks)}</div>`;
  }
  return `<div class="evidence${marks.length ? ' with-marks' : ''}">${before('')}${markList(marks)}</div>`;
}

/**
 * The region at mobile, tablet and desktop widths in one row, or nothing when the comment was not captured at widths.
 * @param {object} comment The comment from the review model.
 */
function widthFigures({ images, number, dpr }) {
  if (!images.widths.length) return '';
  return `<div class="widths"><p class="eyebrow">At each width</p><div class="widths-row">${images.widths
    .map((shot) => framed(shot.src, `${shot.label} width for comment ${number}`, { caption: esc(shot.caption), attrs: ' class="at-width"', dpr, maxHeight: 200 }))
    .join('')}</div></div>`;
}


/**
 * One comment card.
 * @param {object} comment The comment from the review model.
 * @param {number} index Its position in the report, which names the card.
 * @param {{ where: boolean, preview: boolean }} options Whether to name the page under the title, and whether to add the preview's edit hooks.
 */
function issueCard(comment, index, { where, preview }) {
  const { severity, status, rows, images, number } = comment;
  const hook = (name) => (preview ? ` data-edit="${name}"` : '');
  const note = comment.note || preview ? `<p class="note"${hook('note')}>${esc(comment.note)}</p>` : '';
  const full = images.full
    ? images.region
      ? `<details class="full"><summary>Full screenshot</summary>${framed(images.full, `Full viewport for comment ${number}`, { caption: 'Full viewport', attrs: ' data-shot="shot"', dpr: comment.dpr })}</details>`
      : `<div class="full-shot">${framed(images.full, `Full viewport for comment ${number}`, { caption: 'Full viewport', attrs: ' data-shot="shot"', dpr: comment.dpr })}</div>`
    : '';
  const tech = rows.length
    ? `<details class="tech"><summary>Technical details</summary><dl class="facts">${rows.map((row) => `<dt>${esc(row.label)}</dt><dd>${rowHtml(row)}</dd>`).join('')}</dl></details>`
    : '';
  const folded = [tech, images.region ? full : ''].filter(Boolean).join('');
  return `
    <article class="issue" id="c-${index + 1}" data-n="${number}" data-sev="${esc(severity.key)}" data-status="${esc(status.key)}">
      <header class="issue-head">
        <span class="num">${comment.label}</span>
        <h3${hook('title')}>${esc(comment.title)}</h3>
        <div class="labels">${severityBadge(severity, hook('severity'))}${statusBadge(status, hook('status'))}</div>
      </header>
      ${where && comment.url ? `<p class="where"><a href="${esc(comment.url)}">${esc(comment.route)}</a></p>` : ''}
      ${note}
      ${evidence(comment)}
      ${widthFigures(comment)}
      ${images.region ? '' : full}
      ${folded ? `<div class="issue-foot">${folded}</div>` : ''}
    </article>`;
}

/**
 * The cover: the review name, its site, date and size, and links to its Jira ticket and Figma file.
 * @param {object} model The review model.
 * @param {boolean} compact True for the short header used when the summary is switched off.
 */
function cover(model, compact) {
  const { jira, figma } = model.links;
  const meta = [model.sites.length ? `<b>${esc(model.sites.join(', '))}</b>` : '', esc(model.date), esc(model.summary)].filter(Boolean);
  const links = [
    jira &&
      `<a class="link-chip" href="${esc(jira.url)}"><span class="kind">Jira</span>${esc(jira.key)}${jira.status ? `<span class="sub">${esc(jira.status)}</span>` : ''}</a>`,
    figma && `<a class="link-chip" href="${esc(figma.url)}"><span class="kind">Figma</span>${esc(figma.name)}</a>`,
  ].filter(Boolean);
  return `<header class="cover${compact ? ' compact' : ''}">
    ${compact ? '' : '<p class="kicker">UI review</p>'}
    <h1>${esc(model.title)}</h1>
    <ul class="cover-meta">${meta.map((m) => `<li>${m}</li>`).join('')}</ul>
    ${links.length ? `<div class="cover-links">${links.join('')}</div>` : ''}
  </header>`;
}

/**
 * The counts by severity, each with its shape, and how many comments are fixed.
 * @param {object} model The review model.
 */
function summary(model) {
  const count = (key) => model.statuses.find((s) => s.key === key).count;
  const pct = (n) => (model.total ? `${((n / model.total) * 100).toFixed(2)}%` : '0%');
  const tiles = model.severities
    .map(
      (s) =>
        `<div class="tile${s.count ? '' : ' zero'}" data-sev="${s.key}"><span class="tile-label">${shapeIcon(s.key)}${esc(s.label)}</span><b class="tile-count">${s.count}</b></div>`,
    )
    .join('');
  const rest = [count('wontfix') ? `${count('wontfix')} won't fix` : '', `${count('open')} open`].filter(Boolean).join(', ');
  return `<section class="summary" aria-label="Summary">
    ${tiles}
    <div class="progress">
      <div class="progress-head"><b>${esc(model.progress.text)}</b><span>${esc(rest)}</span></div>
      <div class="bar" role="img" aria-label="${esc(model.progress.text)}"><span class="fixed" style="width: ${pct(count('fixed'))}"></span><span class="wontfix" style="width: ${pct(count('wontfix'))}"></span></div>
      <ul class="legend"><li class="fixed"><i></i>Fixed</li><li class="wontfix"><i></i>Won't fix</li><li><i></i>Open</li></ul>
    </div>
  </section>`;
}

/**
 * The severity and status filter bar of the file. The preview leaves filtering to the report screen.
 * @param {object} model The review model.
 */
function filters(model) {
  const severities = model.severities.filter((s) => s.count > 0);
  const statuses = model.statuses.filter((s) => s.count > 0);
  if (model.total < 2) return '';
  const statusButtons =
    statuses.length > 1
      ? `<span class="sep"></span><button class="stat" type="button" data-status-filter="all" aria-pressed="true">Any status</button>${statuses
          .map((s) => `<button class="stat" type="button" data-status-filter="${s.key}" aria-pressed="false">${esc(s.label)} <b>${s.count}</b></button>`)
          .join('')}`
      : '';
  return `<div class="filters" role="toolbar" aria-label="Filter comments">
    <span class="label">Show</span>
    <button class="stat" type="button" data-filter="all" aria-pressed="true">All <b>${model.total}</b></button>
    ${severities
      .map((s) => `<button class="stat" type="button" data-filter="${s.key}" data-sev="${s.key}" aria-pressed="false">${shapeIcon(s.key)}${esc(s.label)} <b>${s.count}</b></button>`)
      .join('')}
    ${statusButtons}
  </div>`;
}

/**
 * The contents, grouped by page, each comment linking to its card.
 * @param {object} model The review model.
 */
function contents(model) {
  return `<nav class="toc" aria-label="Contents"><p class="eyebrow">Contents</p><div class="toc-groups">${model.sections
    .map(
      (section) =>
        `<div class="toc-group"><p class="toc-page"><span class="comm-n">${section.label}</span><span>${esc(section.route)}</span><span class="count">${section.comments.length}</span></p><ol>${section.comments
          .map(
            (comment) =>
              `<li data-sev="${esc(comment.severity.key)}"><a href="#c-${model.comments.indexOf(comment) + 1}"><span class="num">${comment.label}</span>${shapeIcon(comment.severity.key)}<span class="t">${esc(comment.title)}</span><span class="st" data-status="${esc(comment.status.key)}">${esc(comment.status.label)}</span></a></li>`,
          )
          .join('')}</ol></div>`,
    )
    .join('')}</div></nav>`;
}

/**
 * The report contents from a review model, without the surrounding document.
 * @param {object} model The review model.
 * @param {{ preview: boolean, flat: boolean }} options Whether this is the in-app preview, and whether to list comments flat by number.
 */
function bodyOf(model, { preview, flat }) {
  const withSummary = model.config.summary && model.total > 0;
  const cards = new Map(model.comments.map((comment, index) => [comment, issueCard(comment, index, { where: flat, preview })]));
  const listed = flat
    ? model.comments.map((comment) => cards.get(comment)).join('\n')
    : model.sections
        .map(
          (section) => `
  <section class="comm" id="comm-${section.number}">
    <header class="comm-head"><span class="comm-n">${section.label}</span><h2>${esc(section.route)}</h2><span class="count">${section.comments.length} ${section.comments.length === 1 ? 'comment' : 'comments'}</span></header>
    ${section.url ? `<p class="comm-url"><a href="${esc(section.url)}">${esc(section.url)}</a></p>` : ''}
    ${section.comments.map((comment) => cards.get(comment)).join('\n')}
  </section>`,
        )
        .join('\n');
  const empty = preview ? 'No comments yet. Open the page you want to review, then click Margin in the toolbar to start.' : 'No comments in this review.';
  const body = model.total
    ? `${listed}${
        preview ? '\n  <div class="empty" data-no-match hidden><p data-no-match-text></p><button class="stat" type="button" data-clear-filters>Clear search and filters</button></div>' : ''
      }`
    : `<p class="empty">${empty}</p>`;
  return `<div class="wrap">
  ${cover(model, !withSummary)}
  ${withSummary ? summary(model) : ''}
  ${preview ? '' : filters(model)}
  ${withSummary && model.total > 1 ? contents(model) : ''}
  ${body}
  <p class="made">Made with Margin</p>
</div>`;
}

/**
 * Renders the report contents, without the surrounding document. Comments are grouped by page as in every export,
 * unless the preview is sorted by number, which lists them flat. The preview shows every comment whatever the
 * statuses option says, leaves the filter bar to the report screen, and adds the hooks the screen edits through.
 * @param {object[]} issues The comments, in the order they were made.
 * @param {object} [options] The review model options (see buildReviewModel) and `preview`.
 */
export function renderBody(issues, { preview = false, ...options } = {}) {
  const model = buildReviewModel(issues, { ...options, preview });
  return bodyOf(model, { preview, flat: options.order === 'number' });
}

/**
 * Renders a self contained HTML report, grouped by page and sorted by severity like every export.
 * Images are already data URLs and the font is embedded, so the file opens correctly from anywhere with no other files.
 * @param {object[]} issues The comments, in the order they were made.
 * @param {object} [options] The review model options (see buildReviewModel).
 */
export function buildReport(issues, options = {}) {
  const model = buildReviewModel(issues, { ...options, order: 'severity', preview: false });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${esc(model.title)}</title>
<style>${FONT_FACES}${REPORT_CSS}${pageCss(model)}</style>
</head>
<body>
${bodyOf(model, { preview: false, flat: false })}
<script>(${wireFilters.toString()})(document);</script>
</body>
</html>`;
}
