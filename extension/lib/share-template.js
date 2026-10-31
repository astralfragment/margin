import { escapeHtml as esc, rowHtml } from './report-template.js';
import { buildReviewModel, reviewComment } from './review-model.js';
import { exportOptions } from './export-config.js';

const IMAGE_WIDTH = 640;
const SEV_INK = { blocker: '#dc2626', major: '#c2410c', minor: '#2563eb', nit: '#71717a' };
const STATUS_INK = { open: '#09090b', fixed: '#15803d', wontfix: '#71717a' };
const DOT = ' · ';
const LINK = 'color: inherit; text-decoration: underline;';

/**
 * Text folded onto one line.
 * @param {string} text The text.
 */
const oneLine = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();

/** Escapes the characters that would break a Markdown table cell or start formatting by accident. */
const cell = (text) => oneLine(text).replace(/\|/g, '\\|');

/**
 * A detail row in Markdown, with each link written as a Markdown link.
 * @param {import('./review-model.js').DetailRow} row The detail row.
 */
function rowMarkdown(row) {
  if (row.links) {
    const links = row.links.map((l) => (l.url && l.url !== l.text ? `[${l.text}](${l.url})` : l.url || l.text)).join(', ');
    return row.extra ? `${links}, ${row.extra}` : links;
  }
  return row.code ? `\`${row.value}\`` : row.value;
}

/**
 * The severity, status and Jira line under a comment's heading.
 * @param {object} comment The comment from the review model.
 */
const tagLine = (comment) =>
  [
    `${comment.shape} **${comment.severity.label}**`,
    comment.status.label,
    comment.jira ? (comment.jira.url ? `[${comment.jira.key}](${comment.jira.url})` : comment.jira.key) + (comment.jira.status ? ` ${comment.jira.status}` : '') : '',
  ]
    .filter(Boolean)
    .join(DOT);

/**
 * One comment from the review model as Markdown.
 * @param {object} comment The comment from the review model.
 * @param {string} heading The heading prefix.
 * @param {boolean} withPage True to name the page, for a comment pasted on its own.
 */
function markdownOf(comment, heading, withPage = false) {
  const lines = [`${heading} ${comment.label}. ${oneLine(comment.title)}`, '', tagLine(comment)];
  if (withPage && comment.url) lines.push('', `On [${comment.route}](${comment.url})`);
  if (comment.note) lines.push('', comment.note.replace(/\n/g, '\\\n'));
  if (comment.marks.length) lines.push('', ...comment.marks.map((item) => `${item.n}. ${oneLine(item.note)}`));
  if (comment.images.afterCaption) lines.push('', `_${comment.images.afterCaption}_`);
  if (comment.images.widths.length) lines.push('', `_${comment.images.widths.map((shot) => shot.caption).join('. ')}_`);
  if (comment.rows.length) lines.push('', ...comment.rows.map((row) => `- ${row.label}: ${rowMarkdown(row)}`));
  return lines.join('\n');
}

/**
 * One comment as Markdown, self contained for GitHub issues, Slack, Jira, chat or a coding agent.
 * @param {object} issue The stored comment.
 * @param {{ number: number, heading?: string }} options Its comment number and the heading prefix, plus the export configuration.
 */
export function commentMarkdown(issue, { number, heading = '###', ...options } = {}) {
  return markdownOf(reviewComment(issue, number, exportOptions(options)), heading, true);
}

/**
 * The counts by severity and status as a Markdown table.
 * @param {object} model The review model.
 */
function summaryTable(model) {
  const statuses = model.statuses;
  const head = `| Severity | Comments | ${statuses.map((s) => s.label).join(' | ')} |`;
  const rule = `| :-- | --: | ${statuses.map(() => '--:').join(' | ')} |`;
  const rows = model.severities.map((s) => `| ${s.shape} ${s.label} | ${s.count} | ${statuses.map((st) => s.byStatus[st.key]).join(' | ')} |`);
  const total = `| **Total** | **${model.total}** | ${statuses.map((s) => `**${s.count}**`).join(' | ')} |`;
  return [head, rule, ...rows, total].join('\n');
}

/**
 * A whole review as Markdown: a checklist and summary table, then one section per page, each comment under the number it has in the report.
 * Screenshots stay out, since Markdown cannot carry them inline. The Docs, Word and HTML exports keep them.
 * @param {object[]} issues The comments in the review.
 * @param {object} [options] The review model options (see buildReviewModel).
 */
export function buildMarkdown(issues, options = {}) {
  const model = buildReviewModel(issues, { title: 'UI review comments', ...options, preview: false });
  const { jira, figma } = model.links;
  const meta = [model.sites.join(', '), model.date, model.summary, model.total ? model.progress.text : ''].filter(Boolean).join(DOT);
  const links = [
    jira ? `Jira ${jira.url ? `[${jira.key}](${jira.url})` : jira.key}${jira.status ? ` (${jira.status})` : ''}` : '',
    figma ? `Figma ${figma.url ? `[${figma.name}](${figma.url})` : figma.name}` : '',
  ].filter(Boolean);
  const top = [`# ${model.title}`, '', meta, ...(links.length ? ['', links.join(DOT)] : [])];
  if (model.config.summary && model.total) {
    top.push(
      '',
      '## Checklist',
      '',
      ...model.sections.flatMap((section) =>
        section.comments.map(
          (c) => `- [${c.status.key === 'open' ? ' ' : 'x'}] ${c.label} ${c.status.key === 'wontfix' ? `~~${cell(c.title)}~~ (Won't fix)` : cell(c.title)}${DOT}${c.shape} ${c.severity.label}${DOT}${section.label}`,
        ),
      ),
      '',
      '## Summary',
      '',
      summaryTable(model),
    );
  }
  const sections = model.sections.map((section) =>
    [`## ${section.label}${DOT}${section.route}`, ...(section.url ? ['', section.url] : []), ...section.comments.map((comment) => `\n${markdownOf(comment, '###')}`)].join('\n'),
  );
  return [...top, ...sections.map((s) => `\n${s}`), ...(model.total ? [] : ['', 'No comments captured.'])].join('\n').trim() + '\n';
}

/**
 * One comment as rich text for pasting into Slack, Jira, email or a doc, with its marked region image.
 * @param {object} issue The stored comment.
 * @param {{ number: number }} options Its comment number, plus the export configuration.
 */
export function commentHtml(issue, { number, ...options } = {}) {
  const comment = reviewComment(issue, number, exportOptions(options));
  const shot = comment.images.region || comment.images.full;
  const tags = [
    `<b style="color: ${SEV_INK[comment.severity.key]};">${comment.shape} ${esc(comment.severity.label)}</b>`,
    `<b style="color: ${STATUS_INK[comment.status.key]};">${esc(comment.status.label)}</b>`,
    comment.jira ? (comment.jira.url ? `<a href="${esc(comment.jira.url)}" style="${LINK}">${esc(comment.jira.key)}</a>` : esc(comment.jira.key)) + (comment.jira.status ? ` ${esc(comment.jira.status)}` : '') : '',
  ].filter(Boolean);
  return `<div>
  <p><b>${comment.label}. ${esc(oneLine(comment.title))}</b><br />${tags.join(DOT)}${comment.url ? `<br />On <a href="${esc(comment.url)}" style="${LINK}">${esc(comment.route)}</a>` : ''}</p>
  ${comment.note ? `<p>${esc(comment.note).replace(/\n/g, '<br />')}</p>` : ''}
  ${comment.marks.length ? `<ol>${comment.marks.map((item) => `<li value="${item.n}">${esc(oneLine(item.note))}</li>`).join('')}</ol>` : ''}
  ${shot ? `<p><img src="${shot}" alt="Comment ${comment.number}" width="${IMAGE_WIDTH}" style="max-width: 100%;" /></p>` : ''}
  ${comment.images.after ? `<p><img src="${comment.images.after}" alt="Comment ${comment.number} after recheck" width="${IMAGE_WIDTH}" style="max-width: 100%;" /><br /><i>${esc(comment.images.afterCaption)}</i></p>` : ''}
  ${comment.images.widths.map((width) => `<p><img src="${width.src}" alt="${esc(width.label)} width" width="${Math.round(IMAGE_WIDTH / 2)}" style="max-width: 100%;" /><br /><i>${esc(width.caption)}</i></p>`).join('\n  ')}
  ${comment.rows.length ? `<p class="details">${comment.rows.map((row) => `<b>${esc(row.label)}</b>: ${rowHtml(row, (html) => `<code>${html}</code>`, LINK)}`).join('<br />')}</p>` : ''}
</div>`;
}
