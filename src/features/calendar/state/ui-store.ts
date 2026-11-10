import { create } from 'zustand';
import type { Scope } from '@/shared/contracts';
import type { Civil } from '@/shared/zoned';

/** A pointer or keyboard drag in progress. Lives in the store so only the block and the ghost re-render. */
export type DragState = {
  mode: 'create' | 'move' | 'resize';
  /** Occurrence being moved/resized; absent while creating. */
  key: string | null;
  /** Where the preview currently is: a column, a day, and snapped minutes. */
  columnId: string;
  date: Civil;
  startMin: number;
  endMin: number;
  /** Move target room (day view only). */
  roomId: string | null;
  /** True while the user moves it with the keyboard (picked up with Space). */
  kbd?: boolean;
};

export type PanelState =
  | { kind: 'create'; date: Civil; startMin: number; endMin: number; roomId: string | null }
  | { kind: 'edit'; key: string }
  | null;

/** The keyboard cursor: which slot has focus when navigating the grid with the arrow keys. */
export type Cursor = { columnIndex: number; minutes: number } | null;

export type ScopePrompt = {
  kind: 'edit' | 'delete';
  title: string;
  /** 'all' is not offered when the change cannot apply to the whole series. */ allowAll: boolean;
  resolve: (scope: Scope | null) => void;
};

export type Toast = {
  id: number;
  kind: 'error' | 'info';
  code: string;
  params: Record<string, string | number>;
};

type UiState = {
  selectedKey: string | null;
  drag: DragState | null;
  panel: PanelState;
  cursor: Cursor;
  /** Text for the screen-reader live region. */
  announcement: string;
  toasts: Toast[];
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  scopePrompt: ScopePrompt | null;
  /** Asks "only this / this and following / all"; resolves to null if the user cancels. */
  askScope: (prompt: Omit<ScopePrompt, 'resolve'>) => Promise<Scope | null>;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  select: (key: string | null) => void;
  setDrag: (drag: DragState | null) => void;
  openPanel: (panel: PanelState) => void;
  setCursor: (cursor: Cursor) => void;
  announce: (text: string) => void;
};

let toastSeq = 0;
const ZERO_WIDTH = String.fromCharCode(0x200b);

export const useUi = create<UiState>()((set) => ({
  selectedKey: null,
  drag: null,
  panel: null,
  cursor: null,
  announcement: '',
  toasts: [],
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  scopePrompt: null,
  askScope: (prompt) =>
    new Promise((resolve) =>
      set({
        scopePrompt: {
          ...prompt,
          resolve: (scope) => {
            set({ scopePrompt: null });
            resolve(scope);
          },
        },
      }),
    ),
  pushToast: (toast) =>
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id: ++toastSeq }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  select: (selectedKey) => set({ selectedKey }),
  setDrag: (drag) => set({ drag }),
  openPanel: (panel) => set({ panel }),
  setCursor: (cursor) => set({ cursor }),
  // The same text twice in a row must still be announced: toggle a trailing zero-width marker.
  announce: (text) =>
    set((s) => ({ announcement: s.announcement === text ? text + ZERO_WIDTH : text })),
}));
