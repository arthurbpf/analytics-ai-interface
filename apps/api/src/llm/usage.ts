export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  cachedTokens?: number | null;
  cacheWriteTokens?: number | null;
}

export interface CallUsage extends ModelUsage {
  modelCalls: number;
}

export interface TurnUsage extends CallUsage {
  analyst?: CallUsage;
  reviewer?: CallUsage;
}

/**
 * Creates a zeroed usage record for a single call.
 *
 * @returns Usage with no calls and zero tokens and cost.
 */
export function emptyUsage(): CallUsage {
  return {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
  };
}

/**
 * Adds a call's usage onto an accumulator in place.
 *
 * A null component in either operand makes the sum null, preserving "unknown" rather
 * than treating an unmeasured value as zero.
 *
 * @param target - Accumulator mutated to include the source.
 * @param source - Usage to add.
 */
export function addUsage(target: ModelUsage, source: ModelUsage) {
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cost",
    "cachedTokens",
    "cacheWriteTokens",
  ] as const) {
    const left = target[key] ?? null;
    const right = source[key] ?? null;
    target[key] = left === null || right === null ? null : left + right;
  }
}

/**
 * Creates a usage record for a call whose quantities could not be observed.
 *
 * @returns Usage with null token and cost fields.
 */
export function unknownUsage(): ModelUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    cost: null,
    cachedTokens: null,
    cacheWriteTokens: null,
  };
}
