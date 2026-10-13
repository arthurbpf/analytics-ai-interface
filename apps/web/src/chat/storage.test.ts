import { expect, it, vi } from "vitest";
import {
  emptyIndex,
  migrateLegacyPreference,
  readIndex,
  remember,
  storageKey,
  writeIndex,
} from "./storage.ts";
import { history, sessionId } from "./test-fixtures.ts";
it("stores only identity-scoped selection and sidebar preferences", () => {
  const index = remember(
    { ...emptyIndex, identityId: sessionId, selected: sessionId },
    history().session,
  );
  expect(writeIndex(index)).toBeNull();
  expect(readIndex().index).toEqual({ ...index, sessions: [] });
  expect(localStorage.getItem(storageKey)).not.toContain("Revenue");
  expect(localStorage.getItem(storageKey)).not.toContain("sessions");
});
it("removes the legacy session cache during migration", () => {
  localStorage.setItem("analytics.sessions.v1", JSON.stringify({ sessions: [] }));
  migrateLegacyPreference();
  expect(localStorage.getItem("analytics.sessions.v1")).toBeNull();
});
it("resets invalid versions and corrupt JSON", () => {
  localStorage.setItem(storageKey, '{"version":9}');
  expect(readIndex().index).toEqual(emptyIndex);
  expect(readIndex().warning).toBeTruthy();
  localStorage.setItem(storageKey, "{");
  expect(readIndex().index).toEqual(emptyIndex);
});
it("reports unavailable storage without blocking conversations", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota");
  });
  expect(writeIndex(emptyIndex)).toContain("unavailable");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Denied");
  });
  expect(readIndex().warning).toContain("unavailable");
});
