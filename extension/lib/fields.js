/**
 * The detail rows a comment can carry. Which of them appear in the report and
 * in the exports is a stored preference, so a review can stay terse.
 */
export const FACT_FIELDS = [
  { key: 'page', label: 'Page' },
  { key: 'figma', label: 'Figma links' },
  { key: 'jira', label: 'Jira key' },
  { key: 'selector', label: 'Selector' },
  { key: 'element', label: 'Element' },
  { key: 'text', label: 'Text' },
  { key: 'styles', label: 'Styles' },
  { key: 'position', label: 'Position' },
  { key: 'captured', label: 'Captured' },
];

export const DEFAULT_FIELDS = Object.fromEntries(FACT_FIELDS.map((f) => [f.key, f.key !== 'element']));

/** Missing keys fall back to the defaults, so new fields appear without a migration. */
export const withDefaults = (fields) => ({ ...DEFAULT_FIELDS, ...(fields ?? {}) });
