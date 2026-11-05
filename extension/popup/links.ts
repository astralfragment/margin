import type { FigmaFile, JiraLink } from '@/lib/model';
import { lookUpFigma, lookUpJira, parseFigmaInput, parseJiraInput } from '@/lib/review-links.js';
import { type LinkKind, type LinkStatus, usePopup } from './store';

interface LookUp {
  state: Exclude<LinkStatus, 'typed' | 'looking'>;
  jira?: JiraLink;
  figma?: FigmaFile;
  site?: string;
  message?: string;
}

/** The words each link field uses. */
export const LINK_COPY = {
  jira: {
    label: 'Jira ticket',
    placeholder: 'SS-112 or a Jira link',
    invalid: 'That is not a Jira key or link. Paste a key like SS-112 or the link to the issue.',
    notFound: 'No ticket with that key in your Jira sites.',
    noAccess: 'You do not have access to this ticket.',
    otherSite: (site: string) => `${site} is not one of your connected Jira sites.`,
  },
  figma: {
    label: 'Figma file',
    placeholder: 'A Figma file link',
    invalid: 'That is not a Figma file link. In Figma, choose Share and then Copy link.',
    notFound: 'No Figma file at that link.',
    noAccess: 'You do not have access to this Figma file.',
    otherSite: () => '',
  },
} as const;

/**
 * The title a linked ticket or file shows.
 * @param kind Which link.
 * @param value The link.
 */
export function linkTitle(kind: LinkKind, value: JiraLink | FigmaFile | null) {
  if (!value) return '';
  return kind === 'jira' ? (value as JiraLink).key : (value as FigmaFile).name || 'Figma file';
}

/**
 * Looks up what a link field holds and stores the outcome in the sheet. A lookup that finishes after the text
 * changed is dropped.
 * @param kind Which field.
 */
export async function resolveLink(kind: LinkKind) {
  const field = usePopup.getState().sheet?.[kind];
  const text = field?.text.trim() ?? '';
  if (!field || !text || field.status !== 'typed') return;
  const { editLink } = usePopup.getState();
  const preview = kind === 'jira' ? parseJiraInput(text) : parseFigmaInput(text);
  if (!preview) {
    editLink(kind, { status: 'invalid' });
    return;
  }
  editLink(kind, { status: 'looking' });
  let result: LookUp;
  try {
    result = (await (kind === 'jira' ? lookUpJira(text) : lookUpFigma(text))) as LookUp;
  } catch (error) {
    result = { state: 'error', message: String(error) };
  }
  if (usePopup.getState().sheet?.[kind].text.trim() !== text) return;
  editLink(kind, {
    status: result.state,
    value: result.jira ?? result.figma ?? null,
    detail: result.site ?? result.message ?? '',
  });
}
