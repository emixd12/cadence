// Advisor plan Phase 1A. List prices for the models the agents call, used to
// reserve spend before a call and to settle its actual cost after. Every
// price here must match docs/COSTS.md, with its source and check date there.
// An unknown model has no price, and the budget refuses to call it.

export type ModelPrice = Readonly<{
  /** US$ per million tokens. */
  input: number;
  cachedInput: number;
  /** Writing input to a prompt cache, when it bills above `input` (Anthropic: 1.25x for the 5-minute cache). */
  cacheWriteInput?: number;
  output: number;
}>;

export type ModelUsage = Readonly<{
  inputTokens: number | null;
  cachedInputTokens: number | null;
  /** Part of `inputTokens` written to a prompt cache. */
  cacheWriteTokens?: number | null;
  outputTokens: number | null;
}>;

const PRICES: Readonly<Record<string, ModelPrice>> = {
  // OpenAI model page, checked November 11, 2026 (docs/COSTS.md, "Daily Brief model").
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  // Eval candidates (Phase 1B). AI Gateway catalog, checked November 16, 2026
  // (docs/COSTS.md, "Agent model candidates"). Gateway and direct prices match.
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  // Haiku 5.5 doubles past 100k input tokens; a brief stays far below.
  // Anthropic bills a 5-minute cache write at 1.25x input.
  "claude-haiku-5.5": { input: 0.1, cachedInput: 0.01, cacheWriteInput: 0.125, output: 0.5 },
  "claude-sonnet-5.5": { input: 2, cachedInput: 0.1, cacheWriteInput: 2.5, output: 10 },
  "claude-opus-5.5": { input: 4, cachedInput: 0.2, cacheWriteInput: 5, output: 20 },
  "claude-fable-5.2": { input: 8, cachedInput: 0.2, cacheWriteInput: 10, output: 40 },
  // Chat eval candidates (Phase 5D). OpenRouter model list, checked November 19, 2026
  // (docs/COSTS.md, "Chat eval candidates"). The OpenAI two run direct at the same prices.
  "gpt-6.1-terra": { input: 1, cachedInput: 0.05, output: 5 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  // Reached through OpenRouter as "openrouter/<creator>/<model>".
  "deepseek/deepseek-v4.1-flash-1017": { input: 0.15, cachedInput: 0.003, output: 0.6 },
  "z-ai/glm-5.3-flash": { input: 0.15, cachedInput: 0.03, output: 0.5 },
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
  const micro = input.requestCharacters * Math.max(price.input, price.cacheWriteInput ?? 0) + input.maxOutputTokens * price.output;
  return Math.max(1, Math.ceil(micro));
}

/** Actual cost from reported usage, or null when the provider reported no counts. */
export function usageMicrodollars(price: ModelPrice, usage: ModelUsage): number | null {
  if (usage.inputTokens === null && usage.outputTokens === null) return null;
  const input = usage.inputTokens ?? 0;
  const cached = Math.min(usage.cachedInputTokens ?? 0, input);
  const written = Math.min(usage.cacheWriteTokens ?? 0, input - cached);
  const micro = (input - cached - written) * price.input + cached * price.cachedInput + written * (price.cacheWriteInput ?? price.input)
    + (usage.outputTokens ?? 0) * price.output;
  return Math.max(0, Math.ceil(micro));
}
