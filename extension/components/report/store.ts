import { create } from 'zustand';
import type { Anchor } from './point-menu';
import type { MenuKind } from './preview/preview';
import type { SheetMode } from './review-sheet/review-sheet-dialog';
import type { SortOrder, VerifyRun } from './types';
import { readPref, writePref } from './util';

const SORT_KEY = 'margin.reportSort';

export type Filters = { term: string; severity: string; status: string };
export type Dialog = 'export' | 'edit' | 'jira' | 'figma' | 'controls' | null;
export type NoteAsk = { issueId: string; index: number; at: { x: number; y: number }; fresh: boolean; note: string };
export type CardMenu = { index: number; kind: MenuKind; chip: HTMLElement; at: Anchor };

export const NO_FILTERS: Filters = { term: '', severity: 'all', status: 'all' };

/**
 * The recheck flow: closed, explaining there is no page to capture, a run started at startedAt, a finished run
 * to review, or resuming the run the popup started (?verify=1).
 */
export type Recheck = { mode: 'closed' | 'noTab' | 'running' | 'review' | 'resume'; startedAt: number; total: number; run?: VerifyRun };
export const CLOSED_RECHECK: Recheck = { mode: 'closed', startedAt: 0, total: 0 };

/** The popup opens the report with ?verify=1 to show the run it started. The flag is read once and dropped. */
function resumeFromAddress(): Recheck {
  const opened = new URL(location.href);
  if (!opened.searchParams.get('verify')) return CLOSED_RECHECK;
  opened.searchParams.delete('verify');
  history.replaceState(null, '', opened);
  return { mode: 'resume', startedAt: Date.now(), total: 0 };
}

type ReportUi = {
  filters: Filters;
  sortOrder: SortOrder;
  /** The comment at the top of the preview, by its place in the listed order. */
  current: number;
  sidebarOpen: boolean;
  /** The comment open in the image editor on the page, not the one inside Edit comments. */
  editingId: string | null;
  noteAsk: NoteAsk | null;
  cardMenu: CardMenu | null;
  sheet: SheetMode | null;
  dialog: Dialog;
  touring: boolean;
  previewReady: boolean;
  recheck: Recheck;
  setFilters: (patch: Partial<Filters>) => void;
  setSortOrder: (order: SortOrder) => void;
  set: (patch: Partial<Omit<ReportUi, 'set' | 'setFilters' | 'setSortOrder'>>) => void;
};

/** What the report screen's parts share: filters, sort, the comment in view, and which dialog or menu is open. */
export const useReportUi = create<ReportUi>((set) => ({
  filters: NO_FILTERS,
  sortOrder: readPref(SORT_KEY) === 'number' ? 'number' : 'severity',
  current: 0,
  sidebarOpen: false,
  editingId: null,
  noteAsk: null,
  cardMenu: null,
  sheet: null,
  dialog: null,
  touring: false,
  previewReady: false,
  recheck: resumeFromAddress(),
  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),
  setSortOrder: (sortOrder) => {
    writePref(SORT_KEY, sortOrder);
    set({ sortOrder });
  },
  set,
}));
