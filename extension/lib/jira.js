import { authedFetch, authedJson } from './oauth.js';
import { severityOf, SEVERITY_ORDER } from './severity.js';
import { markList } from './marks.js';

const pad = (n) => String(n).padStart(2, '0');

/** Jira priority names tried for each severity, first match wins. */
const PRIORITY_NAMES = {
  blocker: ['highest', 'blocker', 'critical'],
  major: ['high', 'major'],
  minor: ['medium', 'minor', 'normal'],
  nit: ['low', 'lowest', 'trivial', 'minor'],
};

/**
 * The REST address of a Jira Cloud site reached through Atlassian's API gateway.
 * @param {string} cloudId The site's cloud id.
 * @param {string} path The path under rest/api/3.
 */
const api = (cloudId, path) => `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3${path}`;

/**
 * Keeps the fields Margin needs from Jira's project search, with sub-task types left out.
 * @param {object[]} values The projects Jira returned.
 */
const shapeProjects = (values) =>
  values.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    issueTypes: (p.issueTypes ?? []).filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name })),
  }));

const PROJECT_SEARCH = '/project/search?maxResults=100&orderBy=-lastIssueUpdatedTime&expand=issueTypes';

/**
 * The projects the signed-in account can see on a site, most recently active first.
 * @param {string} cloudId The site's cloud id.
 */
export async function listProjects(cloudId) {
  return shapeProjects((await authedJson('jira', api(cloudId, PROJECT_SEARCH))).values ?? []);
}

/**
 * The issue type a review comment most likely is: Bug, then Task, then whatever comes first.
 * @param {{ id: string, name: string }[]} types The project's issue types.
 */
export function defaultType(types) {
  return types.find((t) => /^bug$/i.test(t.name)) ?? types.find((t) => /^task$/i.test(t.name)) ?? types[0] ?? null;
}

/**
 * Maps a severity to one of the site's priorities by name, or null when none fits.
 * @param {{ id: string, name: string }[]} priorities The site's priorities.
 * @param {string} severity The severity key.
 */
function priorityFor(priorities, severity) {
  const names = PRIORITY_NAMES[severityOf(severity).key];
  for (const name of names) {
    const found = priorities.find((p) => p.name.toLowerCase() === name);
    if (found) return { id: found.id };
  }
  return null;
}

/**
 * A run of text, linked when given an address.
 * @param {string} value The words.
 * @param {string} [href] Where it links to.
 */
const text = (value, href) => ({ type: 'text', text: value, ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) });

/**
 * A paragraph, or nothing when every run is empty, because Jira rejects empty text.
 * @param {...object} runs The text runs.
 */
function para(...runs) {
  const content = runs.filter((r) => r.text);
  return content.length ? [{ type: 'paragraph', content }] : [];
}

/**
 * The numbered marker notes. A run from 1 becomes a Jira numbered list, and a list with gaps keeps each
 * number in its line so it still matches the number drawn on the screenshot.
 * @param {object} issue The stored comment.
 */
function markerBlocks(issue) {
  const items = markList(issue);
  if (!items.length) return [];
  if (items.every((item, i) => item.n === i + 1)) {
    return [
      {
        type: 'orderedList',
        content: items.map((item) => ({ type: 'listItem', content: para(text(item.note.replace(/\n/g, ' '))) })),
      },
    ];
  }
  return items.flatMap((item) => para(text(`${item.n}. ${item.note.replace(/\n/g, ' ')}`)));
}

/**
 * A note as paragraphs, split on blank lines, with single line breaks kept as Jira hard breaks.
 * @param {string} [note] The comment's note.
 */
function noteParagraphs(note) {
  return String(note ?? '')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({
      type: 'paragraph',
      content: chunk.split('\n').flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [text(line)] : [])]),
    }));
}

/**
 * The description blocks for one comment: note, numbered markers, page and Figma links.
 * @param {object} issue The stored comment.
 */
function commentBlocks(issue) {
  const page = issue.page?.url;
  return [
    ...noteParagraphs(issue.note),
    ...markerBlocks(issue),
    ...(page ? para(text('Page '), text(issue.page.title || page, page)) : []),
    ...(issue.links ?? []).flatMap((url, i) => para(text(`Figma link ${i + 1} `), text(url, url))),
    ...(issue.element?.selector ? para(text(`Selector ${issue.element.selector}`)) : []),
  ];
}

/**
 * A Jira description document.
 * @param {object[]} content The block nodes.
 */
const doc = (content) => ({ type: 'doc', version: 1, content });

/**
 * The image files to attach for a comment, following the report's screenshot choice.
 * @param {object} issue The stored comment.
 * @param {'both' | 'detail' | 'viewport'} shots Which screenshots the report shows.
 * @param {string} prefix Put at the start of each file name.
 */
async function imagesFor(issue, shots, prefix) {
  const wanted = [
    shots !== 'viewport' && issue.detail && { src: issue.detail, name: `${prefix}region.jpg` },
    shots !== 'detail' && issue.shot && { src: issue.shot, name: `${prefix}viewport.jpg` },
  ].filter(Boolean);
  return Promise.all(wanted.map(async (w) => ({ name: w.name, blob: await (await fetch(w.src)).blob() })));
}

/**
 * Creates an issue, retrying without the priority when the project's create screen does not take one.
 * @param {string} cloudId The site's cloud id.
 * @param {object} fields The issue fields.
 */
async function createOne(cloudId, fields) {
  const post = (body) => authedJson('jira', api(cloudId, '/issue'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: body }),
  });
  try {
    return await post(fields);
  } catch (err) {
    if (!fields.priority || !err.data?.errors?.priority) throw err;
    const { priority, ...rest } = fields;
    return post(rest);
  }
}

/**
 * Uploads image files to an issue.
 * @param {string} cloudId The site's cloud id.
 * @param {string} key The issue key.
 * @param {{ name: string, blob: Blob }[]} files The images.
 */
async function attach(cloudId, key, files) {
  if (!files.length) return;
  const form = new FormData();
  for (const file of files) form.append('file', file.blob, file.name);
  const res = await authedFetch('jira', api(cloudId, `/issue/${key}/attachments`), {
    method: 'POST',
    headers: { 'X-Atlassian-Token': 'no-check' },
    body: form,
  });
  if (!res.ok) throw new Error(`The issue ${key} was created, but its screenshots did not upload (${res.status}).`);
}

/**
 * Creates Jira issues from review comments, one per comment or one for the whole review, with the screenshots attached.
 * Reports progress after each issue and keeps going when one fails, so a single bad comment does not stop the rest.
 * @param {object} options What to create.
 * @param {{ id: string, url: string }} options.site The Jira site.
 * @param {string} options.projectId The project id.
 * @param {string} options.issueTypeId The issue type id.
 * @param {object[]} options.issues The comments, in report order.
 * @param {'each' | 'review'} options.mode One issue per comment, or one for the review.
 * @param {'both' | 'detail' | 'viewport'} options.shots Which screenshots to attach.
 * @param {string} options.reviewTitle The summary for a whole-review issue.
 * @param {(done: number, total: number) => void} [options.onProgress] Called after each issue.
 */
export async function createIssues({ site, projectId, issueTypeId, issues, mode, shots, reviewTitle, onProgress }) {
  const priorities = await authedJson('jira', api(site.id, '/priority')).catch(() => []);
  const base = { project: { id: projectId }, issuetype: { id: issueTypeId } };
  const browse = (key) => `${site.url}/browse/${key}`;
  const jobs =
    mode === 'review'
      ? [
          {
            issues,
            fields: {
              ...base,
              summary: (reviewTitle || 'UI review').slice(0, 250),
              description: doc([
                ...para(text(`${issues.length} ${issues.length === 1 ? 'comment' : 'comments'} from a Margin review. Screenshots are attached, numbered as below.`)),
                ...issues.flatMap((issue, i) => [
                  { type: 'heading', attrs: { level: 3 }, content: [text(`${pad(i + 1)} ${issue.title || 'Untitled comment'}`)] },
                  ...para(text(`Severity ${severityOf(issue.severity).label}`)),
                  ...commentBlocks(issue),
                ]),
              ]),
              ...withPriority(priorities, worstSeverity(issues)),
            },
            files: async () => (await Promise.all(issues.map((issue, i) => imagesFor(issue, shots, `${pad(i + 1)}-`)))).flat(),
          },
        ]
      : issues.map((issue) => ({
          issues: [issue],
          fields: {
            ...base,
            summary: (issue.title || 'Untitled comment').slice(0, 250),
            description: doc(commentBlocks(issue)),
            ...withPriority(priorities, issue.severity),
          },
          files: () => imagesFor(issue, shots, ''),
        }));

  const results = [];
  for (const job of jobs) {
    try {
      const created = await createOne(site.id, job.fields);
      const result = { issues: job.issues, key: created.key, url: browse(created.key) };
      try {
        await attach(site.id, created.key, await job.files());
      } catch (err) {
        result.warning = err.message;
      }
      results.push(result);
    } catch (err) {
      results.push({ issues: job.issues, error: err.message });
    }
    onProgress?.(results.length, jobs.length);
  }
  return results;
}

/**
 * The priority field for a severity, or nothing when the site has no matching priority.
 * @param {{ id: string, name: string }[]} priorities The site's priorities.
 * @param {string} severity The severity key.
 */
function withPriority(priorities, severity) {
  const priority = priorityFor(priorities, severity);
  return priority ? { priority } : {};
}

/**
 * The most urgent severity among some comments.
 * @param {object[]} issues The comments.
 */
const worstSeverity = (issues) =>
  SEVERITY_ORDER.find((key) => issues.some((issue) => severityOf(issue.severity).key === key)) ?? 'major';

/* Without sign-in -------------------------------------------------------- */

const MAX_LINK_TEXT = 6000;

/**
 * Plain text for one comment, used where Jira only takes text in a link.
 * @param {object} issue The stored comment.
 */
function commentText(issue) {
  return [
    issue.note?.trim(),
    markList(issue).map((item) => `${item.n}. ${item.note.replace(/\n/g, ' ')}`).join('\n'),
    issue.page?.url && `Page ${issue.page.url}`,
    ...(issue.links ?? []).map((url, i) => `Figma link ${i + 1} ${url}`),
    `Severity ${severityOf(issue.severity).label}. Captured with Margin. The screenshots are in the Margin report.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The summary and description for a create link, for one comment or a whole review.
 * @param {object[]} issues The comments, in report order.
 * @param {string} reviewTitle The summary when there is more than one comment.
 */
export function linkFields(issues, reviewTitle) {
  if (issues.length === 1) return { summary: issues[0].title || 'Untitled comment', description: commentText(issues[0]) };
  return {
    summary: reviewTitle || 'UI review',
    description: issues.map((issue, i) => `${pad(i + 1)} ${issue.title || 'Untitled comment'}\n${commentText(issue)}`).join('\n\n'),
  };
}

/**
 * Jira's create-issue page with the fields filled in. The person still checks the form and presses Create.
 * @param {string} siteUrl The site origin, like https://team.atlassian.net.
 * @param {{ summary: string, description: string, projectId?: string, issueTypeId?: string }} fields What to fill in.
 */
export function createLink(siteUrl, { summary, description, projectId, issueTypeId }) {
  const params = new URLSearchParams({
    ...(projectId ? { pid: projectId } : {}),
    ...(issueTypeId ? { issuetype: issueTypeId } : {}),
    summary: summary.slice(0, 250),
    description: description.length > MAX_LINK_TEXT ? `${description.slice(0, MAX_LINK_TEXT)}\n\nThe rest is in the Margin report.` : description,
  });
  return `${siteUrl}/secure/CreateIssueDetails!init.jspa?${params}`;
}

/**
 * Turns what someone typed into a Jira Cloud site origin, or null when it is not one.
 * @param {string} value A site name, host or address.
 */
export function siteOrigin(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  const host = /^[a-z0-9-]+$/.test(raw) ? `${raw}.atlassian.net` : raw.replace(/^https?:\/\//, '').split('/')[0];
  return /^[a-z0-9-]+\.atlassian\.net$/.test(host) ? `https://${host}` : null;
}

/** The Jira sites open in this browser's tabs. Needs the optional atlassian.net permission. */
export async function openSites() {
  const tabs = await chrome.tabs.query({ url: 'https://*.atlassian.net/*' }).catch(() => []);
  return [...new Set(tabs.map((tab) => siteOrigin(tab.url)).filter(Boolean))];
}

/**
 * The projects visible on a site through the browser's own Jira sign-in, or null when that is not available.
 * @param {string} siteUrl The site origin.
 */
export async function sessionProjects(siteUrl) {
  try {
    const res = await fetch(`${siteUrl}/rest/api/3${PROJECT_SEARCH}`, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return shapeProjects((await res.json()).values ?? []);
  } catch {
    return null;
  }
}
