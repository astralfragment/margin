import { escapeHtml as esc, rowHtml } from './report-template.js';
import { buildReviewModel, reviewComment } from './review-model.js';

const IMAGE_WIDTH = 640;

const oneLine = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();

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
 * One comment from the review model as Markdown.
 * @param {object} comment The comment from the review model.
 * @param {string} heading The heading prefix.
 */
function markdownOf(comment, heading) {
  const lines = [`${heading} ${comment.label}. ${oneLine(comment.title)}`, '', `**${comment.severity.label}**, ${comment.status.label}`];
  if (comment.note) lines.push('', comment.note);
  if (comment.marks.length) lines.push('', ...comment.marks.map((item) => `${item.n}. ${oneLine(item.note)}`));
  if (comment.images.afterCaption) lines.push('', `_${comment.images.afterCaption}_`);
  if (comment.images.widths.length) lines.push('', `_${comment.images.widths.map((shot) => shot.caption).join('. ')}_`);
  if (comment.rows.length) lines.push('', ...comment.rows.map((row) => `- ${row.label}: ${rowMarkdown(row)}`));
  return lines.join('\n');
}

/**
 * One comment as Markdown, for GitHub issues, Slack, chat or a coding agent.
 * @param {object} issue The stored comment.
 * @param {{ number: number, heading?: string, fields?: Record<string, boolean>, widths?: boolean }} options Its comment number, the heading prefix, which detail rows to include, and whether to name the widths captured.
 */
export function commentMarkdown(issue, { number, heading = '###', fields, widths } = {}) {
  return markdownOf(reviewComment(issue, number, { fields, widths }), heading);
}

/**
 * A whole review as Markdown, one section per page, each comment under the number it has in the report.
 * Screenshots stay out, since Markdown cannot carry them inline. The Docs, Word and HTML exports keep them.
 * @param {object[]} issues The comments in the review.
 * @param {{ title?: string, generatedAt?: Date, fields?: Record<string, boolean>, widths?: boolean }} [options] The review title and date, which detail rows to include, and whether to name the widths captured.
 */
export function buildMarkdown(issues, options = {}) {
  const model = buildReviewModel(issues, { title: 'UI review comments', ...options });
  const sections = model.sections.map((section) =>
    [`## ${section.label}: ${section.route}`, ...(section.url ? ['', section.url] : []), ...section.comments.map((comment) => `\n${markdownOf(comment, '###')}`)].join('\n'),
  );
  return [`# ${model.title}`, '', `${model.date}, ${model.summary}`, '', ...sections].join('\n').trim() + '\n';
}

/**
 * One comment as rich text for pasting into Slack, Jira, email or a doc, with its marked region image.
 * @param {object} issue The stored comment.
 * @param {{ number: number, shots?: string, fields?: Record<string, boolean>, widths?: boolean }} options Its comment number, which images and detail rows to include, and whether to add the width shots.
 */
export function commentHtml(issue, { number, shots, fields, widths } = {}) {
  const comment = reviewComment(issue, number, { shots, fields, widths });
  const shot = comment.images.region || comment.images.full;
  return `<div>
  <p><b>${comment.label}. ${esc(oneLine(comment.title))}</b><br />${esc(comment.severity.label)}, ${esc(comment.status.label)}</p>
  ${comment.note ? `<p>${esc(comment.note).replace(/\n/g, '<br />')}</p>` : ''}
  ${comment.marks.length ? `<ol>${comment.marks.map((item) => `<li value="${item.n}">${esc(oneLine(item.note))}</li>`).join('')}</ol>` : ''}
  ${comment.rows.length ? `<p>${comment.rows.map((row) => `${esc(row.label)}: ${rowHtml(row, (html) => html)}`).join('<br />')}</p>` : ''}
  ${shot ? `<p><img src="${shot}" alt="Comment ${comment.number}" width="${IMAGE_WIDTH}" style="max-width: 100%;" /></p>` : ''}
  ${comment.images.widths.map((width) => `<p><img src="${width.src}" alt="${esc(width.label)} width" width="${Math.round(IMAGE_WIDTH / 2)}" style="max-width: 100%;" /><br />${esc(width.caption)}</p>`).join('\n  ')}
</div>`;
}
