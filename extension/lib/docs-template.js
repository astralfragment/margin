import { escapeHtml as esc, rowHtml } from './report-template.js';
import { buildReviewModel, imageSize } from './review-model.js';

/**
 * Document flavour for Google Docs and Word. Google's HTML importer drops grid, flex, custom properties and
 * pseudo elements, so this uses only headings, paragraphs, lists, tables and inline styles, with fixed column
 * widths in pixels that add up to the page width so both editors keep them.
 */
const INK = '#09090b';
const INK_2 = '#68686f';
const LINE = '#e4e4e7';
const HEAD_FILL = '#f4f4f5';
const FIXED_FILL = '#e5f1ea';
const SANS = 'Arial, Helvetica, sans-serif';
const MONO_FACE = 'Consolas, "Courier New", monospace';

/** A4 with the usable width at 96 pixels per inch: 17cm in portrait at 2cm margins, 26.7cm in landscape at 1.5cm. */
const PAGES = {
  portrait: { width: 640, size: '21cm 29.7cm', margin: '2cm', orientation: 'portrait' },
  landscape: { width: 1000, size: '29.7cm 21cm', margin: '1.5cm', orientation: 'landscape' },
};

/** Severity text colour, and the tint used only on the summary strip so long table rows stay calm. */
const SEV_STYLE = {
  blocker: { ink: '#dc2626', fill: '#fbe7e7' },
  major: { ink: '#c2410c', fill: '#f8eae4' },
  minor: { ink: '#2563eb', fill: '#e7eefd' },
  nit: { ink: '#71717a', fill: '#f4f4f5' },
};

/** Status as coloured text: Open in the text colour, Fixed green, Won't fix grey. */
const STATUS_STYLE = {
  open: { ink: INK },
  fixed: { ink: '#15803d' },
  wontfix: { ink: '#71717a' },
};

const font = (size, extra = '') => `font-family: ${SANS}; font-size: ${size}pt; color: ${INK}; ${extra}`.trim();
const H1 = font(22, 'font-weight: 700; margin: 0 0 6px; line-height: 1.2;');
const H2 = font(15, 'font-weight: 700; margin: 26px 0 2px; line-height: 1.3;');
const H3 = font(11, 'font-weight: 700; margin: 0 0 4px; line-height: 1.35;');
const P = font(10, 'line-height: 1.45; margin: 0 0 6px;');
const SMALL = font(8.5, `color: ${INK_2}; margin: 0 0 4px;`);
const CAPTION = font(8, `color: ${INK_2}; margin: 3px 0 0;`);
const MONO = `font-family: ${MONO_FACE}; font-size: 8pt;`;
const LIST = font(10, 'line-height: 1.45; margin: 4px 0 6px; padding-left: 22px;');
const KICKER = font(8, `font-weight: 700; letter-spacing: 1px; color: ${INK_2}; margin: 0 0 6px;`);
const CELL = `border: 1px solid ${LINE}; padding: 8px; vertical-align: top;`;
const TH = `${CELL} background: ${HEAD_FILL}; ${font(8.5, `font-weight: 700; color: ${INK_2}; text-align: left;`)}`;
const TABLE = 'border-collapse: collapse; table-layout: fixed;';
const BARE = 'border: none; padding: 0; vertical-align: top;';

/**
 * Text linked to an address, or the plain text when there is no address.
 * @param {string} label The words shown.
 * @param {string} [url] Where they link to.
 */
const LINK = `color: ${INK}; text-decoration: underline;`;
const linked = (label, url) => (url ? `<a href="${esc(url)}" style="${LINK}">${esc(label)}</a>` : esc(label));

const multiline = (text) => esc(text).replace(/\n/g, '<br />');

/** The severity as its shape character and label, bold in its colour. */
const sevText = (comment) => `<b style="color: ${SEV_STYLE[comment.severity.key].ink};">${comment.shape}&nbsp;${esc(comment.severity.label)}</b>`;
const statusText = (status) => `<b style="color: ${STATUS_STYLE[status.key].ink};">${esc(status.label)}</b>`;

/**
 * An image sized to fit a width, never larger than it was on screen, with its caption under it.
 * @param {string} src The image.
 * @param {string} alt What it shows.
 * @param {{ max: number, dpr?: number, caption?: string }} options The widest it may be, the pixel ratio it was captured at, and the caption.
 */
function image(src, alt, { max, dpr = 1, caption = '' }) {
  if (!src) return '';
  const size = imageSize(src);
  const width = Math.round(size ? Math.min(max, size.width / dpr) : max);
  const height = size ? ` height="${Math.round((width * size.height) / size.width)}"` : '';
  return `<p style="margin: 8px 0 0;"><img src="${src}" alt="${esc(alt)}" width="${width}"${height} style="border: 1px solid ${LINE};" /></p>${
    caption ? `<p style="${CAPTION}">${esc(caption)}</p>` : ''
  }`;
}

/**
 * Images in one borderless row of equal cells, which both editors keep side by side.
 * @param {{ src: string, alt: string, caption: string }[]} items The images.
 * @param {number} width The width of the row.
 * @param {number} dpr The pixel ratio they were captured at.
 */
function imageRow(items, width, dpr) {
  const gap = 12;
  const cell = Math.floor((width - gap * (items.length - 1)) / items.length);
  const cols = items.flatMap((_, i) => (i ? [gap, cell] : [cell]));
  const cells = items.flatMap((item, i) => [
    ...(i ? [`<td width="${gap}" style="${BARE} width: ${gap}px;">&nbsp;</td>`] : []),
    `<td width="${cell}" style="${BARE} width: ${cell}px;">${image(item.src, item.alt, { max: cell - 2, dpr, caption: item.caption })}</td>`,
  ]);
  return `<table cellspacing="0" cellpadding="0" width="${width}" style="${TABLE} width: ${width}px; margin: 8px 0 0;">${colgroup(cols)}<tbody><tr>${cells.join('')}</tr></tbody></table>`;
}

/**
 * Fixed column widths, which Docs and Word keep where cell widths alone may be stretched.
 * @param {number[]} widths The column widths in pixels.
 */
const colgroup = (widths) => `<colgroup>${widths.map((w) => `<col width="${w}" />`).join('')}</colgroup>`;

/**
 * The technical details as short lines with bold labels.
 * @param {import('./review-model.js').DetailRow[]} rows The comment's detail rows.
 */
function details(rows) {
  if (!rows.length) return '';
  return `<p style="${font(8, `color: ${INK}; line-height: 1.5; margin: 10px 0 0;`)}">${rows
    .map((row) => `<b style="color: ${INK_2};">${esc(row.label)}</b>&nbsp; ${rowHtml(row, (html) => `<span style="${MONO}">${html}</span>`, LINK)}`)
    .join('<br />')}</p>`;
}

/**
 * Everything written and captured for one comment, sized to a width: title as a heading, note, numbered marker notes,
 * the region (before and after side by side when rechecked), the width shots, the details and the full screenshot.
 * @param {object} comment The comment from the review model.
 * @param {number} width The width available.
 * @param {boolean} withTitle False when the title is already shown, as on a card's band.
 */
function commentContent(comment, width, withTitle = true) {
  const { images, number, dpr } = comment;
  const region = images.after
    ? imageRow(
        [
          { src: images.region, alt: `Marked region for comment ${number}`, caption: 'Before' },
          { src: images.after, alt: `Same region after recheck for comment ${number}`, caption: images.afterCaption },
        ],
        width,
        dpr,
      )
    : image(images.region, `Marked region for comment ${number}`, { max: width, dpr });
  const widths = images.widths.length
    ? imageRow(
        images.widths.map((shot) => ({ src: shot.src, alt: `${shot.label} width for comment ${number}`, caption: shot.caption })),
        width,
        1,
      )
    : '';
  const full = image(images.full, `Full viewport for comment ${number}`, { max: images.region ? Math.round(width * 0.7) : width, dpr, caption: 'Full viewport' });
  return [
    `<a name="comment-${comment.label}"></a>`,
    withTitle ? `<h3 style="${H3}">${esc(comment.title)}</h3>` : '',
    comment.note ? `<p style="${P}">${multiline(comment.note)}</p>` : '',
    comment.marks.length
      ? `<ol style="${LIST}">${comment.marks.map((item) => `<li value="${item.n}" style="margin: 0 0 2px;">${esc(item.note)}</li>`).join('')}</ol>`
      : '',
    region,
    widths,
    details(comment.rows),
    full,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The columns of a page table, fixed in pixels so they add up to the page width. The comment column takes what the others leave.
 * @param {number} pageWidth The usable page width.
 * @param {{ severity: boolean, status: boolean, jira: boolean }} columns Which optional columns to show.
 */
function tableColumns(pageWidth, columns) {
  const wide = pageWidth > 800;
  const cols = [
    { key: 'num', label: '#', width: wide ? 44 : 36 },
    { key: 'comment', label: 'Comment', width: 0 },
    columns.severity && { key: 'severity', label: 'Severity', width: wide ? 104 : 84 },
    columns.status && { key: 'status', label: 'Status', width: wide ? 96 : 76 },
    columns.jira && { key: 'jira', label: 'Jira and notes', width: wide ? 200 : 116 },
  ].filter(Boolean);
  cols[1].width = pageWidth - cols.reduce((sum, c) => sum + c.width, 0);
  return cols;
}

/**
 * One page's comments as one table with a shaded header row and a row per comment.
 * @param {object} section A page section from the review model.
 * @param {{ key: string, label: string, width: number }[]} cols The table columns.
 * @param {number} pageWidth The usable page width.
 */
function pageTable(section, cols, pageWidth) {
  const cell = {
    num: (c) => `<td width="${cols[0].width}" style="${CELL} width: ${cols[0].width}px; ${font(10, 'font-weight: 700;')}"><span style="color: ${INK_2};">${c.label}</span></td>`,
    comment: (c, w) => `<td width="${w}" style="${CELL} width: ${w}px;">${commentContent(c, w - 18)}</td>`,
    severity: (c, w) => `<td width="${w}" style="${CELL} width: ${w}px; ${font(9)}">${sevText(c)}</td>`,
    status: (c, w) => `<td width="${w}" style="${CELL} width: ${w}px; ${font(9)}">${statusText(c.status)}</td>`,
    jira: (c, w) =>
      `<td width="${w}" style="${CELL} width: ${w}px; ${font(9)}">${
        c.jira ? `<b>${linked(c.jira.key, c.jira.url)}</b>${c.jira.status ? `<br /><span style="color: ${INK_2};">${esc(c.jira.status)}</span>` : ''}` : '&nbsp;'
      }</td>`,
  };
  return `<table cellspacing="0" cellpadding="0" width="${pageWidth}" style="${TABLE} width: ${pageWidth}px; margin: 10px 0 0;">
    ${colgroup(cols.map((c) => c.width))}
    <thead><tr>${cols.map((c) => `<td width="${c.width}" style="${TH} width: ${c.width}px;">${c.label}</td>`).join('')}</tr></thead>
    <tbody>
      ${section.comments.map((comment) => `<tr>${cols.map((c) => cell[c.key](comment, c.width)).join('')}</tr>`).join('\n      ')}
    </tbody>
  </table>`;
}

/**
 * One comment as a bordered card: a shaded band with the number, title, severity and status, then the content.
 * @param {object} comment The comment from the review model.
 * @param {number} pageWidth The usable page width.
 * @param {{ severity: boolean, status: boolean, jira: boolean }} columns Which labels to show on the band.
 */
function commentCard(comment, pageWidth, columns) {
  const side = 200;
  const labels = [
    columns.severity ? sevText(comment) : '',
    columns.status ? statusText(comment.status) : '',
    columns.jira && comment.jira ? linked(comment.jira.key, comment.jira.url) : '',
  ].filter(Boolean);
  return `<table cellspacing="0" cellpadding="0" width="${pageWidth}" style="${TABLE} width: ${pageWidth}px; margin: 12px 0 0;">
    ${colgroup([pageWidth - side, side])}
    <tbody>
      <tr>
        <td width="${pageWidth - side}" style="${CELL} width: ${pageWidth - side}px; padding: 10px 12px; background: ${HEAD_FILL}; border-right: none;">
          <h3 style="${H3} margin: 0;"><span style="color: ${INK_2};">${comment.label}</span>&nbsp;&nbsp;${esc(comment.title)}</h3>
        </td>
        <td width="${side}" style="${CELL} width: ${side}px; padding: 11px 12px; background: ${HEAD_FILL}; border-left: none; text-align: right; ${font(9)}">${labels.join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}</td>
      </tr>
      <tr><td colspan="2" width="${pageWidth}" style="${CELL} padding: 12px;">${commentContent(comment, pageWidth - 26, false)}</td></tr>
    </tbody>
  </table>`;
}

/**
 * The counts by severity, each tinted with its shape, and how many are fixed.
 * @param {object} model The review model.
 * @param {number} pageWidth The usable page width.
 */
function summaryTable(model, pageWidth) {
  const progressWidth = pageWidth - 4 * Math.floor(pageWidth / 6);
  const sevWidth = Math.floor(pageWidth / 6);
  const count = (key) => model.statuses.find((s) => s.key === key).count;
  const cells = model.severities.map(
    (s) =>
      `<td width="${sevWidth}" style="${CELL} width: ${sevWidth}px; padding: 8px 10px; background: ${SEV_STYLE[s.key].fill};"><p style="${font(8.5, `font-weight: 700; color: ${SEV_STYLE[s.key].ink}; margin: 0;`)}">${s.shape}&nbsp;${esc(s.label)}</p><p style="${font(18, 'font-weight: 700; margin: 2px 0 0;')}">${s.count}</p></td>`,
  );
  const rest = [count('wontfix') ? `${count('wontfix')} won't fix` : '', `${count('open')} open`].filter(Boolean).join(', ');
  cells.push(
    `<td width="${progressWidth}" style="${CELL} width: ${progressWidth}px; padding: 8px 10px; background: ${FIXED_FILL};"><p style="${font(8.5, `font-weight: 700; color: ${STATUS_STYLE.fixed.ink}; margin: 0;`)}">Progress</p><p style="${font(18, 'font-weight: 700; margin: 2px 0 0;')}">${esc(model.progress.text)}</p><p style="${SMALL} margin: 0;">${esc(rest)}</p></td>`,
  );
  return `<table cellspacing="0" cellpadding="0" width="${pageWidth}" style="${TABLE} width: ${pageWidth}px; margin: 8px 0 0;">${colgroup([...Array(4).fill(sevWidth), progressWidth])}<tbody><tr>${cells.join('')}</tr></tbody></table>`;
}

/**
 * The overview table: every comment on one line, in report order, so a reader sees the whole review before the detail.
 * @param {object} model The review model.
 * @param {number} pageWidth The usable page width.
 */
function overviewTable(model, pageWidth) {
  const wide = pageWidth > 800;
  const cols = { n: wide ? 44 : 36, title: 0, page: wide ? 90 : 72, sev: wide ? 104 : 84, status: wide ? 96 : 76 };
  cols.title = pageWidth - cols.n - cols.page - cols.sev - cols.status;
  const td = (w, extra = '') => `width="${w}" style="${CELL} width: ${w}px; padding: 5px 8px; ${font(9)} ${extra}"`;
  const rows = model.sections.flatMap((section) =>
    section.comments.map(
      (comment) => `<tr>
        <td ${td(cols.n, `font-weight: 700; color: ${INK_2};`)}>${comment.label}</td>
        <td ${td(cols.title)}><a href="#comment-${comment.label}" style="color: ${INK}; text-decoration: none;">${esc(comment.title)}</a></td>
        <td ${td(cols.page, `color: ${INK_2};`)}>${section.label}</td>
        <td ${td(cols.sev)}>${sevText(comment)}</td>
        <td ${td(cols.status)}>${statusText(comment.status)}</td>
      </tr>`,
    ),
  );
  const head = ['#', 'Comment', 'Page', 'Severity', 'Status'];
  return `<table cellspacing="0" cellpadding="0" width="${pageWidth}" style="${TABLE} width: ${pageWidth}px; margin: 10px 0 0;">
    ${colgroup(Object.values(cols))}
    <thead><tr>${Object.values(cols).map((w, i) => `<td width="${w}" style="${TH} width: ${w}px; padding: 6px 8px;">${head[i]}</td>`).join('')}</tr></thead>
    <tbody>
      ${rows.join('\n      ')}
    </tbody>
  </table>`;
}

/**
 * One page's section: its COMM label and route as a heading, its link, then its table or cards.
 * @param {object} section A page section from the review model.
 * @param {object} config The export configuration.
 * @param {number} pageWidth The usable page width.
 */
function commSection(section, config, pageWidth) {
  const body =
    config.docLayout === 'cards'
      ? section.comments.map((comment) => commentCard(comment, pageWidth, config.columns)).join('\n  ')
      : pageTable(section, tableColumns(pageWidth, config.columns), pageWidth);
  return `
  <h2 style="${H2}">${section.label}&nbsp;&nbsp;${esc(section.route)}</h2>
  ${section.url ? `<p style="${SMALL}"><a href="${esc(section.url)}" style="color: ${INK_2}; text-decoration: underline;">${esc(section.url)}</a></p>` : ''}
  ${body}`;
}

/**
 * The lines under the title: site, date and size, then the review's Jira ticket and Figma file.
 * @param {object} model The review model.
 * @param {(label: string, url: string) => string} link Writes one link.
 */
function headerLines(model, link) {
  const { jira, figma } = model.links;
  return [
    [model.sites.join(', '), model.date, model.summary, model.total ? model.progress.text : ''].filter(Boolean),
    [
      jira ? `Jira ${link(jira.key, jira.url)}${jira.status ? ` (${jira.status})` : ''}` : '',
      figma ? `Figma ${link(figma.name, figma.url)}` : '',
    ].filter(Boolean),
  ].filter((line) => line.length);
}

/**
 * Plain text version, used as the second clipboard flavour. It follows the Docs table order: summary, then each page
 * and its comments, with the details aligned under each comment.
 * @param {object[]} issues The comments, in the order they were made.
 * @param {object} [options] The same options as buildDocsHtml.
 */
export function buildDocsText(issues, options = {}) {
  const model = buildReviewModel(issues, { title: 'UI review comments', ...options, preview: false });
  const lines = [model.title, ...headerLines(model, (label, url) => (url ? `${label} ${url}` : label)).map((parts) => parts.join(' · ')), ''];
  if (model.config.summary && model.total) {
    const width = Math.max(...model.severities.map((s) => s.label.length));
    lines.push('Summary', ...model.severities.map((s) => `  ${s.shape} ${s.label.padEnd(width)}  ${String(s.count).padStart(3)}`), '');
  }
  const indent = '      ';
  model.sections.forEach((section) => {
    lines.push(`${section.label}  ${section.route}`, ...(section.url ? [section.url] : []), '');
    section.comments.forEach((comment) => {
      const tags = [`${comment.shape} ${comment.severity.label}`, comment.status.label, comment.jira ? `${comment.jira.key}${comment.jira.status ? ` ${comment.jira.status}` : ''}` : ''];
      lines.push(`  ${comment.label}  ${comment.title}`, `${indent}${tags.filter(Boolean).join(' · ')}`);
      if (comment.note) lines.push(...comment.note.split('\n').map((line) => `${indent}${line}`));
      comment.marks.forEach((item) => lines.push(`${indent}${item.n}. ${item.note.replace(/\s*\n\s*/g, ' ')}`));
      if (comment.images.afterCaption) lines.push(`${indent}${comment.images.afterCaption}`);
      if (comment.images.widths.length) lines.push(`${indent}${comment.images.widths.map((shot) => shot.caption).join('. ')}`);
      const labelWidth = Math.max(0, ...comment.rows.map((row) => row.label.length));
      comment.rows.forEach((row) => lines.push(`${indent}${row.label.padEnd(labelWidth)}  ${row.value}`));
      lines.push('');
    });
  });
  if (!model.total) lines.push('No comments captured.', '');
  return lines.join('\n');
}

/**
 * Renders the report as a document for Google Docs, Word, or any editor that imports HTML. Used for both the .doc
 * download and the clipboard copy. Each page is one table with a row per comment, or a card per comment when the
 * docLayout option is cards. The orientation option sets the Word page and the table widths.
 * @param {object[]} issues The comments, in the order they were made.
 * @param {object} [options] The review model options (see buildReviewModel).
 */
export function buildDocsHtml(issues, options = {}) {
  const model = buildReviewModel(issues, { title: 'UI review comments', ...options, preview: false });
  const { config } = model;
  const page = PAGES[config.orientation] ?? PAGES.landscape;
  const header = headerLines(model, (label, url) => linked(label, url)).map(
    (parts, i) => `<p style="${i ? SMALL : font(10, `color: ${INK_2}; margin: 0 0 4px;`)}">${parts.map((part, j) => (i ? part : esc(part))).join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')}</p>`,
  );
  const withSummary = config.summary && model.total > 0;
  const body = model.total ? model.sections.map((section) => commSection(section, config, page.width)).join('\n') : `<p style="${P}">No comments captured.</p>`;

  return `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${esc(model.title)}</title>
<style>
@page WordSection1 { size: ${page.size}; mso-page-orientation: ${page.orientation}; margin: ${page.margin}; }
div.WordSection1 { page: WordSection1; }
</style>
</head>
<body style="background: #ffffff; color: ${INK};">
<div class="WordSection1">
  <p style="${KICKER}">UI REVIEW</p>
  <h1 style="${H1}">${esc(model.title)}</h1>
  ${header.join('\n  ')}
  ${withSummary ? `<h2 style="${H2}">Summary</h2>\n  ${summaryTable(model, page.width)}\n  ${overviewTable(model, page.width)}` : ''}
  ${body}
  <p style="${SMALL} margin-top: 24px;">Made with Margin</p>
</div>
</body>
</html>`;
}
