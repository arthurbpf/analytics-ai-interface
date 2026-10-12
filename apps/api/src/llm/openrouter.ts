import { z } from "zod";
import { createParser } from "eventsource-parser";
import type { ModelMessage, ToolCall } from "./messages.ts";
import { limits } from "../config.ts";

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
const usageSchema = z.object({
  prompt_tokens: z.number().nonnegative(),
  completion_tokens: z.number().nonnegative(),
  cost: z.number().nonnegative().optional(),
});
const chunkSchema = z.object({
  choices: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        delta: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                index: z.number().int().min(0).max(7),
                id: z.string().optional(),
                function: z
                  .object({ name: z.string().optional(), arguments: z.string().optional() })
                  .optional(),
              }),
            )
            .optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .default([]),
  usage: usageSchema.optional(),
  error: z.object({ message: z.string() }).optional(),
});
export interface ToolCallUpdate {
  index: number;
  name: string;
  arguments: string;
}
export type OnToolCallUpdate = (update: ToolCallUpdate) => Promise<void>;
export interface ModelResponse {
  message: Extract<ModelMessage, { role: "assistant" }>;
  usage: { inputTokens: number | null; outputTokens: number | null; cost: number | null };
}
export interface ModelClient {
  complete(
    system: string,
    messages: ModelMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
    onToolCallUpdate?: OnToolCallUpdate,
  ): Promise<ModelResponse>;
}
export class OpenRouter implements ModelClient {
  private readonly apiKey: string;
  private readonly model: string;
  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }
  async complete(
    system: string,
    messages: ModelMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
    onToolCallUpdate?: OnToolCallUpdate,
  ): Promise<ModelResponse> {
    const body = {
      model: this.model,
      stream: true,
      max_tokens: limits.outputTokens,
      provider: { require_parameters: true },
      messages: [
        { role: "system", content: system },
        ...messages.map((message) => {
          switch (message.role) {
            case "user":
              return { role: "user", content: message.content };
            case "tool":
              return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
            case "assistant":
              return {
                role: "assistant",
                content: message.content,
                ...(message.toolCalls.length
                  ? {
                      tool_calls: message.toolCalls.map((call) => ({
                        id: call.id,
                        type: "function",
                        function: { name: call.name, arguments: call.arguments },
                      })),
                    }
                  : {}),
              };
          }
          throw new Error("Unsupported model message role");
        }),
      ],
      tools,
      tool_choice: "required",
    };
    if (Buffer.byteLength(JSON.stringify(body)) > limits.contextBytes) {
      throw new Error("Model request exceeds context budget");
    }
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`OpenRouter request failed (${response.status})`);
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("OpenRouter returned no event stream");
    }
    const calls = new Map<number, ToolCall>();
    let content = "";
    let usage: z.infer<typeof usageSchema> | undefined;
    let done = false;
    let finished = false;
    let outputBytes = 0;
    const frames: string[] = [];
    const parser = createParser({
      onEvent: (event) => {
        frames.push(event.data);
      },
    });
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    try {
      while (!done) {
        signal.throwIfAborted();
        const next = await reader.read();
        if (next.done) {
          throw new Error("OpenRouter stream ended before [DONE]");
        }
        // A bound on wire data also limits incomplete SSE frames and tool arguments.
        const rawBytes: unknown = next.value;
        const bytes = z.instanceof(Uint8Array).parse(rawBytes);
        outputBytes += bytes.byteLength;
        if (outputBytes > limits.contextBytes * 32) {
          throw new Error("Model response exceeds output budget");
        }
        parser.feed(decoder.decode(bytes, { stream: true }));
        for (const frame of frames.splice(0)) {
          if (frame === "[DONE]") {
            done = true;
            break;
          }
          const raw: unknown = JSON.parse(frame);
          const chunk = chunkSchema.parse(raw);
          if (chunk.error) {
            throw new Error(`OpenRouter stream failed: ${chunk.error.message}`);
          }
          if (chunk.usage) {
            usage = chunk.usage;
          }
          for (const choice of chunk.choices) {
            if (choice.index !== 0) {
              continue;
            }
            if (choice.finish_reason) {
              if (!["tool_calls", "stop"].includes(choice.finish_reason)) {
                throw new Error(`OpenRouter stopped: ${choice.finish_reason}`);
              }
              finished = true;
            }
            content += choice.delta.content ?? "";
            for (const delta of choice.delta.tool_calls ?? []) {
              const call = calls.get(delta.index) ?? { id: "", name: "", arguments: "" };
              call.id += delta.id ?? "";
              call.name += delta.function?.name ?? "";
              call.arguments += delta.function?.arguments ?? "";
              calls.set(delta.index, call);
              await onToolCallUpdate?.({
                index: delta.index,
                name: call.name,
                arguments: call.arguments,
              });
            }
          }
        }
        const assembledBytes =
          Buffer.byteLength(content) +
          [...calls.values()].reduce(
            (total, call) =>
              total + Buffer.byteLength(call.name) + Buffer.byteLength(call.arguments),
            0,
          );
        if (assembledBytes > limits.contextBytes) {
          throw new Error("Model response exceeds output budget");
        }
      }
      if (!finished) {
        throw new Error("OpenRouter returned no finished completion");
      }
      const toolCalls = [...calls]
        .toSorted(([left], [right]) => left - right)
        .map(([index, call], position) => {
          if (index !== position) {
            throw new Error("Incomplete tool call sequence");
          }
          if (!call.id || !call.name) {
            throw new Error("Incomplete tool call");
          }
          return call;
        });
      return {
        message: { role: "assistant", content: content || null, toolCalls },
        usage: {
          inputTokens: usage?.prompt_tokens ?? null,
          outputTokens: usage?.completion_tokens ?? null,
          cost: usage?.cost ?? null,
        },
      };
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
}
