import { issuesInGroup, readRaw } from './lib/store.js';
import {
  buildReport,
  renderBody,
  wireFilters,
  sortIssues,
  REPORT_CSS,
  PREVIEW_DARK_CSS,
} from './lib/report-template.js';
import { buildDocsHtml, buildDocsText } from './lib/docs-template.js';
import { buildMarkdown, commentHtml, commentMarkdown } from './lib/share-template.js';
import { buildReviewFile } from './lib/review-file.js';
import { SEVERITIES, severityOf } from './lib/severity.js';
import { FACT_FIELDS, withDefaults } from './lib/fields.js';
import { openEditor } from './editor.js';
import { startTour, tourOnce } from './lib/tour.js';

const send = (type, payload = {}) => chrome.runtime.sendMessage({ type, ...payload });
const frame = document.querySelector('[data-preview]');
const pad = (n) => String(n).padStart(2, '0');

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

const PREVIEW_EDIT_CSS = `
.issue figure { position: relative; }
.issue figure img:not(.after) { cursor: crosshair; }
.issue figure img:not(.after):hover { outline: 2px solid var(--accent); outline-offset: 2px; }
.quick-bar {
  position: absolute; top: 8px; right: 8px; display: flex; gap: 8px; align-items: center;
  padding: 4px 4px 4px 10px; font-size: 12px; color: var(--ink-2);
  background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
  opacity: 0; transition: opacity 120ms ease-out;
}
.issue figure:hover .quick-bar, .quick-bar:focus-within { opacity: 1; }
.quick-bar button {
  padding: 4px 10px; font: inherit; font-weight: 600; color: var(--ink); cursor: pointer;
  background: var(--surface); border: 1px solid var(--line); border-radius: 6px;
}
ol.marks .li-actions { display: inline-flex; gap: 6px; margin-left: 8px; opacity: 0; transition: opacity 120ms ease-out; }
ol.marks li:hover .li-actions, ol.marks .li-actions:focus-within { opacity: 1; }
ol.marks .li-actions button {
  padding: 1px 8px; font: inherit; font-size: 11px; font-weight: 600; color: var(--ink-2); cursor: pointer;
  background: transparent; border: 1px solid var(--line); border-radius: 6px;
}
ol.marks .li-actions button:hover { color: var(--ink); background: var(--surface); }
.issue header .card-copy {
  padding: 1px 8px; font: inherit; font-size: 11px; font-weight: 600; color: var(--ink-2); cursor: pointer;
  background: transparent; border: 1px solid var(--line); border-radius: 6px;
  opacity: 0; transition: opacity 120ms ease-out;
}
.issue:hover header .card-copy, .issue header .card-copy:focus-visible { opacity: 1; }
.issue header .card-copy:hover { color: var(--ink); background: var(--surface); }
@media (prefers-reduced-motion: reduce) { .quick-bar, ol.marks .li-actions, .issue header .card-copy { transition: none; } }
@media print { .quick-bar, ol.marks .li-actions, .issue header .card-copy { display: none; } }
`;

/**
 * The preview keeps the dark palette and leaves out the filter script, which
 * extension page CSP would block. Exported files are light and self wiring.
 */
function previewDoc(issues, options) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><style>${REPORT_CSS}${PREVIEW_DARK_CSS}${PREVIEW_EDIT_CSS}</style></head><body>${renderBody(issues, options)}</body></html>`;
}

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

/* Group context ---------------------------------------------------------- */

const groupEl = document.querySelector('[data-group]');
const wanted = new URL(location.href).searchParams.get('group');
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
groupEl.addEventListener('change', () => {
  location.search = `?group=${groupEl.value}`;
});

document.querySelector('[data-rename-group]').addEventListener('click', async () => {
  if (!group) return;
  const name = prompt('Rename this group', group.name);
  if (name === null || !name.trim()) return;
  await send('groupRename', { id: group.id, name: name.trim() });
  location.reload();
});

document.querySelector('[data-new-group]').addEventListener('click', async () => {
  const name = prompt('Name the new review', `Review ${new Date().toLocaleDateString()}`);
  if (name === null) return;
  const res = await send('groupCreate', { name });
  location.search = `?group=${res.group.id}`;
});

/* Report ----------------------------------------------------------------- */

const issues = await issuesInGroup(groupId);
const ordered = sortIssues(issues);
const generatedAt = new Date();
const hosts = hostsOf(issues);
const title = group?.name ?? (hosts.length === 1 ? `UI issue report, ${hosts[0]}` : 'UI issue report');

const shotsEl = document.querySelector('[data-shots]');
const shots = (await chrome.storage.local.get('shotMode')).shotMode ?? 'both';
shotsEl.value = shots;
shotsEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ shotMode: shotsEl.value });
  location.reload();
});

const fields = withDefaults((await chrome.storage.local.get('fields')).fields);

const options = { title, generatedAt, shots, fields };
const docsOptions = {
  generatedAt,
  shots,
  fields,
  title: group?.name ?? (hosts.length === 1 ? `${hosts[0]} comments` : 'UI review comments'),
  group,
};
const slug = (group?.name ?? hosts[0] ?? 'report').replace(/[^a-z0-9.]+/gi, '-').toLowerCase();
const basename = `ui-issues-${slug}-${stamp(generatedAt)}`;

document.title = title;
frame.addEventListener('load', () => wireFilters(frame.contentDocument));
frame.srcdoc = previewDoc(issues, options);

/* Sidebar index ---------------------------------------------------------- */

const indexEl = document.querySelector('[data-index]');
const filtersEl = document.querySelector('[data-filters]');
const findEl = document.querySelector('[data-find]');
let filter = 'all';

const counts = Object.fromEntries(
  SEVERITIES.map((s) => [s.key, ordered.filter((i) => severityOf(i.severity).key === s.key).length]),
);

filtersEl.innerHTML = [
  `<button class="filter-btn" type="button" data-filter="all" aria-pressed="true">All ${ordered.length}</button>`,
  ...SEVERITIES.filter((s) => counts[s.key] > 0).map(
    (s) => `<button class="filter-btn" type="button" data-filter="${s.key}" aria-pressed="false">${s.label} ${counts[s.key]}</button>`,
  ),
].join('');

indexEl.innerHTML = ordered.length
  ? ordered
      .map((issue, index) => {
        const sev = severityOf(issue.severity);
        return `<button class="index-row${issue.jira?.key ? ' linked' : ''}" type="button" data-jump="${index + 1}" data-sev="${sev.key}"
            data-text="${escapeText(`${issue.title ?? ''} ${issue.note ?? ''} ${issue.element?.selector ?? ''} ${hostOf(issue.page?.url)}`.toLowerCase())}">
          <span class="n">${pad(index + 1)}</span>
          <span class="dot"></span>
          <span class="label">
            <b data-key="${escapeText(issue.jira?.key ?? '')}">${escapeText(issue.title || 'Untitled comment')}</b>
            <span>${escapeText(hostOf(issue.page?.url))}</span>
          </span>
        </button>`;
      })
      .join('')
  : '<p class="index-empty">No comments in this review</p>';

const rows = [...indexEl.querySelectorAll('[data-jump]')];

/** Keeps the sidebar list and the rendered report showing the same subset. */
function applyFilter() {
  const term = findEl.value.trim().toLowerCase();
  let shown = 0;
  for (const row of rows) {
    const bySeverity = filter === 'all' || row.dataset.sev === filter;
    const byText = !term || row.dataset.text.includes(term);
    const visible = bySeverity && byText;
    row.hidden = !visible;
    if (visible) shown += 1;
    const card = frame.contentDocument?.getElementById(`c-${row.dataset.jump}`);
    if (card) card.classList.toggle('hide', !visible);
  }
  document.querySelector('[data-index-foot]').textContent =
    shown === ordered.length ? `${ordered.length} comments` : `${shown} of ${ordered.length} comments`;
}

filtersEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  filter = button.dataset.filter;
  filtersEl.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  applyFilter();
});

findEl.addEventListener('input', applyFilter);

indexEl.addEventListener('click', (event) => {
  const row = event.target.closest('[data-jump]');
  if (!row) return;
  rows.forEach((r) => r.setAttribute('aria-current', String(r === row)));
  frame.contentDocument?.getElementById(`c-${row.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

frame.addEventListener('load', applyFilter);
let previewScroll = 0;

/** Redraws the preview from the comments in memory, keeping its scroll position. */
function refreshPreview() {
  previewScroll = frame.contentWindow?.scrollY ?? 0;
  frame.srcdoc = previewDoc(issues, options);
}

/**
 * The comment a preview screenshot belongs to, with its position in the report.
 * @param {HTMLImageElement} img A screenshot inside the preview.
 */
function issueOfShot(img) {
  const index = Number(img.closest('.issue').id.slice(2)) - 1;
  return { issue: ordered[index], index };
}

const notePop = Object.assign(document.createElement('div'), { className: 'menu-body ctx-menu quick-note', hidden: true });
document.body.append(notePop);
let pendingNote = null;

/**
 * Shows a small box at a point in this page, kept inside the window.
 * @param {{x:number,y:number}} at Where it opens, in this page's coordinates.
 * @param {string} html Its contents.
 */
function openPop(at, html) {
  notePop.innerHTML = html;
  notePop.hidden = false;
  notePop.style.left = `${Math.max(8, Math.min(at.x, innerWidth - notePop.offsetWidth - 8))}px`;
  notePop.style.top = `${Math.max(8, Math.min(at.y + 14, innerHeight - notePop.offsetHeight - 8))}px`;
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
 * @param {{x:number,y:number}} at Where to open the box, in this page's coordinates.
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
    await dropMark(issue, index);
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
  const { issue } = issueOfShot(img);
  if (!issue?.shot) return;
  await closeNote();
  const box = img.getBoundingClientRect();
  const outer = frame.getBoundingClientRect();
  const at = { x: outer.left + event.clientX, y: outer.top + event.clientY };
  const res = await send('quickMark', {
    id: issue.id,
    action,
    image: img.closest('figure.wide') ? 'shot' : 'detail',
    fx: (event.clientX - box.left) / box.width,
    fy: (event.clientY - box.top) / box.height,
    aspect: img.naturalWidth / img.naturalHeight,
    reach: 18 / box.width,
  });
  if (res?.error) {
    openPop(at, `<span class="menu-label">${escapeText(res.error)}</span>`);
    return;
  }
  if (res.index === null && !res.stale) return;
  applyMarks(issue, res);
  if (res.stale) openPop(at, '<span class="menu-label">The image was redrawn with the current crop. Click again to place the marker.</span>');
  else if (action === 'add') askNote(issue, res.index, at, true);
}

/**
 * Adds Edit and Remove buttons to each numbered note under a comment in the preview.
 * @param {Document} doc The preview document.
 */
function wireNoteList(doc) {
  doc.querySelectorAll('.issue ol.marks li').forEach((li) => {
    const issue = ordered[Number(li.closest('.issue').id.slice(2)) - 1];
    const index = li.value - 1;
    const actions = doc.createElement('span');
    actions.className = 'li-actions';
    actions.innerHTML = '<button type="button" data-edit-note>Edit</button><button type="button" data-remove-note>Remove</button>';
    li.append(actions);
    actions.querySelector('[data-edit-note]').addEventListener('click', (event) => {
      if (pendingNote) return closeNote();
      const outer = frame.getBoundingClientRect();
      askNote(issue, index, { x: outer.left + event.clientX, y: outer.top + event.clientY }, false);
    });
    actions.querySelector('[data-remove-note]').addEventListener('click', async () => {
      await dropMark(issue, index);
    });
  });
}

frame.addEventListener('load', () => {
  const doc = frame.contentDocument;
  if (previewScroll) frame.contentWindow.scrollTo(0, previewScroll);
  doc.querySelectorAll('.issue figure img:not(.after)').forEach((img) => {
    if (!issueOfShot(img).issue?.shot) return;
    const bar = doc.createElement('div');
    bar.className = 'quick-bar';
    bar.innerHTML = '<span>Click to add a marker. Right-click one to remove it.</span><button type="button" data-open-editor>Open editor</button>';
    img.closest('figure').append(bar);
  });
  doc.querySelectorAll('.issue header').forEach((header) => {
    const copy = doc.createElement('button');
    copy.type = 'button';
    copy.className = 'card-copy';
    copy.textContent = 'Copy';
    copy.title = 'Copy this comment for Slack, Jira, GitHub or a doc';
    header.querySelector('.chip')?.before(copy);
  });
  doc.addEventListener('click', (event) => {
    const copy = event.target.closest?.('.card-copy');
    if (copy) {
      const issue = ordered[Number(copy.closest('.issue').id.slice(2)) - 1];
      copyOut(copy, commentMarkdown(issue, { fields }), commentHtml(issue, fields));
      return;
    }
    const open = event.target.closest?.('[data-open-editor]');
    if (open) {
      const { issue, index } = issueOfShot(open.closest('figure').querySelector('img'));
      editImage(issue, index);
      return;
    }
    const img = event.target.closest?.('.issue figure img:not(.after)');
    if (img) quickMark(img, event, 'add');
  });
  doc.addEventListener('contextmenu', (event) => {
    const img = event.target.closest?.('.issue figure img:not(.after)');
    if (!img) return;
    event.preventDefault();
    quickMark(img, event, 'remove');
  });
  doc.addEventListener('pointerdown', (event) => {
    if (!event.target.closest?.('.li-actions')) closeNote();
  });
  wireNoteList(doc);
});
frame.addEventListener('load', () => tourOnce('report', REPORT_TOUR), { once: true });

/** Measures the first editable screenshot inside the preview, in this page's coordinates. */
function firstPreviewShot() {
  const shot = frame.contentDocument?.querySelector('.issue figure img:not(.after)');
  if (!shot) return null;
  shot.scrollIntoView({ block: 'nearest' });
  const inner = shot.getBoundingClientRect();
  const outer = frame.getBoundingClientRect();
  const top = Math.max(outer.top, outer.top + inner.top);
  const bottom = Math.min(outer.bottom, outer.top + inner.bottom);
  return new DOMRect(outer.left + inner.left, top, inner.width, Math.max(0, bottom - top));
}

const REPORT_TOUR = [
  { target: '[data-group]', title: 'One review per round', body: 'Each review holds one round of comments. Switch, rename or start a new one here.' },
  { target: '.sidebar', title: 'Every comment', body: 'Sorted by severity. Filter or search to jump to one in the report.' },
  { target: firstPreviewShot, title: 'Number the details', body: 'Click any screenshot to open the image editor and add numbered markers, boxes and arrows.' },
  { target: '[data-edit]', title: 'Tidy the wording', body: 'Fix titles, notes and severity for every comment in one place.' },
  { target: '[data-copy]', title: 'Hand it over', body: 'Paste the whole review into Google Docs. Numbered notes stay numbered.' },
  { target: '.menu > summary', title: 'More ways out', body: 'Word, HTML and Markdown, review files to share, which fields to show, printing, and this tour again.' },
];

document.querySelector('[data-tour]').addEventListener('click', () => {
  document.querySelector('.menu').open = false;
  startTour('report', REPORT_TOUR);
});
document.querySelector('[data-help]').addEventListener('click', () => chrome.runtime.openOptionsPage());

/* Exports ---------------------------------------------------------------- */

document.querySelector('[data-download]').addEventListener('click', () => {
  saveBlob(new Blob([buildReport(issues, options)], { type: 'text/html' }), `${basename}.html`);
});

document.querySelector('[data-doc]').addEventListener('click', () => {
  saveBlob(new Blob([buildDocsHtml(issues, docsOptions)], { type: 'application/msword' }), `${basename}.doc`);
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
 * Puts text, and optionally rich text, on the clipboard and confirms on the button pressed.
 * @param {HTMLElement} button The button to confirm on.
 * @param {string} plain The plain text flavour.
 * @param {string} [html] The rich text flavour.
 */
async function copyOut(button, plain, html) {
  try {
    const flavours = { 'text/plain': new Blob([plain], { type: 'text/plain' }) };
    if (html) flavours['text/html'] = new Blob([html], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(flavours)]);
    flash(button, 'Copied');
  } catch {
    flash(button, 'Copy failed');
  }
}

document.querySelector('[data-markdown]').addEventListener('click', (event) => {
  copyOut(event.currentTarget, buildMarkdown(issues, { title: docsOptions.title, fields }));
});

document.querySelector('[data-save-review]').addEventListener('click', async () => {
  const raws = Object.fromEntries(await Promise.all(issues.map(async (issue) => [issue.id, await readRaw(issue.id)])));
  saveBlob(new Blob([buildReviewFile(group ?? { name: title }, issues, raws)], { type: 'application/json' }), `${basename}.margin.json`);
});

const reviewInput = document.querySelector('[data-review-input]');
document.querySelector('[data-open-review]').addEventListener('click', () => reviewInput.click());
reviewInput.addEventListener('change', async () => {
  const file = reviewInput.files?.[0];
  reviewInput.value = '';
  if (!file) return;
  const res = await send('importReview', { contents: await file.text() });
  if (res?.error) {
    alert(res.error);
    return;
  }
  location.search = `?group=${res.group.id}`;
});

document.querySelector('[data-recrop]').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.textContent = 'Recutting';
  button.disabled = true;
  const res = await send('recropGroup', { groupId });
  if (res?.error) {
    button.textContent = 'Failed';
    button.title = res.error;
    button.disabled = false;
    return;
  }
  location.reload();
});

/* Fields shown ----------------------------------------------------------- */

const fieldsDialog = document.querySelector('[data-fields-dialog]');
const fieldsBody = document.querySelector('[data-fields-body]');

document.querySelector('[data-fields]').addEventListener('click', () => {
  fieldsBody.innerHTML = FACT_FIELDS.map(
    (f) => `<label class="row">
      <input type="checkbox" data-field-key="${f.key}"${fields[f.key] ? ' checked' : ''} />
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
  await chrome.storage.local.set({ fields: next });
  location.reload();
});

/* Comment editor --------------------------------------------------------- */

const editDialog = document.querySelector('[data-edit-dialog]');
const editBody = document.querySelector('[data-edit-body]');

let imagesChanged = false;

/**
 * Opens the image editor for a comment. Each save redraws the preview behind it, and when the
 * comment editor is open the row thumbnail updates too, so staged edits there survive.
 * @param {object} issue The stored comment.
 * @param {number} index Its position in the report.
 */
function editImage(issue, index) {
  openEditor(issue, {
    send,
    label: `Edit image, comment ${pad(index + 1)}`,
    onChange: (saved) => {
      refreshPreview();
      if (!editDialog.open) return;
      imagesChanged = true;
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

/** One editable comment: severity, title and note, with its page for context. */
function editRow(issue, index) {
  const row = document.createElement('div');
  row.className = 'edit-row';
  row.innerHTML = `
    <span class="n">${pad(index + 1)}</span>
    <select data-field="severity">
      ${SEVERITIES.map((s) => `<option value="${s.key}">${s.label}</option>`).join('')}
    </select>
    <span class="stack">
      <input type="text" data-field="title" placeholder="What is wrong" />
      <textarea data-field="note" placeholder="Expected, actual, steps"></textarea>
      <input type="text" data-field="links" placeholder="Figma links, optional" />
      <span class="where"></span>
      ${
        issue.shot
          ? `<span class="marks">
        <img data-marks-img alt="Marked region. Click to edit the image." />
        <span class="row">
          <span class="hint" data-marks-count></span>
          <button class="btn sm" type="button" data-edit-image>Edit image</button>
        </span>
      </span>`
          : ''
      }
    </span>
    <button class="icon-btn danger" type="button" data-remove title="Delete this comment" aria-label="Delete this comment">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5h4v2M8 7l1 12h6l1-12" /></svg>
    </button>
  `;
  row.querySelector('[data-field="severity"]').value = severityOf(issue.severity).key;
  row.querySelector('[data-field="title"]').value = issue.title ?? '';
  row.querySelector('[data-field="note"]').value = issue.note ?? '';
  row.querySelector('[data-field="links"]').value = (issue.links ?? []).join(' ');
  row.querySelector('.where').textContent = [issue.jira?.key, issue.element?.selector, issue.page?.url]
    .filter(Boolean)
    .join('  ');
  row.dataset.id = issue.id;
  if (issue.shot) {
    paintThumb(row, issue);
    const open = () => row.dataset.remove !== 'true' && editImage(issue, index);
    row.querySelector('[data-marks-img]').addEventListener('click', open);
    row.querySelector('[data-edit-image]').addEventListener('click', open);
  }

  // Deletions are staged, so a misclick can be undone before saving.
  row.querySelector('[data-remove]').addEventListener('click', () => {
    const removing = row.dataset.remove === 'true';
    row.dataset.remove = String(!removing);
    row.classList.toggle('removing', !removing);
    row.querySelectorAll('input, textarea, select').forEach((el) => {
      el.disabled = !removing;
    });
  });
  return row;
}

document.querySelector('[data-edit]').addEventListener('click', () => {
  editBody.innerHTML = '';
  ordered.forEach((issue, index) => editBody.append(editRow(issue, index)));
  document.querySelector('[data-edit-count]').textContent = `${issues.length} comments`;
  document.querySelector('[data-edit-note]').textContent =
    'Edits apply to the report and exports. Image edits save from the image editor.';
  editDialog.showModal();
});

document.querySelector('[data-edit-cancel]').addEventListener('click', () => editDialog.close());
editDialog.addEventListener('close', () => {
  if (imagesChanged) location.reload();
});

document.querySelector('[data-edit-save]').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Saving';
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  for (const row of editBody.querySelectorAll('.edit-row')) {
    const issue = byId.get(row.dataset.id);
    if (row.dataset.remove === 'true') {
      await send('discard', { id: issue.id });
      continue;
    }
    const links = row
      .querySelector('[data-field="links"]')
      .value.split(/[\s,]+/)
      .filter((part) => /^https?:\/\//i.test(part));
    const patch = {
      severity: row.querySelector('[data-field="severity"]').value,
      title: row.querySelector('[data-field="title"]').value.trim(),
      note: row.querySelector('[data-field="note"]').value.trim(),
      links,
    };
    const changed =
      links.join(' ') !== (issue.links ?? []).join(' ') ||
      ['severity', 'title', 'note'].some((key) => (issue[key] ?? '') !== patch[key]);
    if (changed) await send('update', { id: issue.id, patch });
  }
  location.reload();
});
