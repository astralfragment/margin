import { issuesInGroup, readRaw, addGroup, patchGroup, hydrate } from './lib/store.js';
import { refreshLinks, statusTone } from './lib/review-links.js';
import { mountReviewSheet } from './lib/review-sheet.js';
import { icon } from './lib/icons.js';
import {
  buildReport,
  renderBody,
  orderIssues,
  numbering,
  routeOf,
  recheckCaption,
  severityBadge,
  REPORT_CSS,
  PREVIEW_DARK_CSS,
} from './lib/report-template.js';
import { buildDocsHtml, buildDocsText } from './lib/docs-template.js';
import { buildMarkdown, commentHtml, commentMarkdown } from './lib/share-template.js';
import { buildReviewFile, cleanJiraLink, cleanFigmaLink } from './lib/review-file.js';
import { SEVERITIES, severityOf } from './lib/severity.js';
import { STATUSES, statusOf } from './lib/status.js';
import { FACT_FIELDS, withDefaults } from './lib/fields.js';
import { openEditor, editorOpen, closeEditor } from './editor.js';
import { startTour, tourOnce } from './lib/tour.js';
import { wireSend } from './send.js';
import { applyTheme } from './lib/theme.js';

const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });
const frame = document.querySelector('[data-preview]');
const pad = (n) => String(n).padStart(2, '0');
const SORT_KEY = 'margin.reportSort';
const COPY_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5"/></svg>';

function stamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url ?? '';
  }
};

function hostsOf(issues) {
  return [...new Set(issues.map((issue) => hostOf(issue.page?.url)))].filter(Boolean);
}

/**
 * Reads a per viewer preference, or null when storage is blocked.
 * @param {string} key The storage key.
 */
function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Saves a per viewer preference, ignoring blocked storage.
 * @param {string} key The storage key.
 * @param {string} value The value.
 */
function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

const PREVIEW_EDIT_CSS = `
.issue figure { width: fit-content; max-width: 100%; }
.issue figure img:not(.after):not(.at-width) { cursor: crosshair; }
.issue figure img:not(.after):not(.at-width):hover { outline: 2px solid var(--accent); outline-offset: 2px; }
.quick-bar {
  display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center;
  margin: var(--s2) 0 0 calc(24px + var(--s3)); font-size: 12px; color: var(--ink-2);
}
.quick-bar button, ol.marks .li-actions button, .issue header .card-copy {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px;
  font: inherit; font-size: 12px; font-weight: 600; color: var(--ink-2); cursor: pointer;
  background: transparent; border: 1px solid var(--line); border-radius: 8px;
}
.quick-bar button:hover, ol.marks .li-actions button:hover, .issue header .card-copy:hover { color: var(--ink); background: var(--surface); }
.issue header .card-copy { align-self: center; margin-left: var(--s2); }
.issue header .card-copy svg { width: 13px; height: 13px; }
ol.marks .li-actions { display: inline-flex; gap: 6px; margin-left: 8px; opacity: 0; transition: opacity 120ms ease-out; }
ol.marks li:hover .li-actions, ol.marks .li-actions:focus-within { opacity: 1; }
ol.marks .li-actions button { height: 20px; font-size: 11px; }
:focus-visible { outline: 2px solid #7549d2; outline-offset: 2px; }
:root[data-theme="dark"] :focus-visible { outline-color: #c1b0fe; }
@media (prefers-reduced-motion: reduce) { ol.marks .li-actions { transition: none; } }
@media (max-width: 560px) { .quick-bar { margin-left: 0; } }
@media print { .quick-bar, ol.marks .li-actions, .issue header .card-copy { display: none; } }
`;

const FONT_CSS = [500, 600, 800]
  .map(
    (weight) =>
      `@font-face { font-family: Manrope; font-weight: ${weight}; font-display: swap; src: url("${chrome.runtime.getURL(`fonts/manrope-latin-${weight}-normal.woff2`)}") format("woff2"); }`,
  )
  .join('\n');

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Shows a short confirmation on the button that was pressed. */
function flash(button, text) {
  const original = button.textContent;
  button.textContent = text;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1600);
}

function escapeText(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

/* Toast and confirm --------------------------------------------------------- */

const toastEl = document.querySelector('[data-toast]');
let toastTimer = 0;

/**
 * Shows a short message at the bottom of the page, with an optional action such as Undo.
 * @param {string} message What happened.
 * @param {{ action?: string, onAction?: () => void, ms?: number }} [options] The action button and how long the message stays.
 */
function toast(message, { action, onAction, ms = 6000 } = {}) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${escapeText(message)}</span>${action ? `<button class="btn sm" type="button" data-toast-action>${escapeText(action)}</button>` : ''}<button class="icon-btn sm" type="button" data-toast-close aria-label="Dismiss">${icon('close')}</button>`;
  toastEl.hidden = false;
  toastEl.querySelector('[data-toast-action]')?.addEventListener('click', () => {
    toastEl.hidden = true;
    onAction?.();
  });
  toastEl.querySelector('[data-toast-close]').addEventListener('click', () => {
    toastEl.hidden = true;
  });
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, ms);
}

const confirmDialog = document.querySelector('[data-confirm-dialog]');

/**
 * Asks a question in a small sheet and resolves with the value of the button pressed, or null on Escape.
 * The first button gets focus, so put the safe choice first.
 * @param {{ title: string, body: string, buttons: { label: string, value: string | null, kind?: string }[] }} ask The question.
 * @returns {Promise<string | null>}
 */
function confirmSheet({ title, body, buttons }) {
  confirmDialog.querySelector('[data-confirm-title]').textContent = title;
  confirmDialog.querySelector('[data-confirm-body]').textContent = body;
  const foot = confirmDialog.querySelector('[data-confirm-foot]');
  foot.innerHTML = buttons.map((b, i) => `<button class="btn ${b.kind ?? ''}" type="button" data-choice="${i}">${escapeText(b.label)}</button>`).join('');
  return new Promise((resolve) => {
    const done = (value) => {
      confirmDialog.removeEventListener('close', onClose);
      foot.onclick = null;
      if (confirmDialog.open) confirmDialog.close();
      resolve(value);
    };
    const onClose = () => done(null);
    foot.onclick = (event) => {
      const button = event.target.closest('[data-choice]');
      if (button) done(buttons[Number(button.dataset.choice)].value);
    };
    confirmDialog.addEventListener('close', onClose);
    confirmDialog.showModal();
    foot.querySelector('[data-choice="0"]').focus();
  });
}

/* Menus -------------------------------------------------------------------- */

/**
 * Closes every open dropdown menu except one.
 * @param {Element | null} [except] A menu to leave open.
 */
function closeMenus(except = null) {
  document.querySelectorAll('details.menu[open]').forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}

document.addEventListener('pointerdown', (event) => closeMenus(event.target.closest?.('details.menu')));
document.addEventListener('click', (event) => {
  if (event.target.closest?.('details.menu .menu-item')) closeMenus();
});
document.addEventListener('keydown', (event) => {
  const open = document.querySelector('details.menu[open]');
  if (event.key !== 'Escape' || !open) return;
  event.preventDefault();
  closeMenus();
  open.querySelector('summary').focus();
});
document.querySelectorAll('[data-proxy]').forEach((item) =>
  item.addEventListener('click', () => document.querySelector(item.dataset.proxy).click()),
);

/* Group context ---------------------------------------------------------- */

const groupEl = document.querySelector('[data-group]');
const opened = new URL(location.href);
const wanted = opened.searchParams.get('group');
const { groups, activeId } = await send('groups');
const groupId = wanted === 'all' ? null : groups.find((g) => g.id === wanted)?.id ?? activeId;
const group = groups.find((g) => g.id === groupId) ?? null;

groupEl.innerHTML = '';
for (const option of [
  ...groups,
  { id: 'all', name: 'All reviews', count: groups.reduce((n, g) => n + g.count, 0) },
]) {
  const el = document.createElement('option');
  el.value = option.id;
  el.textContent = `${option.name} (${option.count})`;
  groupEl.append(el);
}
groupEl.value = groupId ?? 'all';
groupEl.title = groupEl.selectedOptions[0]?.textContent ?? '';
groupEl.addEventListener('change', () => {
  location.search = `?group=${groupEl.value}`;
});

const reviewMenu = document.querySelector('.review-menu');
const sessionDialog = document.querySelector('[data-session-dialog]');
reviewMenu.querySelector('[data-review-menu-icon]').innerHTML = icon('more');
for (const [selector, name] of [['[data-new-group]', 'plus'], ['[data-edit-links]', 'pencil'], ['[data-delete-group]', 'trash']]) {
  reviewMenu.querySelector(selector).insertAdjacentHTML('afterbegin', icon(name));
}
for (const selector of ['[data-edit-links]', '[data-delete-group]', '[data-delete-sep]']) reviewMenu.querySelector(selector).hidden = !group;

/**
 * Opens the review sheet in a dialog, to start a review or change this one's name and links.
 * @param {'new' | 'edit'} mode Start or edit.
 * @param {'name' | 'jira' | 'figma'} [focus] The field to focus.
 */
function openReviewSheet(mode, focus = 'name') {
  closeMenus();
  sessionDialog.showModal();
  mountReviewSheet(sessionDialog, {
    mode,
    focus,
    group: mode === 'edit' ? group : null,
    name: `Review ${new Date().toLocaleDateString()}`,
    onClose: () => sessionDialog.close(),
    onSubmit: async ({ name, jira, figma }) => {
      const links = { jira: cleanJiraLink(jira), figma: cleanFigmaLink(figma) };
      if (mode === 'edit') {
        await patchGroup(group.id, { name, ...links });
        location.reload();
        return;
      }
      const created = await addGroup(name);
      await patchGroup(created.id, links);
      location.search = `?group=${created.id}&created=1`;
    },
  });
}

sessionDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  sessionDialog.close();
});
document.querySelector('[data-new-group]').addEventListener('click', () => openReviewSheet('new'));
document.querySelector('[data-edit-links]').addEventListener('click', () => openReviewSheet('edit', 'name'));
document.querySelector('[data-delete-group]').addEventListener('click', async () => {
  const count = groups.find((g) => g.id === group.id)?.count ?? 0;
  const choice = await confirmSheet({
    title: `Delete ${group.name}?`,
    body: `This deletes the review and its ${count} ${count === 1 ? 'comment' : 'comments'} with their screenshots. Save a review file first to keep a copy.`,
    buttons: [
      { label: 'Cancel', value: null },
      { label: 'Delete review', value: 'delete', kind: 'danger' },
    ],
  });
  if (choice !== 'delete') return;
  await send('groupDelete', { id: group.id });
  location.search = '';
});

const chipsEl = document.querySelector('[data-link-chips]');

/** Shows the review's linked ticket and file as chips that open them in a new tab. */
function renderChips() {
  const chip = (kind, label, extra, url) =>
    `<button class="link-chip" type="button" data-chip-url="${escapeText(url)}" title="${url ? `Open ${escapeText(label)}` : 'Connect in Help and settings to bring in details'}">${icon(kind)}<span class="label">${escapeText(label)}</span>${extra}</button>`;
  chipsEl.innerHTML = [
    group?.jira?.key &&
      chip('jira', group.jira.key, group.jira.status ? `<span class="tone-${statusTone(group.jira.statusCategory)}">${escapeText(group.jira.status)}</span>` : '', group.jira.url),
    group?.figma?.fileKey && chip('figma', group.figma.name || 'Figma file', '', group.figma.url),
  ]
    .filter(Boolean)
    .join('');
}

chipsEl.addEventListener('click', (event) => {
  const url = event.target.closest('[data-chip-url]')?.dataset.chipUrl;
  if (url) chrome.tabs.create({ url });
  else if (event.target.closest('[data-chip-url]')) chrome.runtime.openOptionsPage();
});

renderChips();
if (group) {
  refreshLinks(group).then(async ({ patch }) => {
    if (!Object.keys(patch).length) return;
    Object.assign(group, await patchGroup(group.id, patch));
    renderChips();
  });
}

if (opened.searchParams.get('created') && group) {
  opened.searchParams.delete('created');
  history.replaceState(null, '', opened);
  toast(`New comments from the page now go to ${group.name}.`, { ms: 9000 });
}

/* Report ----------------------------------------------------------------- */

let issues = await hydrate(await issuesInGroup(groupId));
let sortOrder = readPref(SORT_KEY) === 'number' ? 'number' : 'severity';
/** The comments in the order the sidebar and preview list them. The same array is kept, so the Send dialogs see changes. */
const ordered = [];
let numbers = numbering(issues);
/** A comment's number, the order it was made in within its review, the same in the report, every export, the popup and the overlay. */
const numberOf = (issue) => numbers(issue);

/** Recomputes the numbers and the listed order after comments change or the sort changes. */
function reorder() {
  numbers = numbering(issues);
  ordered.splice(0, ordered.length, ...orderIssues(issues, sortOrder));
}
reorder();

const generatedAt = new Date();
const hosts = hostsOf(issues);
const title = group?.name ?? (hosts.length === 1 ? `UI review, ${hosts[0]}` : 'UI review');

const shotsEl = document.querySelector('[data-shots]');
const widthsEl = document.querySelector('[data-widths]');
const stored = await chrome.storage.local.get(['shotMode', 'widthMode', 'fields']);
const options = {
  title,
  generatedAt,
  shots: stored.shotMode ?? 'both',
  fields: withDefaults(stored.fields),
  widths: (stored.widthMode ?? 'show') === 'show',
};
const docsOptions = {
  generatedAt,
  get shots() {
    return options.shots;
  },
  get fields() {
    return options.fields;
  },
  get widths() {
    return options.widths;
  },
  title: group?.name ?? (hosts.length === 1 ? `${hosts[0]} comments` : 'UI review comments'),
  group,
};
const slug = (group?.name ?? hosts[0] ?? 'report').replace(/[^a-z0-9.]+/gi, '-').toLowerCase();
const basename = `ui-issues-${slug}-${stamp(generatedAt)}`;

document.title = title;
applyTheme((theme) => {
  frame.contentDocument?.documentElement?.setAttribute('data-theme', theme);
});

/**
 * The preview document. Links open in a new tab, the font and tokens match the rest of Margin,
 * and the sidebar holds the only filter bar.
 */
function previewDoc() {
  const theme = document.documentElement.dataset.theme ?? 'light';
  return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8" /><base target="_blank" /><style>${FONT_CSS}${REPORT_CSS}${PREVIEW_DARK_CSS}${PREVIEW_EDIT_CSS}</style></head><body>${renderBody(issues, { ...options, order: sortOrder, preview: true })}</body></html>`;
}

/* Sidebar index ---------------------------------------------------------- */

const indexEl = document.querySelector('[data-index]');
const filtersEl = document.querySelector('[data-filters]');
const findEl = document.querySelector('[data-find]');
const statusFiltersEl = document.querySelector('[data-status-filters]');
const footEl = document.querySelector('[data-index-foot]');
let filter = 'all';
let statusFilter = 'all';
let rows = [];

/** Draws the filter buttons and the comment list from the comments in memory, keeping the filters picked. */
function renderSidebar() {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s.key, ordered.filter((i) => severityOf(i.severity).key === s.key).length]));
  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s.key, ordered.filter((i) => statusOf(i.status).key === s.key).length]));
  if (filter !== 'all' && !counts[filter]) filter = 'all';
  if (statusFilter !== 'all' && !statusCounts[statusFilter]) statusFilter = 'all';

  filtersEl.innerHTML = ordered.length
    ? [
        `<button class="filter-btn" type="button" data-filter="all" aria-pressed="${filter === 'all'}">All ${ordered.length}</button>`,
        ...SEVERITIES.filter((s) => counts[s.key] > 0).map(
          (s) => `<button class="filter-btn" type="button" data-filter="${s.key}" aria-pressed="${filter === s.key}">${s.label} ${counts[s.key]}</button>`,
        ),
      ].join('')
    : '';

  const statusesUsed = STATUSES.filter((s) => statusCounts[s.key] > 0);
  statusFiltersEl.innerHTML =
    statusesUsed.length > 1
      ? [
          `<button class="filter-btn" type="button" data-status-filter="all" aria-pressed="${statusFilter === 'all'}">Any status</button>`,
          ...statusesUsed.map(
            (s) =>
              `<button class="filter-btn" type="button" data-status-filter="${s.key}" aria-pressed="${statusFilter === s.key}">${escapeText(s.label)} ${statusCounts[s.key]}</button>`,
          ),
        ].join('')
      : '';

  indexEl.innerHTML = ordered.length
    ? `${ordered
        .map((issue, index) => {
          const sev = severityOf(issue.severity);
          const status = statusOf(issue.status);
          const name = issue.title || 'Untitled comment';
          return `<button class="index-row" type="button" data-jump="${index + 1}" data-sev="${sev.key}" data-status="${status.key}" title="${pad(numberOf(issue))} ${escapeText(name)}"
            data-text="${escapeText(`${pad(numberOf(issue))} ${issue.title ?? ''} ${issue.note ?? ''} ${issue.element?.selector ?? ''} ${issue.jira?.key ?? ''} ${hostOf(issue.page?.url)}`.toLowerCase())}">
          <span class="n">${pad(numberOf(issue))}</span>
          <span class="dot"></span>
          <span class="label">
            <b>${escapeText(name)}</b>
            <span class="sub">${status.key === 'open' ? '' : `<span class="tag">${escapeText(status.label)}</span>`}${issue.jira?.key ? `<span class="tag">${escapeText(issue.jira.key)}</span>` : ''}<span class="host">${escapeText(hostOf(issue.page?.url))}</span></span>
          </span>
        </button>`;
        })
        .join('')}<div class="index-none" data-index-none hidden><p data-index-none-text></p><button class="btn sm" type="button" data-clear-filters>Clear search and filters</button></div>`
    : '<p class="index-empty">No comments in this review yet. Open the page you want to review and press Alt+Shift+A to add one.</p>';

  rows = [...indexEl.querySelectorAll('[data-jump]')];
  applyFilter();
}

/** Keeps the sidebar list and the rendered report showing the same subset, with a message when nothing matches. */
function applyFilter() {
  const term = findEl.value.trim().toLowerCase();
  const doc = frame.contentDocument;
  let shown = 0;
  for (const row of rows) {
    const bySeverity = filter === 'all' || row.dataset.sev === filter;
    const byStatus = statusFilter === 'all' || row.dataset.status === statusFilter;
    const byText = !term || row.dataset.text.includes(term);
    const visible = bySeverity && byStatus && byText;
    row.hidden = !visible;
    if (visible) shown += 1;
    doc?.getElementById(`c-${row.dataset.jump}`)?.classList.toggle('hide', !visible);
  }
  const none = term ? `No comments match "${findEl.value.trim()}"` : 'No comments match these filters';
  const sideNone = indexEl.querySelector('[data-index-none]');
  if (sideNone) {
    sideNone.hidden = shown > 0;
    sideNone.querySelector('[data-index-none-text]').textContent = none;
  }
  const previewNone = doc?.querySelector('[data-no-match]');
  if (previewNone) {
    previewNone.hidden = shown > 0;
    previewNone.querySelector('[data-no-match-text]').textContent = none;
  }
  footEl.textContent = shown === ordered.length ? `${ordered.length} ${ordered.length === 1 ? 'comment' : 'comments'}` : `${shown} of ${ordered.length} comments shown`;
}

/** Clears the search box and both filters. */
function clearFilters() {
  findEl.value = '';
  filter = 'all';
  statusFilter = 'all';
  filtersEl.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === 'all')));
  statusFiltersEl.querySelectorAll('[data-status-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.statusFilter === 'all')));
  applyFilter();
}

filtersEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  filter = button.dataset.filter;
  filtersEl.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  applyFilter();
});

statusFiltersEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-status-filter]');
  if (!button) return;
  statusFilter = button.dataset.statusFilter;
  statusFiltersEl.querySelectorAll('[data-status-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  applyFilter();
});

findEl.addEventListener('input', applyFilter);
findEl.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && findEl.value) {
    event.preventDefault();
    findEl.value = '';
    applyFilter();
  }
});

document.querySelectorAll('[data-sort]').forEach((button) => {
  button.setAttribute('aria-pressed', String(button.dataset.sort === sortOrder));
  button.addEventListener('click', () => {
    if (sortOrder === button.dataset.sort) return;
    sortOrder = button.dataset.sort;
    writePref(SORT_KEY, sortOrder);
    document.querySelectorAll('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    rerender();
  });
});

let spyHold = 0;

/**
 * Marks one sidebar row as the comment in view.
 * @param {HTMLElement | undefined} row The row.
 */
function markCurrent(row) {
  if (!row) return;
  rows.forEach((r) => r.setAttribute('aria-current', String(r === row)));
  row.scrollIntoView({ block: 'nearest' });
}

/**
 * Scrolls the preview to a comment.
 * @param {string} jump The comment's place in the list.
 * @param {ScrollBehavior} [behavior] Smooth for a click, instant after a redraw.
 */
function jumpTo(jump, behavior = 'smooth') {
  spyHold = Date.now() + 1200;
  frame.contentDocument?.getElementById(`c-${jump}`)?.scrollIntoView({ behavior, block: 'start' });
}

indexEl.addEventListener('click', async (event) => {
  if (event.target.closest('[data-clear-filters]')) return clearFilters();
  const row = event.target.closest('[data-jump]');
  if (!row) return;
  const issue = ordered[Number(row.dataset.jump) - 1];
  markCurrent(row);
  if (editorOpen()) {
    if (!(await closeEditor())) return;
    pendingJump = row.dataset.jump;
    if (issue?.shot) editImage(issue);
    return;
  }
  jumpTo(row.dataset.jump);
});

/** Follows the preview's scroll in the sidebar, so the highlighted row is the comment at the top of the preview. */
function spy() {
  if (Date.now() < spyHold) return;
  const cards = [...(frame.contentDocument?.querySelectorAll('.issue:not(.hide)') ?? [])];
  const top = cards.find((card) => card.getBoundingClientRect().bottom > 72);
  const row = top && rows.find((r) => `c-${r.dataset.jump}` === top.id);
  if (row && row.getAttribute('aria-current') !== 'true') markCurrent(row);
}

let previewScroll = 0;
let pendingJump = null;

/** Redraws the preview from the comments in memory, keeping its scroll position. */
function refreshPreview() {
  previewScroll = frame.contentWindow?.scrollY ?? 0;
  frame.srcdoc = previewDoc();
}

/** Redraws the sidebar and the preview after comments, their order or the settings change, without a reload. */
function rerender() {
  reorder();
  renderSidebar();
  refreshPreview();
  paintEnabled();
}

/** Turns off the actions that need comments when the review has none. */
function paintEnabled() {
  const none = !issues.length;
  document
    .querySelectorAll('[data-verify], [data-edit], [data-copy], [data-proxy], [data-doc], [data-download], [data-print], [data-markdown], [data-save-review], [data-send-jira], [data-send-figma], [data-recrop]')
    .forEach((el) => {
      el.disabled = none;
    });
  const sort = document.querySelector('.seg.sort');
  sort.hidden = issues.length < 2;
}

/**
 * The comment a preview element belongs to, with its position in the report.
 * @param {Element} el An element inside a comment card.
 */
function issueOfCard(el) {
  const index = Number(el.closest('.issue').id.slice(2)) - 1;
  return { issue: ordered[index], index };
}

const notePop = Object.assign(document.createElement('div'), { className: 'menu-body ctx-menu quick-note', hidden: true });
document.body.append(notePop);
let pendingNote = null;

/**
 * Shows a small box beside a point in this page, kept inside the window and clear of the marker at that point.
 * @param {{x:number,y:number}} at The marker or click, in this page's coordinates.
 * @param {string} html Its contents.
 */
function openPop(at, html) {
  const gap = 24;
  notePop.innerHTML = html;
  notePop.hidden = false;
  const w = notePop.offsetWidth;
  const h = notePop.offsetHeight;
  const left = at.x + gap + w <= innerWidth - 8 ? at.x + gap : at.x - gap - w;
  const top = at.y + gap + h <= innerHeight - 8 ? at.y + gap : at.y - gap - h;
  notePop.style.left = `${Math.max(8, Math.min(left, innerWidth - w - 8))}px`;
  notePop.style.top = `${Math.max(8, Math.min(top, innerHeight - h - 8))}px`;
}

/**
 * Shows a short line beside a point that closes on its own.
 * @param {{x:number,y:number}} at Where it opens.
 * @param {string} text The line.
 */
function hintAt(at, text) {
  openPop(at, `<span class="menu-label">${escapeText(text)}</span>`);
  setTimeout(() => {
    if (!pendingNote) notePop.hidden = true;
  }, 2200);
}

/**
 * Applies a quick marker change from the background to the comment in memory and redraws the preview.
 * @param {object} issue The comment that changed.
 * @param {{marks: object[], shot?: string, detail?: string}} res The background's reply.
 */
function applyMarks(issue, res) {
  Object.assign(issue, { marks: res.marks }, res.shot ? { shot: res.shot, detail: res.detail } : {});
  refreshPreview();
}

/**
 * Removes one numbered marker from a comment and redraws the preview.
 * @param {object} issue The comment the marker belongs to.
 * @param {number} index The marker's position in its list.
 */
async function dropMark(issue, index) {
  const res = await send('quickMark', { id: issue.id, action: 'drop', index });
  if (res?.marks) applyMarks(issue, res);
}

/**
 * Offers to put back a comment's markers as they were before a removal.
 * @param {object} issue The comment.
 * @param {object[]} before Its markers before the removal.
 * @param {number} index The removed marker's position.
 */
function offerUndo(issue, before, index) {
  toast(`Removed marker ${index + 1} from comment ${pad(numberOf(issue))}`, {
    action: 'Undo',
    onAction: async () => {
      const res = await send('annotate', { id: issue.id, marks: before, rect: issue.rect });
      if (res?.error) return toast(res.error);
      applyMarks(issue, { marks: before, shot: res.shot, detail: res.detail });
    },
  });
}

/**
 * Removes a marker and offers Undo.
 * @param {object} issue The comment the marker belongs to.
 * @param {number} index The marker's position in its list.
 */
async function removeMark(issue, index) {
  const before = structuredClone(issue.marks ?? []);
  await dropMark(issue, index);
  offerUndo(issue, before, index);
}

/**
 * Closes the note box. A marker that was just placed and still has no note is removed, so blank markers are never kept.
 */
async function closeNote() {
  notePop.hidden = true;
  notePop.replaceChildren();
  const pending = pendingNote;
  pendingNote = null;
  if (!pending?.fresh) return;
  await dropMark(pending.issue, pending.index);
}

/**
 * Asks for the note of a marker, either one just placed or one being edited, and saves it.
 * @param {object} issue The comment the marker belongs to.
 * @param {number} index The marker's position in its list.
 * @param {{x:number,y:number}} at Where the marker is, in this page's coordinates.
 * @param {boolean} fresh True for a marker placed a moment ago, which is removed if left without a note.
 */
function askNote(issue, index, at, fresh) {
  pendingNote = { issue, index, fresh };
  openPop(
    at,
    `<label class="menu-field">Note for marker ${index + 1}<input type="text" placeholder="What this number points out" /></label>
    <span class="hint" data-note-hint>${fresh ? 'A marker without a note is removed.' : ''}</span>
    <div class="row"><button class="btn sm ghost danger" type="button" data-remove>Remove marker</button><button class="btn sm primary" type="button" data-save>Save note</button></div>`,
  );
  const input = notePop.querySelector('input');
  input.value = issue.marks?.[index]?.note ?? '';
  const save = async () => {
    const note = input.value.trim();
    if (!note) {
      notePop.querySelector('[data-note-hint]').textContent = 'Write a note, or remove the marker.';
      input.focus();
      return;
    }
    pendingNote = null;
    notePop.hidden = true;
    const res = await send('markNote', { id: issue.id, index, note });
    if (res?.marks) applyMarks(issue, res);
  };
  const remove = async () => {
    pendingNote = null;
    notePop.hidden = true;
    if (fresh) await dropMark(issue, index);
    else await removeMark(issue, index);
  };
  notePop.querySelector('[data-save]').addEventListener('click', save);
  notePop.querySelector('[data-remove]').addEventListener('click', remove);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save();
    if (event.key === 'Escape') closeNote();
  });
  input.focus();
}

document.addEventListener('pointerdown', (event) => {
  if (!notePop.hidden && !notePop.contains(event.target)) closeNote();
});

/**
 * Adds a numbered marker where a preview screenshot was clicked, or removes the one nearest a right-click.
 * @param {HTMLImageElement} img The clicked screenshot.
 * @param {MouseEvent} event The click inside the preview.
 * @param {'add' | 'remove'} action What the click does.
 */
async function quickMark(img, event, action) {
  const { issue } = issueOfCard(img);
  if (!issue?.shot) return;
  await closeNote();
  const box = img.getBoundingClientRect();
  const outer = frame.getBoundingClientRect();
  const at = { x: outer.left + event.clientX, y: outer.top + event.clientY };
  const before = structuredClone(issue.marks ?? []);
  const res = await send('quickMark', {
    id: issue.id,
    action,
    image: img.closest('figure.wide') ? 'shot' : 'detail',
    fx: (event.clientX - box.left) / box.width,
    fy: (event.clientY - box.top) / box.height,
    aspect: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0,
    reach: 18 / box.width,
  });
  if (res?.error) {
    hintAt(at, res.error);
    return;
  }
  if (res.stale) {
    applyMarks(issue, res);
    hintAt(at, 'The image was redrawn with the current crop. Click again to place the marker.');
    return;
  }
  if (res.index == null) {
    if (action === 'remove') hintAt(at, 'No marker here. Right-click on a number to remove it.');
    return;
  }
  applyMarks(issue, res);
  if (action === 'add') askNote(issue, res.index, at, true);
  else offerUndo(issue, before, res.index);
}

/**
 * Adds Edit and Remove buttons to each numbered note under a comment in the preview.
 * @param {Document} doc The preview document.
 */
function wireNoteList(doc) {
  doc.querySelectorAll('.issue ol.marks li').forEach((li) => {
    const { issue } = issueOfCard(li);
    const index = li.value - 1;
    const actions = doc.createElement('span');
    actions.className = 'li-actions';
    actions.innerHTML = `<button type="button" data-edit-note aria-label="Edit note ${index + 1}">Edit</button><button type="button" data-remove-note aria-label="Remove marker ${index + 1}">Remove</button>`;
    li.append(actions);
    actions.querySelector('[data-edit-note]').addEventListener('click', (event) => {
      if (pendingNote) return closeNote();
      const outer = frame.getBoundingClientRect();
      askNote(issue, index, { x: outer.left + event.clientX, y: outer.top + event.clientY }, false);
    });
    actions.querySelector('[data-remove-note]').addEventListener('click', () => removeMark(issue, index));
  });
}

const EDITABLE = '.issue figure img:not(.after):not(.at-width)';

/**
 * Adds a line under each card's screenshots saying how quick markers work, with the way into the image editor,
 * and a Copy button at the end of each card's header.
 * @param {Document} doc The preview document.
 */
function addCardTools(doc) {
  doc.querySelectorAll('.issue').forEach((card) => {
    const header = card.querySelector('header');
    header.insertAdjacentHTML(
      'beforeend',
      `<button type="button" class="card-copy" title="Copy this comment for Slack, Jira, GitHub or a doc" aria-label="Copy comment ${escapeText(card.querySelector('.num').textContent)}">${COPY_ICON}Copy</button>`,
    );
    const first = card.querySelector(EDITABLE);
    if (!first || !issueOfCard(card).issue?.shot) return;
    const bar = doc.createElement('div');
    bar.className = 'quick-bar';
    bar.innerHTML = '<span>Click a screenshot to add a numbered marker. Right-click a marker to remove it.</span><button type="button" data-open-editor>Open editor for boxes and arrows</button>';
    (first.closest('.pair') ?? first.closest('details.full') ?? first.closest('figure')).after(bar);
  });
}

/**
 * Handles clicks inside the preview: links open in a new tab, Copy copies one comment, Open editor opens the image
 * editor, and a click on a screenshot places a quick marker.
 * @param {MouseEvent} event The click.
 */
function onPreviewClick(event) {
  const link = event.target.closest?.('a[href]');
  if (link) {
    event.preventDefault();
    chrome.tabs.create({ url: link.href });
    return;
  }
  if (event.target.closest?.('[data-clear-filters]')) return clearFilters();
  const copy = event.target.closest?.('.card-copy');
  if (copy) {
    const { issue } = issueOfCard(copy);
    copyOut(copy, commentMarkdown(issue, { fields: options.fields, widths: options.widths }), commentHtml(issue, options.fields, options.widths));
    return;
  }
  const open = event.target.closest?.('[data-open-editor]');
  if (open) {
    editImage(issueOfCard(open).issue);
    return;
  }
  const img = event.target.closest?.(EDITABLE);
  if (img) quickMark(img, event, 'add');
}

frame.addEventListener('load', () => {
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  doc.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'light';
  addCardTools(doc);
  wireNoteList(doc);
  applyFilter();
  if (pendingJump) {
    jumpTo(pendingJump, 'instant');
    pendingJump = null;
  } else if (previewScroll) {
    win.scrollTo(0, previewScroll);
  }
  doc.addEventListener('click', onPreviewClick);
  doc.addEventListener('contextmenu', (event) => {
    const img = event.target.closest?.(EDITABLE);
    if (!img) return;
    event.preventDefault();
    quickMark(img, event, 'remove');
  });
  doc.addEventListener('pointerdown', (event) => {
    closeMenus();
    if (!event.target.closest?.('.li-actions')) closeNote();
  });
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenus();
  });
  let ticking = false;
  win.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      spy();
    });
  });
});
frame.addEventListener('load', () => tourOnce('report', REPORT_TOUR), { once: true });

/** Measures the first editable screenshot inside the preview, in this page's coordinates, or the preview itself. */
function firstPreviewShot() {
  const outer = frame.getBoundingClientRect();
  const shot = frame.contentDocument?.querySelector(EDITABLE);
  if (!shot) return null;
  shot.scrollIntoView({ block: 'center' });
  const inner = shot.getBoundingClientRect();
  const top = Math.max(outer.top, outer.top + inner.top);
  const bottom = Math.min(outer.bottom, outer.top + inner.bottom);
  if (bottom - top < 24) return outer;
  return new DOMRect(outer.left + inner.left, top, inner.width, bottom - top);
}

const REPORT_TOUR = [
  { target: '[data-group]', over: '.canvas', title: 'One review per round', body: 'Each review holds one round of comments. Switch, edit or start a new one here.' },
  { target: '.sidebar', title: 'Every comment', body: 'Sorted by severity or by number. Filter or search to jump to one in the report.' },
  { target: firstPreviewShot, title: 'Number the details', body: 'Click a screenshot to drop a numbered marker. Use Open editor for boxes and arrows.' },
  { target: '[data-edit]', title: 'Tidy the wording', body: 'Fix titles, notes and severity for every comment in one place.' },
  { target: '[data-copy]', title: 'Hand it over', body: 'Paste the whole review into Google Docs. Numbered notes stay numbered.' },
  { target: '.menu:not(.review-menu) > summary', title: 'More ways out', body: 'Word, HTML and Markdown, review files to share, Jira and Figma, export settings, and this tour again.' },
];

document.querySelector('[data-tour]').addEventListener('click', () => {
  closeMenus();
  startTour('report', REPORT_TOUR);
});
document.querySelector('[data-help]').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('[data-skip]').addEventListener('click', (event) => {
  event.preventDefault();
  (rows.find((r) => !r.hidden) ?? indexEl).focus();
});

/* Exports ---------------------------------------------------------------- */

document.querySelector('[data-download]').addEventListener('click', () => {
  saveBlob(new Blob([buildReport(issues, options)], { type: 'text/html' }), `${basename}.html`);
  toast(`Downloaded ${basename}.html`);
});

document.querySelector('[data-doc]').addEventListener('click', () => {
  saveBlob(new Blob([buildDocsHtml(issues, docsOptions)], { type: 'application/msword' }), `${basename}.doc`);
  toast(`Downloaded ${basename}.doc. Word opens it with a note about the format, choose Yes.`);
});

document.querySelector('[data-copy]').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([buildDocsHtml(issues, docsOptions)], { type: 'text/html' }),
        'text/plain': new Blob([buildDocsText(issues, docsOptions)], { type: 'text/plain' }),
      }),
    ]);
    flash(button, 'Copied');
  } catch {
    flash(button, 'Copy failed');
  }
});

document.querySelector('[data-print]').addEventListener('click', () => {
  frame.contentWindow.focus();
  frame.contentWindow.print();
});

/**
 * Puts text, and optionally rich text, on the clipboard and confirms on the button pressed, or in a toast when
 * the button sits in a menu that has closed.
 * @param {HTMLElement} button The button to confirm on.
 * @param {string} plain The plain text flavour.
 * @param {string} [html] The rich text flavour.
 * @param {string} [done] The toast to show instead of flashing the button.
 */
async function copyOut(button, plain, html, done) {
  try {
    const flavours = { 'text/plain': new Blob([plain], { type: 'text/plain' }) };
    if (html) flavours['text/html'] = new Blob([html], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(flavours)]);
    if (done) toast(done);
    else flash(button, 'Copied');
  } catch {
    if (done) toast('Copy failed. Try again with this tab in front.');
    else flash(button, 'Copy failed');
  }
}

document.querySelector('[data-markdown]').addEventListener('click', (event) => {
  copyOut(event.currentTarget, buildMarkdown(issues, { title: docsOptions.title, fields: options.fields, widths: options.widths }), undefined, 'Copied the review as Markdown');
});

document.querySelector('[data-save-review]').addEventListener('click', async () => {
  toast('Saving the review file');
  const raws = Object.fromEntries(await Promise.all(issues.map(async (issue) => [issue.id, await readRaw(issue.id)])));
  const blob = new Blob([buildReviewFile(group ?? { name: title }, issues, raws)], { type: 'application/json' });
  saveBlob(blob, `${basename}.margin.json`);
  toast(`Saved ${basename}.margin.json, ${(blob.size / 1048576).toFixed(1)} MB`);
});

const reviewInput = document.querySelector('[data-review-input]');
document.querySelector('[data-open-review]').addEventListener('click', () => reviewInput.click());
reviewInput.addEventListener('change', async () => {
  const file = reviewInput.files?.[0];
  reviewInput.value = '';
  if (!file) return;
  const res = await send('importReview', { contents: await file.text() });
  if (res?.error) {
    toast(`${file.name} could not be opened. ${res.error}`, { ms: 9000 });
    return;
  }
  location.search = `?group=${res.group.id}`;
});

document.querySelector('[data-recrop]').addEventListener('click', async () => {
  toast('Redoing crops', { ms: 60_000 });
  const res = await send('recropGroup', { groupId });
  if (res?.error) {
    toast(`Redoing crops failed. ${res.error}`);
    return;
  }
  const fresh = await hydrate(issues);
  fresh.forEach((copy, i) => Object.assign(issues[i], copy));
  refreshPreview();
  toast(`Redid ${res.updated} ${res.updated === 1 ? 'crop' : 'crops'}`);
});

wireSend({ ordered, numberOf, group, options, reviewTitle: docsOptions.title, send, onChange: rerender });

/* Export settings -------------------------------------------------------- */

const fieldsDialog = document.querySelector('[data-fields-dialog]');
const fieldsBody = document.querySelector('[data-fields-body]');

document.querySelector('[data-fields]').addEventListener('click', () => {
  shotsEl.value = options.shots;
  widthsEl.value = options.widths ? 'show' : 'hide';
  fieldsBody.innerHTML = FACT_FIELDS.map(
    (f) => `<label class="row">
      <input type="checkbox" data-field-key="${f.key}"${options.fields[f.key] ? ' checked' : ''} />
      <span>${f.label}</span>
    </label>`,
  ).join('');
  fieldsDialog.showModal();
});

document.querySelector('[data-fields-cancel]').addEventListener('click', () => fieldsDialog.close());

document.querySelector('[data-fields-save]').addEventListener('click', async () => {
  const next = Object.fromEntries(
    [...fieldsBody.querySelectorAll('[data-field-key]')].map((box) => [box.dataset.fieldKey, box.checked]),
  );
  await chrome.storage.local.set({ fields: next, shotMode: shotsEl.value, widthMode: widthsEl.value });
  Object.assign(options, { fields: withDefaults(next), shots: shotsEl.value, widths: widthsEl.value === 'show' });
  fieldsDialog.close();
  refreshPreview();
  toast('Export settings saved');
});

/* Comment editor --------------------------------------------------------- */

const editDialog = document.querySelector('[data-edit-dialog]');
const editBody = document.querySelector('[data-edit-body]');
const editSave = document.querySelector('[data-edit-save]');

/**
 * Opens the image editor for a comment. Each save redraws the preview behind it, and when the
 * comment editor is open the row thumbnail updates too, so staged edits there survive.
 * @param {object} issue The stored comment.
 */
function editImage(issue) {
  openEditor(issue, {
    send,
    label: `Edit image, comment ${pad(numberOf(issue))}`,
    confirm: confirmSheet,
    onError: (message) => toast(message),
    onChange: (saved) => {
      refreshPreview();
      if (!editDialog.open) return;
      const row = editBody.querySelector(`[data-id="${saved.id}"]`);
      if (row) paintThumb(row, saved);
    },
  });
}

/**
 * Shows a comment's region image and annotation count in its editor row.
 * @param {HTMLElement} row The comment's editor row.
 * @param {object} issue The stored comment.
 */
function paintThumb(row, issue) {
  const count = issue.marks?.length ?? 0;
  row.querySelector('[data-marks-img]').src = issue.detail ?? '';
  row.querySelector('[data-marks-count]').textContent = count
    ? `${count} numbered ${count === 1 ? 'annotation' : 'annotations'}`
    : 'No annotations yet';
}

/**
 * Grows a note field to show all of its text.
 * @param {HTMLTextAreaElement} area The field.
 */
function fitHeight(area) {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" /></svg>';

/**
 * The values a row's fields hold, to tell when the reviewer changed something.
 * @param {HTMLElement} row An editor row.
 */
const rowValues = (row) =>
  JSON.stringify([...row.querySelectorAll('[data-field]')].map((el) => el.value)) + (row.dataset.remove === 'true' ? 'x' : '');

/** How many rows have changes or a staged delete. */
const dirtyRows = () => [...editBody.querySelectorAll('.edit-row')].filter((row) => rowValues(row) !== row.dataset.initial).length;

/** Names the deletions on the Save button, so saving says what it will do. */
function paintEditSave() {
  const removing = editBody.querySelectorAll('.edit-row[data-remove="true"]').length;
  editSave.textContent = removing ? `Save and delete ${removing}` : 'Save changes';
}

/**
 * One editable comment: severity, status, title, note and links, with its page for context.
 * @param {object} issue The stored comment.
 */
function editRow(issue) {
  const n = pad(numberOf(issue));
  const row = document.createElement('div');
  row.className = 'edit-row';
  row.innerHTML = `
    <span class="n">${n}</span>
    <span class="stack">
      <select data-field="severity" aria-label="Severity of comment ${n}">
        ${SEVERITIES.map((s) => `<option value="${s.key}">${s.label}</option>`).join('')}
      </select>
      <select data-field="status" aria-label="Status of comment ${n}">
        ${STATUSES.map((s) => `<option value="${s.key}">${escapeText(s.label)}</option>`).join('')}
      </select>
    </span>
    <span class="stack">
      <input type="text" data-field="title" placeholder="What is wrong" aria-label="Title of comment ${n}" />
      <textarea data-field="note" rows="2" placeholder="Expected, actual, steps" aria-label="Note of comment ${n}"></textarea>
      <input type="text" data-field="links" placeholder="Links, such as a Figma frame, optional" aria-label="Links of comment ${n}" />
      <span class="hint danger-text" data-links-error hidden></span>
      <span class="where"></span>
      ${
        issue.shot
          ? `<span class="marks">
        <img data-marks-img alt="Marked region of comment ${n}. Click to edit the image." />
        <span class="row">
          <span class="hint" data-marks-count></span>
          <button class="btn sm" type="button" data-edit-image>Edit image</button>
        </span>
      </span>`
          : ''
      }
    </span>
    <button class="icon-btn danger" type="button" data-remove title="Delete comment ${n}" aria-label="Delete comment ${n}">${TRASH}</button>
  `;
  row.querySelector('[data-field="severity"]').value = severityOf(issue.severity).key;
  row.querySelector('[data-field="status"]').value = statusOf(issue.status).key;
  row.querySelector('[data-field="title"]').value = issue.title ?? '';
  row.querySelector('[data-field="note"]').value = issue.note ?? '';
  row.querySelector('[data-field="links"]').value = (issue.links ?? []).join(' ');
  row.querySelector('.where').textContent = [issue.jira?.key, issue.element?.selector, issue.page?.url]
    .filter(Boolean)
    .join('  ');
  row.dataset.id = issue.id;
  const note = row.querySelector('[data-field="note"]');
  note.addEventListener('input', () => fitHeight(note));
  if (issue.shot) {
    paintThumb(row, issue);
    const open = () => row.dataset.remove !== 'true' && editImage(issue);
    row.querySelector('[data-marks-img]').addEventListener('click', open);
    row.querySelector('[data-edit-image]').addEventListener('click', open);
  }

  const remove = row.querySelector('[data-remove]');
  remove.addEventListener('click', () => {
    const removing = row.dataset.remove !== 'true';
    row.dataset.remove = String(removing);
    row.classList.toggle('removing', removing);
    row.querySelectorAll('input, textarea, select').forEach((el) => {
      el.disabled = removing;
    });
    remove.className = removing ? 'btn sm' : 'icon-btn danger';
    remove.innerHTML = removing ? 'Restore' : TRASH;
    remove.title = removing ? `Keep comment ${n}` : `Delete comment ${n}`;
    remove.setAttribute('aria-label', remove.title);
    paintEditSave();
  });
  return row;
}

document.querySelector('[data-edit]').addEventListener('click', () => {
  editBody.innerHTML = '';
  ordered.forEach((issue) => editBody.append(editRow(issue)));
  document.querySelector('[data-edit-count]').textContent = `${issues.length} ${issues.length === 1 ? 'comment' : 'comments'}`;
  document.querySelector('[data-edit-note]').textContent = 'Edits apply to the report and exports. Image edits save from the image editor.';
  editSave.disabled = false;
  paintEditSave();
  editDialog.showModal();
  editBody.querySelectorAll('textarea').forEach(fitHeight);
  editBody.querySelectorAll('.edit-row').forEach((row) => {
    row.dataset.initial = rowValues(row);
  });
  editBody.scrollTop = 0;
  editBody.querySelector('[data-field="title"]')?.focus();
});

/** Closes Edit comments, asking first when something changed. */
async function requestEditClose() {
  const dirty = dirtyRows();
  if (dirty) {
    const choice = await confirmSheet({
      title: `Discard changes to ${dirty} ${dirty === 1 ? 'comment' : 'comments'}?`,
      body: 'The edits you made here have not been saved.',
      buttons: [
        { label: 'Keep editing', value: null },
        { label: 'Discard changes', value: 'discard', kind: 'danger' },
      ],
    });
    if (choice !== 'discard') return;
  }
  editDialog.close();
}

document.querySelector('[data-edit-cancel]').addEventListener('click', requestEditClose);
editDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  requestEditClose();
});

/**
 * Reads a links field. Bare addresses such as figma.com/design/... get https:// in front.
 * @param {string} value What was typed.
 * @returns {{ links: string[], bad: string[] }} The links to keep and the parts that are not links.
 */
function parseLinks(value) {
  const links = [];
  const bad = [];
  for (const part of value.split(/[\s,]+/).filter(Boolean)) {
    if (/^https?:\/\/\S+\.\S+/i.test(part)) links.push(part);
    else if (/^([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(part)) links.push(`https://${part}`);
    else bad.push(part);
  }
  return { links, bad };
}

editSave.addEventListener('click', async () => {
  const editRows = [...editBody.querySelectorAll('.edit-row')];
  let invalid = null;
  for (const row of editRows) {
    const error = row.querySelector('[data-links-error]');
    const { bad } = parseLinks(row.querySelector('[data-field="links"]').value);
    error.hidden = !bad.length || row.dataset.remove === 'true';
    error.textContent = `Not a link: ${bad.join(', ')}. Paste the full address, starting with https://`;
    if (!error.hidden) invalid ??= row;
  }
  if (invalid) {
    invalid.querySelector('[data-field="links"]').focus();
    return;
  }
  editSave.disabled = true;
  editSave.textContent = 'Saving';
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const removed = new Set();
  let changes = 0;
  for (const row of editRows) {
    const issue = byId.get(row.dataset.id);
    if (row.dataset.remove === 'true') {
      await send('discard', { id: issue.id });
      removed.add(issue.id);
      continue;
    }
    const { links } = parseLinks(row.querySelector('[data-field="links"]').value);
    const patch = {
      severity: row.querySelector('[data-field="severity"]').value,
      status: row.querySelector('[data-field="status"]').value,
      title: row.querySelector('[data-field="title"]').value.trim(),
      note: row.querySelector('[data-field="note"]').value.trim(),
      links,
    };
    const changed =
      links.join(' ') !== (issue.links ?? []).join(' ') ||
      statusOf(issue.status).key !== patch.status ||
      ['severity', 'title', 'note'].some((key) => (issue[key] ?? '') !== patch[key]);
    if (!changed) continue;
    await send('update', { id: issue.id, patch });
    Object.assign(issue, patch);
    changes += 1;
  }
  issues = issues.filter((issue) => !removed.has(issue.id));
  editDialog.close();
  rerender();
  const parts = [changes && `${changes} ${changes === 1 ? 'comment' : 'comments'} updated`, removed.size && `${removed.size} deleted`].filter(Boolean);
  toast(parts.length ? `Saved. ${parts.join(', ')}.` : 'No changes to save');
});

/* Recheck fixes ---------------------------------------------------------- */

const verifyDialog = document.querySelector('[data-verify-dialog]');
const verifyBody = document.querySelector('[data-verify-body]');
const verifyFoot = document.querySelector('[data-verify-foot]');
const verifyState = document.querySelector('[data-verify-state]');
const STALE_RUN_MS = 60_000;
const CHANGED_SHARE = 0.003;
let verifyChanged = false;
let awaitingRun = false;
let walk = null;
let lastRun = null;

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
 * The pages of this review other than one, each with how many comments it has.
 * @param {string} [except] A page address to leave out.
 */
function pagesBesides(except) {
  const pages = [];
  for (const issue of ordered) {
    if (!issue.page?.url || samePage(issue.page.url, except)) continue;
    const found = pages.find((p) => samePage(p.page.url, issue.page.url));
    if (found) found.count += 1;
    else pages.push({ page: issue.page, count: 1 });
  }
  return pages;
}

/**
 * Lists pages with a link to each, for comments that can only be checked on their own page.
 * @param {{page: {url: string, title?: string}, count: number}[]} pages The pages to list.
 * @param {string} heading The line above the list.
 */
function pagesHtml(pages, heading) {
  if (!pages.length) return '';
  return `<span class="menu-label">${escapeText(heading)}</span>
    <ul class="verify-pages">${pages
      .map(
        ({ page, count }) => `<li>
          <span class="stack"><b>${escapeText(routeOf(page))}</b><span class="hint">${count} ${count === 1 ? 'comment' : 'comments'}</span></span>
          <a class="btn sm" href="${escapeText(page.url)}" target="_blank" rel="noopener">Open this page to verify</a>
        </li>`,
      )
      .join('')}</ul>`;
}

/**
 * Fills the recheck sheet.
 * @param {string} state The line in the header.
 * @param {string} body The sheet contents.
 * @param {string} foot The footer contents.
 */
function paintVerify(state, body, foot) {
  verifyState.textContent = state;
  verifyBody.innerHTML = body;
  verifyFoot.innerHTML = foot;
  if (!verifyDialog.open) verifyDialog.showModal();
}

/** Explains that Margin can only capture a page it was opened on, and links every page of the review. */
function showNoTab() {
  walk = null;
  paintVerify(
    '',
    `<p class="hint">Margin can capture a page only after you open Margin on it. Open the page, click Margin in the toolbar and press Recheck there.</p>
    ${pagesHtml(pagesBesides(), 'Pages in this review')}`,
    '<button class="btn" type="button" data-verify-close>Close</button>',
  );
}

/**
 * Shows how far a recheck run has got, with a way to stop it.
 * @param {{done: number, total: number, page: string, title?: string}} run The run record.
 */
function showProgress(run) {
  walk = null;
  paintVerify(
    `${run.done} of ${run.total} checked`,
    `<p>Checking ${Math.min(run.done + 1, run.total)} of ${run.total} on ${escapeText(routeOf({ url: run.page, title: run.title }))}</p>
    <p class="hint">Press Cancel or Escape to stop after the capture in progress. Switching away from the page's tab stops it too.</p>`,
    '<button class="btn" type="button" data-verify-cancel>Cancel</button>',
  );
}

/**
 * Says a run stopped early, names the comments it did not reach, and offers to check them or review the ones it did.
 * @param {{checked: string[], failed: string[], page: string, done: number, total: number}} run The run record.
 */
function showStopped(run) {
  walk = null;
  lastRun = run;
  const missed = ordered.filter((i) => samePage(i.page?.url, run.page) && !run.checked.includes(i.id) && !run.failed.includes(i.id));
  const n = run.checked.length;
  paintVerify(
    `Stopped after ${run.done} of ${run.total}`,
    `<p>Stopped after ${run.done} of ${run.total}. ${missed.length} ${missed.length === 1 ? 'comment was' : 'comments were'} not checked.</p>
    <ul class="verify-changes">${missed.map((i) => `<li><span class="n">${pad(numberOf(i))}</span><span class="title">${escapeText(i.title || 'Untitled comment')}</span></li>`).join('')}</ul>
    ${n ? `<p class="hint">You can review the ${n} that ${n === 1 ? 'was' : 'were'} checked now.</p>` : ''}`,
    `<button class="btn ghost" type="button" data-verify-close>Close</button>
    ${missed.length ? `<button class="btn" type="button" data-verify-rest>Check the other ${missed.length}</button>` : ''}
    ${n ? `<button class="btn primary" type="button" data-verify-review>Review ${n}</button>` : ''}`,
  );
  (verifyFoot.querySelector('[data-verify-review]') ?? verifyFoot.querySelector('[data-verify-rest]') ?? verifyFoot.querySelector('[data-verify-close]')).focus();
}

/**
 * What the pixel comparison suggests for one comment. It is only a hint and never sets a status.
 * @param {{change?: number | null}} issue The rechecked comment.
 */
function changeHint(issue) {
  if (typeof issue.change !== 'number') return 'No change hint for this one, the window size or the first screenshot differs.';
  if (issue.change < CHANGED_SHARE) return 'Looks unchanged.';
  const percent = Math.round(issue.change * 100);
  return `Looks changed, ${percent ? `about ${percent}%` : 'under 1%'} of the marked region differs.`;
}

const VERIFY_KEYS = { f: 'fixed', o: 'open', w: 'wontfix' };

/** The option to walk through comments already marked Fixed or Won't fix too. */
function resolvedToggle() {
  const count = walk.checked.filter((i) => statusOf(walk.changes.get(i.id)?.from ?? i.status).key !== 'open').length;
  if (!count) return '';
  return `<label class="pick verify-resolved"><input type="checkbox" data-verify-resolved${walk.includeResolved ? ' checked' : ''} /><span>Include the ${count} already marked Fixed or Won't fix</span></label>`;
}

/** Draws the comment the walk is on, or the summary once every one has been seen. */
function paintWalk() {
  const { list, at, run } = walk;
  const others = pagesHtml(pagesBesides(run.page), 'Comments on other pages');
  if (at >= list.length) {
    const tally = STATUSES.map((s) => `${list.filter((i) => statusOf(i.status).key === s.key).length} ${s.label.toLowerCase()}`).join(', ');
    const changes = [...walk.changes.values()];
    paintVerify(
      `${list.length} checked`,
      `<p>${list.length ? `${list.length} ${list.length === 1 ? 'comment' : 'comments'} checked, ${escapeText(tally)}.` : 'Every rechecked comment is already marked Fixed or Won\'t fix.'}</p>
      ${resolvedToggle()}
      ${
        changes.length
          ? `<span class="menu-label">Changed</span><ul class="verify-changes">${changes
              .map(
                ({ issue, from, to }) => `<li><span class="n">${pad(numberOf(issue))}</span><span class="title">${escapeText(issue.title || 'Untitled comment')}</span>
                <span class="hint">${escapeText(statusOf(from).label)} to ${escapeText(statusOf(to).label)}</span>
                <button class="btn sm ghost" type="button" data-verify-undo="${escapeText(issue.id)}">Undo</button></li>`,
              )
              .join('')}</ul>`
          : '<p class="hint">No status changed.</p>'
      }
      ${run.failed.length ? `<p class="hint">${run.failed.length} could not be captured. Try Recheck from the popup on those.</p>` : ''}
      ${others}`,
      `<button class="btn ghost" type="button" data-verify-move="-1"${list.length ? '' : ' disabled'}>Previous</button>
      <button class="btn primary" type="button" data-verify-close>Done</button>`,
    );
    verifyFoot.querySelector('[data-verify-close]').focus();
    return;
  }
  const issue = list[at];
  const n = numberOf(issue);
  paintVerify(
    `${at + 1} of ${list.length}`,
    `<div class="verify-item" tabindex="-1">
      <div class="row">
        <span class="n">${pad(n)}</span>
        <span class="title">${escapeText(issue.title || 'Untitled comment')}</span>
        ${severityBadge(severityOf(issue.severity))}
        <span class="tag">${escapeText(statusOf(issue.status).label)}</span>
      </div>
      ${issue.note ? `<p class="hint note">${escapeText(issue.note)}</p>` : ''}
      <div class="grid-2 verify-pair">
        <figure>${issue.detail ? `<img alt="Marked region before, comment ${n}" src="${issue.detail}" />` : '<p class="hint">No image of the region</p>'}<figcaption>Before</figcaption></figure>
        <figure>${issue.after ? `<img alt="Same region now, comment ${n}" src="${issue.after}" />` : '<p class="hint">No image of the region</p>'}<figcaption>${escapeText(recheckCaption(issue))}</figcaption></figure>
      </div>
      <p class="hint">${escapeText(changeHint(issue))}</p>
    </div>
    ${at === 0 ? resolvedToggle() : ''}
    ${others}`,
    `<span class="state"><kbd>F</kbd> fixed <kbd>O</kbd> still open <kbd>W</kbd> won't fix <kbd>Left</kbd> <kbd>Right</kbd> move</span>
    <button class="btn ghost" type="button" data-verify-move="-1"${at ? '' : ' disabled'}>Previous</button>
    <button class="btn ghost" type="button" data-verify-move="1">Skip</button>
    <button class="btn" type="button" data-verify-pick="wontfix">Won't fix</button>
    <button class="btn" type="button" data-verify-pick="open">Still open</button>
    <button class="btn action" type="button" data-verify-pick="fixed">Fixed</button>`,
  );
  verifyBody.querySelector('.verify-item').focus();
}

/** Builds the walk list from the checked comments, leaving out resolved ones unless asked. */
function walkList() {
  return walk.checked.filter((i) => walk.includeResolved || statusOf(walk.changes.get(i.id)?.from ?? i.status).key === 'open');
}

/**
 * Opens the walk over the open comments a run checked, in report order, after loading their new images.
 * @param {{checked: string[], failed: string[], page: string}} run The finished run record.
 */
async function showWalk(run) {
  const stored = await issuesInGroup(groupId);
  const fresh = new Map((await hydrate(stored.filter((issue) => run.checked.includes(issue.id)))).map((issue) => [issue.id, issue]));
  const statuses = new Map(stored.map((issue) => [issue.id, issue.status]));
  for (const issue of issues) {
    const saved = fresh.get(issue.id);
    if (saved) Object.assign(issue, { after: saved.after, checkedAt: saved.checkedAt, change: saved.change });
    if (statuses.has(issue.id)) issue.status = statuses.get(issue.id);
  }
  refreshPreview();
  walk = { checked: ordered.filter((issue) => run.checked.includes(issue.id)), includeResolved: false, changes: new Map(), at: 0, run };
  walk.list = walkList();
  paintWalk();
}

/**
 * Sets one comment's status and records it in the walk's list of changes.
 * @param {object} issue The comment.
 * @param {string} status The status key.
 */
async function setStatus(issue, status) {
  const from = walk.changes.get(issue.id)?.from ?? statusOf(issue.status).key;
  await send('update', { id: issue.id, patch: { status } });
  issue.status = status;
  verifyChanged = true;
  if (from === status) walk.changes.delete(issue.id);
  else walk.changes.set(issue.id, { issue, from, to: status });
}

/**
 * Saves the status picked for the comment on screen and moves on. Only the reviewer sets a status.
 * @param {string} status The picked status key.
 */
async function pickStatus(status) {
  await setStatus(walk.list[walk.at], status);
  walk.at += 1;
  paintWalk();
}

/**
 * Steps the walk forward or back, stopping at the first comment and at the summary.
 * @param {number} step 1 for the next comment, -1 for the one before.
 */
function moveWalk(step) {
  walk.at = Math.max(0, Math.min(walk.list.length, walk.at + step));
  paintWalk();
}

/**
 * Starts a recheck run on the open page.
 * @param {string[]} [ids] Only these comments, as when checking the ones a stopped run missed.
 */
async function startVerify(ids) {
  const button = document.querySelector('[data-verify]');
  button.disabled = true;
  const res = await send('verifyStart', { groupId, ids });
  button.disabled = !issues.length;
  if (res?.error === 'noTab') return showNoTab();
  if (res?.error) {
    if (verifyDialog.open) verifyState.textContent = res.error;
    else toast(res.error === 'A check is already running' ? 'A recheck is already running' : `Recheck failed. ${res.error}`);
    return;
  }
  awaitingRun = true;
  showProgress({ done: 0, total: res.total, page: lastRun?.page ?? '' });
}

document.querySelector('[data-verify]').addEventListener('click', () => startVerify());

verifyDialog.addEventListener('click', async (event) => {
  const pick = event.target.closest('[data-verify-pick]');
  if (pick) return pickStatus(pick.dataset.verifyPick);
  const move = event.target.closest('[data-verify-move]');
  if (move && walk) return moveWalk(Number(move.dataset.verifyMove));
  const undo = event.target.closest('[data-verify-undo]');
  if (undo && walk) {
    const change = walk.changes.get(undo.dataset.verifyUndo);
    if (change) await setStatus(change.issue, change.from);
    return paintWalk();
  }
  if (event.target.closest('[data-verify-cancel]')) {
    verifyState.textContent = 'Stopping after this capture';
    return send('verifyCancel');
  }
  if (event.target.closest('[data-verify-rest]')) {
    const missed = ordered.filter((i) => samePage(i.page?.url, lastRun.page) && !lastRun.checked.includes(i.id) && !lastRun.failed.includes(i.id));
    return startVerify(missed.map((i) => i.id));
  }
  if (event.target.closest('[data-verify-review]')) return showWalk(lastRun);
  if (event.target.closest('[data-verify-close]')) verifyDialog.close();
});

verifyDialog.addEventListener('change', (event) => {
  if (!event.target.matches('[data-verify-resolved]') || !walk) return;
  walk.includeResolved = event.target.checked;
  walk.list = walkList();
  walk.at = 0;
  paintWalk();
});

verifyDialog.addEventListener('cancel', (event) => {
  if (!awaitingRun) return;
  event.preventDefault();
  verifyState.textContent = 'Stopping after this capture';
  send('verifyCancel');
});

document.addEventListener('keydown', (event) => {
  if (!walk || !verifyDialog.open || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input, textarea, select')) return;
  const key = event.key.toLowerCase();
  if (VERIFY_KEYS[key] && walk.at < walk.list.length) {
    event.preventDefault();
    pickStatus(VERIFY_KEYS[key]);
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    moveWalk(event.key === 'ArrowRight' ? 1 : -1);
  }
});

verifyDialog.addEventListener('close', () => {
  walk = null;
  if (!verifyChanged) return;
  verifyChanged = false;
  rerender();
});

chrome.storage.onChanged.addListener((changes, area) => {
  const run = area === 'local' ? changes.verifyRun?.newValue : null;
  if (!run || !awaitingRun) return;
  if (run.state === 'running') return showProgress(run);
  awaitingRun = false;
  lastRun = run;
  if (run.state === 'cancelled' && run.done < run.total) showStopped(run);
  else showWalk(run);
});

renderSidebar();
paintEnabled();
frame.srcdoc = previewDoc();

if (opened.searchParams.get('verify')) {
  opened.searchParams.delete('verify');
  history.replaceState(null, '', opened);
  const { verifyRun: run } = await chrome.storage.local.get('verifyRun');
  if (run?.state === 'running' && Date.now() - run.at < STALE_RUN_MS) {
    awaitingRun = true;
    showProgress(run);
  } else if (run && run.state !== 'running' && run.groupId === groupId) {
    lastRun = run;
    showWalk(run);
  }
}
