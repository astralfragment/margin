import { SEVERITIES, severityOf } from './severity.js';
import { statusOf as reviewStatusOf } from './status.js';
import { environmentText, escapeHtml as esc, hexColour, linkName, linksLabel, numbering, recheckCaption, routeOf, sortIssues } from './report-template.js';
import { DEFAULT_FIELDS, withDefaults } from './fields.js';
import { markList } from './marks.js';
import { widthCaption, widthShots, widthsLine } from './widths.js';

/**
 * Document flavour for Google Docs and Word: a short overview table, then one
 * section per page with a card for each comment. Google's HTML importer drops
 * grid, flex, custom properties and pseudo elements, so this uses only
 * headings, paragraphs, tables and inline styles.
 */
const INK = '#16131f';
const INK_2 = '#5b5670';
const LINE = '#dcd8ea';
const SOFT = '#f6f5fb';
const SANS = 'Arial, Helvetica, sans-serif';
const MONO_FACE = 'Consolas, "Courier New", monospace';
/** A4 portrait at 2cm margins leaves about 640px, which Docs and Word both keep. */
const PAGE_WIDTH = 640;
const IMAGE_WIDTH = PAGE_WIDTH - 26;
const MARK_COLOR = '#e5484d';

const PAGE_CSS = `
@page WordSection1 { size: 21cm 29.7cm; margin: 2cm; }
div.WordSection1 { page: WordSection1; }
`;

/** Severity text and tint, readable on paper and in both editors. */
const SEV_STYLE = {
  blocker: { ink: '#ce2c31', fill: '#feebec' },
  major: { ink: '#c2410c', fill: '#ffefe3' },
  minor: { ink: '#0d74ce', fill: '#e6f4fe' },
  nit: { ink: '#60646c', fill: '#f0f0f3' },
};

/** The status colours, the same Open, Fixed and Won't fix the report uses. */
const STATUS_STYLE = {
  open: { fill: '#ffffff', ink: INK },
  fixed: { fill: '#e6f6eb', ink: '#18794e' },
  wontfix: { fill: '#f0f0f3', ink: '#60646c' },
};

const pad = (n) => String(n).padStart(2, '0');

const H1 = `font-family: ${SANS}; font-size: 20pt; font-weight: 700; color: ${INK}; margin: 0 0 4px;`;
const H2 = `font-family: ${SANS}; font-size: 14pt; font-weight: 700; color: ${INK}; margin: 28px 0 2px;`;
const P = `font-family: ${SANS}; font-size: 10pt; line-height: 1.45; color: ${INK}; margin: 0 0 8px;`;
const SMALL = `font-family: ${SANS}; font-size: 8.5pt; color: ${INK_2}; margin: 0 0 12px;`;
const CAPTION = `font-family: ${SANS}; font-size: 8pt; color: ${INK_2}; margin: 2px 0 10px;`;
const TABLE = 'border-collapse: collapse; table-layout: fixed;';
const TH = `border-bottom: 1px solid ${LINE}; padding: 6px 8px; font-family: ${SANS}; font-size: 8.5pt; font-weight: 700; color: ${INK_2}; text-align: left; background: ${SOFT};`;
const TD = `border-bottom: 1px solid ${LINE}; padding: 6px 8px; font-family: ${SANS}; font-size: 9pt; color: ${INK}; vertical-align: top;`;
const MONO = `font-family: ${MONO_FACE}; font-size: 8pt;`;
const FACT_KEY = `padding: 1px 10px 1px 0; font-family: ${SANS}; font-size: 8pt; font-weight: 700; color: ${INK_2}; vertical-align: top; white-space: nowrap;`;
const FACT_VAL = `padding: 1px 0; font-family: ${SANS}; font-size: 8pt; color: ${INK}; vertical-align: top;`;

/**
 * Text linked to an address, or the plain text when there is no address.
 * @param {string} label The words shown.
 * @param {string} [url] Where they link to.
 */
const linked = (label, url) => (url ? `<a href="${esc(url)}" style="color: ${INK};">${esc(label)}</a>` : esc(label));

/**
 * The status label and colours of a comment.
 * @param {object} issue The stored comment.
 */
function statusOf(issue) {
  const status = reviewStatusOf(issue.status);
  return { key: status.key, label: status.label, ...STATUS_STYLE[status.key] };
}

/** A small coloured label, kept as bold coloured text so both editors keep it. */
const sevLabel = (sev) => `<b style="color: ${SEV_STYLE[sev.key].ink};">${esc(sev.label)}</b>`;
const statusLabel = (status) => `<b style="color: ${status.ink};">${esc(status.label)}</b>`;

/** One line of provenance for the plain text copy. */
function factLine(issue) {
  return [
    issue.element?.selector,
    issue.rect && `${issue.rect.w} x ${issue.rect.h} at ${issue.rect.x}, ${issue.rect.y}`,
    issue.viewport && `viewport ${issue.viewport.width} x ${issue.viewport.height} at ${issue.viewport.dpr}x`,
    new Date(issue.createdAt).toLocaleString(),
  ]
    .filter(Boolean)
    .map((part) => esc(part))
    .join(', ');
}

function image(src, alt, caption, width = IMAGE_WIDTH) {
  if (!src) return '';
  return `<p style="margin: 10px 0 0;"><img src="${src}" alt="${esc(alt)}" width="${width}" style="max-width: 100%; border: 1px solid ${LINE};" /></p>${
    caption ? `<p style="${CAPTION}">${esc(caption)}</p>` : ''
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
  return `<table cellspacing="0" cellpadding="0" style="${TABLE} margin: 10px 0 4px;"><tbody><tr>${shots
    .map(
      (shot) =>
        `<td style="padding: 0 8px 0 0; vertical-align: top; width: ${cell}px;"><img src="${shot.src}" alt="${esc(shot.label)} width for comment ${number}" width="${cell}" style="border: 1px solid ${LINE};" /><p style="${CAPTION}">${esc(widthCaption(shot))}</p></td>`,
    )
    .join('')}</tr></tbody></table>`;
}

/** The technical details as a quiet two column table under the images. */
function factTable(issue, fields) {
  const el = issue.element;
  const rows = [
    fields.figma && issue.links?.length
      ? [linksLabel(issue.links), issue.links.map((url, i) => `<a href="${esc(url)}">${esc(linkName(url, i, issue))}</a>`).join(', ')]
      : null,
    fields.jira && issue.jira?.key
      ? ['Jira', `<a href="${esc(issue.jira.url)}">${esc(issue.jira.key)}</a>${issue.jira.status ? `, ${esc(issue.jira.status)}` : ''}`]
      : null,
    fields.selector && el?.selector ? ['Selector', `<span style="${MONO}">${esc(el.selector)}</span>`] : null,
    fields.element && el
      ? ['Element', `<span style="${MONO}">${esc(el.tag)}${el.classes ? `.${esc(el.classes.split(' ').join('.'))}` : ''}</span>`]
      : null,
    fields.text && el?.text ? ['Text', esc(el.text)] : null,
    fields.styles && el?.styles
      ? ['Styles', `<span style="${MONO}">${esc(el.styles.font)}, ${esc(hexColour(el.styles.color))}</span>`]
      : null,
    fields.position && issue.rect && issue.viewport
      ? [
          'Position',
          `<span style="${MONO}">${issue.rect.w} x ${issue.rect.h} at ${issue.rect.x}, ${issue.rect.y} in ${issue.viewport.width} x ${issue.viewport.height} at ${issue.viewport.dpr}x</span>`,
        ]
      : null,
    fields.browser && issue.env ? ['Browser', esc(environmentText(issue))] : null,
    fields.captured ? ['Captured', esc(new Date(issue.createdAt).toLocaleString())] : null,
  ].filter(Boolean);
  if (!rows.length) return '';
  return `<table cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin: 12px 0 2px;"><tbody>${rows
    .map(([key, value]) => `<tr><td style="${FACT_KEY}">${key}</td><td style="${FACT_VAL}">${value}</td></tr>`)
    .join('')}</tbody></table>`;
}

/**
 * One comment as a bordered card: number, title, severity and status on a tinted band, then the note, marks, images and details.
 * @param {object} issue The stored comment.
 * @param {number} n Its comment number.
 * @param {string} shots Which screenshots to include.
 * @param {Record<string, boolean>} fields Which detail rows to include.
 * @param {boolean} widths Whether to add the width shots.
 */
function commentCard(issue, n, shots, fields, widths) {
  const sev = severityOf(issue.severity);
  const status = statusOf(issue);
  const marks = markList(issue);
  const region = shots === 'viewport' ? '' : image(issue.detail, `Marked region for comment ${n}`);
  const after = shots === 'viewport' || !issue.after ? '' : image(issue.after, `Same region after recheck for comment ${n}`, recheckCaption(issue));
  const full = shots === 'detail' ? '' : image(issue.shot, `Full viewport for comment ${n}`, 'Full viewport', region ? Math.round(IMAGE_WIDTH * 0.66) : IMAGE_WIDTH);
  return `<table cellspacing="0" cellpadding="0" width="${PAGE_WIDTH}" style="${TABLE} width: ${PAGE_WIDTH}px; border: 1px solid ${LINE}; margin: 12px 0 0;">
    <colgroup><col width="${PAGE_WIDTH - 170}" /><col width="170" /></colgroup>
    <tbody>
      <tr>
        <td style="padding: 9px 12px; background: ${SEV_STYLE[sev.key].fill}; border-bottom: 1px solid ${LINE}; vertical-align: top;">
          <p style="font-family: ${SANS}; font-size: 11.5pt; font-weight: 700; color: ${INK}; margin: 0;"><span style="color: ${INK_2};">${pad(n)}</span>&nbsp;&nbsp;${esc(issue.title || 'Untitled comment')}</p>
        </td>
        <td style="padding: 9px 12px; background: ${SEV_STYLE[sev.key].fill}; border-bottom: 1px solid ${LINE}; vertical-align: top; text-align: right;">
          <p style="font-family: ${SANS}; font-size: 9pt; margin: 1px 0 0;">${sevLabel(sev)}&nbsp;&nbsp;<span style="color: ${LINE};">|</span>&nbsp;&nbsp;${statusLabel(status)}</p>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 10px 12px 12px; vertical-align: top;">
          ${fields.page ? `<p style="${SMALL} margin: 0 0 8px;">${linked(routeOf(issue.page), issue.page.url)}</p>` : ''}
          ${issue.note ? `<p style="${P}">${esc(issue.note).replace(/\n/g, '<br />')}</p>` : ''}
          ${marks.map((item) => `<p style="${P} margin: 0 0 4px;"><b style="color: ${MARK_COLOR};">${item.n}.</b>&nbsp;${esc(item.note).replace(/\n/g, '<br />')}</p>`).join('\n          ')}
          ${region}
          ${after}
          ${widths ? widthRow(issue, n) : ''}
          ${full}
          ${factTable(issue, fields)}
        </td>
      </tr>
    </tbody>
  </table>`;
}

/**
 * The overview table: every comment on one line, in report order, so a reader sees the whole review before the detail.
 * @param {{ page: object, issues: object[] }[]} groups The comments by page.
 * @param {(issue: object) => number} numberOf The comment numbers.
 */
function overviewTable(groups, numberOf) {
  const cols = { n: 40, title: 330, page: 120, sev: 75, status: 75 };
  const rows = groups.flatMap((group, g) =>
    group.issues.map((issue) => {
      const sev = severityOf(issue.severity);
      const status = statusOf(issue);
      return `<tr>
        <td style="${TD} color: ${INK_2}; font-weight: 700;">${pad(numberOf(issue))}</td>
        <td style="${TD}">${esc(issue.title || 'Untitled comment')}</td>
        <td style="${TD} color: ${INK_2};">COMM${g + 1}</td>
        <td style="${TD}">${sevLabel(sev)}</td>
        <td style="${TD} background: ${status.fill};">${statusLabel(status)}</td>
      </tr>`;
    }),
  );
  return `<table cellspacing="0" cellpadding="0" width="${PAGE_WIDTH}" style="${TABLE} width: ${PAGE_WIDTH}px; margin: 4px 0 8px;">
    <colgroup>${Object.values(cols).map((w) => `<col width="${w}" />`).join('')}</colgroup>
    <tbody>
      <tr><td style="${TH}">#</td><td style="${TH}">Comment</td><td style="${TH}">Section</td><td style="${TH}">Severity</td><td style="${TH}">Status</td></tr>
      ${rows.join('\n      ')}
    </tbody>
  </table>`;
}

/** A one row table with the count of each severity in its colour. */
function severityStrip(issues) {
  const cells = SEVERITIES.map((s) => ({ s, n: issues.filter((i) => severityOf(i.severity).key === s.key).length }))
    .filter(({ n }) => n > 0)
    .map(
      ({ s, n }) =>
        `<td style="padding: 6px 14px 6px 10px; background: ${SEV_STYLE[s.key].fill}; border-right: 4px solid #ffffff; font-family: ${SANS}; font-size: 9pt; color: ${SEV_STYLE[s.key].ink};"><b style="font-size: 13pt;">${n}</b>&nbsp; ${esc(s.label)}</td>`,
    );
  return `<table cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin: 14px 0 6px;"><tbody><tr>${cells.join('')}</tr></tbody></table>`;
}

/**
 * One page's section: its route, its link and a card per comment.
 * @param {{ page: object, issues: object[] }} group The page and its comments.
 * @param {number} number The section number.
 * @param {(issue: object) => number} numberOf The comment numbers.
 * @param {string} shots Which screenshots to include.
 * @param {Record<string, boolean>} fields Which detail rows to include.
 * @param {boolean} widths Whether to add the width shots.
 */
function commSection(group, number, numberOf, shots, fields, widths) {
  const cardFields = { ...fields, page: false };
  return `
  <h2 style="${H2}">COMM${number}&nbsp;&nbsp;${esc(routeOf(group.page))}</h2>
  <p style="${SMALL} margin: 0 0 4px;"><a href="${esc(group.page.url)}" style="color: ${INK_2};">${esc(group.page.url)}</a></p>
  ${group.issues.map((issue) => commentCard(issue, numberOf(issue), shots, cardFields, widths)).join('\n  ')}`;
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
  const meta = [
    esc(generatedAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })),
    `${total} ${total === 1 ? 'comment' : 'comments'} on ${groups.length} ${groups.length === 1 ? 'page' : 'pages'}`,
    group?.jira?.key ? `Ticket ${linked(group.jira.key, group.jira.url)}${group.jira.status ? ` (${esc(group.jira.status)})` : ''}` : '',
    group?.figma?.fileKey ? `Design ${linked(group.figma.name || 'Figma file', group.figma.url)}` : '',
  ].filter(Boolean);

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
  <p style="${SMALL} margin: 0;">${meta.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}</p>
  ${total ? severityStrip(issues) : ''}
  ${total ? `<h2 style="${H2} margin-top: 18px;">Overview</h2>\n  ${overviewTable(groups, numberOf)}` : ''}
  ${body}
  <p style="${SMALL} margin-top: 24px;">Made with Margin</p>
</div>
</body>
</html>`;
}
