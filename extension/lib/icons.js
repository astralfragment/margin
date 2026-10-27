/**
 * Icons from the Margin Figma file, inlined so they take the text colour and follow the theme.
 * Stroke icons draw with currentColor, filled marks fill with it.
 */

const stroke = (box, width, paths) =>
  `<svg viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths
    .map((d) => `<path d="${d}"/>`)
    .join('')}</svg>`;

const fill = (box, paths) =>
  `<svg viewBox="0 0 ${box} ${box}" fill="currentColor" aria-hidden="true">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;

const ICONS = {
  mark: `<svg viewBox="0 0 21 18" fill="none" aria-hidden="true"><rect x="0.875" y="5" width="15" height="12" rx="2" stroke="currentColor" stroke-width="1.75" stroke-dasharray="3 2"/><circle cx="16.375" cy="4.5" r="4.5" fill="currentColor"/></svg>`,
  jira: `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8 1L15 8L8 15L1 8L8 1ZM8 5.2L5.2 8L8 10.8L10.8 8L8 5.2Z"/></svg>`,
  figma: fill(16, [
    'M5.5 1H8V5.67H5.5C4.88 5.67 4.29 5.42 3.85 4.99C3.41 4.55 3.17 3.95 3.17 3.34C3.17 2.72 3.41 2.12 3.85 1.68C4.29 1.25 4.88 1 5.5 1ZM8 1H10.5C11.12 1 11.71 1.25 12.15 1.68C12.59 2.12 12.84 2.72 12.84 3.34C12.84 3.95 12.59 4.55 12.15 4.99C11.71 5.42 11.12 5.67 10.5 5.67H8V1ZM5.5 5.67H8V10.33H5.5C4.88 10.33 4.29 10.08 3.85 9.65C3.42 9.21 3.17 8.62 3.17 8C3.17 7.38 3.42 6.79 3.85 6.35C4.29 5.92 4.88 5.67 5.5 5.67ZM10.33 5.67C10.95 5.67 11.54 5.92 11.98 6.35C12.41 6.79 12.66 7.38 12.66 8C12.66 8.62 12.41 9.21 11.98 9.65C11.54 10.08 10.95 10.33 10.33 10.33C9.71 10.33 9.12 10.08 8.68 9.65C8.25 9.21 8 8.62 8 8C8 7.38 8.25 6.79 8.68 6.35C9.12 5.92 9.71 5.67 10.33 5.67ZM5.5 10.33H8V12.67C8 13.12 7.86 13.57 7.61 13.94C7.36 14.32 7.01 14.62 6.59 14.79C6.17 14.97 5.71 15.03 5.27 14.95C4.82 14.87 4.41 14.66 4.08 14.35C3.75 14.05 3.51 13.65 3.41 13.21C3.3 12.77 3.32 12.3 3.47 11.88C3.62 11.45 3.9 11.08 4.26 10.8C4.62 10.53 5.05 10.36 5.5 10.33Z',
  ]),
  close: stroke(16, 1.6, ['M4 4L12 12M12 4L4 12']),
  alert: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z" stroke="currentColor" stroke-width="1.6"/><path d="M8 5v3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11" r="0.9" fill="currentColor"/></svg>`,
  more: fill(16, [
    'M8.67 8a.67.67 0 1 1-1.34 0 .67.67 0 0 1 1.34 0ZM13.33 8a.67.67 0 1 1-1.33 0 .67.67 0 0 1 1.33 0ZM4 8a.67.67 0 1 1-1.33 0A.67.67 0 0 1 4 8Z',
  ]).replace('fill="currentColor"', 'fill="currentColor" stroke="currentColor" stroke-width="1.33"'),
  chevronDown: stroke(16, 1.33, ['M4 6L8 10L12 6']),
  chevronRight: stroke(14, 1.17, ['M5.25 10.5L8.75 7L5.25 3.5']),
  refresh: stroke(14, 1.17, [
    'M1.75 7A5.25 5.25 0 0 1 7 1.75a5.7 5.7 0 0 1 3.93 1.6l1.32 1.32',
    'M12.25 1.75V4.67H9.33',
    'M12.25 7A5.25 5.25 0 0 1 7 12.25a5.7 5.7 0 0 1-3.93-1.6L1.75 9.33',
    'M4.67 9.33H1.75v2.92',
  ]),
  trash: stroke(14, 1.17, [
    'M1.75 3.5H12.25',
    'M11.08 3.5v8.17c0 .58-.58 1.16-1.16 1.16H4.08c-.58 0-1.16-.58-1.16-1.16V3.5',
    'M4.67 3.5V2.33c0-.58.58-1.16 1.16-1.16h2.34c.58 0 1.16.58 1.16 1.16V3.5',
  ]),
  help: stroke(16, 1.33, [
    'M14.67 8A6.67 6.67 0 1 1 1.33 8a6.67 6.67 0 0 1 13.34 0Z',
    'M6.06 6a1.95 1.95 0 0 1 3.89.67c0 1.33-2 2-2 2',
    'M8 11.33h.01',
  ]),
  pencil: stroke(16, 1.33, [
    'M14.11 4.54a1.88 1.88 0 0 0-2.66-2.66L2.56 10.78a1.33 1.33 0 0 0-.33.55l-.88 2.9a.33.33 0 0 0 .41.42l2.9-.88c.21-.07.4-.18.55-.33l8.9-8.9Z',
  ]),
  plus: stroke(16, 1.33, ['M3.33 8h9.34', 'M8 3.33v9.34']),
  file: stroke(16, 1.33, [
    'M10 1.33H4a1.33 1.33 0 0 0-1.33 1.34v10.66A1.33 1.33 0 0 0 4 14.67h8a1.33 1.33 0 0 0 1.33-1.34V4.67L10 1.33Z',
    'M9.33 1.33V4a1.33 1.33 0 0 0 1.34 1.33h2.66',
    'M10.67 8.67H5.33',
    'M10.67 11.33H5.33',
  ]),
  settings: stroke(16, 1.33, [
    'M8.15 1.33h-.3a1.33 1.33 0 0 0-1.33 1.34v.12a1.33 1.33 0 0 1-.67 1.15l-.28.17a1.33 1.33 0 0 1-1.34 0l-.1-.06a1.33 1.33 0 0 0-1.82.49l-.15.25a1.33 1.33 0 0 0 .49 1.82l.1.07a1.33 1.33 0 0 1 .67 1.15v.34a1.33 1.33 0 0 1-.67 1.16l-.1.06a1.33 1.33 0 0 0-.49 1.82l.15.25a1.33 1.33 0 0 0 1.82.49l.1-.05a1.33 1.33 0 0 1 1.34 0l.28.16a1.33 1.33 0 0 1 .67 1.16v.12a1.33 1.33 0 0 0 1.33 1.34h.3a1.33 1.33 0 0 0 1.33-1.34v-.12a1.33 1.33 0 0 1 .67-1.16l.28-.16a1.33 1.33 0 0 1 1.34 0l.1.05a1.33 1.33 0 0 0 1.82-.49l.15-.26a1.33 1.33 0 0 0-.49-1.82l-.1-.05a1.33 1.33 0 0 1-.67-1.16v-.34a1.33 1.33 0 0 1 .67-1.16l.1-.06a1.33 1.33 0 0 0 .49-1.82l-.15-.25a1.33 1.33 0 0 0-1.82-.49l-.1.05a1.33 1.33 0 0 1-1.34 0l-.28-.16a1.33 1.33 0 0 1-.67-1.16v-.12a1.33 1.33 0 0 0-1.33-1.34Z',
    'M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  ]),
  statusOpen: stroke(12, 1, ['M10 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z']),
  statusFixed: stroke(12, 1, ['M10.5 6a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z', 'M4.25 6l1.25 1.25L7.75 4.75']),
  statusWontfix: stroke(12, 1, ['M10.5 6a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z', 'M2.85 2.85l6.3 6.3']),
  sevBlocker: `<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>`,
  sevMajor: `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0L9.33 6.75H.67Z" fill="currentColor"/></svg>`,
  sevMinor: `<svg viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor"/></svg>`,
  sevNit: `<svg viewBox="0 0 10 10" fill="none" aria-hidden="true"><circle cx="5" cy="5" r="3.25" stroke="currentColor" stroke-width="1.5"/></svg>`,
};

/**
 * The markup for one icon, wrapped in a span with the icon class so CSS can size it.
 * @param {keyof typeof ICONS} name The icon.
 */
export function icon(name) {
  return `<span class="ico ico-${name}">${ICONS[name] ?? ''}</span>`;
}
