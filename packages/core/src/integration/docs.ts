/**
 * Renders the generated reference sections of `docs/MCP_CONTRACT.md` from the
 * registry. A test compares the rendered text with the committed doc, so the
 * doc fails the build when it drifts from the contract.
 */
import { INTEGRATION_EXCLUDED_DATA, INTEGRATION_INCLUDED_DATA } from "./data-policy";
import { INTEGRATION_ERRORS } from "./errors";
import { INTEGRATION_LIMITS, INTEGRATION_REMINDER_OFFSETS } from "./limits";
import { INTEGRATION_OPERATIONS, INTEGRATION_OPERATION_NAMES, type IntegrationOperation } from "./operations";
import type { JsonSchemaObject, JsonSchemaValue } from "./schema";
import { INTEGRATION_SCOPE_DEFINITIONS } from "./scopes";
import {
  INTEGRATION_COMPATIBILITY_NOTES,
  INTEGRATION_COMPATIBILITY_POLICY,
  INTEGRATION_CONTRACT_VERSION,
} from "./version";

export const CONTRACT_DOC_BEGIN_MARKER = "<!-- BEGIN GENERATED: integration contract reference. Do not edit by hand. -->";
export const CONTRACT_DOC_END_MARKER = "<!-- END GENERATED: integration contract reference -->";

const LIMIT_LABELS: Record<keyof typeof INTEGRATION_LIMITS, string> = {
  defaultPageSize: "Default page size",
  maxPageSize: "Maximum page size",
  maxOccurrenceRangeDays: "`list_occurrences` maximum date range (days, inclusive)",
  maxAdherenceRangeDays: "`get_adherence_summary` maximum date range (days, inclusive)",
  maxTimelineDays: "`get_timeline` maximum days",
  needsDecisionLookbackDays: "Needs decision lookback (days)",
  maxNeedsDecisionItems: "Needs decision items returned",
  maxBehaviorFilterIds: "Behavior ids per filter",
  maxSearchQueryLength: "Search query length (characters)",
  maxSearchResults: "Search results",
  maxBehaviorTitleLength: "Behavior title length",
  maxBehaviorDescriptionLength: "Behavior description length",
  maxLocationTextLength: "Location text length",
  maxSchedulesPerBehavior: "Schedules per Behavior",
  maxTimeEntriesPerSchedule: "Time entries per schedule",
  maxRecurrenceInterval: "Recurrence interval (input)",
  maxDefaultDurationMinutes: "Default duration (minutes)",
  maxOccurrenceNoteLength: "Occurrence note length",
  maxArchiveNoteLength: "Archive note length",
  maxCursorLength: "Cursor length",
  maxRevisionLength: "Revision length",
  minIdempotencyKeyLength: "Idempotency key minimum length",
  maxIdempotencyKeyLength: "Idempotency key maximum length",
  maxExternalRefLength: "External reference length",
  idempotencyWindowSeconds: "Idempotent replay window (seconds)",
  maxResponseBytes: "Maximum result size (UTF-8 bytes)",
};

function cell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function code(text: string): string {
  // GFM tables consume escapes before code spans; HTML keeps literal backslashes.
  if (text.includes("\\")) return `<code>${Array.from(text, (character) => `&#${character.codePointAt(0)};`).join("")}</code>`;
  return `\`${text}\``;
}

function schemaType(schema: JsonSchemaValue | undefined): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return "value";
  const value = schema as JsonSchemaObject;
  if (value.const !== undefined) return code(JSON.stringify(value.const));
  if (Array.isArray(value.oneOf)) return "one of several shapes";
  if (Array.isArray(value.anyOf)) {
    return value.anyOf.map((branch) => schemaType(branch)).join(" or ");
  }
  const types = Array.isArray(value.type) ? (value.type as string[]) : [String(value.type ?? "value")];
  const base = types.map((type) => {
    if (type === "array") return `array of ${schemaType(value.items)}`;
    if (type === "string" && typeof value.format === "string") return `string (${value.format})`;
    if (Array.isArray(value.enum)) return value.enum.filter((option) => option !== null).map((option) => code(String(option))).join(", ");
    return type;
  });
  return [...new Set(base)].join(" or ");
}

function fieldTable(schema: JsonSchemaObject): string[] {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchemaObject>;
  const required = new Set((schema.required ?? []) as string[]);
  const names = Object.keys(properties);
  if (!names.length) return ["No fields."];
  return [
    "| Field | Required | Type |",
    "|---|---|---|",
    ...names.map((name) => `| \`${name}\` | ${yesNo(required.has(name))} | ${cell(schemaType(properties[name]))} |`),
  ];
}

function renderOperation(operation: IntegrationOperation): string[] {
  const annotations = operation.annotations;
  const lines = [
    `### \`${operation.name}\``,
    "",
    `**${operation.title}.** ${operation.description}`,
    "",
    `- Scope: \`${operation.scope}\``,
    `- Annotations: readOnlyHint ${annotations.readOnlyHint}, destructiveHint ${annotations.destructiveHint}, idempotentHint ${annotations.idempotentHint}, openWorldHint ${annotations.openWorldHint}`,
    `- Annotation rationale: ${operation.annotationRationale}`,
    `- Errors: ${operation.errors.map((code) => `\`${code}\``).join(", ")}`,
    `- Since: ${operation.since}`,
    "",
    "Input:",
    "",
    ...fieldTable(operation.input.schema),
  ];
  if (Array.isArray(operation.input.schema.anyOf)) {
    const keys = (operation.input.schema.anyOf as JsonSchemaObject[]).flatMap((branch) => branch.required as string[]);
    lines.push("", `At least one of ${keys.map((key) => `\`${key}\``).join(", ")} is required.`);
  }
  lines.push("", "Output:", "", ...fieldTable(operation.output.schema), "");
  return lines;
}

/** Returns the generated reference, including the begin and end markers. */
export function renderIntegrationContractReference(): string {
  const operations = INTEGRATION_OPERATION_NAMES.map((name) => INTEGRATION_OPERATIONS[name] as IntegrationOperation);
  const lines: string[] = [
    CONTRACT_DOC_BEGIN_MARKER,
    "",
    `Contract version: \`${INTEGRATION_CONTRACT_VERSION}\`. Generated from \`packages/core/src/integration/\`.`,
    "",
    "## Operations",
    "",
    "| Tool | Title | Scope | Read only | Destructive | Idempotent |",
    "|---|---|---|---|---|---|",
    ...operations.map((operation) =>
      `| \`${operation.name}\` | ${cell(operation.title)} | \`${operation.scope}\` | ${yesNo(operation.annotations.readOnlyHint)} | ${yesNo(operation.annotations.destructiveHint)} | ${yesNo(operation.annotations.idempotentHint)} |`),
    "",
    "Every tool sets `openWorldHint: false`.",
    "",
    "## Scope matrix",
    "",
    "| Scope | Required | Grants | Tools |",
    "|---|---|---|---|",
    ...INTEGRATION_SCOPE_DEFINITIONS.map((definition) => {
      const tools = operations.filter((operation) => operation.scope === definition.scope).map((operation) => `\`${operation.name}\``);
      return `| \`${definition.scope}\` | ${yesNo(definition.required)} | ${cell(definition.summary)} | ${tools.join(", ")} |`;
    }),
    "",
    "## Error catalog",
    "",
    "| Code | HTTP status | Retryable | Before retrying | Meaning |",
    "|---|---|---|---|---|",
    ...INTEGRATION_ERRORS.map((definition) =>
      `| \`${definition.code}\` | ${definition.httpStatus} | ${yesNo(definition.retryable)} | \`${definition.retry}\` | ${cell(definition.meaning)} |`),
    "",
    "## Limits",
    "",
    "| Limit | Value |",
    "|---|---|",
    ...(Object.keys(INTEGRATION_LIMITS) as (keyof typeof INTEGRATION_LIMITS)[]).map((key) =>
      `| ${LIMIT_LABELS[key]} | ${INTEGRATION_LIMITS[key]} |`),
    `| Reminder offsets (minutes) | ${INTEGRATION_REMINDER_OFFSETS.join(", ")} |`,
    "",
    "## Data included and excluded",
    "",
    "Included:",
    "",
    ...INTEGRATION_INCLUDED_DATA.map((item) => `- ${item}`),
    "",
    "Excluded:",
    "",
    ...INTEGRATION_EXCLUDED_DATA.map((item) => `- ${item}`),
    "",
    "## Versioning",
    "",
    "| Change | Version bump |",
    "|---|---|",
    ...INTEGRATION_COMPATIBILITY_POLICY.map((rule) => `| ${cell(rule.change)} | ${rule.bump} |`),
    "",
    ...INTEGRATION_COMPATIBILITY_NOTES.map((note) => `- ${note}`),
    "",
    "## Tool reference",
    "",
    ...operations.flatMap(renderOperation),
    CONTRACT_DOC_END_MARKER,
  ];
  return lines.join("\n");
}
