/** The widths one action captures a comment at, narrowest first. */
export const WIDTHS = [
  { key: 'mobile', label: 'Mobile', width: 375 },
  { key: 'tablet', label: 'Tablet', width: 768 },
  { key: 'desktop', label: 'Desktop', width: 1280 },
];

/** How a comment's region was placed at a width: on its element, at the saved spot because the element was hidden, or at the saved spot because it was not found. */
export const PLACEMENTS = ['found', 'hidden', 'lost'];

const PLACEMENT_NOTES = {
  hidden: 'Element hidden at this width, cut at the saved position',
  lost: 'Element not found, cut at the saved position',
};

/**
 * The widths a comment was captured at, in order, with the width aimed for and the width reached.
 * @param {{ shots?: Record<string, { src: string, width: number, placed: string }> }} issue The stored comment.
 */
export function widthShots(issue) {
  return WIDTHS.filter((w) => issue.shots?.[w.key]?.src).map((w) => ({
    key: w.key,
    label: w.label,
    target: w.width,
    width: issue.shots[w.key].width,
    src: issue.shots[w.key].src,
    placed: issue.shots[w.key].placed,
  }));
}

/**
 * The caption under one width shot, saying when the width or the element could not be matched.
 * @param {{ label: string, target: number, width: number, placed: string }} shot One entry from widthShots.
 */
export function widthCaption(shot) {
  const size = Math.abs(shot.width - shot.target) <= 2 ? `${shot.width}px` : `${shot.width}px, the closest Chrome allowed to ${shot.target}px`;
  const note = PLACEMENT_NOTES[shot.placed];
  return `${shot.label}, ${size}${note ? `. ${note}` : ''}`;
}

/**
 * One line naming every width a comment was captured at, for text and Markdown exports.
 * @param {object} issue The stored comment.
 */
export function widthsLine(issue) {
  return widthShots(issue).map(widthCaption).join('. ');
}
