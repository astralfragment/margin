import { readIssues } from './lib/store.js';
import { resetTours } from './lib/tour.js';
import { PROVIDERS, readConnections, requestAccess, connect, disconnect } from './lib/oauth.js';

const SELECTORS_KEY = 'selectorMode';

document.querySelector('[data-version]').textContent = `Version ${chrome.runtime.getManifest().version}`;
const selectorsEl = document.querySelector('[data-selectors]');

const MARKERS_KEY = 'markerMode';
const markersEl = document.querySelector('[data-markers]');
const stored = await chrome.storage.local.get([SELECTORS_KEY, MARKERS_KEY]);

selectorsEl.checked = stored[SELECTORS_KEY] === true;
selectorsEl.addEventListener('change', () => chrome.storage.local.set({ [SELECTORS_KEY]: selectorsEl.checked }));
markersEl.checked = stored[MARKERS_KEY] !== false;
markersEl.addEventListener('change', () => chrome.storage.local.set({ [MARKERS_KEY]: markersEl.checked }));

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

const CONNECTION_HINTS = {
  jira: 'Not connected. Connect to create Jira issues with the screenshots attached.',
  figma: 'Not connected. Connect to post comments on the Figma frames your links point at.',
};

/** Shows each service's signed-in account, or what connecting it does. */
async function paintConnections() {
  const all = await readConnections();
  for (const row of document.querySelectorAll('[data-connection]')) {
    const current = all[row.dataset.connection];
    const who = [current?.account?.name, current?.account?.email].filter(Boolean).join(', ') || 'your account';
    const sites = current?.sites?.map((site) => site.name).join(', ');
    row.dataset.connected = String(Boolean(current));
    row.querySelector('[data-connection-state]').textContent = current
      ? `Connected as ${who}.${sites ? ` Jira sites ${sites}.` : ''}`
      : CONNECTION_HINTS[row.dataset.connection];
    const button = row.querySelector('[data-connection-toggle]');
    button.textContent = current ? 'Disconnect' : 'Connect';
    button.classList.toggle('action', !current);
  }
}

for (const row of document.querySelectorAll('[data-connection]')) {
  const provider = row.dataset.connection;
  const button = row.querySelector('[data-connection-toggle]');
  const state = row.querySelector('[data-connection-state]');
  button.addEventListener('click', async () => {
    if (row.dataset.connected === 'true') {
      await disconnect(provider);
      return paintConnections();
    }
    const access = requestAccess(provider);
    button.disabled = true;
    state.textContent = `Waiting for ${PROVIDERS[provider].name} sign-in`;
    try {
      if (!(await access)) throw new Error(`Margin needs permission to reach ${PROVIDERS[provider].name}. Choose Allow to connect.`);
      await connect(provider);
      await paintConnections();
    } catch (err) {
      state.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

paintConnections();

document.querySelector('[data-report]').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openReport' }));
document.querySelector('[data-welcome]').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }));
document.querySelector('[data-replay]').addEventListener('click', async () => {
  await resetTours();
  document.querySelector('[data-replay-state]').textContent = 'The tips show next time you open the popup or the report.';
});
