import type { ContextEstimateInput } from "./types.js";

export function estimateContextTokens(input: ContextEstimateInput): number {
  return Math.ceil(JSON.stringify(input).length / 4);
}
