import {
  addIssue,
  patchIssue,
  removeIssue,
  readIssues,
  readGroups,
  addGroup,
  patchGroup,
  removeGroup,
  setActiveGroup,
  activeGroup,
  issuesInGroup,
  readRaw,
  writeRaw,
} from './lib/store.js';

const HIGHLIGHT = '#e5484d';
const MAX_SHOT_WIDTH = 1400;
const MAX_DETAIL_WIDTH = 900;
const MAX_RAW_WIDTH = 2400;
const DETAIL_PADDING = 72;
const MIN_DETAIL_WIDTH = 640;
const MIN_DETAIL_HEIGHT = 360;

/**
 * Injects the content script if the tab does not already have it, then tells it
 * to toggle annotation mode. Returns the resulting active flag.
 */
async function toggleTab(tab) {
  if (!tab || !tab.id) return false;
  await ensureContent(tab);
  const res = await chrome.tabs.sendMessage(tab.id, {
    type: 'toggle',
    groupName: (await activeGroup()).name,
  });
  return res?.active === true;
}

/**
 * Injects the content script into a tab unless it is already there.
 * @param {chrome.tabs.Tab} tab The tab to prepare.
 */
async function ensureContent(tab) {
  if (/^(chrome|edge|about|devtools):|^https:\/\/chrome\.google\.com\/webstore/.test(tab.url ?? '')) {
    throw new Error('This page does not allow extensions to run.');
  }
  let ready = false;
  try {
    ready = (await chrome.tabs.sendMessage(tab.id, { type: 'ping' }))?.ok === true;
  } catch {
    ready = false;
  }
  if (!ready) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  }
}

const MENU_CONTEXTS = ['page', 'selection', 'link', 'image', 'video', 'audio', 'editable', 'frame'];

/** Adds Margin's items to Chrome's right-click menu, replacing any left from an earlier run. */
async function createMenus() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'margin-toggle', title: 'Start or stop annotating', contexts: MENU_CONTEXTS });
  chrome.contextMenus.create({ id: 'margin-viewport', title: 'Comment on the whole visible area', contexts: MENU_CONTEXTS });
  chrome.contextMenus.create({ id: 'margin-report', title: 'Open the review report', contexts: MENU_CONTEXTS });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'margin-toggle') await toggleTab(tab);
    else if (info.menuItemId === 'margin-report') await handlers.openReport();
    else if (info.menuItemId === 'margin-viewport' && tab?.id) {
      await ensureContent(tab);
      await chrome.tabs.sendMessage(tab.id, { type: 'captureViewport', groupName: (await activeGroup()).name });
    }
  } catch {}
});

/** Turns a Blob into a data URL without FileReader, which keeps this worker-safe. */
async function toDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

/**
 * Draws the numbered annotations, shapes first and then a numbered disc for each, in list order.
 * Boxes carry their number on the top left corner, arrows on their tail.
 * @param {OffscreenCanvasRenderingContext2D} ctx The canvas to draw on.
 * @param {object[]} marks Annotations with every coordinate already in canvas pixels.
 */
function drawMarks(ctx, marks) {
  const r = Math.round(Math.min(16, Math.max(10, ctx.canvas.width / 70)));
  const line = Math.max(2, Math.round(ctx.canvas.width / 600));
  const haloed = (trace) => {
    ctx.lineWidth = line + 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    trace();
    ctx.stroke();
    ctx.lineWidth = line;
    ctx.strokeStyle = HIGHLIGHT;
    trace();
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of marks) {
    if (m.kind === 'box') {
      haloed(() => {
        ctx.beginPath();
        ctx.rect(m.x, m.y, m.w, m.h);
      });
    } else if (m.kind === 'arrow') {
      const angle = Math.atan2(m.y2 - m.y, m.x2 - m.x);
      const head = r * 1.2;
      haloed(() => {
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x2, m.y2);
        ctx.moveTo(m.x2 - head * Math.cos(angle - 0.45), m.y2 - head * Math.sin(angle - 0.45));
        ctx.lineTo(m.x2, m.y2);
        ctx.lineTo(m.x2 - head * Math.cos(angle + 0.45), m.y2 - head * Math.sin(angle + 0.45));
      });
    }
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(r * 1.15)}px Manrope, "Segoe UI", sans-serif`;
  marks.forEach((m, i) => {
    ctx.beginPath();
    ctx.arc(m.x, m.y, r + 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.fillStyle = HIGHLIGHT;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(i + 1), m.x, m.y + 1);
  });
}

/**
 * Draws a region of the screenshot with the annotated box outlined on top.
 * @param {ImageBitmap} bitmap The source screenshot.
 * @param {{x:number,y:number,w:number,h:number}} src The part of the bitmap to draw, in bitmap pixels.
 * @param {{x:number,y:number,w:number,h:number}} box The marked region, in bitmap pixels.
 * @param {number} maxWidth The widest the output image may be.
 * @param {object[]} [marks] Numbered annotations, in viewport CSS pixels.
 * @param {number} [scale] Bitmap pixels per viewport CSS pixel.
 */
async function drawRegion(bitmap, src, box, maxWidth, marks = [], scale = 1) {
  const factor = Math.min(1, maxWidth / src.w);
  const canvas = new OffscreenCanvas(Math.round(src.w * factor), Math.round(src.h * factor));
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, src.x, src.y, src.w, src.h, 0, 0, canvas.width, canvas.height);

  const x = (box.x - src.x) * factor;
  const y = (box.y - src.y) * factor;
  const w = box.w * factor;
  const h = box.h * factor;
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  ctx.lineWidth = 2;
  ctx.strokeStyle = HIGHLIGHT;
  ctx.strokeRect(x, y, w, h);

  const px = (v) => (v * scale - src.x) * factor;
  const py = (v) => (v * scale - src.y) * factor;
  drawMarks(
    ctx,
    marks.map((m) => ({
      kind: m.kind,
      x: px(m.x),
      y: py(m.y),
      w: (m.w ?? 0) * scale * factor,
      h: (m.h ?? 0) * scale * factor,
      x2: px(m.x2 ?? m.x),
      y2: py(m.y2 ?? m.y),
    })),
  );

  return toDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }));
}

/**
 * Draws both stored images for a comment from a screenshot: the whole viewport for
 * context, and a padded crop of the marked region for detail, each with the region and annotations.
 * @param {ImageBitmap} bitmap The screenshot to draw from.
 * @param {{rect: object, viewport: {width: number}, marks?: object[]}} issue The comment's region, viewport and annotations.
 */
async function renderImages(bitmap, issue) {
  const scale = bitmap.width / issue.viewport.width;
  const { box, crop } = cropAround(bitmap, issue.rect, scale);
  const marks = issue.marks ?? [];
  const full = { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
  return {
    shot: await drawRegion(bitmap, full, box, MAX_SHOT_WIDTH, marks, scale),
    detail: await drawRegion(bitmap, crop, box, MAX_DETAIL_WIDTH, marks, scale),
  };
}

/**
 * Encodes the untouched screenshot so the images can be redrawn later with a moved region or new annotations.
 * @param {ImageBitmap} bitmap The captured screenshot.
 */
async function encodeRaw(bitmap) {
  const factor = Math.min(1, MAX_RAW_WIDTH / bitmap.width);
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * factor), Math.round(bitmap.height * factor));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return toDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }));
}

const decode = async (src) => createImageBitmap(await (await fetch(src)).blob());

/**
 * Grabs the visible tab and returns the clean screenshot plus the two annotated images.
 * @param {chrome.tabs.Tab} tab The tab to capture.
 * @param {{rect: object, viewport: {width: number}}} issue The region and viewport being captured.
 */
async function captureShots(tab, issue) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: 'jpeg',
    quality: 92,
  });
  const bitmap = await decode(dataUrl);
  const images = await renderImages(bitmap, issue);
  const raw = await encodeRaw(bitmap);
  bitmap.close();
  return { raw, ...images };
}

/** Works out the padded crop around a marked region, in image pixels. */
function cropAround(bitmap, rect, scale) {
  const box = { x: rect.x * scale, y: rect.y * scale, w: rect.w * scale, h: rect.h * scale };
  const padX = Math.max(DETAIL_PADDING, (MIN_DETAIL_WIDTH - rect.w) / 2) * scale;
  const padY = Math.max(DETAIL_PADDING, (MIN_DETAIL_HEIGHT - rect.h) / 2) * scale;
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  return {
    box,
    crop: {
      x,
      y,
      w: Math.min(bitmap.width - x, box.w + padX * 2),
      h: Math.min(bitmap.height - y, box.h + padY * 2),
    },
  };
}

/**
 * Loads the screenshot a comment is redrawn from. Comments captured before clean
 * screenshots were kept fall back to their viewport image, copied once so it is never re-encoded twice.
 * @param {object} issue The stored comment.
 */
async function baseFor(issue) {
  const stored = await readRaw(issue.id);
  if (stored || !issue.shot) return stored;
  const raw = { src: issue.shot, hasBox: true };
  await writeRaw(issue.id, raw);
  return raw;
}

/**
 * Redraws both images of a comment from its base screenshot.
 * @param {object} issue The comment, with the region and annotations to draw.
 */
async function rerender(issue) {
  const raw = await baseFor(issue);
  if (!raw) return null;
  const bitmap = await decode(raw.src);
  const images = await renderImages(bitmap, issue);
  bitmap.close();
  return images;
}

const MARK_KINDS = ['dot', 'box', 'arrow'];

/**
 * Keeps only well formed annotations from the editor, rounded to whole pixels.
 * @param {unknown} marks The annotations the editor sent.
 */
function cleanMarks(marks) {
  if (!Array.isArray(marks)) return [];
  const n = (v) => Math.round(Number(v) || 0);
  return marks
    .filter((m) => MARK_KINDS.includes(m?.kind))
    .map((m) => {
      const note = String(m.note ?? '').slice(0, 2000);
      if (m.kind === 'box') return { kind: 'box', x: n(m.x), y: n(m.y), w: Math.max(4, n(m.w)), h: Math.max(4, n(m.h)), note };
      if (m.kind === 'arrow') return { kind: 'arrow', x: n(m.x), y: n(m.y), x2: n(m.x2), y2: n(m.y2), note };
      return { kind: 'dot', x: n(m.x), y: n(m.y), note };
    });
}

/**
 * Rounds an edited region and keeps it inside the viewport.
 * @param {{x:number,y:number,w:number,h:number}} rect The region the editor sent.
 * @param {{width:number,height:number}} viewport The viewport it was captured in.
 */
function cleanRect(rect, viewport) {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  return {
    x,
    y,
    w: Math.max(4, Math.min(Math.round(rect.w), viewport.width - x)),
    h: Math.max(4, Math.min(Math.round(rect.h), viewport.height - y)),
  };
}

/** Keeps the toolbar badge in step with the stored issue count. */
async function refreshBadge() {
  const count = (await readIssues()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#1f2937' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

const handlers = {
  async toggle(_msg, sender) {
    const tab = sender.tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return { active: await toggleTab(tab) };
  },

  async capture(msg, sender) {
    const { raw, shot, detail } = await captureShots(sender.tab, msg);
    const issue = {
      id: crypto.randomUUID(),
      groupId: (await activeGroup()).id,
      createdAt: new Date().toISOString(),
      severity: 'major',
      title: '',
      note: '',
      page: { url: sender.tab.url, title: sender.tab.title ?? '' },
      viewport: msg.viewport,
      element: msg.element,
      rect: msg.rect,
      shot,
      detail,
    };
    await writeRaw(issue.id, { src: raw, hasBox: false });
    await addIssue(issue);
    await refreshBadge();
    return { id: issue.id };
  },

  async update(msg) {
    await patchIssue(msg.id, msg.patch);
    return { ok: true };
  },

  async discard(msg) {
    await removeIssue(msg.id);
    await refreshBadge();
    return { ok: true };
  },

  async openReport() {
    await chrome.tabs.create({ url: chrome.runtime.getURL('report.html') });
    return { ok: true };
  },

  async groups() {
    const [groups, active, issues] = await Promise.all([readGroups(), activeGroup(), readIssues()]);
    return {
      activeId: active.id,
      groups: groups.map((group) => ({
        ...group,
        count: issues.filter((issue) => issue.groupId === group.id).length,
      })),
    };
  },

  async groupCreate(msg) {
    return { group: await addGroup(msg.name) };
  },

  async groupSelect(msg) {
    await setActiveGroup(msg.id);
    return { ok: true };
  },

  async groupRename(msg) {
    return { group: await patchGroup(msg.id, { name: msg.name }) };
  },

  async groupDelete(msg) {
    await removeGroup(msg.id);
    await refreshBadge();
    return { ok: true };
  },

  /** The base screenshot the image editor draws on, and whether its region can still move. */
  async editorBase(msg) {
    const issue = (await readIssues()).find((i) => i.id === msg.id);
    if (!issue) return { error: 'Comment not found' };
    const raw = await baseFor(issue);
    if (!raw) return { error: 'This comment has no screenshot' };
    return { src: raw.src, hasBox: raw.hasBox };
  },

  /**
   * Saves the image editor's annotations and region, then redraws both images.
   * The region stays put on comments whose base screenshot already shows it.
   * Moving the region drops the recheck image, which was cut at the old region.
   */
  async annotate(msg) {
    const issue = (await readIssues()).find((i) => i.id === msg.id);
    if (!issue) return { error: 'Comment not found' };
    const raw = await baseFor(issue);
    if (!raw) return { error: 'This comment has no screenshot' };
    const rect = msg.rect && !raw.hasBox ? cleanRect(msg.rect, issue.viewport) : issue.rect;
    const marks = cleanMarks(msg.marks);
    const bitmap = await decode(raw.src);
    const images = await renderImages(bitmap, { ...issue, rect, marks });
    bitmap.close();
    const regionMoved = JSON.stringify(rect) !== JSON.stringify(issue.rect);
    await patchIssue(issue.id, { rect, marks, ...images, ...(regionMoved ? { after: null, checkedAt: null } : {}) });
    return images;
  },

  /**
   * Adds a numbered marker where a report screenshot was clicked, or removes the marker nearest a right-click,
   * then redraws both images. A click on an image cut with older padding cannot be mapped, so the image is refreshed instead.
   * The point arrives as fractions of the clicked image, `image` says whether it was the region crop or the full viewport,
   * and `reach` is how far from a marker's centre a right-click still counts, as a fraction of the image width.
   * The `drop` action removes the marker at `index`, used when its note box closes empty.
   */
  async quickMark(msg) {
    const issue = (await readIssues()).find((i) => i.id === msg.id);
    if (!issue) return { error: 'Comment not found' };
    const raw = await baseFor(issue);
    if (!raw) return { error: 'This comment has no screenshot' };
    const bitmap = await decode(raw.src);
    const scale = bitmap.width / issue.viewport.width;
    const area = msg.image === 'shot' ? { x: 0, y: 0, w: bitmap.width, h: bitmap.height } : cropAround(bitmap, issue.rect, scale).crop;
    const stale = Boolean(msg.aspect) && Math.abs(area.w / area.h - msg.aspect) / (area.w / area.h) > 0.02;
    const point = { x: (area.x + msg.fx * area.w) / scale, y: (area.y + msg.fy * area.h) / scale };
    const marks = [...(issue.marks ?? [])];
    let index = null;
    if (!stale && msg.action === 'add') {
      marks.push({ kind: 'dot', x: Math.round(point.x), y: Math.round(point.y), note: '' });
      index = marks.length - 1;
    } else if (msg.action === 'drop' && marks[msg.index]) {
      marks.splice(msg.index, 1);
      index = msg.index;
    } else if (!stale && msg.action === 'remove') {
      const reach = ((msg.reach ?? 0.03) * area.w) / scale;
      const nearest = marks
        .map((m, i) => ({ i, d: Math.hypot(m.x - point.x, m.y - point.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!nearest || nearest.d > reach) {
        bitmap.close();
        return { removed: null, marks };
      }
      marks.splice(nearest.i, 1);
      index = nearest.i;
    }
    const images = await renderImages(bitmap, { ...issue, marks });
    bitmap.close();
    await patchIssue(issue.id, { marks, ...images });
    return { ...images, marks, index, stale };
  },

  /** Saves the note of one numbered marker without redrawing the images. */
  async markNote(msg) {
    const issue = (await readIssues()).find((i) => i.id === msg.id);
    const marks = [...(issue?.marks ?? [])];
    if (!marks[msg.index]) return { error: 'Marker not found' };
    marks[msg.index] = { ...marks[msg.index], note: String(msg.note ?? '').slice(0, 2000) };
    await patchIssue(issue.id, { marks });
    return { marks };
  },

  /** Widens the detail crops of a group that was captured with older padding. */
  async recropGroup(msg) {
    const issues = await issuesInGroup(msg.groupId);
    let updated = 0;
    for (const issue of issues) {
      const images = await rerender(issue);
      if (!images) continue;
      await patchIssue(issue.id, images);
      updated += 1;
    }
    return { updated };
  },

  /**
   * Captures a comment's region again on the page it came from, scrolled to
   * where it was, so the report can show it before and after the fix. The
   * region is cut at the same page coordinates, so a different window width
   * gives a shifted crop.
   */
  async recheck(msg) {
    const issue = (await readIssues()).find((i) => i.id === msg.id);
    if (!issue) return { error: 'Comment not found' };
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !samePage(tab.url, issue.page?.url)) return { error: 'Open the page this comment was made on' };
    const [{ result: width }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (y) => {
        window.__uiAnnotator?.hideForCapture(true);
        window.scrollTo({ top: y, behavior: 'instant' });
        await new Promise((r) => setTimeout(r, 350));
        return window.innerWidth;
      },
      args: [issue.viewport?.scrollY ?? 0],
    });
    let dataUrl;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 92 });
    } finally {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__uiAnnotator?.hideForCapture(false) });
    }
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const { box, crop } = cropAround(bitmap, issue.rect, bitmap.width / width);
    const after = await drawRegion(bitmap, crop, box, MAX_DETAIL_WIDTH);
    bitmap.close();
    await patchIssue(issue.id, { after, checkedAt: new Date().toISOString() });
    return { ok: true };
  },
};

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg, sender).then(sendResponse, (err) => sendResponse({ error: String(err.message ?? err) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-annotate') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await toggleTab(tab).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.issues) refreshBadge();
});

/** Puts comments captured before groups existed into one, so none are hidden. */
async function migrateOrphans() {
  const issues = await readIssues();
  const orphans = issues.filter((issue) => !issue.groupId);
  if (!orphans.length) return;
  const group =
    (await readGroups()).find((s) => s.name === 'Earlier comments') ?? (await addGroup('Earlier comments'));
  for (const orphan of orphans) await patchIssue(orphan.id, { groupId: group.id });
}

/** Storage keys left by the Fragment integration, which has been removed. */
const RETIRED_KEYS = ['fragment', 'fragmentOutbox', 'fragmentStatus'];

async function boot() {
  await createMenus();
  await chrome.storage.local.remove(RETIRED_KEYS);
  await migrateOrphans();
  await refreshBadge();
}

chrome.runtime.onStartup.addListener(boot);
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await boot();
  if (reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

