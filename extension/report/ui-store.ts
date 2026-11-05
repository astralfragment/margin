import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CommentStatus, Severity } from '@/lib/model';

export type SortOrder = 'severity' | 'number';

export type DialogName = 'edit' | 'options' | 'recheck' | 'jira' | 'figma' | 'newReview' | 'editReview' | 'deleteReview';

/** A marker whose note is being written, and where on screen it sits. */
export interface NoteTarget {
  commentId: string;
  index: number;
  /** True for a marker placed a moment ago, which is removed if it is left without a note. */
  fresh: boolean;
  x: number;
  y: number;
}

interface ReportUi {
  /** The review shown, or null for the one new comments go to. */
  reviewKey: string | null;
  search: string;
  severity: Severity | 'all';
  status: CommentStatus | 'all';
  sort: SortOrder;
  /** The comment highlighted in the sidebar. */
  currentId: string | null;
  dialog: DialogName | null;
  /** The comment open in the image editor. */
  editorId: string | null;
  note: NoteTarget | null;
}

const params = new URL(location.href).searchParams;

/** What the report was opened with: a review, a comment to scroll to, and whether a recheck just ran. */
export const opened = {
  review: params.get('group'),
  comment: params.get('comment'),
  verify: params.get('verify') === '1',
  created: params.get('created') === '1',
};

/** The report's own state. The sort order is kept per browser. */
export const useReportUi = create<ReportUi>()(
  persist(
    (): ReportUi => ({
      reviewKey: opened.review,
      search: '',
      severity: 'all',
      status: 'all',
      sort: 'severity',
      currentId: opened.comment,
      dialog: null,
      editorId: null,
      note: null,
    }),
    {
      name: 'margin.report',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ sort: state.sort }),
    },
  ),
);

/**
 * Opens one of the report's dialogs, closing any other.
 * @param dialog Which dialog.
 */
export const openDialog = (dialog: DialogName) => useReportUi.setState({ dialog });

/** Closes the open dialog. */
export const closeDialog = () => useReportUi.setState({ dialog: null });

/** Clears the search and both filters. */
export const clearFilters = () => useReportUi.setState({ search: '', severity: 'all', status: 'all' });

/**
 * Shows another review, or every review, and keeps the address in step so a reload lands on it.
 * @param reviewKey A review id, or all.
 */
export function showReview(reviewKey: string) {
  const url = new URL(location.href);
  url.search = `?group=${encodeURIComponent(reviewKey)}`;
  history.replaceState(null, '', url);
  useReportUi.setState({ reviewKey, currentId: null, severity: 'all', status: 'all', search: '' });
}
