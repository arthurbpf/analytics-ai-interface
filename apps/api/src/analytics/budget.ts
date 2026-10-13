import { ToolError } from "../errors.ts";
/**
 * Tracks per-query and per-turn BigQuery byte budgets for one turn.
 *
 * Reserves an estimate before each query and reconciles it with the bytes actually
 * billed, so warehouse spending stays within the configured caps.
 */
export class QueryBudget {
  remaining: bigint;
  private calls = 0;
  private readonly perQuery: bigint;
  private readonly maxCalls: number;

  /**
   * Creates a byte budget for a single turn.
   *
   * @param perQuery - Default byte cap applied to each query.
   * @param perTurn - Total bytes permitted across the turn.
   * @param maxCalls - Maximum number of SQL submissions allowed.
   */
  constructor(perQuery: bigint, perTurn: bigint, maxCalls: number) {
    this.perQuery = perQuery;
    this.maxCalls = maxCalls;
    this.remaining = perTurn;
  }

  /**
   * Reserves bytes for a query before it is executed.
   *
   * @param estimate - Dry-run byte estimate for the query.
   * @param perQuery - Optional cap overriding the budget default for this query.
   * @returns The byte cap reserved for this query.
   */
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

  /**
   * Reconciles a reservation with the bytes the warehouse actually billed.
   *
   * @param reserved - Bytes reserved by `reserve` for this query.
   * @param billed - Actual bytes billed by BigQuery.
   */
  settle(reserved: bigint, billed: bigint) {
    if (billed < 0n || billed > reserved) {
      throw new ToolError("Invalid warehouse billing metadata");
    }
    this.remaining += reserved - billed;
  }
}
