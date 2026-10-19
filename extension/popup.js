import { issuesInGroup, removeIssue } from './lib/store.js';
import { severityOf } from './lib/severity.js';
import { tourOnce } from './lib/tour.js';

const listEl = document.querySelector('[data-list]');
const countEl = document.querySelector('[data-count]');
const toggleBtn = document.querySelector('[data-toggle]');
const groupEl = document.querySelector('[data-group]');

const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url ?? '';
  }
};

let activeId = null;
const currentUrl = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.url ?? '';

/** True when two URLs are the same page, ignoring the query and hash. */
function samePage(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return false;
  }
}

/** Fills the group picker and returns the active group. */
async function renderGroups() {
  const { groups, activeId: active } = await send('groups');
  activeId = active;
  groupEl.innerHTML = '';
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group.id;
    option.dataset.name = group.name;
    option.textContent = `${group.name} (${group.count})${group.jira?.key ? ` ${group.jira.key}` : ''}`;
    groupEl.append(option);
  }
  groupEl.value = activeId;
  return groups.find((s) => s.id === activeId);
}

function issueRow(issue) {
  const sev = severityOf(issue.severity);
  const li = document.createElement('li');
  li.innerHTML = `
    <span class="chip" data-sev="${sev.key}"><i></i>${sev.label}</span>
    <span class="who"><b></b><span></span></span>
    <span class="row">
      <button class="jira" type="button"></button>
      <button class="jira" type="button" data-recheck hidden>Recheck</button>
      <button class="icon-btn danger" type="button" title="Delete comment" aria-label="Delete comment">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" /></svg>
      </button>
    </span>
  `;
  li.querySelector('.who b').textContent = issue.title || 'Untitled comment';
  li.querySelector('.who span').textContent = hostOf(issue.page?.url);

  const jiraBtn = li.querySelector('.jira');
  jiraBtn.hidden = !issue.jira?.url;
  jiraBtn.textContent = issue.jira?.key ?? '';
  jiraBtn.title = issue.jira?.key ? `Open ${issue.jira.key}` : '';
  jiraBtn.addEventListener('click', () => chrome.tabs.create({ url: issue.jira.url }));

  const recheckBtn = li.querySelector('[data-recheck]');
  recheckBtn.hidden = !samePage(currentUrl, issue.page?.url);
  recheckBtn.dataset.linked = String(Boolean(issue.checkedAt));
  recheckBtn.title = issue.checkedAt
    ? `Rechecked ${new Date(issue.checkedAt).toLocaleString()}. Capture this region again.`
    : 'Capture this region again to compare before and after';
  recheckBtn.addEventListener('click', async () => {
    recheckBtn.disabled = true;
    recheckBtn.textContent = 'Capturing';
    const res = await send('recheck', { id: issue.id });
    recheckBtn.disabled = false;
    recheckBtn.textContent = res?.error ? 'Failed' : 'Rechecked';
    if (res?.error) recheckBtn.title = res.error;
  });

  li.querySelector('.icon-btn').addEventListener('click', async () => {
    await removeIssue(issue.id);
    render();
  });
  return li;
}

async function render() {
  await renderGroups();
  const issues = (await issuesInGroup(activeId)).slice().reverse();
  countEl.textContent = `${issues.length} ${issues.length === 1 ? 'comment' : 'comments'}`;
  listEl.innerHTML = '';

  if (!issues.length) {
    const empty = document.createElement('li');
    empty.innerHTML = `<div class="empty" style="grid-column: 1 / -1">No comments yet. Start annotating, then drag over anything that looks wrong.
      <p class="hint"><button class="btn ghost sm" type="button" data-welcome>See how a review works</button></p></div>`;
    empty.querySelector('[data-welcome]').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
      window.close();
    });
    listEl.append(empty);
    return;
  }
  issues.forEach((issue) => listEl.append(issueRow(issue)));
}

groupEl.addEventListener('change', async () => {
  await send('groupSelect', { id: groupEl.value });
  render();
});

document.querySelector('[data-new-group]').addEventListener('click', async () => {
  const name = prompt('Name this review', `Review ${new Date().toLocaleDateString()}`);
  if (name === null) return;
  await send('groupCreate', { name });
  render();
});

document.querySelector('[data-rename-group]').addEventListener('click', async () => {
  const current = groupEl.selectedOptions[0]?.dataset.name ?? '';
  const name = prompt('Rename this review', current);
  if (name === null || !name.trim()) return;
  await send('groupRename', { id: activeId, name: name.trim() });
  render();
});

toggleBtn.addEventListener('click', async () => {
  const res = await send('toggle');
  if (res?.error) {
    toggleBtn.textContent = res.error;
    return;
  }
  window.close();
});

document.querySelector('[data-report]').addEventListener('click', async () => {
  await send('openReport');
  window.close();
});

document.querySelector('[data-options]').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

/** Shows the keyboard shortcut that toggles annotation, as set in Chrome. */
async function showShortcut() {
  const command = (await chrome.commands.getAll()).find((c) => c.name === 'toggle-annotate');
  document.querySelector('[data-shortcut]').textContent = command?.shortcut
    ? `${command.shortcut} toggles annotation`
    : 'No shortcut set';
}

showShortcut();

document.querySelector('[data-clear]').addEventListener('click', async () => {
  if (!confirm('Delete this review and all its comments? This cannot be undone.')) return;
  await send('groupDelete', { id: activeId });
  render();
});

await render();

tourOnce('popup', [
  { target: '[data-toggle]', title: 'Start here', body: 'Opens annotation mode on this tab. The keyboard shortcut does the same.' },
  { target: '[data-group]', title: 'Pick the review', body: 'New comments land in this review. Start a new one for each round of feedback.' },
  { target: '[data-list]', title: 'Your comments', body: 'Recheck appears beside a comment when you are back on its page, for a before and after.' },
  { target: '[data-report]', title: 'The report', body: 'Number details on screenshots, tidy the wording and export the review.' },
  { target: '[data-options]', title: 'Help and settings', body: 'Shortcuts, the selector default and the welcome tour live here.' },
]);
