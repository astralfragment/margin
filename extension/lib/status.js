/**
 * Where a comment stands after review, in the order the filters show them.
 * `key` is what gets stored on an issue record, `label` is what a human reads.
 */
export const STATUSES = [
  { key: 'open', label: 'Open' },
  { key: 'fixed', label: 'Fixed' },
  { key: 'wontfix', label: "Won't fix" },
];

/**
 * Returns the status descriptor for a key, falling back to Open.
 * @param {string} [key] The stored status.
 */
export function statusOf(key) {
  return STATUSES.find((s) => s.key === key) ?? STATUSES[0];
}
