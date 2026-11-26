import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INTEGRATION_ALONGSIDE_CONTRACT_VERSION,
  INTEGRATION_CONTRACT_VERSION,
  INTEGRATION_FORBIDDEN_OUTPUT_FIELD_FRAGMENTS,
  INTEGRATION_OPERATIONS,
  INTEGRATION_OPERATION_NAMES,
  assertSupportedSchema,
  fitOutputToContract,
  integrationContractVersion,
  integrationOperationFor,
  listIntegrationToolDescriptors,
  validateOperationInput,
  validateOperationOutput,
  type IntegrationOperation,
  type JsonSchemaObject,
} from "@cadence/core/integration";
import { mcpTools } from "@/lib/mcp/server";
import { integrationContractOptions } from "@/lib/services/integration-contract-options";

/**
 * Ticket 364 (D33): contract 1.9.0 adds the person's alongside setting behind
 * CADENCE_ALONGSIDE. With the flag off the endpoint must serve 1.8.0 unchanged.
 */

// sha256 of JSON.stringify(mcpTools()) with CADENCE_ALONGSIDE off: the published contract
// 1.8.0, which added Periods (Ticket 370). Recompute it when the published registry changes.
const PUBLISHED_TOOLS_SHA256 = "693fd4257b1aa436e0b3edb76a170a2c94fbf4b4697e4b2d29ce645d3c268425";
const ON = { alongside: true } as const;
const fixtureDir = path.resolve(__dirname, "fixtures/integration/operations");
const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(fixtureDir, `${name}.json`), "utf8")) as {
  valid_inputs: { value: Record<string, unknown> }[];
  valid_outputs: { value: Record<string, unknown> }[];
};

afterEach(() => { vi.unstubAllEnvs(); });

/** Removes what the 1.9.0 edition adds, so the rest can be compared with 1.8.0. */
function withoutAlongside(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => !(item && typeof item === "object" && JSON.stringify(item) === "{\"required\":[\"alongside\"]}"))
      .map(withoutAlongside);
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "alongside")
    .map(([key, child]) => [key, key === "const" && child === INTEGRATION_ALONGSIDE_CONTRACT_VERSION ? INTEGRATION_CONTRACT_VERSION : withoutAlongside(child)]));
}

function walk(schema: unknown, visit: (node: JsonSchemaObject) => void): void {
  if (Array.isArray(schema)) { schema.forEach((item) => walk(item, visit)); return; }
  if (!schema || typeof schema !== "object") return;
  visit(schema as JsonSchemaObject);
  for (const child of Object.values(schema)) walk(child, visit);
}

function addAlongside(value: unknown, setting: boolean | null): unknown {
  if (Array.isArray(value)) return value.map((item) => addAlongside(item, setting));
  if (value === null || typeof value !== "object") return value;
  const record = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, addAlongside(child, setting)]));
  // Behaviors carry is_opportunity; Occurrences carry added_by.
  return "is_opportunity" in record || "added_by" in record ? { ...record, alongside: setting } : record;
}

describe("contract editions (Ticket 364)", () => {
  it("serves the published 1.8.0 tools byte for byte while CADENCE_ALONGSIDE is off", () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "");
    expect(integrationContractOptions()).toEqual({});
    expect(createHash("sha256").update(JSON.stringify(mcpTools())).digest("hex")).toBe(PUBLISHED_TOOLS_SHA256);
    expect(JSON.stringify(mcpTools())).not.toContain("alongside");
    expect(listIntegrationToolDescriptors()).toEqual(listIntegrationToolDescriptors({}));
    for (const descriptor of listIntegrationToolDescriptors()) {
      expect(descriptor.inputSchema).toBe(INTEGRATION_OPERATIONS[descriptor.name].input.schema);
    }
    expect(integrationContractVersion()).toBe("1.8.0");
  });

  it("serves 1.9.0 with the flag on, and only the exact value on enables it", () => {
    vi.stubEnv("CADENCE_ALONGSIDE", "true");
    expect(integrationContractOptions()).toEqual({});
    vi.stubEnv("CADENCE_ALONGSIDE", "on");
    expect(integrationContractOptions()).toEqual(ON);
    expect(integrationContractVersion(ON)).toBe("1.9.0");
    const tools = mcpTools();
    expect(tools.map((tool) => tool.name)).toEqual(INTEGRATION_OPERATION_NAMES);
    const create = tools.find((tool) => tool.name === "create_behavior")!;
    expect(Object.keys(create.inputSchema.properties ?? {})).toContain("alongside");
  });

  it("differs from 1.8.0 only by the alongside fields and the version", () => {
    for (const name of INTEGRATION_OPERATION_NAMES) {
      const base = INTEGRATION_OPERATIONS[name] as IntegrationOperation;
      const edition = integrationOperationFor(name, ON);
      expect(withoutAlongside(edition.input.schema), name).toEqual(base.input.schema);
      expect(withoutAlongside(edition.output.schema), name).toEqual(base.output.schema);
      expect({ ...edition, input: null, output: null }, name).toEqual({ ...base, input: null, output: null });
    }
  });

  it("keeps every 1.9.0 schema strict, supported and valid JSON Schema 2020-12", () => {
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, validateFormats: false });
    for (const name of INTEGRATION_OPERATION_NAMES) {
      const edition = integrationOperationFor(name, ON);
      for (const schema of [edition.input.schema, edition.output.schema]) {
        expect(() => assertSupportedSchema(schema)).not.toThrow();
        expect(() => ajv.compile(schema as object)).not.toThrow();
        walk(schema, (node) => {
          if (node.type === "object") expect(node.additionalProperties, name).toBe(false);
          for (const key of Object.keys((node.properties ?? {}) as object)) {
            for (const fragment of INTEGRATION_FORBIDDEN_OUTPUT_FIELD_FRAGMENTS) expect(key.includes(fragment), `${name}.${key}`).toBe(false);
          }
        });
      }
    }
  });

  it("adds alongside to Behaviors and to every Occurrence, timeline items included", () => {
    const behavior = integrationOperationFor("get_behavior", ON).output.schema as { properties: Record<string, JsonSchemaObject> };
    const behaviorProperties = (behavior.properties.behavior.properties ?? {}) as Record<string, JsonSchemaObject>;
    expect(behaviorProperties.alongside).toMatchObject({ type: ["boolean", "null"] });
    expect(Object.keys(behaviorProperties).indexOf("alongside")).toBe(Object.keys(behaviorProperties).indexOf("is_opportunity") + 1);
    const timeline = JSON.stringify(integrationOperationFor("get_timeline", ON).output.schema);
    // Two Occurrence lists: Needs decision and each day.
    expect(timeline.match(/"alongside"/g)?.length).toBe(2);
    expect(JSON.stringify(integrationOperationFor("get_occurrence", ON).output.schema)).toContain("\"alongside\"");
    expect(JSON.stringify(integrationOperationFor("list_behaviors", ON).output.schema)).toContain("\"alongside\"");
    expect(JSON.stringify(integrationOperationFor("get_account_context", ON).output.schema)).toContain("\"1.9.0\"");
  });

  it("accepts true, false and null on create_behavior and update_behavior only in 1.9.0", () => {
    const create = fixture("create_behavior").valid_inputs[0]!.value;
    const update = { behavior_id: "00000001-1111-4111-8111-000000000001", expected_revision: "2026-10-18T13:00:00Z" };
    for (const setting of [true, false, null]) {
      expect(validateOperationInput("create_behavior", { ...create, alongside: setting }, ON).ok).toBe(true);
      expect(validateOperationInput("update_behavior", { ...update, alongside: setting }, ON).ok).toBe(true);
      expect(validateOperationInput("create_behavior", { ...create, alongside: setting }).ok).toBe(false);
      expect(validateOperationInput("update_behavior", { ...update, alongside: setting }).ok).toBe(false);
    }
    expect(validateOperationInput("create_behavior", { ...create, alongside: "yes" }, ON).ok).toBe(false);
    // update_behavior still needs at least one change.
    expect(validateOperationInput("update_behavior", update, ON).ok).toBe(false);
  });

  it("validates outputs with the field in 1.9.0 and refuses it in 1.8.0", () => {
    for (const name of ["get_behavior", "list_behaviors", "get_timeline", "get_occurrence", "create_behavior", "update_behavior"] as const) {
      const output = fixture(name).valid_outputs[0]!.value;
      for (const setting of [true, false, null]) {
        expect(validateOperationOutput(name, addAlongside(output, setting), ON).ok, name).toBe(true);
      }
      expect(validateOperationOutput(name, addAlongside(output, true)).ok, name).toBe(false);
      // Optional in 1.9.0, so a replay recorded before the flag still validates.
      expect(validateOperationOutput(name, output, ON).ok, name).toBe(true);
    }
    const context = { ...fixture("get_account_context").valid_outputs[0]!.value };
    expect(validateOperationOutput("get_account_context", { ...context, contract_version: "1.9.0" }, ON).ok).toBe(true);
    expect(validateOperationOutput("get_account_context", { ...context, contract_version: "1.8.0" }, ON).ok).toBe(false);
  });

  it("drops alongside from a replayed result when the flag is off", () => {
    const output = addAlongside(fixture("get_timeline").valid_outputs[0]!.value, true);
    expect(JSON.stringify(fitOutputToContract(output))).not.toContain("alongside");
    expect(fitOutputToContract(output, ON)).toBe(output);
    expect(validateOperationOutput("get_timeline", fitOutputToContract(output)).ok).toBe(true);
  });
});
