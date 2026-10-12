import { initClient, type ClientInferRequest } from "@ts-rest/core";
import {
  apiErrorSchema,
  jsonContract,
  readEvents,
  turnContract,
  type SessionHistory,
  type StreamEvent,
} from "@analytics/contracts";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const client = initClient(jsonContract, {
  baseUrl: "",
  baseHeaders: {},
  validateResponse: true,
  throwOnUnknownStatus: true,
});
export const chatApi = {
  async createSession(this: void) {
    const response = await client.createSession({});
    if (response.status !== 201) {
      const error = apiErrorSchema.parse(response.body);
      throw new ApiFailure(response.status, error.code, error.message);
    }
    return response.body;
  },
  async history(this: void, id: string): Promise<SessionHistory> {
    const response = await client.history({ params: { id } });
    if (response.status !== 200) {
      const error = apiErrorSchema.parse(response.body);
      throw new ApiFailure(response.status, error.code, error.message);
    }
    return response.body;
  },
  async *turn(
    this: void,
    input: ClientInferRequest<typeof turnContract>,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const params = turnContract.pathParams.parse(input.params);
    const body = turnContract.body.parse(input.body);
    const response = await fetch(turnContract.path.replace(":id", encodeURIComponent(params.id)), {
      method: turnContract.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const raw: unknown = await response.json();
      const error = apiErrorSchema.parse(raw);
      throw new ApiFailure(response.status, error.code, error.message);
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("Missing response stream. Reload saved history.");
    }
    yield* readEvents(response.body);
  },
};
export type ChatApi = typeof chatApi;
