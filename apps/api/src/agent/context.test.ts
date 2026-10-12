import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { buildContext } from "./context.ts";
import { memoryStore, turnId } from "../../tests/fixtures/analysis.ts";
import { limits } from "../config.ts";
it("removes old complete turns without breaking active tool exchanges", () => {
  const { history } = memoryStore(); const oldId = randomUUID();
  history.turns.unshift({ id: oldId, clientTurnId: randomUUID(), status: "completed", createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(), error: null });
  history.messages.unshift({ id: randomUUID(), turnId: oldId, content: { kind: "model", message: { role: "user", content: "x".repeat(limits.contextBytes) } } });
  history.messages.push({ id: randomUUID(), turnId, content: { kind: "model", message: { role: "assistant", content: null, toolCalls: [{ id: "call-1", name: "get_schema", arguments: "{}" }] } } });
  history.messages.push({ id: randomUUID(), turnId, content: { kind: "model", message: { role: "tool", toolCallId: "call-1", content: "{}" } } });
  const context = buildContext(history, turnId, 1000);
  expect(context).toHaveLength(3); expect(context.at(-1)?.role).toBe("tool");
});
it("fails honestly rather than slicing oversized active messages", () => {
  const { history } = memoryStore(); history.messages.push({ id: randomUUID(), turnId, content: { kind: "model", message: { role: "user", content: "x".repeat(limits.contextBytes) } } });
  expect(() => buildContext(history, turnId, 1000)).toThrow("context budget");
});
