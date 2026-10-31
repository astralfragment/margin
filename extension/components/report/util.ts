import { hostOf, pad, plural } from '@/lib/format.js';
export { hostOf, pad, plural };

/**
 * Messages the background service worker, which owns storage writes and image work.
 * Each message has its own reply shape, so the reply is untyped and callers read the fields they asked for.
 */
export const send = (type: string, payload: object = {}): Promise<any> => chrome.runtime.sendMessage({ type, ...payload });

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

/**
 * A date and time for a file name.
 * @param date The date.
 */
export function stamp(date: Date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Downloads a file.
 * @param blob The contents.
 * @param filename The file name.
 */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Puts plain text, and rich text when given, on the clipboard. */
export async function copyText(plain: string, html?: string) {
  const flavours: Record<string, Blob> = { 'text/plain': new Blob([plain], { type: 'text/plain' }) };
  if (html) flavours['text/html'] = new Blob([html], { type: 'text/html' });
  await navigator.clipboard.write([new ClipboardItem(flavours)]);
}

/** A per viewer preference, or null when storage is blocked. */
export function readPref(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Saves a report preference in this browser.
 * @param key The preference.
 * @param value Its value.
 */
export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage only loses the remembered choice.
  }
}

/**
 * Reads a links field. Bare addresses such as figma.com/design/... get https:// in front.
 * @returns The links to keep and the parts that are not links.
 */
export function parseLinks(value: string) {
  const links: string[] = [];
  const bad: string[] = [];
  for (const part of value.split(/[\s,]+/).filter(Boolean)) {
    if (/^https?:\/\/\S+\.\S+/i.test(part)) links.push(part);
    else if (/^([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(part)) links.push(`https://${part}`);
    else bad.push(part);
  }
  return { links, bad };
}

/**
 * Opens an address in a new tab.
 * @param url The address.
 */
export const openTab = (url: string) => chrome.tabs.create({ url });

/** Text colour of a Jira status by its category: To do muted, In progress plain, Done green. */
export const JIRA_TONE: Record<string, string> = { todo: 'text-muted-foreground', progress: 'text-foreground', done: 'text-success' };
