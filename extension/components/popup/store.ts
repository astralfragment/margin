import { create } from 'zustand';
import type { SheetMode } from './draft';
import type { Issue, LinkKind } from './model';

export type View = { name: 'home' } | { name: 'sheet'; mode: SheetMode; focus: 'name' | LinkKind } | { name: 'controls' };

/** A deleted comment kept in its row for Undo: where it sat in the stored list and in the review. */
export type Deleted = { issue: Issue; index: number; reviewIndex: number; raw: unknown; images: Record<string, unknown>; timer: number };

type PopupState = {
  /** The view picked here, or null before anything was picked, when a kept draft decides. */
  view: View | null;
  renaming: boolean;
  confirmingDelete: boolean;
  /** The comment width picked from a fold line, or null for the window's own. */
  width: number | null;
  alert: { title: string; text: string } | null;
  deleted: Record<string, Deleted>;
  show: (view: View) => void;
  setRenaming: (renaming: boolean) => void;
  setConfirmingDelete: (confirming: boolean) => void;
  setWidth: (width: number | null) => void;
  setAlert: (alert: PopupState['alert']) => void;
  keepDeleted: (deleted: Deleted) => void;
  forgetDeleted: (id: string) => void;
};

export const usePopup = create<PopupState>()((set) => ({
  view: null,
  renaming: false,
  confirmingDelete: false,
  width: null,
  alert: null,
  deleted: {},
  show: (view) => set({ view, renaming: false }),
  setRenaming: (renaming) => set({ renaming }),
  setConfirmingDelete: (confirmingDelete) => set({ confirmingDelete }),
  setWidth: (width) => set({ width }),
  setAlert: (alert) => set({ alert }),
  keepDeleted: (deleted) => set((state) => ({ deleted: { ...state.deleted, [deleted.issue.id]: deleted } })),
  forgetDeleted: (id) =>
    set((state) => {
      const deleted = { ...state.deleted };
      delete deleted[id];
      return { deleted };
    }),
}));
