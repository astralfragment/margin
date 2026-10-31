/**
 * Opens the report in the tab it already has, so clicking Open report again
 * brings that tab forward instead of piling up new ones.
 */

const REPORT_URL = chrome.runtime.getURL('report.html');

/** The id of an open report tab, or null. */
async function findReportTab() {
  try {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const hit = contexts.find((c) => c.tabId >= 0 && c.documentUrl?.startsWith(REPORT_URL));
    if (hit) return hit.tabId;
  } catch {}
  try {
    const [tab] = await chrome.tabs.query({ url: `${REPORT_URL}*` });
    if (tab?.id != null) return tab.id;
  } catch {}
  return null;
}

/**
 * Shows the report for a query, reusing an open report tab and reloading it so it has the latest comments.
 * @param {string} [query] The query string without the question mark, such as group=abc.
 */
export async function openReportTab(query = '') {
  const url = query ? `${REPORT_URL}?${query}` : REPORT_URL;
  const tabId = await findReportTab();
  if (tabId == null) {
    await chrome.tabs.create({ url });
    return;
  }
  try {
    const tab = await chrome.tabs.update(tabId, { url, active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    await chrome.tabs.create({ url });
  }
}
