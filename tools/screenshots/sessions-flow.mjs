import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walks review sessions in the stubbed chrome harness with canned Jira and Figma answers: the New review sheet
 * through linking both and every error state, the popup with the links, the report header, Send to Jira and
 * Post to Figma defaults, and a review file round trip. Nothing reaches a real Jira or Figma account.
 * Screenshots land in dist/redesign-shots/sessions. Run with node tools/screenshots/sessions-flow.mjs.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK = join(ROOT, 'dist', '.sessions');
const OUT = join(ROOT, 'dist', 'redesign-shots', 'sessions');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB_PORT = 8781;
const DEBUG_PORT = 9338;
const SITE = 'https://smart-spaces-demo.vercel.app/';
const JIRA_SITE = 'https://smartspaces.atlassian.net';
const FIGMA_URL = 'https://www.figma.com/design/AbCdEf123/Smart-Spaces-website?node-id=0-1';
const VIEW = { width: 1280, height: 800 };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const pageErrors = [];

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
 * Fills in what stub.js leaves out, and answers Jira and Figma calls from fixtures.
 * Gates hold a lookup open so the looking up state can be captured.
 */
const EXTRA = `(() => {
  const c = window.chrome;
  const gates = {};
  window.__gate = (name) => { let open; gates[name] = { promise: new Promise((r) => (open = r)), open }; };
  window.__open = (name) => { gates[name]?.open(); delete gates[name]; };
  const pass = (name) => gates[name]?.promise ?? Promise.resolve();
  window.__opened = [];
  window.__sent = [];
  window.__options = 0;
  c.permissions = { contains: async () => false, request: async () => false, remove: async () => true };
  c.identity = { launchWebAuthFlow: async () => { throw new Error('closed'); } };
  c.runtime.openOptionsPage = async () => { window.__options += 1; };
  c.tabs.query = async () => [{ id: 1, windowId: 1, width: 1280, url: window.__TAB_URL ?? '${SITE}', title: window.__TAB_TITLE ?? 'Smart Spaces homepage QA' }];
  c.tabs.get = async (id) => ({ id, windowId: 1, index: 0, url: window.__TAB_URL ?? '${SITE}' });
  c.tabs.getZoom = async () => 1;
  c.tabs.create = async ({ url }) => { window.__opened.push(url); return { id: 9 }; };
  c.tabs.sendMessage = async (_id, msg) => { window.__sent.push(msg?.type); return { ok: true }; };
  c.windows = { get: async () => ({ id: 1, left: 0, top: 0, width: 1280, height: 800, state: 'normal' }), update: async () => {}, create: async () => ({ id: 2 }), remove: async () => {} };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const adf = (text) => ({ type: 'doc', version: 1, content: text.split('\\n\\n').map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) });
  const issue = (key, summary, status, category, assignee, description) => ({
    key, fields: { summary, status: { name: status, statusCategory: { key: category } }, assignee: assignee ? { displayName: assignee } : null, description: description ? adf(description) : null },
  });
  const tickets = {
    'SS-112': issue('SS-112', 'Homepage rebuild QA', 'In review', 'indeterminate', 'Charlize de Beer',
      'Rebuild of the Smart Spaces homepage on the new stack. QA the hero, services, scenes and consultation form at 1280 and 375 px before launch.\\n\\nSign off needs every Blocker and Major fixed or agreed as Won\\'t fix, and the consultation form tested end to end on mobile.'),
    'SS-109': issue('SS-109', 'Booking form copy', 'To do', 'new', 'Charlize de Beer', ''),
    'SS-97': issue('SS-97', 'Showroom page photos', 'In progress', 'indeterminate', 'Charlize de Beer', ''),
  };
  const page = (name, frames) => ({ id: name, name, type: 'CANVAS', children: frames.map((f, i) => ({ id: name.length + ':' + i, name: f, type: 'FRAME' })) });
  const file = {
    name: 'Smart Spaces website',
    document: { children: [
      page('Home', ['Home 1280', 'Home 375', 'Home hero', 'Services grid', 'Scenes', 'Consultation form']),
      page('Pricing', ['Pricing 1280', 'Pricing 375', 'Plan cards', 'FAQ']),
      page('Showroom', ['Showroom 1280', 'Showroom 375', 'Gallery', 'Map']),
    ] },
  };
  const projects = [{ id: '10010', key: 'SS', name: 'Smart Spaces', issueTypes: [{ id: '1', name: 'Task' }, { id: '2', name: 'Bug' }] }, { id: '10011', key: 'OPS', name: 'Operations', issueTypes: [{ id: '1', name: 'Task' }] }];
  window.__api = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    const method = String(init.method ?? 'GET').toUpperCase();
    if (url.startsWith('https://api.atlassian.com/') || url.startsWith('https://api.figma.com/')) window.__api.push(method + ' ' + url);
    if (url.startsWith('https://api.atlassian.com/ex/jira/c1/rest/api/3/issue/')) {
      const key = decodeURIComponent(url.split('/issue/')[1].split('?')[0]);
      if (method !== 'GET') return json({ errorMessages: ['Writes are refused in this harness'] }, 405);
      if (key === 'SS-113') return json({ errorMessages: ['You do not have permission to see this issue'] }, 403);
      if (!tickets[key]) return json({ errorMessages: ['Issue does not exist or you do not have permission to see it.'] }, 404);
      await pass('jira');
      return json(tickets[key]);
    }
    if (url.includes('/rest/api/3/search/jql')) return json({ issues: Object.values(tickets) });
    if (url.includes('/project/search')) return json({ values: projects });
    if (url.endsWith('/priority')) return json([]);
    if (url.startsWith('https://api.figma.com/v1/files/')) {
      if (method !== 'GET') return json({ err: 'Writes are refused in this harness' }, 405);
      const key = url.split('/v1/files/')[1].split('?')[0];
      if (key === 'NoAccess999') return json({ err: 'Forbidden' }, 403);
      if (key !== 'AbCdEf123') return json({ err: 'Not found' }, 404);
      await pass('figma');
      return json(file);
    }
    return realFetch(input, init);
  };
})();`;

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
 * Copies an extension page into the work folder with the chrome stub and the fixtures in front of its script.
 * @param {string} name The page name without extension.
 */
function harness(name) {
  const html = readFileSync(join(ROOT, 'extension', `${name}.html`), 'utf8')
    .replace('href="ui.css"', 'href="../../extension/ui.css"')
    .replace(
      `<script type="module" src="${name}.js"></script>`,
      `<script src="../../tools/screenshots/stub.js"></script>
  <script src="extra.js"></script>
  <script type="module">await import('../../extension/background.js'); await import('../../extension/${name}.js');</script>`,
    );
  writeFileSync(join(WORK, `${name}.html`), html);
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
let width = VIEW.width;

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
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression).catch(() => false)) return;
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
  await sleep(700);
}

/**
 * Sets the page size for the next captures.
 * @param {number} w CSS pixels.
 * @param {number} h CSS pixels.
 */
async function size(w, h) {
  width = w;
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
}

/**
 * Saves a PNG. Popup shots grow to the popup's own height, the way Chrome sizes the real popup.
 * @param {string} name The file name without extension.
 * @param {boolean} [fit] Fit the height to the content.
 */
async function shoot(name, fit = false) {
  await sleep(250);
  if (fit) {
    const h = await evaluate(`Math.ceil(Math.max(document.body.scrollHeight, ...[...document.querySelectorAll('.menu-body, .link-suggest')].filter((m) => m.offsetParent).map((m) => m.getBoundingClientRect().bottom + 8)))`);
    await size(width, Math.min(h, 600));
    await sleep(150);
  }
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  dist/redesign-shots/sessions/${name}.png`);
}

/**
 * Presses one key in the page, as a person would.
 * @param {string} key The key name, such as Enter.
 */
async function press(key) {
  const codes = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 };
  const text = key === 'Enter' ? '\r' : key.length === 1 ? key : undefined;
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: codes[key], text });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: codes[key] });
  await sleep(250);
}

/**
 * Focuses an element and types into it.
 * @param {string} selector The input.
 * @param {string} text What to type.
 */
async function typeInto(selector, text) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); })()`);
  await sleep(200);
  await page.send('Input.insertText', { text });
  await sleep(150);
}

/**
 * Pastes text into an input the way a clipboard paste lands.
 * @param {string} selector The input.
 * @param {string} text What to paste.
 */
async function pasteInto(selector, text) {
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.focus();
    el.value = ${JSON.stringify(text)};
    el.dispatchEvent(new Event('paste', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
}

const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const textOf = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`);

/** Draws a stand-in screenshot of the reviewed page. */
const DRAW = `() => {
  const c = document.createElement('canvas');
  c.width = ${VIEW.width}; c.height = ${VIEW.height};
  const x = c.getContext('2d');
  x.fillStyle = '#16181d'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#ffffff'; x.font = '700 64px Segoe UI'; x.fillText('Living switched on', 80, 420);
  x.font = '600 14px Segoe UI'; x.fillText('LIGHTS ON. TAP TO SWITCH OFF', 120, 250);
  x.fillStyle = '#f0eefe'; x.fillRect(80, 520, 520, 200);
  return c.toDataURL('image/jpeg', 0.9);
}`;

mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(WORK, 'extra.js'), EXTRA);
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

const base = `http://127.0.0.1:${WEB_PORT}/dist/.sessions`;
const connections = {
  jira: { access: 'stub', refresh: 'stub', expiresAt: Date.now() + 1e10, account: { name: 'Charlize de Beer' }, sites: [{ id: 'c1', name: 'Smart Spaces', url: JIRA_SITE }] },
  figma: { access: 'stub', refresh: 'stub', expiresAt: Date.now() + 1e10, account: { name: 'charlize' } },
};

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
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  page.handlers['Runtime.exceptionThrown'] = (p) => pageErrors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text);
  page.handlers['Runtime.consoleAPICalled'] = (p) => p.type === 'error' && pageErrors.push(p.args.map((a) => a.value ?? a.description).join(' '));
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  const boot = (seed, extra = '') => `window.__SEED = ${JSON.stringify(seed)};${extra}`;
  const popup = `${base}/popup.html`;
  const report = `${base}/report.html`;

  console.log('New review sheet, connected');
  await size(344, 600);
  await open(popup, boot({ connections, tours: { popup: true, report: true } }));
  check((await textOf('[data-review-name]')) === 'smart-spaces-demo.vercel.app', 'popup with no review names the site');
  check((await textOf('[data-toggle-label]')) === 'Start review', 'primary button reads Start review');
  await shoot('pp-no-review', true);
  await click('[data-toggle]');
  await until(`document.querySelector('[data-session-name]')`);
  check((await evaluate(`document.querySelector('[data-session-name]').value`)) === 'Smart Spaces homepage QA', 'name is prefilled from the page title');
  check(!(await evaluate(`document.querySelector('[data-session-go]').disabled`)), 'Start review is on with a name');
  await evaluate(`document.activeElement.blur()`);
  await shoot('nr-prefilled', true);

  await evaluate(`document.querySelector('#session-jira').focus()`);
  await until(`!document.querySelector('[data-link-field="jira"] [data-suggest]').hidden`);
  check((await evaluate(`document.querySelectorAll('[data-link-field="jira"] [data-pick]').length`)) === 3, 'pick a ticket lists recent issues');
  check((await evaluate(`document.querySelector('#session-jira').placeholder`)) === 'Search your tickets or paste a key', 'search placeholder while picking');
  await shoot('nr-pick', true);
  await size(344, 600);
  await press('Escape');

  await pasteInto('#session-figma', FIGMA_URL);
  await until(`/Smart Spaces website/.test(document.querySelector('[data-link-field="figma"]').innerText)`);
  check(/3 pages, 14 frames/.test(await textOf('[data-link-field="figma"]')), 'Figma file resolves with its pages and frames');

  await evaluate(`window.__gate('jira')`);
  await typeInto('#session-jira', 'SS-112');
  await press('Enter');
  await until(`/Looking up SS-112/.test(document.querySelector('[data-link-field="jira"]').innerText)`);
  check(Boolean(await evaluate(`document.querySelector('[data-link-field="jira"] .skeleton')`)), 'looking up shows a skeleton title');
  check(!(await evaluate(`document.querySelector('[data-session-go]').disabled`)), 'Start review stays on while a link resolves');
  await shoot('nr-looking-up', true);
  await size(344, 600);
  await evaluate(`window.__open('jira')`);
  await until(`/Homepage rebuild QA/.test(document.querySelector('[data-link-field="jira"]').innerText)`);
  const jiraRow = await textOf('[data-link-field="jira"]');
  check(/In review/.test(jiraRow) && /Charlize de Beer/.test(jiraRow), 'ticket row shows status and assignee');
  check(Boolean(await evaluate(`document.querySelector('[data-link-field="jira"] [data-more]')`)), 'long description offers Show more');
  check((await evaluate(`document.querySelector('[data-link-field="jira"] .tone-progress')?.textContent`)) === 'In review', 'In progress category uses the Minor blue');
  await shoot('nr-resolved', true);
  await size(344, 600);

  await click('[data-link-field="jira"] [data-remove]');
  check(/SS-112 removed/.test(await textOf('[data-link-field="jira"]')), 'Remove offers Undo');
  await shoot('nr-removed', true);
  await size(344, 600);
  await click('[data-link-field="jira"] [data-undo]');
  check(/Homepage rebuild QA/.test(await textOf('[data-link-field="jira"]')), 'Undo puts the ticket back');

  await click('[data-link-field="jira"] [data-remove]');
  await sleep(5300);
  check(Boolean(await evaluate(`document.querySelector('#session-jira')`)), 'after five seconds the field is empty again');
  await typeInto('#session-jira', 'SS-1120');
  await press('Enter');
  await until(`/No ticket SS-1120/.test(document.querySelector('[data-link-field="jira"]').innerText)`);
  check((await evaluate(`document.querySelector('#session-jira').value`)) === 'SS-1120', 'not found keeps the typed key');
  check(await evaluate(`document.querySelector('#session-jira').classList.contains('is-invalid')`), 'not found marks the input');
  await evaluate(`document.activeElement.blur()`);
  await shoot('nr-not-found', true);
  await size(344, 600);

  await typeInto('#session-jira', 'SS-113');
  await press('Enter');
  await until(`/You do not have access to SS-113/.test(document.querySelector('[data-link-field="jira"]').innerText)`);
  check(/Remove link/.test(await textOf('[data-link-field="jira"]')), 'no access offers Remove link');
  await shoot('nr-no-access', true);
  await size(344, 600);

  await click('[data-link-field="jira"] [data-remove]');
  await sleep(5300);
  await typeInto('#session-jira', `${JIRA_SITE}/browse/SS-112`);
  await press('Enter');
  await until(`/Homepage rebuild QA/.test(document.querySelector('[data-link-field="jira"]').innerText)`);
  check(true, 'a Jira issue link resolves like a key');
  await typeInto('#session-name', 'Smart Spaces homepage QA');
  await evaluate(`document.querySelector('#session-name').focus()`);
  await press('Enter');
  await until(`window.__bag.groups?.length === 1`);
  const created = await evaluate('window.__bag.groups[0]');
  check(created.name === 'Smart Spaces homepage QA' && created.site === 'smart-spaces-demo.vercel.app', 'Enter starts the review on this site');
  check(
    created.jira?.key === 'SS-112' && created.jira.summary === 'Homepage rebuild QA' && created.jira.statusCategory === 'indeterminate' && created.jira.assignee === 'Charlize de Beer' && /new stack/.test(created.jira.description),
    'review stores the ticket key, summary, status, assignee and description',
  );
  check(created.jira.url === `${JIRA_SITE}/browse/SS-112` && Boolean(created.jira.fetchedAt), 'ticket keeps its link and fetch time');
  check(created.figma?.fileKey === 'AbCdEf123' && created.figma.name === 'Smart Spaces website' && created.figma.frames.length === 14, 'review stores the Figma file and its frames');
  check(created.figma.frames.every((f) => f.id && f.name && f.page), 'each frame keeps id, name and page');
  check((await evaluate('window.__sent')).includes('toggle'), 'starting the review starts annotating');
  const writes = (await evaluate('window.__api')).filter((call) => !call.startsWith('GET'));
  check(writes.length === 0, `nothing written to Jira or Figma (${writes.length} writes)`);

  console.log('New review sheet, not connected');
  await size(344, 600);
  await open(popup, boot({ tours: { popup: true, report: true }, jiraSite: JIRA_SITE }));
  await click('[data-toggle]');
  await until(`document.querySelector('[data-session-name]')`);
  await typeInto('#session-jira', 'SS-112');
  await press('Enter');
  await pasteInto('#session-figma', FIGMA_URL);
  await until(`/Connect to bring in details/.test(document.querySelector('[data-link-field="figma"]').innerText)`);
  check(/Connect to bring in details/.test(await textOf('[data-link-field="jira"]')), 'pasted key is kept as a plain link');
  await evaluate(`document.activeElement.blur()`);
  await shoot('nr-not-connected', true);
  await size(344, 600);
  await click('[data-link-field="jira"] [data-connect]');
  await sleep(200);
  check((await evaluate('window.__options')) === 1, 'Connect opens Help and settings');
  check(Boolean(await evaluate(`window.__bag.reviewDraft?.jira === 'SS-112'`)), 'the sheet is kept while connecting');
  await open(popup, boot(await evaluate('window.__bag')));
  await click('[data-toggle]');
  await until(`document.querySelector('[data-session-name]')`);
  await press('Enter');
  await until(`window.__bag.groups?.length === 1`);
  const plain = await evaluate('window.__bag.groups[0]');
  check(plain.jira?.key === 'SS-112' && plain.jira.url === `${JIRA_SITE}/browse/SS-112` && !plain.jira.summary, 'not connected stores key and link only');
  check(plain.figma?.fileKey === 'AbCdEf123' && plain.figma.url.startsWith('https://www.figma.com/design/AbCdEf123') && plain.figma.name === 'Smart Spaces website', 'not connected stores file key, link and the name in the link');

  console.log('Popup with a linked review');
  await size(VIEW.width, VIEW.height);
  await open(`${base}/blank.html`);
  const shot = await evaluate(`(${DRAW})()`);
  const now = Date.now();
  const comment = (n, fields) => ({
    id: `c${n}`, groupId: 'g1', createdAt: new Date(now - (20 - n) * 60000).toISOString(), links: [], marks: [], note: '', status: 'open',
    page: { url: SITE, title: 'Smart Spaces | Home' }, viewport: { width: 1280, height: 800, scrollY: 0, dpr: 1 }, element: null,
    rect: { x: 100, y: 220, w: 400, h: 60 }, ...fields,
  });
  const issues = [
    comment(1, { severity: 'blocker', title: 'Form selects read as disabled', checkedAt: new Date(now).toISOString(), change: 0 }),
    comment(2, { severity: 'major', title: 'Lights toggle reads as a label', checkedAt: new Date(now).toISOString(), change: 0.09 }),
    comment(3, { severity: 'major', title: 'Consultation buttons shout in caps', status: 'fixed', jira: { key: 'SS-118', url: `${JIRA_SITE}/browse/SS-118` }, checkedAt: new Date(now).toISOString(), change: 0.31 }),
    comment(4, { severity: 'minor', title: 'Hero thumbnails look like decoration', checkedAt: new Date(now).toISOString(), change: 0 }),
    comment(5, { severity: 'minor', title: 'Service card arrows are easy to miss', jira: { key: 'SS-121', url: `${JIRA_SITE}/browse/SS-121` } }),
    comment(6, { severity: 'nit', title: 'Scene cards repeat How it works', status: 'wontfix', checkedAt: new Date(now).toISOString(), change: 0 }),
    comment(7, { severity: 'major', title: 'Menu hides Book a consultation', viewport: { width: 375, height: 812, scrollY: 0, dpr: 1 } }),
    comment(8, { severity: 'minor', title: 'Hero intro runs to seven lines', viewport: { width: 375, height: 812, scrollY: 0, dpr: 1 } }),
  ];
  const linkedGroup = {
    id: 'g1', name: 'Smart Spaces homepage QA', createdAt: new Date(now - 3600000).toISOString(), site: 'smart-spaces-demo.vercel.app',
    jira: { ...created.jira, fetchedAt: new Date(now - 2 * 60000).toISOString() },
    figma: { ...created.figma, url: 'https://www.figma.com/design/AbCdEf123/Smart-Spaces-website', fetchedAt: new Date(now - 2 * 60000).toISOString() },
  };
  const review = {
    groups: [linkedGroup], activeGroupId: 'g1', connections, tours: { popup: true, report: true }, issues,
    ...Object.fromEntries(issues.map((i) => [`raw:${i.id}`, { src: shot, hasBox: false }])),
  };
  await open(report, boot(review));
  const rendered = await evaluate(`(async () => {
    for (const issue of window.__bag.issues) await chrome.runtime.sendMessage({ type: 'annotate', id: issue.id, marks: [], rect: issue.rect });
    return window.__bag;
  })()`);
  rendered.groups = [linkedGroup];

  await size(344, 600);
  await open(popup, boot(rendered));
  await until(`document.querySelector('[data-links] .quiet-link')`);
  const links = await textOf('[data-links]');
  check(/SS-112/.test(links) && /Homepage rebuild QA/.test(links) && /In review/.test(links) && /Smart Spaces website/.test(links), 'popup shows the two quiet link rows');
  check(/8 comments/.test(links) && /Details from 2 min ago/.test(links), 'popup shows the comment count and details age');
  check(Boolean(await evaluate(`document.querySelector('[data-links] [data-refresh]')`)), 'details can be refreshed');
  check((await textOf('[data-toggle-label]')) === 'Start annotating', 'with a review open the button reads Start annotating');
  check((await textOf('[data-page-name]')) === 'On Home' && (await textOf('[data-page-count]')) === '6 comments', 'this page header counts the comments on Home');
  check((await evaluate(`document.querySelectorAll('.pop-row').length`)) === 6, 'six rows at 1280');
  check(/2 more at 375 px/.test(await textOf('[data-folds]')), 'the 375 px comments fold into one line');
  check((await evaluate(`[...document.querySelectorAll('.pop-row .txt span')].map((s) => s.textContent).join('|')`)) ===
    '01, same as capture|02, changed since capture|03, Jira SS-118, changed since capture|04, same as capture|05, Jira SS-121, not checked again|06, same as capture', 'each row reads its number, ticket and recheck state');
  await shoot('pp-review-open', true);
  await size(344, 600);
  await click('[data-links] [data-refresh]');
  await until(`/Details from just now/.test(document.querySelector('[data-links]').innerText)`);
  check(true, 'refresh brings the details up to date');
  await click('[data-links] .link-title');
  check((await evaluate('window.__opened.at(-1)')) === `${JIRA_SITE}/browse/SS-112`, 'the ticket row opens the ticket in a new tab');

  await click('[data-more] > summary');
  await shoot('pp-menu', true);
  await size(344, 600);
  await click('[data-more] > summary');

  await evaluate(`document.querySelectorAll('.pop-row .del')[2].click()`);
  await until(`document.querySelector('.pop-row.undo')`);
  check(/Comment 03 deleted/.test(await textOf('.pop-row.undo')) && (await evaluate('window.__bag.issues.length')) === 7, 'delete removes the comment and offers Undo');
  await shoot('pp-undo', true);
  await size(344, 600);
  await click('.pop-row.undo button');
  await until(`window.__bag.issues.length === 8 && !document.querySelector('.pop-row.undo')`);
  check((await evaluate(`window.__bag.issues[2].id`)) === 'c3' && Boolean(await evaluate(`window.__bag['raw:c3'] && window.__bag['img:c3']?.shot`)), 'Undo puts the comment, its images and its screenshot back in place');

  await click('[data-edit-links]');
  await until(`document.querySelector('[data-session-name]')`);
  check(/Edit review/.test(await textOf('.session-head')) && /Homepage rebuild QA/.test(await textOf('[data-link-field="jira"]')), 'Edit links opens the sheet on the linked review');
  await click('[data-link-field="figma"] [data-remove]');
  await click('[data-session-go]');
  await until(`!window.__bag.groups[0].figma`);
  check(Boolean(await evaluate(`window.__bag.groups[0].jira?.key === 'SS-112'`)), 'removing the file later keeps the ticket');

  console.log('Popup with a review started from the report');
  await size(344, 600);
  const fromReport = { groups: [{ id: 'g9', name: 'Started in the report', createdAt: new Date().toISOString(), jira: linkedGroup.jira }], activeGroupId: 'g9', connections, tours: { popup: true, report: true } };
  await open(popup, boot(fromReport));
  await until(`document.querySelector('[data-links] .quiet-link')`);
  check((await textOf('[data-toggle-label]')) === 'Start annotating' && (await textOf('[data-review-name]')) === 'Started in the report', 'an empty review from the report opens on any site');
  await open(popup, boot(rendered, `window.__TAB_URL = 'file:///C:/work/mock.html';`));
  await sleep(300);
  check(await evaluate(`document.querySelector('[data-restricted]').hidden && !document.querySelector('[data-toggle]').disabled`), 'a file page is not treated as a Chrome page');

  console.log('Popup on a restricted page');
  await size(344, 600);
  await open(popup, boot(rendered, `window.__TAB_URL = 'chrome://extensions/';`));
  await until(`!document.querySelector('[data-restricted]').hidden`);
  check(await evaluate(`document.querySelector('[data-toggle]').disabled`), 'Start annotating is off on a Chrome page');
  check(/Nothing to show on this tab. Your review has 8 comments on Home./.test(await textOf('[data-note]')), 'restricted page names where the comments are');
  check(await evaluate(`document.querySelector('[data-report]').classList.contains('primary')`), 'Open report becomes the one primary button');
  await shoot('pp-restricted', true);

  console.log('Popup in dark');
  await size(344, 600);
  await open(popup, boot({ ...rendered, theme: 'dark' }));
  await until(`document.querySelector('[data-links] .quiet-link')`);
  await shoot('pp-review-open-dark', true);

  console.log('Report header, Send to Jira and Post to Figma');
  await size(VIEW.width, VIEW.height);
  await open(report, boot(rendered));
  await until(`document.querySelector('[data-link-chips] .link-chip')`);
  const chips = await evaluate(`[...document.querySelectorAll('.link-chip')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim())`);
  check(chips[0] === 'SS-112 In review' && chips[1] === 'Smart Spaces website', `report header chips ${JSON.stringify(chips)}`);
  await click('.link-chip');
  check((await evaluate('window.__opened.at(-1)')) === `${JIRA_SITE}/browse/SS-112`, 'ticket chip opens the ticket');
  await shoot('rp-header');
  await click('.review-menu > summary');
  await shoot('rp-review-menu');
  await click('[data-edit-links]');
  await until(`document.querySelector('[data-session-dialog][open] [data-session-name]')`);
  await shoot('rp-edit-links');
  await press('Escape');
  check(!(await evaluate(`document.querySelector('[data-session-dialog]').open`)), 'Escape closes the sheet');

  await click('[data-send-jira]');
  await until(`document.querySelector('[data-jira-body] [data-project] option[value="10010"]')`);
  const jiraDefaults = await evaluate(`({
    site: document.querySelector('[data-site]').value,
    project: document.querySelector('[data-project]').value,
    mode: document.querySelector('[name="jira-mode"]:checked').value,
    text: document.querySelector('[data-jira-body]').innerText,
    go: document.querySelector('[data-jira-go]').textContent,
  })`);
  check(jiraDefaults.site === 'c1' && jiraDefaults.project === '10010', `Send to Jira opens on the ticket's site and project SS (${jiraDefaults.site}, ${jiraDefaults.project})`);
  check(jiraDefaults.mode === 'each' && /each linked to SS-112/.test(jiraDefaults.text) && /One comment on SS-112/.test(jiraDefaults.text), 'issues per comment link to SS-112, one comment on SS-112 is the other choice');
  await shoot('rp-send-jira');
  await evaluate(`document.querySelector('[name="jira-mode"][value="ticket"]').click()`);
  check((await evaluate(`document.querySelector('[data-jira-go]').textContent`)) === 'Comment on SS-112', 'the button names the comment on SS-112');
  await click('[data-jira-close]');

  await click('[data-send-figma]');
  await until(`document.querySelector('[data-figma-body] [data-frame]')`);
  check(/Posting to Smart Spaces website/.test(await textOf('[data-figma-body]')), 'Post to Figma opens on the linked file');
  check((await evaluate(`document.querySelector('[data-figma-go]').disabled`)) === true, 'nothing is ready before a frame is picked');
  await evaluate(`(() => { const s = document.querySelector('[data-frame="0"]'); s.value = s.querySelector('option[value]:not([value=""])').value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check((await evaluate(`document.querySelector('[data-figma-go]').textContent`)) === 'Post 1 comment', 'picking a frame readies that row and the button counts it');
  await shoot('rp-post-figma');
  await click('[data-figma-close]');

  console.log('Review file and the composer contract');
  const trip = await evaluate(`(async () => {
    const file = await import('../../extension/lib/review-file.js');
    const group = { ...window.__bag.groups[0], figma: { ...window.__bag.groups[0].figma, url: 'javascript:alert(1)', frames: Array.from({ length: 400 }, (_, i) => ({ id: '1:' + i, name: 'F' + i, page: 'P' })) } };
    const store = await import('../../extension/lib/store.js');
    const text = file.buildReviewFile(group, await store.hydrate(window.__bag.issues), {});
    const back = file.parseReviewFile(text);
    const res = await chrome.runtime.sendMessage({ type: 'importReview', contents: text });
    const imported = window.__bag.groups.find((g) => g.id === res.group.id);
    const active = await chrome.runtime.sendMessage({ type: 'activeReview' });
    return { back: { jira: back.jira, figma: { ...back.figma, frames: back.figma.frames.length } }, imported: { jira: imported.jira?.key, summary: imported.jira?.summary, frames: imported.figma?.frames.length, url: imported.figma?.url }, active, opened: { count: window.__bag.issues.filter((i) => i.groupId === res.group.id).length, images: window.__bag.issues.filter((i) => i.groupId === res.group.id && window.__bag['img:' + i.id]?.shot && window.__bag['img:' + i.id]?.detail).length, inline: window.__bag.issues.filter((i) => 'shot' in i || 'detail' in i).length } };
  })()`);
  check(trip.back.jira.key === 'SS-112' && trip.back.jira.summary === 'Homepage rebuild QA' && trip.back.jira.url === `${JIRA_SITE}/browse/SS-112`, 'review file keeps the ticket');
  check(trip.back.figma.fileKey === 'AbCdEf123' && trip.back.figma.frames === 300 && trip.back.figma.url === '', 'review file keeps the file, caps frames at 300 and drops a non web link');
  check(trip.imported.jira === 'SS-112' && trip.imported.summary === 'Homepage rebuild QA' && trip.imported.frames === 300 && trip.imported.url === '', 'importing a review file restores its links');
  check(trip.active.id === 'g1' && trip.active.jira?.key === 'SS-112' && trip.active.name === 'Smart Spaces homepage QA', 'activeReview returns the raw active group');
  check(trip.opened.count > 0 && trip.opened.images === trip.opened.count && trip.opened.inline === 0, `opening a review file writes each comment's images to its own key, none inline (${trip.opened.images} of ${trip.opened.count})`);
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

check(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors.slice(0, 5).join(' | ')}` : ''}`);
console.log(failures.length ? `${failures.length} checks failed` : 'All checks passed');
process.exitCode = failures.length ? 1 : 0;
