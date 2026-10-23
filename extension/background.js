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
  writeIssues,
} from './lib/store.js';
import { parseReviewFile } from './lib/review-file.js';
import { WIDTHS, widthShots } from './lib/widths.js';

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
  chrome.contextMenus.create({ id: 'margin-widths', title: 'Capture comments on this page at three widths', contexts: MENU_CONTEXTS });
  chrome.contextMenus.create({ id: 'margin-report', title: 'Open the review report', contexts: MENU_CONTEXTS });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'margin-toggle') await toggleTab(tab);
    else if (info.menuItemId === 'margin-report') await handlers.openReport();
    else if (info.menuItemId === 'margin-viewport' && tab?.id) {
      await ensureContent(tab);
      await chrome.tabs.sendMessage(tab.id, { type: 'captureViewport', groupName: (await activeGroup()).name });
    } else if (info.menuItemId === 'margin-widths' && tab?.id) {
      const res = await handlers.captureWidths({ page: true }, { tab }).catch((err) => ({ error: String(err.message ?? err) }));
      await chrome.tabs.sendMessage(tab.id, { type: 'toast', text: res.error ?? res.message });
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

/**
 * Points a selection anchor at a moved region. The anchor element's box is worked out from the old region and its
 * fractions, so the new region is stored against the same element.
 * @param {object | null} anchor The comment's anchor.
 * @param {{x:number,y:number,w:number,h:number}} from The region the anchor was recorded for.
 * @param {{x:number,y:number,w:number,h:number}} to The region after the move.
 */
function rebaseAnchor(anchor, from, to) {
  if (!anchor?.box?.fw || !anchor.box.fh) return anchor ?? null;
  const w = from.w / anchor.box.fw;
  const h = from.h / anchor.box.fh;
  const left = from.x - anchor.box.fx * w;
  const top = from.y - anchor.box.fy * h;
  const round = (v) => Math.round(v * 10000) / 10000;
  return { ...anchor, box: { fx: round((to.x - left) / w), fy: round((to.y - top) / h), fw: round(to.w / w), fh: round(to.h / h) } };
}

/** Keeps the toolbar badge in step with the stored issue count, unless a verify run is showing its progress there. */
async function refreshBadge() {
  if (verifyRun) return;
  const count = (await readIssues()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#1f2937' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
}

/**
 * The browser, system and zoom a comment was captured with, the details a developer asks for first.
 * @param {chrome.tabs.Tab} tab The tab being captured.
 */
async function environmentOf(tab) {
  const ua = navigator.userAgentData;
  const brand = ua?.brands?.find((b) => !/not.?a.?brand|chromium/i.test(b.brand)) ?? ua?.brands?.find((b) => /chromium/i.test(b.brand));
  const zoom = await chrome.tabs.getZoom(tab.id).catch(() => 1);
  return {
    browser: brand ? `${brand.brand} ${brand.version}` : 'Chrome',
    os: ua?.platform || '',
    zoom: Math.round(zoom * 100),
  };
}

const MAX_WIDTH_SHOT = 900;
let widthsBusy = false;

/**
 * Runs a function in the tab and returns its result.
 * @param {number} tabId The tab to run in.
 * @param {Function} func A self contained function.
 * @param {unknown[]} [args] Its arguments.
 */
async function inTab(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result;
}

/**
 * Waits for the tab's layout width to move off its old value and then hold still, and returns it.
 * A resize that changes nothing is given about a second before the old width is accepted.
 * @param {number} tabId The tab being resized.
 * @param {number} before The width before the resize.
 */
async function settledWidth(tabId, before) {
  let last = before;
  let steady = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    const width = await inTab(tabId, () => window.innerWidth);
    steady = width === last ? steady + 1 : 0;
    last = width;
    if (steady >= (width === before ? 10 : 2)) break;
  }
  return last;
}

/**
 * Resizes a window until its tab lays out at a width, or until Chrome will not go further. Returns the width reached.
 * The window frame is measured rather than assumed, and the first resize can stop short, so it tries a few times.
 * @param {number} windowId The window to resize.
 * @param {number} tabId The tab whose layout width is measured.
 * @param {number} width The layout width wanted, in CSS pixels.
 */
async function fitWidth(windowId, tabId, width) {
  const win = await chrome.windows.get(windowId);
  let asked = win.width;
  let reached = await inTab(tabId, () => window.innerWidth);
  let best = { asked, reached };
  const resize = async (next) => {
    await chrome.windows.update(windowId, { width: next }).catch(async () => {
      const screen = await inTab(tabId, () => ({ left: window.screen.availLeft ?? 0, width: window.screen.availWidth }));
      next = Math.min(next, screen.width);
      await chrome.windows.update(windowId, { left: Math.max(screen.left, Math.min(win.left, screen.left + screen.width - next)), width: next });
    });
    asked = next;
    reached = await settledWidth(tabId, reached);
  };
  for (let attempt = 0; attempt < 5 && reached !== width; attempt++) {
    const before = reached;
    const next = Math.max(100, asked + width - reached);
    if (next === asked) break;
    await resize(next);
    if (Math.abs(width - reached) < Math.abs(width - best.reached)) best = { asked, reached };
    if (reached === before && Math.abs(width - reached) > 2) break;
  }
  if (reached !== best.reached) await resize(best.asked);
  await sleep(400);
  return reached;
}

/**
 * Puts a window back to its saved position and size. Display scaling can round the first try by a pixel, so it checks and tries again.
 * @param {number} windowId The window to restore.
 * @param {{left:number, top:number, width:number, height:number}} bounds Where it was.
 */
async function restoreBounds(windowId, bounds) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const win = await chrome.windows.get(windowId);
    const off = ['left', 'top', 'width', 'height'].filter((key) => win[key] !== bounds[key]);
    if (!off.length) return;
    await chrome.windows.update(windowId, Object.fromEntries(off.map((key) => [key, bounds[key] + (attempt ? bounds[key] - win[key] : 0)])));
    await sleep(150);
  }
}

/**
 * Runs in the page. Finds a comment's anchor at the current width, scrolls it into view, and returns
 * where the region sits now. Falls back to the saved page position when the anchor is hidden or gone.
 * @param {object | null} anchor The anchor recorded when the comment was made.
 * @param {{x:number,y:number,w:number,h:number}} rect The region as saved, in viewport pixels.
 * @param {number} savedScrollY How far the page was scrolled when the comment was made.
 */
async function locateRegion(anchor, rect, savedScrollY) {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 350));
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const clamp = (r) => {
    const w = Math.max(4, Math.min(r.w, vw));
    const h = Math.max(4, Math.min(r.h, vh));
    const x = Math.min(Math.max(0, r.x), vw - w);
    const y = Math.min(Math.max(0, r.y), vh - h);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  };
  const find = () => {
    if (!anchor?.selector) return null;
    let matches = [];
    try {
      matches = [...document.querySelectorAll(anchor.selector)];
    } catch {}
    const sameText = (el) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80) === anchor.text;
    if (matches.length > 1 && anchor.text) matches = matches.filter(sameText).length ? matches.filter(sameText) : matches;
    if (!matches.length && anchor.text && anchor.tag) matches = [...document.getElementsByTagName(anchor.tag)].filter(sameText);
    return matches[Math.min(anchor.nth ?? 0, matches.length - 1)] ?? null;
  };
  const regionOn = (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + anchor.box.fx * b.width, y: b.top + anchor.box.fy * b.height, w: anchor.box.fw * b.width, h: anchor.box.fh * b.height };
  };
  const el = find();
  const box = el?.getBoundingClientRect();
  if (el && box.width > 0 && box.height > 0 && anchor.box) {
    const first = regionOn(el);
    window.scrollTo({ top: window.scrollY + first.y - Math.max(0, (vh - Math.min(first.h, vh)) / 2), behavior: 'instant' });
    await settle();
    return { rect: clamp(regionOn(el)), placed: 'found' };
  }
  const pageY = rect.y + savedScrollY;
  window.scrollTo({ top: pageY - Math.max(0, (vh - Math.min(rect.h, vh)) / 2), behavior: 'instant' });
  await settle();
  return { rect: clamp({ ...rect, y: pageY - window.scrollY }), placed: el ? 'hidden' : 'lost' };
}

/**
 * Captures each comment's region in the tab at its current width.
 * @param {chrome.tabs.Tab} tab The tab, as it is now.
 * @param {number} windowId The window the tab is in now.
 * @param {object[]} issues The comments to capture.
 * @param {number} width The layout width reached.
 * @param {string} key Which width this is, such as mobile.
 * @param {Record<string, object>} out Captured shots by comment id, filled in place.
 */
async function captureAtWidth(tab, windowId, issues, width, key, out) {
  for (const issue of issues) {
    const { rect, placed } = await inTab(tab.id, locateRegion, [issue.anchor ?? null, issue.rect, issue.viewport?.scrollY ?? 0]);
    const bitmap = await decode(await throttledCapture(windowId));
    const { box, crop } = cropAround(bitmap, rect, bitmap.width / width);
    out[issue.id][key] = { src: await drawRegion(bitmap, crop, box, MAX_WIDTH_SHOT), width, placed };
    bitmap.close();
  }
}

/**
 * Moves a tab into a narrow popup window, which Chrome lets go below the smallest normal window.
 * A window left with no tabs would close, so a blank tab holds its place first.
 * @param {chrome.tabs.Tab} tab The tab to move.
 * @param {chrome.windows.Window} home The window it comes from.
 * @param {number} width The window width to open at.
 */
async function intoPopup(tab, home, width) {
  const siblings = await chrome.tabs.query({ windowId: home.id });
  const placeholder = siblings.length === 1 ? await chrome.tabs.create({ windowId: home.id, url: 'about:blank', active: false }) : null;
  const popup = await chrome.windows.create({
    tabId: tab.id,
    type: 'popup',
    focused: true,
    width,
    height: Math.min(home.height, 900),
    left: home.left,
    top: home.top,
  });
  return { popupId: popup.id, placeholderId: placeholder?.id ?? null };
}

/**
 * Captures comments at mobile, tablet and desktop widths, then puts the window and tab back exactly as they were,
 * even when a step fails. Tablet and desktop resize the window. Mobile moves the tab into a narrow popup window,
 * and when capture is refused there it falls back to the narrowest the normal window goes.
 * @param {chrome.tabs.Tab} tab The tab the comments were made on.
 * @param {object[]} issues The comments to capture.
 */
async function captureWidths(tab, issues) {
  const home = await chrome.windows.get(tab.windowId);
  const live = await chrome.tabs.get(tab.id);
  const spot = { index: live.index, pinned: live.pinned, groupId: live.groupId ?? -1 };
  const out = Object.fromEntries(issues.map((issue) => [issue.id, {}]));
  const page = await inTab(tab.id, () => {
    window.__uiAnnotator?.hideForCapture(true);
    return { scrollX: window.scrollX, scrollY: window.scrollY };
  });
  let bounds = null;
  let moved = null;
  try {
    if (home.state !== 'normal') {
      await chrome.windows.update(home.id, { state: 'normal' });
      await sleep(400);
    }
    const normal = await chrome.windows.get(home.id);
    bounds = { left: normal.left, top: normal.top, width: normal.width, height: normal.height };

    for (const target of [...WIDTHS].reverse().filter((w) => w.key !== 'mobile')) {
      const reached = await fitWidth(home.id, tab.id, target.width);
      await captureAtWidth(tab, home.id, issues, reached, target.key, out);
    }

    const mobile = WIDTHS.find((w) => w.key === 'mobile');
    let mobileDone = false;
    try {
      moved = await intoPopup(tab, normal, mobile.width);
      const reached = await fitWidth(moved.popupId, tab.id, mobile.width);
      await captureAtWidth(tab, moved.popupId, issues, reached, mobile.key, out);
      mobileDone = true;
    } catch {
      mobileDone = false;
    }
    if (moved) {
      await backHome(tab, home.id, spot, moved);
      moved = null;
    }
    if (!mobileDone) {
      const reached = await fitWidth(home.id, tab.id, mobile.width);
      await captureAtWidth(tab, home.id, issues, reached, mobile.key, out);
    }
  } finally {
    if (moved) await backHome(tab, home.id, spot, moved).catch(() => {});
    if (bounds) await restoreBounds(home.id, bounds).catch(() => {});
    if (home.state !== 'normal') await chrome.windows.update(home.id, { state: home.state }).catch(() => {});
    await chrome.windows.update(home.id, { focused: true }).catch(() => {});
    await sleep(300);
    await inTab(
      tab.id,
      (x, y) => {
        window.scrollTo({ left: x, top: y, behavior: 'instant' });
        window.__uiAnnotator?.hideForCapture(false);
      },
      [page.scrollX, page.scrollY],
    ).catch(() => {});
  }
  return out;
}

/**
 * Moves a tab from the popup back to its place in its window, with its pin and group, and removes the blank placeholder.
 * @param {chrome.tabs.Tab} tab The tab to return.
 * @param {number} windowId The window it came from.
 * @param {{ index: number, pinned: boolean, groupId: number }} spot Where it sat.
 * @param {{ popupId: number, placeholderId: number | null }} moved The popup and placeholder made for the move.
 */
async function backHome(tab, windowId, spot, moved) {
  await chrome.tabs.move(tab.id, { windowId, index: spot.index });
  await chrome.tabs.update(tab.id, { active: true, pinned: spot.pinned });
  if (spot.groupId !== -1) await chrome.tabs.group({ groupId: spot.groupId, tabIds: [tab.id] }).catch(() => {});
  if (moved.placeholderId !== null) await chrome.tabs.remove(moved.placeholderId).catch(() => {});
  await chrome.windows.remove(moved.popupId).catch(() => {});
}

/**
 * A short account of a width capture, naming any width where an element could not be found.
 * @param {object[]} saved The comments as saved with their new shots.
 */
function widthsMessage(saved) {
  const count = `${saved.length} ${saved.length === 1 ? 'comment' : 'comments'}`;
  const shots = saved.flatMap((issue) => widthShots(issue));
  const reached = WIDTHS.map((w) => shots.find((s) => s.key === w.key)?.width ?? w.width);
  const missed = [...new Set(shots.filter((s) => s.placed !== 'found').map((s) => s.label.toLowerCase()))];
  const where = missed.length > 1 ? `${missed.slice(0, -1).join(', ')} and ${missed.at(-1)}` : missed[0];
  const note = missed.length ? ` At ${where} the element was hidden or missing, so those shots use the saved position.` : '';
  return `Captured ${count} at ${reached.slice(0, -1).join(', ')} and ${reached.at(-1)}px.${note}`;
}

const handlers = {
  async toggle(_msg, sender) {
    const tab = sender.tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return { active: await toggleTab(tab) };
  },

  /** Stores a new comment for a marked region, with its screenshots unless `skipShot` asks to save it without one. */
  async capture(msg, sender) {
    const { raw, shot, detail } = msg.skipShot ? { raw: null, shot: null, detail: null } : await captureShots(sender.tab, msg);
    const issue = {
      id: crypto.randomUUID(),
      groupId: (await activeGroup()).id,
      createdAt: new Date().toISOString(),
      severity: 'major',
      status: 'open',
      title: '',
      note: '',
      page: { url: sender.tab.url, title: sender.tab.title ?? '' },
      viewport: msg.viewport,
      env: await environmentOf(sender.tab),
      element: msg.element,
      anchor: msg.anchor ?? null,
      rect: msg.rect,
      shot,
      detail,
    };
    if (raw) await writeRaw(issue.id, { src: raw, hasBox: false });
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

  /**
   * Captures comments again at mobile, tablet and desktop widths: the ones named by id, or with `page` every comment
   * in the active review made on the tab's page.
   */
  async captureWidths(msg, sender) {
    const tab = sender.tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!tab?.id) return { error: 'Open the page these comments were made on' };
    if (widthsBusy) return { error: 'Already capturing at three widths' };
    if (verifyRun) return { error: 'Wait for the check that is running to finish' };
    const group = await activeGroup();
    const issues = (await readIssues()).filter((issue) =>
      msg.page ? issue.groupId === group.id && samePage(tab.url, issue.page?.url) : msg.ids?.includes(issue.id),
    );
    if (!issues.length) return { error: msg.page ? 'No comments on this page in the current review' : 'Comment not found' };
    if (!issues.every((issue) => samePage(tab.url, issue.page?.url))) return { error: 'Open the page this comment was made on' };
    widthsBusy = true;
    try {
      const shots = await captureWidths(tab, issues);
      const takenAt = new Date().toISOString();
      const saved = [];
      for (const issue of issues) saved.push(await patchIssue(issue.id, { shots: shots[issue.id], shotsAt: takenAt }));
      return { message: widthsMessage(saved) };
    } catch (err) {
      return { error: `Capture at three widths stopped, and the window was put back. ${String(err.message ?? err)}` };
    } finally {
      widthsBusy = false;
    }
  },

  /** Adds a review from a saved review file as a new group, leaving the group new captures go to unchanged. */
  async importReview(msg) {
    const parsed = parseReviewFile(msg.contents);
    if (parsed.error) return { error: parsed.error };
    const previous = await activeGroup();
    const group = await addGroup(`${parsed.name} (imported)`);
    if (parsed.jira || parsed.figma) await patchGroup(group.id, { jira: parsed.jira, figma: parsed.figma });
    await setActiveGroup(previous.id);
    const added = parsed.issues.map(({ raw, ...issue }) => ({ ...issue, id: crypto.randomUUID(), groupId: group.id, raw }));
    for (const { id, raw } of added) if (raw) await writeRaw(id, raw);
    await writeIssues([...(await readIssues()), ...added.map(({ raw, ...issue }) => issue)]);
    await refreshBadge();
    return { group, count: added.length };
  },

  /** The review new comments go to, as stored, with its linked ticket and file. */
  async activeReview() {
    return activeGroup();
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
   * Moving the region drops the recheck image and the width shots, which were cut at the old region, and moves the anchor with it.
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
    const moved = regionMoved
      ? { after: null, checkedAt: null, change: null, shots: null, shotsAt: null, anchor: rebaseAnchor(issue.anchor, issue.rect, rect) }
      : {};
    await patchIssue(issue.id, { rect, marks, ...images, ...moved });
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
    await setOverlayHidden(tab.id, true);
    let patch;
    try {
      patch = await recaptureRegion(tab, issue);
    } finally {
      await setOverlayHidden(tab.id, false);
    }
    await patchIssue(issue.id, patch);
    return { ok: true };
  },

  /**
   * Starts rechecking every comment in a group whose page is open. From the popup that is the active tab.
   * From the report it is the most recent tab in the window that Margin may capture, since Chrome only
   * shows the address of tabs Margin was opened on. Replies at once, and the run reports through storage.
   */
  async verifyStart(msg, sender) {
    if (verifyRun) return { error: 'A check is already running' };
    if (widthsBusy) return { error: 'Wait for the capture at three widths to finish' };
    const issues = await issuesInGroup(msg.groupId);
    const report = sender.tab?.url?.startsWith(chrome.runtime.getURL('')) ? sender.tab : null;
    const candidates = report
      ? (await chrome.tabs.query({ windowId: report.windowId })).filter((t) => t.id !== report.id)
      : await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = candidates
      .filter((t) => t.id && issues.some((issue) => samePage(t.url, issue.page?.url)))
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
    if (!tab) return { error: 'noTab' };
    const targets = issues.filter((issue) => samePage(tab.url, issue.page?.url));
    verifyRun = { cancelled: false };
    runVerify(verifyRun, tab, targets, msg.groupId, report);
    return { started: true, total: targets.length };
  },

  /** Stops the verify run after the capture in progress. */
  async verifyCancel() {
    if (verifyRun) verifyRun.cancelled = true;
    return { ok: true };
  },

  /** The review new comments go to, as stored, so the overlay can read its name, Jira issue and Figma file. */
  async activeReview() {
    return activeGroup();
  },

  /**
   * The active review's comments made on one page, without their images, numbered in the order they were made,
   * plus how many comments the review holds. The overlay draws these as flags.
   */
  async pageComments(msg, sender) {
    const group = await activeGroup();
    const issues = await issuesInGroup(group.id);
    const url = msg.url ?? sender.tab?.url;
    return {
      total: issues.length,
      comments: issues
        .map((issue, index) => ({ issue, n: index + 1 }))
        .filter(({ issue }) => samePage(url, issue.page?.url))
        .map(({ issue, n }) => ({
          id: issue.id,
          n,
          title: issue.title,
          severity: issue.severity,
          status: issue.status,
          rect: issue.rect,
          anchor: issue.anchor ?? null,
          viewport: issue.viewport,
          frame: issue.figmaFrame?.name ?? '',
        })),
    };
  },
};

const CAPTURE_GAP = 600;
const RUN_KEY = 'verifyRun';
const DIFF_WIDTH = 240;
const DIFF_CELL = 2;
const DIFF_LEVEL = 32;
let lastCaptureAt = 0;
let verifyRun = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captures the visible tab no sooner than CAPTURE_GAP after the previous capture, because Chrome
 * allows about two a second, and tries once more after a longer pause if Chrome still refuses.
 * @param {number} windowId The window whose visible tab is captured.
 */
async function throttledCapture(windowId) {
  for (let attempt = 0; ; attempt += 1) {
    const wait = lastCaptureAt + CAPTURE_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastCaptureAt = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 92 });
    } catch (err) {
      if (attempt > 0 || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(String(err?.message ?? err))) throw err;
      await sleep(CAPTURE_GAP * 2);
    }
  }
}

/**
 * Hides or shows Margin's overlay on a tab, so it stays out of the capture.
 * @param {number} tabId The tab.
 * @param {boolean} hidden True to hide it.
 */
async function setOverlayHidden(tabId, hidden) {
  await chrome.scripting.executeScript({ target: { tabId }, func: (h) => window.__uiAnnotator?.hideForCapture(h), args: [hidden] });
}

/**
 * Scrolls a tab to where a comment was made and cuts the same region from a fresh capture.
 * The region is cut at the same page coordinates, so a different window width gives a shifted crop,
 * and the change hint is left out in that case.
 * @param {chrome.tabs.Tab} tab The tab showing the comment's page.
 * @param {object} issue The stored comment.
 */
async function recaptureRegion(tab, issue) {
  const [{ result: width }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async (y) => {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 350));
      return window.innerWidth;
    },
    args: [issue.viewport?.scrollY ?? 0],
  });
  const bitmap = await decode(await throttledCapture(tab.windowId));
  const { box, crop } = cropAround(bitmap, issue.rect, bitmap.width / width);
  const after = await drawRegion(bitmap, crop, box, MAX_DETAIL_WIDTH);
  const change = width === issue.viewport?.width ? await regionChange(issue, bitmap, box) : null;
  bitmap.close();
  return { after, checkedAt: new Date().toISOString(), change };
}

/**
 * How much a comment's marked region differs between its clean base screenshot and a new capture, from 0 to 1.
 * Both are shrunk to a grey grid of about DIFF_CELL CSS pixels a cell, at most DIFF_WIDTH cells wide,
 * and the share of cells that moved by more than DIFF_LEVEL is returned.
 * Null when the base has the region outline burned in or is missing.
 * @param {object} issue The stored comment.
 * @param {ImageBitmap} bitmap The new capture.
 * @param {{x:number,y:number,w:number,h:number}} box The marked region in the new capture.
 */
async function regionChange(issue, bitmap, box) {
  const raw = await readRaw(issue.id);
  if (!raw || raw.hasBox) return null;
  const base = await decode(raw.src);
  const width = Math.max(1, Math.min(DIFF_WIDTH, Math.round(issue.rect.w / DIFF_CELL)));
  const height = Math.max(1, Math.round((width * issue.rect.h) / issue.rect.w));
  const grey = (img, src) => {
    const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    return Array.from({ length: width * height }, (_, i) => data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114);
  };
  const before = grey(base, cropAround(base, issue.rect, base.width / issue.viewport.width).box);
  base.close();
  const now = grey(bitmap, box);
  const moved = before.filter((v, i) => Math.abs(v - now[i]) > DIFF_LEVEL).length;
  return Math.round((moved / before.length) * 1000) / 1000;
}

/**
 * Rechecks each comment in turn on one tab, with the overlay hidden, and puts the scroll position back after.
 * Escape on the page, the Cancel button or leaving the tab stops it. Progress shows on the badge and in storage.
 * When it ends the report opens on the verify view, or the report that started it comes back to the front.
 * @param {{cancelled: boolean}} run The live run, flagged when cancelled.
 * @param {chrome.tabs.Tab} tab The tab being checked.
 * @param {object[]} targets The comments made on that tab's page.
 * @param {string} groupId The review they belong to.
 * @param {chrome.tabs.Tab | null} report The report tab that started the run, if it was not the popup.
 */
async function runVerify(run, tab, targets, groupId, report) {
  const state = { state: 'running', groupId, page: tab.url, title: tab.title ?? '', total: targets.length, done: 0, checked: [], failed: [] };
  const publish = () => chrome.storage.local.set({ [RUN_KEY]: { ...state, at: Date.now() } });
  const target = { tabId: tab.id };
  let left = false;
  let startY = 0;
  await publish();
  try {
    if (report) await chrome.tabs.update(tab.id, { active: true });
    [{ result: startY }] = await chrome.scripting.executeScript({
      target,
      func: () => {
        window.__uiAnnotator?.hideForCapture(true);
        window.__marginVerifyKey = (event) => {
          if (event.key === 'Escape') chrome.runtime.sendMessage({ type: 'verifyCancel' });
        };
        window.addEventListener('keydown', window.__marginVerifyKey, true);
        return window.scrollY;
      },
    });
    for (const issue of targets) {
      const [front] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      left = front?.id !== tab.id;
      if (run.cancelled || left) break;
      await chrome.action.setBadgeText({ text: `${state.done + 1}/${state.total}` });
      try {
        await patchIssue(issue.id, await recaptureRegion(tab, issue));
        state.checked.push(issue.id);
      } catch {
        state.failed.push(issue.id);
      }
      state.done += 1;
      await publish();
    }
  } finally {
    await chrome.scripting
      .executeScript({
        target,
        func: (y) => {
          window.removeEventListener('keydown', window.__marginVerifyKey, true);
          delete window.__marginVerifyKey;
          window.__uiAnnotator?.hideForCapture(false);
          window.scrollTo({ top: y, behavior: 'instant' });
        },
        args: [startY ?? 0],
      })
      .catch(() => {});
    state.state = run.cancelled || left ? 'cancelled' : 'done';
    await publish();
    verifyRun = null;
    await refreshBadge();
    if (report && !left) await chrome.tabs.update(report.id, { active: true }).catch(() => {});
    else if (!report && !left && state.checked.length) {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`report.html?group=${groupId}&verify=1`) });
    }
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

