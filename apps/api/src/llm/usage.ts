export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
}

export interface CallUsage extends ModelUsage {
  modelCalls: number;
}

export interface TurnUsage extends CallUsage {
  analyst?: CallUsage;
  reviewer?: CallUsage;
}

export function emptyUsage(): CallUsage {
  return { modelCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
}

export function addUsage(target: ModelUsage, source: ModelUsage) {
  for (const key of ["inputTokens", "outputTokens", "cost"] as const) {
    target[key] = target[key] === null || source[key] === null ? null : target[key] + source[key];
  }
}

export function unknownUsage(): ModelUsage {
  return { inputTokens: null, outputTokens: null, cost: null };
}
