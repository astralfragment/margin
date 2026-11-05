import { describe, expect, it } from 'vitest';
import { buildDocsHtml, buildDocsText, buildMarkdown, buildReport, commentHtml, commentMarkdown, withDefaults } from '../report/shared';
import type { CommentWithImages, Review } from '../lib/model';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const generatedAt = new Date(Date.UTC(2026, 9, 31, 9, 30));

const review: Review = {
  id: 'review-1',
  name: 'Checkout review',
  createdAt: '2026-10-31T08:00:00.000Z',
  jira: { key: 'SS-112', url: 'https://team.atlassian.net/browse/SS-112', status: 'In Progress' },
  figma: { fileKey: 'abc123', url: 'https://www.figma.com/design/abc123/Checkout', name: 'Checkout' },
};

/**
 * One stored comment with images, varied by the fields given.
 * @param patch Fields that differ from the base comment.
 */
function comment(patch: Partial<CommentWithImages>): CommentWithImages {
  return {
    id: 'c1',
    groupId: review.id,
    createdAt: '2026-10-31T08:10:00.000Z',
    severity: 'major',
    status: 'open',
    title: 'Pay button is the wrong blue',
    note: 'Expected brand blue.\nActual is a lighter tint.',
    page: { url: 'https://shop.example.com/cart/12345', title: 'Cart | Shop' },
    viewport: { width: 1280, height: 800, scrollY: 0, dpr: 1 },
    env: { browser: 'Google Chrome 141', os: 'Windows', zoom: 100 },
    element: { selector: '#pay', tag: 'button', classes: 'btn primary', text: 'Pay now', styles: { color: 'rgb(59, 130, 246)', font: '16px Inter' } },
    anchor: null,
    rect: { x: 40, y: 300, w: 120, h: 44 },
    marks: [
      { kind: 'dot', x: 50, y: 310, note: 'Wrong shade here' },
      { kind: 'box', x: 40, y: 300, w: 120, h: 44, note: '' },
    ],
    links: ['https://www.figma.com/design/abc123/Checkout?node-id=1-2'],
    shot: PIXEL,
    detail: PIXEL,
    ...patch,
  };
}

const first = comment({});
const second = comment({
    id: 'c2',
    createdAt: '2026-10-31T08:20:00.000Z',
    severity: 'blocker',
    status: 'fixed',
    title: 'Card padding collapses on mobile',
    note: '',
    marks: [],
    links: [],
    jira: { key: 'SS-113', url: 'https://team.atlassian.net/browse/SS-113' },
    after: PIXEL,
    checkedAt: '2026-10-31T09:00:00.000Z',
    change: 0.2,
    shots: { mobile: { src: PIXEL, width: 375, placed: 'found' }, desktop: { src: PIXEL, width: 1280, placed: 'lost' } },
    shotsAt: '2026-10-31T09:00:00.000Z',
});
const comments = [first, second];

const fields = withDefaults({});

describe('export templates', () => {
  it('builds the same HTML report', () => {
    expect(buildReport(comments, { title: review.name, generatedAt, shots: 'both', fields, widths: true })).toMatchSnapshot();
  });

  it('builds the same Docs and Word document', () => {
    expect(buildDocsHtml(comments, { title: review.name, generatedAt, group: review, shots: 'both', fields, widths: true })).toMatchSnapshot();
  });

  it('builds the same Docs plain text', () => {
    expect(buildDocsText(comments, { title: review.name, widths: true })).toMatchSnapshot();
  });

  it('builds the same Markdown', () => {
    expect(buildMarkdown(comments, { title: review.name, fields, widths: true })).toMatchSnapshot();
  });

  it('builds the same single comment copies', () => {
    expect(commentMarkdown(first, { fields, widths: true })).toMatchSnapshot();
    expect(commentHtml(second, fields, true)).toMatchSnapshot();
  });
});
