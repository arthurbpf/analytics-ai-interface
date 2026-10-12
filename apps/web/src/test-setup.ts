// oxlint-disable-next-line import/no-unassigned-import -- Registers DOM assertions with Vitest.
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
