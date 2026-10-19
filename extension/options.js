import { readIssues } from './lib/store.js';
import { resetTours } from './lib/tour.js';

const SELECTORS_KEY = 'selectorMode';

document.querySelector('[data-version]').textContent = `Version ${chrome.runtime.getManifest().version}`;
const selectorsEl = document.querySelector('[data-selectors]');

selectorsEl.checked = (await chrome.storage.local.get(SELECTORS_KEY))[SELECTORS_KEY] === true;
selectorsEl.addEventListener('change', () => chrome.storage.local.set({ [SELECTORS_KEY]: selectorsEl.checked }));

const command = (await chrome.commands.getAll()).find((c) => c.name === 'toggle-annotate');
document.querySelector('[data-shortcut]').textContent = command?.shortcut
  ? `${command.shortcut} starts and stops annotating.`
  : 'No shortcut is set. Pick one in Chrome.';
document.querySelector('[data-shortcuts]').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

/**
 * Formats a byte count for people.
 * @param {number} bytes The size in bytes.
 */
function size(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const [issues, bytes] = await Promise.all([readIssues(), chrome.storage.local.getBytesInUse(null)]);
document.querySelector('[data-storage]').textContent =
  `${issues.length} ${issues.length === 1 ? 'comment' : 'comments'} with their screenshots, ${size(bytes)}. Delete a review from the popup to free space.`;

document.querySelector('[data-report]').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openReport' }));
document.querySelector('[data-welcome]').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }));
document.querySelector('[data-replay]').addEventListener('click', async () => {
  await resetTours();
  document.querySelector('[data-replay-state]').textContent = 'The tips show next time you open the popup or the report.';
});
