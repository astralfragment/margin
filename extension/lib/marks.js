export const MARK_LABELS = { dot: 'Marker', box: 'Box', arrow: 'Arrow' };

/** The red of everything Margin draws on a screenshot and of the marker numbers in exports. White digits on it keep 5 to 1. */
export const MARK_COLOUR = '#ce2c31';

/**
 * The numbered annotation notes of a comment, keeping each one's number from the image.
 * Annotations without a note are left out, so the list only says what was written.
 * @param {{ marks?: { kind: string, note?: string }[] }} issue The stored comment.
 */
export function markList(issue) {
  return (issue.marks ?? [])
    .map((mark, i) => ({ n: i + 1, kind: mark.kind, note: String(mark.note ?? '').trim() }))
    .filter((item) => item.note);
}
