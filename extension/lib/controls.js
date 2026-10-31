/**
 * The controls reference: every key and gesture in one place. The popup, the
 * report and Help and settings all draw from this list, so they never disagree.
 */

export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

const k = (...keys) => keys.map((key) => `<kbd>${key}</kbd>`).join(' ');

export const CONTROLS = [
  {
    id: 'page',
    title: 'On the page',
    rows: [
      ['Drag', 'Draw a box around a problem. A note opens next to it.'],
      [k('V'), 'Comment on everything you can see.'],
      ['Right-click', 'More ways to comment, or stop.'],
      [`Hold ${k('Alt')}`, 'Use the page normally, for example to open a menu.'],
      [k('S'), 'Pick element on or off. Click an element to comment on it.'],
      [k('M'), 'Numbered markers on or off.'],
      [k('Enter'), 'Save the note.'],
      [k('Esc'), 'Close the note. Press again to stop.'],
    ],
  },
  {
    id: 'report',
    title: 'In the report',
    rows: [
      ['Click a screenshot', 'Add a numbered marker.'],
      ['Right-click a marker', 'Remove it.'],
      ['Open editor', 'Draw boxes and arrows on the screenshot.'],
    ],
  },
  {
    id: 'editor',
    title: 'In the image editor',
    rows: [
      [k('V', 'M', 'B', 'A'), 'Select, Marker, Box, Arrow.'],
      ['Double-click', 'Write the note for an item.'],
      [k('Delete'), 'Remove the selected item.'],
      [`${k('Ctrl', 'Z')}`, `Undo. Add ${k('Shift')} to redo.`],
      ['Arrow keys', `Nudge by 1 pixel, or 10 with ${k('Shift')}.`],
      [k('+', '-', '0', '1'), 'Zoom in, zoom out, fit, actual size.'],
    ],
  },
];

/** The shortcut that starts and stops annotating, or an empty string when none is set. */
export async function annotateShortcut() {
  try {
    const command = (await chrome.commands.getAll()).find((c) => c.name === 'toggle-annotate');
    return command?.shortcut ?? '';
  } catch {
    return '';
  }
}

/** A shortcut such as Alt+Shift+M as keycaps. */
export const keycaps = (shortcut) => k(...shortcut.split('+'));

/**
 * The reference as HTML: the start shortcut first, then each group of controls.
 * @param {string} shortcut The current start shortcut.
 * @param {{ only?: string[] }} [options] Limit to some groups by id.
 */
export function controlsHtml(shortcut, { only } = {}) {
  const start = shortcut
    ? `<div class="ctl-start"><span><b>Start and stop</b><span class="hint">Works on any page</span></span><span class="ctl-keys">${keycaps(shortcut)}</span></div>`
    : `<div class="ctl-start"><span><b>Start and stop</b><span class="hint">No shortcut yet. Pick one in Chrome.</span></span><button class="btn sm" type="button" data-set-shortcut>Set shortcut</button></div>`;
  const groups = CONTROLS.filter((group) => !only || only.includes(group.id))
    .map(
      (group) => `<section class="ctl-group" aria-label="${group.title}">
      <h3>${group.title}</h3>
      <dl class="keys">${group.rows.map(([key, what]) => `<dt>${key}</dt><dd>${what}</dd>`).join('')}</dl>
    </section>`,
    )
    .join('');
  return `${start}${groups}`;
}

/** Opens Chrome's shortcut page, the only place an extension shortcut can be changed. */
export function openShortcutSettings() {
  chrome.tabs.create({ url: SHORTCUTS_URL });
}

/**
 * Fills an element with the reference and wires its Set shortcut button.
 * @param {HTMLElement} el Where to draw it.
 * @param {{ only?: string[] }} [options] Limit to some groups by id.
 */
export async function renderControls(el, options) {
  el.innerHTML = controlsHtml(await annotateShortcut(), options);
  el.querySelector('[data-set-shortcut]')?.addEventListener('click', openShortcutSettings);
}
