import { toast } from 'sonner';
import { buildReport, buildDocsHtml, buildDocsText, buildMarkdown, commentHtml, commentMarkdown, buildReviewFile, escapeHtml, renderBody, REPORT_CSS } from './shared';
import { readScreenshot, withImages } from '@/lib/review-store';
import type { Comment, Review } from '@/lib/model';
import type { ReportSettings } from './data';
import { hostOf, stamp } from './format';

/**
 * Every way out of the report. The documents come from the templates in lib/, which other apps open, so this file
 * only gathers the comments and hands the result to the clipboard or a download.
 */

/** What an export needs: the review shown, its comments in the order they were made, and the report options. */
export interface ExportSource {
  review: Review | null;
  comments: Comment[];
  settings: ReportSettings;
}

/**
 * The names an export uses: the report title, the document title and the file name without its extension.
 * @param source The review and its comments.
 */
export function namesOf({ review, comments }: Pick<ExportSource, 'review' | 'comments'>) {
  const hosts = [...new Set(comments.map((comment) => hostOf(comment.page?.url)))].filter(Boolean);
  const single = hosts.length === 1 ? hosts[0] : null;
  const slug = (review?.name ?? single ?? 'report').replace(/[^a-z0-9.]+/gi, '-').toLowerCase();
  return {
    title: review?.name ?? (single ? `UI review, ${single}` : 'UI review'),
    docsTitle: review?.name ?? (single ? `${single} comments` : 'UI review comments'),
    basename: `ui-issues-${slug}-${stamp(new Date())}`,
  };
}

/**
 * The template options for one export, with the images read fresh from storage.
 * @param source The review, comments and options.
 */
async function prepare(source: ExportSource) {
  const generatedAt = new Date();
  const names = namesOf(source);
  const comments = await withImages(source.comments);
  const { shots, fields, widths } = source.settings;
  return {
    comments,
    names,
    reportOptions: { title: names.title, generatedAt, shots, fields, widths },
    docsOptions: { title: names.docsTitle, generatedAt, shots, fields, widths, group: source.review },
  };
}

/**
 * Downloads a file the page built.
 * @param blob The contents.
 * @param filename The name to save as.
 */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Puts plain text, and rich text when given, on the clipboard.
 * @param plain The plain text.
 * @param html The rich text.
 */
async function copy(plain: string, html?: string) {
  const flavours: Record<string, Blob> = { 'text/plain': new Blob([plain], { type: 'text/plain' }) };
  if (html) flavours['text/html'] = new Blob([html], { type: 'text/html' });
  await navigator.clipboard.write([new ClipboardItem(flavours)]);
}

/**
 * Runs an export and reports how it went in a toast, so a failure is never silent.
 * @param work The export.
 * @param failed What to say when it fails.
 */
async function report(work: () => Promise<string>, failed: string) {
  try {
    toast.success(await work());
  } catch (error) {
    toast.error(`${failed}. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Copies the review for Google Docs, with a plain text fallback.
 * @param source The review, comments and options.
 */
export const copyForDocs = (source: ExportSource) =>
  report(async () => {
    const { comments, docsOptions } = await prepare(source);
    await copy(buildDocsText(comments, docsOptions), buildDocsHtml(comments, docsOptions));
    return 'Copied. Paste into Google Docs.';
  }, 'Copy failed. Try again with this tab in front');

/**
 * Downloads a Word compatible file.
 * @param source The review, comments and options.
 */
export const downloadWord = (source: ExportSource) =>
  report(async () => {
    const { comments, docsOptions, names } = await prepare(source);
    download(new Blob([buildDocsHtml(comments, docsOptions)], { type: 'application/msword' }), `${names.basename}.doc`);
    return `Downloaded ${names.basename}.doc. Word opens it with a note about the format, choose Yes.`;
  }, 'The Word file could not be made');

/**
 * Downloads the HTML report, which opens anywhere with no other files.
 * @param source The review, comments and options.
 */
export const downloadHtml = (source: ExportSource) =>
  report(async () => {
    const { comments, reportOptions, names } = await prepare(source);
    download(new Blob([buildReport(comments, reportOptions)], { type: 'text/html' }), `${names.basename}.html`);
    return `Downloaded ${names.basename}.html`;
  }, 'The HTML file could not be made');

/**
 * Downloads the review as a Markdown file.
 * @param source The review, comments and options.
 */
export const downloadMarkdown = (source: ExportSource) =>
  report(async () => {
    const { comments, names } = await prepare(source);
    const { fields, widths } = source.settings;
    download(new Blob([buildMarkdown(comments, { title: names.docsTitle, fields, widths })], { type: 'text/markdown' }), `${names.basename}.md`);
    return `Downloaded ${names.basename}.md`;
  }, 'The Markdown file could not be made');

/**
 * Copies the review as Markdown.
 * @param source The review, comments and options.
 */
export const copyMarkdown = (source: ExportSource) =>
  report(async () => {
    const { comments, names } = await prepare(source);
    const { fields, widths } = source.settings;
    await copy(buildMarkdown(comments, { title: names.docsTitle, fields, widths }));
    return 'Copied the review as Markdown';
  }, 'Copy failed. Try again with this tab in front');

/**
 * Opens the print dialog on the HTML report, where Save as PDF makes the PDF. The report prints from a hidden frame,
 * so the PDF matches the HTML file and not the screen.
 * @param source The review, comments and options.
 */
export async function printPdf(source: ExportSource) {
  try {
    const { comments, reportOptions } = await prepare(source);
    const frame = document.createElement('iframe');
    frame.title = 'Report for printing';
    frame.className = 'fixed size-0 border-0 opacity-0';
    frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(reportOptions.title)}</title><style>${REPORT_CSS}</style></head><body>${renderBody(comments, reportOptions)}</body></html>`;
    frame.addEventListener('load', () => {
      frame.contentWindow?.addEventListener('afterprint', () => frame.remove());
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    });
    document.body.append(frame);
  } catch (error) {
    toast.error(`The PDF could not be made. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Copies one comment for Slack, Jira, GitHub or a doc.
 * @param comment The comment.
 * @param settings The report options.
 */
export const copyComment = (comment: Comment, settings: ReportSettings) =>
  report(async () => {
    const [full = comment] = await withImages([comment]);
    await copy(commentMarkdown(full, { fields: settings.fields, widths: settings.widths }), commentHtml(full, settings.fields, settings.widths));
    return 'Copied the comment';
  }, 'Copy failed. Try again with this tab in front');

/**
 * Saves the review as a file another person can open in Margin, with every image and clean screenshot.
 * @param source The review, comments and options.
 */
export const saveReviewFile = (source: ExportSource) =>
  report(async () => {
    const { comments, names } = await prepare(source);
    const raws = Object.fromEntries(await Promise.all(comments.map(async (comment) => [comment.id, await readScreenshot(comment.id)] as const)));
    const blob = new Blob([buildReviewFile(source.review ?? { name: names.title }, comments, raws)], { type: 'application/json' });
    download(blob, `${names.basename}.margin.json`);
    return `Saved ${names.basename}.margin.json, ${(blob.size / 1048576).toFixed(1)} MB`;
  }, 'The review file could not be saved');
