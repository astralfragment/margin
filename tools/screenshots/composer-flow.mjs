import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks the on-page comment composer on the Smart Spaces demo site in headless Chrome, with the chrome stub and the real
 * background handlers loaded into the page. Extension files are served from the page's own origin under /__margin/ by
 * intercepting those requests, so fonts and icons load the way they would from the extension.
 * Screenshots land in dist/redesign-shots/composer. Run with node tools/screenshots/composer-flow.mjs.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = join(ROOT, 'dist', 'redesign-shots', 'composer');
const WORK = join(ROOT, 'dist', '.composer');
const SITE = 'https://smart-spaces-demo.vercel.app/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9337;
const VIEW = { width: 1280, height: 800 };
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const STUB = readFileSync(join(ROOT, 'tools', 'screenshots', 'stub.js'), 'utf8');
const CONTENT = readFileSync(join(ROOT, 'extension', 'content.js'), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];

/**
 * Records a check, printed at the end.
 * @param {boolean} ok Whether it held.
 * @param {string} what What was checked.
 */
function check(ok, what) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
}

/** Routes messages to the real background handlers with a sender tab, and lets a test refuse the next screenshot. */
const EXTRA = `(() => {
  const c = window.chrome;
  const listeners = [];
  const tab = () => ({ id: 1, windowId: 1, index: 0, url: location.href, title: document.title });
  c.runtime.getURL = (path) => location.origin + '/__margin/extension/' + path;
  c.runtime.onMessage = { addListener: (fn) => listeners.push(fn) };
  c.runtime.sendMessage = (msg) => new Promise((resolve) => {
    for (const fn of listeners) if (fn(msg, { tab: tab() }, resolve)) return;
    resolve({ ok: true });
  });
  c.tabs.get = async (id) => ({ ...tab(), id });
  c.tabs.getZoom = async () => 1;
  c.tabs.sendMessage = async () => ({ ok: true });
  const realCapture = c.tabs.captureVisibleTab;
  c.tabs.captureVisibleTab = async (...args) => {
    if (window.__failCapture) throw new Error("Either the '<all_urls>' or 'activeTab' permission is required.");
    return realCapture(...args);
  };
  window.__bg = import('/__margin/extension/background.js');
})();`;

/** A minimal DevTools protocol client over the WebSocket built into Node. */
class Cdp {
  /** @param {string} url The target's WebSocket address. */
  static async open(url) {
    const cdp = new Cdp();
    cdp.ws = new WebSocket(url);
    cdp.next = 0;
    cdp.pending = new Map();
    cdp.waiters = [];
    cdp.handlers = {};
    cdp.ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        cdp.handlers[msg.method]?.(msg.params);
        cdp.waiters = cdp.waiters.filter((w) => (w.method === msg.method ? (w.resolve(msg.params), false) : true));
      }
    });
    await new Promise((resolve) => cdp.ws.addEventListener('open', resolve, { once: true }));
    return cdp;
  }

  /**
   * Sends one protocol command and waits for its result.
   * @param {string} method The protocol method.
   * @param {object} [params] Its parameters.
   */
  send(method, params = {}) {
    const id = ++this.next;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  /**
   * Waits for the next event with a given name.
   * @param {string} method The event name.
   */
  once(method) {
    return new Promise((resolve) => this.waiters.push({ method, resolve }));
  }
}

let page;
let bootScript = null;
const pageErrors = [];

/**
 * Runs an expression in the page and returns its value.
 * @param {string} expression JavaScript to evaluate, awaited if it returns a promise.
 */
async function evaluate(expression) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/**
 * Polls the page until an expression is truthy.
 * @param {string} expression The condition.
 * @param {number} [tries] How many 100ms polls to allow.
 */
async function until(expression, tries = 100) {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(expression).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${expression.slice(0, 160)}`);
}

/**
 * Sets the page size and colour scheme.
 * @param {number} width CSS pixels.
 * @param {number} height CSS pixels.
 */
async function size(width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}

/**
 * Saves the viewport as a PNG in the output folder.
 * @param {string} name The file name without extension.
 */
async function shoot(name) {
  await sleep(350);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  ${name}.png${pageErrors.length ? `  page errors: ${pageErrors.splice(0).join(' | ')}` : ''}`);
}

/**
 * Saves a magnified crop of the viewport, for checking small details such as flags and dashes.
 * @param {string} name The file name without extension.
 * @param {{x:number,y:number,width:number,height:number}} clip The area in viewport pixels.
 */
async function detail(name, clip) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 3 } });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  ${name}.png`);
}

/**
 * Sends one real mouse event through the browser.
 * @param {string} type mouseMoved, mousePressed or mouseReleased.
 * @param {number} x Viewport x.
 * @param {number} y Viewport y.
 * @param {object} [extra] Button, buttons and click count.
 */
async function mouse(type, x, y, extra = {}) {
  await page.send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), ...extra });
}

/**
 * Clicks at a point with a real press and release.
 * @param {number} x Viewport x.
 * @param {number} y Viewport y.
 * @param {'left' | 'right'} [button] Which button.
 */
async function click(x, y, button = 'left') {
  const buttons = button === 'left' ? 1 : 2;
  await mouse('mouseMoved', x, y);
  await mouse('mousePressed', x, y, { button, buttons, clickCount: 1 });
  await mouse('mouseReleased', x, y, { button, buttons: 0, clickCount: 1 });
  await sleep(200);
}

/**
 * Drags with the left button from one point to another, optionally leaving the button down.
 * @param {{x:number,y:number,w:number,h:number}} r The box to drag out.
 * @param {boolean} [release] False to stop before letting go.
 */
async function drag(r, release = true) {
  await mouse('mouseMoved', r.x, r.y);
  await mouse('mousePressed', r.x, r.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) {
    await mouse('mouseMoved', r.x + (r.w * i) / 10, r.y + (r.h * i) / 10, { button: 'left', buttons: 1 });
    await sleep(20);
  }
  if (release) await mouse('mouseReleased', r.x + r.w, r.y + r.h, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
}

/**
 * Presses one key in the page, as a person would.
 * @param {string} key The key name, such as 2, Tab, Enter or Escape.
 * @param {number} [modifiers] CDP modifier bits, 2 for Ctrl.
 */
async function press(key, modifiers = 0) {
  const single = key.length === 1;
  const codes = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38 };
  const code = single ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key;
  const vk = single ? key.toUpperCase().charCodeAt(0) : codes[key];
  const text = single ? key : key === 'Enter' ? '\r' : undefined;
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: modifiers ? undefined : text, modifiers });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
  await sleep(200);
}

/**
 * Types text into the focused field.
 * @param {string} text The words.
 */
async function type(text) {
  await page.send('Input.insertText', { text });
  await sleep(80);
}

const sh = (selector) => `window.__shadow.querySelector(${JSON.stringify(selector)})`;

/**
 * The bounding box of an element in the overlay, in viewport pixels.
 * @param {string} selector A selector inside the shadow root.
 */
async function box(selector) {
  return evaluate(`(() => { const b = ${sh(selector)}.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; })()`);
}

/**
 * Clicks the middle of an element in the overlay.
 * @param {string} selector A selector inside the shadow root.
 */
async function tap(selector) {
  const b = await box(selector);
  await click(b.x + b.w / 2, b.y + b.h / 2);
}

/** Finds the areas of the demo page that the Figma frames mark up. */
const MEASURE = `(() => {
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const visible = (el) => el.getBoundingClientRect().width > 0;
  const byText = (re, sel = 'a, button, p, span, div, h1, h2') => [...document.querySelectorAll(sel)].filter(visible).find((el) => re.test(el.textContent.trim()) && el.children.length < 4);
  return {
    consult: box(byText(/^book a consultation$/i, 'a, button')),
    lights: box(byText(/lights on/i, 'button, a')),
    h1: box(document.querySelector('h1')),
  };
})()`;

/**
 * Boot code for the demo site: seeded storage, an open shadow root to inspect, the chrome stub and the background handlers.
 * @param {object} seed Storage contents for the chrome stub.
 * @param {string} capture A stand-in screenshot.
 */
function boot(seed, capture) {
  const shadow = 'const attach = Element.prototype.attachShadow; Element.prototype.attachShadow = function (init) { const root = attach.call(this, { ...init, mode: "open" }); if (this.hasAttribute("popover")) window.__shadow = root; return root; };';
  return `window.__SEED = ${JSON.stringify(seed)}; window.__CAPTURE = ${JSON.stringify(capture)}; ${shadow}\n${STUB}\n${EXTRA}`;
}

/**
 * Loads the demo site with the harness, then injects the content script and starts annotating.
 * @param {object} seed Storage contents.
 * @param {string} capture A stand-in screenshot.
 */
async function start(seed, capture) {
  if (bootScript) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: bootScript });
  ({ identifier: bootScript } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: boot(seed, capture) }));
  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url: SITE });
  await Promise.race([loaded, sleep(20000)]);
  await sleep(1200);
  await evaluate('window.__bg.then(() => 1)');
  await evaluate(CONTENT);
  await evaluate('window.__uiAnnotator.setActive(true)');
  await until(`${sh('.root:not([hidden])')} && ${sh('[data-count]')}.textContent`);
  await evaluate('document.fonts.ready.then(() => 1)');
  await sleep(400);
}

/** The stored issues, with whether each has a screenshot under its own image key and whether any image was left in the list. */
const issues = () => evaluate(`window.__bag.issues.map((issue) => ({ ...issue, hasShot: Boolean(window.__bag['img:' + issue.id]?.shot), inline: 'shot' in issue || 'detail' in issue }))`);

mkdirSync(WORK, { recursive: true });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const profile = join(WORK, 'profile');
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  'about:blank',
]);

let browser;
try {
  let targets = [];
  for (let i = 0; i < 50 && !targets.some((t) => t.type === 'page'); i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json()).catch(() => []);
  }
  page = await Cdp.open(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  browser = await Cdp.open((await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.json())).webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  page.handlers['Runtime.exceptionThrown'] = (p) => pageErrors.push(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text).split('\n')[0]);
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/__margin/*' }] });
  page.handlers['Fetch.requestPaused'] = ({ requestId, request }) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(request.url).pathname.replace(/^\/__margin\//, ''))));
    if (!path.startsWith(ROOT) || !existsSync(path)) {
      page.send('Fetch.fulfillRequest', { requestId, responseCode: 404, body: '' }).catch(() => {});
      return;
    }
    page
      .send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: TYPES[extname(path)] ?? 'application/octet-stream' }],
        body: readFileSync(path).toString('base64'),
      })
      .catch(() => {});
  };
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await size(VIEW.width, VIEW.height);

  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url: SITE });
  await Promise.race([loaded, sleep(20000)]);
  await sleep(1500);
  const at = await evaluate(MEASURE);
  const { data: raw } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
  const capture = `data:image/jpeg;base64,${raw}`;
  console.log(`  measured ${JSON.stringify(at)}`);

  const now = Date.now();
  const comment = (id, minutes, fields) => ({
    id, groupId: 'g1', createdAt: new Date(now - minutes * 60000).toISOString(), status: 'open', links: [], marks: [], note: '',
    page: { url: SITE, title: 'Smart Spaces' }, viewport: { ...VIEW, scrollY: 0, dpr: 1 }, element: null, anchor: null, severity: 'major', ...fields,
  });
  const grow = (b, m) => ({ x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 });
  const frames = [
    { id: '12:1', name: 'Hero, desktop 1440', page: 'Home' },
    { id: '12:2', name: 'Hero, mobile 375', page: 'Home' },
    { id: '12:3', name: 'Services grid', page: 'Home' },
    { id: '14:1', name: 'Contact form', page: 'Contact page' },
    { id: '14:2', name: 'Contact map', page: 'Contact page' },
    { id: '14:3', name: 'Contact, mobile 375', page: 'Contact page' },
    { id: '14:4', name: 'Footer', page: 'Contact page' },
  ];
  const seed = {
    groups: [{
      id: 'g1', name: 'Smart Spaces homepage QA', createdAt: new Date(now - 7200000).toISOString(),
      figma: { fileKey: 'mwtApSfmf8FTZP8MSwWc05', url: 'https://www.figma.com/design/mwtApSfmf8FTZP8MSwWc05/Margin', name: 'Smart Spaces website', frames, fetchedAt: new Date(now).toISOString() },
    }],
    activeGroupId: 'g1',
    selectorMode: false,
    markerMode: true,
    theme: 'light',
    issues: [
      comment('s1', 50, { title: 'Hero headline wraps early', severity: 'minor', rect: { x: 400, y: 24, w: 300, h: 40 }, page: { url: `${SITE}journal/`, title: 'Journal' } }),
      comment('s2', 40, { title: 'Light switch label is hard to read', severity: 'minor', rect: at.lights ? grow(at.lights, 4) : { x: 24, y: 248, w: 332, h: 50 } }),
      comment('s3', 30, {
        title: 'Consultation buttons shout in caps', severity: 'major', status: 'fixed',
        rect: at.consult ? grow(at.consult, 6) : { x: 1016, y: 16, w: 236, h: 50 },
        figmaFrame: { fileKey: 'mwtApSfmf8FTZP8MSwWc05', nodeId: '12:1', name: 'Home hero', page: 'Home' },
      }),
    ],
  };
  const strip = { x: 832, y: 646, w: 424, h: 106 };

  console.log('Composer');
  await start(seed, capture);
  check((await evaluate(`${sh('[data-count]')}.textContent`)) === '3 comments', 'hint bar counts the review');
  check((await evaluate(`${sh('[data-group]')}.textContent`)) === 'Smart Spaces homepage QA', 'hint bar names the review');
  check((await evaluate(`window.__shadow.querySelectorAll('.saved').length`)) === 2, 'two flags for this page, none for the journal comment');
  check(await evaluate(`document.fonts.check('600 13px "Margin Manrope"')`), 'Manrope loads from the extension');
  await shoot('01-idle');

  await drag(strip, false);
  await shoot('02-drag');
  await mouse('mouseReleased', strip.x + strip.w, strip.y + strip.h, { button: 'left', buttons: 0, clickCount: 1 });
  await until(`${sh('.panel [data-title]')}`);
  await sleep(300);
  const card = await box('.panel');
  check(card.r <= strip.x - 12 + 1, `card sits left of the area, never over it (card right ${Math.round(card.r)}, area left ${strip.x})`);
  check(card.b <= VIEW.height - 64 + 1, 'card stays clear of the hint bar');
  check(await evaluate(`window.__shadow.activeElement === ${sh('[data-title]')}`), 'title is focused');
  check(await evaluate(`${sh('[data-save]')}.disabled`), 'Save is off until there is a title');
  check((await evaluate(`${sh('.panel-head .flag')}.textContent`)) === '04', 'draft is numbered 04');
  await shoot('03-composer-empty');

  await type('Hero thumbnails look like decoration');
  await press('4');
  check(
    (await evaluate(`${sh('.seg [aria-pressed="true"]')}.dataset.sev`)) === 'major' && (await evaluate(`${sh('[data-title]')}.value`)).endsWith('4'),
    'digits typed in the title stay in the title',
  );
  await evaluate(`(() => { const t = ${sh('[data-title]')}; t.value = t.value.slice(0, -1); t.dispatchEvent(new Event('input')); })()`);
  await press('Tab');
  await press('2');
  check((await evaluate(`${sh('.seg [aria-pressed="true"]')}.dataset.sev`)) === 'major', '2 picks Major when focus is out of the text fields');
  await tap('[data-add-note]');
  await type('The strip should read as a gallery. Add an arrow and a 1 of 4 count so people know more projects follow.');
  await press('Enter');
  check((await evaluate(`${sh('[data-note]')}.value`)).includes('\n'), 'Enter in the note makes a new line');
  await evaluate(`(() => { const n = ${sh('[data-note]')}; n.value = n.value.replace(/\\n$/, ''); n.dispatchEvent(new Event('input')); })()`);
  await tap('[data-add-marker]');
  check(/Click inside the area to place marker 1/.test(await evaluate(`${sh('[data-place]')}.textContent`)), 'Add marker asks for a click inside the area');
  await shoot('04-placing-marker');
  await click(strip.x + strip.w - 32, strip.y + 60);
  await type('No arrow hints at more projects');
  await click(strip.x + strip.w - 60, strip.y + 18);
  await type('Only this caption names the project');
  check((await evaluate(`window.__shadow.querySelectorAll('.root > .pin').length`)) === 2, 'two numbered pins on the page');
  await tap('[data-add-frame]');
  await until(`!${sh('[data-picker]')}.hidden`);
  check((await evaluate(`${sh('.picker-page')}.textContent`)) === 'Home', 'frame list opens on the best page for this address');
  check(/Contact page, 4 frames/.test(await evaluate(`${sh('[data-picker-list]')}.textContent`)), 'other pages fold into one line');
  await shoot('05-frame-picker');
  await type('desk');
  await press('Enter');
  check((await evaluate(`${sh('[data-frame] b')}.textContent`)) === 'Hero, desktop 1440', 'frame picked from the search');
  await evaluate(`window.__shadow.activeElement?.blur(); 1`);
  await shoot('06-composer-filled');

  await press('Escape');
  check(/Discard comment 04, its note and 2 markers\?/.test(await evaluate(`${sh('[data-foot]')}.textContent`)), 'Esc on a filled draft asks in place');
  check(await evaluate(`window.__shadow.activeElement === ${sh('[data-keep]')}`), 'Keep editing is the default');
  await shoot('07-discard-ask');
  await press('Escape');
  check(await evaluate(`Boolean(${sh('[data-save]')})`), 'Esc again keeps the draft');

  await evaluate(`${sh('[data-title]')}.focus()`);
  await press('Enter');
  await until(`!${sh('.panel')} && ${sh('.saved-toast')}`);
  const saved = (await issues()).find((i) => i.title === 'Hero thumbnails look like decoration');
  check(saved?.severity === 'major', 'saved as Major');
  check(saved?.note.startsWith('The strip should read as a gallery'), 'note saved');
  check(saved?.marks.length === 2 && saved.marks.every((m) => m.note), `two markers with notes saved (${saved?.marks.length})`);
  check(saved?.figmaFrame?.nodeId === '12:1' && saved.figmaFrame.fileKey === 'mwtApSfmf8FTZP8MSwWc05' && saved.figmaFrame.name === 'Hero, desktop 1440', 'figmaFrame stored');
  check(saved?.links.includes('https://www.figma.com/design/mwtApSfmf8FTZP8MSwWc05/?node-id=12-1'), 'frame URL added to links');
  check(saved?.hasShot === true && saved.inline === false, 'screenshot stored under its own image key, not in the list');
  const figma = await evaluate(`import('/__margin/extension/lib/figma.js').then((m) => m.figmaTargets(window.__bag.issues.find((i) => i.title === 'Hero thumbnails look like decoration')))`);
  check(figma.targets[0]?.nodeId === '12:1', 'Post to Figma reads the frame from the links');
  check((await evaluate(`${sh('[data-count]')}.textContent`)) === '4 comments', 'count goes up after save');
  check((await evaluate(`[...window.__shadow.querySelectorAll('.saved .flag')].map((f) => f.textContent).join(',')`)) === '02,03,04', 'saved flag 04 is on the page');
  await shoot('08-saved');
  await detail('08a-flags-detail', { x: 1000, y: 8, width: 270, height: 90 });

  await tap('[data-undo]');
  await until(`${sh('.panel [data-title]')}`);
  check((await evaluate(`${sh('[data-title]')}.value`)) === 'Hero thumbnails look like decoration' && (await evaluate(`window.__shadow.querySelectorAll('.mrow').length`)) === 2, 'Undo reopens the draft as it was');
  await evaluate(`${sh('[data-title]')}.focus()`);
  await press('Enter');
  await until(`!${sh('.panel')}`);
  await sleep(5200);

  const fixed = await evaluate(`(() => { const f = [...window.__shadow.querySelectorAll('.saved')].find((n) => n.dataset.status === 'fixed').querySelector('.flag').getBoundingClientRect(); return { x: f.left + f.width / 2, y: f.top + f.height / 2 }; })()`);
  await mouse('mouseMoved', fixed.x, fixed.y);
  await until(`${sh('.tip')}`);
  check(/Consultation buttons shout in caps/.test(await evaluate(`${sh('.tip')}.textContent`)) && /Fixed/.test(await evaluate(`${sh('.tip')}.textContent`)), 'hovering a flag shows its title and status');
  await shoot('09-flag-hover');
  await mouse('mouseMoved', 640, 500);

  console.log('Discard');
  const before = (await issues()).length;
  await drag({ x: 40, y: 330, w: 560, h: 80 });
  await until(`${sh('.panel [data-title]')}`);
  await type('Temporary');
  await tap('[data-cancel]');
  await until(`${sh('[data-confirm]')}`);
  await tap('[data-confirm]');
  await until(`!${sh('.panel')}`);
  await sleep(300);
  check((await issues()).length === before, 'Discard removes the draft');

  console.log('Capture error');
  await evaluate('window.__failCapture = true; 1');
  await drag(strip);
  await until(`${sh('.panel [data-error]:not([hidden])')}`);
  await type('Hero thumbnails look like decoration');
  check(await evaluate(`Boolean(${sh('[data-no-shot]')})`), 'error card offers Save without screenshot');
  await shoot('10-capture-error');
  await evaluate('window.__failCapture = false; 1');
  await tap('[data-retry]');
  await until(`${sh('.panel [data-error][hidden]')}`);
  check((await evaluate(`${sh('[data-title]')}.value`)) === 'Hero thumbnails look like decoration', 'Try again keeps the draft');
  check(await evaluate(`!${sh('[data-save]')}.disabled`), 'Save comes back after a good capture');
  await tap('[data-cancel]');
  await tap('[data-confirm]');
  await until(`!${sh('.panel')}`);

  console.log('Save without screenshot');
  await evaluate('window.__failCapture = true; 1');
  await drag({ x: 40, y: 330, w: 560, h: 80 });
  await until(`${sh('.panel [data-error]:not([hidden])')}`);
  await type('Heading has no screenshot');
  await tap('[data-no-shot]');
  await until(`!${sh('.panel')}`);
  await evaluate('window.__failCapture = false; 1');
  const plain = (await issues()).find((i) => i.title === 'Heading has no screenshot');
  check(Boolean(plain) && plain.hasShot === false, 'Save without screenshot stores the comment with no image');
  await evaluate(`chrome.runtime.sendMessage({ type: 'discard', id: ${JSON.stringify(plain?.id ?? '')} }).then(() => 1)`);

  console.log('Redraw');
  await drag({ x: 40, y: 330, w: 560, h: 80 });
  await until(`${sh('.panel [data-title]')}`);
  await type('Heading weight');
  const first = (await issues()).at(-1).id;
  await tap('[data-redraw]');
  check(await evaluate(`!${sh('.panel')}`), 'Redraw closes the card');
  await drag({ x: 30, y: 420, w: 560, h: 100 });
  await until(`${sh('.panel [data-title]')}`);
  check((await evaluate(`${sh('[data-title]')}.value`)) === 'Heading weight', 'Redraw keeps the draft');
  await sleep(300);
  check(!(await issues()).some((i) => i.id === first), 'Redraw drops the old capture');
  await tap('[data-cancel]');
  await tap('[data-confirm]');
  await until(`!${sh('.panel')}`);

  console.log('Flip near the right edge');
  const corner = { x: 962, y: 102, w: 292, h: 196 };
  await drag(corner);
  await until(`${sh('.panel [data-title]')}`);
  await type('Ceiling outshines the heading');
  const flipped = await box('.panel');
  check(flipped.r <= corner.x - 12 + 1 && Math.abs(flipped.y - corner.y) <= 1, `card flips to the left and lines up with the area top (${Math.round(flipped.x)}, ${Math.round(flipped.y)})`);
  await shoot('11-flipped');
  await tap('[data-cancel]');
  await tap('[data-confirm]');
  await until(`!${sh('.panel')}`);

  console.log('Dark');
  await evaluate(`chrome.storage.local.set({ theme: 'dark' }).then(() => 1)`);
  await until(`${sh('.root')}.dataset.theme === 'dark'`);
  await drag(strip);
  await until(`${sh('.panel [data-title]')}`);
  await type('Hero thumbnails look like decoration');
  await tap('[data-sev="minor"]');
  await tap('[data-add-note]');
  await type('The strip should read as a gallery. Add an arrow and a 1 of 4 count so people know more projects follow.');
  await click(strip.x + strip.w - 32, strip.y + 60);
  await type('No arrow hints at more projects');
  await click(strip.x + strip.w - 60, strip.y + 18);
  await type('Only this caption names the project');
  await tap('[data-add-frame]');
  await press('Enter');
  await evaluate(`window.__shadow.activeElement?.blur(); 1`);
  await shoot('12-composer-dark');
  await detail('12a-dark-flags-detail', { x: 1000, y: 8, width: 270, height: 90 });
  await detail('12b-dark-card-detail', { x: 476, y: 246, width: 360, height: 180 });
  await tap('[data-cancel]');
  await tap('[data-confirm]');
  await until(`!${sh('.panel')}`);
  await evaluate(`chrome.storage.local.set({ theme: 'light' }).then(() => 1)`);
  await until(`${sh('.root')}.dataset.theme === 'light'`);

  console.log('Right-click menu');
  const h1 = at.h1 ?? { x: 32, y: 320, w: 580, h: 80 };
  await click(h1.x + h1.w * 0.75, h1.y + h1.h * 0.8, 'right');
  await until(`${sh('.ctx')}`);
  const items = await evaluate(`[...window.__shadow.querySelectorAll('.ctx button')].map((b) => b.textContent)`);
  check(
    items.join('|') ===
      'Comment on this element|Comment on the whole visible area|Capture comments on this page at three widths|Turn selector capture on|Turn numbered markers off|Stop annotating',
    'right-click menu keeps its items',
  );
  await shoot('13-menu');
  await press('Escape');
  check(await evaluate(`!${sh('.ctx')}`), 'Esc closes the menu');

  console.log('Phone width');
  await size(375, 812);
  await sleep(300);
  await drag({ x: 20, y: 120, w: 200, h: 90 });
  await until(`${sh('.panel [data-title]')}`);
  const narrow = await box('.panel');
  check(narrow.x >= 8 && narrow.r <= 375 - 8, `card fits a 375px window (${Math.round(narrow.x)} to ${Math.round(narrow.r)})`);
  await shoot('14-phone');
  await tap('[data-cancel]');
  await size(VIEW.width, VIEW.height);
} catch (err) {
  failures.push(err.message);
  console.log(`  FAIL ${err.message}`);
  await shoot('zz-failure').catch(() => {});
} finally {
  await browser?.send('Browser.close').catch(() => {});
  const exited = new Promise((resolve) => (chrome.exitCode === null ? chrome.once('exit', resolve) : resolve()));
  if ((await Promise.race([exited.then(() => true), sleep(5000)])) !== true) chrome.kill();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.log('  Chrome still holds the profile folder, it is cleared on the next run');
  }
}

console.log(failures.length ? `${failures.length} checks failed` : 'All checks passed');
process.exitCode = failures.length ? 1 : 0;
