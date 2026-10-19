import { SEVERITIES, SEVERITY_ORDER, severityOf } from './severity.js';
import { DEFAULT_FIELDS, withDefaults } from './fields.js';
import { markList } from './marks.js';

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const esc = escapeHtml;

export const REPORT_CSS = `
:root {
  color-scheme: light;
  --bg: #ffffff; --surface: #f7f8fb; --line: #e2e5ee;
  --ink: #12151c; --ink-2: #565d73;
  --accent: #e5484d;
  --sev-blocker: #d92020; --sev-major: #b26a00; --sev-minor: #1f5fd0; --sev-nit: #6b7280;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 40px;
  --radius: 8px;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: var(--s6) var(--s4) var(--s6);
  background: var(--bg); color: var(--ink);
  font: 14px/1.5 ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
}
.wrap { max-width: 1040px; margin: 0 auto; }
h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
header.top { display: flex; flex-wrap: wrap; gap: var(--s4); align-items: baseline; justify-content: space-between; }
.meta-top { font-size: 12px; color: var(--ink-2); }
.stats { display: flex; flex-wrap: wrap; gap: var(--s2); margin: var(--s4) 0 var(--s4); }
.stat {
  display: flex; align-items: baseline; gap: var(--s2);
  padding: var(--s2) var(--s3); font: inherit; font-size: 12px; font-weight: 600;
  color: var(--sev, var(--ink-2)); background: transparent;
  border: 1px solid var(--line); border-radius: var(--radius); cursor: pointer;
}
.stat b { font-size: 17px; font-weight: 650; color: var(--sev, var(--ink)); }
.stat[aria-pressed="true"] { border-color: currentColor; background: var(--surface); }
.issue { padding: var(--s5) 0; border-top: 1px solid var(--line); }
.issue:first-of-type { border-top: 0; padding-top: var(--s3); }
.issue[data-sev="blocker"] { --sev: var(--sev-blocker); }
.issue[data-sev="major"] { --sev: var(--sev-major); }
.issue[data-sev="minor"] { --sev: var(--sev-minor); }
.issue[data-sev="nit"] { --sev: var(--sev-nit); }
.issue.hide { display: none; }
.issue > header { display: flex; gap: var(--s3); align-items: baseline; }
.num { font-size: 12px; font-weight: 650; color: var(--ink-2); min-width: 24px; }
.issue h2 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; }
.key { font-size: 12px; font-weight: 600; white-space: nowrap; }
.where { margin: 2px 0 0 var(--s5); font-size: 12px; }
.where a { color: var(--ink-2); }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
  color: var(--sev); border: 1px solid var(--sev); border-radius: 4px; padding: 2px 6px;
}
.chip i { width: 7px; height: 7px; border-radius: 2px; background: var(--sev); }
.note { margin: var(--s2) 0 0 var(--s5); white-space: pre-wrap; max-width: 68ch; }
ol.marks { margin: var(--s2) 0 0 var(--s5); padding-left: var(--s5); max-width: 68ch; }
ol.marks li { padding-left: var(--s1); white-space: pre-wrap; }
ol.marks li::marker { color: var(--accent); font-weight: 650; }
dl.facts {
  margin: var(--s3) 0 0 var(--s5); display: grid; gap: 2px var(--s3);
  grid-template-columns: 76px minmax(0, 1fr); font-size: 12px;
}
dl.facts dt { color: var(--ink-2); font-weight: 600; }
dl.facts dd { margin: 0; overflow-wrap: anywhere; }
dl.facts dd code, .mono { font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
figure { margin: var(--s4) 0 0 var(--s5); }
figure img { display: block; max-width: 100%; border: 1px solid var(--line); border-radius: 6px; }
figcaption { margin-top: var(--s1); font-size: 11px; font-weight: 600; color: var(--ink-2); }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s3); margin: var(--s4) 0 0 var(--s5); }
.pair figure { margin: 0; }
.empty { border: 1px dashed var(--line); border-radius: var(--radius); padding: var(--s6); text-align: center; color: var(--ink-2); }
@media (max-width: 560px) {
  .note, ol.marks, dl.facts, figure, .pair { margin-left: 0; }
  .pair { grid-template-columns: minmax(0, 1fr); }
  dl.facts { grid-template-columns: 74px minmax(0, 1fr); }
  .issue > header { flex-wrap: wrap; }
}
@media print {
  body { padding: 0; }
  .stats { display: none; }
  .issue { break-inside: avoid; }
}
`;

/**
 * Dark palette for the in-extension preview only. Exported files stay light so
 * they survive printing and an import into another editor.
 */
export const PREVIEW_DARK_CSS = `
@media screen and (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --bg: #0d1017; --surface: #141924; --line: #262c3b;
    --ink: #e9ecf5; --ink-2: #99a1b8;
    --sev-blocker: #f2585b; --sev-major: #f0a93a; --sev-minor: #62a0f5; --sev-nit: #9aa2b6;
  }
}
`;

/**
 * Wires the severity filter bar. Called directly by the in-extension preview and
 * serialised into the exported file, so both behave the same.
 */
export function wireFilters(root) {
  const buttons = root.querySelectorAll('.stats [data-filter]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.filter;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      root.querySelectorAll('.issue').forEach((issue) => {
        issue.classList.toggle('hide', key !== 'all' && issue.dataset.sev !== key);
      });
    });
  });
}

const looksLikeId = (part) =>
  /^\d+$/.test(part) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part) || (/\d/.test(part) && /^[\w-]{16,}$/.test(part));

const screenWord = (part) => {
  const words = part.replace(/[-_]+/g, ' ').trim();
  if (/^[a-z]{2,4}$/i.test(words) && !/[aeiouy]/i.test(words)) return words.toUpperCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Where a comment was made, as "App > Screen > Path". The app is the site part
 * of the tab title, else the host; the screen path comes from Flutter's #/
 * route when there is one, else the URL path, with record ids left out.
 *
 * @param {{ url: string, title?: string }} page The captured page.
 */
export function routeOf(page) {
  let parsed;
  try {
    parsed = new URL(page.url);
  } catch {
    return page.url ?? '';
  }
  const app = page.title?.split(/\s[|\-:]\s/).pop()?.trim() || parsed.host;
  const route = parsed.hash.startsWith('#/') ? parsed.hash.slice(1).split('?')[0] : parsed.pathname;
  const screens = route
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .filter((part) => !looksLikeId(part))
    .map(screenWord);
  return [app, ...(screens.length ? screens : ['Home'])].join(' > ');
}

function factRows(issue, fields) {
  const el = issue.element;
  const rows = [
    fields.figma && issue.links?.length
      ? ['Figma', issue.links.map((url, i) => `<a href="${esc(url)}">Link ${i + 1}</a>`).join(' ')]
      : null,
    fields.selector && el?.selector ? ['Selector', `<code>${esc(el.selector)}</code>`] : null,
    fields.element && el
      ? ['Element', `<code>${esc(el.tag)}${el.classes ? `.${esc(el.classes.split(' ').join('.'))}` : ''}</code>`]
      : null,
    fields.text && el?.text ? ['Text', esc(el.text)] : null,
    fields.styles && el?.styles
      ? ['Styles', `<span class="mono">${esc(el.styles.font)}, ${esc(el.styles.color)}</span>`]
      : null,
    fields.position
      ? [
          'Position',
          `<span class="mono">${issue.rect.w} x ${issue.rect.h} at ${issue.rect.x}, ${issue.rect.y} in ${issue.viewport.width} x ${issue.viewport.height} at ${issue.viewport.dpr}x</span>`,
        ]
      : null,
    fields.captured ? ['Captured', esc(new Date(issue.createdAt).toLocaleString())] : null,
  ].filter(Boolean);
  return rows.map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join('\n        ');
}

/**
 * The marked region image, or the region before and after a recheck side by side.
 * @param {object} issue The stored comment.
 * @param {number} index Its position in the report.
 */
function regionFigures(issue, index) {
  const before = `<img alt="Marked region for comment ${index + 1}" src="${issue.detail}" />`;
  if (!issue.after) return `<figure>${before}</figure>`;
  return `<div class="pair">
        <figure>${before}<figcaption>Before</figcaption></figure>
        <figure><img class="after" alt="Same region after recheck for comment ${index + 1}" src="${issue.after}" /><figcaption>${esc(recheckCaption(issue))}</figcaption></figure>
      </div>`;
}

/**
 * Caption for the image taken when a comment was rechecked.
 * @param {{ checkedAt?: string }} issue The stored comment.
 */
export function recheckCaption(issue) {
  return issue.checkedAt ? `After, rechecked ${new Date(issue.checkedAt).toLocaleString()}` : 'After recheck';
}

function issueCard(issue, index, shots, fields) {
  const sev = severityOf(issue.severity);
  return `
    <article class="issue" id="c-${index + 1}" data-sev="${esc(sev.key)}">
      <header>
        <span class="num">${String(index + 1).padStart(2, '0')}</span>
        <h2>${esc(issue.title || 'Untitled issue')}</h2>
        ${
          fields.jira && issue.jira?.key
            ? `<a class="key" href="${esc(issue.jira.url)}">${esc(issue.jira.key)}, ${esc(issue.jira.status ?? 'New')}</a>`
            : ''
        }
        <span class="chip"><i></i>${esc(sev.label)}</span>
      </header>
      ${fields.page ? `<p class="where"><a href="${esc(issue.page.url)}">${esc(routeOf(issue.page))}</a></p>` : ''}
      ${issue.note ? `<p class="note">${esc(issue.note)}</p>` : ''}
      ${
        markList(issue).length
          ? `<ol class="marks">${markList(issue)
              .map((item) => `<li value="${item.n}">${esc(item.note)}</li>`)
              .join('')}</ol>`
          : ''
      }
      ${issue.detail && shots !== 'viewport' ? regionFigures(issue, index) : ''}
      <dl class="facts">
        ${factRows(issue, fields)}
      </dl>
      ${
        issue.shot && shots !== 'detail'
          ? `<figure class="wide"><img alt="Full viewport for comment ${index + 1}" src="${issue.shot}" /><figcaption>Full viewport</figcaption></figure>`
          : ''
      }
    </article>`;
}

/** Sorts by severity first, then by capture time. */
export function sortIssues(issues) {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(severityOf(a.severity).key) - SEVERITY_ORDER.indexOf(severityOf(b.severity).key) ||
      String(a.createdAt).localeCompare(String(b.createdAt)),
  );
}

/** Renders the report contents, without the surrounding document. */
export function renderBody(issues, { title = 'UI issue report', generatedAt = new Date(), shots = 'both', fields = DEFAULT_FIELDS } = {}) {
  const sorted = sortIssues(issues);
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s.key, sorted.filter((i) => severityOf(i.severity).key === s.key).length]),
  );
  const pages = [...new Set(sorted.map((i) => i.page?.url).filter(Boolean))];

  const body = sorted.length
    ? sorted.map((issue, index) => issueCard(issue, index, shots, withDefaults(fields))).join('\n')
    : '<p class="empty">No issues captured.</p>';

  return `<div class="wrap">
  <header class="top">
    <h1>${esc(title)}</h1>
    <div class="meta-top">${esc(generatedAt.toLocaleString())}, ${pages.length} page${pages.length === 1 ? '' : 's'}</div>
  </header>
  <div class="stats">
    <button class="stat" type="button" data-filter="all" aria-pressed="true"><b>${sorted.length}</b> issues</button>
    ${SEVERITIES.filter((s) => counts[s.key] > 0)
      .map(
        (s) =>
          `<button class="stat" type="button" data-filter="${s.key}" style="--sev: var(${s.token})" aria-pressed="false"><b>${counts[s.key]}</b> ${s.label}</button>`,
      )
      .join('\n    ')}
  </div>
  ${body}
</div>`;
}

/**
 * Renders a self contained HTML report. Images are already data URLs, so the
 * returned string opens correctly from anywhere with no other files.
 */
export function buildReport(issues, options = {}) {
  const title = options.title ?? 'UI issue report';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
${renderBody(issues, options)}
<script>(${wireFilters.toString()})(document);</script>
</body>
</html>`;
}
