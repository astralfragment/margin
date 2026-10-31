import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  lookUpFigma,
  lookUpJira,
  parseFigmaInput,
  parseJiraInput,
  recentFigmaFiles,
  recentJiraIssues,
  rememberFigmaFile,
} from '@/lib/review-links.js';
import type { Link, LinkKind } from './model';

export type LinkStatus = 'input' | 'invalid' | 'notFound' | 'error' | 'looking' | 'ok' | 'notConnected' | 'noAccess' | 'otherSite' | 'removed';

export type FieldState = { status: LinkStatus; text: string; value: Link | null; site: string; message: string };

/** Which control takes focus when the field next draws, after Remove, Undo or the end of Undo. */
export type FocusTarget = 'undo' | 'remove' | 'input' | null;

/** Outcomes that keep the link on the review. */
export const LINKED = new Set<LinkStatus>(['ok', 'notConnected', 'noAccess', 'otherSite']);
/** Outcomes that show the input, to type or fix. */
export const TYPED = new Set<LinkStatus>(['input', 'invalid', 'notFound', 'error']);
/** Outcomes that stop the sheet from saving. */
export const BAD = new Set<LinkStatus>(['invalid', 'notFound', 'error']);

const UNDO_MS = 5000;
const EMPTY: FieldState = { status: 'input', text: '', value: null, site: '', message: '' };

type LookUp = { state: LinkStatus; jira?: Link; figma?: Link; site?: string; message?: string };

/** A stored link as a field: linked with details, or linked by key or address alone. */
export function fieldFor(kind: LinkKind, link: Link | null | undefined): FieldState {
  if (!link) return EMPTY;
  const known = kind === 'jira' ? link.summary || link.status : link.frames?.length;
  return { ...EMPTY, status: known ? 'ok' : 'notConnected', value: link };
}

/** The text a field's link can be looked up again from, for the report's sheet which keeps drafts as text. */
export function linkText(kind: LinkKind, field: FieldState) {
  if (field.status === 'removed') return '';
  if (LINKED.has(field.status)) return (kind === 'jira' ? field.value?.url || field.value?.key : field.value?.url) ?? '';
  return field.text;
}

/**
 * One link field of the review sheet: what was typed, the lookup and its outcome, recent suggestions,
 * and Remove with Undo. A newer lookup replaces an older one. Every change is reported, so the sheet can keep a draft.
 */
export function useLinkField(kind: LinkKind, start: FieldState, connected: boolean, onChange: (field: FieldState) => void) {
  const [field, setField] = useState<FieldState>(start);
  const [focus, setFocus] = useState<FocusTarget>(null);
  const [searching, setSearching] = useState(false);
  const current = useRef(field);
  const token = useRef(0);
  const pending = useRef<Promise<FieldState> | null>(null);
  const previous = useRef<FieldState | null>(null);
  const timer = useRef(0);

  const suggestions = useQuery({
    queryKey: ['link-suggestions', kind],
    queryFn: async () => ((await (kind === 'jira' ? recentJiraIssues() : recentFigmaFiles())) as Link[]) ?? [],
    enabled: connected && searching,
    staleTime: kind === 'jira' ? Infinity : 0,
  });

  const update = (next: FieldState, focusOn: FocusTarget = null) => {
    current.current = next;
    setField(next);
    setFocus(focusOn);
    onChange(next);
    return next;
  };

  const setText = (text: string) => update({ ...current.current, status: 'input', text });

  /** Looks up what was typed and resolves with the outcome. */
  const resolve = (text: string = current.current.text): Promise<FieldState> => {
    if (!text.trim()) return Promise.resolve(update({ ...current.current, status: 'input', text }));
    const preview = kind === 'jira' ? parseJiraInput(text) : parseFigmaInput(text);
    if (!preview) return Promise.resolve(update({ ...current.current, status: 'invalid', text }));
    const mine = ++token.current;
    update({ status: 'looking', text, value: preview as Link, site: '', message: '' });
    const lookup = (kind === 'jira' ? lookUpJira(text) : lookUpFigma(text)) as Promise<LookUp>;
    pending.current = lookup.then(async (res) => {
      if (mine !== token.current) return current.current;
      const value = res.jira ?? res.figma ?? (preview as Link);
      if (kind === 'figma' && LINKED.has(res.state)) await rememberFigmaFile(value as { fileKey: string; url: string });
      pending.current = null;
      return update({ status: res.state, text, value, site: res.site ?? '', message: res.message ?? '' });
    });
    return pending.current;
  };

  /** Links a suggested ticket at once, or looks up a suggested file. */
  const pick = (item: Link) => {
    if (kind === 'figma') return resolve(item.url ?? '');
    token.current += 1;
    return Promise.resolve(update({ status: 'ok', text: item.key ?? '', value: item, site: '', message: '' }));
  };

  /** Takes the link off and offers Undo for five seconds, then leaves an empty input. */
  const remove = () => {
    previous.current = current.current;
    update({ ...current.current, status: 'removed' }, 'undo');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (current.current.status !== 'removed') return;
      const undoFocused = document.activeElement?.getAttribute('data-focus') === 'undo';
      previous.current = null;
      update(EMPTY, undoFocused ? 'input' : null);
    }, UNDO_MS);
  };

  const undo = () => {
    clearTimeout(timer.current);
    if (previous.current) update(previous.current, 'remove');
    previous.current = null;
  };

  /** Waits for a lookup in flight, and looks up text that was typed but not looked up yet. */
  const settle = (): Promise<FieldState> => {
    const now = current.current;
    if (now.status === 'looking' && pending.current) return pending.current;
    if (now.status === 'input' && now.text.trim()) return resolve(now.text);
    return Promise.resolve(now);
  };

  return { kind, field, focus, suggestions: suggestions.data ?? [], setSearching, setText, resolve, pick, remove, undo, settle };
}

export type LinkFieldApi = ReturnType<typeof useLinkField>;
