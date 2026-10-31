import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

/**
 * Loads a fresh copy of the store module the older screens use, as one open page holds its own copy.
 */
async function openPage() {
  vi.resetModules();
  return import('../lib/store.js');
}

/**
 * Starts the service worker's side: the single writer that answers the store writes pages send.
 */
async function startWorker() {
  vi.resetModules();
  const { serveStoreWrites } = await import('../lib/store-server');
  serveStoreWrites();
  return import('../lib/review-store');
}

describe('two pages saving at the same time', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('keeps both changes to one review and both new reviews', async () => {
    const worker = await startWorker();
    const popup = await openPage();
    const report = await openPage();
    const review = await popup.addGroup('Checkout');

    await Promise.all([
      popup.patchGroup(review.id, { name: 'Checkout flow' }),
      report.patchGroup(review.id, { site: 'shop.example' }),
      popup.addGroup('From the popup'),
      report.addGroup('From the report'),
    ]);

    const reviews = await worker.readReviews();
    expect(reviews.find((entry) => entry.id === review.id)).toMatchObject({ name: 'Checkout flow', site: 'shop.example' });
    expect(reviews.map((entry) => entry.name).toSorted()).toEqual(['Checkout flow', 'From the popup', 'From the report']);
  });

  it('keeps a comment the worker adds while a page deletes another and writes images for a third', async () => {
    const worker = await startWorker();
    const popup = await openPage();
    const report = await openPage();
    const review = await worker.addReview('Comments');
    const comment = (id: string) => ({
      id,
      groupId: review.id,
      createdAt: new Date().toISOString(),
      severity: 'major' as const,
      status: 'open' as const,
      title: id,
      note: '',
      page: { url: 'https://shop.example/cart', title: 'Cart' },
      viewport: { width: 1280, height: 800, scrollY: 0, dpr: 1 },
      element: null,
      anchor: null,
      rect: { x: 10, y: 10, w: 100, h: 40 },
    });
    await worker.saveComments([comment('kept'), comment('deleted')]);

    await Promise.all([
      worker.addComment(comment('added')),
      popup.removeIssue('deleted'),
      report.writeImages('kept', { after: 'data:image/jpeg;base64,AAAA' }),
      worker.patchComment('kept', { title: 'Kept and renamed' }),
    ]);

    const comments = await worker.readComments();
    expect(comments.map((entry) => entry.id).toSorted()).toEqual(['added', 'kept']);
    expect(comments.find((entry) => entry.id === 'kept')?.title).toBe('Kept and renamed');
    expect(await worker.readImages('kept')).toEqual({ after: 'data:image/jpeg;base64,AAAA' });
  });
});
