/**
 * Checks that every report format lists the same comments in the same order, with the same detail rows,
 * the same severity then status order and the same dates, under several export configurations.
 * Run with: node extension/tests/consistency.test.mjs
 */
import { buildReport, renderBody } from '../lib/report-template.js';
import { buildDocsHtml, buildDocsText } from '../lib/docs-template.js';
import { buildMarkdown, commentHtml, commentMarkdown } from '../lib/share-template.js';
import { buildReviewModel } from '../lib/review-model.js';
import { EXPORT_PRESETS, applyPreset, editExportConfig, withExportDefaults } from '../lib/export-config.js';

const LABELS = ['Page', 'Figma', 'Links', 'Jira', 'Selector', 'Element', 'Text', 'Styles', 'Position', 'Browser', 'Captured'];
const LABEL_GROUP = `(${LABELS.join('|')})`;

const pages = {
  a: { url: 'https://shop.example.com/catalogue', title: 'Catalogue | Shop' },
  b: { url: 'https://shop.example.com/#/account/settings', title: 'Shop: account' },
  c: { url: 'https://shop.example.com/blog/123', title: 'Blog - Shop' },
};
const element = { selector: 'main > h1.hero', tag: 'h1', classes: 'hero title', text: 'Welcome', styles: { font: '32px Inter 700', color: 'rgb(18, 21, 28)' } };
const base = (n, page, severity, status, extra = {}) => ({
  id: `c${n}`,
  groupId: 'g1',
  title: `Comment ${n}`,
  note: `Note for comment ${n}`,
  severity,
  status,
  page: pages[page],
  createdAt: new Date(Date.UTC(2026, 9, 31, 9, n)).toISOString(),
  rect: { x: 10 * n, y: 20, w: 100, h: 40 },
  viewport: { width: 1280, height: 800, dpr: 2 },
  element,
  detail: 'data:image/png;base64,AA',
  shot: 'data:image/png;base64,AA',
  ...extra,
});
const issues = [
  base(1, 'a', 'minor', 'open', { env: { browser: 'Chrome 141', os: 'macOS', zoom: 100 } }),
  base(2, 'b', 'blocker', 'open', { marks: [{ kind: 'dot', note: 'Too tight' }] }),
  base(3, 'a', 'blocker', 'fixed', { after: 'data:image/png;base64,AA', checkedAt: new Date(Date.UTC(2026, 9, 31, 12)).toISOString() }),
  base(4, 'c', 'nit', 'wontfix', { element: undefined }),
  base(5, 'b', 'major', 'open', { jira: { key: 'SHOP-12', url: 'https://example.atlassian.net/browse/SHOP-12', status: 'In Progress' } }),
  base(6, 'a', 'major', 'open', {
    links: ['https://www.figma.com/design/abc/File?node-id=1-2'],
    env: { browser: 'Firefox 140', os: 'Windows', zoom: 110 },
    shots: { mobile: { src: 'data:image/png;base64,AA', width: 375, placed: 'found' } },
  }),
];
const group = { name: 'Shop review', jira: { key: 'SHOP-1', url: 'https://example.atlassian.net/browse/SHOP-1' }, figma: { fileKey: 'abc', name: 'Shop file', url: 'https://www.figma.com/design/abc' } };
const generatedAt = new Date(Date.UTC(2026, 9, 31, 15));
const EXPECTED = [3, 6, 1, 2, 5, 4];
const statusOfNumber = Object.fromEntries(issues.map((issue, i) => [i + 1, issue.status]));

let failures = 0;
const same = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failures += 1;
  console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
};

/**
 * Splits a document into one chunk per comment, starting at each match of a comment's number.
 * @param {string} text The rendered output.
 * @param {RegExp} start Matches where a comment begins, with its number as the first group.
 */
function chunks(text, start) {
  const hits = [...text.matchAll(start)];
  return hits.map((hit, i) => ({ number: Number(hit[1]), body: text.slice(hit.index, hits[i + 1]?.index ?? text.length) }));
}

const labelsBy = (pattern) => (body) => [...body.matchAll(pattern)].map((m) => m[1]);
const htmlLabels = labelsBy(/<dt>([^<]+)<\/dt>/g);
const docsLabels = labelsBy(new RegExp(`<b style="color: #68686f;">${LABEL_GROUP}</b>&nbsp; `, 'g'));
const textLabels = labelsBy(new RegExp(`^ {6}${LABEL_GROUP} {2,}\\S`, 'gm'));
const markdownLabels = labelsBy(new RegExp(`^- ${LABEL_GROUP}: `, 'gm'));
const richLabels = labelsBy(new RegExp(`<b>${LABEL_GROUP}</b>: `, 'g'));
const ARTICLE = /<article class="issue"[^>]*data-n="(\d+)"/g;

/**
 * Renders every format with one set of options and checks them against the review model.
 * @param {string} name What this run covers.
 * @param {object} options The export options.
 */
function check(name, options) {
  const opts = { ...options, title: 'Review', generatedAt, group };
  const model = buildReviewModel(issues, opts);
  const config = model.config;
  const expected = EXPECTED.filter((n) => config.statuses.includes(statusOfNumber[n]));
  const expectedLabels = model.comments.map((c) => c.rows.map((row) => row.label));
  same(`${name}: model order`, model.comments.map((c) => c.number), expected);

  const captured = model.comments.map((c) => c.rows.find((row) => row.key === 'captured')?.value ?? '');
  const out = {
    html: buildReport(issues, opts),
    docs: buildDocsHtml(issues, opts),
    text: buildDocsText(issues, opts),
    markdown: buildMarkdown(issues, opts),
  };
  const formats = {
    html: chunks(out.html, ARTICLE),
    docs: chunks(out.docs, /name="comment-(\d+)"/g),
    text: chunks(out.text, /^ {2}(\d+) {2}\S/gm),
    markdown: chunks(out.markdown, /^### (\d+)\. /gm),
  };
  const labelsOf = { html: htmlLabels, docs: docsLabels, text: textLabels, markdown: markdownLabels };
  for (const [format, list] of Object.entries(formats)) {
    same(`${name}: ${format} numbers`, list.map((c) => c.number), expected);
    same(`${name}: ${format} detail labels`, list.map((c) => labelsOf[format](c.body)), expectedLabels);
    list.forEach((c, i) => {
      if (captured[i] && !c.body.includes(captured[i])) same(`${name}: ${format} captured date of ${c.number}`, 'missing', captured[i]);
    });
  }
  const sections = model.sections.map((s) => s.number);
  for (const [format, text] of Object.entries(out)) {
    if (!text.includes(model.date)) same(`${name}: ${format} header date`, 'missing', model.date);
    same(`${name}: ${format} sections`, [...new Set([...text.matchAll(/COMM(\d+)/g)].map((m) => Number(m[1])))], sections);
    same(`${name}: ${format} names the review Jira ticket`, text.includes('SHOP-1'), true);
  }
  formats.html.forEach((c) => same(`${name}: html severity before status in ${c.number}`, /class="sev"[\s\S]*class="status"/.test(c.body), true));
  formats.text.forEach((c, i) =>
    same(`${name}: text severity then status in ${c.number}`, c.body.includes(`${model.comments[i].severity.label} · ${model.comments[i].status.label}`), true),
  );
  formats.markdown.forEach((c, i) =>
    same(`${name}: markdown severity then status in ${c.number}`, c.body.includes(`**${model.comments[i].severity.label}** · ${model.comments[i].status.label}`), true),
  );

  const images = (text) => (text.match(/<img /g) ?? []).length;
  if (config.shots === 'none') {
    same(`${name}: no images in the HTML file`, images(out.html), 0);
    same(`${name}: no images in the Docs export`, images(out.docs), 0);
  } else {
    same(`${name}: images in the HTML file`, images(out.html) > 0, true);
    same(`${name}: images in the Docs export`, images(out.docs) > 0, true);
  }
  same(`${name}: HTML summary`, out.html.includes('class="summary"'), config.summary);
  same(`${name}: Docs summary`, out.docs.includes('>Summary</h2>'), config.summary);
  same(`${name}: Markdown checklist`, out.markdown.includes('## Checklist'), config.summary);
  same(`${name}: Docs layout`, out.docs.includes('>Jira and notes</td>'), config.docLayout === 'table' && config.columns.jira);
  same(`${name}: Docs orientation`, out.docs.includes(`mso-page-orientation: ${config.orientation}`), true);

  const preview = renderBody(issues, { ...opts, preview: true, order: 'severity' });
  const cards = chunks(preview, ARTICLE);
  same(`${name}: preview shows every comment`, cards.map((c) => c.number), EXPECTED);
  same(`${name}: preview card ids`, [...preview.matchAll(/<article class="issue" id="c-(\d+)"/g)].map((m) => Number(m[1])), EXPECTED.map((_, i) => i + 1));
  cards.forEach((c) => {
    for (const hook of ['title', 'note', 'severity', 'status']) same(`${name}: preview ${hook} hook on ${c.number}`, c.body.includes(`data-edit="${hook}"`), true);
    for (const attr of ['data-sev="', 'data-status="']) same(`${name}: preview ${attr} on ${c.number}`, /^<article[^>]*/.exec(c.body)[0].includes(attr), true);
    if (config.shots === 'both') same(`${name}: preview editable images on ${c.number}`, c.body.includes('data-shot="detail"') && c.body.includes('data-shot="shot"'), true);
  });
  const flat = chunks(renderBody(issues, { ...opts, preview: true, order: 'number' }), ARTICLE);
  same(`${name}: preview by number`, flat.map((c) => c.number), [1, 2, 3, 4, 5, 6]);

  model.comments.forEach((comment, i) => {
    const share = { ...options, number: comment.number };
    same(`${name}: single Markdown labels of ${comment.number}`, markdownLabels(commentMarkdown(comment.issue, share)), expectedLabels[i]);
    const rich = commentHtml(comment.issue, share);
    same(`${name}: single rich text labels of ${comment.number}`, richLabels(rich), expectedLabels[i]);
    same(`${name}: single rich text severity then status of ${comment.number}`, rich.indexOf(comment.severity.label) < rich.indexOf(`>${comment.status.label}<`), true);
    if (config.shots === 'none') same(`${name}: single rich text without images of ${comment.number}`, images(rich), 0);
  });
}

check('default', {});
check('old option names', { shots: 'detail', widths: false, fields: { page: false, element: true, position: false } });
check('developer preset', { config: applyPreset('developer') });
check('client preset', { config: applyPreset('client') });
check('custom without images or summary', { config: editExportConfig(applyPreset('full'), { shots: 'none', summary: false, orientation: 'portrait', columns: { status: false } }) });

same('presets have labels', Object.values(EXPORT_PRESETS).every((p) => p.label && p.description), true);
same('editing makes a custom configuration', editExportConfig(applyPreset('client'), { widths: false }).preset, 'custom');
same('unknown statuses are dropped', withExportDefaults({ statuses: ['fixed', 'nope'] }).statuses, ['fixed']);

const developer = buildReviewModel(issues, { config: applyPreset('developer') });
same('filtered comments keep their numbers', developer.comments.map((c) => c.number), [6, 1, 2, 5]);
same('filtered pages keep their COMM numbers', developer.sections.map((s) => s.label), ['COMM1', 'COMM2']);

if (failures) {
  console.error(`\n${failures} check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('All report formats agree on order, detail rows, severity then status, dates and export configurations.');
