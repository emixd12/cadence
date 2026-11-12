/**
 * The strict output schema for one Daily Brief call. It has no imports, so the
 * hosted adapter and the browser-safe ChatGPT plan adapter (Ticket 296) share it.
 */
export const DAILY_BRIEF_SCHEMA_NAME = "cadence_daily_brief";

export const DAILY_BRIEF_SCHEMA = { type: "object", additionalProperties: false, required: ["text", "occurrenceRefs", "suggestions", "tip"], properties: {
  text: { type: "string" }, occurrenceRefs: { type: "array", items: { type: "string" } },
  suggestions: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["text", "occurrenceRefs", "referenceIds", "optionId"], properties: {
      text: { type: "string" }, occurrenceRefs: { type: "array", items: { type: "string" } },
      referenceIds: { type: "array", items: { type: "string" } }, optionId: { type: ["string", "null"] },
    } } },
  tip: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, required: ["findingId", "text", "noteRefs"], properties: {
    findingId: { type: "string" }, text: { type: "string" }, noteRefs: { type: "array", items: { type: "string" } },
  } }] },
} } as const;
