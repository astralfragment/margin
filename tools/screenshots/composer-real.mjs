import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the real unpacked extension into a throwaway headless Chrome over --remote-debugging-pipe and saves one comment
 * through the composer on the Smart Spaces demo. Headless Chrome cannot grant activeTab, so the run loads a copy of the
 * extension with host access to every site added to its manifest. The source manifest is never changed.
 * Run with node tools/screenshots/composer-real.mjs.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WORK = join(ROOT, 'dist', '.e2e');
const OUT = join(ROOT, 'dist', 'redesign-shots', 'composer');
const COPY = join(WORK, 'extension');
const SITE = 'https://smart-spaces-demo.vercel.app/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
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

rmSync(WORK, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
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
    `--user-data-dir=${join(WORK, 'profile')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
const writer = chrome.stdio[3];
const reader = chrome.stdio[4];
let next = 0;
const pending = new Map();
const events = [];
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
    } else if (msg.method) events.push(msg);
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

try {
  const { id } = await send('Extensions.loadUnpacked', { path: COPY });
  console.log(`  loaded extension ${id}`);
  let worker;
  for (let i = 0; i < 50 && !worker; i++) {
    await sleep(200);
    const { targetInfos } = await send('Target.getTargets');
    worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`));
  }
  const { sessionId: sw } = await send('Target.attachToTarget', { targetId: worker.targetId, flatten: true });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: tab } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, tab);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, tab);
  await send('Page.navigate', { url: SITE }, tab);
  await sleep(4000);

  await evaluate(sw, `(async () => {
    await chrome.storage.local.set({
      groups: [{ id: 'g1', name: 'Smart Spaces homepage QA', createdAt: new Date().toISOString(),
        figma: { fileKey: 'mwtApSfmf8FTZP8MSwWc05', url: 'https://www.figma.com/design/mwtApSfmf8FTZP8MSwWc05/Margin', name: 'Smart Spaces website',
          frames: [{ id: '12:1', name: 'Hero, desktop 1440', page: 'Home' }], fetchedAt: new Date().toISOString() } }],
      activeGroupId: 'g1', markerMode: true, selectorMode: false,
    });
    const [page] = await chrome.tabs.query({ url: '${SITE}*' });
    await chrome.scripting.executeScript({ target: { tabId: page.id }, files: ['content.js'] });
    return chrome.tabs.sendMessage(page.id, { type: 'toggle', groupName: 'Smart Spaces homepage QA' });
  })()`);
  check(await evaluate(tab, 'Boolean(window.__uiAnnotator) === false'), 'content script runs in its own world, the page cannot see it');
  await sleep(800);

  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, ...extra }, tab);
  const strip = { x: 832, y: 646, w: 424, h: 106 };
  await mouse('mouseMoved', strip.x, strip.y);
  await mouse('mousePressed', strip.x, strip.y, { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 10; i++) await mouse('mouseMoved', strip.x + (strip.w * i) / 10, strip.y + (strip.h * i) / 10, { button: 'left', buttons: 1 });
  await mouse('mouseReleased', strip.x + strip.w, strip.y + strip.h, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2500);
  const drafts = await evaluate(sw, `chrome.storage.local.get('issues').then((b) => (b.issues ?? []).length)`);
  check(drafts === 1, 'a real capture stored a draft comment');

  await send('Input.insertText', { text: 'Hero thumbnails look like decoration' }, tab);
  const key = (k, code, vk, text) => [
    send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text }, tab),
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, tab),
  ];
  await Promise.all(key('Tab', 'Tab', 9));
  await sleep(150);
  await Promise.all(key('2', 'Digit2', 50, '2'));
  await sleep(150);
  await mouse('mouseMoved', strip.x + strip.w - 32, strip.y + 60);
  await mouse('mousePressed', strip.x + strip.w - 32, strip.y + 60, { button: 'left', buttons: 1, clickCount: 1 });
  await mouse('mouseReleased', strip.x + strip.w - 32, strip.y + 60, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
  await send('Input.insertText', { text: 'No arrow hints at more projects' }, tab);
  await sleep(200);
  const { data: card } = await send('Page.captureScreenshot', { format: 'png' }, tab);
  writeFileSync(join(OUT, '15-real-extension-card.png'), Buffer.from(card, 'base64'));
  await Promise.all(key('Enter', 'Enter', 13, '\r'));
  await sleep(2500);

  const saved = await evaluate(sw, `chrome.storage.local.get(null).then((b) => {
    const issue = (b.issues ?? [])[0];
    if (!issue) return null;
    return { title: issue.title, severity: issue.severity, marks: issue.marks?.length, markNote: issue.marks?.[0]?.note,
      shot: /^data:image\\/jpeg;base64,/.test(issue.shot ?? ''), detail: /^data:image\\/jpeg;base64,/.test(issue.detail ?? ''),
      raw: Boolean(b['raw:' + issue.id]), groupId: issue.groupId, page: issue.page?.url };
  })`);
  console.log(`  stored ${JSON.stringify(saved)}`);
  check(saved?.title === 'Hero thumbnails look like decoration', 'title saved');
  check(saved?.severity === 'major', 'key 2 saved Major');
  check(saved?.marks === 1 && saved.markNote === 'No arrow hints at more projects', 'marker with its note saved');
  check(saved?.shot && saved.detail && saved.raw, 'screenshots and the clean capture stored');
  const { data: after } = await send('Page.captureScreenshot', { format: 'png' }, tab);
  writeFileSync(join(OUT, '16-real-extension-saved.png'), Buffer.from(after, 'base64'));
  console.log('  15-real-extension-card.png, 16-real-extension-saved.png');
} catch (err) {
  failures.push(err.message);
  console.log(`  FAIL ${err.message}`);
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
