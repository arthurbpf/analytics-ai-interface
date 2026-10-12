import type { MessageContent, SessionHistory, PublishedChart } from "@analytics/contracts";
import type { ModelMessage } from "../llm/messages.ts";
import type { ReviewRecord } from "../agent/review.ts";

// Stored protocol exchanges remain intact for follow-up model calls.
export type StoredMessageContent =
  | { kind: "model"; message: ModelMessage }
  | { kind: "chart_candidate"; chart: PublishedChart }
  | { kind: "review"; review: ReviewRecord }
  | Exclude<MessageContent, { kind: "user" }>;

export type AgentHistory = Omit<SessionHistory, "messages"> & {
  messages: { id: string; turnId: string; content: StoredMessageContent }[];
};

export function displayHistory(history: AgentHistory): SessionHistory {
  return {
    ...history,
    messages: history.messages.flatMap<SessionHistory["messages"][number]>((message) => {
      if (message.content.kind === "chart_candidate" || message.content.kind === "review") {
        return [];
      }
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
