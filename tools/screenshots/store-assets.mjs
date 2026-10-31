import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK = join(ROOT, 'dist', '.shots');
const OUT = join(ROOT, 'store', 'assets');
const SITE = 'https://lilacfragment.co.za/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB_PORT = 8777;
const DEBUG_PORT = 9334;
const VIEW = { width: 1280, height: 800 };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const { version } = JSON.parse(readFileSync(join(ROOT, 'extension', 'manifest.json'), 'utf8'));
const STUB = readFileSync(join(ROOT, 'tools', 'screenshots', 'stub.js'), 'utf8');
const CONTENT = readFileSync(join(ROOT, 'extension', 'content.js'), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serves the project folder over http, so extension pages load their modules the way Chrome would. */
function serve() {
  const server = createServer((req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(ROOT) || !existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(path));
  });
  return new Promise((resolve) => server.listen(WEB_PORT, '127.0.0.1', () => resolve(server)));
}

/**
 * Copies an extension page into the work folder with the chrome stub in front of its script.
 * @param {string} page The page name without extension, such as report.
 */
function harness(page) {
  const html = readFileSync(join(ROOT, 'extension', `${page}.html`), 'utf8')
    .replace('href="ui.css"', 'href="../../extension/ui.css"')
    .replace(
      `<script type="module" src="${page}.js"></script>`,
      `<script src="../../tools/screenshots/stub.js"></script>
  <script type="module">await import('../../extension/background.js'); await import('../../extension/${page}.js');</script>`,
    );
  writeFileSync(join(WORK, `${page}.html`), html);
}

/** A minimal DevTools protocol client over the WebSocket built into Node. */
class Cdp {
  /** @param {string} url The target's WebSocket address. */
  static async open(url) {
    const cdp = new Cdp();
    cdp.ws = new WebSocket(url);
    cdp.next = 0;
    cdp.pending = new Map();
    cdp.waiters = [];
    cdp.ws.addEventListener('message', ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id && cdp.pending.has(msg.id)) {
        const { resolve, reject } = cdp.pending.get(msg.id);
        cdp.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
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
 */
async function until(expression) {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

/**
 * Sets the page size and pixel density for the next captures.
 * @param {number} width CSS pixels.
 * @param {number} height CSS pixels.
 * @param {number} scale Device pixels per CSS pixel.
 */
async function size(width, height, scale) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
}

/**
 * Loads a page, with code run before any of its own scripts.
 * @param {string} url The address to open.
 * @param {string} [boot] Script to run first in every document.
 */
async function open(url, boot = '') {
  if (bootScript) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: bootScript });
  ({ identifier: bootScript } = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: boot || ';' }));
  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url });
  await loaded;
  await sleep(1200);
}

/**
 * Boot code that stands in for the extension APIs, with storage seeded from a value.
 * @param {object} seed Storage contents for the chrome stub.
 * @param {boolean} [openShadow] True to make the overlay's shadow root reachable from the page.
 */
function boot(seed, openShadow = false) {
  const shadow = openShadow
    ? 'const attach = Element.prototype.attachShadow; Element.prototype.attachShadow = function () { return (window.__shadow = attach.call(this, { mode: "open" })); };'
    : '';
  return `window.__SEED = ${JSON.stringify(seed)}; window.__VERSION = ${JSON.stringify(version)}; ${shadow}`;
}

/**
 * Captures the viewport.
 * @param {'png' | 'jpeg'} format The image format.
 */
async function grab(format) {
  const { data } = await page.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 92 } : {}) });
  return data;
}

/** Puts the Margin overlay on the live site, with markers on and selectors off. */
async function overlayOnSite() {
  await open(SITE, `${boot({ selectorMode: false, markerMode: true }, true)}\n${STUB}`);
  await evaluate(`document.querySelector('[class*="cookie"] button, #cookie button')?.click(); 1`);
  await evaluate(CONTENT);
  await until('window.__uiAnnotator');
  await evaluate('window.__uiAnnotator.setActive(true)');
}

const MEASURE = `(() => {
  const box = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const byText = (text) => [...document.querySelectorAll('a, button')].find((el) => el.textContent.trim().startsWith(text));
  const audit = byText('Get a technical audit');
  const what = byText('See what we do');
  const ctas = { x: Math.min(box(audit).x, box(what).x), y: Math.min(box(audit).y, box(what).y) };
  ctas.w = Math.max(box(audit).x + box(audit).w, box(what).x + box(what).w) - ctas.x;
  ctas.h = Math.max(box(audit).y + box(audit).h, box(what).y + box(what).h) - ctas.y;
  return { h1: box(document.querySelector('h1')), audit: box(audit), what: box(what), ctas, proposal: box(byText('Get a free proposal')) };
})()`;

/**
 * Saves the viewport as a raw PNG in the work folder, ready for its floating block.
 * @param {string} name The file name without extension.
 */
async function shoot(name) {
  await sleep(400);
  writeFileSync(join(WORK, `raw-${name}.png`), Buffer.from(await grab('png'), 'base64'));
}

const BLOCK_CSS = `
@font-face { font-family: Manrope; font-weight: 500; src: url("../../extension/fonts/manrope-latin-500-normal.woff2") format("woff2"); }
@font-face { font-family: Manrope; font-weight: 800; src: url("../../extension/fonts/manrope-latin-800-normal.woff2") format("woff2"); }
html, body { margin: 0; width: ${VIEW.width}px; height: ${VIEW.height}px; overflow: hidden; }
body { position: relative; font-family: Manrope, "Segoe UI", sans-serif; }
img { display: block; width: 100%; height: 100%; }
.block {
  position: absolute; box-sizing: border-box; display: grid; gap: 8px; padding: 22px 26px;
  color: #000000; background: #c1f354; border-radius: 16px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
}
.block b { font-size: 30px; line-height: 1.1; font-weight: 800; letter-spacing: -0.025em; }
.block span { font-size: 16px; line-height: 1.45; font-weight: 500; color: rgba(0, 0, 0, 0.72); }
`;

/**
 * Lays one floating text block over a full screenshot and saves the result as a store screenshot.
 * @param {string} name The screenshot's file name without extension.
 * @param {{ x: number, y: number, w: number }} at Where the block sits, in pixels from the top left.
 * @param {string} headline The block's heading.
 * @param {string} line The one line under it.
 */
async function withBlock(name, at, headline, line) {
  writeFileSync(
    join(WORK, `${name}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><style>${BLOCK_CSS}</style></head><body>
<img src="raw-${name}.png">
<div class="block" style="left: ${at.x}px; top: ${at.y}px; width: ${at.w}px;"><b>${headline}</b><span>${line}</span></div>
</body></html>`,
  );
  await size(VIEW.width, VIEW.height, 1);
  await open(`http://127.0.0.1:${WEB_PORT}/dist/.shots/${name}.html`);
  writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(await grab('jpeg'), 'base64'));
  console.log(`  store/assets/${name}.jpg  ${VIEW.width} x ${VIEW.height}`);
}

const TILE_CSS = `
@font-face { font-family: Manrope; font-weight: 500; src: url("../../extension/fonts/manrope-latin-500-normal.woff2") format("woff2"); }
@font-face { font-family: Manrope; font-weight: 800; src: url("../../extension/fonts/manrope-latin-800-normal.woff2") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { overflow: hidden; background: var(--bg); }
body {
  --name: calc(var(--p) * 3.375);
  --gap: calc(var(--p) * 2.25);
  display: flex; align-items: center; padding-left: var(--pad);
  font-family: Manrope, "Segoe UI", sans-serif; color: #000000;
}
.lockup { position: relative; }
.lockup > img { display: block; width: var(--name); height: var(--name); margin-bottom: var(--gap); }
h1 { margin-bottom: var(--gap); font-size: var(--name); font-weight: 800; line-height: 1; letter-spacing: -0.04em; text-box: trim-both cap alphabetic; }
p { font-size: var(--p); font-weight: 500; line-height: 1.4; color: var(--ink); text-box: trim-both cap alphabetic; }
p span { display: block; white-space: nowrap; }
.page {
  position: absolute; top: 0; left: calc(var(--page-x) - var(--pad)); width: calc(var(--u) * 420); height: calc(var(--u) * 420);
  background: #ffffff; border-radius: calc(var(--u) * 12) 0 0 0;
}
.page i { position: absolute; display: block; border-radius: calc(var(--u) * 3); }
.page .ink { background: #000000; }
.page .soft { background: #000000; opacity: 0.14; }
.page .tint { background: #f0eefe; border-radius: calc(var(--u) * 8); }
.page .go { background: #c1f354; border-radius: 999px; }
.page .alt { border: calc(var(--u) * 1.5) solid #000000; border-radius: 999px; }
.page .box { border: calc(var(--u) * 2.5) solid #7549d2; border-radius: calc(var(--u) * 6); }
.page b {
  position: absolute; display: grid; place-items: center; width: calc(var(--u) * 20); height: calc(var(--u) * 20); margin: calc(var(--u) * -10) 0 0 calc(var(--u) * -10);
  border-radius: 999px; background: #7549d2; color: #ffffff; font-size: calc(var(--u) * 11); font-weight: 800; line-height: 1;
}
`;

/**
 * Places one shape on the drawn page, in page units.
 * @param {string} kind The shape's class.
 * @param {number} x Left edge.
 * @param {number} y Top edge.
 * @param {number} w Width.
 * @param {number} h Height.
 */
const shape = (kind, x, y, w, h) =>
  `<i class="${kind}" style="left: calc(var(--u) * ${x}); top: calc(var(--u) * ${y}); width: calc(var(--u) * ${w}); height: calc(var(--u) * ${h});"></i>`;

/**
 * Places one numbered marker on the drawn page, centred on a point in page units.
 * @param {number} n The marker's number.
 * @param {number} x Centre x.
 * @param {number} y Centre y.
 */
const marker = (n, x, y) => `<b style="left: calc(var(--u) * ${x}); top: calc(var(--u) * ${y});">${n}</b>`;

const ART = `<div class="page">${[
  shape('ink', 22, 18, 40, 8), shape('soft', 120, 20, 24, 5), shape('soft', 152, 20, 24, 5), shape('soft', 184, 20, 24, 5),
  shape('ink', 22, 58, 150, 15), shape('ink', 22, 80, 108, 15), shape('soft', 22, 108, 140, 5), shape('soft', 22, 119, 118, 5),
  shape('go', 22, 140, 58, 22), shape('alt', 86, 140, 54, 22), shape('tint', 194, 56, 140, 112), shape('box', 12, 130, 138, 42),
  marker(1, 150, 130), marker(2, 138, 87), marker(3, 334, 56),
].join('')}</div>`;

const TILE_THEMES = { '': '--bg: #c1b0fe; --ink: #000000;', '-tint': '--bg: #f0eefe; --ink: #5b5670;' };

/**
 * Renders a promo tile, the icon, name and pitch on the left and a drawn page marked up by Margin bleeding off the right, its top level with the icon.
 * @param {string} name The file name without extension.
 * @param {number} width The tile width.
 * @param {number} height The tile height.
 * @param {string} css Sizes and colours for this tile.
 * @param {string} copy The pitch, one span per line.
 */
async function tile(name, width, height, css, copy) {
  writeFileSync(
    join(WORK, `${name}.html`),
    `<!doctype html><html><head><meta charset="utf-8"><style>${TILE_CSS}
html, body { width: ${width}px; height: ${height}px; }
${css}</style></head><body><div class="lockup"><img src="../../extension/icons/icon128.png" alt=""><h1>Margin</h1><p>${copy}</p>${ART}</div></body></html>`,
  );
  await size(width, height, 1);
  await open(`http://127.0.0.1:${WEB_PORT}/dist/.shots/${name}.html`);
  writeFileSync(join(OUT, `${name}.jpg`), Buffer.from(await grab('jpeg'), 'base64'));
  console.log(`  store/assets/${name}.jpg  ${width} x ${height}`);
}

mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
harness('report');
const server = await serve();
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
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  await size(VIEW.width, VIEW.height, 1);
  await open(SITE);
  const at = await evaluate(MEASURE);
  const raw = `data:image/jpeg;base64,${await grab('jpeg')}`;
  await evaluate(`(() => {
    const what = [...document.querySelectorAll('a, button')].find((el) => el.textContent.trim().startsWith('See what we do'));
    Object.assign(what.style, { border: '0', background: 'transparent', textDecoration: 'underline', textUnderlineOffset: '4px' });
  })()`);
  await sleep(300);
  const fixedRaw = `data:image/jpeg;base64,${await grab('jpeg')}`;

  const pageInfo = { url: SITE, title: 'Web design company in South Africa | Lilac Fragment' };
  const comment = (id, minutes, fields) => ({
    id, groupId: 'g1', createdAt: new Date(Date.now() - minutes * 60000).toISOString(), links: [], page: pageInfo,
    viewport: { ...VIEW, scrollY: 0, dpr: 1 }, element: null, ...fields,
  });
  const centre = (b) => ({ x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) });
  const issues = [
    comment('c1', 30, {
      severity: 'major',
      title: 'Hero buttons compete for attention',
      note: 'Both buttons read as the main action at a glance. Keep lime for the audit.',
      rect: { x: at.ctas.x - 16, y: at.ctas.y - 16, w: at.ctas.w + 32, h: at.ctas.h + 32 },
      marks: [
        { kind: 'dot', x: at.what.x + at.what.w - 4, y: at.what.y + 4, note: 'Turn this into a quiet text link' },
        { kind: 'arrow', x: at.audit.x + 40, y: at.audit.y + at.audit.h + 60, x2: at.audit.x + 60, y2: at.audit.y + at.audit.h + 4, note: 'Keep this as the one lime button' },
      ],
    }),
    comment('c2', 20, {
      severity: 'minor',
      title: 'Heading could sit on one line wider up',
      note: 'At 1440 and above there is room to keep it on one line.',
      rect: { x: at.h1.x - 12, y: at.h1.y - 12, w: at.h1.w + 24, h: at.h1.h + 24 },
      marks: [{ kind: 'box', x: at.h1.x, y: at.h1.y + at.h1.h / 2, w: at.h1.w * 0.75, h: at.h1.h / 2, note: 'This line moves up beside the first one' }],
    }),
    comment('c3', 10, {
      severity: 'nit',
      title: 'Proposal button label',
      note: 'Match the form heading and call it Start your project.',
      rect: { x: at.proposal.x - 10, y: at.proposal.y - 10, w: at.proposal.w + 20, h: at.proposal.h + 20 },
      marks: [],
    }),
  ];
  const draft = {
    groups: [{ id: 'g1', name: 'Homepage review', createdAt: new Date().toISOString() }],
    activeGroupId: 'g1',
    tours: { report: true, popup: true },
    issues: [...issues, { ...issues[0], id: 'after', marks: [] }],
    ...Object.fromEntries(issues.map((issue) => [`raw:${issue.id}`, { src: raw, hasBox: false }])),
    'raw:after': { src: fixedRaw, hasBox: false },
  };
  await open(`http://127.0.0.1:${WEB_PORT}/dist/.shots/report.html`, `${boot(draft)}\n`);
  const rendered = await evaluate(`(async () => {
    for (const issue of window.__bag.issues) await chrome.runtime.sendMessage({ type: 'annotate', id: issue.id, marks: issue.marks, rect: issue.rect });
    return window.__bag;
  })()`);
  const after = rendered.issues.find((issue) => issue.id === 'after');
  rendered.issues = rendered.issues
    .filter((issue) => issue.id !== 'after')
    .map((issue) => (issue.id === 'c1' ? { ...issue, after: after.detail, checkedAt: new Date().toISOString() } : issue));
  delete rendered['raw:after'];

  await overlayOnSite();
  await evaluate(`(() => {
    const root = window.__shadow.querySelector('.root');
    const fire = (type, x, y) => root.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, detail: 1 }));
    const r = ${JSON.stringify(issues[0].rect)};
    fire('mousedown', r.x, r.y);
    fire('mousemove', r.x + r.w, r.y + r.h);
    fire('mouseup', r.x + r.w, r.y + r.h);
  })()`);
  await until(`window.__shadow.querySelector('.panel')`);
  await evaluate(`(() => {
    const sh = window.__shadow;
    const root = sh.querySelector('.root');
    const fire = (type, x, y) => root.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, detail: 1 }));
    for (const p of [{ x: ${at.what.x + at.what.w - 4}, y: ${at.what.y + 4} }, { x: ${at.audit.x + at.audit.w - 4}, y: ${at.audit.y + 4} }]) {
      sh.querySelector('[data-add-marker]').click();
      fire('mousedown', p.x, p.y);
      fire('mouseup', p.x, p.y);
    }
    const set = (el, value) => { el.value = value; el.dispatchEvent(new Event('input')); };
    set(sh.querySelector('[data-title]'), 'Hero buttons compete for attention');
    sh.querySelector('[data-add-note]').click();
    set(sh.querySelector('[data-note]'), 'Both read as the main action. Keep lime for the audit.');
    const rows = sh.querySelectorAll('.panel .mrow textarea');
    set(rows[0], 'Turn this into a quiet text link');
    set(rows[1], 'Keep this as the one lime button');
    sh.activeElement?.blur?.();
  })()`);
  await shoot('1-mark-up-any-page');

  await open(`http://127.0.0.1:${WEB_PORT}/dist/.shots/report.html`, boot(rendered));
  await until(`document.querySelector('[data-preview]').contentDocument?.querySelector('#c-1 ol.marks li')`);
  await sleep(600);
  await shoot('2-review-report');

  await evaluate(`document.querySelector('[data-preview]').contentDocument.querySelector('#c-1 [data-open-editor]').click()`);
  await until(`document.querySelector('[data-editor]').open && document.querySelector('[data-editor-list] li')`);
  await sleep(800);
  await shoot('3-image-editor');

  await overlayOnSite();
  await evaluate(`(() => {
    const root = window.__shadow.querySelector('.root');
    root.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, clientX: ${centre(at.h1).x}, clientY: ${centre(at.h1).y}, button: 2 }));
  })()`);
  await until(`window.__shadow.querySelector('.ctx')`);
  await shoot('4-right-click');

  await withBlock('1-mark-up-any-page', { x: 720, y: 150, w: 470 }, 'Mark up any page', 'Drag over what looks wrong. Your note opens right beside it, with numbered markers inside the box.');
  await withBlock('2-review-report', { x: 808, y: 628, w: 440 }, 'Hand over a clean review', 'Copy it into Google Docs or download Word. Numbered notes stay numbered.');
  await withBlock('3-image-editor', { x: 330, y: 570, w: 570 }, 'Number the details', 'Markers, boxes and arrows, each with its own note. Saved as you go.');
  await withBlock('4-right-click', { x: 720, y: 150, w: 470 }, 'Right-click for more', 'Comment on one element or the whole screen, straight from the page.');

  const pitch = '<span>Mark up any page.</span><span>Hand over a clean review in</span><span>Google Docs, Word, HTML or PDF.</span>';
  for (const [suffix, colours] of Object.entries(TILE_THEMES)) {
    await tile(`small-promo-tile${suffix}`, 440, 280, `html { --u: 1px; --p: 14px; --pad: 24px; --page-x: 262px; ${colours} }`, pitch);
    await tile(`marquee-promo-tile${suffix}`, 1400, 560, `html { --u: 2px; --p: 28px; --pad: 112px; --page-x: 660px; ${colours} }`, pitch);
  }

  await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  writeFileSync(
    join(WORK, 'icon.html'),
    '<!doctype html><html><head><style>html,body{margin:0;width:128px;height:128px;background:transparent}img{display:block;width:96px;height:96px;margin:16px}</style></head><body><img src="../../extension/icons/icon128.png"></body></html>',
  );
  await size(128, 128, 1);
  await open(`http://127.0.0.1:${WEB_PORT}/dist/.shots/icon.html`);
  writeFileSync(join(OUT, 'store-icon-128.png'), Buffer.from(await grab('png'), 'base64'));
  console.log('  store/assets/store-icon-128.png  128 x 128');
} finally {
  await browser?.send('Browser.close').catch(() => {});
  const exited = new Promise((resolve) => (chrome.exitCode === null ? chrome.once('exit', resolve) : resolve()));
  if ((await Promise.race([exited.then(() => true), sleep(5000)])) !== true) chrome.kill();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
