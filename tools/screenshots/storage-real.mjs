import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the real unpacked extension in a throwaway headless Chrome and works with a store the size of a long review.
 *
 * The timing run seeds comments in the old shape, where every image sits inside the issues array, reloads the
 * extension so any migration runs, and then times a save, a patch, a status change sent from the overlay and the
 * overlay's own refresh. For each it records how long the call took, how long the change took to reach the content
 * script on an open page, and the longest stall on that page's main thread.
 *
 * The migrate run seeds the old shape, reloads the extension, interrupts the migration once part way, and then checks
 * that every comment, image and clean screenshot survived, that the issues list is small, and that the report shows
 * every image.
 *
 * Options
 *   timing or migrate, the run to do (timing by default)
 *   --shape her       133 comments sized like the real install, about 30 MB
 *   --shape big       133 comments at about 105 MB (the default)
 *   --from <file>     a JSON dump of chrome.storage.local to seed instead, with sign in keys left out
 *   --label <name>    names the results file in dist/storage-timing
 * Run with node tools/screenshots/storage-real.mjs timing --shape big --label before.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK = join(ROOT, 'dist', '.storage');
const COPY = join(WORK, 'extension');
const RESULTS = join(ROOT, 'dist', 'storage-timing');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8796;
const TAB_URL = `http://127.0.0.1:${PORT}/home`;
const SECRET_KEYS = ['jiraAuth', 'jiraConfig', 'connections', 'oauth'];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const failures = [];

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'timing';
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const shapeName = option('shape', 'big');
const fromFile = option('from', null);
const label = option('label', mode);

const SHAPES = {
  her: { comments: 133, shotKB: 150, detailKB: 37, afterEvery: 44, afterKB: 30, widthsEvery: 0, widthKB: 0, rawEvery: 10, rawKB: 350 },
  big: { comments: 133, shotKB: 625, detailKB: 156, afterEvery: 13, afterKB: 156, widthsEvery: 13, widthKB: 110, rawEvery: 7, rawKB: 330 },
};

/**
 * Records a check, printed at the end.
 * @param {boolean} ok Whether it held.
 * @param {string} what What was checked.
 */
function check(ok, what) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
}

let seedJson = null;
if (fromFile) {
  const dump = JSON.parse(readFileSync(resolve(fromFile), 'utf8'));
  for (const key of SECRET_KEYS) delete dump[key];
  seedJson = JSON.stringify(dump);
}

const server = createServer((req, res) => {
  if (req.url === '/seed.json' && seedJson) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(seedJson);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><head><title>Stand in page</title></head><body style="font:16px sans-serif;padding:40px"><h1>Living switched on</h1><p>A stand in page for the review.</p><div style="height:2000px"></div></body></html>');
});
await new Promise((done) => server.listen(PORT, '127.0.0.1', done));

rmSync(COPY, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
const profile = mkdtempSync(join(tmpdir(), 'margin-storage-'));
mkdirSync(RESULTS, { recursive: true });
cpSync(join(ROOT, 'extension'), COPY, { recursive: true });
const manifest = JSON.parse(readFileSync(join(COPY, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
writeFileSync(join(COPY, 'manifest.json'), JSON.stringify(manifest, null, 2));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
const toChrome = chrome.stdio[3];
const fromChrome = chrome.stdio[4];
let next = 0;
const pending = new Map();
const listeners = [];
let buffer = '';
fromChrome.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else ok(msg.result);
    } else if (msg.method) listeners.forEach((fn) => fn(msg));
  }
});

/**
 * Sends one protocol command over the pipe.
 * @param {string} method The protocol method.
 * @param {object} [params] Its parameters.
 * @param {string} [sessionId] The attached target, when the command is for one.
 */
function send(method, params = {}, sessionId) {
  const id = ++next;
  toChrome.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  return new Promise((ok, reject) => pending.set(id, { resolve: ok, reject }));
}

/**
 * Runs an expression in a target and returns its value.
 * @param {string} sessionId The page or worker session.
 * @param {string} expression JavaScript to evaluate, awaited when it returns a promise.
 */
async function evaluate(sessionId, expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/**
 * Calls a self contained function in a target with JSON arguments.
 * @param {string} sessionId The page or worker session.
 * @param {Function} fn The function, which must not close over anything.
 * @param {...unknown} params Its arguments.
 */
const call = (sessionId, fn, ...params) => evaluate(sessionId, `(${fn})(...${JSON.stringify(params)})`);

/**
 * Waits until an expression is truthy in a target.
 * @param {string} sessionId The target session.
 * @param {string} expression The condition.
 * @param {number} [ms] How long to wait.
 */
async function until(sessionId, expression, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(sessionId, expression).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

const workerLogs = [];
const seenLogs = new Set();
let extensionId = '';

listeners.push(async (msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const { sessionId, targetInfo, waitingForDebugger } = msg.params;
    if (targetInfo.type === 'service_worker' && targetInfo.url.startsWith(`chrome-extension://${extensionId}/`)) {
      await send('Runtime.enable', {}, sessionId).catch(() => {});
    }
    if (waitingForDebugger) await send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    const stamp = `${msg.params.timestamp}|${text}`;
    if (/margin/i.test(text) && !seenLogs.has(stamp)) {
      seenLogs.add(stamp);
      workerLogs.push(text);
      console.log(`    worker: ${text}`);
    }
  }
});

const oldWorkers = new Set();

/** Finds the extension's newest service worker, skipping any that a reload has replaced, and attaches to it. */
async function attachWorker() {
  for (let i = 0; i < 200; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const worker = targetInfos.find(
      (t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extensionId}/`) && !oldWorkers.has(t.targetId),
    );
    if (worker) {
      const { sessionId } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });
      return { sessionId, targetId: worker.targetId };
    }
    await sleep(100);
  }
  throw new Error('service worker did not start');
}

/**
 * Loads the extension again, the way an update arrives, and attaches to the worker that replaces the running one.
 * chrome.runtime.reload would drop an extension loaded over the protocol, so it is loaded a second time instead.
 * @param {{ sessionId: string, targetId: string }} worker The running worker.
 */
async function reloadExtension(worker) {
  oldWorkers.add(worker.targetId);
  await send('Extensions.loadUnpacked', { path: COPY });
  const fresh = await attachWorker();
  await send('Runtime.enable', {}, fresh.sessionId).catch(() => {});
  return fresh;
}

/**
 * Opens a URL in its own window, so its timers are never throttled as a background tab, and attaches to it.
 * @param {string} url The page to open.
 */
async function openPage(url) {
  const { targetId } = await send('Target.createTarget', { url, newWindow: true });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await sleep(1200);
  for (let i = 0; i < 10 && url.startsWith('chrome-extension://'); i++) {
    if (await evaluate(sessionId, 'Boolean(globalThis.chrome?.storage)').catch(() => false)) break;
    await send('Page.reload', {}, sessionId);
    await sleep(1000);
  }
  return { targetId, sessionId };
}

/**
 * Runs in an extension page. Writes comments in the old shape, every image inside the issues array, plus clean
 * screenshots for some, and returns a fingerprint of every image by comment id.
 * @param {object} shape How many comments and how big their images are, or null to load seedUrl.
 * @param {string} tabUrl The page the first review's comments were made on.
 * @param {string | null} seedUrl A storage dump to load instead of generating comments.
 */
async function seedOld(shape, tabUrl, seedUrl) {
  const fp = (src) => (typeof src === 'string' ? `${src.length}:${src.slice(-48)}` : null);
  const print = (issue, raw) => ({
    id: issue.id,
    shot: fp(issue.shot),
    detail: fp(issue.detail),
    after: fp(issue.after),
    widths: Object.fromEntries(Object.entries(issue.shots ?? {}).map(([k, v]) => [k, fp(v?.src)])),
    raw: fp(raw?.src),
  });
  await chrome.storage.local.clear();
  if (seedUrl) {
    const dump = await (await fetch(seedUrl)).json();
    const { issues = [], ...rest } = dump;
    await chrome.storage.local.set(rest);
    await chrome.storage.local.set({ issues });
    await chrome.storage.local.remove('storeVersion');
    return { prints: issues.map((issue) => print(issue, dump[`raw:${issue.id}`])), groups: (dump.groups ?? []).length };
  }
  const calibrate = async (w, h) => {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const bytes = img.data;
    for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(bytes.length, i + 65536)));
    for (let i = 3; i < bytes.length; i += 4) bytes[i] = 255;
    ctx.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return new Promise((done) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result);
      reader.readAsDataURL(blob);
    });
  };
  const sample = await calibrate(200, 150);
  const perPixel = sample.length / (200 * 150);
  const jpeg = (kb) => {
    const pixels = (kb * 1024) / perPixel;
    const w = Math.max(16, Math.round(Math.sqrt((pixels * 4) / 3)));
    return calibrate(w, Math.max(12, Math.round((w * 3) / 4)));
  };
  const groups = Array.from({ length: 6 }, (_, i) => ({ id: `g${i + 1}`, name: `Review ${i + 1}`, createdAt: new Date(Date.now() - i * 86400000).toISOString() }));
  const issues = [];
  const raws = {};
  for (let i = 0; i < shape.comments; i++) {
    const group = groups[i % groups.length];
    const issue = {
      id: `c${String(i + 1).padStart(3, '0')}-${crypto.randomUUID().slice(0, 8)}`,
      groupId: group.id,
      createdAt: new Date(Date.now() - (shape.comments - i) * 60000).toISOString(),
      severity: ['blocker', 'major', 'minor', 'nit'][i % 4],
      status: 'open',
      title: `Comment ${i + 1} title`,
      note: `Expected one thing, saw another, comment ${i + 1}.`,
      page: { url: group.id === 'g1' ? tabUrl : `https://example.com/page-${i}`, title: 'A page' },
      viewport: { width: 1280, height: 800, scrollY: 0, dpr: 1 },
      env: { browser: 'Google Chrome 156', os: 'Windows', zoom: 100 },
      element: { selector: `main > section:nth-child(${i + 1})`, tag: 'section', classes: 'hero', text: 'Living switched on' },
      anchor: null,
      rect: { x: 40 + (i % 10) * 20, y: 80 + (i % 7) * 30, w: 320, h: 120 },
      marks: [],
      shot: await jpeg(shape.shotKB),
      detail: await jpeg(shape.detailKB),
    };
    if (shape.afterEvery && i % shape.afterEvery === 1) Object.assign(issue, { after: await jpeg(shape.afterKB), checkedAt: new Date().toISOString(), change: 0.01 });
    if (shape.widthsEvery && i % shape.widthsEvery === 2) {
      issue.shots = {
        mobile: { src: await jpeg(shape.widthKB), width: 375, placed: 'found' },
        tablet: { src: await jpeg(shape.widthKB), width: 768, placed: 'found' },
        desktop: { src: await jpeg(shape.widthKB), width: 1280, placed: 'hidden' },
      };
      issue.shotsAt = new Date().toISOString();
    }
    if (shape.rawEvery && i % shape.rawEvery === 3) raws[`raw:${issue.id}`] = { src: await jpeg(shape.rawKB), hasBox: false };
    issues.push(issue);
  }
  await chrome.storage.local.set({ groups, activeGroupId: 'g1', tours: { popup: true, report: true }, ...raws });
  await chrome.storage.local.set({ issues });
  await chrome.storage.local.remove('storeVersion');
  return { prints: issues.map((issue) => print(issue, raws[`raw:${issue.id}`])), groups: groups.length };
}

/**
 * Runs in an extension page. Reads back what the store holds now, in the same fingerprint form as seedOld,
 * along with what is left inline in the issues list and the size of each part.
 */
async function readBack() {
  const fp = (src) => (typeof src === 'string' ? `${src.length}:${src.slice(-48)}` : null);
  const { issues = [] } = await chrome.storage.local.get('issues');
  const prints = [];
  for (let i = 0; i < issues.length; i += 20) {
    const batch = issues.slice(i, i + 20);
    const bag = await chrome.storage.local.get(batch.flatMap((issue) => [`img:${issue.id}`, `raw:${issue.id}`]));
    for (const issue of batch) {
      const images = { ...issue, ...(bag[`img:${issue.id}`] ?? {}) };
      prints.push({
        id: issue.id,
        shot: fp(images.shot),
        detail: fp(images.detail),
        after: fp(images.after),
        widths: Object.fromEntries(Object.entries(images.shots ?? {}).map(([k, v]) => [k, fp(v?.src)])),
        raw: fp(bag[`raw:${issue.id}`]?.src),
      });
    }
  }
  const keys = chrome.storage.local.getKeys ? await chrome.storage.local.getKeys() : [];
  const ids = new Set(issues.map((issue) => issue.id));
  return {
    prints,
    inline: issues.filter((issue) => ['shot', 'detail', 'after', 'shots'].some((f) => f in issue)).length,
    listBytes: await chrome.storage.local.getBytesInUse('issues'),
    totalBytes: await chrome.storage.local.getBytesInUse(null),
    strayImages: keys.filter((k) => k.startsWith('img:') && !ids.has(k.slice(4))).length,
    imageKeys: keys.filter((k) => k.startsWith('img:')).length,
    version: (await chrome.storage.local.get('storeVersion')).storeVersion ?? null,
  };
}

/**
 * Seeds the store, reloads the extension so a migration can run on the old shape, and returns the worker.
 * @param {{ sessionId: string, targetId: string }} sw The service worker before the reload.
 * @param {(worker: { sessionId: string, targetId: string }) => Promise<{ sessionId: string, targetId: string } | void>} [during]
 *   Runs once the reload has started, used to interrupt it, and returns the worker that replaced it when it reloads again.
 */
async function seedAndReload(sw, during) {
  const page = await openPage(`chrome-extension://${extensionId}/welcome.html`);
  const started = Date.now();
  const seeded = await call(page.sessionId, seedOld, fromFile ? null : SHAPES[shapeName], TAB_URL, fromFile ? `http://127.0.0.1:${PORT}/seed.json` : null);
  const sizes = await evaluate(page.sessionId, `Promise.all([chrome.storage.local.getBytesInUse('issues'), chrome.storage.local.getBytesInUse(null)])`);
  console.log(`  seeded ${seeded.prints.length} comments in ${seeded.groups} reviews, issues list ${mb(sizes[0])}, whole store ${mb(sizes[1])}, in ${Date.now() - started} ms`);
  await send('Target.closeTarget', { targetId: page.targetId });
  const reloadedAt = workerLogs.length;
  let worker = await reloadExtension(sw);
  if (during) worker = (await during(worker, reloadedAt)) ?? worker;
  return { worker: worker.sessionId, seeded, sizes };
}

/**
 * Megabytes with one decimal, for log lines.
 * @param {number} bytes A byte count.
 */
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/**
 * True when the store has finished migrating, or when this build has no migration.
 * @param {string} worker The service worker session.
 */
async function migrated(worker) {
  const hasMigration = readFileSync(join(COPY, 'lib', 'store.js'), 'utf8').includes('migrateImages');
  if (!hasMigration) return true;
  return until(worker, `chrome.storage.local.get('storeVersion').then((b) => b.storeVersion === 2)`, 600000);
}

/**
 * Runs in the page's isolated world, next to content.js. Records when each storage change arrives.
 */
function listenForChanges() {
  window.__deliveries = [];
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') window.__deliveries.push({ at: Date.now(), keys: Object.keys(changes) });
  });
  return true;
}

/**
 * Times one operation and what it costs the open page.
 * @param {string} name What is timed.
 * @param {() => Promise<{ t0: number, ms: number }>} run Starts the operation and reports when it began and how long it took.
 * @param {string} worker The service worker session, used to read the content script's records.
 * @param {number} tabId The open page's tab id.
 * @param {string} tab The open page's session.
 */
async function measure(name, run, worker, tabId, tab) {
  const rounds = [];
  for (let i = 0; i < 3; i++) {
    await call(worker, async (id) => {
      await chrome.scripting.executeScript({ target: { tabId: id }, func: () => (window.__deliveries = []) });
    }, tabId);
    await evaluate(tab, 'window.__hb.max = 0, window.__hb.last = performance.now(), true');
    const { t0, ms } = await run(i);
    await sleep(2500);
    const deliveries = await call(worker, async (id) => {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: id }, func: () => window.__deliveries });
      return result;
    }, tabId);
    const stall = await evaluate(tab, 'window.__hb.max');
    const last = deliveries.length ? Math.max(...deliveries.map((d) => d.at)) - t0 : null;
    rounds.push({ ms: Math.round(ms), delivery: last, stall: Math.round(stall), keys: [...new Set(deliveries.flatMap((d) => d.keys.map((k) => k.replace(/:.*/, ':<id>'))))] });
  }
  const mid = (values) => [...values].sort((a, b) => a - b)[1];
  const row = {
    name,
    callMs: mid(rounds.map((r) => r.ms)),
    deliveryMs: rounds.every((r) => r.delivery == null) ? null : mid(rounds.map((r) => r.delivery ?? 0)),
    pageStallMs: mid(rounds.map((r) => r.stall)),
    keys: rounds[0].keys,
    rounds,
  };
  console.log(`  ${name.padEnd(28)} call ${String(row.callMs).padStart(6)} ms   reaches page ${String(row.deliveryMs ?? '-').padStart(6)} ms   page stall ${String(row.pageStallMs).padStart(6)} ms   keys ${row.keys.join(' ') || 'none'}`);
  return row;
}

/**
 * Runs in an extension page. Makes a new comment's images at the shape's size, kept on window for the timed save.
 * @param {number} shotKB The viewport image size.
 * @param {number} detailKB The region image size.
 */
async function prepareSave(shotKB, detailKB) {
  const draw = async (w, h) => {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < img.data.length; i += 65536) crypto.getRandomValues(img.data.subarray(i, Math.min(img.data.length, i + 65536)));
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return new Promise((done) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result);
      reader.readAsDataURL(blob);
    });
  };
  const perPixel = (await draw(200, 150)).length / (200 * 150);
  const make = (kb) => {
    const w = Math.round(Math.sqrt((kb * 1024 * 4) / 3 / perPixel));
    return draw(w, Math.round((w * 3) / 4));
  };
  window.__store = await import('/lib/store.js');
  window.__images = { shot: await make(shotKB), detail: await make(detailKB) };
  return { shot: window.__images.shot.length, detail: window.__images.detail.length };
}

/**
 * Runs in an extension page. Saves one new comment with its images through the store.
 * @param {string} url The page it was made on.
 * @param {number} round Which repeat this is.
 */
async function timedSave(url, round) {
  const issue = {
    id: crypto.randomUUID(),
    groupId: 'g1',
    createdAt: new Date().toISOString(),
    severity: 'major',
    status: 'open',
    title: `Timed save ${round}`,
    note: '',
    page: { url, title: 'Stand in page' },
    viewport: { width: 1280, height: 800, scrollY: 0, dpr: 1 },
    element: null,
    anchor: null,
    rect: { x: 10, y: 10, w: 200, h: 100 },
    ...window.__images,
  };
  const t0 = Date.now();
  const p0 = performance.now();
  await window.__store.addIssue(issue);
  return { t0, ms: performance.now() - p0 };
}

/**
 * Runs in an extension page. Changes one comment's title through the store.
 * @param {number} round Which repeat this is.
 */
async function timedPatch(round) {
  const { issues } = await chrome.storage.local.get('issues');
  const id = issues[5 + round].id;
  const t0 = Date.now();
  const p0 = performance.now();
  await window.__store.patchIssue(id, { title: `Patched ${round} ${Date.now()}` });
  return { t0, ms: performance.now() - p0 };
}

let exitCode = 0;
try {
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const { id } = await send('Extensions.loadUnpacked', { path: COPY });
  extensionId = id;
  console.log(`  loaded extension ${id}, ${mode} run, ${fromFile ? 'seeded from a storage dump' : `${shapeName} shape`}`);
  const firstWorker = await attachWorker();

  if (mode === 'migrate') {
    let interrupted = false;
    let seen = workerLogs.length;
    const { worker, seeded, sizes } = await seedAndReload(firstWorker, async (w, from) => {
      seen = from;
      const end = Date.now() + 120000;
      while (Date.now() < end && !workerLogs.slice(seen).some((l) => /moved images/i.test(l))) await sleep(20);
      if (workerLogs.slice(seen).some((l) => /moved images/i.test(l)) && !workerLogs.slice(seen).some((l) => /migration done/i.test(l))) {
        console.log('  interrupting the migration with a reload');
        interrupted = true;
        return reloadExtension(w);
      }
    });
    check(interrupted, 'migration was interrupted part way, so the resume path ran');
    const started = Date.now();
    check(await migrated(worker), 'migration finished and marked the store as version 2');
    console.log(`  migration settled ${Date.now() - started} ms after the restart`);
    check(workerLogs.slice(seen).some((l) => /resum/i.test(l)), 'the restarted migration logged that it resumed');

    const page = await openPage(`chrome-extension://${extensionId}/welcome.html`);
    const after = await call(page.sessionId, readBack);
    const modes = await evaluate(page.sessionId, `chrome.storage.local.get(['shotMode', 'widthMode']).then((b) => ({ shots: b.shotMode ?? 'both', widths: (b.widthMode ?? 'show') === 'show' }))`);
    const before = new Map(seeded.prints.map((p) => [p.id, p]));
    check(after.prints.length === seeded.prints.length, `every comment kept, ${after.prints.length} of ${seeded.prints.length}`);
    check(after.prints.every((p, i) => p.id === seeded.prints[i].id), 'comments keep their order');
    const same = (p) => JSON.stringify({ ...p, widths: Object.fromEntries(Object.entries(p?.widths ?? {}).sort()) });
    const lost = after.prints.filter((p) => same(p) !== same(before.get(p.id)));
    check(!lost.length, `every image and clean screenshot is byte for byte the same${lost.length ? `, ${lost.length} differ` : ''}`);
    for (const p of lost.slice(0, 2)) console.log(`    differs ${JSON.stringify(before.get(p.id))}
    now     ${JSON.stringify(p)}`);
    check(after.inline === 0, 'no images left inside the issues list');
    check(after.listBytes < 1048576, `issues list is ${Math.round(after.listBytes / 1024)} KB, down from ${mb(sizes[0])}`);
    check(after.strayImages === 0, 'no image keys left without a comment');
    const withImages = seeded.prints.filter((p) => p.shot || p.detail || p.after || Object.keys(p.widths).length).length;
    check(after.imageKeys === withImages, `one image key per comment with images, ${after.imageKeys} of ${withImages}`);
    console.log(`  store is ${mb(after.totalBytes)} after migrating`);
    await send('Target.closeTarget', { targetId: page.targetId });

    const shown = (p) =>
      (modes.shots !== 'viewport' && p.detail ? 1 + (p.after ? 1 : 0) : 0) +
      (modes.shots !== 'detail' && p.shot ? 1 : 0) +
      (modes.widths ? Object.values(p.widths).filter(Boolean).length : 0);
    const expected = seeded.prints.reduce((n, p) => n + shown(p), 0);
    console.log(`  report image setting ${modes.shots}, width shots ${modes.widths ? 'shown' : 'hidden'}`);
    const report = await openPage(`chrome-extension://${extensionId}/report.html?group=all`);
    const rendered = await until(report.sessionId, `document.querySelector('[data-preview]')?.contentDocument?.querySelectorAll('.issue').length > 0`, 120000);
    await sleep(1500);
    const counts = await evaluate(
      report.sessionId,
      `(() => { const doc = document.querySelector('[data-preview]').contentDocument; return { cards: doc.querySelectorAll('.issue').length, images: [...doc.querySelectorAll('img')].filter((img) => img.src.startsWith('data:image/')).length, broken: [...doc.querySelectorAll('img')].filter((img) => img.complete && img.naturalWidth === 0).length }; })()`,
    );
    check(rendered && counts.cards === seeded.prints.length, `report shows every comment, ${counts.cards} of ${seeded.prints.length}`);
    check(counts.images === expected, `report shows every image, ${counts.images} of ${expected}`);
    check(counts.broken === 0, 'no image in the report fails to decode');
  } else {
    const { worker } = await seedAndReload(firstWorker);
    const settled = Date.now();
    check(await migrated(worker), 'store is ready');
    console.log(`  ready ${Date.now() - settled} ms after the restart`);

    const tabPage = await openPage(TAB_URL);
    await evaluate(tabPage.sessionId, `window.__hb = { last: performance.now(), max: 0 }, setInterval(() => { const n = performance.now(); window.__hb.max = Math.max(window.__hb.max, n - window.__hb.last); window.__hb.last = n; }, 5), true`);
    const tabId = await call(worker, async (url) => {
      const [tab] = await chrome.tabs.query({ url: `${url}*` });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'toggle', groupName: 'Review 1' });
      return tab.id;
    }, TAB_URL);
    await evaluate(worker, `chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: ${listenForChanges} }).then(() => true)`);
    await sleep(1500);

    const page = await openPage(`chrome-extension://${extensionId}/welcome.html`);
    const shape = SHAPES[shapeName];
    const made = await call(page.sessionId, prepareSave, shape.shotKB, shape.detailKB);
    console.log(`  a new comment carries ${Math.round((made.shot + made.detail) / 1024)} KB of images`);
    const sizes = await evaluate(page.sessionId, `Promise.all([chrome.storage.local.getBytesInUse('issues'), chrome.storage.local.getBytesInUse(null)])`);
    console.log(`  issues list ${mb(sizes[0])}, whole store ${mb(sizes[1])}`);

    const rows = [];
    rows.push(await measure('save a comment with images', (i) => call(page.sessionId, timedSave, TAB_URL, i), worker, tabId, tabPage.sessionId));
    rows.push(await measure('patch a title', (i) => call(page.sessionId, timedPatch, i), worker, tabId, tabPage.sessionId));
    rows.push(
      await measure(
        'overlay sends a status',
        (i) =>
          call(worker, async (id, round) => {
            const { issues } = await chrome.storage.local.get('issues');
            const [{ result }] = await chrome.scripting.executeScript({
              target: { tabId: id },
              func: async (issueId, status) => {
                const t0 = Date.now();
                const p0 = performance.now();
                await chrome.runtime.sendMessage({ type: 'update', id: issueId, patch: { status } });
                return { t0, ms: performance.now() - p0 };
              },
              args: [issues[10 + round].id, round % 2 ? 'open' : 'fixed'],
            });
            return result;
          }, tabId, i),
        worker,
        tabId,
        tabPage.sessionId,
      ),
    );
    rows.push(
      await measure(
        'overlay refresh',
        () =>
          call(worker, async (id, url) => {
            const [{ result }] = await chrome.scripting.executeScript({
              target: { tabId: id },
              func: async (pageUrl) => {
                const t0 = Date.now();
                const p0 = performance.now();
                await Promise.all([chrome.runtime.sendMessage({ type: 'activeReview' }), chrome.runtime.sendMessage({ type: 'pageComments', url: pageUrl })]);
                return { t0, ms: performance.now() - p0 };
              },
              args: [url],
            });
            return result;
          }, tabId, TAB_URL),
        worker,
        tabId,
        tabPage.sessionId,
      ),
    );
    const out = join(RESULTS, `${label}.json`);
    writeFileSync(out, JSON.stringify({ label, shape: fromFile ? 'dump' : shapeName, listBytes: sizes[0], storeBytes: sizes[1], rows }, null, 2));
    console.log(`  results in dist/storage-timing/${label}.json`);
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  chrome.kill();
  await Promise.race([new Promise((done) => chrome.once('exit', done)), sleep(5000)]);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {}
  server.close();
}

if (failures.length) console.log(`\n${failures.length} failed`);
else if (!exitCode) console.log('\nall checks passed');
process.exit(failures.length || exitCode ? 1 : 0);
