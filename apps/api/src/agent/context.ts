import type { ModelMessage } from "../llm/messages.ts";
import type { AgentHistory } from "../db/history.ts";
import { limits } from "../config.ts";

export function buildContext(
  history: AgentHistory,
  activeTurnId: string,
  overhead: number,
): ModelMessage[] {
  const active = history.messages
    .filter((message) => message.turnId === activeTurnId && message.content.kind === "model")
    .flatMap((message) => (message.content.kind === "model" ? [message.content.message] : []));
  const groups: ModelMessage[][] = [];
  for (const turn of history.turns) {
    if (turn.id === activeTurnId || turn.status !== "completed") {
      continue;
    }
    const modelMessages: ModelMessage[] = [];
    for (const message of history.messages.filter((candidate) => candidate.turnId === turn.id)) {
      if (message.content.kind === "model") {
        modelMessages.push(message.content.message);
      }
      if (message.content.kind === "analysis" || message.content.kind === "clarification") {
        modelMessages.push({
          role: "assistant",
          content: JSON.stringify(
            message.content.kind === "analysis"
              ? message.content.analysis
              : message.content.clarification,
          ),
          toolCalls: [],
        });
      }
    }
    groups.push(modelMessages);
  }
  let messages = active;
  // Leave room for vendor envelope and JSON escaping of tool parameters.
  const ceiling = limits.contextBytes - overhead - 4096;
  if (Buffer.byteLength(JSON.stringify(messages)) > ceiling) {
    throw new Error("Active turn exceeds context budget. Start a new, narrower question.");
  }
  for (const group of groups.toReversed()) {
    const candidate = [...group, ...messages];
    if (Buffer.byteLength(JSON.stringify(candidate)) > ceiling) {
      break;
    }
    messages = candidate;
  }
  return messages;
}
