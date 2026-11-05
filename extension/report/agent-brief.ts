import type { Comment, Marker, Review } from '@/lib/model';

const STATUS_LABEL: Record<Comment['status'], string> = { open: 'open', fixed: 'fixed', wontfix: "won't fix" };

/**
 * One marker as a line an agent can act on, in the screenshot's CSS pixels.
 * @param mark The marker.
 * @param index Its number on the screenshot, from 0.
 */
function markerLine(mark: Marker, index: number) {
  const at =
    mark.kind === 'box'
      ? `box at ${Math.round(mark.x)},${Math.round(mark.y)} size ${Math.round(mark.w ?? 0)}x${Math.round(mark.h ?? 0)}`
      : mark.kind === 'arrow'
        ? `arrow from ${Math.round(mark.x)},${Math.round(mark.y)} to ${Math.round(mark.x2 ?? mark.x)},${Math.round(mark.y2 ?? mark.y)}`
        : `point at ${Math.round(mark.x)},${Math.round(mark.y)}`;
  return `${index + 1}. ${at}${mark.note.trim() ? `. ${mark.note.trim()}` : ''}`;
}

/**
 * One comment as a section of facts, so an agent can find the code and the spot without seeing the screenshot.
 * @param comment The comment.
 * @param number Its number in the review, as the report shows it.
 */
function commentSection(comment: Comment, number: number) {
  const lines = [`## ${String(number).padStart(2, '0')}. ${comment.title.trim() || 'Untitled comment'}`, ''];
  const facts: [string, string | undefined][] = [
    ['Severity', comment.severity],
    ['Status', STATUS_LABEL[comment.status]],
    ['Page', [comment.page.title, comment.page.url].filter(Boolean).join(', ') || undefined],
    ['Element', comment.element ? `\`${comment.element.selector}\` (${comment.element.tag}${comment.element.text ? `, text "${comment.element.text.slice(0, 120)}"` : ''})` : undefined],
    ['Anchor', !comment.element && comment.anchor ? `\`${comment.anchor.selector}\` match ${comment.anchor.nth + 1}` : undefined],
    ['Region', `${Math.round(comment.rect.x)},${Math.round(comment.rect.y)} size ${Math.round(comment.rect.w)}x${Math.round(comment.rect.h)} in a ${comment.viewport.width}x${comment.viewport.height} viewport, scrolled ${Math.round(comment.viewport.scrollY)}px`],
    ['Browser', comment.env ? `${comment.env.browser} on ${comment.env.os}, zoom ${comment.env.zoom}%` : undefined],
    ['Figma frame', comment.figmaFrame ? `${comment.figmaFrame.name} (file ${comment.figmaFrame.fileKey}, node ${comment.figmaFrame.nodeId})` : undefined],
    ['Jira', comment.jira ? `${comment.jira.key} ${comment.jira.url}` : undefined],
    ['Links', comment.links?.length ? comment.links.join(' ') : undefined],
    ['Recheck', comment.checkedAt ? `rechecked ${comment.checkedAt}${comment.change == null ? '' : `, ${Math.round(comment.change * 100)}% of the region changed`}` : undefined],
  ];
  for (const [label, value] of facts) if (value) lines.push(`- ${label}: ${value}`);
  if (comment.note.trim()) lines.push('', comment.note.trim());
  if (comment.marks?.length) lines.push('', 'Markers on the screenshot:', ...comment.marks.map(markerLine));
  return lines.join('\n');
}

/**
 * The review as a brief for a coding agent: what to fix, where it is on the page and in the DOM, open comments first.
 * Coordinates are CSS pixels of the captured viewport, which is what an agent needs to match a screenshot or a layout.
 * @param review The review, for its name.
 * @param comments Its comments in the order they were made, which sets their numbers.
 */
export function buildAgentBrief(review: Pick<Review, 'name'> | null, comments: Comment[]) {
  const numbered = comments.map((comment, index) => ({ comment, number: index + 1 }));
  const open = numbered.filter(({ comment }) => comment.status === 'open');
  const closed = numbered.filter(({ comment }) => comment.status !== 'open');
  const intro = [
    `# ${review?.name ?? 'UI review'}`,
    '',
    `${open.length} open of ${comments.length} comments, from a Margin review. Each one marks a region of a page screenshot. Fix the open ones, then say which numbers you changed. Coordinates are CSS pixels of the captured viewport. Numbered markers point at exact spots inside the region.`,
  ];
  const sections = [...open, ...closed].map(({ comment, number }) => commentSection(comment, number));
  return [...intro, ...sections].join('\n\n') + '\n';
}
