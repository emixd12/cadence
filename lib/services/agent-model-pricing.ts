// Advisor plan Phase 1A. List prices for the models the agents call, used to
// reserve spend before a call and to settle its actual cost after. Every
// price here must match docs/COSTS.md, with its source and check date there.
// An unknown model has no price, and the budget refuses to call it.

export type ModelPrice = Readonly<{
  /** US$ per million tokens. */
  input: number;
  cachedInput: number;
  output: number;
}>;

export type ModelUsage = Readonly<{
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
}>;

const PRICES: Readonly<Record<string, ModelPrice>> = {
  // OpenAI model page, checked November 11, 2026 (docs/COSTS.md, "Daily Brief model").
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
};

/** Accepts a bare model id or an AI Gateway "provider/model" string. */
export function modelPrice(model: string): ModelPrice | null {
  const bare = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  return PRICES[bare] ?? null;
}

/**
 * A ceiling for one call: every request character counted as a token (real
 * text averages about four characters per token) plus the full output cap.
 */
export function estimateCallMicrodollars(price: ModelPrice, input: Readonly<{ requestCharacters: number; maxOutputTokens: number }>): number {
  const micro = input.requestCharacters * price.input + input.maxOutputTokens * price.output;
  return Math.max(1, Math.ceil(micro));
}

/** Actual cost from reported usage, or null when the provider reported no counts. */
export function usageMicrodollars(price: ModelPrice, usage: ModelUsage): number | null {
  if (usage.inputTokens === null && usage.outputTokens === null) return null;
  const input = usage.inputTokens ?? 0;
  const cached = Math.min(usage.cachedInputTokens ?? 0, input);
  const micro = (input - cached) * price.input + cached * price.cachedInput + (usage.outputTokens ?? 0) * price.output;
  return Math.max(0, Math.ceil(micro));
}
