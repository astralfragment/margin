/**
 * Captures the screenshots the welcome tour shows, from the built extension, in light and dark at 2x.
 * Writes extension/public/onboarding/<step>-<light|dark>.webp. Run `npm run build` first, then
 * `node scripts/onboarding-shots.mjs`. Playwright is not a dependency of Margin, so when it is installed
 * globally run it with NODE_PATH set to the global node_modules folder.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = resolve(import.meta.dirname, '..');
const BUILD = join(ROOT, '.output/chrome-mv3');
const OUT = join(ROOT, 'extension/public/onboarding');
const VIEWPORT = { width: 1280, height: 800 };
const REVIEW = 'Fernwood shop';

/** A believable, colourful shop page to review. Its Add to basket button is cut off, the problem the tour marks. */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fernwood Coffee</title><style>
*{box-sizing:border-box}body{margin:0;font:16px/1.5 Georgia,serif;color:#2b1d14;background:#fbf4ea}
nav{display:flex;align-items:center;gap:28px;padding:18px 64px;font:15px system-ui,sans-serif;background:#1f3d2b;color:#f6efe2}
nav b{margin-right:auto;font:700 22px Georgia,serif;letter-spacing:.02em}nav span:last-child{padding:8px 16px;border-radius:999px;background:#f2b84b;color:#1f3d2b;font-weight:600}
.hero{display:grid;grid-template-columns:1.05fr 1fr;gap:48px;align-items:center;padding:56px 64px 40px}
h1{margin:0 0 16px;font-size:56px;line-height:1.02;color:#1f3d2b}p{margin:0 0 24px;font:18px/1.55 system-ui,sans-serif;color:#5b4636}
.price{font:600 22px system-ui,sans-serif;color:#c2562f;margin-bottom:20px}
.cta{display:inline-block;width:156px;overflow:hidden;white-space:nowrap;padding:15px 24px;border-radius:12px;background:#c2562f;color:#fff;font:600 17px system-ui,sans-serif}
.bag{height:340px;border-radius:28px;background:radial-gradient(circle at 30% 30%,#f2b84b 0 18%,transparent 19%),linear-gradient(150deg,#e9824f,#c2562f 55%,#7a2f1b);position:relative;box-shadow:0 30px 60px -30px #7a2f1b}
.bag:after{content:"Single origin  ·  Huila";position:absolute;left:32px;bottom:28px;font:600 18px system-ui,sans-serif;color:#fff8ec}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:0 64px;font:15px system-ui,sans-serif}
.row div{padding:18px 20px;border-radius:16px;background:#fff;box-shadow:0 1px 0 #e8dccb}.row b{display:block;font:700 17px Georgia,serif;color:#1f3d2b}
.row i{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px;vertical-align:-1px}
</style></head><body><nav><b>Fernwood Coffee</b><span>Shop</span><span>Subscriptions</span><span>Our farms</span><span>Basket (2)</span></nav>
<section class="hero"><div><h1>Huila Pink Bourbon</h1><p>Bright and juicy, with notes of red grapefruit, honey and black tea. Roasted every Monday.</p>
<div class="price">R 189 for 250 g</div><span class="cta">Add to basket</span></div><div class="bag"></div></section>
<section class="row"><div><b><i style="background:#e9824f"></i>Fruity</b>Light roast for filter</div><div><b><i style="background:#8a5a3b"></i>Chocolatey</b>Medium roast for espresso</div><div><b><i style="background:#1f3d2b"></i>Decaf</b>Swiss water process</div></section></body></html>`;

/** A copy of the build that may run on the sample page. Only this temporary copy gets host access. */
function extensionCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'margin-shots-'));
  cpSync(BUILD, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

/** Serves the sample page on a free port. */
async function serve() {
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

/**
 * Screenshots the page and saves it as webp, encoded by the browser since Playwright only writes png and jpeg.
 * @param {import('playwright').Page} page The page to capture.
 * @param {string} name The file name without extension.
 */
async function save(page, name) {
  await page.addStyleTag({ content: '::-webkit-scrollbar { display: none }' });
  await page.waitForTimeout(400);
  const png = (await page.screenshot()).toString('base64');
  const webp = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.86).split(',')[1];
  }, png);
  writeFileSync(join(OUT, `${name}.webp`), Buffer.from(webp, 'base64'));
}

async function capture(theme, ext, siteUrl) {
  const ctx = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: theme,
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  try {
    let [worker] = ctx.serviceWorkers();
    worker ??= await ctx.waitForEvent('serviceworker');
    const base = `chrome-extension://${worker.url().split('/')[2]}`;
    await new Promise((done) => setTimeout(done, 1000));
    for (const open of ctx.pages()) if (open.url().includes('welcome')) await open.close();

    const options = await ctx.newPage();
    await options.goto(`${base}/options.html`);
    await options.evaluate(async ({ theme, review }) => {
      await chrome.storage.local.set({
        theme,
        tours: { report: true, popup: true },
        onboardingSeen: true,
        connections: { jira: { account: { name: 'Sam Lee', email: 'sam@northwind.example' }, sites: [{ name: 'northwind' }] } },
      });
      const { group } = await chrome.runtime.sendMessage({ type: 'groupCreate', name: review });
      await chrome.runtime.sendMessage({ type: 'groupSelect', id: group.id });
    }, { theme, review: REVIEW });

    const site = await ctx.newPage();
    await site.goto(siteUrl);
    await worker.evaluate(async ({ url, review }) => {
      const [tab] = await chrome.tabs.query({ url: `${url}*` });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { type: 'start', groupName: review });
    }, { url: siteUrl, review: REVIEW });
    await save(site, `start-${theme}`);

    const cta = await site.locator('.cta').boundingBox();
    await site.mouse.move(cta.x - 16, cta.y - 16);
    await site.mouse.down();
    await site.mouse.move(cta.x + cta.width + 24, cta.y + cta.height + 16, { steps: 10 });
    await site.mouse.up();
    await site.waitForTimeout(1200);
    await site.keyboard.type('Add to basket text is cut off');
    await save(site, `mark-${theme}`);
    await site.keyboard.press('Enter');
    await site.waitForTimeout(1500);

    const report = await ctx.newPage();
    await report.goto(`${base}/report.html`);
    await report.waitForTimeout(1500);
    await report.keyboard.press('Escape');
    const share = report.getByRole('button', { name: /share/i }).first();
    if (await share.isVisible().catch(() => false)) await share.click();
    await save(report, `share-${theme}`);

    // A narrower window, still 16:10, so the settings column fills the frame.
    await options.setViewportSize({ width: 880, height: 550 });
    await options.goto(`${base}/options.html#connections`);
    await options.reload();
    await options.bringToFront();
    await save(options, `connect-${theme}`);
  } finally {
    await ctx.close();
  }
}

mkdirSync(OUT, { recursive: true });
const ext = extensionCopy();
const { server, url } = await serve();
try {
  for (const theme of ['light', 'dark']) await capture(theme, ext, url);
} finally {
  server.close();
  rmSync(ext, { recursive: true, force: true });
}
