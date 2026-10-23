/**
 * A review saved as one JSON file, so it can be backed up or handed to a teammate
 * without a server. Imports are treated as untrusted, so every value is rebuilt
 * from known fields and checked before it is stored.
 */
export const REVIEW_FORMAT = 'margin-review';
export const REVIEW_VERSION = 1;

const MARK_KINDS = new Set(['dot', 'box', 'arrow']);
const SEVERITY_KEYS = new Set(['blocker', 'major', 'minor', 'nit']);

/**
 * Builds the file contents for a review.
 * @param {{ name: string }} group The review being saved.
 * @param {object[]} issues Its comments.
 * @param {Record<string, { src: string, hasBox: boolean } | null>} raws Each comment's clean screenshot, by comment id.
 */
export function buildReviewFile(group, issues, raws) {
  return JSON.stringify({
    format: REVIEW_FORMAT,
    version: REVIEW_VERSION,
    exportedAt: new Date().toISOString(),
    name: group?.name ?? 'Imported review',
    issues: issues.map((issue) => ({ ...issue, raw: raws[issue.id] ?? null })),
  });
}

const text = (value, max = 4000) => (typeof value === 'string' ? value.slice(0, max) : '');
const number = (value) => (Number.isFinite(value) ? value : 0);
const optionalNumber = (value) => (Number.isFinite(value) ? value : undefined);

/**
 * Keeps a web address only when it is http or https.
 * @param {unknown} value The address to check.
 */
function webUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol) ? value : '';
  } catch {
    return '';
  }
}

/**
 * Keeps an image only when it is an inline PNG, JPEG or WebP.
 * @param {unknown} value The image source to check.
 */
function image(value) {
  return typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : null;
}

/**
 * Rebuilds one imported comment from known fields only.
 * @param {any} issue A comment from the file.
 */
function cleanIssue(issue) {
  const el = issue.element && typeof issue.element === 'object' ? issue.element : null;
  return {
    severity: SEVERITY_KEYS.has(issue.severity) ? issue.severity : 'major',
    title: text(issue.title, 300),
    note: text(issue.note),
    createdAt: Number.isNaN(Date.parse(issue.createdAt)) ? new Date().toISOString() : issue.createdAt,
    page: { url: webUrl(issue.page?.url), title: text(issue.page?.title, 300) },
    viewport: {
      width: number(issue.viewport?.width) || 1280,
      height: number(issue.viewport?.height) || 800,
      scrollY: number(issue.viewport?.scrollY),
      dpr: number(issue.viewport?.dpr) || 1,
    },
    env: issue.env ? { browser: text(issue.env.browser, 80), os: text(issue.env.os, 80), zoom: number(issue.env.zoom) || 100 } : undefined,
    element: el
      ? {
          selector: text(el.selector, 1000),
          tag: text(el.tag, 40),
          classes: text(el.classes, 500),
          text: text(el.text, 500),
          styles: el.styles ? { font: text(el.styles.font, 200), color: text(el.styles.color, 80) } : undefined,
        }
      : null,
    rect: { x: number(issue.rect?.x), y: number(issue.rect?.y), w: number(issue.rect?.w) || 4, h: number(issue.rect?.h) || 4 },
    marks: (Array.isArray(issue.marks) ? issue.marks : [])
      .filter((mark) => MARK_KINDS.has(mark?.kind))
      .map((mark) => ({
        kind: mark.kind,
        x: number(mark.x),
        y: number(mark.y),
        w: optionalNumber(mark.w),
        h: optionalNumber(mark.h),
        x2: optionalNumber(mark.x2),
        y2: optionalNumber(mark.y2),
        note: text(mark.note, 1000),
      })),
    links: (Array.isArray(issue.links) ? issue.links : []).map(webUrl).filter(Boolean),
    shot: image(issue.shot),
    detail: image(issue.detail),
    after: image(issue.after),
    checkedAt: issue.after && !Number.isNaN(Date.parse(issue.checkedAt)) ? issue.checkedAt : null,
    raw: image(issue.raw?.src) ? { src: issue.raw.src, hasBox: Boolean(issue.raw.hasBox) } : null,
  };
}

/**
 * Reads a review file, returning its name and cleaned comments, or an error a person can act on.
 * @param {string} contents The file's text.
 */
export function parseReviewFile(contents) {
  let data;
  try {
    data = JSON.parse(contents);
  } catch {
    return { error: 'That file is not a Margin review file' };
  }
  if (data?.format !== REVIEW_FORMAT || !Array.isArray(data.issues)) return { error: 'That file is not a Margin review file' };
  if (data.version > REVIEW_VERSION) return { error: 'That review was saved by a newer Margin. Update Margin and try again.' };
  return { name: text(data.name, 120) || 'Imported review', issues: data.issues.filter((issue) => issue && typeof issue === 'object').map(cleanIssue) };
}
