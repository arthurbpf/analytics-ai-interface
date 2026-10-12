import { ToolError } from "../errors.ts";
export class QueryBudget {
  remaining: bigint;
  private calls = 0;
  private readonly perQuery: bigint;
  private readonly maxCalls: number;
  constructor(perQuery: bigint, perTurn: bigint, maxCalls: number) {
    this.perQuery = perQuery;
    this.maxCalls = maxCalls;
    this.remaining = perTurn;
  }
  reserve(estimate: bigint, perQuery = this.perQuery): bigint {
    const cap = this.remaining < perQuery ? this.remaining : perQuery;
    if (this.calls >= this.maxCalls) {
      throw new ToolError("SQL submission budget exhausted. Present findings already obtained.");
    }
    if (cap <= 0n || estimate > cap) {
      throw new ToolError(
        `Query estimates ${estimate} bytes; allowed ${cap}. Narrow dates or selected columns.`,
      );
    }
    this.calls++;
    this.remaining -= cap;
    return cap;
  }
  settle(reserved: bigint, billed: bigint) {
    if (billed < 0n || billed > reserved) {
      throw new ToolError("Invalid warehouse billing metadata");
    }
    this.remaining += reserved - billed;
  }
}
