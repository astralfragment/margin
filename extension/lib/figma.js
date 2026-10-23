import { authedJson } from './oauth.js';
import { severityOf } from './severity.js';
import { markList } from './marks.js';

/**
 * Reads the file key and frame id out of a Figma link. Branch links use the branch's key, and a link
 * without a node-id has no frame to pin a comment to.
 * @param {string} url A Figma link.
 */
export function parseFigmaLink(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/.test(parsed.hostname)) return null;
  const match = parsed.pathname.match(/^\/(?:file|design|proto|board|slides)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/);
  if (!match) return null;
  const node = parsed.searchParams.get('node-id');
  return { url, fileKey: match[2] ?? match[1], nodeId: node ? node.replace(/-/g, ':') : null };
}

/**
 * Sorts a comment's Figma links into frames to post on and links that cannot take a pinned comment.
 * @param {object} issue The stored comment.
 */
export function figmaTargets(issue) {
  const links = (issue.links ?? []).map((url) => ({ url, target: parseFigmaLink(url) }));
  return {
    targets: links.filter((l) => l.target?.nodeId).map((l) => l.target),
    skipped: links.filter((l) => !l.target?.nodeId).map((l) => ({ url: l.url, reason: l.target ? 'no-node' : 'not-figma' })),
  };
}

/**
 * The comment text posted to Figma: title, note, numbered marker notes and the page it came from.
 * @param {object} issue The stored comment.
 */
export function figmaMessage(issue) {
  return [
    `${issue.title || 'Untitled comment'} (${severityOf(issue.severity).label})`,
    issue.note?.trim(),
    markList(issue).map((item) => `${item.n}. ${item.note.replace(/\n/g, ' ')}`).join('\n'),
    issue.page?.url,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Posts a comment pinned to a frame and returns Figma's comment id.
 * @param {{ fileKey: string, nodeId: string }} target The file and frame.
 * @param {string} message The comment text.
 */
export async function postComment(target, message) {
  const res = await authedJson('figma', `https://api.figma.com/v1/files/${target.fileKey}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, client_meta: { node_id: target.nodeId, node_offset: { x: 0, y: 0 } } }),
  });
  return res.id;
}
