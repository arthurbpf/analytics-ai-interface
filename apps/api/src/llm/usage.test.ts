import { expect, it } from "vitest";
import { addUsage, emptyUsage, unknownUsage } from "./usage.ts";

it("aggregates cache reads and writes without treating absent measurements as zero", () => {
  const usage = emptyUsage();
  const call = {
    inputTokens: 5000,
    outputTokens: 10,
    cost: 0.01,
    cachedTokens: 4000,
    cacheWriteTokens: 500,
  };
  addUsage(usage, call);
  addUsage(usage, call);
  expect(usage).toMatchObject({ cachedTokens: 8000, cacheWriteTokens: 1000 });
  addUsage(usage, { inputTokens: 1, outputTokens: 1, cost: 0 });
  expect(usage).toMatchObject({ cachedTokens: null, cacheWriteTokens: null });
  addUsage(usage, call);
  expect(usage.cachedTokens).toBeNull();
  addUsage(usage, unknownUsage());
  expect(usage.inputTokens).toBeNull();
});
