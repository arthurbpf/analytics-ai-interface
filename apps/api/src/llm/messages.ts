export type ToolCall = { id: string; name: string; arguments: string };

export type ModelMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };
