/**
 * The controls reference reads the start shortcut with chrome.commands and opens Chrome's shortcut page with
 * chrome.tabs, neither of which a content script has. These stand-ins ask the background to do both, so the shared
 * component works unchanged inside the overlay.
 */
export function bridgeChrome() {
  const api = chrome as unknown as Record<string, unknown>;
  api.commands ??= { getAll: () => chrome.runtime.sendMessage({ type: 'commands' }) };
  api.tabs ??= { create: () => chrome.runtime.sendMessage({ type: 'openShortcuts' }) };
}
