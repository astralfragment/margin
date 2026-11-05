import { describe, expect, it } from 'vitest';
import { buildAgentBrief } from '../report/agent-brief';
import type { Comment } from '../lib/model';

/**
 * One comment, varied by the fields given.
 * @param patch Fields that differ from the base comment.
 */
function comment(patch: Partial<Comment>): Comment {
  return {
    id: 'c1',
    groupId: 'r1',
    createdAt: '2026-11-05T10:00:00.000Z',
    severity: 'major',
    status: 'open',
    title: 'Pay button is the wrong blue',
    note: 'Expected brand blue.',
    page: { url: 'https://shop.example.com/cart', title: 'Cart' },
    viewport: { width: 1280, height: 800, scrollY: 120, dpr: 1 },
    env: { browser: 'Google Chrome 156', os: 'Windows', zoom: 100 },
    element: { selector: '#pay', tag: 'button', classes: 'btn', text: 'Pay now' },
    anchor: null,
    rect: { x: 40, y: 300, w: 120, h: 44 },
    marks: [
      { kind: 'dot', x: 50.4, y: 310, note: 'Wrong shade here' },
      { kind: 'arrow', x: 10, y: 10, x2: 40, y2: 300, note: '' },
    ],
    ...patch,
  };
}

describe('buildAgentBrief', () => {
  it('puts open comments first and keeps the numbers the report shows', () => {
    const brief = buildAgentBrief({ name: 'Checkout' }, [comment({ id: 'a', status: 'fixed', title: 'Done already' }), comment({ id: 'b' })]);
    expect(brief.indexOf('## 02. Pay button')).toBeLessThan(brief.indexOf('## 01. Done already'));
    expect(brief).toContain('1 open of 2 comments');
  });

  it('spells out the element, region and markers an agent needs to find the spot', () => {
    const brief = buildAgentBrief(null, [comment({})]);
    expect(brief).toContain('- Element: `#pay` (button, text "Pay now")');
    expect(brief).toContain('- Region: 40,300 size 120x44 in a 1280x800 viewport, scrolled 120px');
    expect(brief).toContain('1. point at 50,310. Wrong shade here');
    expect(brief).toContain('2. arrow from 10,10 to 40,300');
  });
});
