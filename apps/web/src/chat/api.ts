import { initClient, type ClientInferRequest } from "@ts-rest/core";
import {
  apiErrorSchema,
  jsonContract,
  readEvents,
  turnContract,
  type SessionHistory,
  type StreamEvent,
} from "@analytics/contracts";

/**
 * Error carrying the API status and machine code from a failed request.
 */
export class ApiFailure extends Error {
  /**
   * Creates an API failure.
   *
   * @param status - HTTP status code returned by the API.
   * @param code - Stable machine-readable error code.
   * @param message - Human-readable message.
   */
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
/**
 * Builds an API failure from an error response body.
 *
 * @param status - HTTP status code returned by the API.
 * @param body - Parsed or raw response body carrying the error.
 * @returns An API failure preserving the status and machine code.
 */
function failure(status: number, body: unknown): ApiFailure {
  const error = apiErrorSchema.parse(body);
  return new ApiFailure(status, error.code, error.message);
}
/**
 * Reads an error body, falling back to a generic failure when it is not JSON.
 *
 * @param response - Failed fetch response.
 * @returns The parsed error body, or a generic API error object.
 */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { code: "request_failed", message: "Request could not complete." };
  }
}
export const client = initClient(jsonContract, {
  baseUrl: "",
  baseHeaders: {},
  validateResponse: true,
  throwOnUnknownStatus: true,
});
export const chatApi = {
  async identity(this: void) {
    const response = await client.identity({});
    if (response.status !== 200) {
      throw failure(response.status, response.body);
    }
    return response.body.identity;
  },
  async guest(this: void) {
    const response = await client.guest({});
    if (response.status !== 201) {
      throw failure(response.status, response.body);
    }
    return response.body;
  },
  async logout(this: void) {
    const response = await client.logout({});
    if (response.status !== 200) {
      throw failure(response.status, response.body);
    }
  },
  async listSessions(this: void) {
    const response = await client.listSessions({});
    if (response.status !== 200) {
      throw failure(response.status, response.body);
    }
    return response.body;
  },
  async createSession(this: void) {
    const response = await client.createSession({});
    if (response.status !== 201) {
      throw failure(response.status, response.body);
    }
    return response.body;
  },
  async history(this: void, id: string): Promise<SessionHistory> {
    const response = await client.history({ params: { id } });
    if (response.status !== 200) {
      throw failure(response.status, response.body);
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
      throw failure(response.status, await readErrorBody(response));
    }
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("Missing response stream. Reload saved history.");
    }
    yield* readEvents(response.body);
  },
};
export type ChatApi = typeof chatApi;
