import { expect, it, vi } from "vitest";
import { createChatStore } from "./chat-store.ts";
import { emptyPreferences, storageKey } from "./chat-preferences.ts";
import { draftId, sessionId } from "../testing/chat-fixtures.ts";

it("keeps saved selection separate from initial routing and scopes it to its owner", () => {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      ...emptyPreferences,
      identityId: draftId,
      selected: sessionId,
      sidebarOpen: false,
    }),
  );
  const own = createChatStore(draftId);
  const other = createChatStore(sessionId);
  expect(own.getState().selected).toBeNull();
  expect(own.getState().preferences.selected).toBe(sessionId);
  expect(other.getState().preferences.selected).toBeNull();
  expect(other.getState().preferences.sidebarOpen).toBe(false);
});

it("records every explicit selection so background creation cannot reclaim a new chat", () => {
  const store = createChatStore(draftId);
  store.getState().select(null);
  store.getState().select(null);
  expect(store.getState().selectionRevision).toBe(2);
  expect(JSON.parse(localStorage.getItem(storageKey) ?? "{}")).toMatchObject({
    identityId: draftId,
    selected: null,
  });
});

it("isolates provider stores and reports failed preference writes", () => {
  const first = createChatStore(draftId);
  const second = createChatStore(draftId);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota");
  });
  first.getState().setSidebar(false);
  expect(first.getState().preferences.sidebarOpen).toBe(false);
  expect(first.getState().warning).toContain("unavailable");
  expect(second.getState().preferences.sidebarOpen).toBe(true);
});
