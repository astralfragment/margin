import { SEVERITIES, severityOf } from './severity.js';
import { statusOf as reviewStatusOf } from './status.js';
import { environmentText, escapeHtml as esc, hexColour, linkName, linksLabel, numbering, recheckCaption, routeOf, sortIssues } from './report-template.js';
import { DEFAULT_FIELDS, withDefaults } from './fields.js';
import { markList } from './marks.js';
import { widthCaption, widthShots, widthsLine } from './widths.js';

/**
 * Document flavour, shaped like the AIE review comments template: a COMM
 * section per page, each with a four column table of numbered comments.
 * Google's HTML importer drops grid, flex, custom properties and pseudo
 * elements, so this uses only headings, paragraphs, tables and inline styles.
 */
const INK = '#12151c';
const INK_2 = '#565d73';
const LINE = '#c9cedb';
const SANS = 'Arial, sans-serif';
const MONO_FACE = 'Consolas, monospace';
const IMAGE_WIDTH = 640;
const MARK_COLOR = '#e5484d';

/**
 * Absolute column widths in pixels. Google Docs stores column widths
 * absolutely, and percentages there collapse to the classic page width, so the
 * table states the size it wants and Docs keeps the proportions.
 */
const COLS = { number: 44, comment: 700, status: 120, notes: 316 };
const TABLE_WIDTH = COLS.number + COLS.comment + COLS.status + COLS.notes;

/**
 * Word reads this and opens the file landscape, which the wide comment table
 * needs. Google Docs ignores it, so set File > Page setup there.
 */
const PAGE_CSS = `
@page WordSection1 { size: 29.7cm 21cm; margin: 1.5cm; }
div.WordSection1 { page: WordSection1; }
`;

const SEV_COLOR = {
  blocker: '#ce2c31',
  major: '#c2410c',
  minor: '#0d74ce',
  nit: '#60646c',
};

/** The status cell colours, the same Open, Fixed and Won't fix the report uses. */
const STATUS_STYLE = {
  open: { fill: '#ffffff', ink: INK },
  fixed: { fill: '#e6f6eb', ink: '#18794e' },
  wontfix: { fill: '#f0f0f3', ink: '#60646c' },
};

const pad = (n) => String(n).padStart(2, '0');

const H1 = `font-family: ${SANS}; font-size: 18pt; font-weight: 700; color: ${INK}; margin: 0 0 2px;`;
const H2 = `font-family: ${SANS}; font-size: 13pt; font-weight: 700; color: ${INK}; margin: 26px 0 4px;`;
const H3 = `font-family: ${SANS}; font-size: 11pt; font-weight: 700; color: ${INK}; margin: 20px 0 4px;`;
const P = `font-family: ${SANS}; font-size: 10pt; color: ${INK}; margin: 0 0 8px;`;
const SMALL = `font-family: ${SANS}; font-size: 8pt; color: ${INK_2}; margin: 0 0 12px;`;
const CELL = `border: 1px solid ${LINE}; padding: 5px 7px; font-family: ${SANS}; font-size: 9pt; color: ${INK}; vertical-align: top;`;
const HEAD_CELL = `${CELL} font-weight: 700; color: ${INK_2};`;
const FACTS = `font-family: ${MONO_FACE}; font-size: 8pt; color: ${INK_2};`;
const MONO = `font-family: ${MONO_FACE}; font-size: 8pt;`;
const FACT_LINE = `font-family: ${SANS}; font-size: 8pt; color: ${INK}; margin: 0 0 2px;`;
const FACT_LABEL = `color: ${INK_2}; font-weight: 700;`;

/**
 * Text linked to an address, or the plain text when there is no address.
 * @param {string} label The words shown.
 * @param {string} [url] Where they link to.
 */
const linked = (label, url) => (url ? `<a href="${esc(url)}">${esc(label)}</a>` : esc(label));

/**
 * The Status cell, Open, Fixed or Won't fix as in the report, with its colours.
 * @param {object} issue The stored comment.
 */
function statusOf(issue) {
  const status = reviewStatusOf(issue.status);
  return { label: status.label, ...STATUS_STYLE[status.key] };
}

/** One line of provenance under the comment text. */
function factLine(issue) {
  return [
    issue.element?.selector,
    `${issue.rect.w} x ${issue.rect.h} at ${issue.rect.x}, ${issue.rect.y}`,
    `viewport ${issue.viewport.width} x ${issue.viewport.height} at ${issue.viewport.dpr}x`,
    new Date(issue.createdAt).toLocaleString(),
  ]
    .filter(Boolean)
    .map((part) => esc(part))
    .join(', ');
}

function image(src, alt, caption) {
  if (!src) return '';
  return `<p style="margin: 8px 0 2px;"><img src="${src}" alt="${esc(alt)}" width="${IMAGE_WIDTH}" style="max-width: 100%;" /></p>${
    caption ? `\n        <p style="${SMALL} margin: 0 0 4px;">${esc(caption)}</p>` : ''
  }`;
}

/**
 * The region at mobile, tablet and desktop widths as a borderless one row table, which Docs and Word both keep side by side.
 * @param {object} issue The stored comment.
 * @param {number} number Its comment number.
 */
function widthRow(issue, number) {
  const shots = widthShots(issue);
  if (!shots.length) return '';
  const cell = Math.floor(IMAGE_WIDTH / 3) - 8;
  return `<table cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin: 8px 0 4px;"><tbody><tr>${shots
    .map(
      (shot) =>
        `<td style="padding: 0 8px 0 0; vertical-align: top; width: ${cell}px;"><img src="${shot.src}" alt="${esc(shot.label)} width for comment ${number}" width="${cell}" /><p style="${SMALL} margin: 2px 0 0;">${esc(widthCaption(shot))}</p></td>`,
    )
    .join('')}</tr></tbody></table>`;
}

/** The facts that sit under the note, one short line each. */
function factLines(issue, fields) {
  const el = issue.element;
  const rows = [
    fields.page ? ['Page', `<a href="${esc(issue.page.url)}">${esc(issue.page.url)}</a>`] : null,
    fields.figma && issue.links?.length
      ? [linksLabel(issue.links), issue.links.map((url, i) => `<a href="${esc(url)}">${esc(linkName(url, i, issue))}</a>`).join(', ')]
      : null,
    fields.selector && el?.selector ? ['Selector', `<span style="${MONO}">${esc(el.selector)}</span>`] : null,
    fields.element && el
      ? ['Element', `<span style="${MONO}">${esc(el.tag)}${el.classes ? `.${esc(el.classes.split(' ').join('.'))}` : ''}</span>`]
      : null,
    fields.text && el?.text ? ['Text', esc(el.text)] : null,
    fields.styles && el?.styles
      ? ['Styles', `<span style="${MONO}">${esc(el.styles.font)}, color ${esc(hexColour(el.styles.color))}</span>`]
      : null,
    fields.position
      ? [
          'Position',
          `<span style="${MONO}">${issue.rect.w} x ${issue.rect.h} at ${issue.rect.x}, ${issue.rect.y} in ${issue.viewport.width} x ${issue.viewport.height} at ${issue.viewport.dpr}x</span>`,
        ]
      : null,
    fields.captured ? ['Captured', esc(new Date(issue.createdAt).toLocaleString())] : null,
    fields.browser && issue.env ? ['Browser', esc(environmentText(issue))] : null,
  ]
    .filter(Boolean)
    .map(([key, value]) => `<p style="${FACT_LINE}"><span style="${FACT_LABEL}">${key}</span>&nbsp;&nbsp;${value}</p>`)
    .join('\n          ');

  return rows;
}

/**
 * One comment as a table row: its number, the comment with its images, its status and its Jira issue.
 * @param {object} issue The stored comment.
 * @param {number} n Its comment number.
 * @param {string} shots Which screenshots to include.
 * @param {Record<string, boolean>} fields Which detail rows to include.
 * @param {boolean} widths Whether to add the width shots.
 */
function commentRow(issue, n, shots, fields, widths) {
  const sev = severityOf(issue.severity);
  const status = statusOf(issue);
  return `<tr>
        <td style="${CELL} width: ${COLS.number}px; font-weight: 700;">${pad(n)}</td>
        <td style="${CELL} width: ${COLS.comment}px;">
          <h3 style="${H3} margin: 0 0 2px;">${esc(issue.title || 'Untitled comment')}</h3>
          <p style="${P} margin: 0 0 6px; font-size: 9pt; color: ${SEV_COLOR[sev.key]};"><b>${esc(sev.label)}</b></p>
          ${issue.note ? `<p style="${P} margin: 0 0 6px;">${esc(issue.note).replace(/\n/g, '<br />')}</p>` : ''}
          ${markList(issue)
            .map(
              (item) =>
                `<p style="${P} margin: 0 0 3px;"><b style="color: ${MARK_COLOR};">${item.n}.</b> ${esc(item.note).replace(/\n/g, '<br />')}</p>`,
            )
            .join('\n          ')}
          ${factLines(issue, fields)}
          ${shots === 'viewport' ? '' : image(issue.detail, `Marked region for comment ${n}`)}
          ${shots === 'viewport' || !issue.after ? '' : image(issue.after, `Same region after recheck for comment ${n}`, recheckCaption(issue))}
          ${widths ? widthRow(issue, n) : ''}
          ${shots === 'detail' ? '' : image(issue.shot, `Full viewport for comment ${n}`, 'Full viewport')}
        </td>
        <td style="${CELL} width: ${COLS.status}px; background: ${status.fill}; color: ${status.ink}; font-weight: 700;">${esc(status.label)}</td>
        <td style="${CELL} width: ${COLS.notes}px;">${
          fields.jira && issue.jira?.key
            ? `<a href="${esc(issue.jira.url)}">${esc(issue.jira.key)}</a>${issue.jira.status ? `, ${esc(issue.jira.status)} in Jira` : ''}`
            : ''
        }</td>
      </tr>`;
}

/**
 * One page's section: its route, its link and a table of its comments.
 * @param {{ page: object, issues: object[] }} group The page and its comments.
 * @param {number} number The section number.
 * @param {(issue: object) => number} numberOf The comment numbers.
 * @param {string} shots Which screenshots to include.
 * @param {Record<string, boolean>} fields Which detail rows to include.
 * @param {boolean} widths Whether to add the width shots.
 */
function commSection(group, number, numberOf, shots, fields, widths) {
  return `
  <h2 style="${H2}">COMM${number}: ${esc(routeOf(group.page))}</h2>
  <p style="${P}"><a href="${esc(group.page.url)}">${esc(group.page.url)}</a></p>
  <table cellspacing="0" cellpadding="0" width="${TABLE_WIDTH}" style="border-collapse: collapse; width: ${TABLE_WIDTH}px; table-layout: fixed; margin: 0 0 8px;">
    <colgroup>
      <col width="${COLS.number}" style="width: ${COLS.number}px;" />
      <col width="${COLS.comment}" style="width: ${COLS.comment}px;" />
      <col width="${COLS.status}" style="width: ${COLS.status}px;" />
      <col width="${COLS.notes}" style="width: ${COLS.notes}px;" />
    </colgroup>
    <tbody>
      <tr>
        <td style="${HEAD_CELL} width: ${COLS.number}px; border: 0;"></td>
        <td style="${HEAD_CELL} width: ${COLS.comment}px; border: 0;"></td>
        <td style="${HEAD_CELL} width: ${COLS.status}px; border: 0;">Status</td>
        <td style="${HEAD_CELL} width: ${COLS.notes}px; border: 0;">Jira</td>
      </tr>
      ${group.issues.map((issue) => commentRow(issue, numberOf(issue), shots, fields, widths)).join('\n      ')}
    </tbody>
  </table>`;
}

/** A one row table naming the three statuses in their colours. */
function statusLegend() {
  const cells = ['open', 'fixed', 'wontfix']
    .map((key) => `<td style="${CELL} background: ${STATUS_STYLE[key].fill}; color: ${STATUS_STYLE[key].ink}; font-weight: 700; text-align: center;">${esc(reviewStatusOf(key).label)}</td>`)
    .join('\n      ');
  return `<table cellspacing="0" cellpadding="0" style="border-collapse: collapse; width: 100%; margin: 0 0 8px;">
    <tbody>
      <tr>
      ${cells}
      </tr>
    </tbody>
  </table>`;
}

/** Groups issues by page, keeping first capture order, sorted by severity inside. */
export function groupByPage(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const key = issue.page?.url ?? '';
    if (!groups.has(key)) groups.set(key, { page: issue.page ?? { url: key, title: '' }, issues: [] });
    groups.get(key).issues.push(issue);
  }
  return [...groups.values()].map((group) => ({ ...group, issues: sortIssues(group.issues) }));
}

/** Plain text version, used as the second clipboard flavour. */
export function buildDocsText(issues, { title = 'UI review comments', widths = true } = {}) {
  const lines = [title, ''];
  const numberOf = numbering(issues);
  groupByPage(issues).forEach((group, index) => {
    lines.push(`COMM${index + 1}: ${routeOf(group.page)}`, group.page.url, '');
    group.issues.forEach((issue) => {
      const sev = severityOf(issue.severity);
      const jira = issue.jira?.key ? `, ${issue.jira.key}${issue.jira.status ? ` ${issue.jira.status} in Jira` : ''}` : '';
      lines.push(`${pad(numberOf(issue))}  [${sev.label}, ${statusOf(issue).label}${jira}] ${issue.title || 'Untitled comment'}`);
      if (issue.note) lines.push(`    ${issue.note.replace(/\n/g, '\n    ')}`);
      markList(issue).forEach((item) => lines.push(`    ${item.n}. ${item.note.replace(/\n/g, ' ')}`));
      if (issue.after) lines.push(`    ${recheckCaption(issue)}`);
      if (widths && widthShots(issue).length) lines.push(`    ${widthsLine(issue)}`);
      lines.push(`    ${factLine(issue).replace(/&amp;/g, '&')}`, '');
    });
  });
  return lines.join('\n');
}

/**
 * Renders the report as a document for Google Docs, Word, or any editor that
 * imports HTML. Used for both the .doc download and the clipboard copy.
 */
export function buildDocsHtml(
  issues,
  { title = 'UI review comments', generatedAt = new Date(), group = null, shots = 'both', fields = DEFAULT_FIELDS, widths = true } = {},
) {
  const groups = groupByPage(issues);
  const numberOf = numbering(issues);
  const total = issues.length;
  const counts = SEVERITIES.map((s) => `${issues.filter((i) => severityOf(i.severity).key === s.key).length} ${s.label}`).join(', ');

  const body = groups.length
    ? groups.map((pageGroup, index) => commSection(pageGroup, index + 1, numberOf, shots, withDefaults(fields), widths)).join('\n')
    : `<p style="${P}">No comments captured.</p>`;

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body style="background: #ffffff; color: ${INK};">
<div class="WordSection1">
  <h1 style="${H1}">${esc(title)}</h1>
  <p style="${SMALL}">Date: ${esc(generatedAt.toLocaleString())}${
    group?.jira?.key
      ? `, ticket ${linked(group.jira.key, group.jira.url)}${group.jira.status ? `, ${esc(group.jira.status)} in Jira` : ''}`
      : ''
  }${group?.figma?.fileKey ? `, file ${linked(group.figma.name || 'Figma file', group.figma.url)}` : ''}</p>

  <h2 style="${H2}">Introduction, important notes</h2>
  <p style="${P}">${total} ${total === 1 ? 'comment' : 'comments'} across ${groups.length} ${groups.length === 1 ? 'page' : 'pages'}: ${counts}. Each comment keeps the number it has in the Margin report, and carries the element selector, the marked region, and the viewport it was captured at. Every comment starts Open and shows Fixed or Won't fix once it is rechecked. A linked Jira issue shows its own status in the Jira column.</p>

  <h3 style="${H3}">Statuses</h3>
  ${statusLegend()}
  ${body}
</div>
</body>
</html>`;
}
