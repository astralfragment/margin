import { routeOf } from '@/lib/review-model.js';

export type Link = {
  key?: string;
  url?: string;
  summary?: string;
  status?: string;
  statusCategory?: string;
  assignee?: string;
  description?: string;
  fileKey?: string;
  name?: string;
  frames?: { id: string; name: string; page: string }[];
  fetchedAt?: string;
};

export type Group = {
  id: string;
  name: string;
  site?: string;
  pickedOn?: string[];
  jira?: Link;
  figma?: Link;
};

export type Issue = {
  id: string;
  groupId: string;
  title?: string;
  severity?: string;
  status?: string;
  page?: { url: string; title?: string };
  viewport?: { width?: number };
  jira?: { key?: string };
  checkedAt?: string;
  change?: number;
};

export type TabInfo = { id?: number; url: string; title: string; width?: number };

export type LinkKind = 'jira' | 'figma';

/** Pages extensions may not run on. */
const RESTRICTED = /^(chrome|edge|about|devtools|chrome-extension|view-source|data):|^https:\/\/chrome\.google\.com\/webstore|^https:\/\/chromewebstore\.google\.com/;

/** A share of changed pixels below this reads as the same as the capture. */
const CHANGED_SHARE = 0.003;

export const isRestricted = (url: string) => !url || RESTRICTED.test(url);

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const pad = (n: number) => String(n).padStart(2, '0');

export function hostOf(url?: string) {
  try {
    return new URL(url ?? '').host;
  } catch {
    return '';
  }
}

/** True when two URLs are the same page, ignoring the query and hash. */
export function samePage(a?: string, b?: string) {
  try {
    const x = new URL(a ?? '');
    const y = new URL(b ?? '');
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return false;
  }
}

/** The short name of a page, such as Home or Pricing. */
export const pageName = (page?: { url: string; title?: string }) => (routeOf(page ?? { url: '' }) as string).split(' > ').at(-1) ?? '';

/** Where a comment stands against its recheck. */
export function recheckState(issue: Issue) {
  if (!issue.checkedAt) return 'Not rechecked';
  if (typeof issue.change !== 'number') return 'Rechecked';
  return issue.change < CHANGED_SHARE ? 'Same as capture' : 'Changed since capture';
}

/** True when a review was started on this site, was picked here, has comments here, or is empty and not tied to a site yet. */
export function belongsHere(group: Group, issues: Issue[], host: string) {
  const own = issues.filter((issue) => issue.groupId === group.id);
  if (!group.site && !own.length) return true;
  return group.site === host || Boolean(group.pickedOn?.includes(host)) || own.some((issue) => hostOf(issue.page?.url) === host);
}

export type PageView = ReturnType<typeof pageView>;

/**
 * The comments on the open page, the width the list shows, and the rest of the review folded away.
 * With comments at more than one width the list shows one width, the window's own unless another was picked.
 */
export function pageView(all: Issue[], tab: TabInfo, picked: number | null) {
  const onPage = all.filter((issue) => samePage(tab.url, issue.page?.url));
  const widths = [...new Set(onPage.map((issue) => issue.viewport?.width).filter((w): w is number => Boolean(w)))];
  const near = (w: number) => Math.abs(w - (tab.width ?? w));
  const windowWidth = widths.slice().sort((a, b) => near(a) - near(b))[0];
  const width = picked !== null && widths.includes(picked) ? picked : windowWidth;
  const multi = widths.length > 1;
  const shown = onPage.filter((issue) => !multi || !issue.viewport?.width || issue.viewport.width === width);
  const otherWidths = new Map<number, number>();
  for (const issue of onPage) {
    const w = issue.viewport?.width;
    if (!shown.includes(issue) && w) otherWidths.set(w, (otherWidths.get(w) ?? 0) + 1);
  }
  const elsewhere = all.filter((issue) => !samePage(tab.url, issue.page?.url));
  return { onPage, shown, width, windowWidth, multi, otherWidths, elsewhere };
}

/** Pages named in words: "Pricing" for one, "3 other pages" for more. */
export function pagesLabel(issues: Issue[], other = false) {
  const pages = [...new Set(issues.map((issue) => pageName(issue.page)))];
  return pages.length === 1 ? pages[0]! : `${pages.length} ${other ? 'other ' : ''}pages`;
}
