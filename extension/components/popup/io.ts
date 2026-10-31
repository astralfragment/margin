import { browser } from 'wxt/browser';
import { readGroups, readIssues } from '@/lib/store.js';
import { connection } from '@/lib/oauth.js';
import { openReportTab } from '@/lib/report-tab.js';
import type { Group, Issue, LinkKind, TabInfo } from './model';

export type PopupData = {
  groups: Group[];
  issues: Issue[];
  activeId: string | null;
  connected: Record<LinkKind, boolean>;
};

export type RunState = { state: 'running' | 'done' | 'cancelled'; groupId: string; done: number; total: number; checked: string[]; at: number };

/**
 * Sends a message to the background.
 * @param type The message type.
 * @param payload Extra fields.
 */
export const send = (type: string, payload: object = {}) =>
  browser.runtime.sendMessage({ type, ...payload }) as Promise<{ error?: string } | undefined>;

/** Which of Jira and Figma are connected. */
export async function connectedServices(): Promise<Record<LinkKind, boolean>> {
  const [jira, figma] = await Promise.all([connection('jira'), connection('figma')]);
  return { jira: Boolean(jira?.sites?.length), figma: Boolean(figma) };
}

/** Reads the reviews, comments and connections without creating a review, so a site with none can say so. */
export async function loadData(): Promise<PopupData> {
  const [groups, issues, bag, connected] = await Promise.all([
    readGroups() as Promise<Group[]>,
    readIssues() as Promise<Issue[]>,
    browser.storage.local.get('activeGroupId'),
    connectedServices(),
  ]);
  return { groups, issues, activeId: (bag.activeGroupId as string | undefined) ?? null, connected };
}

/** The address, title and id of the active tab. */
export async function activeTab(): Promise<TabInfo> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id, url: tab?.url ?? '', title: tab?.title ?? '', width: tab?.width };
}

/**
 * Asks the page whether annotation is on, through the content script's ping. A content script that does not
 * report its state yet is read directly, and a page without Margin on it is off.
 */
export async function annotatingNow(tabId?: number) {
  if (!tabId) return false;
  try {
    const res = (await browser.tabs.sendMessage(tabId, { type: 'ping' })) as { active?: boolean } | undefined;
    if (typeof res?.active === 'boolean') return res.active;
  } catch {
    return false;
  }
  try {
    const [first] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => (window as { __uiAnnotator?: { isActive?: () => boolean } }).__uiAnnotator?.isActive?.() ?? false,
    });
    return first?.result === true;
  } catch {
    return false;
  }
}

/**
 * Opens the report, or focuses it if it is open.
 * @param query The query string to open it with.
 */
export function openReport(query: string) {
  openReportTab(query).finally(() => window.close());
}

/** Opens Help and settings, at a service's Connect button when one is named. */
export function openSettings(kind?: LinkKind) {
  if (kind) browser.tabs.create({ url: browser.runtime.getURL(`/options.html#connect-${kind}`) });
  else browser.runtime.openOptionsPage();
  window.close();
}

/**
 * Opens an address in a new tab.
 * @param url The address.
 */
export function openUrl(url: string) {
  browser.tabs.create({ url });
}

/** Turns Chrome's error from a failed start into plain words. */
export function startError(error: string) {
  if (/cannot be scripted|cannot access|not allow|chrome:\/\/|gallery/i.test(error)) {
    return { title: 'Margin cannot run on this page', text: 'This page does not allow extensions. Open the page you want to review in a normal tab, then click Margin again.' };
  }
  return { title: 'Margin could not start on this page', text: 'Reload the page, then click Margin again.' };
}
