import { expect, it, vi } from "vitest";
import {
  emptyPreferences,
  migrateLegacyPreference,
  readPreferences,
  storageKey,
  writePreferences,
} from "./chat-preferences.ts";
import { sessionId } from "../testing/chat-fixtures.ts";
it("stores only identity-scoped selection and sidebar preferences", () => {
  const preferences = { ...emptyPreferences, identityId: sessionId, selected: sessionId };
  expect(writePreferences(preferences)).toBeNull();
  expect(readPreferences().preferences).toEqual(preferences);
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
  expect(readPreferences().preferences).toEqual(emptyPreferences);
  expect(readPreferences().warning).toBeTruthy();
  localStorage.setItem(storageKey, "{");
  expect(readPreferences().preferences).toEqual(emptyPreferences);
});
it("reports unavailable storage without blocking conversations", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota");
  });
  expect(writePreferences(emptyPreferences)).toContain("unavailable");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Denied");
  });
  expect(readPreferences().warning).toContain("unavailable");
});
