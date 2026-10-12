import type { MessageContent, SessionHistory } from "@analytics/contracts";
import type { ModelMessage } from "../llm/messages.ts";

// Stored protocol exchanges remain intact for follow-up model calls.
export type StoredMessageContent =
  | { kind: "model"; message: ModelMessage }
  | Exclude<MessageContent, { kind: "user" }>;

export type AgentHistory = Omit<SessionHistory, "messages"> & {
  messages: { id: string; turnId: string; content: StoredMessageContent }[];
};

export function displayHistory(history: AgentHistory): SessionHistory {
  return {
    ...history,
    messages: history.messages.flatMap<SessionHistory["messages"][number]>((message) => {
      if (message.content.kind !== "model") {
        return [{ ...message, content: message.content }];
      }
      if (message.content.message.role === "user") {
        return [{ ...message, content: { kind: "user", text: message.content.message.content } }];
      }
      return [];
    }),
  };
}
