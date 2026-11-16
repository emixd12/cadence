/**
 * Phase 1B: synthetic provider replies for the AI SDK transports. No provider is called.
 * `responsesReply` is an OpenAI Responses API body (the default transport);
 * `gatewayReply` is an AI Gateway language-model body.
 */
export type SyntheticUsage = Readonly<{ input: number; cached: number; output: number; reasoning: number }>;

export function responsesReply(output: unknown, usage?: SyntheticUsage, extra: Record<string, unknown> = {}) {
  return { id: "resp_synthetic", created_at: 1, model: "gpt-5.6-luna", status: "completed",
    output: [{ type: "message", id: "msg_synthetic", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: typeof output === "string" ? output : JSON.stringify(output), annotations: [] }] }],
    ...(usage ? { usage: { input_tokens: usage.input, input_tokens_details: { cached_tokens: usage.cached },
      output_tokens: usage.output, output_tokens_details: { reasoning_tokens: usage.reasoning } } } : {}),
    ...extra };
}

export function gatewayReply(output: unknown, usage?: SyntheticUsage, finish = "stop") {
  return { content: [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }],
    finishReason: { unified: finish, raw: finish },
    usage: usage ? { inputTokens: { total: usage.input, noCache: usage.input - usage.cached, cacheRead: usage.cached, cacheWrite: 0 },
      outputTokens: { total: usage.output, text: usage.output - usage.reasoning, reasoning: usage.reasoning } }
      : { inputTokens: { total: undefined }, outputTokens: { total: undefined } },
    warnings: [] };
}

export const OPENAI_ENV = { OPENAI_API_KEY: "synthetic-key" } as const;
export const GATEWAY_ENV = { CADENCE_MODEL_TRANSPORT: "gateway", AI_GATEWAY_API_KEY: "synthetic-gateway-key" } as const;
