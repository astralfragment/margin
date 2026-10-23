import { severityOf } from './severity.js';
import { statusOf } from './status.js';
import { environmentText, escapeHtml as esc, recheckCaption, routeOf } from './report-template.js';
import { groupByPage } from './docs-template.js';
import { DEFAULT_FIELDS, withDefaults } from './fields.js';
import { markList } from './marks.js';
import { widthCaption, widthShots, widthsLine } from './widths.js';

const IMAGE_WIDTH = 640;

/**
 * The detail lines under a comment as plain label and value pairs, following the fields the review shows.
 * @param {object} issue The stored comment.
 * @param {Record<string, boolean>} fields Which detail rows are switched on.
 */
function factPairs(issue, fields) {
  const el = issue.element;
  return [
    fields.page && issue.page?.url ? ['Page', issue.page.url] : null,
    fields.figma && issue.links?.length ? ['Figma', issue.links.join(' ')] : null,
    fields.jira && issue.jira?.key ? ['Jira', `${issue.jira.key} ${issue.jira.url ?? ''}`.trim()] : null,
    fields.selector && el?.selector ? ['Selector', `\`${el.selector}\``] : null,
    fields.text && el?.text ? ['Text', el.text] : null,
    fields.position
      ? ['Position', `${issue.rect.w} x ${issue.rect.h} at ${issue.rect.x}, ${issue.rect.y} in ${issue.viewport.width} x ${issue.viewport.height} at ${issue.viewport.dpr}x`]
      : null,
    fields.browser && issue.env ? ['Browser', environmentText(issue)] : null,
    fields.captured ? ['Captured', new Date(issue.createdAt).toLocaleString()] : null,
  ].filter(Boolean);
}

const oneLine = (text) => String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();

/**
 * One comment as Markdown, for GitHub issues, Slack, chat or a coding agent.
 * @param {object} issue The stored comment.
 * @param {{ heading?: string, fields?: Record<string, boolean>, widths?: boolean }} [options] The heading prefix, which detail rows to include, and whether to name the widths captured.
 */
export function commentMarkdown(issue, { heading = '###', fields = DEFAULT_FIELDS, widths = true } = {}) {
  const lines = [`${heading} ${oneLine(issue.title) || 'Untitled comment'}`, '', `**${severityOf(issue.severity).label}**, ${statusOf(issue.status).label}`];
  if (issue.note) lines.push('', issue.note.trim());
  const marks = markList(issue);
  if (marks.length) lines.push('', ...marks.map((item) => `${item.n}. ${oneLine(item.note)}`));
  if (issue.after) lines.push('', `_${recheckCaption(issue)}_`);
  if (widths && widthShots(issue).length) lines.push('', `_${widthsLine(issue)}_`);
  const facts = factPairs(issue, withDefaults(fields));
  if (facts.length) lines.push('', ...facts.map(([label, value]) => `- ${label}: ${value}`));
  return lines.join('\n');
}

/**
 * A whole review as Markdown, one section per page with its comments numbered C1, C2 and on.
 * Screenshots stay out, since Markdown cannot carry them inline. The Docs, Word and HTML exports keep them.
 * @param {object[]} issues The comments in the review.
 * @param {{ title?: string, fields?: Record<string, boolean>, widths?: boolean }} [options] The review title, which detail rows to include, and whether to name the widths captured.
 */
export function buildMarkdown(issues, { title = 'UI review comments', fields = DEFAULT_FIELDS, widths = true } = {}) {
  const sections = groupByPage(issues).map((group, index) =>
    [
      `## COMM${index + 1}: ${routeOf(group.page)}`,
      '',
      group.page.url,
      ...group.issues.map((issue, i) => `\n${commentMarkdown({ ...issue, title: `C${i + 1}. ${oneLine(issue.title) || 'Untitled comment'}` }, { fields: { ...withDefaults(fields), page: false }, widths })}`),
    ].join('\n'),
  );
  return [`# ${title}`, '', `${issues.length} ${issues.length === 1 ? 'comment' : 'comments'}`, '', ...sections].join('\n').trim() + '\n';
}

/**
 * One comment as rich text for pasting into Slack, Jira, email or a doc, with its marked region image.
 * @param {object} issue The stored comment.
 * @param {Record<string, boolean>} [fields] Which detail rows to include.
 * @param {boolean} [widths] Whether to add the mobile, tablet and desktop shots.
 */
export function commentHtml(issue, fields = DEFAULT_FIELDS, widths = true) {
  const marks = markList(issue);
  const atWidths = widths ? widthShots(issue) : [];
  const facts = factPairs(issue, withDefaults(fields));
  return `<div>
  <p><b>${esc(oneLine(issue.title) || 'Untitled comment')}</b><br />${esc(severityOf(issue.severity).label)}, ${esc(statusOf(issue.status).label)}</p>
  ${issue.note ? `<p>${esc(issue.note.trim()).replace(/\n/g, '<br />')}</p>` : ''}
  ${marks.length ? `<ol>${marks.map((item) => `<li value="${item.n}">${esc(oneLine(item.note))}</li>`).join('')}</ol>` : ''}
  ${facts.length ? `<p>${facts.map(([label, value]) => `${esc(label)}: ${esc(value.replace(/`/g, ''))}`).join('<br />')}</p>` : ''}
  ${issue.detail ? `<p><img src="${issue.detail}" alt="Marked region" width="${IMAGE_WIDTH}" style="max-width: 100%;" /></p>` : ''}
  ${atWidths.map((shot) => `<p><img src="${shot.src}" alt="${esc(shot.label)} width" width="${Math.round(IMAGE_WIDTH / 2)}" style="max-width: 100%;" /><br />${esc(widthCaption(shot))}</p>`).join('\n  ')}
</div>`;
}
