import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

/**
 * Loads the real unpacked extension into a throwaway headless Chrome over --remote-debugging-pipe and checks the overlay
 * input with real CDP mouse, wheel and key events. A test page zooms the html element, covers the viewport with an
 * iframe and opens a manual popover and a modal dialog after annotation starts, and the run proves hover and drags stay
 * on the overlay with no page handler firing. On the Smart Spaces demo it times the toggle message to the first painted
 * hint bar, follows the pointer, picks the hero headline under its pointer-events: none layer, holds Alt to hover the
 * nav, runs at 50 percent tab zoom and checks the capture states. On MDN it opens the slash search over the overlay.
 * Headless Chrome cannot grant activeTab, so the run loads a copy of the extension with host access to every site.
 * Run with node tools/screenshots/overlay-real.mjs. SHOTS names a subfolder for the screenshots and EXT points at
 * another extension folder, such as an older build to compare against.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK = join(ROOT, 'dist', '.overlay-e2e');
const OUT = join(ROOT, 'dist', 'fix-shots', 'overlay', process.env.SHOTS ?? '');
const SRC = process.env.EXT ?? join(ROOT, 'extension');
const COPY = join(WORK, 'extension');
const TEST = 'https://overlay.test/';
const SITE = 'https://smart-spaces-demo.vercel.app/';
const MDN = 'https://developer.mozilla.org/en-US/docs/Web/CSS/position';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const VIEW = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Overlay test</title><style>
  html { zoom: 0.8; }
  body { margin: 0; font: 16px/1.4 system-ui, sans-serif; }
  #frame { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
  #panel { position: fixed; right: 40px; top: 40px; width: 300px; height: 220px; overflow: auto; background: #fff; border: 2px solid #c60; z-index: 1; }
  #panel p { margin: 12px; }
  #field { position: fixed; left: 40px; bottom: 120px; z-index: 1; font: inherit; padding: 6px; }
  dialog { width: 520px; padding: 24px; border: 2px solid #333; }
  dialog::backdrop { background: rgba(0, 0, 0, 0.3); }
  #pop { position: fixed; inset: auto; left: 60px; top: 520px; width: 360px; padding: 20px; margin: 0; border: 2px solid #0a7; }
  button { font: inherit; padding: 8px 16px; }
</style></head><body>
<iframe id="frame" srcdoc="<body style='margin:0;font:18px system-ui;background:#eef2ff'><h1 id='fh' style='margin:48px'>Full viewport iframe</h1><p style='margin:48px'>Presses over this frame must stay on the overlay.</p><button id='fb' style='margin:48px;font-size:20px'>Frame button</button></body>"></iframe>
<div id="panel"><b>Inner scrolling panel</b>${Array.from({ length: 30 }, (_, i) => `<p>Line ${i + 1} of the panel</p>`).join('')}</div>
<input id="field" placeholder="A page field">
<dialog id="dlg"><h2 id="dh">Modal dialog</h2><p>Opened with showModal after annotation started.</p><button id="db">Dialog button</button></dialog>
<div id="pop" popover="manual"><b id="ph">Manual popover</b><p>Opened with showPopover after annotation started.</p><button id="pb">Popover button</button></div>
<script>
  window.hits = {};
  const TYPES = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];
  const count = (where, target) => TYPES.forEach((t) => target.addEventListener(t, () => { hits[where + ' ' + t] = (hits[where + ' ' + t] || 0) + 1; }));
  count('window', window);
  count('document', document);
  frame.addEventListener('load', () => count('iframe', frame.contentDocument));
</script>
</body></html>`;

/**
 * Records a check, printed at the end.
 * @param {boolean} ok Whether it held.
 * @param {string} what What was checked.
 */
function check(ok, what) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
}

/**
 * Decodes an 8 bit, non interlaced PNG into RGBA pixels, enough for the screencast frames Chrome sends.
 * @param {Buffer} buf The PNG file.
 */
function decodePng(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      type = data[9];
    } else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      px[(y * width + x) * 4] = line[x * bpp];
      px[(y * width + x) * 4 + 1] = line[x * bpp + 1];
      px[(y * width + x) * 4 + 2] = line[x * bpp + 2];
      px[(y * width + x) * 4 + 3] = 255;
    }
    prev = line;
  }
  return { width, height, px };
}

/**
 * Reads what a screencast frame shows: the overlay's inset border, the hint bar box, and dark text pixels on the bar.
 * @param {Buffer} png The frame.
 */
function readFrame(png) {
  const { width, height, px } = decodePng(png);
  const at = (x, y) => px.subarray((y * width + x) * 4, (y * width + x) * 4 + 3);
  const [r, g, b] = at(0, Math.round(height / 2));
  const border = Math.abs(r - 117) < 40 && Math.abs(g - 73) < 40 && Math.abs(b - 210) < 40;
  let white = 0;
  let dark = 0;
  let total = 0;
  const cy = height - 16 - 20;
  for (let y = cy - 8; y <= cy + 8; y++) {
    for (let x = Math.round(width / 2) - 180; x <= Math.round(width / 2) + 180; x++) {
      const [pr, pg, pb] = at(x, y);
      total++;
      if (pr > 245 && pg > 245 && pb > 245) white++;
      if (0.3 * pr + 0.59 * pg + 0.11 * pb < 90) dark++;
    }
  }
  return { border, box: white / total > 0.5, text: dark > 40 };
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(SRC, COPY, { recursive: true });
const manifest = JSON.parse(readFileSync(join(COPY, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
writeFileSync(join(COPY, 'manifest.json'), JSON.stringify(manifest, null, 2));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${join(WORK, 'profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--window-size=${VIEW.width},${VIEW.height}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
const writer = chrome.stdio[3];
const reader = chrome.stdio[4];
let next = 0;
const pending = new Map();
const handlers = new Map();
let buffer = '';
reader.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) handlers.get(msg.method)?.(msg.params, msg.sessionId);
  }
});

/**
 * Sends one protocol command over the pipe, optionally to an attached session.
 * @param {string} method The protocol method.
 * @param {object} [params] Its parameters.
 * @param {string} [sessionId] The session to send it to.
 */
function send(method, params = {}, sessionId) {
  const id = ++next;
  writer.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

/**
 * Runs an expression in a session and returns its value.
 * @param {string} sessionId The page or service worker session.
 * @param {string} expression JavaScript to evaluate, awaited if it returns a promise.
 */
async function evaluate(sessionId, expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

let sw;
let tab;
let tabTarget;

/**
 * Sends one real mouse event through the browser.
 * @param {string} type mouseMoved, mousePressed, mouseReleased or mouseWheel.
 * @param {number} x Viewport x.
 * @param {number} y Viewport y.
 * @param {object} [extra] Button, buttons, click count, modifiers or wheel deltas.
 */
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), ...extra }, tab);

/**
 * Presses one key in the page.
 * @param {string} key The key name.
 * @param {number} vk Its Windows virtual key code.
 * @param {string} [code] The physical key, when it differs from the name.
 */
async function press(key, vk, code = key) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key.length === 1 ? key : undefined }, tab);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }, tab);
  await sleep(150);
}

/**
 * Types text one real key at a time, the way a person would, so shortcuts get a chance to swallow letters.
 * @param {string} text Letters, digits and spaces.
 */
async function typeKeys(text) {
  for (const ch of text) {
    const code = ch === ' ' ? 'Space' : /\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`;
    const vk = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, windowsVirtualKeyCode: vk, text: ch }, tab);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: vk }, tab);
  }
  await sleep(150);
}

/**
 * Holds or releases the Alt key.
 * @param {boolean} down True to press, false to let go.
 */
const alt = (down) =>
  send('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, modifiers: down ? 1 : 0 }, tab);

/**
 * Saves the viewport as a PNG in the output folder.
 * @param {string} name The file name without extension.
 */
async function shoot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, tab);
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  ${name}.png`);
}

/** Finds the overlay's closed shadow root through the DOM domain, which pierces it, and returns it as a remote object. */
async function shadowRoot() {
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true }, tab);
  const walk = (node) => {
    const style = node.attributes?.[node.attributes.indexOf('style') + 1] ?? '';
    if (node.shadowRoots?.length && node.attributes?.includes('popover') && style.includes('2147483647')) return node.shadowRoots[0];
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(root);
  if (!found) return null;
  const { object } = await send('DOM.resolveNode', { backendNodeId: found.backendNodeId }, tab);
  return object.objectId;
}

/**
 * Runs a function with `this` set to the overlay's shadow root and returns its value.
 * @param {string} fn A function declaration.
 * @param {boolean} [byValue] False to get a remote object back instead of a value.
 * @param {string} [objectId] A shadow root already found, so the DOM agent's node ids stay put.
 */
async function inShadow(fn, byValue = true, objectId) {
  const target = objectId ?? (await shadowRoot());
  if (!target) return null;
  const { result } = await send('Runtime.callFunctionOn', { objectId: target, functionDeclaration: fn, returnByValue: byValue }, tab);
  return byValue ? result.value : result.objectId;
}

/** True while annotation is on: the overlay is in the page, open in the top layer and showing its root. */
const annotating = () => inShadow('function () { return this.host.isConnected && this.host.matches(":popover-open") && !this.querySelector(".root").hidden; }');

/**
 * The on-screen border box of a remote element, in viewport pixels, or null when it has no box.
 * @param {string | null | undefined} objectId The element.
 */
async function boxOf(objectId) {
  if (!objectId) return null;
  try {
    const { model } = await send('DOM.getBoxModel', { objectId }, tab);
    const q = model.border;
    return { x: q[0], y: q[1], w: q[2] - q[0], h: q[5] - q[1] };
  } catch {
    return null;
  }
}

/**
 * A page element as a remote object, from an expression in the page.
 * @param {string} expression JavaScript that returns the element.
 */
async function pageObject(expression) {
  const { result } = await send('Runtime.evaluate', { expression }, tab);
  return result.objectId;
}

/**
 * The page element under a point, skipping the overlay host, as a remote object.
 * @param {number} x Viewport x.
 * @param {number} y Viewport y.
 */
const pageElementAt = (x, y) => pageObject(`document.elementsFromPoint(${x}, ${y}).find((el) => el.style.zIndex !== '2147483647')`);

const near = (a, b, tol = 1.5) => Boolean(a && b) && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) <= tol);
const fmt = (r) => (r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}` : 'none');

/** The hover outline's box on screen, or null while it is hidden. */
async function hoverBox() {
  const shown = await inShadow('function () { return !this.querySelector(".hover").hidden; }');
  return shown ? boxOf(await inShadow('function () { return this.querySelector(".hover"); }', false)) : null;
}

/**
 * Moves the pointer to a point and reports whether the hover outline sits exactly on the expected page element.
 * @param {number} x Viewport x.
 * @param {number} y Viewport y.
 * @param {string} [expected] The expected element as a remote object, by default the top hit under the point.
 */
async function hoverAt(x, y, expected) {
  await mouse('mouseMoved', x, y);
  const want = await boxOf(expected ?? (await pageElementAt(x, y)));
  const got = await hoverBox();
  return { ok: near(got, want), got, want };
}

/**
 * Drags out a region with the button held, checks the band follows it, then lets go and waits for the card.
 * @param {{x:number,y:number,w:number,h:number}} r The region in viewport pixels.
 * @param {string} name Screenshot name for the held drag.
 */
async function dragRegion(r, name) {
  await mouse('mouseMoved', r.x, r.y);
  await mouse('mousePressed', r.x, r.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) await mouse('mouseMoved', r.x + (r.w * i) / 8, r.y + (r.h * i) / 8, { button: 'left', buttons: 1 });
  const band = await boxOf(await inShadow('function () { const b = this.querySelector(".band"); return b.hidden ? null : b; }', false));
  await shoot(name);
  await mouse('mouseReleased', r.x + r.w, r.y + r.h, { button: 'left', buttons: 0, clickCount: 1 });
  const card = await waitCard();
  return { band, card };
}

/** Waits up to six seconds for the comment card to open. */
async function waitCard() {
  for (let i = 0; i < 60; i++) {
    if (await inShadow('function () { return Boolean(this.querySelector(".panel [data-title]")); }')) return true;
    await sleep(100);
  }
  return false;
}

/** Closes the open card with Esc, discarding the untouched draft. */
async function discardCard() {
  await press('Escape', 27);
  await sleep(300);
}

/** The page handler counts, from the main document, its window and the iframe's document. */
const hits = () => evaluate(tab, 'JSON.stringify(window.hits)').then((s) => JSON.parse(s));
const total = (bag) => Object.values(bag).reduce((a, b) => a + b, 0);

/**
 * Navigates the tab and waits for the load event.
 * @param {string} url The address.
 */
async function go(url) {
  const loaded = new Promise((resolve) => handlers.set('Page.loadEventFired', resolve));
  await send('Page.navigate', { url }, tab);
  await Promise.race([loaded, sleep(20000)]);
  await sleep(800);
}

/**
 * Injects the content script into the tab and toggles annotation, the way the toolbar button does, tab zoom included.
 * With `film` the screencast records every painted frame, and the result says how long the full path and the toggle
 * message took to the overlay border and to a hint bar with readable text.
 * @param {string} url The tab's address, used to find it from the service worker.
 * @param {boolean} [film] Whether to time the first paint.
 */
async function toggle(url, film = false) {
  const frames = [];
  if (film) {
    handlers.set('Page.screencastFrame', (params) => {
      frames.push({ ts: params.metadata.timestamp * 1000, data: params.data });
      send('Page.screencastFrameAck', { sessionId: params.sessionId }, tab).catch(() => {});
    });
    await send('Page.startScreencast', { format: 'png', maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 }, tab);
    await sleep(600);
  }
  const t = await evaluate(sw, `(async () => {
    const start = Date.now();
    const [page] = await chrome.tabs.query({ url: '${url}*' });
    let ready = false;
    try { ready = (await chrome.tabs.sendMessage(page.id, { type: 'ping' }))?.ok === true; } catch {}
    if (!ready) await chrome.scripting.executeScript({ target: { tabId: page.id }, files: ['content.js'] });
    const { groups = [] } = await chrome.storage.local.get('groups');
    const zoom = await chrome.tabs.getZoom(page.id).catch(() => 1);
    const toggle = Date.now();
    await chrome.tabs.sendMessage(page.id, { type: 'toggle', groupName: groups[0]?.name, zoom });
    return { start, toggle, answered: Date.now() };
  })()`);
  if (!film) {
    await sleep(500);
    return null;
  }
  await sleep(1500);
  await send('Page.stopScreencast', {}, tab);
  handlers.delete('Page.screencastFrame');
  const read = frames.filter((f) => f.ts >= t.start - 50).map((f) => ({ ...f, ...readFrame(Buffer.from(f.data, 'base64')) }));
  const border = read.find((f) => f.border);
  const text = read.find((f) => f.border && f.box && f.text);
  if (border) writeFileSync(join(OUT, 'paint-first-frame.png'), Buffer.from(border.data, 'base64'));
  return {
    pathToBorder: border ? Math.round(border.ts - t.start) : null,
    toggleToBorder: border ? Math.round(border.ts - t.toggle) : null,
    toggleToText: text ? Math.round(text.ts - t.toggle) : null,
    pathToText: text ? Math.round(text.ts - t.start) : null,
    textOnFirstFrame: Boolean(border && text && text === border),
    framesBetween: text && border ? read.indexOf(text) - read.indexOf(border) : null,
  };
}

/**
 * Runs code in the service worker with the test tab's id in scope as `id`.
 * @param {string} url The tab's address.
 * @param {string} body Statements using `id`, awaited.
 */
const onTab = (url, body) => evaluate(sw, `(async () => { const [page] = await chrome.tabs.query({ url: '${url}*' }); const id = page.id; ${body} })()`);

/** Seeds the storage a review needs, with selector capture on so hovering outlines elements. */
async function seed() {
  await evaluate(sw, `chrome.storage.local.set({
    groups: [{ id: 'g1', name: 'Overlay input check', createdAt: new Date().toISOString() }],
    activeGroupId: 'g1', markerMode: true, selectorMode: true, theme: 'light',
  })`);
}

try {
  const { id } = await send('Extensions.loadUnpacked', { path: COPY });
  console.log(`  loaded extension ${id}`);
  let worker;
  for (let i = 0; i < 50 && !worker; i++) {
    await sleep(200);
    const { targetInfos } = await send('Target.getTargets');
    worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`));
  }
  ({ sessionId: sw } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true }));
  ({ targetId: tabTarget } = await send('Target.createTarget', { url: 'about:blank' }));
  ({ sessionId: tab } = await send('Target.attachToTarget', { targetId: tabTarget, flatten: true }));
  await send('Page.enable', {}, tab);
  await send('DOM.enable', {}, tab);
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false }, tab);
  await send('Fetch.enable', { patterns: [{ urlPattern: `${TEST}*` }] }, tab);
  handlers.set('Fetch.requestPaused', ({ requestId }) => {
    send(
      'Fetch.fulfillRequest',
      { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }], body: Buffer.from(PAGE).toString('base64') },
      tab,
    ).catch(() => {});
  });
  await seed();

  console.log('Time to the hint bar, Smart Spaces demo');
  const runs = [];
  for (let i = 0; i < 4; i++) {
    await go(SITE);
    const run = await toggle(SITE, true);
    runs.push(run);
    console.log(`  run ${i + 1} ${JSON.stringify(run)}`);
  }
  await shoot('01-site-active');
  const median = (key) => {
    const v = runs.map((r) => r[key]).filter((n) => n !== null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  console.log(`  cold run, toggle to text ${runs[0].toggleToText} ms, full path to text ${runs[0].pathToText} ms`);
  console.log(`  median, toggle to border ${median('toggleToBorder')} ms, toggle to text ${median('toggleToText')} ms, full path to text ${median('pathToText')} ms`);
  check(runs.every((r) => r.textOnFirstFrame), 'hint bar text paints on the first frame the overlay shows');

  console.log('Hover on the Smart Spaces demo, 50 moves');
  let misses = 0;
  let wide = 0;
  const started = Date.now();
  for (let i = 0; i < 50; i++) {
    const x = 40 + ((i * 197) % 1180);
    const y = 40 + ((i * 131) % 660);
    await mouse('mouseMoved', x, y);
    const got = await hoverBox();
    const holds = got && x >= got.x - 1 && x <= got.x + got.w + 1 && y >= got.y - 1 && y <= got.y + got.h + 1;
    if (got && got.w >= VIEW.width * 0.95 && got.h >= VIEW.height * 0.95) wide++;
    if (!holds) {
      misses++;
      if (misses <= 5) console.log(`    miss at ${x},${y} got ${fmt(got)}`);
    }
  }
  console.log(`  50 checked moves took ${Date.now() - started} ms, ${wide} picks filled the whole view`);
  check(misses === 0, `hover outline shows under the pointer on every move (${misses} misses)`);
  await send('Performance.enable', {}, tab);
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics', {}, tab)).metrics.map((m) => [m.name, m.value]));
  const m0 = await metrics();
  const bursts = Date.now();
  for (let i = 0; i < 200; i++) await mouse('mouseMoved', 40 + ((i * 37) % 1180), 40 + ((i * 53) % 660));
  const m1 = await metrics();
  const per = (key, scale) => Math.round(((m1[key] - m0[key]) * scale * 100) / 200) / 100;
  console.log(`  200 raw moves took ${Date.now() - bursts} ms`);
  console.log(`  per move, style recalcs ${per('RecalcStyleCount', 1)}, style ms ${per('RecalcStyleDuration', 1000)}, layouts ${per('LayoutCount', 1)}, layout ms ${per('LayoutDuration', 1000)}, script ms ${per('ScriptDuration', 1000)}`);
  await shoot('02-site-hover');

  console.log('Smart Spaces headline under a pointer-events: none layer');
  const h1 = await pageObject('document.querySelector("h1")');
  const h1Box = await boxOf(h1);
  const head = await hoverAt(h1Box.x + h1Box.w * 0.3, h1Box.y + h1Box.h / 2, h1);
  check(head.ok, `hover outlines the headline (got ${fmt(head.got)} want ${fmt(head.want)})`);
  const fullTag = await inShadow('function () { return this.querySelector(".hover").classList.contains("full"); }');
  check(!fullTag, 'the headline pick is not marked as filling the view');
  await shoot('03-site-headline-hover');
  const para = await pageObject('[...document.querySelectorAll("p")].find((p) => /Bespoke home/.test(p.textContent))');
  const paraBox = await boxOf(para);
  const paraHover = await hoverAt(paraBox.x + 40, paraBox.y + paraBox.h / 2, para);
  check(paraHover.ok, `hover outlines the paragraph under the headline (got ${fmt(paraHover.got)} want ${fmt(paraHover.want)})`);
  await mouse('mouseMoved', h1Box.x + h1Box.w * 0.3, h1Box.y + h1Box.h / 2);
  await mouse('mousePressed', h1Box.x + h1Box.w * 0.3, h1Box.y + h1Box.h / 2, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', h1Box.x + h1Box.w * 0.3, h1Box.y + h1Box.h / 2, { button: 'left', buttons: 0, clickCount: 1 });
  check(await waitCard(), 'a click on the headline opens the card');
  const pickedRect = await evaluate(sw, `chrome.storage.local.get(null).then((b) => {
    const list = b.issues ?? Object.entries(b).filter(([k]) => k.startsWith('issue:')).map(([, v]) => v);
    return list.at(-1)?.rect ?? null;
  })`);
  console.log(`  captured rect ${JSON.stringify(pickedRect)}`);
  check(pickedRect && Math.abs(pickedRect.w - h1Box.w) <= 2 && Math.abs(pickedRect.h - h1Box.h) <= 2, 'the click captures the headline, not the whole view');
  const draftFlag = await boxOf(await inShadow('function () { return this.querySelector(".root > .flag.draft:not([data-saving])"); }', false));
  check(draftFlag && draftFlag.y >= 0 && draftFlag.y + draftFlag.h <= VIEW.height, `the draft flag is on screen (${fmt(draftFlag)})`);
  await shoot('04-site-headline-card');
  await discardCard();

  console.log('Hold Alt to use the page');
  const nav = await evaluate(tab, `(() => { const el = [...document.querySelectorAll('a, button')].find((e) => /^services/i.test(e.textContent.trim())); if (!el) return null; const b = el.getBoundingClientRect(); window.__nav = el; return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  check(Boolean(nav), 'found the Services nav item');
  if (nav) {
    await mouse('mouseMoved', nav.x, nav.y);
    check(!(await evaluate(tab, 'window.__nav.matches(":hover")')), 'without Alt the overlay holds the pointer and the nav item is not hovered');
    await alt(true);
    await mouse('mouseMoved', nav.x + 2, nav.y, { modifiers: 1 });
    await sleep(400);
    check(await evaluate(tab, 'window.__nav.matches(":hover")'), 'holding Alt lets the page hover the Services nav item');
    const passHint = await inShadow('function () { return this.querySelector(".pass")?.textContent.trim(); }');
    check(passHint === 'Hold Alt to use the page', `the hint bar says ${JSON.stringify(passHint)}`);
    await shoot('05-site-alt-hover-nav');
    await alt(false);
    await mouse('mouseMoved', nav.x, nav.y + 1);
    await sleep(200);
    check(!(await evaluate(tab, 'window.__nav.matches(":hover")')) && (await hoverBox()) !== null, 'letting go of Alt gives the pointer back to the overlay');
  }

  console.log('Typing into a page field and Esc');
  await evaluate(sw, `chrome.storage.local.set({ selectorMode: true, markerMode: true })`);
  await onTab(SITE, `await chrome.tabs.sendMessage(id, { type: 'stop' })`);
  await go(TEST);
  await evaluate(tab, 'field.focus(), 1');
  await toggle(TEST);
  await typeKeys('smash 12');
  const typed = await evaluate(tab, 'field.value');
  const modes = await inShadow('function () { return [this.querySelector("[data-selectors]").getAttribute("aria-pressed"), this.querySelector("[data-markers]").getAttribute("aria-pressed")].join(","); }');
  check(typed === 'smash 12', `typing smash 12 into a page field types it (${JSON.stringify(typed)})`);
  check(modes === 'true,true', `S and M typed into the field left Selectors and Markers alone (${modes})`);
  await press('Escape', 27);
  check(await annotating(), 'Esc in a page field goes to the page and does not stop annotating');
  await evaluate(tab, 'field.blur(), 1');

  console.log('Test page with an iframe, html zoom 0.8, a manual popover and a modal dialog');
  const zoom = await inShadow('function () { return this.querySelector(".root").currentCSSZoom; }');
  check(Math.abs(zoom - 1) < 0.01, `overlay renders at zoom 1 on a page with html zoom 0.8 (${zoom})`);
  const hintBox = await boxOf(await inShadow('function () { return this.querySelector(".hint"); }', false));
  console.log(`  hint bar ${fmt(hintBox)}`);
  check(hintBox && Math.abs(hintBox.h - 40) < 1.5, `hint bar is 40px tall on screen (${hintBox?.h})`);
  await shoot('06-test-active');

  const overFrame = await hoverAt(640, 400);
  check(overFrame.ok, `hover outlines the iframe (got ${fmt(overFrame.got)} want ${fmt(overFrame.want)})`);
  check(await inShadow('function () { return this.querySelector(".hover").classList.contains("full"); }'), 'the iframe pick says it fills the whole view');
  await shoot('07-test-hover-iframe');
  const frameDrag = await dragRegion({ x: 300, y: 200, w: 320, h: 160 }, '08-test-drag-iframe');
  check(near(frameDrag.band, { x: 300, y: 200, w: 320, h: 160 }), `drag band over the iframe sits under the pointer (${fmt(frameDrag.band)})`);
  check(frameDrag.card, 'drag over the iframe opens the card');
  await discardCard();
  check(total(await hits()) === 0, `no page or iframe handler fired over the iframe ${JSON.stringify(await hits())}`);

  const panelBox = await boxOf(await pageObject('panel'));
  await mouse('mouseMoved', panelBox.x + 100, panelBox.y + 100);
  await mouse('mouseWheel', panelBox.x + 100, panelBox.y + 100, { deltaX: 0, deltaY: 240 });
  await sleep(400);
  const scrolled = await evaluate(tab, 'panel.scrollTop');
  check(scrolled > 0, `the wheel over the overlay scrolls the inner panel under the pointer (scrollTop ${scrolled})`);

  await evaluate(tab, 'pop.showPopover(), 1');
  await sleep(300);
  const popScreen = await boxOf(await pageObject('pb'));
  const px = popScreen.x + popScreen.w / 2;
  const py = popScreen.y + popScreen.h / 2;
  const overPop = await hoverAt(px, py);
  check(overPop.ok, `hover outlines the popover button above the overlay (got ${fmt(overPop.got)} want ${fmt(overPop.want)})`);
  await shoot('09-test-hover-popover');
  const popDrag = await dragRegion({ x: px - 40, y: py - 30, w: 300, h: 120 }, '10-test-drag-popover');
  check(near(popDrag.band, { x: px - 40, y: py - 30, w: 300, h: 120 }), `drag starting on the popover shows the band (${fmt(popDrag.band)})`);
  check(popDrag.card, 'drag starting on the popover opens the card');
  await discardCard();
  check(total(await hits()) === 0, `no page handler fired with the popover open ${JSON.stringify(await hits())}`);

  await evaluate(tab, 'pop.hidePopover(), dlg.showModal(), 1');
  await sleep(300);
  const dlgScreen = await boxOf(await pageObject('db'));
  const dx = dlgScreen.x + dlgScreen.w / 2;
  const dy = dlgScreen.y + dlgScreen.h / 2;
  const overDialog = await hoverAt(dx, dy);
  check(overDialog.ok, `hover outlines the modal dialog button (got ${fmt(overDialog.got)} want ${fmt(overDialog.want)})`);
  await shoot('11-test-hover-dialog');
  const dlgDrag = await dragRegion({ x: dx - 60, y: dy - 50, w: 360, h: 140 }, '12-test-drag-dialog');
  check(near(dlgDrag.band, { x: dx - 60, y: dy - 50, w: 360, h: 140 }), `drag starting on the modal dialog shows the band (${fmt(dlgDrag.band)})`);
  check(dlgDrag.card, 'drag starting on the modal dialog opens the card');
  await shoot('13-test-card-over-dialog');
  if (dlgDrag.card) {
    await send('Input.insertText', { text: 'Typed over a modal dialog' }, tab);
    const title = await inShadow('function () { return this.querySelector(".panel [data-title]").value; }');
    check(title === 'Typed over a modal dialog', `the card's title takes typing over a modal dialog (${JSON.stringify(title)})`);
    await press('Escape', 27);
    await sleep(200);
    const confirm = await boxOf(await inShadow('function () { return this.querySelector("[data-confirm]"); }', false));
    if (confirm) {
      await mouse('mouseMoved', confirm.x + confirm.w / 2, confirm.y + confirm.h / 2);
      await mouse('mousePressed', confirm.x + confirm.w / 2, confirm.y + confirm.h / 2, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse('mouseReleased', confirm.x + confirm.w / 2, confirm.y + confirm.h / 2, { button: 'left', buttons: 0, clickCount: 1 });
      await sleep(300);
    }
    check(!(await inShadow('function () { return Boolean(this.querySelector(".panel")); }')), 'the card closes with a click on Discard over the dialog');
  }
  check(total(await hits()) === 0, `no page handler fired with the modal dialog open ${JSON.stringify(await hits())}`);
  check(await evaluate(tab, 'dlg.open'), 'the page dialog is still open, untouched by the overlay');
  await press('Escape', 27);
  await sleep(300);
  check(!(await evaluate(tab, 'dlg.open')) && (await annotating()), 'one Esc closes the page dialog and annotating carries on');

  const after = await hoverAt(640, 400);
  check(after.ok, `hover still works after the dialog closes (got ${fmt(after.got)} want ${fmt(after.want)})`);
  const afterDrag = await dragRegion({ x: 200, y: 160, w: 300, h: 140 }, '14-test-drag-after-close');
  check(afterDrag.card, 'drag after the dialog closes opens the card');
  await discardCard();

  await evaluate(tab, 'document.querySelector("div[popover]:not(#pop)")?.remove(), 1');
  await sleep(100);
  const back = await evaluate(tab, 'Boolean(document.querySelector("div[popover]:not(#pop)")?.matches(":popover-open"))');
  const lostDrag = await dragRegion({ x: 220, y: 180, w: 280, h: 120 }, '15-test-drag-after-removal');
  check(back && lostDrag.card, 'when the page removes the overlay host it comes straight back, and a drag over the iframe still opens the card');
  await discardCard();
  check(total(await hits()) === 0, `no page handler fired across the whole test page run ${JSON.stringify(await hits())}`);
  await press('Escape', 27);
  check(!(await annotating()), 'with nothing open on the page or the overlay, Esc stops annotating');

  console.log('Fifty percent tab zoom');
  await go(SITE);
  await onTab(SITE, 'await chrome.tabs.setZoom(id, 0.5)');
  await sleep(500);
  await toggle(SITE);
  const half = await boxOf(await inShadow('function () { return this.querySelector(".hint"); }', false));
  console.log(`  hint bar in page pixels ${fmt(half)}`);
  check(half && Math.abs(half.h - 80) < 2, `at 50 percent the hint bar keeps its 40px size on screen (${half?.h} page px)`);
  const probe = evaluate(tab, `new Promise((resolve) => { addEventListener('mousemove', (e) => resolve(e.clientX), { once: true, capture: true }); })`);
  await mouse('mouseMoved', 300, 300);
  const k = (await probe) / 300;
  console.log(`  one input pixel is ${k} page pixels`);
  const zh1 = await pageObject('document.querySelector("h1")');
  const zh1Box = await boxOf(zh1);
  const zHead = await hoverAt((zh1Box.x + zh1Box.w * 0.3) / k, (zh1Box.y + zh1Box.h / 2) / k, zh1);
  check(zHead.ok, `at 50 percent the hover outline lines up with the headline (got ${fmt(zHead.got)} want ${fmt(zHead.want)})`);
  const zr = { x: 200, y: 160, w: 260, h: 120 };
  const zDrag = await dragRegion(zr, '16-site-zoom50-drag');
  check(near(zDrag.band, { x: zr.x * k, y: zr.y * k, w: zr.w * k, h: zr.h * k }, 2), `at 50 percent the drag band sits under the pointer (${fmt(zDrag.band)})`);
  check(zDrag.card, 'at 50 percent the drag opens the card');
  const zCard = await boxOf(await inShadow('function () { return this.querySelector(".panel"); }', false));
  check(zCard && Math.abs(zCard.w - 720) < 3, `at 50 percent the card keeps its 360px size on screen (${zCard?.w} page px)`);
  await shoot('17-site-zoom50-card');
  await discardCard();
  await onTab(SITE, 'await chrome.tabs.setZoom(id, 1)');
  await sleep(600);
  const full = await boxOf(await inShadow('function () { return this.querySelector(".hint"); }', false));
  check(full && Math.abs(full.h - 40) < 1.5, `back at 100 percent while annotating, the hint bar follows the zoom change (${full?.h})`);
  await onTab(SITE, `await chrome.tabs.sendMessage(id, { type: 'stop' })`);

  console.log('Capture states');
  await go(SITE);
  await toggle(SITE);
  await evaluate(sw, `chrome.storage.local.set({ selectorMode: false })`);
  await sleep(200);
  const sr = await shadowRoot();
  const { root: doc } = await send('DOM.getDocument', { depth: -1, pierce: true }, tab);
  const ids = {};
  const find = (node) => {
    const attrs = node.attributes ?? [];
    if (attrs.includes('data-saving')) ids.flag = node.nodeId;
    if (attrs[attrs.indexOf('class') + 1]?.startsWith('root') && attrs.includes('data-theme')) ids.root = node.nodeId;
    for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) find(child);
  };
  find(doc);
  const changes = [];
  handlers.set('DOM.attributeModified', (p) => changes.push({ node: p.nodeId, name: p.name, value: p.value }));
  handlers.set('DOM.attributeRemoved', (p) => changes.push({ node: p.nodeId, name: p.name, value: null }));
  const r = { x: 832, y: 646, w: 300, h: 100 };
  await mouse('mouseMoved', r.x, r.y);
  await mouse('mousePressed', r.x, r.y, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseMoved', r.x + r.w, r.y + r.h, { button: 'left', buttons: 1 });
  await mouse('mouseReleased', r.x + r.w, r.y + r.h, { button: 'left', buttons: 0, clickCount: 1 });
  const seen = { busy: false, passThrough: false };
  for (let i = 0; i < 80; i++) {
    const s = await inShadow(
      `function () {
        const root = this.querySelector('.root');
        return { capturing: root.classList.contains('capturing'), cursor: getComputedStyle(this.host).cursor,
          events: getComputedStyle(root).pointerEvents, card: Boolean(this.querySelector('.panel')) };
      }`,
      true,
      sr,
    );
    if (s.capturing && s.cursor === 'progress') seen.busy = true;
    if (s.capturing && s.events === 'none') seen.passThrough = true;
    if (s.card) break;
    await sleep(15);
  }
  await sleep(300);
  handlers.delete('DOM.attributeModified');
  handlers.delete('DOM.attributeRemoved');
  let capturing = false;
  let shownWhileCapturing = false;
  let shownAfter = false;
  const order = [];
  for (const c of changes) {
    if (c.node === ids.root && c.name === 'class') {
      capturing = /capturing/.test(c.value ?? '');
      order.push(`root class "${c.value}"`);
    }
    if (c.node === ids.flag && c.name === 'hidden') {
      order.push(c.value === null ? 'Saving flag shown' : 'Saving flag hidden');
      if (c.value === null && capturing) shownWhileCapturing = true;
      if (c.value === null && !capturing) shownAfter = true;
    }
  }
  console.log(`  ${JSON.stringify(seen)}`);
  console.log(`  order: ${order.join(', ')}`);
  check(seen.busy, 'a busy cursor shows while the screenshot is taken');
  check(seen.passThrough, 'the hidden overlay root takes no pointer events while capturing');
  check(shownAfter, 'the Saving flag shows on the region once the screenshot is back');
  check(!shownWhileCapturing, 'the Saving flag is never shown while the overlay is hidden for the screenshot');
  await shoot('18-site-card');
  await discardCard();

  const h = { x: 200, y: 160, w: 300, h: 120 };
  await mouse('mouseMoved', h.x, h.y);
  await mouse('mousePressed', h.x, h.y, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseMoved', h.x + h.w, h.y + h.h, { button: 'left', buttons: 1 });
  const { targetId: other } = await send('Target.createTarget', { url: 'about:blank' });
  await send('Target.activateTarget', { targetId: other });
  await sleep(300);
  const hidden = await evaluate(tab, 'document.visibilityState');
  await mouse('mouseReleased', h.x + h.w, h.y + h.h, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2500);
  const stuck = await inShadow('function () { return this.querySelector(".root").classList.contains("capturing"); }');
  await send('Target.activateTarget', { targetId: tabTarget });
  await send('Target.closeTarget', { targetId: other });
  const backAt = Date.now();
  const cardBack = await waitCard();
  const settled = Date.now() - backAt;
  const outcome = await inShadow(`function () {
    const e = this.querySelector('.panel [data-error]');
    return { capturing: this.querySelector('.root').classList.contains('capturing'),
      error: e && !e.hidden ? this.querySelector('[data-error-head]').textContent + ' ' + this.querySelector('[data-error-body]').textContent : null };
  }`);
  console.log(`  tab was ${hidden} during the capture, still capturing while hidden ${stuck}, card ${settled} ms after coming back, error ${JSON.stringify(outcome.error)}`);
  if (hidden === 'hidden') {
    check(cardBack && !outcome.capturing && settled < 2000, 'a capture started in a hidden tab finishes cleanly within two seconds of coming back');
  } else console.log('  headless Chrome kept the tab visible, so the hidden tab case was not exercised');
  await shoot('19-site-hidden-capture');
  if (await inShadow('function () { return Boolean(this.querySelector(".panel")); }')) {
    await press('Escape', 27);
    await sleep(200);
  }
  await onTab(SITE, `await chrome.tabs.sendMessage(id, { type: 'stop' })`);

  console.log('MDN slash search');
  await go(MDN);
  await sleep(1500);
  await evaluate(sw, `chrome.storage.local.set({ selectorMode: true, markerMode: true })`);
  await toggle(`${new URL(MDN).origin}/`);
  await mouse('mouseMoved', 640, 400);
  await press('/', 191, 'Slash');
  await sleep(1200);
  const layerInfo = await evaluate(tab, `(() => {
    const modal = document.querySelector('dialog:modal');
    const pops = [...document.querySelectorAll(':popover-open')].filter((el) => el.style.zIndex !== '2147483647');
    const a = document.activeElement;
    return { modal: Boolean(modal), popovers: pops.length, active: a ? a.localName + (a.type ? '[' + a.type + ']' : '') : null };
  })()`);
  console.log(`  after slash ${JSON.stringify(layerInfo)}`);
  await shoot('20-mdn-search-open');
  await typeKeys('smash 12');
  const mdnTyped = await evaluate(tab, '(() => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a?.value ?? null; })()');
  const mdnModes = await inShadow('function () { return [this.querySelector("[data-selectors]").getAttribute("aria-pressed"), this.querySelector("[data-markers]").getAttribute("aria-pressed")].join(","); }');
  check(mdnTyped === 'smash 12', `typing into the MDN search types smash 12 (${JSON.stringify(mdnTyped)})`);
  check(mdnModes === 'true,true', `Selectors and Markers stay as they were (${mdnModes})`);
  const mdnDrag = await dragRegion({ x: 300, y: 300, w: 320, h: 160 }, '21-mdn-drag-over-search');
  check(near(mdnDrag.band, { x: 300, y: 300, w: 320, h: 160 }), `with the search open the drag band follows the pointer (${fmt(mdnDrag.band)})`);
  check(mdnDrag.card, 'with the search open the drag opens the card, so Margin is on top');
  const titleFocused = await inShadow('function () { return this.activeElement === this.querySelector(".panel [data-title]"); }');
  check(titleFocused, 'the card title has focus over the MDN search, so the overlay is not inert');
  await shoot('22-mdn-card-over-search');
  await discardCard();
  await press('Escape', 27);
  await sleep(400);
  const closed = await evaluate(tab, `!document.querySelector('dialog:modal') && ![...document.querySelectorAll(':popover-open')].some((el) => el.style.zIndex !== '2147483647')`);
  check(await annotating(), `Esc with the search open goes to MDN and annotating carries on (search closed ${closed})`);
  await shoot('23-mdn-after-esc');
} catch (err) {
  failures.push(err.message);
  console.log(`  FAIL ${err.message}`);
  await shoot('zz-failure').catch(() => {});
} finally {
  await send('Browser.close').catch(() => {});
  await sleep(1500);
  if (chrome.exitCode === null) chrome.kill();
  try {
    rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.log('  Chrome still holds the profile folder, it is cleared on the next run');
  }
}

console.log(failures.length ? `${failures.length} checks failed` : 'All checks passed');
process.exitCode = failures.length ? 1 : 0;
