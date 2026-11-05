import * as severity from '@/lib/severity.js';
import * as status from '@/lib/status.js';
import * as fields from '@/lib/fields.js';
import * as marks from '@/lib/marks.js';
import * as widths from '@/lib/widths.js';
import * as reportTemplate from '@/lib/report-template.js';
import * as docsTemplate from '@/lib/docs-template.js';
import * as shareTemplate from '@/lib/share-template.js';
import * as reviewFile from '@/lib/review-file.js';
import * as reviewLinks from '@/lib/review-links.js';
import * as oauth from '@/lib/oauth.js';
import * as jira from '@/lib/jira.js';
import * as figma from '@/lib/figma.js';
import type {
  Comment,
  CommentStatus,
  CommentWithImages,
  Connection,
  FactField,
  FigmaFile,
  JiraLink,
  PageRef,
  Provider,
  Review,
  Screenshot,
  Severity,
  ShotMode,
  WidthKey,
  WidthShots,
} from '@/lib/model';

/**
 * The shared plain JS modules in lib/, typed with the domain types. Their JSDoc types are looser than the model, so
 * the report reads them through here. The popup and settings import the same modules, so they stay JS.
 */

export const SEVERITIES = severity.SEVERITIES as { key: Severity; label: string }[];
export const severityOf = severity.severityOf as (key: string | undefined) => { key: Severity; label: string };
export const STATUSES = status.STATUSES as { key: CommentStatus; label: string }[];
export const statusOf = status.statusOf as (key: string | undefined) => { key: CommentStatus; label: string };

export const FACT_FIELDS = fields.FACT_FIELDS as { key: FactField; label: string }[];
export const withDefaults = fields.withDefaults as (stored: Partial<Record<FactField, boolean>> | undefined) => Record<FactField, boolean>;

/** A marker note with its number on the image, which the JS module names `n`. */
export type MarkNote = { kind: string; note: string } & Record<'n', number>;
export const MARK_LABELS = marks.MARK_LABELS as Record<string, string>;
export const markList = marks.markList as (comment: Pick<Comment, 'marks'>) => MarkNote[];

export interface WidthShotView {
  key: WidthKey;
  label: string;
  target: number;
  width: number;
  src: string;
  placed: string;
}
export const widthShots = widths.widthShots as (images: { shots?: WidthShots | null }) => WidthShotView[];
export const widthCaption = widths.widthCaption as (shot: WidthShotView) => string;

export const numbering = reportTemplate.numbering as (comments: Comment[]) => (comment: { id: string }) => number;
export const orderIssues = reportTemplate.orderIssues as <Item extends Comment>(comments: Item[], order?: 'severity' | 'number') => Item[];
export const routeOf = reportTemplate.routeOf as (page: Partial<PageRef> & { url: string }) => string;
export const recheckCaption = reportTemplate.recheckCaption as (comment: Pick<Comment, 'checkedAt'>) => string;
export const environmentText = reportTemplate.environmentText as (comment: Comment) => string;
export const hexColour = reportTemplate.hexColour as (value: string | undefined) => string;
export const linkName = reportTemplate.linkName as (url: string, index: number, comment: Comment) => string;
export const linksLabel = reportTemplate.linksLabel as (links: string[]) => string;

interface TemplateOptions {
  title?: string;
  generatedAt?: Date;
  shots?: ShotMode;
  fields?: Record<FactField, boolean>;
  widths?: boolean;
}
export const buildReport = reportTemplate.buildReport as (comments: CommentWithImages[], options: TemplateOptions) => string;
export const renderBody = reportTemplate.renderBody as (comments: CommentWithImages[], options: TemplateOptions & { preview?: boolean }) => string;
export const REPORT_CSS = reportTemplate.REPORT_CSS as string;
export const escapeHtml = reportTemplate.escapeHtml as (value: string) => string;
export const buildDocsHtml = docsTemplate.buildDocsHtml as (comments: CommentWithImages[], options: TemplateOptions & { group?: Review | null }) => string;
export const buildDocsText = docsTemplate.buildDocsText as (comments: CommentWithImages[], options: TemplateOptions) => string;
export const buildMarkdown = shareTemplate.buildMarkdown as (comments: CommentWithImages[], options: TemplateOptions) => string;
export const commentMarkdown = shareTemplate.commentMarkdown as (comment: CommentWithImages, options: TemplateOptions & { heading?: string }) => string;
export const commentHtml = shareTemplate.commentHtml as (comment: CommentWithImages, fields: Record<FactField, boolean>, widths: boolean) => string;

export const buildReviewFile = reviewFile.buildReviewFile as (
  review: Pick<Review, 'name'> & Partial<Review>,
  comments: CommentWithImages[],
  raws: Record<string, Screenshot | null>,
) => string;
export const cleanJiraLink = reviewFile.cleanJiraLink as (jira: unknown) => JiraLink | null;
export const cleanFigmaLink = reviewFile.cleanFigmaLink as (figma: unknown) => FigmaFile | null;

/** A Jira ticket or a Figma file as the review sheet holds it. */
export type LinkValue = Partial<JiraLink & FigmaFile>;
export type LookupState = 'ok' | 'notConnected' | 'notFound' | 'noAccess' | 'otherSite' | 'invalid' | 'error';
export interface Lookup {
  state: LookupState;
  jira?: LinkValue;
  figma?: LinkValue;
  site?: string;
  message?: string;
}
export const lookUpJira = reviewLinks.lookUpJira as (text: string) => Promise<Lookup>;
export const lookUpFigma = reviewLinks.lookUpFigma as (text: string) => Promise<Lookup>;
export const parseJiraInput = reviewLinks.parseJiraInput as (text: string) => { key: string; site: string | null } | null;
export const parseFigmaInput = reviewLinks.parseFigmaInput as (text: string) => LinkValue | null;
export const recentJiraIssues = reviewLinks.recentJiraIssues as () => Promise<LinkValue[]>;
export const recentFigmaFiles = reviewLinks.recentFigmaFiles as () => Promise<LinkValue[]>;
export const rememberFigmaFile = reviewLinks.rememberFigmaFile as (figma: LinkValue) => Promise<void>;
export const frameCount = reviewLinks.frameCount as (figma: LinkValue) => string;
export const statusTone = reviewLinks.statusTone as (category: string | undefined) => 'done' | 'progress' | 'todo';
export const refreshLinks = reviewLinks.refreshLinks as (review: Review) => Promise<{ patch: Partial<Pick<Review, 'jira' | 'figma'>>; failed: boolean }>;

export const connection = oauth.connection as (provider: Provider) => Promise<Connection | null>;
export const requestAccess = oauth.requestAccess as (provider: Provider) => Promise<boolean>;
export const connect = oauth.connect as (provider: Provider) => Promise<void>;

export type JiraSite = NonNullable<Connection['sites']>[number];
export interface JiraProject {
  id: string;
  key: string;
  name: string;
  issueTypes: { id: string; name: string }[];
}
export interface JiraResult {
  key?: string;
  url?: string;
  error?: string;
  warning?: string;
  issues: Comment[];
}
interface SendOptions {
  site: JiraSite;
  shots: ShotMode;
  reviewTitle: string;
  numberOf: (comment: { id: string }) => number;
}
export const listProjects = jira.listProjects as (siteId: string) => Promise<JiraProject[]>;
export const defaultType = jira.defaultType as (types: JiraProject['issueTypes']) => { id: string } | undefined;
export const createIssues = jira.createIssues as (
  options: SendOptions & {
    projectId: string;
    issueTypeId: string;
    issues: Comment[];
    mode: string;
    linkTo?: string;
    onProgress: (done: number, total: number) => void;
  },
) => Promise<JiraResult[]>;
export const commentOnTicket = jira.commentOnTicket as (options: SendOptions & { key: string; issues: Comment[] }) => Promise<{ url: string; warning?: string }>;
export const linkFields = jira.linkFields as (issues: Comment[], reviewTitle: string, numberOf: (comment: { id: string }) => number) => { summary: string; description: string };
export const createLink = jira.createLink as (site: string, fields: { summary: string; description: string; projectId?: string; issueTypeId?: string }) => string;
export const siteOrigin = jira.siteOrigin as (value: string | undefined) => string | null;
export const openSites = jira.openSites as () => Promise<string[]>;
export const sessionProjects = jira.sessionProjects as (site: string) => Promise<JiraProject[] | null>;

export interface FigmaTarget {
  url: string;
  fileKey: string;
  nodeId: string;
}
export const figmaTargets = figma.figmaTargets as (comment: Comment) => { targets: FigmaTarget[]; skipped: { url: string; reason: 'no-node' | 'not-figma' }[] };
export const figmaMessage = figma.figmaMessage as (comment: Comment) => string;
export const postComment = figma.postComment as (target: Pick<FigmaTarget, 'fileKey' | 'nodeId'>, message: string) => Promise<string>;
