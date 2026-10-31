import { escapeHtml as esc, rowHtml } from './report-template.js';
import { buildReviewModel } from './review-model.js';

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

/** A small coloured label, kept as bold coloured text so both editors keep it. */
const sevLabel = (sev) => `<b style="color: ${SEV_STYLE[sev.key].ink};">${esc(sev.label)}</b>`;
const statusLabel = (status) => `<b style="color: ${STATUS_STYLE[status.key].ink};">${esc(status.label)}</b>`;

function image(src, alt, caption, width = IMAGE_WIDTH) {
  if (!src) return '';
  return `<p style="margin: 10px 0 0;"><img src="${src}" alt="${esc(alt)}" width="${width}" style="max-width: 100%; border: 1px solid ${LINE};" /></p>${
    caption ? `<p style="${CAPTION}">${esc(caption)}</p>` : ''
  }`;
}

/**
 * The region at mobile, tablet and desktop widths as a borderless one row table, which Docs and Word both keep side by side.
 * @param {object} comment The comment from the review model.
 */
function widthRow({ images, number }) {
  const shots = images.widths;
  if (!shots.length) return '';
  const cell = Math.floor(IMAGE_WIDTH / 3) - 8;
  return `<table cellspacing="0" cellpadding="0" style="${TABLE} margin: 10px 0 4px;"><tbody><tr>${shots
    .map(
      (shot) =>
        `<td style="padding: 0 8px 0 0; vertical-align: top; width: ${cell}px;"><img src="${shot.src}" alt="${esc(shot.label)} width for comment ${number}" width="${cell}" style="border: 1px solid ${LINE};" /><p style="${CAPTION}">${esc(shot.caption)}</p></td>`,
    )
    .join('')}</tr></tbody></table>`;
}

/**
 * The technical details as a quiet two column table, between the region images and the full screenshot.
 * @param {import('./review-model.js').DetailRow[]} rows The comment's detail rows.
 */
function factTable(rows) {
  if (!rows.length) return '';
  return `<table cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin: 12px 0 2px;"><tbody>${rows
    .map((row) => `<tr><td style="${FACT_KEY}">${esc(row.label)}</td><td style="${FACT_VAL}">${rowHtml(row, (html) => `<span style="${MONO}">${html}</span>`)}</td></tr>`)
    .join('')}</tbody></table>`;
}

/**
 * One comment as a bordered card: number, title, severity and status on a tinted band, then the note, marks, images and details.
 * @param {object} comment The comment from the review model.
 */
function commentCard(comment) {
  const { severity, status, images, number } = comment;
  const region = image(images.region, `Marked region for comment ${number}`);
  const after = image(images.after, `Same region after recheck for comment ${number}`, images.afterCaption);
  const full = image(images.full, `Full viewport for comment ${number}`, 'Full viewport', region ? Math.round(IMAGE_WIDTH * 0.66) : IMAGE_WIDTH);
  return `<table cellspacing="0" cellpadding="0" width="${PAGE_WIDTH}" style="${TABLE} width: ${PAGE_WIDTH}px; border: 1px solid ${LINE}; margin: 12px 0 0;">
    <colgroup><col width="${PAGE_WIDTH - 170}" /><col width="170" /></colgroup>
    <tbody>
      <tr>
        <td style="padding: 9px 12px; background: ${SEV_STYLE[severity.key].fill}; border-bottom: 1px solid ${LINE}; vertical-align: top;">
          <p style="font-family: ${SANS}; font-size: 11.5pt; font-weight: 700; color: ${INK}; margin: 0;"><span style="color: ${INK_2};">${comment.label}</span>&nbsp;&nbsp;${esc(comment.title)}</p>
        </td>
        <td style="padding: 9px 12px; background: ${SEV_STYLE[severity.key].fill}; border-bottom: 1px solid ${LINE}; vertical-align: top; text-align: right;">
          <p style="font-family: ${SANS}; font-size: 9pt; margin: 1px 0 0;">${sevLabel(severity)}&nbsp;&nbsp;<span style="color: ${LINE};">|</span>&nbsp;&nbsp;${statusLabel(status)}</p>
        </td>
      </tr>
      <tr>
        <td colspan="2" style="padding: 10px 12px 12px; vertical-align: top;">
          ${comment.note ? `<p style="${P}">${esc(comment.note).replace(/\n/g, '<br />')}</p>` : ''}
          ${comment.marks.map((item) => `<p style="${P} margin: 0 0 4px;"><b style="color: ${MARK_COLOR};">${item.n}.</b>&nbsp;${esc(item.note).replace(/\n/g, '<br />')}</p>`).join('\n          ')}
          ${region}
          ${after}
          ${widthRow(comment)}
          ${factTable(comment.rows)}
          ${full}
        </td>
      </tr>
    </tbody>
  </table>`;
}

/**
 * The overview table: every comment on one line, in report order, so a reader sees the whole review before the detail.
 * @param {object[]} sections The review model's page sections.
 */
function overviewTable(sections) {
  const cols = { n: 40, title: 330, page: 120, sev: 75, status: 75 };
  const rows = sections.flatMap((section) =>
    section.comments.map(
      (comment) => `<tr>
        <td style="${TD} color: ${INK_2}; font-weight: 700;">${comment.label}</td>
        <td style="${TD}">${esc(comment.title)}</td>
        <td style="${TD} color: ${INK_2};">${section.label}</td>
        <td style="${TD}">${sevLabel(comment.severity)}</td>
        <td style="${TD} background: ${STATUS_STYLE[comment.status.key].fill};">${statusLabel(comment.status)}</td>
      </tr>`,
    ),
  );
  return `<table cellspacing="0" cellpadding="0" width="${PAGE_WIDTH}" style="${TABLE} width: ${PAGE_WIDTH}px; margin: 4px 0 8px;">
    <colgroup>${Object.values(cols).map((w) => `<col width="${w}" />`).join('')}</colgroup>
    <tbody>
      <tr><td style="${TH}">#</td><td style="${TH}">Comment</td><td style="${TH}">Section</td><td style="${TH}">Severity</td><td style="${TH}">Status</td></tr>
      ${rows.join('\n      ')}
    </tbody>
  </table>`;
}

/**
 * A one row table with the count of each severity in its colour.
 * @param {{ key: string, label: string, count: number }[]} severities The review model's severity counts.
 */
function severityStrip(severities) {
  const cells = severities
    .filter((s) => s.count > 0)
    .map(
      (s) =>
        `<td style="padding: 6px 14px 6px 10px; background: ${SEV_STYLE[s.key].fill}; border-right: 4px solid #ffffff; font-family: ${SANS}; font-size: 9pt; color: ${SEV_STYLE[s.key].ink};"><b style="font-size: 13pt;">${s.count}</b>&nbsp; ${esc(s.label)}</td>`,
    );
  return `<table cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin: 14px 0 6px;"><tbody><tr>${cells.join('')}</tr></tbody></table>`;
}

/**
 * One page's section: its route, its link and a card per comment.
 * @param {object} section A page section from the review model.
 */
function commSection(section) {
  return `
  <h2 style="${H2}">${section.label}&nbsp;&nbsp;${esc(section.route)}</h2>
  ${section.url ? `<p style="${SMALL} margin: 0 0 4px;"><a href="${esc(section.url)}" style="color: ${INK_2};">${esc(section.url)}</a></p>` : ''}
  ${section.comments.map(commentCard).join('\n  ')}`;
}

/**
 * Plain text version, used as the second clipboard flavour. It follows the Docs layout line for line.
 * @param {object[]} issues The comments, in the order they were made.
 * @param {object} [options] The same options as buildDocsHtml.
 */
export function buildDocsText(issues, options = {}) {
  const model = buildReviewModel(issues, { title: 'UI review comments', ...options });
  const lines = [model.title, `${model.date}, ${model.summary}`, ''];
  model.sections.forEach((section) => {
    lines.push(`${section.label}: ${section.route}`, ...(section.url ? [section.url] : []), '');
    section.comments.forEach((comment) => {
      lines.push(`${comment.label}  [${comment.severity.label}, ${comment.status.label}] ${comment.title}`);
      if (comment.note) lines.push(`    ${comment.note.replace(/\n/g, '\n    ')}`);
      comment.marks.forEach((item) => lines.push(`    ${item.n}. ${item.note.replace(/\n/g, ' ')}`));
      if (comment.images.afterCaption) lines.push(`    ${comment.images.afterCaption}`);
      if (comment.images.widths.length) lines.push(`    ${comment.images.widths.map((shot) => shot.caption).join('. ')}`);
      comment.rows.forEach((row) => lines.push(`    ${row.label}: ${row.value}`));
      lines.push('');
    });
  });
  return lines.join('\n');
}

/**
 * Renders the report as a document for Google Docs, Word, or any editor that
 * imports HTML. Used for both the .doc download and the clipboard copy.
 */
export function buildDocsHtml(issues, { group = null, ...options } = {}) {
  const model = buildReviewModel(issues, { title: 'UI review comments', ...options });
  const meta = [
    esc(model.date),
    esc(model.summary),
    group?.jira?.key ? `Ticket ${linked(group.jira.key, group.jira.url)}${group.jira.status ? ` (${esc(group.jira.status)})` : ''}` : '',
    group?.figma?.fileKey ? `Design ${linked(group.figma.name || 'Figma file', group.figma.url)}` : '',
  ].filter(Boolean);

  const body = model.total ? model.sections.map(commSection).join('\n') : `<p style="${P}">No comments captured.</p>`;

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${esc(model.title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body style="background: #ffffff; color: ${INK};">
<div class="WordSection1">
  <h1 style="${H1}">${esc(model.title)}</h1>
  <p style="${SMALL} margin: 0;">${meta.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}</p>
  ${model.total ? severityStrip(model.severities) : ''}
  ${model.total ? `<h2 style="${H2} margin-top: 18px;">Overview</h2>\n  ${overviewTable(model.sections)}` : ''}
  ${body}
  <p style="${SMALL} margin-top: 24px;">Made with Margin</p>
</div>
</body>
</html>`;
}
