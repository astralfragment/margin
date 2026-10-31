import { create } from 'zustand';

export type Provider = 'jira' | 'figma';

/** Where a service row is in its sign-in or sign-out, apart from what storage says. */
export type RowState = {
  busy: null | 'asking' | 'waiting';
  /** A one-off line such as "sign-in stopped", shown until the next action. */
  message: string | null;
  /** True for a moment after the row changes under the pointer, so a double click does not undo it. */
  settling: boolean;
};

type Store = {
  rows: Record<Provider, RowState>;
  /** Counts sign-in attempts, so a late answer from an abandoned one is ignored. */
  attempts: Record<Provider, number>;
  /** The service just connected while a review sheet waits, for the return note. */
  connectedName: string | null;
  patch: (provider: Provider, patch: Partial<RowState>) => void;
  nextAttempt: (provider: Provider) => number;
  setConnectedName: (name: string) => void;
};

const idle: RowState = { busy: null, message: null, settling: false };

export const useSettingsStore = create<Store>((set, get) => ({
  rows: { jira: idle, figma: idle },
  attempts: { jira: 0, figma: 0 },
  connectedName: null,
  patch: (provider, patch) => set((state) => ({ rows: { ...state.rows, [provider]: { ...state.rows[provider], ...patch } } })),
  nextAttempt: (provider) => {
    const attempt = get().attempts[provider] + 1;
    set((state) => ({ attempts: { ...state.attempts, [provider]: attempt } }));
    return attempt;
  },
  setConnectedName: (connectedName) => set({ connectedName }),
}));
