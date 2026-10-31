/**
 * Checks that every report format lists the same comments in the same order, with the same detail rows,
 * the same severity then status order and the same dates. Run with: node extension/tests/consistency.test.mjs
 */
import { buildReport, renderBody } from '../lib/report-template.js';
import { buildDocsHtml, buildDocsText } from '../lib/docs-template.js';
import { buildMarkdown, commentHtml, commentMarkdown } from '../lib/share-template.js';
import { buildReviewModel } from '../lib/review-model.js';

const LABELS = ['Page', 'Figma', 'Links', 'Jira', 'Selector', 'Element', 'Text', 'Styles', 'Position', 'Browser', 'Captured'];
const LABEL_LINE = new RegExp(`^(?:    |- )(${LABELS.join('|')}): `);

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
  base(6, 'a', 'major', 'open', { links: ['https://www.figma.com/design/abc/File?node-id=1-2'], env: { browser: 'Firefox 140', os: 'Windows', zoom: 110 } }),
];
const generatedAt = new Date(Date.UTC(2026, 9, 31, 15));
const EXPECTED = [3, 6, 1, 2, 5, 4];

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

const htmlLabels = (body) => [...body.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);
const docsLabels = (body) => [...body.matchAll(/<td style="padding: 1px 10px 1px 0;[^"]*">([^<]+)<\/td>/g)].map((m) => m[1]);
const lineLabels = (body) => body.split('\n').map((line) => line.match(LABEL_LINE)?.[1]).filter(Boolean);
const htmlSeverityThenStatus = (body) => /class="chip"[\s\S]*class="status"/.test(body);

/**
 * Renders every format with one set of options and checks them against the review model.
 * @param {string} name What this run covers.
 * @param {object} options The export options.
 */
function check(name, options) {
  const model = buildReviewModel(issues, { ...options, generatedAt });
  const expectedLabels = model.comments.map((c) => c.rows.map((row) => row.label));
  same(`${name}: model order`, model.comments.map((c) => c.number), EXPECTED);

  const captured = model.comments.map((c) => c.rows.find((row) => row.key === 'captured')?.value ?? '');
  const opts = { ...options, title: 'Review', generatedAt };
  const formats = {
    html: chunks(buildReport(issues, opts), /<article class="issue"[^>]*>\s*<header>\s*<span class="num">(\d+)<\/span>/g),
    preview: chunks(renderBody(issues, { ...opts, preview: true, order: 'severity' }), /<article class="issue"[^>]*>\s*<header>\s*<span class="num">(\d+)<\/span>/g),
    docs: chunks(buildDocsHtml(issues, opts), /<span style="color: #5b5670;">(\d+)<\/span>&nbsp;&nbsp;/g),
    text: chunks(buildDocsText(issues, opts), /^(\d+) {2}\[/gm),
    markdown: chunks(buildMarkdown(issues, opts), /^### (\d+)\. /gm),
  };
  const labelsOf = { html: htmlLabels, preview: htmlLabels, docs: docsLabels, text: lineLabels, markdown: lineLabels };
  for (const [format, list] of Object.entries(formats)) {
    same(`${name}: ${format} numbers`, list.map((c) => c.number), EXPECTED);
    same(`${name}: ${format} detail labels`, list.map((c) => labelsOf[format](c.body)), expectedLabels);
    list.forEach((c, i) => {
      if (captured[i] && !c.body.includes(captured[i])) same(`${name}: ${format} captured date of ${c.number}`, 'missing', captured[i]);
    });
  }
  const whole = { html: buildReport(issues, opts), docs: buildDocsHtml(issues, opts), text: buildDocsText(issues, opts), markdown: buildMarkdown(issues, opts) };
  for (const [format, out] of Object.entries(whole)) {
    if (!out.includes(model.date)) same(`${name}: ${format} header date`, 'missing', model.date);
    const sections = [...out.matchAll(/COMM(\d+)/g)].map((m) => Number(m[1]));
    same(`${name}: ${format} first section mentions`, [...new Set(sections)], [1, 2, 3]);
  }
  formats.html.forEach((c) => same(`${name}: html severity before status in ${c.number}`, htmlSeverityThenStatus(c.body), true));
  formats.text.forEach((c, i) => same(`${name}: text severity then status in ${c.number}`, c.body.includes(`[${model.comments[i].severity.label}, ${model.comments[i].status.label}]`), true));
  formats.markdown.forEach((c, i) => same(`${name}: markdown severity then status in ${c.number}`, c.body.includes(`**${model.comments[i].severity.label}**, ${model.comments[i].status.label}`), true));

  model.comments.forEach((comment, i) => {
    const share = { ...options, number: comment.number };
    same(`${name}: single Markdown labels of ${comment.number}`, lineLabels(commentMarkdown(comment.issue, share)), expectedLabels[i]);
    const rich = commentHtml(comment.issue, share);
    const richLabels = rich.match(/<p>((?:[A-Za-z ]+: .*?(?:<br \/>|<\/p>))+)/)?.[1].split('<br />').map((line) => line.split(':')[0]) ?? [];
    same(`${name}: single rich text labels of ${comment.number}`, richLabels, expectedLabels[i]);
    same(`${name}: single rich text severity then status of ${comment.number}`, rich.includes(`${comment.severity.label}, ${comment.status.label}`), true);
  });
}

check('default fields', {});
check('custom fields', { fields: { page: false, element: true, position: false } });

const byNumber = buildReviewModel(issues, { order: 'number' });
same('number order lists every comment by number', byNumber.comments.map((c) => c.number), [1, 2, 3, 4, 5, 6]);

if (failures) {
  console.error(`\n${failures} check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('All report formats agree on order, detail rows, severity then status, and dates.');
