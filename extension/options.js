import { readIssues } from './lib/store.js';
import { resetTours } from './lib/tour.js';
import { PROVIDERS, readConnections, requestAccess, connect, disconnect } from './lib/oauth.js';
import { THEME_KEY, THEMES, applyTheme } from './lib/theme.js';
import { openReportTab } from './lib/report-tab.js';

applyTheme();
const themeEl = document.querySelector('[data-theme-choice]');
themeEl.innerHTML = THEMES.map((t) => `<option value="${t.key}">${t.label}</option>`).join('');
themeEl.value = (await chrome.storage.local.get(THEME_KEY))[THEME_KEY] ?? 'system';
themeEl.addEventListener('change', () => chrome.storage.local.set({ [THEME_KEY]: themeEl.value }));

const SELECTORS_KEY = 'selectorMode';
const SIGN_IN_WAIT = 2 * 60_000;
const SETTLE_MS = 800;

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
  `${issues.length} ${issues.length === 1 ? 'comment' : 'comments'} with their screenshots, ${size(bytes)}. Delete a review you no longer need to free space.`;

const CONNECTION_HINTS = {
  jira: 'Not connected. Connect to create Jira issues with the screenshots attached.',
  figma: 'Not connected. Connect to post comments on the Figma frames your links point at.',
};

const rows = new Map();
const returnNote = document.querySelector('[data-return]');

/** Shows each service's signed-in account, or what connecting it does, unless the row is busy asking or waiting. */
async function paintConnections() {
  const all = await readConnections();
  for (const [provider, row] of rows) {
    if (row.busy) continue;
    const current = all[provider];
    const who = [current?.account?.name, current?.account?.email].filter(Boolean).join(', ') || 'your account';
    const sites = current?.sites?.map((site) => site.name).join(', ');
    row.el.dataset.connected = String(Boolean(current));
    row.state.textContent = current ? `Connected as ${who}.${sites ? ` Jira sites ${sites}.` : ''}` : CONNECTION_HINTS[provider];
    row.button.textContent = current ? 'Disconnect' : 'Connect';
    row.button.classList.toggle('action', !current);
    row.button.classList.remove('danger');
    row.cancel.hidden = true;
  }
}

/**
 * Turns the button off for a moment after the row changes under the pointer, so a double click does not undo it.
 * @param {HTMLButtonElement} button The button.
 */
function settle(button) {
  button.disabled = true;
  setTimeout(() => (button.disabled = false), SETTLE_MS);
}

/** Says how to get back to a review sheet that was left to connect a service. */
async function showReturn() {
  const { reviewDraft } = await chrome.storage.local.get('reviewDraft');
  returnNote.hidden = !reviewDraft;
  returnNote.textContent = 'Your review sheet is kept. Once connected, click Margin in the toolbar to finish it.';
}

for (const el of document.querySelectorAll('[data-connection]')) {
  const provider = el.dataset.connection;
  const name = PROVIDERS[provider].name;
  const row = { el, busy: null, attempt: 0, button: el.querySelector('[data-connection-toggle]'), cancel: el.querySelector('[data-connection-cancel]'), state: el.querySelector('[data-connection-state]') };
  rows.set(provider, row);

  /** Leaves the question or the wait and shows the row as it is stored. */
  const reset = async () => {
    row.busy = null;
    row.attempt += 1;
    await paintConnections();
  };

  row.cancel.addEventListener('click', async () => {
    await reset();
    row.button.focus();
  });

  row.button.addEventListener('click', async () => {
    if (row.busy === 'waiting') {
      await reset();
      row.state.textContent = `${name} sign-in stopped. Connect to try again.`;
      return;
    }
    if (el.dataset.connected === 'true') {
      if (row.busy !== 'asking') {
        row.busy = 'asking';
        row.state.textContent = `Disconnect ${name}? Connecting again needs a full sign-in.`;
        row.button.classList.add('danger');
        row.cancel.hidden = false;
        return;
      }
      row.busy = null;
      await disconnect(provider);
      await paintConnections();
      settle(row.button);
      return;
    }
    const access = requestAccess(provider);
    const attempt = ++row.attempt;
    row.busy = 'waiting';
    row.button.textContent = 'Cancel';
    row.button.classList.remove('action');
    row.state.textContent = `Waiting for ${name} sign-in`;
    const timer = setTimeout(async () => {
      if (attempt !== row.attempt) return;
      await reset();
      row.state.textContent = `${name} sign-in did not finish. Connect to try again.`;
    }, SIGN_IN_WAIT);
    try {
      if (!(await access)) throw new Error(`Margin needs permission to reach ${name}. Choose Allow to connect.`);
      await connect(provider);
      if (attempt !== row.attempt) return;
      row.busy = null;
      await paintConnections();
      settle(row.button);
      if (!returnNote.hidden) returnNote.textContent = `${name} is connected. Click Margin in the toolbar to finish your review.`;
    } catch (err) {
      if (attempt !== row.attempt) return;
      row.busy = null;
      await paintConnections();
      row.state.textContent = err.message;
    } finally {
      clearTimeout(timer);
    }
  });
}

await paintConnections();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.connections) paintConnections();
});

const target = document.getElementById(location.hash.slice(1));
if (target?.matches('[data-connection]')) {
  await showReturn();
  target.scrollIntoView({ block: 'center' });
  target.querySelector('[data-connection-toggle]').focus();
}

document.querySelector('[data-report]').addEventListener('click', () => openReportTab('group=all'));
document.querySelector('[data-welcome]').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }));
document.querySelector('[data-replay]').addEventListener('click', async () => {
  await resetTours();
  document.querySelector('[data-replay-state]').textContent = 'The tips show next time you open the popup or the report.';
});
