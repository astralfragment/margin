import { readGroups, readIssues, removeIssue, readRaw, writeRaw, writeIssues, addGroup, patchGroup, setActiveGroup } from './lib/store.js';
import { severityOf } from './lib/severity.js';
import { statusOf } from './lib/status.js';
import { routeOf } from './lib/report-template.js';
import { cleanJiraLink, cleanFigmaLink } from './lib/review-file.js';
import { refreshLinks, detailsAt, timeAgo, statusTone } from './lib/review-links.js';
import { mountReviewSheet } from './lib/review-sheet.js';
import { icon } from './lib/icons.js';
import { tourOnce } from './lib/tour.js';
import { applyTheme } from './lib/theme.js';

applyTheme();

const RESTRICTED = /^(chrome|edge|about|devtools|chrome-extension|view-source):|^https:\/\/chrome\.google\.com\/webstore/;
const CHANGED_SHARE = 0.003;
const UNDO_MS = 5000;
const SEV_ICONS = { blocker: 'sevBlocker', major: 'sevMajor', minor: 'sevMinor', nit: 'sevNit' };
const STATUS_ICONS = { open: 'statusOpen', fixed: 'statusFixed', wontfix: 'statusWontfix' };

const $ = (selector) => document.querySelector(selector);
const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });
const pad = (n) => String(n).padStart(2, '0');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Escapes text for HTML.
 * @param {unknown} value The text.
 */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * The host of an address, or an empty string.
 * @param {string} url The address.
 */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

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

/**
 * The short name of a page, such as Home or Pricing.
 * @param {{ url: string, title?: string }} page The page.
 */
const pageName = (page) => routeOf(page).split(' > ').at(-1);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const currentUrl = tab?.url ?? '';
const host = hostOf(currentUrl);
const restricted = !currentUrl || RESTRICTED.test(currentUrl);

const state = { groups: [], issues: [], group: null, picked: false, refreshing: false, refreshFailed: false };

/** Reads the reviews and comments without creating a review, so a site with none can say so. */
async function load() {
  state.groups = await readGroups();
  state.issues = await readIssues();
  const { activeGroupId } = await chrome.storage.local.get('activeGroupId');
  state.group = state.groups.find((g) => g.id === activeGroupId) ?? state.groups.at(-1) ?? null;
}

/**
 * True when a review was started on this site, has comments on it, or is empty and not tied to a site yet.
 * @param {object} group The review.
 */
function belongsHere(group) {
  const issues = state.issues.filter((issue) => issue.groupId === group.id);
  if (!group.site && !issues.length) return true;
  return group.site === host || issues.some((issue) => hostOf(issue.page?.url) === host);
}

/** Whether the popup shows the active review, rather than the offer to start one. */
const reviewOpen = () => Boolean(state.group) && (restricted || state.picked || belongsHere(state.group));

/* Header ----------------------------------------------------------------- */

$('[data-mark]').innerHTML = icon('mark');
$('[data-more-icon]').innerHTML = icon('more');
$('[data-options]').innerHTML = icon('help');
$('[data-alert-icon]').outerHTML = icon('alert');
for (const [selector, name] of [
  ['[data-settings]', 'settings'],
  ['[data-all]', 'file'],
  ['[data-new-group]', 'plus'],
  ['[data-rename-group]', 'pencil'],
  ['[data-edit-links]', 'jira'],
  ['[data-clear]', 'trash'],
]) {
  $(selector).insertAdjacentHTML('afterbegin', icon(name));
}

/** Fills the title, the review picker and the menu items that need a review. */
function renderHeader() {
  const open = reviewOpen();
  $('[data-review-name]').textContent = open ? state.group.name : host || 'This tab';
  $('[data-picker-chevron]').innerHTML = state.groups.length ? icon('chevronDown') : '';
  $('[data-group]').classList.toggle('static', !state.groups.length);
  $('[data-picker-list]').innerHTML = state.groups
    .slice()
    .reverse()
    .map((group) => {
      const count = state.issues.filter((issue) => issue.groupId === group.id).length;
      const current = open && group.id === state.group.id;
      return `<button class="menu-item" type="button" role="menuitemradio" aria-checked="${current}" data-pick-group="${esc(group.id)}"><span class="grow">${esc(group.name)}</span><span class="muted">${count}</span></button>`;
    })
    .join('');
  for (const selector of ['[data-rename-group]', '[data-edit-links]', '[data-clear]', '[data-clear-sep]']) $(selector).hidden = !open;
}

$('[data-group] > summary').addEventListener('click', (event) => {
  if (!state.groups.length) event.preventDefault();
});

$('[data-picker-list]').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-pick-group]');
  if (!button) return;
  $('[data-group]').open = false;
  await send('groupSelect', { id: button.dataset.pickGroup });
  state.picked = true;
  await load();
  render();
});

/* Links ------------------------------------------------------------------ */

/**
 * One quiet row for a linked ticket or file. Without details it offers to connect instead.
 * @param {'jira' | 'figma'} kind Which link.
 * @param {object} link The stored link.
 */
function linkRow(kind, link) {
  const title = kind === 'jira' ? link.key : link.name || 'Figma file';
  const known = Boolean(link.fetchedAt);
  const detail = kind === 'jira' ? link.summary : '';
  return `<div class="quiet-link">${icon(kind)}<button class="link-title" type="button" data-open-url="${esc(link.url)}"${link.url ? '' : ' disabled'}>${esc(title)}</button>${
    known
      ? `<span class="grow">${esc(detail)}</span>${kind === 'jira' && link.status ? `<span class="tone-${statusTone(link.statusCategory)}">${esc(link.status)}</span>` : ''}`
      : '<span class="grow"><button class="text-link" type="button" data-connect>Connect to bring in details</button></span>'
  }</div>`;
}

/** Draws the linked ticket and file, the comment count, and how fresh the details are. */
function renderLinks() {
  const el = $('[data-links]');
  el.hidden = !reviewOpen();
  if (el.hidden) return;
  const group = state.group;
  const total = state.issues.filter((issue) => issue.groupId === group.id).length;
  el.innerHTML = `${group.jira?.key ? linkRow('jira', group.jira) : ''}${group.figma?.fileKey ? linkRow('figma', group.figma) : ''}<div class="pop-meta"><span class="grow">${plural(total, 'comment')}</span>${freshness(group)}</div>`;
}

/**
 * How fresh the linked details are, with a way to refresh them.
 * @param {object} group The review.
 */
function freshness(group) {
  if (state.refreshing) return '<span>Refreshing details</span>';
  if (state.refreshFailed) return '<span class="danger-text">Could not refresh</span><button class="text-link" type="button" data-refresh>Try again</button>';
  const at = detailsAt(group);
  if (!at) return '';
  return `<span>Details from ${timeAgo(at)}</span><button class="icon-btn xs" type="button" data-refresh title="Refresh details" aria-label="Refresh details">${icon('refresh')}</button>`;
}

$('[data-links]').addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.openUrl) chrome.tabs.create({ url: target.dataset.openUrl });
  else if ('connect' in target.dataset) chrome.runtime.openOptionsPage();
  else if ('refresh' in target.dataset) refresh(true);
});

/**
 * Brings the linked ticket and file details up to date, when they are older than five minutes or when asked.
 * @param {boolean} [force] Look up even when the details are fresh.
 */
async function refresh(force = false) {
  const group = state.group;
  if (!group || (!group.jira && !group.figma)) return;
  state.refreshing = force;
  if (force) renderLinks();
  const { patch, failed } = await refreshLinks(group, force);
  if (Object.keys(patch).length) Object.assign(group, await patchGroup(group.id, patch));
  state.refreshing = false;
  state.refreshFailed = failed;
  renderLinks();
}

/* Start ------------------------------------------------------------------ */

/** Sets the main button: start a review, start annotating, or nothing on a page Chrome keeps to itself. */
function renderStart() {
  const button = $('[data-toggle]');
  const open = reviewOpen();
  $('[data-toggle-label]').textContent = open ? 'Start annotating' : 'Start review';
  button.disabled = restricted;
  button.classList.toggle('primary', !restricted);
  $('[data-restricted]').hidden = !restricted;
  $('[data-no-review]').hidden = open || restricted;
}

$('[data-toggle]').addEventListener('click', async () => {
  if (!reviewOpen()) {
    openSheet('new');
    return;
  }
  const res = await send('toggle');
  if (res?.error) {
    $('[data-toggle-label]').textContent = res.error;
    return;
  }
  window.close();
});

/** Shows the keyboard shortcut that toggles annotation, as set in Chrome. */
async function showShortcut() {
  const command = (await chrome.commands.getAll()).find((c) => c.name === 'toggle-annotate');
  $('[data-shortcut]').textContent = command?.shortcut ? command.shortcut.split('+').join(' ') : '';
}

/* This page -------------------------------------------------------------- */

/**
 * Where a comment stands against its recheck.
 * @param {object} issue The comment.
 */
function recheckState(issue) {
  if (!issue.checkedAt) return 'not checked again';
  if (typeof issue.change !== 'number') return 'rechecked';
  return issue.change < CHANGED_SHARE ? 'same as capture' : 'changed since capture';
}

/**
 * One comment row: severity shape, title, number and recheck state, delete, and status.
 * @param {object} issue The comment.
 * @param {number} n Its number in the review.
 */
function issueRow(issue, n) {
  const sev = severityOf(issue.severity);
  const status = statusOf(issue.status);
  const li = document.createElement('li');
  li.className = 'pop-row';
  li.dataset.sev = sev.key;
  li.innerHTML = `
    <span class="sev" title="${sev.label}">${icon(SEV_ICONS[sev.key])}</span>
    <span class="txt"><b></b><span></span></span>
    <button class="icon-btn sm del" type="button" title="Delete comment" aria-label="Delete comment ${pad(n)}">${icon('trash')}</button>
    <span class="status-text" data-status="${status.key}">${icon(STATUS_ICONS[status.key])}${esc(status.label)}</span>`;
  li.querySelector('.txt b').textContent = issue.title || 'Untitled comment';
  li.querySelector('.txt span').textContent = [pad(n), issue.jira?.key && `Jira ${issue.jira.key}`, recheckState(issue)].filter(Boolean).join(', ');
  li.querySelector('.del').addEventListener('click', () => deleteWithUndo(issue, n, li));
  return li;
}

/**
 * Deletes a comment at once and turns its row into an Undo offer for five seconds. Undo puts the comment
 * and its clean screenshot back where they were, so closing the popup never loses or resurrects anything.
 * @param {object} issue The comment.
 * @param {number} n Its number in the review.
 * @param {HTMLElement} li Its row.
 */
async function deleteWithUndo(issue, n, li) {
  const index = (await readIssues()).findIndex((i) => i.id === issue.id);
  const raw = await readRaw(issue.id);
  await removeIssue(issue.id);
  li.className = 'pop-row undo';
  li.innerHTML = `<span class="grow">Comment ${pad(n)} deleted</span><button class="btn ghost sm" type="button">Undo</button>`;
  const timer = setTimeout(async () => {
    await load();
    render();
  }, UNDO_MS);
  li.querySelector('button').addEventListener('click', async () => {
    clearTimeout(timer);
    const issues = await readIssues();
    issues.splice(index < 0 ? issues.length : Math.min(index, issues.length), 0, issue);
    await writeIssues(issues);
    if (raw) await writeRaw(issue.id, raw);
    await load();
    render();
  });
}

/**
 * The line that folds the review's other comments: those on this page at another width, and those on other pages.
 * @param {object[]} elsewhere Comments on other pages.
 * @param {Map<number, number>} otherWidths Counts on this page by capture width.
 */
function foldLines(elsewhere, otherWidths) {
  const lines = [...otherWidths].map(([width, count]) => `${count} more at ${width} px`);
  if (elsewhere.length) {
    const pages = [...new Set(elsewhere.map((issue) => pageName(issue.page ?? { url: '' })))];
    lines.push(`${elsewhere.length} more on ${pages.length === 1 ? pages[0] : `${pages.length} other pages`}`);
  }
  return lines.map((line) => `<button class="pop-fold" type="button" data-fold><span>${esc(line)}</span>${icon('chevronRight')}</button>`).join('');
}

/** Lists the comments on the open page, with the recheck button and the folded rest. */
function renderPage() {
  const section = $('[data-page]');
  const note = $('[data-note]');
  const group = state.group;
  const inReview = group ? state.issues.filter((issue) => issue.groupId === group.id) : [];
  note.hidden = !restricted;
  if (restricted) {
    const pages = [...new Set(inReview.map((issue) => pageName(issue.page ?? { url: '' })))];
    note.textContent = inReview.length
      ? `Nothing to show on this tab. Your review has ${plural(inReview.length, 'comment')} ${pages.length === 1 ? `on ${pages[0]}` : `across ${pages.length} pages`}.`
      : 'Nothing to show on this tab.';
  }
  section.hidden = restricted || !reviewOpen();
  if (section.hidden) return;

  const onPage = inReview.filter((issue) => samePage(currentUrl, issue.page?.url));
  const widths = [...new Set(onPage.map((issue) => issue.viewport?.width).filter(Boolean))];
  const shownWidth = widths.sort((a, b) => Math.abs(a - (tab?.width ?? a)) - Math.abs(b - (tab?.width ?? b)))[0];
  const shown = onPage.filter((issue) => widths.length < 2 || !issue.viewport?.width || issue.viewport.width === shownWidth);
  const otherWidths = new Map();
  for (const issue of onPage.filter((i) => !shown.includes(i))) otherWidths.set(issue.viewport.width, (otherWidths.get(issue.viewport.width) ?? 0) + 1);

  $('[data-page-name]').textContent = `On ${pageName({ url: currentUrl, title: tab?.title })}`;
  $('[data-page-count]').textContent = plural(shown.length, 'comment');
  offerVerify(onPage.length);

  const list = $('[data-list]');
  list.innerHTML = '';
  if (!shown.length) {
    list.innerHTML = `<li class="pop-row-empty">No comments on this page yet. Start annotating, then drag over anything that looks wrong.
      <button class="btn ghost sm" type="button" data-welcome>See how a review works</button></li>`;
    list.querySelector('[data-welcome]').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
      window.close();
    });
  }
  for (const issue of shown) list.append(issueRow(issue, inReview.indexOf(issue) + 1));
  $('[data-folds]').innerHTML = foldLines(inReview.filter((issue) => !samePage(currentUrl, issue.page?.url)), otherWidths);
}

$('[data-folds]').addEventListener('click', (event) => {
  if (event.target.closest('[data-fold]')) openReport();
});

const verifyBtn = $('[data-verify]');
const verifyCancel = $('[data-verify-cancel]');

/**
 * Offers to recheck every comment on this page in one pass, when the page has any.
 * @param {number} count Comments on this page.
 */
function offerVerify(count) {
  verifyBtn.hidden = !count;
  if (!verifyBtn.disabled) verifyBtn.innerHTML = `${icon('refresh')}Recheck ${count}`;
}

/**
 * Mirrors a verify run's progress on the button.
 * @param {{state: string, done: number, total: number, checked: string[]}} run The run record from storage.
 */
function showRun(run) {
  const running = run.state === 'running';
  verifyBtn.disabled = running;
  verifyCancel.hidden = !running;
  if (running) verifyBtn.textContent = `Checking ${Math.min(run.done + 1, run.total)} of ${run.total}`;
  else if (run.state === 'cancelled') verifyBtn.textContent = `Stopped, ${run.checked.length} checked`;
  else verifyBtn.textContent = `Done, ${run.checked.length} checked`;
}

verifyBtn.addEventListener('click', async () => {
  verifyBtn.disabled = true;
  const res = await send('verifyStart', { groupId: state.group.id });
  if (res?.error) {
    verifyBtn.disabled = false;
    verifyBtn.textContent = res.error === 'noTab' ? 'No comments on this page' : 'Failed';
    verifyBtn.title = res.error === 'noTab' ? '' : res.error;
  }
});

verifyCancel.addEventListener('click', () => send('verifyCancel'));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.verifyRun?.newValue) showRun(changes.verifyRun.newValue);
});

/* Footer and menu -------------------------------------------------------- */

/** Opens the report on the active review and closes the popup. */
async function openReport() {
  await send('openReport');
  window.close();
}

/** Opens the report on every review. */
function openAllReviews() {
  chrome.tabs.create({ url: chrome.runtime.getURL('report.html?group=all') });
  window.close();
}

/** Sets the footer button: the report for an open review, every review otherwise. */
function renderFooter() {
  const report = $('[data-report]');
  const open = reviewOpen();
  report.textContent = open ? 'Open report' : 'All reviews';
  report.classList.toggle('primary', restricted && open);
}

$('[data-report]').addEventListener('click', () => (reviewOpen() ? openReport() : openAllReviews()));
$('[data-options]').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('[data-settings]').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('[data-all]').addEventListener('click', openAllReviews);
$('[data-new-group]').addEventListener('click', () => openSheet('new'));
$('[data-rename-group]').addEventListener('click', () => openSheet('edit', 'name'));
$('[data-edit-links]').addEventListener('click', () => openSheet('edit', 'jira'));
$('[data-clear]').addEventListener('click', async () => {
  $('[data-more]').open = false;
  if (!confirm('Delete this review and all its comments? This cannot be undone.')) return;
  await send('groupDelete', { id: state.group.id });
  state.picked = false;
  await load();
  render();
});

for (const menu of document.querySelectorAll('details.menu')) {
  menu.addEventListener('toggle', () => {
    if (menu.open) document.querySelectorAll('details.menu').forEach((other) => other !== menu && (other.open = false));
  });
}
document.addEventListener('click', (event) => {
  document.querySelectorAll('details.menu[open]').forEach((menu) => !menu.contains(event.target) && (menu.open = false));
});

/* Sheet ------------------------------------------------------------------ */

const home = $('[data-home]');
const sheetHost = $('[data-sheet]');

/**
 * Swaps the popup body for the review sheet, to start a review or edit the open one.
 * @param {'new' | 'edit'} mode Start or edit.
 * @param {'name' | 'jira' | 'figma'} [focus] The field to focus.
 */
function openSheet(mode, focus = 'name') {
  document.querySelectorAll('details.menu').forEach((menu) => (menu.open = false));
  home.hidden = true;
  sheetHost.hidden = false;
  const close = () => {
    sheetHost.hidden = true;
    sheetHost.innerHTML = '';
    home.hidden = false;
  };
  mountReviewSheet(sheetHost, {
    mode,
    focus,
    group: mode === 'edit' ? state.group : null,
    name: (tab?.title || host || '').trim().slice(0, 120),
    onClose: close,
    onSubmit: async ({ name, jira, figma }) => {
      const links = { jira: cleanJiraLink(jira), figma: cleanFigmaLink(figma) };
      if (mode === 'edit') {
        await patchGroup(state.group.id, { name, ...links });
      } else {
        const fromNoReview = !reviewOpen();
        const group = state.group;
        const unused = group && !group.site && !group.jira && !group.figma && !state.issues.some((issue) => issue.groupId === group.id);
        const id = unused ? group.id : (await addGroup(name)).id;
        await patchGroup(id, { name, ...(restricted ? {} : { site: host }), ...links });
        await setActiveGroup(id);
        if (fromNoReview && !restricted && !(await send('toggle'))?.error) {
          window.close();
          return;
        }
      }
      await load();
      close();
      render();
    },
  });
}

/* Boot ------------------------------------------------------------------- */

/** Draws the whole popup from the loaded state. */
function render() {
  renderHeader();
  renderLinks();
  renderStart();
  renderPage();
  renderFooter();
  home.hidden = !sheetHost.hidden;
}

await load();
await showShortcut();
render();
refresh();

if (reviewOpen() && !restricted) {
  tourOnce('popup', [
    { target: '[data-toggle]', title: 'Start here', body: 'Opens annotation mode on this tab. The keyboard shortcut does the same.' },
    { target: '[data-group]', title: 'Pick the review', body: 'New comments land in this review. Start a new one for each round of feedback.' },
    { target: '[data-list]', title: 'Your comments', body: 'The comments on this page. Recheck captures them again for a before and after.' },
    { target: '[data-report]', title: 'The report', body: 'Number details on screenshots, tidy the wording and export the review.' },
    { target: '[data-options]', title: 'Help and settings', body: 'Shortcuts, connections, the theme and the welcome tour live here.' },
  ]);
}
