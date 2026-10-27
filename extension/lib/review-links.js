/**
 * A review's linked Jira ticket and Figma file: reading what was pasted, looking the link up when the
 * service is connected, and refreshing the stored details. Nothing here writes to Jira or Figma.
 */
import { connection, authedFetch } from './oauth.js';
import { parseFigmaLink } from './figma.js';

export const JIRA_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
export const MAX_FRAMES = 300;
const MAX_DESCRIPTION = 4000;
const SITE_KEY = 'jiraSite';
const RECENT_FIGMA_KEY = 'figmaRecent';
const RECENT_LIMIT = 8;
const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION']);
const STALE_AFTER = 5 * 60_000;

/**
 * Adds https:// to a link pasted without it, such as smartspaces.atlassian.net/browse/SS-112.
 * @param {string} text What was pasted, already trimmed.
 */
function withProtocol(text) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(text) ? `https://${text}` : text;
}

/**
 * Reads a Jira key out of a bare key, an issue link, or text that holds a key, such as "[SS-112] Homepage rebuild QA".
 * @param {string} text What was typed or pasted.
 * @returns {{ key: string, site: string | null } | null} The key, and the site origin when a link named one.
 */
export function parseJiraInput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (JIRA_KEY.test(raw.toUpperCase())) return { key: raw.toUpperCase(), site: null };
  let url;
  try {
    url = new URL(withProtocol(raw));
  } catch {
    const key = raw.match(/(?:^|[^A-Za-z0-9_-])([A-Z][A-Z0-9_]*-\d+)(?![\w-])/)?.[1];
    return key ? { key, site: null } : null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const inPath = url.pathname.match(/\/(?:browse|issues)\/([A-Za-z][A-Za-z0-9_]*-\d+)/)?.[1];
  const key = (inPath ?? url.searchParams.get('selectedIssue') ?? '').toUpperCase();
  return JIRA_KEY.test(key) ? { key, site: url.origin } : null;
}

/**
 * Reads a Figma file out of a pasted link, with a readable name taken from the link's slug.
 * @param {string} text What was typed or pasted.
 * @returns {{ fileKey: string, url: string, name: string } | null} The file, or null when it is not a Figma file link.
 */
export function parseFigmaInput(text) {
  const parsed = parseFigmaLink(withProtocol(String(text ?? '').trim()));
  if (!parsed) return null;
  const url = new URL(parsed.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const slug = parts.length > 2 && parts.at(-2) !== 'branch' ? parts.at(-1) : '';
  let name = '';
  try {
    name = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
  } catch {
    name = '';
  }
  return { fileKey: parsed.fileKey, url: `${url.origin}${url.pathname}`, name };
}

/**
 * The plain text of one inline Jira document node.
 * @param {any} node An inline node or a block holding inline nodes.
 */
function inlineText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (['mention', 'emoji', 'date', 'status'].includes(node.type)) return node.attrs?.text ?? '';
  if (node.type === 'inlineCard') return node.attrs?.url ?? '';
  return (node.content ?? []).map(inlineText).join('');
}

/**
 * The text blocks of a Jira document, with list items marked.
 * @param {any} node A block node.
 * @param {string} [prefix] Put before the first block, for list items.
 */
function blocksOf(node, prefix = '') {
  if (!node || typeof node !== 'object') return [];
  if (['paragraph', 'heading', 'codeBlock'].includes(node.type)) return [prefix + inlineText(node)];
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content ?? []).flatMap((item, i) => blocksOf(item, node.type === 'orderedList' ? `${i + 1}. ` : '- '));
  }
  if (node.type === 'listItem') return (node.content ?? []).flatMap((child, i) => blocksOf(child, i ? '' : prefix));
  return (node.content ?? []).flatMap((child) => blocksOf(child));
}

/**
 * Turns a Jira description, in Atlassian document format or plain text, into plain text.
 * @param {unknown} doc The description field.
 */
export function adfText(doc) {
  const text = typeof doc === 'string' ? doc : blocksOf(doc).map((block) => block.trim()).filter(Boolean).join('\n\n');
  return text.slice(0, MAX_DESCRIPTION);
}

/**
 * The Jira REST address of one issue on a site, through Atlassian's API gateway.
 * @param {string} cloudId The site's cloud id.
 * @param {string} key The issue key.
 */
const issueApi = (cloudId, key) =>
  `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,assignee,description`;

/**
 * Keeps the fields a review shows from a Jira issue.
 * @param {any} data The issue Jira returned.
 * @param {{ url: string }} site The site it came from.
 */
function shapeIssue(data, site) {
  const fields = data.fields ?? {};
  return {
    key: data.key,
    url: `${site.url}/browse/${data.key}`,
    summary: fields.summary ?? '',
    status: fields.status?.name ?? '',
    statusCategory: fields.status?.statusCategory?.key ?? '',
    assignee: fields.assignee?.displayName ?? '',
    description: adfText(fields.description),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * True when two addresses share an origin.
 * @param {string} a One address.
 * @param {string} b The other.
 */
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Looks up a pasted Jira key or link. Without a Jira connection it keeps what the text gives,
 * with a link built from the site in the text or the site used last for Send to Jira.
 * @param {string} text What was typed or pasted.
 * A link to a site that is not connected comes back as otherSite. The site in a pasted link is remembered for bare keys.
 * @returns {Promise<{ state: 'ok' | 'notConnected' | 'notFound' | 'noAccess' | 'otherSite' | 'invalid' | 'error', jira?: object, site?: string, message?: string }>} The outcome.
 */
export async function lookUpJira(text) {
  const parsed = parseJiraInput(text);
  if (!parsed) return { state: 'invalid' };
  const current = await connection('jira');
  if (parsed.site) await chrome.storage.local.set({ [SITE_KEY]: parsed.site });
  const stored = (await chrome.storage.local.get(SITE_KEY))[SITE_KEY];
  const site = parsed.site ?? current?.sites?.[0]?.url ?? stored ?? null;
  const plain = { key: parsed.key, url: site ? `${site}/browse/${parsed.key}` : '' };
  if (!current?.sites?.length) return { state: 'notConnected', jira: plain };
  const sites = parsed.site ? current.sites.filter((s) => sameOrigin(s.url, parsed.site)) : current.sites;
  if (!sites.length) return { state: 'otherSite', jira: plain, site: new URL(parsed.site).host };
  let denied = false;
  for (const candidate of sites) {
    let res;
    try {
      res = await authedFetch('jira', issueApi(candidate.id, parsed.key));
    } catch (err) {
      return { state: 'error', jira: plain, message: err.message };
    }
    if (res.ok) return { state: 'ok', jira: shapeIssue(await res.json(), candidate) };
    if (res.status === 401 || res.status === 403) denied = true;
    else if (res.status !== 404) return { state: 'error', jira: plain, message: `Jira answered ${res.status}` };
  }
  return { state: denied ? 'noAccess' : 'notFound', jira: plain };
}

/**
 * The Jira issues assigned to the signed-in person, most recently updated first, from every connected site.
 * Empty when Jira is not connected or the search fails.
 */
export async function recentJiraIssues() {
  const current = await connection('jira');
  if (!current?.sites?.length) return [];
  const jql = encodeURIComponent('assignee = currentUser() ORDER BY updated DESC');
  const found = [];
  for (const site of current.sites) {
    try {
      const res = await authedFetch(
        'jira',
        `https://api.atlassian.com/ex/jira/${site.id}/rest/api/3/search/jql?jql=${jql}&maxResults=${RECENT_LIMIT}&fields=summary,status,assignee,description`,
      );
      if (!res.ok) continue;
      found.push(...((await res.json()).issues ?? []).map((issue) => shapeIssue(issue, site)));
    } catch {}
    if (found.length >= RECENT_LIMIT) break;
  }
  return found.slice(0, RECENT_LIMIT);
}

/**
 * Keeps a file's name and its top level frames, page by page, capped at MAX_FRAMES.
 * @param {any} data The file Figma returned for depth 2.
 * @param {{ fileKey: string, url: string }} base The file key and link.
 */
function shapeFile(data, base) {
  const frames = (data.document?.children ?? [])
    .flatMap((page) =>
      (page.children ?? []).filter((node) => FRAME_TYPES.has(node.type)).map((node) => ({ id: node.id, name: node.name ?? '', page: page.name ?? '' })),
    )
    .slice(0, MAX_FRAMES);
  return { fileKey: base.fileKey, url: base.url, name: data.name ?? base.name ?? '', frames, fetchedAt: new Date().toISOString() };
}

/**
 * Looks up a pasted Figma file link. Without a Figma connection it keeps the file key, the link and the name in the link.
 * @param {string} text What was pasted.
 * @returns {Promise<{ state: 'ok' | 'notConnected' | 'notFound' | 'noAccess' | 'invalid' | 'error', figma?: object, message?: string }>} The outcome.
 */
export async function lookUpFigma(text) {
  const parsed = parseFigmaInput(text);
  if (!parsed) return { state: 'invalid' };
  const plain = { fileKey: parsed.fileKey, url: parsed.url, name: parsed.name };
  if (!(await connection('figma'))) return { state: 'notConnected', figma: plain };
  let res;
  try {
    res = await authedFetch('figma', `https://api.figma.com/v1/files/${encodeURIComponent(parsed.fileKey)}?depth=2`);
  } catch (err) {
    return { state: 'error', figma: plain, message: err.message };
  }
  if (res.status === 404 || res.status === 400) return { state: 'notFound', figma: plain };
  if (res.status === 401 || res.status === 403) return { state: 'noAccess', figma: plain };
  if (!res.ok) return { state: 'error', figma: plain, message: `Figma answered ${res.status}` };
  return { state: 'ok', figma: shapeFile(await res.json(), plain) };
}

/**
 * Figma files linked to reviews before, newest first. Figma's API has no list of a person's recent files,
 * so Margin keeps its own.
 */
export async function recentFigmaFiles() {
  return (await chrome.storage.local.get(RECENT_FIGMA_KEY))[RECENT_FIGMA_KEY] ?? [];
}

/**
 * Puts a linked Figma file at the front of the recent files list.
 * @param {{ fileKey: string, url: string, name?: string }} figma The file.
 */
export async function rememberFigmaFile(figma) {
  const kept = (await recentFigmaFiles()).filter((file) => file.fileKey !== figma.fileKey);
  const entry = { fileKey: figma.fileKey, url: figma.url, name: figma.name ?? '' };
  await chrome.storage.local.set({ [RECENT_FIGMA_KEY]: [entry, ...kept].slice(0, RECENT_LIMIT) });
}

/**
 * Looks a review's links up again when the service is connected and the details are older than five minutes.
 * A failed lookup keeps the details already stored.
 * @param {{ jira?: object, figma?: object }} group The review.
 * @param {boolean} [force] Look up even when the details are fresh.
 * @returns {Promise<{ patch: object, failed: boolean }>} The fields to store and whether any lookup failed.
 */
export async function refreshLinks(group, force = false) {
  const patch = {};
  let failed = false;
  const stale = (link) => force || !link.fetchedAt || Date.now() - Date.parse(link.fetchedAt) > STALE_AFTER;
  if (group.jira?.key && stale(group.jira) && (await connection('jira'))) {
    const res = await lookUpJira(group.jira.url || group.jira.key);
    if (res.state === 'ok') patch.jira = res.jira;
    else failed = true;
  }
  if (group.figma?.fileKey && stale(group.figma) && (await connection('figma'))) {
    const res = await lookUpFigma(group.figma.url || `https://www.figma.com/design/${group.figma.fileKey}`);
    if (res.state === 'ok') patch.figma = res.figma;
    else failed = true;
  }
  return { patch, failed };
}

/**
 * The newest details time of a review's links, or null when nothing has been looked up.
 * @param {{ jira?: object, figma?: object }} group The review.
 */
export function detailsAt(group) {
  const times = [group.jira?.fetchedAt, group.figma?.fetchedAt].map((t) => Date.parse(t)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/**
 * How long ago a time was, in words.
 * @param {number} time Milliseconds since the epoch.
 */
export function timeAgo(time) {
  const minutes = Math.floor((Date.now() - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/**
 * The page and frame count of a linked file, such as 3 pages, 14 frames.
 * @param {{ frames?: { page: string }[] }} figma The linked file.
 */
export function frameCount(figma) {
  const frames = figma.frames ?? [];
  const pages = new Set(frames.map((frame) => frame.page)).size;
  return `${pages} ${pages === 1 ? 'page' : 'pages'}, ${frames.length} ${frames.length === 1 ? 'frame' : 'frames'}`;
}

/**
 * The colour family of a Jira status category. To do is neutral, In progress is blue, Done is green.
 * @param {string} [category] Jira's status category key.
 */
export function statusTone(category) {
  if (category === 'done') return 'done';
  if (category === 'indeterminate') return 'progress';
  return 'todo';
}
