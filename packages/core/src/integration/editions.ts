/**
 * Alongside (Ticket 364, D33): contract 1.8.0 adds the person's alongside setting to
 * Behaviors and Occurrences and accepts it on `create_behavior` and `update_behavior`.
 *
 * The field ships behind the hosted `CADENCE_ALONGSIDE` flag. The registry in
 * `operations.ts` stays the published 1.7.0 contract, so the generated reference, the
 * developer docs and every caller that passes no options are unchanged. A caller that
 * passes `{ alongside: true }` gets the 1.8.0 edition built here from the same registry:
 * the same tools with the alongside properties added. With the flag off the endpoint
 * serves 1.7.0 byte for byte.
 *
 * Only the person's setting crosses the contract. The cached model guess
 * (`behavior_advisor_estimates.alongside`) is never exposed.
 */
import { boolean, nullable, type JsonSchemaObject, type JsonSchemaValue } from "./schema";
import { behaviorOutput, occurrenceDetailOutput, occurrenceOutput } from "./domain";
import {
  INTEGRATION_OPERATIONS,
  INTEGRATION_OPERATION_NAMES,
  type IntegrationOperation,
  type IntegrationOperationName,
  type IntegrationToolAnnotations,
} from "./operations";
import { INTEGRATION_CONTRACT_VERSION } from "./version";

/** Which contract edition a caller speaks. Omitted fields mean the published edition. */
export type IntegrationContractOptions = Readonly<{
  /** True while `CADENCE_ALONGSIDE` is on for the hosted app. */
  alongside?: boolean;
}>;

export const INTEGRATION_ALONGSIDE_CONTRACT_VERSION = "1.8.0" as const;

/** The value a client reads as alongside: true, false, or null when the person has not answered. */
export type AlongsideSetting = boolean | null;
/** The output field the 1.8.0 edition adds to Behaviors and Occurrences. */
export type AlongsideOutputField = { alongside?: AlongsideSetting };
/** The optional input field the 1.8.0 edition adds to `create_behavior` and `update_behavior`. */
export type AlongsideInputField = { alongside?: AlongsideSetting };

const BEHAVIOR_ALONGSIDE_DESCRIPTION =
  "The person's answer to \"Can this be done alongside other things?\": true, false, or null when they have not answered. Cadence's own guess is never returned (contract 1.8.0).";
const OCCURRENCE_ALONGSIDE_DESCRIPTION =
  "The Behavior's alongside setting: true, false, or null when the person has not answered (contract 1.8.0).";
const CREATE_ALONGSIDE_DESCRIPTION =
  "Optional: true when the Behavior can be done alongside other things, false when it can't. Omit or send null to leave it unanswered (contract 1.8.0).";
const UPDATE_ALONGSIDE_DESCRIPTION =
  "Optional: true or false sets the person's alongside answer; null clears it to unanswered. Omit to keep it (contract 1.8.0).";

const outputField = (description: string) => nullable(boolean(), { description }).schema;

type Extension = Readonly<{ key: string; after: string; schema: JsonSchemaObject }>;

/** Output objects that gain `alongside`, found by the identity of their `properties` object. */
const OUTPUT_EXTENSIONS = new Map<JsonSchemaValue, Extension>([
  [behaviorOutput.schema.properties!, { key: "alongside", after: "is_opportunity", schema: outputField(BEHAVIOR_ALONGSIDE_DESCRIPTION) }],
  [occurrenceOutput.schema.properties!, { key: "alongside", after: "added_by", schema: outputField(OCCURRENCE_ALONGSIDE_DESCRIPTION) }],
  [occurrenceDetailOutput.schema.properties!, { key: "alongside", after: "added_by", schema: outputField(OCCURRENCE_ALONGSIDE_DESCRIPTION) }],
]);

/** Inserts `extension` after its anchor key, keeping the property order readable. */
function withProperty(properties: Readonly<Record<string, JsonSchemaValue>>, extension: Extension): Record<string, JsonSchemaValue> {
  const result: Record<string, JsonSchemaValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    result[key] = value;
    if (key === extension.after) result[extension.key] = extension.schema;
  }
  if (!(extension.key in result)) result[extension.key] = extension.schema;
  return result;
}

/** Copies a schema tree, adding `alongside` to each output object listed above. */
function extendOutputs(value: JsonSchemaValue): JsonSchemaValue {
  if (Array.isArray(value)) return value.map(extendOutputs);
  if (value === null || typeof value !== "object") return value;
  const node = value as JsonSchemaObject;
  const copy: Record<string, JsonSchemaValue> = {};
  for (const [key, child] of Object.entries(node)) copy[key] = key === "properties" ? child : extendOutputs(child);
  const properties = node.properties as Readonly<Record<string, JsonSchemaValue>> | undefined;
  if (properties) {
    const extension = OUTPUT_EXTENSIONS.get(properties);
    const children = Object.fromEntries(Object.entries(properties).map(([key, child]) => [key, extendOutputs(child)]));
    copy.properties = extension ? withProperty(children, extension) : children;
  }
  return copy;
}

function extendInput(schema: JsonSchemaObject, description: string, after: string, requireOneOf: boolean): JsonSchemaObject {
  const properties = withProperty(schema.properties as Record<string, JsonSchemaValue>, {
    key: "alongside", after, schema: outputField(description),
  });
  const anyOf = requireOneOf && Array.isArray(schema.anyOf) ? [...schema.anyOf, { required: ["alongside"] }] : schema.anyOf;
  return { ...schema, properties, ...(anyOf === undefined ? {} : { anyOf }) };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function alongsideOperation(name: IntegrationOperationName): IntegrationOperation {
  const base = INTEGRATION_OPERATIONS[name] as IntegrationOperation;
  let input = base.input.schema;
  if (name === "create_behavior") input = extendInput(input, CREATE_ALONGSIDE_DESCRIPTION, "is_opportunity", false);
  if (name === "update_behavior") input = extendInput(input, UPDATE_ALONGSIDE_DESCRIPTION, "is_opportunity", true);
  let output = extendOutputs(base.output.schema) as JsonSchemaObject;
  if (name === "get_account_context") {
    const properties = output.properties as Record<string, JsonSchemaObject>;
    output = { ...output, properties: { ...properties, contract_version: { ...properties.contract_version, const: INTEGRATION_ALONGSIDE_CONTRACT_VERSION } } };
  }
  return deepFreeze({
    ...base,
    input: { ...base.input, schema: input },
    output: { ...base.output, schema: output },
  }) as IntegrationOperation;
}

const ALONGSIDE_OPERATIONS: Readonly<Record<IntegrationOperationName, IntegrationOperation>> = Object.freeze(
  Object.fromEntries(INTEGRATION_OPERATION_NAMES.map((name) => [name, alongsideOperation(name)])) as Record<IntegrationOperationName, IntegrationOperation>,
);

/** The contract version a caller with these options speaks. */
export function integrationContractVersion(options: IntegrationContractOptions = {}): string {
  return options.alongside ? INTEGRATION_ALONGSIDE_CONTRACT_VERSION : INTEGRATION_CONTRACT_VERSION;
}

/** One operation in the edition these options select. */
export function integrationOperationFor(name: IntegrationOperationName, options: IntegrationContractOptions = {}): IntegrationOperation {
  return options.alongside ? ALONGSIDE_OPERATIONS[name] : INTEGRATION_OPERATIONS[name] as IntegrationOperation;
}

/**
 * Removes `alongside` from a stored result when the edition does not carry it, so an
 * idempotent replay recorded while the flag was on still matches 1.7.0 after a rollback.
 * No other contract field is named `alongside`.
 */
export function fitOutputToContract<T>(value: T, options: IntegrationContractOptions = {}): T {
  if (options.alongside) return value;
  const strip = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(strip);
    if (item === null || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).filter(([key]) => key !== "alongside").map(([key, child]) => [key, strip(child)]));
  };
  return strip(value) as T;
}

/** Tool descriptor in the shape MCP `tools/list` uses. Transport-specific `_meta` is added by the endpoint. */
export type IntegrationToolDescriptor = {
  name: IntegrationOperationName;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  annotations: IntegrationToolAnnotations;
};

/** Every tool in the edition these options select; no options gives the published contract. */
export function listIntegrationToolDescriptors(options: IntegrationContractOptions = {}): IntegrationToolDescriptor[] {
  return INTEGRATION_OPERATION_NAMES.map((name) => {
    const operation = integrationOperationFor(name, options);
    return {
      name,
      title: operation.title,
      description: operation.description,
      inputSchema: operation.input.schema,
      outputSchema: operation.output.schema,
      annotations: { ...operation.annotations },
    };
  });
}
