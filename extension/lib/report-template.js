import { SEVERITIES, SEVERITY_ORDER, severityOf } from './severity.js';
import { STATUSES, statusOf } from './status.js';
import { DEFAULT_FIELDS, withDefaults } from './fields.js';
import { markList } from './marks.js';
import { widthCaption, widthShots } from './widths.js';
import { icon } from './icons.js';

export const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const esc = escapeHtml;
const pad = (n) => String(n).padStart(2, '0');

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
.issue { padding: var(--s5) 0; border-top: 1px solid var(--line); }
.issue:first-of-type { border-top: 0; padding-top: var(--s3); }
.issue[data-sev="blocker"] { --sev: var(--sev-blocker); }
.issue[data-sev="major"] { --sev: var(--sev-major); }
.issue[data-sev="minor"] { --sev: var(--sev-minor); }
.issue[data-sev="nit"] { --sev: var(--sev-nit); }
.issue.hide { display: none; }
.issue > header { display: flex; gap: var(--s3); align-items: baseline; flex-wrap: wrap; }
.num { font-size: 12px; font-weight: 800; color: var(--ink-2); min-width: 24px; }
.issue h2 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; flex: 1; min-width: 12ch; }
.key { font-size: 12px; font-weight: 600; white-space: nowrap; }
.key-status { font-size: 12px; color: var(--ink-2); white-space: nowrap; }
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
  details.tech, .note, ol.marks, dl.facts, .issue figure, .pair, .widths, .where, details.full { margin-left: 0; }
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
    });
  });
  root.defaultView?.addEventListener('beforeprint', () => {
    root.querySelectorAll('details:not([open])').forEach((d) => {
      d.open = true;
    });
  });
}

/**
 * Numbers comments in the order they were made, counting within each review, so a comment keeps one number
 * in the report, the exports, the Send dialogs and the All reviews view.
 * @param {object[]} issues Every comment shown, in the order they were made.
 * @returns {(issue: {id: string}) => number} The number of a comment.
 */
export function numbering(issues) {
  const counts = new Map();
  const numbers = new Map();
  for (const issue of issues) {
    const n = (counts.get(issue.groupId) ?? 0) + 1;
    counts.set(issue.groupId, n);
    numbers.set(issue.id, n);
  }
  return (issue) => numbers.get(issue.id) ?? 0;
}

const looksLikeId = (part) =>
  /^\d+$/.test(part) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part) || (/\d/.test(part) && /^[\w-]{16,}$/.test(part));

const screenWord = (part) => {
  const words = part.replace(/[-_]+/g, ' ').trim();
  if (/^[a-z]{2,4}$/i.test(words) && !/[aeiouy]/i.test(words)) return words.toUpperCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The site name in a tab title. "Page | Site" and "Page - Site" put it last, "Site: tagline" puts it first.
 * @param {string} [title] The tab title.
 */
function appOf(title) {
  const text = title?.trim() ?? '';
  const parts = text.split(/\s[|-]\s/);
  if (parts.length > 1) return parts.at(-1).trim();
  return text.split(/:\s/)[0].trim();
}

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
  const app = appOf(page.title) || parsed.host;
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

/**
 * The browser line for a comment, such as "Google Chrome 141 on Windows, zoom 100%", or an empty string for comments captured before it was recorded.
 * @param {{ env?: { browser: string, os: string, zoom: number } }} issue The stored comment.
 */
export function environmentText(issue) {
  const env = issue.env;
  if (!env) return '';
  return `${env.browser}${env.os ? ` on ${env.os}` : ''}${env.zoom ? `, zoom ${env.zoom}%` : ''}`;
}

const isFigma = (url) => /^https:\/\/([\w-]+\.)?figma\.com\//i.test(url);

/**
 * The label for a comment's links: Figma when every link is a Figma link, else Links.
 * @param {string[]} links The comment's links.
 */
export function linksLabel(links) {
  return links.length && links.every(isFigma) ? 'Figma' : 'Links';
}

/**
 * A readable name for one of a comment's links: the frame name when the comment was matched to one,
 * Figma frame for other Figma links, else the site the link goes to.
 * @param {string} url The link.
 * @param {number} i Its place among the comment's links.
 * @param {object} issue The stored comment.
 */
export function linkName(url, i, issue) {
  if (isFigma(url)) {
    if (i === 0 && issue.figmaFrame?.name) return issue.figmaFrame.name;
    const figmas = (issue.links ?? []).filter(isFigma).length;
    return figmas > 1 ? `Figma frame ${(issue.links ?? []).filter(isFigma).indexOf(url) + 1}` : 'Figma frame';
  }
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Turns a computed colour such as rgb(0 0 0) or lab(96.5 0 0) into a hex code, leaving other formats as they are.
 * @param {string} value The colour as the browser reported it.
 */
export function hexColour(value) {
  const text = String(value ?? '').trim();
  const nums = text.match(/-?[\d.]+(?:e-?\d+)?%?/gi)?.map((n) => (n.endsWith('%') ? Number(n.slice(0, -1)) / 100 : Number(n))) ?? [];
  const hex = (r, g, b, a = 1) => {
    const part = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}${a < 1 ? part(a) : ''}`;
  };
  if (/^rgba?\(/i.test(text) && nums.length >= 3) return hex(nums[0] / 255, nums[1] / 255, nums[2] / 255, nums[3] ?? 1);
  if (/^color\(srgb\s/i.test(text) && nums.length >= 3) return hex(nums[0], nums[1], nums[2], nums[3] ?? 1);
  if (/^okl(ab|ch)\(/i.test(text) && nums.length >= 3) {
    const [l, c, h] = nums;
    const [a, b] = /^oklch/i.test(text) ? [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] : [c, h];
    const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
    return hex(
      gamma(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp),
      gamma(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp),
      gamma(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp),
      nums[3] ?? 1,
    );
  }
  if (/^lab\(/i.test(text) && nums.length >= 3) {
    const [l, a, b] = nums;
    const fy = (l + 16) / 116;
    const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (116 * t - 16) / 903.3);
    const x = 0.96422 * inv(fy + a / 500);
    const y = l > 8 ? fy ** 3 : l / 903.3;
    const z = 0.82521 * inv(fy - b / 200);
    const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    return hex(
      gamma(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
      gamma(-0.9787684 * x + 1.9161415 * y + 0.033454 * z),
      gamma(0.0719453 * x - 0.2289914 * y + 1.4052427 * z),
      nums[3] ?? 1,
    );
  }
  return text;
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

function factRows(issue, fields) {
  const el = issue.element;
  const rows = [
    fields.figma && issue.links?.length
      ? [linksLabel(issue.links), issue.links.map((url, i) => `<a href="${esc(url)}">${esc(linkName(url, i, issue))}</a>`).join(', ')]
      : null,
    fields.selector && el?.selector ? ['Selector', `<code>${esc(el.selector)}</code>`] : null,
    fields.element && el
      ? ['Element', `<code>${esc(el.tag)}${el.classes ? `.${esc(el.classes.split(' ').join('.'))}` : ''}</code>`]
      : null,
    fields.text && el?.text ? ['Text', esc(el.text)] : null,
    fields.styles && el?.styles
      ? ['Styles', `<span class="mono">${esc(el.styles.font)}, ${esc(hexColour(el.styles.color))}</span>`]
      : null,
    fields.position
      ? [
          'Position',
          `<span class="mono">${issue.rect.w} x ${issue.rect.h} at ${issue.rect.x}, ${issue.rect.y} in ${issue.viewport.width} x ${issue.viewport.height} at ${issue.viewport.dpr}x</span>`,
        ]
      : null,
    fields.captured ? ['Captured', esc(new Date(issue.createdAt).toLocaleString())] : null,
    fields.browser && issue.env ? ['Browser', esc(environmentText(issue))] : null,
  ].filter(Boolean);
  return rows.map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`).join('\n        ');
}

/**
 * The marked region image, or the region before and after a recheck side by side.
 * @param {object} issue The stored comment.
 * @param {number} number Its comment number.
 */
function regionFigures(issue, number) {
  const before = `<img alt="Marked region for comment ${number}" src="${issue.detail}" />`;
  if (!issue.after) return `<figure>${before}</figure>`;
  return `<div class="pair">
        <figure>${before}<figcaption>Before</figcaption></figure>
        <figure><img class="after" alt="Same region after recheck for comment ${number}" src="${issue.after}" /><figcaption>${esc(recheckCaption(issue))}</figcaption></figure>
      </div>`;
}

/**
 * The region at mobile, tablet and desktop widths in one row, or nothing when the comment was not captured at widths.
 * @param {object} issue The stored comment.
 * @param {number} number Its comment number.
 */
function widthFigures(issue, number) {
  const shots = widthShots(issue);
  if (!shots.length) return '';
  return `<div class="widths">
        ${shots
          .map(
            (shot) =>
              `<figure><img class="at-width" alt="${esc(shot.label)} width for comment ${number}" src="${shot.src}" /><figcaption>${esc(widthCaption(shot))}</figcaption></figure>`,
          )
          .join('\n        ')}
      </div>`;
}

/**
 * The full viewport screenshot. In the preview it folds away when the comment also has its region image, so long reviews stay short.
 * @param {object} issue The stored comment.
 * @param {number} number Its comment number.
 * @param {boolean} fold True to fold it behind a toggle.
 */
function fullFigure(issue, number, fold) {
  const figure = `<figure class="wide"><img alt="Full viewport for comment ${number}" src="${issue.shot}" /><figcaption>Full viewport</figcaption></figure>`;
  return fold ? `<details class="full"><summary>Show full screenshot</summary>${figure}</details>` : figure;
}

/**
 * Caption for the image taken when a comment was rechecked.
 * @param {{ checkedAt?: string }} issue The stored comment.
 */
export function recheckCaption(issue) {
  return issue.checkedAt ? `After, rechecked ${new Date(issue.checkedAt).toLocaleString()}` : 'After recheck';
}

/**
 * One comment card.
 * @param {object} issue The stored comment.
 * @param {number} index Its position in the report, which names the card.
 * @param {object} options Which images, fields and widths to show, and whether this is the preview.
 * @param {number} number Its comment number.
 */
function issueCard(issue, index, { shots, fields, widths, preview }, number) {
  const sev = severityOf(issue.severity);
  const status = statusOf(issue.status);
  const region = issue.detail && shots !== 'viewport';
  const facts = factRows(issue, fields);
  return `
    <article class="issue" id="c-${index + 1}" data-sev="${esc(sev.key)}" data-status="${esc(status.key)}">
      <header>
        <span class="num">${pad(number)}</span>
        <h2>${esc(issue.title || 'Untitled comment')}</h2>
        ${
          fields.jira && issue.jira?.key
            ? `<a class="key" href="${esc(issue.jira.url)}">${esc(issue.jira.key)}</a>${issue.jira.status ? `<span class="key-status">${esc(issue.jira.status)}</span>` : ''}`
            : ''
        }
        ${statusBadge(status)}
        ${severityBadge(sev)}
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
      ${region ? regionFigures(issue, number) : ''}
      ${widths ? widthFigures(issue, number) : ''}
      ${facts ? `<details class="tech"><summary>Technical details</summary><dl class="facts">
        ${facts}
      </dl></details>` : ''}
      ${issue.shot && shots !== 'detail' ? fullFigure(issue, number, region) : ''}
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

/**
 * The comments in the order the report lists them: by severity, or by number.
 * @param {object[]} issues The comments, in the order they were made.
 * @param {'severity' | 'number'} [order] How to sort.
 */
export function orderIssues(issues, order = 'severity') {
  return order === 'number' ? [...issues] : sortIssues(issues);
}

/**
 * Renders the report contents, without the surrounding document.
 * The preview leaves the filter bar to the sidebar, folds the full screenshots and adds an empty search message.
 */
export function renderBody(
  issues,
  { title = 'UI review', generatedAt = new Date(), shots = 'both', fields = DEFAULT_FIELDS, widths = true, order = 'severity', preview = false } = {},
) {
  const sorted = orderIssues(issues, order);
  const numberOf = numbering(issues);
  const counts = Object.fromEntries(
    SEVERITIES.map((s) => [s.key, sorted.filter((i) => severityOf(i.severity).key === s.key).length]),
  );
  const pages = [...new Set(sorted.map((i) => i.page?.url).filter(Boolean))];
  const statusesUsed = STATUSES.map((s) => ({ ...s, n: sorted.filter((i) => statusOf(i.status).key === s.key).length })).filter(
    (s) => s.n > 0,
  );
  const statusButtons =
    statusesUsed.length > 1
      ? [
          '<span class="sep"></span>',
          '<button class="stat" type="button" data-status-filter="all" aria-pressed="true">Any status</button>',
          ...statusesUsed.map(
            (s) => `<button class="stat" type="button" data-status-filter="${s.key}" aria-pressed="false"><b>${s.n}</b> ${esc(s.label)}</button>`,
          ),
        ].join('\n    ')
      : '';
  const options = { shots, fields: withDefaults(fields), widths, preview };
  const empty = preview
    ? 'No comments yet. Open the page you want to review and press Alt+Shift+A to add a comment.'
    : 'No comments in this review.';
  const body = sorted.length
    ? `${sorted.map((issue, index) => issueCard(issue, index, options, numberOf(issue))).join('\n')}${
        preview ? '\n  <div class="empty" data-no-match hidden><p data-no-match-text></p><button class="stat" type="button" data-clear-filters>Clear search and filters</button></div>' : ''
      }`
    : `<p class="empty">${empty}</p>`;
  const stats = preview
    ? ''
    : `<div class="stats">
    <button class="stat" type="button" data-filter="all" aria-pressed="true"><b>${sorted.length}</b> ${sorted.length === 1 ? 'comment' : 'comments'}</button>
    ${SEVERITIES.filter((s) => counts[s.key] > 0)
      .map(
        (s) =>
          `<button class="stat" type="button" data-filter="${s.key}" style="--sev: var(${s.token})" aria-pressed="false"><b>${counts[s.key]}</b> ${s.label}</button>`,
      )
      .join('\n    ')}
    ${statusButtons}
  </div>`;

  const contents =
    preview || sorted.length < 2
      ? ''
      : `<nav class="toc" aria-label="Contents"><ol>${sorted
          .map((issue, index) => {
            const sev = severityOf(issue.severity);
            return `<li data-sev="${esc(sev.key)}"><a href="#c-${index + 1}"><span class="num">${pad(numberOf(issue))}</span><span class="dot"></span><span class="t">${esc(issue.title || 'Untitled comment')}</span><span class="s">${esc(statusOf(issue.status).label)}</span></a></li>`;
          })
          .join('')}</ol></nav>`;
  return `<div class="wrap">
  <header class="top">
    <h1>${esc(title)}</h1>
    <div class="meta-top">${esc(generatedAt.toLocaleString())}, ${sorted.length} ${sorted.length === 1 ? 'comment' : 'comments'} on ${pages.length} page${pages.length === 1 ? '' : 's'}</div>
  </header>
  ${stats}
  ${contents}
  ${body}
  ${preview ? '' : '<p class="made">Made with Margin</p>'}
</div>`;
}

/**
 * Renders a self contained HTML report. Images are already data URLs, so the
 * returned string opens correctly from anywhere with no other files.
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
${renderBody(issues, { ...options, preview: false })}
<script>(${wireFilters.toString()})(document);</script>
</body>
</html>`;
}
