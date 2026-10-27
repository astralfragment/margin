import { readGroups, readIssues, removeIssue, readRaw, writeRaw, readImages, writeImages, writeIssues, addGroup, patchGroup, setActiveGroup } from './lib/store.js';
import { severityOf } from './lib/severity.js';
import { statusOf } from './lib/status.js';
import { routeOf } from './lib/report-template.js';
import { cleanJiraLink, cleanFigmaLink } from './lib/review-file.js';
import { refreshLinks, detailsAt, timeAgo, statusTone } from './lib/review-links.js';
import { mountReviewSheet, pendingDraft } from './lib/review-sheet.js';
import { connection } from './lib/oauth.js';
import { icon } from './lib/icons.js';
import { tourOnce } from './lib/tour.js';
import { applyTheme } from './lib/theme.js';

applyTheme();

const RESTRICTED = /^(chrome|edge|about|devtools|chrome-extension|view-source|data):|^https:\/\/chrome\.google\.com\/webstore|^https:\/\/chromewebstore\.google\.com/;
const CHANGED_SHARE = 0.003;
const UNDO_MS = 5000;
const NAME_MAX = 120;
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

/**
 * True when two URLs are the same page, ignoring the query and hash.
 * @param {string} a One address.
 * @param {string} b The other.
 */
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
 * Cuts a page title to the name limit at a word, so a long title never ends mid-word.
 * @param {string} text The title.
 */
function trimName(text) {
  const clean = text.trim();
  if (clean.length <= NAME_MAX) return clean;
  const cut = clean.slice(0, NAME_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > NAME_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:|-]+$/, '');
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
const draftScope = `popup:${tab?.id ?? 0}:${host}`;

const state = {
  groups: [],
  issues: [],
  group: null,
  connected: { jira: false, figma: false },
  annotating: false,
  shortcut: '',
  width: null,
  alert: null,
  refreshing: false,
  refreshFailed: false,
};

/** Reads the reviews, comments and connections without creating a review, so a site with none can say so. */
async function load() {
  state.groups = await readGroups();
  state.issues = await readIssues();
  const { activeGroupId } = await chrome.storage.local.get('activeGroupId');
  state.group = state.groups.find((g) => g.id === activeGroupId) ?? state.groups.at(-1) ?? null;
  state.connected = { jira: Boolean((await connection('jira'))?.sites?.length), figma: Boolean(await connection('figma')) };
}

/**
 * True when a review was started on this site, was picked here, has comments on it, or is empty and not tied to a site yet.
 * @param {object} group The review.
 */
function belongsHere(group) {
  const issues = state.issues.filter((issue) => issue.groupId === group.id);
  if (!group.site && !issues.length) return true;
  return group.site === host || Boolean(group.pickedOn?.includes(host)) || issues.some((issue) => hostOf(issue.page?.url) === host);
}

/** Whether the popup shows the active review, rather than the offer to start one. */
const reviewOpen = () => Boolean(state.group) && (restricted || belongsHere(state.group));

/** The comments in the active review. */
const inReview = () => (state.group ? state.issues.filter((issue) => issue.groupId === state.group.id) : []);

/**
 * Asks the page whether annotation is on, through the content script's ping. A content script that does not
 * report its state yet is read directly, and a page without Margin on it is off.
 */
async function annotatingNow() {
  if (!tab?.id || restricted) return false;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
    if (typeof res?.active === 'boolean') return res.active;
  } catch {
    return false;
  }
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__uiAnnotator?.isActive?.() ?? false });
    return result === true;
  } catch {
    return false;
  }
}

/**
 * Opens Help and settings, at a service's Connect button when one is named.
 * @param {'jira' | 'figma'} [kind] The service to connect.
 */
function openSettings(kind) {
  if (kind) chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#connect-${kind}`) });
  else chrome.runtime.openOptionsPage();
  window.close();
}

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
  const summary = $('[data-group] > summary');
  $('[data-review-name]').textContent = open ? state.group.name : host || 'This tab';
  summary.title = open ? state.group.name : '';
  $('[data-picker-chevron]').innerHTML = state.groups.length ? icon('chevronDown') : '';
  $('[data-group]').classList.toggle('static', !state.groups.length);
  if (state.groups.length) {
    summary.removeAttribute('tabindex');
    summary.removeAttribute('aria-disabled');
  } else {
    summary.tabIndex = -1;
    summary.setAttribute('aria-disabled', 'true');
  }
  $('[data-picker-list]').innerHTML = state.groups
    .slice()
    .reverse()
    .map((group) => {
      const count = state.issues.filter((issue) => issue.groupId === group.id).length;
      const current = open && group.id === state.group.id;
      return `<button class="menu-item" type="button" role="menuitemradio" aria-checked="${current}" title="${esc(group.name)}" data-pick-group="${esc(group.id)}"><span class="grow">${esc(group.name)}</span><span class="muted">${count}</span></button>`;
    })
    .join('');
  for (const selector of ['[data-rename-group]', '[data-edit-links]', '[data-clear]', '[data-clear-sep]']) $(selector).hidden = !open;
  $('[data-all]').hidden = !open;
}

$('[data-group] > summary').addEventListener('click', (event) => {
  if (!state.groups.length) event.preventDefault();
});

$('[data-picker-list]').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-pick-group]');
  if (!button) return;
  $('[data-group]').open = false;
  const id = button.dataset.pickGroup;
  await send('groupSelect', { id });
  const picked = state.groups.find((group) => group.id === id);
  if (host && picked && !belongsHere(picked)) await patchGroup(id, { pickedOn: [...(picked.pickedOn ?? []), host] });
  await load();
  state.width = null;
  render();
  $('[data-group] > summary').focus();
});

/* Links ------------------------------------------------------------------ */

/**
 * One quiet row for a linked ticket or file. Without details it offers to connect instead. Details kept from
 * before the service was disconnected show dimmed.
 * @param {'jira' | 'figma'} kind Which link.
 * @param {object} link The stored link.
 */
function linkRow(kind, link) {
  const title = kind === 'jira' ? link.key : link.name || 'Figma file';
  const known = Boolean(link.fetchedAt);
  const stale = known && !state.connected[kind];
  const detail = kind === 'jira' ? link.summary : '';
  const service = kind === 'jira' ? 'Jira' : 'Figma';
  const opens = link.url ? `title="${esc(link.url)}"` : `disabled title="Connect ${service} or paste the full link to open it"`;
  return `<div class="quiet-link${stale ? ' stale' : ''}">${icon(kind)}<button class="link-title" type="button" data-open-url="${esc(link.url)}" ${opens}>${esc(title)}</button>${
    known
      ? `<span class="grow" title="${esc(detail)}">${esc(detail)}</span>${kind === 'jira' && link.status ? `<span class="tone-${statusTone(link.statusCategory)}" title="${esc(link.status)}">${esc(link.status)}</span>` : ''}`
      : `<span class="grow"><button class="text-link" type="button" data-connect="${kind}">Connect to bring in details</button></span>`
  }</div>`;
}

/**
 * Draws the linked ticket and file, the review's comment count when it says more than the page count,
 * and how fresh the details are.
 */
function renderLinks() {
  const el = $('[data-links]');
  el.hidden = !reviewOpen();
  if (el.hidden) return;
  const group = state.group;
  const total = inReview().length;
  const fresh = freshness(group);
  const showTotal = !restricted && total !== pageView().shown.length;
  const meta = showTotal || fresh ? `<div class="pop-meta"><span class="grow">${showTotal ? plural(total, 'comment') : ''}</span>${fresh}</div>` : '';
  el.innerHTML = `${group.jira?.key ? linkRow('jira', group.jira) : ''}${group.figma?.fileKey ? linkRow('figma', group.figma) : ''}${meta}`;
  el.hidden = !el.innerHTML;
}

/**
 * How fresh the linked details are, with a way to refresh them, or to connect when the service was disconnected.
 * @param {object} group The review.
 */
function freshness(group) {
  if (state.refreshing) return '<span>Refreshing details</span>';
  if (state.refreshFailed) return '<span class="danger-text">Could not refresh</span><button class="text-link" type="button" data-refresh>Try again</button>';
  const at = detailsAt(group);
  if (!at) return '';
  const off = ['jira', 'figma'].find((kind) => group[kind]?.fetchedAt && !state.connected[kind]);
  if (off) return `<span title="Details from ${timeAgo(at)}">${timeAgo(at).replace(' ago', ' old')}</span><button class="text-link" type="button" data-connect="${off}">Connect to refresh</button>`;
  return `<span>Details from ${timeAgo(at)}</span><button class="icon-btn xs" type="button" data-refresh title="Refresh details" aria-label="Refresh details">${icon('refresh')}</button>`;
}

$('[data-links]').addEventListener('click', (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.openUrl) chrome.tabs.create({ url: target.dataset.openUrl });
  else if (target.dataset.connect) openSettings(target.dataset.connect);
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

/**
 * The alert for a page Margin may not run on, with where the review's comments are.
 */
function restrictedAlert() {
  const comments = reviewOpen() ? inReview() : [];
  const pages = [...new Set(comments.map((issue) => pageName(issue.page ?? { url: '' })))];
  const where = comments.length ? ` Your review has ${plural(comments.length, 'comment')} ${pages.length === 1 ? `on ${pages[0]}` : `across ${pages.length} pages`}.` : '';
  return {
    title: 'Margin cannot run on this tab',
    text: `Browser pages, the Chrome Web Store and blank tabs are closed to extensions. Open the page you want to review in a normal tab, then click Margin again.${where}`,
  };
}

/**
 * The alert for a failed start, in plain words rather than Chrome's error text.
 * @param {string} error The error from the toggle.
 */
function startAlert(error) {
  if (/cannot be scripted|cannot access|not allow|chrome:\/\/|gallery/i.test(error)) {
    return { title: 'Margin cannot run on this page', text: 'This page does not allow extensions. Open the page you want to review in a normal tab, then click Margin again.' };
  }
  return { title: 'Margin could not start on this page', text: 'Reload the page, then click Margin again.' };
}

/** Sets the main button and the alert: start a review, start or stop annotating, or why Margin cannot run here. */
function renderStart() {
  const open = reviewOpen();
  $('[data-toggle-label]').textContent = !open ? 'Start review' : state.annotating ? 'Stop annotating' : 'Start annotating';
  $('[data-start]').hidden = restricted;
  const alert = state.alert ?? (restricted ? restrictedAlert() : null);
  $('[data-restricted]').hidden = !alert;
  if (alert) {
    $('[data-alert-title]').textContent = alert.title;
    $('[data-alert-text]').textContent = alert.text;
  }
  $('[data-no-review]').hidden = open || restricted;
  const elsewhere = $('[data-active-elsewhere]');
  elsewhere.hidden = open || restricted || !state.group;
  if (!elsewhere.hidden) elsewhere.textContent = `The shortcut and the right-click menu still add to ${state.group.name}. Pick it above to see it here.`;
}

$('[data-toggle]').addEventListener('click', async () => {
  if (!reviewOpen()) {
    openSheet('new');
    return;
  }
  const res = await send('toggle');
  if (res?.error) {
    state.alert = startAlert(res.error);
    renderStart();
    fitHeight();
    return;
  }
  window.close();
});

/** Reads the keyboard shortcut that toggles annotation, as set in Chrome, and shows it on the button. */
async function showShortcut() {
  const command = (await chrome.commands.getAll()).find((c) => c.name === 'toggle-annotate');
  state.shortcut = command?.shortcut ?? '';
  $('[data-shortcut]').textContent = state.shortcut.split('+').join(' ');
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
 * Opens the report on the active review, at one comment when one is named, and closes the popup.
 * @param {string} [commentId] The comment to scroll to.
 */
function openReport(commentId) {
  const query = `group=${encodeURIComponent(state.group.id)}${commentId ? `&comment=${encodeURIComponent(commentId)}` : ''}`;
  chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?${query}`) });
  window.close();
}

/**
 * One comment row: severity shape, title and number that open it in the report, delete, and status.
 * @param {object} issue The comment.
 * @param {number} n Its number in the review.
 */
function issueRow(issue, n) {
  const sev = severityOf(issue.severity);
  const status = statusOf(issue.status);
  const title = issue.title || 'Untitled comment';
  const li = document.createElement('li');
  li.className = 'pop-row';
  li.dataset.sev = sev.key;
  li.innerHTML = `
    <span class="sev" title="${sev.label}">${icon(SEV_ICONS[sev.key])}</span>
    <button class="txt" type="button" title="${esc(title)}"><b></b><span></span></button>
    <button class="icon-btn sm del" type="button" title="Delete comment" aria-label="Delete comment ${pad(n)}">${icon('trash')}</button>
    <span class="status-text" data-status="${status.key}">${icon(STATUS_ICONS[status.key])}${esc(status.label)}</span>`;
  li.querySelector('.txt b').textContent = title;
  li.querySelector('.txt span').textContent = [pad(n), issue.jira?.key && `Jira ${issue.jira.key}`, recheckState(issue)].filter(Boolean).join(', ');
  li.querySelector('.txt').addEventListener('click', () => openReport(issue.id));
  li.querySelector('.del').addEventListener('click', () => deleteWithUndo(issue, n, li));
  return li;
}

const pendingUndo = new Set();

/**
 * Deletes a comment at once and turns its row into an Undo offer for five seconds. Undo puts the comment
 * with its images and clean screenshot back where they were, so closing the popup never loses or resurrects anything.
 * The counts drop at once, and each Undo row keeps its own five seconds.
 * @param {object} issue The comment.
 * @param {number} n Its number in the review.
 * @param {HTMLElement} li Its row.
 */
async function deleteWithUndo(issue, n, li) {
  const index = (await readIssues()).findIndex((i) => i.id === issue.id);
  const [raw, images] = await Promise.all([readRaw(issue.id), readImages(issue.id)]);
  await removeIssue(issue.id);
  state.issues = state.issues.filter((i) => i.id !== issue.id);
  pendingUndo.add(li);
  li.className = 'pop-row undo';
  li.innerHTML = `<span class="grow">Comment ${pad(n)} deleted</span><button class="btn ghost sm" type="button">Undo</button>`;
  renderCounts();
  li.querySelector('button').focus();
  const timer = setTimeout(async () => {
    pendingUndo.delete(li);
    const list = $('[data-list]');
    const at = [...list.children].indexOf(li);
    const focused = li.contains(document.activeElement);
    if (pendingUndo.size) li.remove();
    else {
      await load();
      render();
    }
    if (focused) (list.children[at] ?? list.children[at - 1])?.querySelector('.txt, button')?.focus();
  }, UNDO_MS);
  li.querySelector('button').addEventListener('click', async () => {
    clearTimeout(timer);
    pendingUndo.delete(li);
    if (raw) await writeRaw(issue.id, raw);
    if (Object.keys(images).length) await writeImages(issue.id, images);
    const issues = await readIssues();
    issues.splice(index < 0 ? issues.length : Math.min(index, issues.length), 0, issue);
    await writeIssues(issues);
    await load();
    const row = issueRow(issue, n);
    li.replaceWith(row);
    renderCounts();
    row.querySelector('.del').focus();
  });
}

/**
 * The comments on the open page, the width the list shows, and the rest of the review folded away.
 * With comments at more than one width the list shows one width, the window's own unless another was picked.
 */
function pageView() {
  const all = inReview();
  const onPage = all.filter((issue) => samePage(currentUrl, issue.page?.url));
  const widths = [...new Set(onPage.map((issue) => issue.viewport?.width).filter(Boolean))];
  const windowWidth = widths.slice().sort((a, b) => Math.abs(a - (tab?.width ?? a)) - Math.abs(b - (tab?.width ?? b)))[0];
  const width = widths.includes(state.width) ? state.width : windowWidth;
  const multi = widths.length > 1;
  const shown = onPage.filter((issue) => !multi || !issue.viewport?.width || issue.viewport.width === width);
  const otherWidths = new Map();
  for (const issue of onPage.filter((i) => !shown.includes(i))) otherWidths.set(issue.viewport.width, (otherWidths.get(issue.viewport.width) ?? 0) + 1);
  const elsewhere = all.filter((issue) => !samePage(currentUrl, issue.page?.url));
  return { all, onPage, shown, width, windowWidth, multi, otherWidths, elsewhere };
}

/**
 * The lines that fold the review's other comments. A width line switches the list to that width,
 * and the other pages line opens the report at the first of them.
 * @param {ReturnType<typeof pageView>} view The page view.
 */
function foldLines(view) {
  const lines = [...view.otherWidths].map(([width, count]) => `<button class="pop-fold" type="button" data-fold data-fold-width="${width}"><span>${count} more at ${width} px</span>${icon('chevronRight')}</button>`);
  if (view.elsewhere.length) {
    const pages = [...new Set(view.elsewhere.map((issue) => pageName(issue.page ?? { url: '' })))];
    lines.push(
      `<button class="pop-fold" type="button" title="Opens the report at the first of them" data-fold data-fold-comment="${esc(view.elsewhere[0].id)}"><span>${view.elsewhere.length} more on ${esc(pages.length === 1 ? pages[0] : `${pages.length} other pages`)}</span>${icon('chevronRight')}</button>`,
    );
  }
  return lines.join('');
}

/** Updates the counts, the recheck offer and the fold lines without rebuilding the comment list. */
function renderCounts() {
  renderHeader();
  renderLinks();
  const view = pageView();
  $('[data-page-count]').textContent = view.width === view.windowWidth ? plural(view.shown.length, 'comment') : `${plural(view.shown.length, 'comment')} at ${view.width} px`;
  offerVerify(view);
  $('[data-folds]').innerHTML = foldLines(view);
}

/** Lists the comments on the open page, with the recheck button and the folded rest. */
function renderPage() {
  const section = $('[data-page]');
  section.hidden = restricted || !reviewOpen();
  if (section.hidden) return;
  const view = pageView();
  $('[data-page-name]').textContent = `On ${pageName({ url: currentUrl, title: tab?.title })}`;
  renderCounts();

  const list = $('[data-list]');
  list.innerHTML = '';
  pendingUndo.clear();
  if (!view.shown.length) {
    list.innerHTML = `<li class="pop-row-empty">No comments on this page yet.
      <button class="btn ghost sm" type="button" data-welcome>See how a review works</button></li>`;
    list.querySelector('[data-welcome]').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
      window.close();
    });
  }
  for (const issue of view.shown) list.append(issueRow(issue, view.all.indexOf(issue) + 1));
  list.classList.toggle('many', view.shown.length > 1);
}

$('[data-folds]').addEventListener('click', (event) => {
  const fold = event.target.closest('.pop-fold');
  if (!fold) return;
  if (fold.dataset.foldComment) {
    openReport(fold.dataset.foldComment);
    return;
  }
  state.width = Number(fold.dataset.foldWidth);
  renderPage();
  $('[data-list] .txt, [data-folds] .pop-fold')?.focus();
});

const verifyBtn = $('[data-verify]');
const verifyCancel = $('[data-verify-cancel]');

/**
 * Offers to recheck the comments the list shows, when they were made at the window's width. Comments at other
 * widths would be cut from the wrong layout, so they are left out and the button says so.
 * @param {ReturnType<typeof pageView>} view The page view.
 */
function offerVerify(view) {
  const atWindow = view.width === view.windowWidth;
  const count = view.shown.length;
  verifyBtn.hidden = !count || !atWindow;
  const hint = $('[data-width-hint]');
  hint.hidden = !count || atWindow;
  hint.textContent = `Recheck works on the ${view.windowWidth} px comments, the width of this window.`;
  const skipped = view.onPage.length - count;
  verifyBtn.title = `Captures ${count === 1 ? 'this comment' : `these ${count} comments`} again.${skipped ? ` ${plural(skipped, 'comment')} at other widths ${skipped === 1 ? 'is' : 'are'} left out.` : ''} The report opens with before and after when it is done.`;
  if (!verifyBtn.disabled) verifyBtn.innerHTML = `${icon('refresh')}Recheck ${count}`;
}

/**
 * Mirrors a verify run's progress on the button.
 * @param {{state: string, done: number, total: number, checked: string[]}} run The run record from storage.
 */
function showRun(run) {
  const running = run.state === 'running';
  verifyBtn.disabled = running;
  verifyBtn.classList.toggle('running', running);
  verifyCancel.hidden = !running;
  if (running) verifyBtn.innerHTML = `${icon('refresh')}${Math.min(run.done + 1, run.total)} of ${run.total}`;
  else if (run.state === 'cancelled') verifyBtn.textContent = `Stopped, ${run.checked.length} checked`;
  else verifyBtn.textContent = `Done, ${run.checked.length} checked`;
}

verifyBtn.addEventListener('click', async () => {
  const view = pageView();
  verifyBtn.disabled = true;
  const res = await send('verifyStart', { groupId: state.group.id, width: view.multi ? view.width : undefined });
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

/** Opens the report on every review. */
function openAllReviews() {
  chrome.tabs.create({ url: chrome.runtime.getURL('report.html?group=all') });
  window.close();
}

/** Sets the footer button: the report for an open review, every review otherwise, and nothing before the first review. */
function renderFooter() {
  const report = $('[data-report]');
  const open = reviewOpen();
  report.textContent = open ? 'Open report' : 'All reviews';
  report.hidden = !state.groups.length;
  report.classList.toggle('primary', restricted && open);
}

$('[data-report]').addEventListener('click', () => (reviewOpen() ? openReport() : openAllReviews()));
$('[data-options]').addEventListener('click', () => openSettings());
$('[data-settings]').addEventListener('click', () => openSettings());
$('[data-all]').addEventListener('click', openAllReviews);
$('[data-new-group]').addEventListener('click', () => openSheet('new'));
$('[data-rename-group]').addEventListener('click', () => openSheet('edit', 'name'));
$('[data-edit-links]').addEventListener('click', () => openSheet('edit', 'jira'));

const confirmEl = $('[data-confirm]');

/** Asks in place before deleting the review, naming it and its comment count. */
function askDelete() {
  $('[data-more]').open = false;
  $('[data-confirm-text]').textContent = `Delete ${state.group.name} and its ${plural(inReview().length, 'comment')}? This cannot be undone.`;
  confirmEl.hidden = false;
  fitHeight();
  $('[data-confirm-cancel]').focus();
}

/** Puts the delete question away and returns focus to the review menu. */
function cancelDelete() {
  confirmEl.hidden = true;
  fitHeight();
  $('[data-more] > summary').focus();
}

$('[data-clear]').addEventListener('click', askDelete);
$('[data-confirm-cancel]').addEventListener('click', cancelDelete);
$('[data-confirm-delete]').addEventListener('click', async () => {
  await send('groupDelete', { id: state.group.id });
  confirmEl.hidden = true;
  await load();
  render();
  ($('[data-start]').hidden ? $('[data-more] > summary') : $('[data-toggle]')).focus();
});

for (const menu of document.querySelectorAll('details.menu')) {
  menu.addEventListener('toggle', () => {
    if (menu.open) document.querySelectorAll('details.menu').forEach((other) => other !== menu && (other.open = false));
  });
}
document.addEventListener('click', (event) => {
  document.querySelectorAll('details.menu[open]').forEach((menu) => !menu.contains(event.target) && (menu.open = false));
});

/**
 * Moves through a menu with the arrow keys, Home and End, and closes it with Escape, back on its button.
 * @param {KeyboardEvent} event The key press.
 */
function menuKeys(event) {
  if (event.key === 'Escape') {
    const open = document.querySelector('details.menu[open]');
    if (open) {
      event.preventDefault();
      open.open = false;
      open.querySelector('summary').focus();
    } else if (!confirmEl.hidden) {
      event.preventDefault();
      cancelDelete();
    }
    return;
  }
  const menu = event.target.closest?.('details.menu');
  if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const items = [...menu.querySelectorAll('.menu-item')].filter((item) => !item.hidden && !item.disabled);
  if (!items.length) return;
  event.preventDefault();
  menu.open = true;
  const at = items.indexOf(document.activeElement);
  const last = items.length - 1;
  const next = { ArrowDown: at < 0 ? 0 : (at + 1) % items.length, ArrowUp: at <= 0 ? last : at - 1, Home: 0, End: last }[event.key];
  items[next].focus();
}

document.addEventListener('keydown', menuKeys);

/* Sheet ------------------------------------------------------------------ */

const home = $('[data-home]');
const sheetHost = $('[data-sheet]');

/**
 * Swaps the popup body for the review sheet, to start a review or edit the open one. What is typed is kept
 * as a draft for this tab, so the popup reopens into the sheet after it closes.
 * @param {'new' | 'edit'} mode Start or edit.
 * @param {'name' | 'jira' | 'figma'} [focus] The field to focus.
 */
function openSheet(mode, focus = 'name') {
  document.querySelectorAll('details.menu').forEach((menu) => (menu.open = false));
  confirmEl.hidden = true;
  home.hidden = true;
  sheetHost.hidden = false;
  const close = () => {
    sheetHost.hidden = true;
    sheetHost.innerHTML = '';
    home.hidden = false;
    $('[data-toggle]').focus();
  };
  mountReviewSheet(sheetHost, {
    mode,
    focus,
    draftScope,
    group: mode === 'edit' ? state.group : null,
    name: trimName(tab?.title || host || ''),
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
        if (fromNoReview && !restricted) {
          const res = await send('toggle');
          if (!res?.error) {
            window.close();
            return;
          }
          state.alert = startAlert(res.error);
        }
      }
      await load();
      state.width = null;
      close();
      render();
    },
  });
}

/* Boot ------------------------------------------------------------------- */

/**
 * Caps the popup at the height Chrome gives it, which is less than 600 px on a short screen,
 * so the comment list scrolls instead of the whole popup.
 */
function fitHeight() {
  home.style.maxHeight = '';
  if (innerHeight >= 200 && document.documentElement.scrollHeight > innerHeight) home.style.maxHeight = `${innerHeight}px`;
}

window.addEventListener('resize', fitHeight);

/** Draws the whole popup from the loaded state. */
function render() {
  renderHeader();
  renderLinks();
  renderStart();
  renderPage();
  renderFooter();
  home.hidden = !sheetHost.hidden;
  fitHeight();
}

await load();
await showShortcut();
state.annotating = await annotatingNow();
render();
refresh();

const draft = await pendingDraft(draftScope);
if (draft && (draft.mode === 'new' || (draft.groupId === state.group?.id && reviewOpen()))) {
  openSheet(draft.mode);
} else if (reviewOpen() && !restricted) {
  const hasComments = pageView().shown.length > 0;
  tourOnce('popup', [
    { target: '[data-toggle]', title: 'Start here', body: `Opens annotation mode on this tab.${state.shortcut ? ` ${state.shortcut.split('+').join(' ')} does the same.` : ''}` },
    { target: '[data-group]', title: 'Pick the review', body: 'New comments land in this review. Start a new one for each round of feedback.' },
    { target: '[data-list]', title: 'Your comments', body: hasComments ? 'The comments on this page. Recheck captures them again for a before and after.' : 'The comments you make on this page show here.' },
    { target: '[data-report]', title: 'The report', body: 'Number details on screenshots, tidy the wording and export the review.' },
    { target: '[data-options]', title: 'Help and settings', body: 'Shortcuts, connections, the theme and the welcome tour live here.' },
  ]);
}
