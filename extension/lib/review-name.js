/**
 * Default names for new reviews. A review is named after the site it starts on, so the picker reads like a list
 * of projects. A second review on the same site gets the day as well.
 */
import { appOf } from './review-model.js';

const NAME_MAX = 60;

/**
 * The site's name: the site part of the tab title when the title has one, such as "Acme" in "Pricing | Acme",
 * else the host without www.
 * @param {{ url?: string, title?: string }} [page] The page.
 */
export function siteName(page = {}) {
  const title = page.title?.trim() ?? '';
  const fromTitle = /\s[|-]\s|:\s/.test(title) ? appOf(title) : '';
  let host = '';
  try {
    const url = new URL(page.url ?? '');
    if (url.protocol === 'http:' || url.protocol === 'https:') host = url.hostname.replace(/^www\./, '');
  } catch {}
  return (fromTitle || host).slice(0, NAME_MAX).trim();
}

/**
 * A name for a new review on a page, unique among the names given. Falls back to Review and the day.
 * @param {{ url?: string, title?: string }} [page] The page the review starts on.
 * @param {string[]} [taken] Names already in use.
 * @param {Date} [now] Today, for tests.
 */
export function reviewName(page, taken = [], now = new Date()) {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  const base = siteName(page);
  if (base && !used.has(base.toLowerCase())) return base;
  const dated = `${base || 'Review'} ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(now)}`;
  let name = dated;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${dated} (${n})`;
  return name;
}
