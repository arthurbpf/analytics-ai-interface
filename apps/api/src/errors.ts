/**
 * Error thrown when a tool request is invalid in a way the model can repair.
 *
 * The agent loop feeds the message back to the model instead of aborting the turn.
 */
export class ToolError extends Error {
  override name = "ToolError";
}
