import { buildReviewModel } from './review-model.js';
import { icon } from './icons.js';

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const esc = escapeHtml;

const SEVERITY_ICONS = { blocker: 'sevBlocker', major: 'sevMajor', minor: 'sevMinor', nit: 'sevNit' };
const STATUS_ICONS = { open: 'statusOpen', fixed: 'statusFixed', wontfix: 'statusWontfix' };

export const REPORT_CSS = `
:root {
  color-scheme: light;
  --bg: #ffffff; --surface: #f0eefe; --line: #e2ddf5;
  --ink: #000000; --ink-2: #5b5670;
  --accent: #e5484d; --success: #18794e;
  --sev-blocker: #ce2c31; --sev-major: #c2410c; --sev-minor: #0d74ce; --sev-nit: #60646c;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 40px;
  --radius: 12px;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: var(--s6) var(--s4) var(--s6);
  background: var(--bg); color: var(--ink);
  font: 500 14px/1.55 Manrope, ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1040px; margin: 0 auto; }
h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
a { color: var(--ink-2); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
a:hover { color: var(--ink); text-decoration-color: currentColor; }
header.top { display: flex; flex-wrap: wrap; gap: var(--s4); align-items: baseline; justify-content: space-between; }
.meta-top { font-size: 12px; color: var(--ink-2); }
.stats { display: flex; flex-wrap: wrap; gap: var(--s1); margin: var(--s4) 0 var(--s4); }
.stat {
  display: inline-flex; align-items: center; gap: 6px; height: 28px;
  padding: 0 var(--s3); font: inherit; font-size: 12px; font-weight: 500;
  color: var(--ink-2); background: transparent;
  border: 1px solid var(--line); border-radius: 999px; cursor: pointer;
}
.stat b { font-weight: 800; color: var(--sev, var(--ink)); }
.stat[aria-pressed="true"] { color: var(--bg); background: var(--ink); border-color: var(--ink); }
.stat[aria-pressed="true"] b { color: inherit; }
.comm { margin-top: var(--s5); }
.comm-head { display: flex; flex-wrap: wrap; gap: var(--s3); align-items: baseline; margin: 0; font-size: 18px; font-weight: 800; letter-spacing: -0.01em; }
.comm-n { font-size: 12px; font-weight: 800; color: var(--ink-2); min-width: 24px; }
.comm-url { margin: 2px 0 0 calc(24px + var(--s3)); font-size: 12px; overflow-wrap: anywhere; }
.issue { padding: var(--s5) 0; border-top: 1px solid var(--line); }
.issue:first-of-type { border-top: 0; padding-top: var(--s3); }
.issue[data-sev="blocker"] { --sev: var(--sev-blocker); }
.issue[data-sev="major"] { --sev: var(--sev-major); }
.issue[data-sev="minor"] { --sev: var(--sev-minor); }
.issue[data-sev="nit"] { --sev: var(--sev-nit); }
.issue.hide, .comm.hide { display: none; }
.issue > header { display: flex; gap: var(--s3); align-items: baseline; flex-wrap: wrap; }
.num { font-size: 12px; font-weight: 800; color: var(--ink-2); min-width: 24px; }
.issue h3 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; flex: 1; min-width: 12ch; }
.where { margin: 2px 0 0 calc(24px + var(--s3)); font-size: 12px; }
.ico { display: inline-flex; flex: none; width: 12px; height: 12px; }
.ico svg { display: block; width: 100%; height: 100%; }
.chip, .status {
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  font-size: 12px; font-weight: 600;
}
.chip { color: var(--sev); }
.chip .ico { width: 9px; height: 9px; }
.status { color: var(--ink); }
.status[data-status="fixed"] { color: var(--success); }
.status[data-status="wontfix"] { color: var(--ink-2); }
.stats .sep { width: 1px; align-self: stretch; margin: 0 var(--s1); background: var(--line); }
.note, ol.marks, dl.facts, .issue figure, .pair, .widths, details.full { margin-left: calc(24px + var(--s3)); }
.note { margin-top: var(--s2); margin-bottom: 0; white-space: pre-wrap; max-width: 68ch; }
ol.marks { margin-top: var(--s2); margin-bottom: 0; padding-left: var(--s5); max-width: 68ch; }
ol.marks li { padding-left: var(--s1); white-space: pre-wrap; }
ol.marks li::marker { color: var(--accent); font-weight: 800; }
dl.facts {
  margin-top: var(--s3); margin-bottom: 0; display: grid; gap: 2px var(--s3);
  grid-template-columns: 76px minmax(0, 1fr); font-size: 12px;
}
dl.facts dt { color: var(--ink-2); font-weight: 600; }
dl.facts dd { margin: 0; overflow-wrap: anywhere; }
dl.facts dd code, .mono { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
figure { margin: var(--s4) 0 0; }
figure img { display: block; max-width: 100%; border: 1px solid var(--line); border-radius: 8px; }
figcaption { margin-top: var(--s1); font-size: 12px; font-weight: 600; color: var(--ink-2); }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s3); margin-top: var(--s4); }
.pair figure, .widths figure, details.full figure { margin-left: 0; }
.pair figure { margin-top: 0; }
.widths { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s3); align-items: start; margin-top: var(--s4); }
.widths figure { margin-top: 0; }
details.full { margin-top: var(--s3); }
details.full > summary { width: fit-content; font-size: 12px; font-weight: 600; color: var(--ink-2); cursor: pointer; }
details.full > summary:hover { color: var(--ink); }
details.full figure { margin-top: var(--s2); }
.issue { scroll-margin-top: var(--s4); }
details.tech { margin: var(--s3) 0 0 calc(24px + var(--s3)); }
details.tech > summary, details.full > summary {
  display: inline-flex; align-items: center; gap: 6px; width: fit-content; list-style: none;
  font-size: 12px; font-weight: 600; color: var(--ink-2); cursor: pointer; user-select: none;
}
details.tech > summary::-webkit-details-marker, details.full > summary::-webkit-details-marker { display: none; }
details.tech > summary::before, details.full > summary::before {
  content: ""; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg); transition: transform 120ms ease-out;
}
details.tech[open] > summary::before, details.full[open] > summary::before { transform: rotate(45deg); }
details.tech > summary:hover { color: var(--ink); }
details.tech dl.facts { margin-left: 0; margin-top: var(--s2); }
.toc { margin: 0 0 var(--s5); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
.toc-page { margin: 0; padding: var(--s3) var(--s3) 0; font-size: 12px; font-weight: 800; color: var(--ink-2); }
.toc ol { list-style: none; margin: 0; padding: var(--s1); display: grid; gap: 1px; }
.toc a { display: grid; grid-template-columns: 24px 8px minmax(0, 1fr) auto; gap: var(--s2); align-items: center; padding: 6px var(--s2); border-radius: 8px; text-decoration: none; color: var(--ink); font-size: 13px; }
.toc a:hover { background: var(--surface); }
.toc .num { font-size: 12px; font-weight: 800; color: var(--ink-2); }
.toc .dot { width: 8px; height: 8px; border-radius: 2px; background: var(--sev); }
.toc li[data-sev="blocker"] { --sev: var(--sev-blocker); }
.toc li[data-sev="major"] { --sev: var(--sev-major); }
.toc li[data-sev="minor"] { --sev: var(--sev-minor); }
.toc li[data-sev="nit"] { --sev: var(--sev-nit); }
.toc .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toc .s { font-size: 12px; color: var(--ink-2); }
.made { margin: var(--s6) 0 0; font-size: 12px; color: var(--ink-2); text-align: center; }
.empty { border: 1px dashed var(--line); border-radius: var(--radius); padding: var(--s6); text-align: center; color: var(--ink-2); }
.empty[hidden] { display: none; }
@media (max-width: 560px) {
  details.tech, .note, ol.marks, dl.facts, .issue figure, .pair, .widths, .where, .comm-url, details.full { margin-left: 0; }
  .pair, .widths { grid-template-columns: minmax(0, 1fr); }
  dl.facts { grid-template-columns: 74px minmax(0, 1fr); }
}
@media print {
  body { padding: 0; }
  .stats, .toc { display: none; }
  details.tech > summary, details.full > summary { display: none; }
  .issue { break-inside: avoid; }
}
`;

/**
 * Dark palette for the in-extension preview only, shown when the Theme setting is dark.
 * Exported files stay light so they survive printing and an import into another editor.
 */
export const PREVIEW_DARK_CSS = `
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #000000; --surface: #1c1830; --line: #2f2a45;
  --ink: #ffffff; --ink-2: #ada7c4;
  --accent: #ff7a7a; --success: #3dd68c;
  --sev-blocker: #ff9592; --sev-major: #ffa057; --sev-minor: #70b8ff; --sev-nit: #b0b4ba;
}
`;

/**
 * Wires the severity and status filter bar of an exported report, so the file filters on its own.
 * @param {Document} root The report document.
 */
export function wireFilters(root) {
  const picked = { filter: 'all', statusFilter: 'all' };
  const buttons = [...root.querySelectorAll('.stats [data-filter], .stats [data-status-filter]')];
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
 * The severity of a comment as its icon and label, coloured by severity.
 * @param {{ key: string, label: string }} sev The severity.
 */
export const severityBadge = (sev) => `<span class="chip">${icon(SEVERITY_ICONS[sev.key])}${esc(sev.label)}</span>`;

/**
 * The status of a comment as its icon and label, in the status colour.
 * @param {{ key: string, label: string }} status The status.
 */
export const statusBadge = (status) => `<span class="status" data-status="${esc(status.key)}">${icon(STATUS_ICONS[status.key])}${esc(status.label)}</span>`;

/**
 * The value of a detail row as HTML: its links named and linked, or its text, with code rows wrapped for a monospace face.
 * @param {import('./review-model.js').DetailRow} row The detail row.
 * @param {(html: string) => string} [code] Wraps a code value, since the Docs export can only style inline.
 */
export function rowHtml(row, code = (html) => `<code>${html}</code>`) {
  if (row.links) {
    const links = row.links.map((l) => (l.url ? `<a href="${esc(l.url)}">${esc(l.text)}</a>` : esc(l.text))).join(', ');
    return row.extra ? `${links}, ${esc(row.extra)}` : links;
  }
  return row.code ? code(esc(row.value)) : esc(row.value);
}

/**
 * The marked region image, or the region before and after a recheck side by side.
 * @param {object} comment The comment from the review model.
 */
function regionFigures({ images, number }) {
  const before = `<img alt="Marked region for comment ${number}" src="${images.region}" />`;
  if (!images.after) return `<figure>${before}</figure>`;
  return `<div class="pair">
        <figure>${before}<figcaption>Before</figcaption></figure>
        <figure><img class="after" alt="Same region after recheck for comment ${number}" src="${images.after}" /><figcaption>${esc(images.afterCaption)}</figcaption></figure>
      </div>`;
}

/**
 * The region at mobile, tablet and desktop widths in one row, or nothing when the comment was not captured at widths.
 * @param {object} comment The comment from the review model.
 */
function widthFigures({ images, number }) {
  if (!images.widths.length) return '';
  return `<div class="widths">
        ${images.widths
          .map(
            (shot) =>
              `<figure><img class="at-width" alt="${esc(shot.label)} width for comment ${number}" src="${shot.src}" /><figcaption>${esc(shot.caption)}</figcaption></figure>`,
          )
          .join('\n        ')}
      </div>`;
}

/**
 * The full viewport screenshot, folded away when the comment also has its region image, so long reviews stay short.
 * @param {object} comment The comment from the review model.
 */
function fullFigure({ images, number }) {
  const figure = `<figure class="wide"><img alt="Full viewport for comment ${number}" src="${images.full}" /><figcaption>Full viewport</figcaption></figure>`;
  return images.region ? `<details class="full"><summary>Show full screenshot</summary>${figure}</details>` : figure;
}

/**
 * One comment card.
 * @param {object} comment The comment from the review model.
 * @param {number} index Its position in the report, which names the card.
 * @param {boolean} where True to name the page under the title, for the flat list that has no page headings.
 */
function issueCard(comment, index, where) {
  const { severity, status, rows } = comment;
  return `
    <article class="issue" id="c-${index + 1}" data-sev="${esc(severity.key)}" data-status="${esc(status.key)}">
      <header>
        <span class="num">${comment.label}</span>
        <h3>${esc(comment.title)}</h3>
        ${severityBadge(severity)}
        ${statusBadge(status)}
      </header>
      ${where && comment.url ? `<p class="where"><a href="${esc(comment.url)}">${esc(comment.route)}</a></p>` : ''}
      ${comment.note ? `<p class="note">${esc(comment.note)}</p>` : ''}
      ${comment.marks.length ? `<ol class="marks">${comment.marks.map((item) => `<li value="${item.n}">${esc(item.note)}</li>`).join('')}</ol>` : ''}
      ${comment.images.region ? regionFigures(comment) : ''}
      ${widthFigures(comment)}
      ${
        rows.length
          ? `<details class="tech"><summary>Technical details</summary><dl class="facts">
        ${rows.map((row) => `<dt>${esc(row.label)}</dt><dd>${rowHtml(row)}</dd>`).join('\n        ')}
      </dl></details>`
          : ''
      }
      ${comment.images.full ? fullFigure(comment) : ''}
    </article>`;
}

/**
 * Renders the report contents, without the surrounding document. Comments are grouped by page as in every export,
 * unless the preview is sorted by number, which lists them flat.
 * The preview leaves the filter bar to the sidebar and adds an empty search message.
 */
export function renderBody(issues, { preview = false, ...options } = {}) {
  const model = buildReviewModel(issues, options);
  const flat = options.order === 'number';
  const cards = new Map(model.comments.map((comment, index) => [comment, issueCard(comment, index, flat)]));
  const statusesUsed = model.statuses.filter((s) => s.count > 0);
  const statusButtons =
    statusesUsed.length > 1
      ? [
          '<span class="sep"></span>',
          '<button class="stat" type="button" data-status-filter="all" aria-pressed="true">Any status</button>',
          ...statusesUsed.map(
            (s) => `<button class="stat" type="button" data-status-filter="${s.key}" aria-pressed="false"><b>${s.count}</b> ${esc(s.label)}</button>`,
          ),
        ].join('\n    ')
      : '';
  const empty = preview
    ? 'No comments yet. Open the page you want to review, then click Margin in the toolbar to start.'
    : 'No comments in this review.';
  const listed = flat
    ? model.comments.map((comment) => cards.get(comment)).join('\n')
    : model.sections
        .map(
          (section) => `
  <section class="comm">
    <h2 class="comm-head"><span class="comm-n">${section.label}</span>${esc(section.route)}</h2>
    ${section.url ? `<p class="comm-url"><a href="${esc(section.url)}">${esc(section.url)}</a></p>` : ''}
    ${section.comments.map((comment) => cards.get(comment)).join('\n')}
  </section>`,
        )
        .join('\n');
  const body = model.total
    ? `${listed}${
        preview ? '\n  <div class="empty" data-no-match hidden><p data-no-match-text></p><button class="stat" type="button" data-clear-filters>Clear search and filters</button></div>' : ''
      }`
    : `<p class="empty">${empty}</p>`;
  const stats = preview
    ? ''
    : `<div class="stats">
    <button class="stat" type="button" data-filter="all" aria-pressed="true"><b>${model.total}</b> ${model.total === 1 ? 'comment' : 'comments'}</button>
    ${model.severities
      .filter((s) => s.count > 0)
      .map(
        (s) =>
          `<button class="stat" type="button" data-filter="${s.key}" style="--sev: var(${s.token})" aria-pressed="false"><b>${s.count}</b> ${s.label}</button>`,
      )
      .join('\n    ')}
    ${statusButtons}
  </div>`;

  const contents =
    preview || model.total < 2
      ? ''
      : `<nav class="toc" aria-label="Contents">${model.sections
          .map(
            (section) =>
              `<p class="toc-page">${section.label} ${esc(section.route)}</p><ol>${section.comments
                .map(
                  (comment) =>
                    `<li data-sev="${esc(comment.severity.key)}"><a href="#c-${model.comments.indexOf(comment) + 1}"><span class="num">${comment.label}</span><span class="dot"></span><span class="t">${esc(comment.title)}</span><span class="s">${esc(comment.status.label)}</span></a></li>`,
                )
                .join('')}</ol>`,
          )
          .join('')}</nav>`;
  return `<div class="wrap">
  <header class="top">
    <h1>${esc(model.title)}</h1>
    <div class="meta-top">${esc(model.date)}, ${esc(model.summary)}</div>
  </header>
  ${stats}
  ${contents}
  ${body}
  ${preview ? '' : '<p class="made">Made with Margin</p>'}
</div>`;
}

/**
 * Renders a self contained HTML report, grouped by page and sorted by severity like every export.
 * Images are already data URLs, so the returned string opens correctly from anywhere with no other files.
 */
export function buildReport(issues, options = {}) {
  const title = options.title ?? 'UI review';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
${renderBody(issues, { ...options, order: 'severity', preview: false })}
<script>(${wireFilters.toString()})(document);</script>
</body>
</html>`;
}
