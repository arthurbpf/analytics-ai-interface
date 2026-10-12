import { z } from "zod";
import type { ModelMessage } from "./messages.ts";
import { limits } from "../config.ts";

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .default([]),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().nonnegative().default(0),
      completion_tokens: z.number().nonnegative().default(0),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});
export interface ModelResponse {
  message: Extract<ModelMessage, { role: "assistant" }>;
  usage: { inputTokens: number; outputTokens: number; cost: number | null };
}
export interface ModelClient {
  complete(
    system: string,
    messages: ModelMessage[],
    tools: ToolDefinition[],
    signal: AbortSignal,
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
  ): Promise<ModelResponse> {
    const body = {
      model: this.model,
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
    const raw: unknown = await response.json();
    const parsed = responseSchema.parse(raw);
    const first = parsed.choices[0];
    if (!first) {
      throw new Error("OpenRouter returned no completion");
    }
    return {
      message: {
        role: "assistant",
        content: first.message.content ?? null,
        toolCalls: first.message.tool_calls.map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })),
      },
      usage: {
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
        cost: parsed.usage?.cost ?? null,
      },
    };
  }
}
