import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { FigmaFile, JiraLink } from '@/lib/model';

export type LinkKind = 'jira' | 'figma';

/**
 * Where a link field stands. `typed` holds text not looked up yet. The next four keep a link, with or without its
 * details. The last three are text that cannot be linked as it is.
 */
export type LinkStatus = 'typed' | 'looking' | 'ok' | 'notConnected' | 'noAccess' | 'otherSite' | 'invalid' | 'notFound' | 'error';

export const LINKED_STATUSES: readonly LinkStatus[] = ['ok', 'notConnected', 'noAccess', 'otherSite'];
export const BAD_STATUSES: readonly LinkStatus[] = ['invalid', 'notFound', 'error'];

export interface LinkField {
  text: string;
  status: LinkStatus;
  value: JiraLink | FigmaFile | null;
  /** The error from a failed lookup, or the site a link points at when it is not connected. */
  detail: string;
}

/** The review sheet, used to start a review or edit the open one. */
export interface Sheet {
  mode: 'new' | 'edit';
  /** The tab and site the sheet was opened on, so a draft only comes back there. */
  scope: string;
  reviewId: string | null;
  name: string;
  jira: LinkField;
  figma: LinkField;
  /** When the sheet was last changed, so an old draft is dropped. */
  changedAt: number;
}

/** A sheet left unsaved for longer than this is dropped. */
const SHEET_AGE = 15 * 60_000;

export const EMPTY_LINK: LinkField = { text: '', status: 'typed', value: null, detail: '' };

interface PopupState {
  sheet: Sheet | null;
  /** The comment width the list shows, when the page has comments at more than one width. */
  width: number | null;
  /** Comments deleted while their Undo is still on offer. */
  hiddenIds: string[];
  /** Why annotation could not start on this tab. */
  startError: string | null;
  openSheet: (sheet: Omit<Sheet, 'changedAt'>) => void;
  closeSheet: () => void;
  editSheet: (patch: Partial<Pick<Sheet, 'name'>>) => void;
  editLink: (kind: LinkKind, patch: Partial<LinkField>) => void;
  setWidth: (width: number) => void;
  hideComment: (id: string) => void;
  showComment: (id: string) => void;
  setStartError: (message: string | null) => void;
}

/**
 * The popup's own state. The review sheet is kept in the page's local storage, apart from chrome.storage, so a
 * half filled sheet survives the popup closing while a link is copied from another tab.
 */
export const usePopup = create<PopupState>()(
  persist(
    (set) => ({
      sheet: null,
      width: null,
      hiddenIds: [],
      startError: null,
      openSheet: (sheet) => set({ sheet: { ...sheet, changedAt: Date.now() }, startError: null }),
      closeSheet: () => set({ sheet: null }),
      editSheet: (patch) => set(({ sheet }) => ({ sheet: sheet && { ...sheet, ...patch, changedAt: Date.now() } })),
      editLink: (kind, patch) =>
        set(({ sheet }) => ({ sheet: sheet && { ...sheet, [kind]: { ...sheet[kind], ...patch }, changedAt: Date.now() } })),
      setWidth: (width) => set({ width }),
      hideComment: (id) => set(({ hiddenIds }) => ({ hiddenIds: [...hiddenIds, id] })),
      showComment: (id) => set(({ hiddenIds }) => ({ hiddenIds: hiddenIds.filter((hidden) => hidden !== id) })),
      setStartError: (startError) => set({ startError }),
    }),
    {
      name: 'margin.popupSheet',
      storage: createJSONStorage(() => localStorage),
      merge: (saved, current) => {
        const sheet = (saved as Partial<PopupState> | undefined)?.sheet;
        return { ...current, sheet: sheet && Date.now() - sheet.changedAt < SHEET_AGE ? sheet : null };
      },
      partialize: ({ sheet }) => ({
        sheet: sheet && {
          ...sheet,
          jira: sheet.jira.status === 'looking' ? { ...sheet.jira, status: 'typed' as const } : sheet.jira,
          figma: sheet.figma.status === 'looking' ? { ...sheet.figma, status: 'typed' as const } : sheet.figma,
        },
      }),
    },
  ),
);
