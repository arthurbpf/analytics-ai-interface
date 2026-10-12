import { expect, it, vi } from "vitest";
import { emptyIndex, readIndex, remember, storageKey, writeIndex } from "./storage.ts";
import { sessionId, timestamp } from "./test-fixtures.ts";
it("roundtrips the versioned index without transcripts or chart data", () => {
  const index = remember(
    { ...emptyIndex, selected: sessionId },
    { id: sessionId, label: "Revenue", updatedAt: timestamp },
  );
  expect(writeIndex(index)).toBeNull();
  expect(readIndex().index).toEqual(index);
  expect(localStorage.getItem(storageKey)).not.toContain("rows");
});
it("resets invalid versions and corrupt JSON", () => {
  localStorage.setItem(storageKey, '{"version":9}');
  expect(readIndex().index).toEqual(emptyIndex);
  expect(readIndex().warning).toBeTruthy();
  localStorage.setItem(storageKey, "{");
  expect(readIndex().index).toEqual(emptyIndex);
});
it("reports unavailable storage without preventing a conversation", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota");
  });
  expect(writeIndex(emptyIndex)).toContain("unavailable");
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Denied");
  });
  expect(readIndex().warning).toContain("unavailable");
});
