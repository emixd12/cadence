/**
 * `show_day`: the read tool behind the "Cadence day" view (Ticket 376, D36).
 *
 * It is a transport tool, outside the contract registry during the trial, so Cadence Chat
 * (which builds its tools from the registry) never lists or runs it. The schema is frozen
 * in `docs/qa/2026-11-26-mcp-apps-spike.md`; `tests/mcp-apps-show-day.test.ts` compares
 * these schemas with that note. This module holds the wire shape only. The day itself
 * comes from `getIntegrationDay` in the service layer.
 */
import type { Tool } from "@modelcontextprotocol/server";
import {
  array, boolean, createIntegrationError, freshnessOutput, integer, invalidInputError, localDate, nullable, object,
  occurrenceShape, optional, parentGroupOutput, root, string, timezone, validateAgainstSchema, INTEGRATION_LIMITS, INTEGRATION_SCOPE_LIST,
  type Infer, type IntegrationError, type JsonSchemaObject,
} from "@cadence/core/integration";
import type { IntegrationContext } from "@/lib/integrations/request-context";
import { getIntegrationDay, type IntegrationDay } from "@/lib/services/integration-day.service";
import { IntegrationReadError } from "@/lib/services/integration-read.service";
import { admitTransportRead, recordTransportRead } from "@/lib/integrations/transport-read";
import { DAY_VIEW_URI, GRANTED_SCOPES_META_KEY, MCP_APPS_READ_LABELS, SHOW_DAY_TOOL_NAME } from "./config";

const showDayInput = root(object({
  date: optional(localDate("Day to show. Defaults to today in the account timezone.")),
}));

const connectorCompletion = object({
  source: string({ description: "Stable id of the connected service, for example `hevy`." }),
  source_label: string({ description: "Display name of the connected service, for example `Hevy`." }),
});

const showDayOccurrence = object({
  ...occurrenceShape,
  alongside: optional(nullable(boolean(), { description: "The Behavior's alongside setting. Present only in the alongside contract edition." })),
  connector_completion: nullable(connectorCompletion, {
    description: "Server-computed. Null when the person set the status, or when the Occurrence is not Completed.",
  }),
}, { description: "An Occurrence as get_timeline returns it, plus `connector_completion`." });

const showDayOutput = root(object({
  local_date: localDate("The day shown."),
  is_today: boolean(),
  timezone: timezone(),
  today_local_date: localDate(),
  day_note: nullable(string({ description: "The person's day note for this date, or null." })),
  occurrences: array(showDayOccurrence, { description: "Every Occurrence of the day, sub-behavior Occurrences included." }),
  parent_groups: array(parentGroupOutput, { description: "The day's parent Behavior slots. Their Occurrences also appear in `occurrences`." }),
  needs_decision: object({
    count: integer({ minimum: 0, description: "Unresolved Occurrences before today, within the lookback window. A count only." }),
    truncated: boolean({ description: "True when more exist than the count states." }),
  }),
  freshness: freshnessOutput,
}));

export type ShowDayOutput = Infer<typeof showDayOutput>;
export const SHOW_DAY_INPUT_SCHEMA: JsonSchemaObject = showDayInput.schema;
export const SHOW_DAY_OUTPUT_SCHEMA: JsonSchemaObject = showDayOutput.schema;

/** The descriptor `tools/list` appends after the registry while `CADENCE_MCP_APPS` is on. */
export function showDayTool(): Tool {
  const securitySchemes = [{ type: "oauth2", scopes: ["cadence.read"] }];
  return {
    name: SHOW_DAY_TOOL_NAME,
    title: "Show day",
    description:
      "Shows one day in Cadence as an interactive view: that day's Occurrences with Completed, Not Completed and Note, parent Behavior slots, the day note, and how many earlier items need a decision. Defaults to today. Clients without views get the same data as JSON. Use get_timeline for several days or for the Needs decision list.",
    inputSchema: { ...SHOW_DAY_INPUT_SCHEMA, type: "object" },
    outputSchema: { ...SHOW_DAY_OUTPUT_SCHEMA, type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    securitySchemes,
    _meta: { securitySchemes, ui: { resourceUri: DAY_VIEW_URI } },
  } as Tool;
}

export type ShowDayResult =
  | { ok: true; value: ShowDayOutput; meta: Record<string, unknown> }
  | { ok: false; error: IntegrationError };

const readFailed = () => createIntegrationError("internal_error", "Cadence could not read tracking data. Retry the request.");

/** Reads and validates the day. Every failure becomes one of the tool's five error codes. */
async function readDay(context: IntegrationContext, rawInput: unknown): Promise<{ value: ShowDayOutput } | { error: IntegrationError }> {
  const input = validateAgainstSchema<Infer<typeof showDayInput>>(SHOW_DAY_INPUT_SCHEMA, rawInput ?? {});
  if (!input.ok) return { error: invalidInputError(input.issues) };
  let day: IntegrationDay;
  try {
    day = await getIntegrationDay(context, input.value);
  } catch (error) {
    // The service's own codes pass through only when the tool declares them.
    const code = error instanceof IntegrationReadError ? error.error.code : null;
    return { error: code === "service_unavailable" || code === "invalid_input" ? (error as IntegrationReadError).error : readFailed() };
  }
  // The schema closes every object, so a field outside the projection fails here and is never returned.
  const checked = validateAgainstSchema<ShowDayOutput>(SHOW_DAY_OUTPUT_SCHEMA, day);
  if (!checked.ok) {
    return { error: createIntegrationError("internal_error", "Cadence produced a result that does not match the tool's output schema.") };
  }
  if (Buffer.byteLength(JSON.stringify(checked.value), "utf8") > INTEGRATION_LIMITS.maxResponseBytes) {
    return { error: createIntegrationError("internal_error", "This day is too large to show. Use list_occurrences with a page size.") };
  }
  return { value: checked.value };
}

/**
 * Runs `show_day` for a verified grant. Admission and the activity row follow the rules
 * of a registry read tool (`lib/integrations/transport-read.ts`).
 */
export async function showDay(context: IntegrationContext, rawInput: unknown): Promise<ShowDayResult> {
  const refused = await admitTransportRead(context, MCP_APPS_READ_LABELS.showDay);
  if (refused) return { ok: false, error: refused };
  const read = await readDay(context, rawInput);
  const error = "error" in read ? read.error : null;
  const unrecorded = await recordTransportRead(context, MCP_APPS_READ_LABELS.showDay, error);
  if (unrecorded) return { ok: false, error: unrecorded };
  if ("error" in read) return { ok: false, error: read.error };
  return { ok: true, value: read.value, meta: {
    // Tracking scopes only, in consent order. The view reads them; the model's context does not carry them.
    [GRANTED_SCOPES_META_KEY]: INTEGRATION_SCOPE_LIST.filter((scope) => context.actor.grantedScopes.includes(scope)),
  } };
}
