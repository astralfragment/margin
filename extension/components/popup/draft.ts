import { browser } from 'wxt/browser';
import type { FieldState } from './use-link-field';

/** Shared with the report's review sheet, which keeps the same record without `fields`. */
const DRAFT_KEY = 'reviewDraft';
const DRAFT_AGE = 15 * 60_000;

export type SheetMode = 'new' | 'edit';

export type Draft = {
  mode: SheetMode;
  scope: string | null;
  groupId: string | null;
  name: string;
  jira: string;
  figma: string;
  /** The popup's link fields as they stood, so a restored sheet needs no new lookup. */
  fields?: { jira: FieldState; figma: FieldState };
  at: number;
};

/** The draft typed in a scope, such as the popup on one tab, when it is less than fifteen minutes old. */
export function draftIn(draft: Draft | null | undefined, scope: string) {
  return draft && draft.scope === scope && Date.now() - draft.at < DRAFT_AGE ? draft : null;
}

/**
 * Keeps what was typed in the popup so it survives closing.
 * @param draft The typed fields and their scope.
 */
export function saveDraft(draft: Omit<Draft, 'at'>) {
  return browser.storage.local.set({ [DRAFT_KEY]: { ...draft, at: Date.now() } });
}

/** Forgets the saved popup draft. */
export function dropDraft() {
  return browser.storage.local.remove(DRAFT_KEY);
}
