import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks the verify flow in the stubbed chrome harness: a seeded review, a run over the comments on one page,
 * a status picked for each with the keyboard, then the report, the exports, a cancelled run and the no-tab case.
 * Screenshots land in dist/.verify. Run with node tools/screenshots/verify-flow.mjs.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK = join(ROOT, 'dist', '.verify');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB_PORT = 8778;
const DEBUG_PORT = 9335;
const VIEW = { width: 1280, height: 800 };
const SITE = 'https://lilacfragment.co.za/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
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
 * @param {string} page The page name without extension.
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
  await sleep(900);
}

/**
 * Sets the page size for the next captures.
 * @param {number} width CSS pixels.
 * @param {number} height CSS pixels.
 */
async function size(width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}

/**
 * Saves the viewport as a PNG in the work folder.
 * @param {string} name The file name without extension.
 */
async function shoot(name) {
  await sleep(300);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(WORK, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  dist/.verify/${name}.png`);
}

/**
 * Presses one key in the page, as a person would.
 * @param {string} key The key name, such as f or ArrowRight.
 */
async function press(key) {
  const text = key.length === 1 ? key : undefined;
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, text });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  await sleep(250);
}

/** Draws a stand-in page on a canvas, with three spots that the fix may or may not change. */
const DRAW = `(fixed) => {
  const c = document.createElement('canvas');
  c.width = ${VIEW.width}; c.height = ${VIEW.height};
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#f0eefe'; x.fillRect(0, 0, c.width, 64);
  x.fillStyle = '#000000'; x.font = '800 40px Segoe UI'; x.fillText('Websites that work as hard as you do', 80, 180);
  x.fillStyle = fixed ? '#c1f354' : '#7549d2'; x.fillRect(80, 240, 220, 52);
  x.fillStyle = '#000000'; x.font = '700 18px Segoe UI'; x.fillText('Get a technical audit', 98, 273);
  x.fillStyle = '#f0eefe'; x.fillRect(80, 380, 520, 260);
  x.fillStyle = '#000000'; x.font = '600 16px Segoe UI';
  x.fillText(fixed ? 'Three plans, priced up front' : 'Plans and pricing, ask us', 104, 420);
  return c.toDataURL('image/jpeg', 0.92);
}`;

mkdirSync(WORK, { recursive: true });
harness('report');
harness('popup');
writeFileSync(join(WORK, 'blank.html'), '<!doctype html><html><body></body></html>');
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
  await size(VIEW.width, VIEW.height);

  await open(`http://127.0.0.1:${WEB_PORT}/dist/.verify/blank.html`);
  const before = await evaluate(`(${DRAW})(false)`);
  const after = await evaluate(`(${DRAW})(true)`);

  const comment = (id, minutes, url, fields) => ({
    id, groupId: 'g1', createdAt: new Date(Date.now() - minutes * 60000).toISOString(), links: [], marks: [],
    page: { url, title: 'Lilac Fragment' }, viewport: { ...VIEW, scrollY: 0, dpr: 1 }, element: null, severity: 'major', note: '', ...fields,
  });
  const issues = [
    comment('c1', 40, SITE, { title: 'Audit button should be lime', rect: { x: 70, y: 230, w: 240, h: 72 } }),
    comment('c2', 30, SITE, { severity: 'minor', title: 'Heading wraps too early', rect: { x: 70, y: 130, w: 760, h: 70 } }),
    comment('c3', 20, SITE, { severity: 'nit', title: 'Pricing card copy is vague', rect: { x: 70, y: 370, w: 540, h: 280 } }),
    comment('c4', 10, `${SITE}margin/`, { severity: 'blocker', title: 'Install button missing', rect: { x: 40, y: 40, w: 300, h: 80 } }),
  ];
  const draft = {
    groups: [{ id: 'g1', name: 'Homepage review', createdAt: new Date().toISOString() }],
    activeGroupId: 'g1',
    tours: { report: true, popup: true },
    issues,
    ...Object.fromEntries(issues.map((issue) => [`raw:${issue.id}`, { src: before, hasBox: false }])),
  };
  const boot = (seed) => `window.__SEED = ${JSON.stringify(seed)}; window.__CAPTURE = ${JSON.stringify(after)};`;

  await open(`http://127.0.0.1:${WEB_PORT}/dist/.verify/report.html`, boot(draft));
  const rendered = await evaluate(`(async () => {
    for (const issue of window.__bag.issues) await chrome.runtime.sendMessage({ type: 'annotate', id: issue.id, marks: [], rect: issue.rect });
    return window.__bag;
  })()`);

  console.log('Verify run');
  await open(`http://127.0.0.1:${WEB_PORT}/dist/.verify/report.html`, boot(rendered));
  await until(`document.querySelector('[data-preview]').contentDocument?.querySelector('#c-1')`);
  await evaluate(`(() => {
    window.__times = [];
    const real = chrome.tabs.captureVisibleTab;
    chrome.tabs.captureVisibleTab = (...args) => { window.__times.push(performance.now()); return real(...args); };
  })()`);
  await evaluate(`document.querySelector('[data-verify]').click()`);
  await until(`document.querySelector('[data-verify-pick]')`);
  const gaps = await evaluate(`window.__times.slice(1).map((t, i) => t - window.__times[i])`);
  check(gaps.length === 2 && gaps.every((g) => g >= 590), `three captures at least 600ms apart (${gaps.map((g) => Math.round(g)).join(', ')} ms)`);
  const run = await evaluate('window.__bag.verifyRun');
  check(run.state === 'done' && run.checked.length === 3 && !run.checked.includes('c4'), 'run checks the three comments on this page only');
  const hints = await evaluate(`window.__bag.issues.map((i) => [i.id, i.change])`);
  console.log(`  change shares ${JSON.stringify(hints)}`);
  check(hints.find(([id]) => id === 'c2')[1] < 0.003, 'unchanged heading reads as unchanged');
  check(hints.find(([id]) => id === 'c1')[1] >= 0.003 && hints.find(([id]) => id === 'c3')[1] >= 0.003, 'changed button and card read as changed');
  check(await evaluate(`window.__bag.issues.every((i) => (i.status ?? 'open') === 'open')`), 'no status set by the run itself');
  const firstText = await evaluate(`document.querySelector('[data-verify-body]').innerText`);
  check(/Open this page to verify/.test(firstText) && /Margin/.test(firstText), 'other page listed with its link');
  await shoot('1-verify-walk');

  await press('f');
  await press('o');
  await shoot('2-verify-second');
  await press('ArrowLeft');
  check((await evaluate(`document.querySelector('[data-verify-state]').textContent`)) === '2 of 3', 'left arrow goes back one');
  await press('ArrowRight');
  await press('w');
  const statuses = await evaluate(`Object.fromEntries(window.__bag.issues.map((i) => [i.id, i.status]))`);
  check(statuses.c1 === 'fixed' && statuses.c2 === 'open' && statuses.c3 === 'wontfix' && !statuses.c4, `keys set statuses ${JSON.stringify(statuses)}`);
  check(/1 open, 1 fixed, 1 won't fix/.test(await evaluate(`document.querySelector('[data-verify-body]').innerText`)), 'summary tallies the picks');
  await shoot('3-verify-summary');

  await size(420, 844);
  await press('ArrowLeft');
  check((await evaluate(`document.querySelector('[data-verify-state]').textContent`)) === '3 of 3', 'left arrow works from the summary');
  await shoot('4-verify-walk-narrow');
  await size(VIEW.width, VIEW.height);

  console.log('Report and exports');
  const done = await evaluate('window.__bag');
  await open(`http://127.0.0.1:${WEB_PORT}/dist/.verify/report.html`, boot(done));
  await until(`document.querySelector('[data-preview]').contentDocument?.querySelector('#c-1 .status')`);
  const filters = await evaluate(`[...document.querySelectorAll('[data-status-filter]')].map((b) => b.textContent)`);
  check(filters.join('|') === "Any status|Open 2|Fixed 1|Won't fix 1", `sidebar status filter ${filters.join(', ')}`);
  await evaluate(`document.querySelector('[data-status-filter="fixed"]').click()`);
  check((await evaluate(`[...document.querySelectorAll('[data-jump]')].filter((r) => !r.hidden).length`)) === 1, 'Fixed filter leaves one row');
  await shoot('5-report-filtered');
  const exports = await evaluate(`(async () => {
    const docs = await import('../../extension/lib/docs-template.js');
    const report = await import('../../extension/lib/report-template.js');
    const share = await import('../../extension/lib/share-template.js');
    const file = await import('../../extension/lib/review-file.js');
    const store = await import('../../extension/lib/store.js');
    const issues = await store.hydrate(window.__bag.issues);
    const back = file.parseReviewFile(file.buildReviewFile({ name: 'Round trip' }, issues, {}));
    return {
      text: docs.buildDocsText(issues),
      docs: docs.buildDocsHtml(issues),
      html: report.buildReport(issues),
      markdown: share.buildMarkdown(issues),
      rich: share.commentHtml(issues.find((i) => i.id === 'c3')),
      imported: (back.issues ?? []).map((i) => i.status).sort().join(','),
      images: (back.issues ?? []).filter((i) => i.shot && i.detail).length,
    };
  })()`);
  check(/\*\*Major\*\*, Fixed/.test(exports.markdown), 'Markdown carries the status');
  check(exports.rich.includes('Nit, Won&#39;t fix') || exports.rich.includes("Nit, Won't fix"), 'rich text copy carries the status');
  check(exports.imported === 'fixed,open,open,wontfix', `review file keeps statuses (${exports.imported})`);
  check(exports.images === 4, `review file carries the images of every comment, read back from their own keys (${exports.images} of 4)`);
  check(/\[Major, Fixed\] Audit button/.test(exports.text), 'Docs text carries the status');
  check(exports.docs.includes(">Won't fix</td>") && exports.docs.includes('>Fixed</td>'), 'Docs and Word table carries the status');
  check(exports.html.includes('data-status="fixed"') && exports.html.includes('data-status-filter="wontfix"'), 'HTML file carries status and its filter');

  console.log('Cancel and no tab');
  await evaluate(`(() => { for (const i of window.__bag.issues) i.status = 'open'; })()`);
  await evaluate(`document.querySelector('[data-verify]').click()`);
  await until(`window.__bag.verifyRun?.state === 'running'`);
  await evaluate(`chrome.runtime.sendMessage({ type: 'verifyCancel' })`);
  await until(`window.__bag.verifyRun?.state !== 'running'`);
  const cancelled = await evaluate('window.__bag.verifyRun');
  check(cancelled.state === 'cancelled' && cancelled.done < cancelled.total, `cancel stops the run after ${cancelled.done} of ${cancelled.total}`);
  await evaluate(`document.querySelector('[data-verify-dialog]').close()`);
  await evaluate(`window.__TAB_URL = 'https://example.com/'; document.querySelector('[data-verify]').click()`);
  await until(`/Margin can capture a page only/.test(document.querySelector('[data-verify-body]').innerText)`);
  check((await evaluate(`document.querySelectorAll('.verify-pages a').length`)) === 2, 'no tab lists both pages with links');
  await shoot('6-verify-no-tab');

  console.log('Popup');
  await size(360, 600);
  await open(`http://127.0.0.1:${WEB_PORT}/dist/.verify/popup.html`, boot(done));
  await until(`!document.querySelector('[data-verify]').hidden`);
  check((await evaluate(`document.querySelector('[data-verify]').textContent`)) === 'Recheck 3', 'popup offers to recheck this page');
  await shoot('7-popup');
} finally {
  await browser?.send('Browser.close').catch(() => {});
  const exited = new Promise((resolve) => (chrome.exitCode === null ? chrome.once('exit', resolve) : resolve()));
  if ((await Promise.race([exited.then(() => true), sleep(5000)])) !== true) chrome.kill();
  server.close();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
    console.log('  Chrome still holds the profile folder, it is cleared on the next run');
  }
}

console.log(failures.length ? `${failures.length} checks failed` : 'All checks passed');
process.exitCode = failures.length ? 1 : 0;
