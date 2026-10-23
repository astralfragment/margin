import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the real unpacked extension in a throwaway headless Chrome over --remote-debugging-pipe and checks
 * that the popup and report open without console errors and that a review can be started with pasted links
 * while Jira and Figma are not connected. It never touches a personal Chrome profile.
 * Run with node tools/screenshots/sessions-real.mjs.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXTENSION = join(ROOT, 'extension');
const OUT = join(ROOT, 'dist', 'redesign-shots', 'sessions');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 8790;
const FIGMA_URL = 'https://www.figma.com/design/AbCdEf123/Smart-Spaces-website';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const errors = [];

/**
 * Records a check, printed at the end.
 * @param {boolean} ok Whether it held.
 * @param {string} what What was checked.
 */
function check(ok, what) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
}

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><head><title>Smart Spaces homepage QA</title></head><body style="font:16px sans-serif;padding:40px"><h1>Living switched on</h1><p>A stand in page for the review.</p></body></html>');
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const profile = mkdtempSync(join(tmpdir(), 'margin-real-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank'],
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
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
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
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

listeners.push((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') errors.push(`${msg.sessionId?.slice(0, 6)} ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/favicon/.test(msg.params.entry.url ?? '')) errors.push(`${msg.params.entry.source} ${msg.params.entry.text}`);
});

/**
 * Attaches to a target and turns on error reporting for it.
 * @param {string} targetId The target.
 */
async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId).catch(() => {});
  return sessionId;
}

/**
 * Runs an expression in an attached target.
 * @param {string} sessionId The target session.
 * @param {string} expression JavaScript, awaited when it returns a promise.
 */
async function evaluate(sessionId, expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/**
 * Polls a target until an expression is truthy.
 * @param {string} sessionId The target session.
 * @param {string} expression The condition.
 */
async function until(sessionId, expression) {
  for (let i = 0; i < 80; i++) {
    if (await evaluate(sessionId, expression).catch(() => false)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

/**
 * Finds a target whose address starts with a prefix.
 * @param {string} prefix The address prefix.
 */
async function targetAt(prefix) {
  for (let i = 0; i < 60; i++) {
    const { targetInfos } = await send('Target.getTargets');
    const found = targetInfos.find((t) => t.url.startsWith(prefix));
    if (found) return found;
    await sleep(150);
  }
  throw new Error(`No target at ${prefix}`);
}

/**
 * Saves a screenshot of an attached page.
 * @param {string} sessionId The target session.
 * @param {string} name The file name without extension.
 */
async function shoot(sessionId, name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  dist/redesign-shots/sessions/${name}.png`);
}

mkdirSync(OUT, { recursive: true });
try {
  const { id } = await send('Extensions.loadUnpacked', { path: EXTENSION });
  check(Boolean(id), `extension loaded as ${id}`);
  const worker = await targetAt(`chrome-extension://${id}/background.js`);
  const workerSession = await attach(worker.targetId);

  const { targetId: pageId } = await send('Target.createTarget', { url: `http://127.0.0.1:${PORT}/` });
  const pageSession = await attach(pageId);
  await send('Page.enable', {}, pageSession);
  await until(pageSession, `document.readyState === 'complete'`);
  await send('Target.activateTarget', { targetId: pageId });
  await sleep(500);
  const tabId = (await send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos.find((t) => t.url.startsWith('http://127.0.0.1:' + PORT)).targetId;

  console.log('Popup');
  await send('Extensions.triggerAction', { id, targetId: tabId });
  const popupTarget = await targetAt(`chrome-extension://${id}/popup.html`);
  const popup = await attach(popupTarget.targetId);
  await until(popup, `document.querySelector('[data-toggle-label]')?.textContent === 'Start review'`);
  check(true, 'popup opens on a site with no review and offers Start review');
  await shoot(popup, 'real-popup-no-review');
  await evaluate(popup, `document.querySelector('[data-toggle]').click()`);
  await until(popup, `document.querySelector('[data-session-name]')?.value === 'Smart Spaces homepage QA'`);
  check(true, 'New review sheet prefills the page title');
  await evaluate(popup, `(() => {
    const paste = (selector, text) => {
      const el = document.querySelector(selector);
      el.focus();
      el.value = text;
      el.dispatchEvent(new Event('paste', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    paste('#session-jira', 'SS-112');
    paste('#session-figma', ${JSON.stringify(FIGMA_URL)});
  })()`);
  await until(popup, `document.querySelectorAll('[data-connect]').length === 2`);
  check(true, 'pasted links show as plain links with Connect to bring in details');
  await shoot(popup, 'real-popup-sheet-not-connected');
  await evaluate(popup, `document.querySelector('[data-session-go]').click()`);
  await until(workerSession, `chrome.storage.local.get('groups').then((b) => b.groups?.some((g) => g.jira?.key === 'SS-112'))`);
  const stored = await evaluate(workerSession, `chrome.storage.local.get(['groups', 'activeGroupId']).then((b) => ({ group: b.groups.find((g) => g.id === b.activeGroupId), count: b.groups.length }))`);
  check(stored.group?.name === 'Smart Spaces homepage QA' && stored.group.site === `127.0.0.1:${PORT}`, 'review started on this site');
  check(stored.group?.jira?.key === 'SS-112' && stored.group.figma?.fileKey === 'AbCdEf123' && stored.group.figma.name === 'Smart Spaces website', 'review keeps the pasted key and file');
  const overlay = await evaluate(pageSession, `new Promise((r) => setTimeout(() => r(Boolean(document.querySelector('div[popover="manual"]'))), 800))`).catch(() => false);
  check(overlay, 'Start review turns annotation on in the page');

  console.log('Report');
  const { targetId: reportId } = await send('Target.createTarget', { url: `chrome-extension://${id}/report.html` });
  const report = await attach(reportId);
  await send('Page.enable', {}, report);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, report);
  await until(report, `document.querySelectorAll('.link-chip').length === 2`);
  const chips = await evaluate(report, `[...document.querySelectorAll('.link-chip')].map((c) => c.innerText.trim())`);
  check(chips[0] === 'SS-112' && chips[1] === 'Smart Spaces website', `report chips ${JSON.stringify(chips)}`);
  await shoot(report, 'real-report-header');
  const active = await evaluate(report, `chrome.runtime.sendMessage({ type: 'activeReview' })`);
  check(active?.id === stored.group.id && active.jira?.key === 'SS-112' && active.figma?.fileKey === 'AbCdEf123', 'activeReview returns the raw active group');

  const popupAgainTarget = await (async () => {
    await send('Target.activateTarget', { targetId: pageId });
    await sleep(300);
    await send('Extensions.triggerAction', { id, targetId: tabId });
    await sleep(800);
    const { targetInfos } = await send('Target.getTargets');
    return targetInfos.filter((t) => t.url.startsWith(`chrome-extension://${id}/popup.html`)).at(-1);
  })();
  if (popupAgainTarget) {
    const again = await attach(popupAgainTarget.targetId);
    await until(again, `document.querySelector('[data-links] .quiet-link')`);
    const text = await evaluate(again, `document.querySelector('[data-links]').innerText`);
    check(/SS-112/.test(text) && /Connect to bring in details/.test(text), 'popup shows the links with the quiet connect line');
    await shoot(again, 'real-popup-review-open');
  } else {
    check(false, 'popup opens a second time');
  }
} catch (err) {
  check(false, `run stopped: ${err.message}`);
} finally {
  await send('Browser.close').catch(() => {});
  await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), sleep(5000)]);
  if (chrome.exitCode === null) chrome.kill();
  server.close();
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {}
}

check(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 6).join(' | ')}` : ''}`);
console.log(failures.length ? `${failures.length} checks failed` : 'All checks passed');
process.exitCode = failures.length ? 1 : 0;
