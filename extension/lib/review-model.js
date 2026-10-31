import { SEVERITIES, SEVERITY_ORDER, severityOf } from './severity.js';
import { STATUSES, statusOf } from './status.js';
import { DEFAULT_FIELDS, FACT_FIELDS, withDefaults } from './fields.js';
import { markList } from './marks.js';
import { widthCaption, widthShots } from './widths.js';

/** One date style for the review header and one date and time style for each comment, in the browser's locale, so every format reads the same. */
const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' });
const MOMENT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A stored timestamp in the per comment date and time style, or an empty string when it is missing or unreadable.
 * @param {string | number | Date} [value] The timestamp.
 */
const momentOf = (value) => {
  const date = new Date(value);
  return value == null || Number.isNaN(date.getTime()) ? '' : MOMENT.format(date);
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * Numbers comments in the order they were made, counting within each review, so a comment keeps one number
 * in the report, the exports, the Send dialogs and the All reviews view.
 * @param {object[]} issues Every comment shown, in the order they were made.
 * @returns {(issue: {id: string}) => number} The number of a comment.
 */
export function numbering(issues) {
  const counts = new Map();
  const numbers = new Map();
  for (const issue of issues) {
    const n = (counts.get(issue.groupId) ?? 0) + 1;
    counts.set(issue.groupId, n);
    numbers.set(issue.id, n);
  }
  return (issue) => numbers.get(issue.id) ?? 0;
}

const looksLikeId = (part) =>
  /^\d+$/.test(part) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part) || (/\d/.test(part) && /^[\w-]{16,}$/.test(part));

const screenWord = (part) => {
  const words = part.replace(/[-_]+/g, ' ').trim();
  if (/^[a-z]{2,4}$/i.test(words) && !/[aeiouy]/i.test(words)) return words.toUpperCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The site name in a tab title. "Page | Site" and "Page - Site" put it last, "Site: tagline" puts it first.
 * @param {string} [title] The tab title.
 */
function appOf(title) {
  const text = title?.trim() ?? '';
  const parts = text.split(/\s[|-]\s/);
  if (parts.length > 1) return parts.at(-1).trim();
  return text.split(/:\s/)[0].trim();
}

/**
 * Where a comment was made, as "App > Screen > Path". The app is the site part
 * of the tab title, else the host; the screen path comes from Flutter's #/
 * route when there is one, else the URL path, with record ids left out.
 *
 * @param {{ url: string, title?: string }} page The captured page.
 */
export function routeOf(page) {
  let parsed;
  try {
    parsed = new URL(page.url);
  } catch {
    return page.url ?? '';
  }
  const app = appOf(page.title) || parsed.host;
  const route = parsed.hash.startsWith('#/') ? parsed.hash.slice(1).split('?')[0] : parsed.pathname;
  const screens = route
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .filter((part) => !looksLikeId(part))
    .map(screenWord);
  return [app, ...(screens.length ? screens : ['Home'])].join(' > ');
}

/**
 * The browser line for a comment, such as "Google Chrome 141 on Windows, zoom 100%", or an empty string for comments captured before it was recorded.
 * @param {{ env?: { browser: string, os: string, zoom: number } }} issue The stored comment.
 */
function environmentText(issue) {
  const env = issue.env;
  if (!env) return '';
  return `${env.browser}${env.os ? ` on ${env.os}` : ''}${env.zoom ? `, zoom ${env.zoom}%` : ''}`;
}

const isFigma = (url) => /^https:\/\/([\w-]+\.)?figma\.com\//i.test(url);

/**
 * A readable name for one of a comment's links: the frame name when the comment was matched to one,
 * Figma frame for other Figma links, else the site the link goes to.
 * @param {string} url The link.
 * @param {number} i Its place among the comment's links.
 * @param {object} issue The stored comment.
 */
function linkName(url, i, issue) {
  if (isFigma(url)) {
    if (i === 0 && issue.figmaFrame?.name) return issue.figmaFrame.name;
    const figmas = (issue.links ?? []).filter(isFigma);
    return figmas.length > 1 ? `Figma frame ${figmas.indexOf(url) + 1}` : 'Figma frame';
  }
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Turns a computed colour such as rgb(0 0 0) or lab(96.5 0 0) into a hex code, leaving other formats as they are.
 * @param {string} value The colour as the browser reported it.
 */
function hexColour(value) {
  const text = String(value ?? '').trim();
  const nums = text.match(/-?[\d.]+(?:e-?\d+)?%?/gi)?.map((n) => (n.endsWith('%') ? Number(n.slice(0, -1)) / 100 : Number(n))) ?? [];
  const hex = (r, g, b, a = 1) => {
    const part = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}${a < 1 ? part(a) : ''}`;
  };
  if (/^rgba?\(/i.test(text) && nums.length >= 3) return hex(nums[0] / 255, nums[1] / 255, nums[2] / 255, nums[3] ?? 1);
  if (/^color\(srgb\s/i.test(text) && nums.length >= 3) return hex(nums[0], nums[1], nums[2], nums[3] ?? 1);
  if (/^okl(ab|ch)\(/i.test(text) && nums.length >= 3) {
    const [l, c, h] = nums;
    const [a, b] = /^oklch/i.test(text) ? [c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)] : [c, h];
    const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
    return hex(
      gamma(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp),
      gamma(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp),
      gamma(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp),
      nums[3] ?? 1,
    );
  }
  if (/^lab\(/i.test(text) && nums.length >= 3) {
    const [l, a, b] = nums;
    const fy = (l + 16) / 116;
    const inv = (t) => (t ** 3 > 0.008856 ? t ** 3 : (116 * t - 16) / 903.3);
    const x = 0.96422 * inv(fy + a / 500);
    const y = l > 8 ? fy ** 3 : l / 903.3;
    const z = 0.82521 * inv(fy - b / 200);
    const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    return hex(
      gamma(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
      gamma(-0.9787684 * x + 1.9161415 * y + 0.033454 * z),
      gamma(0.0719453 * x - 0.2289914 * y + 1.4052427 * z),
      nums[3] ?? 1,
    );
  }
  return text;
}

/**
 * Caption for the image taken when a comment was rechecked.
 * @param {{ checkedAt?: string }} issue The stored comment.
 */
export function recheckCaption(issue) {
  const at = momentOf(issue.checkedAt);
  return at ? `After, rechecked ${at}` : 'After recheck';
}

/**
 * A detail row. Rows with links name each link and may add a short note after them, and code rows hold selectors and measurements.
 * The plain value is what text and Markdown formats print.
 * @typedef {{ key: string, label: string, value: string, links?: { text: string, url: string }[], extra?: string, code?: boolean }} DetailRow
 */

/**
 * A link row with its plain value, which keeps every address readable without HTML.
 * @param {string} key The field key.
 * @param {string} label The row label.
 * @param {{ text: string, url: string }[]} links The links.
 * @param {string} [extra] A note after the links.
 * @returns {DetailRow}
 */
function linkRow(key, label, links, extra = '') {
  const value = links.map((l) => (!l.url || l.text === l.url ? l.text : `${l.text} ${l.url}`)).join(', ');
  return { key, label, value: extra ? `${value}, ${extra}` : value, links, extra };
}

/**
 * The detail rows of a comment in the order of FACT_FIELDS, which every format uses, leaving out the fields switched off and the facts not captured.
 * @param {object} issue The stored comment.
 * @param {Record<string, boolean>} fields Which detail rows are switched on.
 * @returns {DetailRow[]}
 */
function detailRows(issue, fields) {
  const el = issue.element;
  const links = issue.links ?? [];
  const rows = {
    page: () => issue.page?.url && linkRow('page', 'Page', [{ text: issue.page.url, url: issue.page.url }]),
    figma: () =>
      links.length &&
      linkRow(
        'figma',
        links.every(isFigma) ? 'Figma' : 'Links',
        links.map((url, i) => ({ text: linkName(url, i, issue), url })),
      ),
    jira: () => issue.jira?.key && linkRow('jira', 'Jira', [{ text: issue.jira.key, url: issue.jira.url ?? '' }], issue.jira.status ?? ''),
    selector: () => el?.selector && { key: 'selector', label: 'Selector', value: el.selector, code: true },
    element: () => el && { key: 'element', label: 'Element', value: `${el.tag}${el.classes ? `.${el.classes.split(' ').join('.')}` : ''}`, code: true },
    text: () => el?.text && { key: 'text', label: 'Text', value: el.text },
    styles: () => el?.styles && { key: 'styles', label: 'Styles', value: `${el.styles.font}, ${hexColour(el.styles.color)}`, code: true },
    position: () =>
      issue.rect &&
      issue.viewport && {
        key: 'position',
        label: 'Position',
        value: `${issue.rect.w} x ${issue.rect.h} at ${issue.rect.x}, ${issue.rect.y} in ${issue.viewport.width} x ${issue.viewport.height} at ${issue.viewport.dpr}x`,
        code: true,
      },
    browser: () => issue.env && { key: 'browser', label: 'Browser', value: environmentText(issue) },
    captured: () => momentOf(issue.createdAt) && { key: 'captured', label: 'Captured', value: momentOf(issue.createdAt) },
  };
  return FACT_FIELDS.filter((f) => fields[f.key]).map((f) => rows[f.key]()).filter(Boolean);
}

/**
 * One comment as every format reads it.
 * @param {object} issue The stored comment.
 * @param {number} number Its comment number.
 * @param {{ shots?: string, fields?: Record<string, boolean>, widths?: boolean }} [options] Which images, detail rows and width shots to include.
 */
export function reviewComment(issue, number, { shots = 'both', fields = DEFAULT_FIELDS, widths = true } = {}) {
  const regionShown = shots !== 'viewport';
  return {
    issue,
    id: issue.id,
    number,
    label: pad(number),
    severity: severityOf(issue.severity),
    status: statusOf(issue.status),
    title: String(issue.title ?? '').trim() || 'Untitled comment',
    note: String(issue.note ?? '').trim(),
    marks: markList(issue),
    route: issue.page?.url ? routeOf(issue.page) : '',
    url: issue.page?.url ?? '',
    images: {
      region: regionShown ? issue.detail ?? '' : '',
      after: regionShown ? issue.after ?? '' : '',
      afterCaption: issue.after ? recheckCaption(issue) : '',
      full: shots === 'detail' ? '' : issue.shot ?? '',
      widths: widths ? widthShots(issue).map((shot) => ({ ...shot, caption: widthCaption(shot) })) : [],
    },
    rows: detailRows(issue, withDefaults(fields)),
  };
}

/** Most urgent first, then oldest first. */
const bySeverity = (a, b) =>
  SEVERITY_ORDER.indexOf(a.severity.key) - SEVERITY_ORDER.indexOf(b.severity.key) || String(a.issue.createdAt).localeCompare(String(b.issue.createdAt));

/**
 * The one review every format draws from: the header, the counts, and the comments grouped by page in report order.
 * Pages come in the order they were first commented on, and comments inside a page by severity, then capture time.
 * @param {object[]} issues The comments, in the order they were made.
 * @param {{ title?: string, generatedAt?: Date, shots?: string, fields?: Record<string, boolean>, widths?: boolean, order?: 'severity' | 'number' }} [options]
 *   The review title and date, which images and detail rows to include, and the order of the flat comment list.
 */
export function buildReviewModel(issues, { title = 'UI review', generatedAt = new Date(), shots = 'both', fields = DEFAULT_FIELDS, widths = true, order = 'severity' } = {}) {
  const numberOf = numbering(issues);
  const byNumber = issues.map((issue) => reviewComment(issue, numberOf(issue), { shots, fields, widths }));
  const pages = new Map();
  for (const comment of byNumber) {
    if (!pages.has(comment.url)) pages.set(comment.url, { page: comment.issue.page ?? { url: comment.url }, comments: [] });
    pages.get(comment.url).comments.push(comment);
  }
  const sections = [...pages.values()].map(({ page, comments }, i) => ({
    number: i + 1,
    label: `COMM${i + 1}`,
    route: page.url ? routeOf(page) : 'No page',
    url: page.url ?? '',
    comments: comments.sort(bySeverity),
  }));
  const total = issues.length;
  const pageCount = sections.length;
  return {
    title,
    date: DAY.format(generatedAt),
    total,
    pageCount,
    summary: `${total} ${total === 1 ? 'comment' : 'comments'} on ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`,
    severities: SEVERITIES.map((s) => ({ ...s, count: byNumber.filter((c) => c.severity.key === s.key).length })),
    statuses: STATUSES.map((s) => ({ ...s, count: byNumber.filter((c) => c.status.key === s.key).length })),
    sections,
    comments: order === 'number' ? byNumber : sections.flatMap((section) => section.comments),
  };
}
