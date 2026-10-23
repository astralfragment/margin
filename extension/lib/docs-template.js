import { SEVERITIES, severityOf } from './severity.js';
import { statusOf as reviewStatusOf } from './status.js';
import { environmentText, escapeHtml as esc, recheckCaption, routeOf, sortIssues } from './report-template.js';
import { DEFAULT_FIELDS, withDefaults } from './fields.js';
import { markList } from './marks.js';

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
  blocker: '#d92020',
  major: '#b26a00',
  minor: '#1f5fd0',
  nit: '#5c6270',
};

/** Review workflow states. Everything the extension captures starts at New. */
const STATUSES = [
  { label: 'New', fill: '#fdeaea' },
  { label: 'In Progress', fill: '#e6f0fb' },
  { label: 'Pending Testing', fill: '#efeafa' },
  { label: 'Ready for Review', fill: '#fdf0e3' },
  { label: 'Signed Off', fill: '#e9f4e8' },
];

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

const CATEGORY_FILL = {
  new: STATUSES[0].fill,
  indeterminate: STATUSES[1].fill,
  done: STATUSES[4].fill,
};

/** Margin's own verdicts, shown in place of the workflow state once a comment is marked. */
const VERDICT_FILL = { fixed: STATUSES[4].fill, wontfix: '#eef0f3' };

/**
 * The Status cell. A comment marked fixed or won't fix says so, linked comments carry their live Jira status,
 * and everything else starts at New.
 * @param {object} issue The stored comment.
 */
function statusOf(issue) {
  const verdict = reviewStatusOf(issue.status);
  if (VERDICT_FILL[verdict.key]) return { label: verdict.label, fill: VERDICT_FILL[verdict.key] };
  if (!issue.jira?.status) return STATUSES[0];
  return {
    label: issue.jira.status,
    fill: CATEGORY_FILL[issue.jira.statusCategory] ?? STATUSES[0].fill,
  };
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

/** The facts that sit under the note, one short line each. */
function factLines(issue, fields) {
  const el = issue.element;
  const rows = [
    fields.page ? ['Page', `<a href="${esc(issue.page.url)}">${esc(issue.page.url)}</a>`] : null,
    fields.figma && issue.links?.length
      ? ['Figma', issue.links.map((url, i) => `<a href="${esc(url)}">Link ${i + 1}</a>`).join(', ')]
      : null,
    fields.selector && el?.selector ? ['Selector', `<span style="${MONO}">${esc(el.selector)}</span>`] : null,
    fields.element && el
      ? ['Element', `<span style="${MONO}">${esc(el.tag)}${el.classes ? `.${esc(el.classes.split(' ').join('.'))}` : ''}</span>`]
      : null,
    fields.text && el?.text ? ['Text', esc(el.text)] : null,
    fields.styles && el?.styles
      ? ['Styles', `<span style="${MONO}">${esc(el.styles.font)}, color ${esc(el.styles.color)}</span>`]
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

function commentRow(issue, index, shots, fields) {
  const sev = severityOf(issue.severity);
  return `<tr>
        <td style="${CELL} width: ${COLS.number}px; font-weight: 700;">C${index + 1}</td>
        <td style="${CELL} width: ${COLS.comment}px;">
          <h3 style="${H3} margin: 0 0 2px;">${esc(issue.title || 'Untitled issue')}</h3>
          <p style="${P} margin: 0 0 6px; font-size: 9pt; color: ${SEV_COLOR[sev.key]};"><b>${esc(sev.label)}</b></p>
          ${issue.note ? `<p style="${P} margin: 0 0 6px;">${esc(issue.note).replace(/\n/g, '<br />')}</p>` : ''}
          ${markList(issue)
            .map(
              (item) =>
                `<p style="${P} margin: 0 0 3px;"><b style="color: ${MARK_COLOR};">${item.n}.</b> ${esc(item.note).replace(/\n/g, '<br />')}</p>`,
            )
            .join('\n          ')}
          ${factLines(issue, fields)}
          ${shots === 'viewport' ? '' : image(issue.detail, `Marked region for C${index + 1}`)}
          ${shots === 'viewport' || !issue.after ? '' : image(issue.after, `Same region after recheck for C${index + 1}`, recheckCaption(issue))}
          ${shots === 'detail' ? '' : image(issue.shot, `Full viewport for C${index + 1}`, 'Full viewport')}
        </td>
        <td style="${CELL} width: ${COLS.status}px; background: ${statusOf(issue).fill};">${esc(statusOf(issue).label)}</td>
        <td style="${CELL} width: ${COLS.notes}px;">${
          fields.jira && issue.jira?.key ? `<a href="${esc(issue.jira.url)}">${esc(issue.jira.key)}</a>` : ''
        }</td>
      </tr>`;
}

function commSection(group, number, shots, fields) {
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
        <td style="${HEAD_CELL} width: ${COLS.notes}px; border: 0;">Notes</td>
      </tr>
      ${group.issues.map((issue, i) => commentRow(issue, i, shots, fields)).join('\n      ')}
    </tbody>
  </table>`;
}

function statusLegend() {
  const verdicts = ['fixed', 'wontfix'].map((key) => ({ label: reviewStatusOf(key).label, fill: VERDICT_FILL[key] }));
  const cells = [...STATUSES, ...verdicts].map(
    (s) => `<td style="${CELL} background: ${s.fill}; text-align: center;">${s.label}</td>`,
  ).join('\n      ');
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
export function buildDocsText(issues, { title = 'UI review comments' } = {}) {
  const lines = [title, ''];
  groupByPage(issues).forEach((group, index) => {
    lines.push(`COMM${index + 1}: ${routeOf(group.page)}`, group.page.url, '');
    group.issues.forEach((issue, i) => {
      const sev = severityOf(issue.severity);
      lines.push(`C${i + 1}  [${sev.label}, ${statusOf(issue).label}] ${issue.title || 'Untitled issue'}`);
      if (issue.note) lines.push(`    ${issue.note.replace(/\n/g, '\n    ')}`);
      markList(issue).forEach((item) => lines.push(`    ${item.n}. ${item.note.replace(/\n/g, ' ')}`));
      if (issue.after) lines.push(`    ${recheckCaption(issue)}`);
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
  { title = 'UI review comments', generatedAt = new Date(), group = null, shots = 'both', fields = DEFAULT_FIELDS } = {},
) {
  const groups = groupByPage(issues);
  const total = issues.length;
  const counts = SEVERITIES.map((s) => `${issues.filter((i) => severityOf(i.severity).key === s.key).length} ${s.label}`).join(', ');

  const body = groups.length
    ? groups.map((pageGroup, index) => commSection(pageGroup, index + 1, shots, withDefaults(fields))).join('\n')
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
      ? `, ticket <a href="${esc(group.jira.url)}">${esc(group.jira.key)}</a>, ${esc(group.jira.status ?? 'New')}`
      : ''
  }</p>

  <h2 style="${H2}">Introduction, important notes</h2>
  <p style="${P}">${total} ${total === 1 ? 'comment' : 'comments'} across ${groups.length} ${groups.length === 1 ? 'page' : 'pages'}: ${counts}. Each comment carries the element selector, the marked region, and the viewport it was captured at. Every comment starts at New and shows Fixed or Won't fix once it is verified.</p>

  <h3 style="${H3}">Statuses</h3>
  ${statusLegend()}
  ${body}
</div>
</body>
</html>`;
}
