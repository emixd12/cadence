import type { DailyBriefGenerator } from "./daily-brief-consumer";
import { DailyBriefError } from "./daily-brief-consumer";

export const DAILY_BRIEF_MODEL = "gpt-5.6-luna";

/** Server-only adapter. Do not log request/response bodies or persist response IDs. */
export async function generateOpenAIDailyBrief(
  input: Parameters<DailyBriefGenerator>[0],
  options: Readonly<{ apiKey: string; fetch?: typeof fetch }>,
): Promise<unknown> {
  if (!options.apiKey) throw new DailyBriefError("not_configured");
  const response = await (options.fetch ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST", redirect: "error", cache: "no-store", signal: input.signal,
    headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DAILY_BRIEF_MODEL, store: false, background: false, tools: [], tool_choice: "none",
      reasoning: { effort: "low" }, max_output_tokens: 2_000,
      instructions: input.instructions, input: input.facts,
      text: { format: { type: "json_schema", name: "cadence_daily_brief", strict: true,
        schema: { type: "object", additionalProperties: false, required: ["text", "occurrenceRefs", "suggestions", "tip"], properties: {
          text: { type: "string" }, occurrenceRefs: { type: "array", items: { type: "string" } },
          suggestions: { type: "array", items: { type: "object", additionalProperties: false,
            required: ["text", "occurrenceRefs", "referenceIds", "optionId"], properties: {
              text: { type: "string" }, occurrenceRefs: { type: "array", items: { type: "string" } },
              referenceIds: { type: "array", items: { type: "string" } }, optionId: { type: ["string", "null"] },
            } } },
          tip: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["findingId", "text", "noteRefs"], properties: {
            findingId: { type: "string" }, text: { type: "string" }, noteRefs: { type: "array", items: { type: "string" } },
          } }] },
        } },
      } },
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new DailyBriefError(response.status === 429 ? "rate_limited" : "advisor_unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new DailyBriefError("advisor_unavailable");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let body: unknown;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64 * 1024) throw new DailyBriefError("advisor_unavailable");
      chunks.push(value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel(); }
  if (!record(body) || body.status !== "completed" || !Array.isArray(body.output)) throw new DailyBriefError("advisor_unavailable");
  const texts: string[] = [];
  for (const item of body.output) {
    if (!record(item)) throw new DailyBriefError("advisor_unavailable");
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant" || item.status !== "completed" || !Array.isArray(item.content)) throw new DailyBriefError("advisor_unavailable");
    for (const part of item.content) {
      if (!record(part) || part.type !== "output_text" || typeof part.text !== "string") throw new DailyBriefError("advisor_unavailable");
      texts.push(part.text);
    }
  }
  if (texts.length !== 1) throw new DailyBriefError("advisor_unavailable");
  try { return JSON.parse(texts[0]); }
  catch { throw new DailyBriefError("advisor_unavailable"); }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
