/**
 * The controls reference: every key and gesture in one place. The popup, the
 * report and Help and settings all draw from this list, so they never disagree.
 * Each row has keys to press, a gesture in words, or both (Hold plus Alt).
 */

export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

export const CONTROLS = [
  {
    id: 'page',
    title: 'On the page',
    rows: [
      { gesture: 'Drag', what: 'Draw a box around a problem. A note opens next to it.' },
      { keys: ['V'], what: 'Comment on everything you can see.' },
      { gesture: 'Right-click', what: 'More ways to comment, or stop.' },
      { gesture: 'Hold', keys: ['Alt'], what: 'Use the page normally, for example to open a menu.' },
      { keys: ['S'], what: 'Pick element on or off. Click an element to comment on it.' },
      { keys: ['M'], what: 'Numbered markers on or off.' },
      { keys: ['Enter'], what: 'Save the note.' },
      { keys: ['Esc'], what: 'Close the note. Press again to stop.' },
    ],
  },
  {
    id: 'report',
    title: 'In the report',
    rows: [
      { keys: ['?'], what: 'Show these controls.' },
      { gesture: 'Click a screenshot', what: 'Add a numbered marker.' },
      { gesture: 'Right-click a marker', what: 'Remove it.' },
      { gesture: 'Annotate', what: 'Draw boxes and arrows on the screenshot.' },
    ],
  },
  {
    id: 'editor',
    title: 'In the image editor',
    rows: [
      { keys: ['V', 'M', 'B', 'A'], what: 'Select, Marker, Box, Arrow.' },
      { gesture: 'Double-click', what: 'Write the note for an item.' },
      { keys: ['Delete'], what: 'Remove the selected item.' },
      { keys: ['Ctrl', 'Z'], what: 'Undo. Hold Shift as well to redo.' },
      { gesture: 'Arrow keys', what: 'Nudge by 1 pixel, or 10 with Shift held.' },
      { keys: ['+', '-', '0', '1'], what: 'Zoom in, zoom out, fit, actual size.' },
    ],
  },
];

/**
 * The shortcut that starts and stops annotating, or an empty string when none is set.
 * A content script has no chrome.commands, so the on-page overlay asks the background instead.
 */
export async function annotateShortcut() {
  try {
    const commands = chrome.commands ? await chrome.commands.getAll() : await chrome.runtime.sendMessage({ type: 'commands' });
    return commands?.find((c) => c.name === 'toggle-annotate')?.shortcut ?? '';
  } catch {
    return '';
  }
}

/** Opens Chrome's shortcut page, the only place an extension shortcut can be changed. A content script asks the background. */
export function openShortcutSettings() {
  if (chrome.tabs) chrome.tabs.create({ url: SHORTCUTS_URL });
  else chrome.runtime.sendMessage({ type: 'openShortcuts' });
}

const kbd = (keys) => keys.map((key) => `<kbd>${key}</kbd>`).join(' ');

/** A shortcut such as Alt+Shift+M as keycaps, for pages not yet in React. */
export const keycaps = (shortcut) => kbd(shortcut.split('+'));

/**
 * The reference as HTML for pages not yet in React: the start shortcut first, then each group.
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
      <dl class="keys">${group.rows
        .map((row) => `<dt>${[row.gesture ?? '', row.keys ? kbd(row.keys) : ''].filter(Boolean).join(' ')}</dt><dd>${row.what}</dd>`)
        .join('')}</dl>
    </section>`,
    )
    .join('');
  return `${start}${groups}`;
}

/**
 * Fills an element with the reference and wires its Set shortcut button, for pages not yet in React.
 * @param {HTMLElement} el Where to draw it.
 * @param {{ only?: string[] }} [options] Limit to some groups by id.
 */
export async function renderControls(el, options) {
  el.innerHTML = controlsHtml(await annotateShortcut(), options);
  el.querySelector('[data-set-shortcut]')?.addEventListener('click', openShortcutSettings);
}
