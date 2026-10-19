import { writeFileSync } from 'node:fs';
import { png } from './png.mjs';
import { buildReport } from '../extension/lib/report-template.js';
import { buildDocsHtml } from '../extension/lib/docs-template.js';

const [out, docsOut] = process.argv.slice(2);
if (!out) {
  console.error('usage: node tools/sample-report.mjs <output.html> [docs-output.html]');
  process.exit(1);
}

const WHITE = [255, 255, 255, 255];
const ACCENT = [255, 47, 109, 255];

/** Paints a crude page mock so the report layout can be reviewed with real images. */
function mock(width, height, box, blocks) {
  const shapes = [
    { x: 0, y: 0, w: width, h: 52, fill: [18, 21, 28, 255] },
    ...blocks,
  ];
  const buf = png(width, height, (x, y) => {
    const onBox =
      x >= box.x - 2 && x < box.x + box.w + 2 && y >= box.y - 2 && y < box.y + box.h + 2 &&
      !(x >= box.x + 2 && x < box.x + box.w - 2 && y >= box.y + 2 && y < box.y + box.h - 2);
    if (onBox) return ACCENT;
    for (let i = shapes.length - 1; i >= 0; i -= 1) {
      const s = shapes[i];
      if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return s.fill;
    }
    return WHITE;
  });
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const grey = (v) => [v, v, v, 255];
const cards = [
  { x: 40, y: 88, w: 300, h: 120, fill: grey(240) },
  { x: 364, y: 88, w: 300, h: 120, fill: grey(240) },
  { x: 40, y: 232, w: 624, h: 40, fill: grey(246) },
  { x: 40, y: 292, w: 180, h: 36, fill: [255, 47, 109, 255] },
];

const shot = mock(720, 380, { x: 40, y: 292, w: 180, h: 36 }, cards);
const detail = mock(700, 300, { x: 120, y: 120, w: 360, h: 72 }, [
  { x: 60, y: 60, w: 560, h: 28, fill: grey(244) },
  { x: 120, y: 120, w: 360, h: 72, fill: [255, 47, 109, 255] },
]);

const secondPage = { url: 'https://app.example.com/courses/68206/appeals', title: 'Courses > Appeals' };

const base = {
  page: { url: 'https://app.example.com/settings/billing', title: 'Settings > Billing' },
  viewport: { width: 1440, height: 900, scrollY: 320, dpr: 2 },
  shot,
  detail,
};

const issues = [
  {
    ...base,
    id: '1',
    createdAt: '2026-09-04T09:12:00.000Z',
    jira: {
      key: 'WBS-482',
      url: 'https://example.atlassian.net/browse/WBS-482',
      status: 'In Progress',
      statusCategory: 'indeterminate',
    },
    severity: 'blocker',
    title: 'Primary action is cut off below 1280px',
    note: 'Expected: Save button stays inside the card.\nActual: it overflows and the click target sits under the sticky footer.',
    element: {
      selector: 'main > section.billing > div.actions > button.primary',
      tag: 'button',
      id: '',
      classes: 'btn primary',
      text: 'Save changes',
      styles: { color: 'rgb(255, 255, 255)', background: 'rgb(255, 47, 109)', font: '600 14px/20px Inter' },
    },
    rect: { x: 40, y: 292, w: 180, h: 36 },
  },
  {
    ...base,
    id: '2',
    createdAt: '2026-09-04T09:14:00.000Z',
    severity: 'major',
    title: 'Card headings use three different sizes',
    note: 'Headings render at 15px, 16px and 18px on the same row. Pick one step from the scale.',
    element: {
      selector: 'section.cards > article:nth-of-type(2) > h3',
      tag: 'h3',
      id: '',
      classes: 'card-title',
      text: 'Payment method',
      styles: { color: 'rgb(18, 21, 28)', background: 'rgba(0, 0, 0, 0)', font: '650 18px/24px Inter' },
    },
    rect: { x: 364, y: 88, w: 300, h: 32 },
  },
  {
    ...base,
    page: secondPage,
    id: '3',
    createdAt: '2026-09-04T09:18:00.000Z',
    jira: {
      key: 'WBS-484',
      url: 'https://example.atlassian.net/browse/WBS-484',
      status: 'Done',
      statusCategory: 'done',
    },
    severity: 'minor',
    title: 'Invoice amounts are left aligned',
    note: 'Numbers in a column need right alignment and tabular figures.',
    element: {
      selector: 'table.invoices > tbody > tr:nth-of-type(3) > td:nth-of-type(4)',
      tag: 'td',
      id: '',
      classes: 'amount',
      text: 'R 1 240.00',
      styles: { color: 'rgb(86, 93, 115)', background: 'rgba(0, 0, 0, 0)', font: '400 14px/20px Inter' },
    },
    rect: { x: 40, y: 232, w: 624, h: 40 },
  },
  {
    ...base,
    page: secondPage,
    id: '4',
    createdAt: '2026-09-04T09:21:00.000Z',
    severity: 'nit',
    title: 'Trailing full stop in the empty state',
    note: '',
    element: {
      selector: '#billing-empty > p',
      tag: 'p',
      id: '',
      classes: 'empty-copy',
      text: 'No invoices yet.',
      styles: { color: 'rgb(86, 93, 115)', background: 'rgba(0, 0, 0, 0)', font: '400 13px/18px Inter' },
    },
    rect: { x: 40, y: 88, w: 300, h: 24 },
  },
];

const options = {
  title: 'UI issue report, app.example.com',
  generatedAt: new Date('2026-09-04T09:30:00'),
};

writeFileSync(out, buildReport(issues, options));
console.log(out);

const session = {
  id: 's1',
  name: 'Sprint 42 UI review',
  createdAt: '2026-09-04T09:00:00.000Z',
  jira: {
    key: 'WBS-480',
    url: 'https://example.atlassian.net/browse/WBS-480',
    status: 'In Progress',
    statusCategory: 'indeterminate',
  },
};

if (docsOut) {
  writeFileSync(docsOut, buildDocsHtml(issues, { ...options, title: session.name, session }));
  console.log(docsOut);
}
