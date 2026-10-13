import { createStore } from "zustand/vanilla";
import {
  emptyPreferences,
  readPreferences,
  writePreferences,
  type ChatPreferences,
} from "./chat-preferences.ts";
import type { ActiveResponse } from "./stream-events.ts";

export interface ChatStoreState {
  preferences: ChatPreferences;
  selected: string | null;
  selectionRevision: number;
  responses: Record<string, ActiveResponse>;
  creating: boolean;
  error: string | null;
  warning: string | null;
  select: (id: string | null) => void;
  setSidebar: (open: boolean) => void;
}

/**
 * Creates identity-scoped client state, leaving saved server data in Query.
 *
 * @param identityId - Identity whose preferences may be restored.
 * @returns A store for live responses, selection, and preferences.
 */
export function createChatStore(identityId: string | null) {
  const saved = readPreferences();
  const preferences =
    saved.preferences.identityId === identityId
      ? saved.preferences
      : { ...emptyPreferences, identityId, sidebarOpen: saved.preferences.sidebarOpen };
  return createStore<ChatStoreState>()((set, get) => ({
    preferences,
    selected: null,
    selectionRevision: 0,
    responses: {},
    creating: false,
    error: null,
    warning: saved.warning,
    select: (id) => {
      const state = get();
      const next = { ...state.preferences, selected: id };
      const warning = identityId ? writePreferences(next) : null;
      set({
        selected: id,
        selectionRevision: state.selectionRevision + 1,
        preferences: next,
        error: null,
        ...(warning ? { warning } : {}),
      });
    },
    setSidebar: (sidebarOpen) => {
      const next = { ...get().preferences, sidebarOpen };
      const warning = writePreferences(next);
      set({ preferences: next, ...(warning ? { warning } : {}) });
    },
  }));
}

export type ChatStore = ReturnType<typeof createChatStore>;
