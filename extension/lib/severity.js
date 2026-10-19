/**
 * Severity levels, ordered most to least urgent. `key` is what gets stored on
 * an issue record; `label` is what a human reads; `token` names the CSS custom
 * property that carries the colour.
 */
export const SEVERITIES = [
  { key: 'blocker', label: 'Blocker', token: '--sev-blocker' },
  { key: 'major', label: 'Major', token: '--sev-major' },
  { key: 'minor', label: 'Minor', token: '--sev-minor' },
  { key: 'nit', label: 'Nit', token: '--sev-nit' },
];

export const SEVERITY_ORDER = SEVERITIES.map((s) => s.key);

/** Returns the severity descriptor for a key, falling back to Major. */
export function severityOf(key) {
  return SEVERITIES.find((s) => s.key === key) ?? SEVERITIES[1];
}
