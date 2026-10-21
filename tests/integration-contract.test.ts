import fs from "node:fs";
import path from "node:path";

import { Temporal } from "@js-temporal/polyfill";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CONTRACT_DOC_BEGIN_MARKER,
  CONTRACT_DOC_END_MARKER,
  INTEGRATION_CONTRACT_VERSION,
  INTEGRATION_ERRORS,
  INTEGRATION_ERROR_CODES,
  INTEGRATION_FORBIDDEN_OUTPUT_FIELD_FRAGMENTS,
  INTEGRATION_LIMITS,
  INTEGRATION_OPERATIONS,
  INTEGRATION_OPERATION_NAMES,
  INTEGRATION_SCOPES,
  INTEGRATION_SCOPE_LIST,
  JSON_SCHEMA_DIALECT,
  assertSupportedSchema,
  checkOperationScope,
  createIntegrationError,
  integrationErrorSchema,
  listIntegrationToolDescriptors,
  renderIntegrationContractReference,
  resolveOperationName,
  validateAgainstSchema,
  validateOperationInput,
  validateOperationOutput,
  type IntegrationOperation,
  type IntegrationOperationInput,
  type IntegrationOperationName,
  type IntegrationOperationOutput,
  type JsonSchemaObject,
} from "@cadence/core/integration";

const root = path.resolve(__dirname, "..");
const fixtureDir = path.join(root, "tests/fixtures/integration");
const docPath = path.join(root, "docs/MCP_CONTRACT.md");

type FixtureCase = { name: string; value: unknown; code?: string; path?: string; semantic?: boolean };
type OperationFixture = {
  operation: string;
  valid_inputs: FixtureCase[];
  invalid_inputs: FixtureCase[];
  valid_outputs: FixtureCase[];
  invalid_outputs: FixtureCase[];
};

const fixtures: OperationFixture[] = fs
  .readdirSync(path.join(fixtureDir, "operations"))
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(fs.readFileSync(path.join(fixtureDir, "operations", file), "utf8")) as OperationFixture);

const operations = INTEGRATION_OPERATION_NAMES.map(
  (name) => [name, INTEGRATION_OPERATIONS[name] as IntegrationOperation] as const,
);

/** Reference JSON Schema 2020-12 validator with formats checked independently of core. */
function createReferenceValidator() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  ajv.addFormat("date", (value: string) => {
    try {
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && Temporal.PlainDate.from(value, { overflow: "reject" }).toString() === value;
    } catch {
      return false;
    }
  });
  ajv.addFormat("date-time", (value: string) => {
    try {
      Temporal.Instant.from(value);
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(value);
    } catch {
      return false;
    }
  });
  ajv.addFormat("uuid", /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
  ajv.addFormat("uri", (value: string) => URL.canParse(value));
  return ajv;
}

const reference = createReferenceValidator();
const compiled = new Map<JsonSchemaObject, ReturnType<typeof reference.compile>>();
function referenceValidate(schema: JsonSchemaObject, value: unknown): boolean {
  let validate = compiled.get(schema);
  if (!validate) {
    validate = reference.compile(schema as object);
    compiled.set(schema, validate);
  }
  return validate(value) as boolean;
}

function walkSchemas(schema: JsonSchemaObject, visit: (schema: JsonSchemaObject, path: string) => void, at = "$"): void {
  visit(schema, at);
  const properties = schema.properties as Record<string, JsonSchemaObject> | undefined;
  for (const [key, child] of Object.entries(properties ?? {})) walkSchemas(child, visit, `${at}.${key}`);
  if (schema.items && typeof schema.items === "object") walkSchemas(schema.items as JsonSchemaObject, visit, `${at}[]`);
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const branches = schema[keyword] as JsonSchemaObject[] | undefined;
    branches?.forEach((branch, index) => walkSchemas(branch, visit, `${at}.${keyword}[${index}]`));
  }
}

describe("integration operation registry", () => {
  it("covers exactly the Spec tool catalog in a stable order", () => {
    expect(INTEGRATION_OPERATION_NAMES).toEqual([
      "get_account_context",
      "list_behaviors",
      "get_behavior",
      "list_categories",
      "get_timeline",
      "list_occurrences",
      "get_occurrence",
      "get_adherence_summary",
      "search",
      "fetch",
      "set_occurrence_status",
      "update_occurrence_note",
      "create_behavior",
      "update_behavior",
      "archive_behavior",
      "restore_behavior",
    ]);
  });

  it("uses contract version 1.0.0 everywhere", () => {
    expect(INTEGRATION_CONTRACT_VERSION).toBe("1.0.0");
    for (const [, operation] of operations) expect(operation.since).toBe("1.0.0");
  });

  it("maps every tool to one of the three scopes as the Spec requires", () => {
    expect(INTEGRATION_SCOPE_LIST).toEqual(["cadence.read", "cadence.occurrences.write", "cadence.behaviors.write"]);
    const byScope = (scope: string) => operations.filter(([, operation]) => operation.scope === scope).map(([name]) => name);
    expect(byScope(INTEGRATION_SCOPES.occurrencesWrite)).toEqual(["set_occurrence_status", "update_occurrence_note"]);
    expect(byScope(INTEGRATION_SCOPES.behaviorsWrite)).toEqual(["create_behavior", "update_behavior", "archive_behavior", "restore_behavior"]);
    for (const [, operation] of operations) {
      expect(operation.access === "read").toBe(operation.scope === INTEGRATION_SCOPES.read);
    }
  });

  it("names tools within MCP and directory limits", () => {
    for (const [name, operation] of operations) {
      expect(operation.name).toBe(name);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(operation.title.length).toBeGreaterThan(0);
    }
  });

  it("sets annotations that match read and write behavior", () => {
    for (const [name, operation] of operations) {
      const annotations = operation.annotations;
      expect(annotations.title, name).toBe(operation.title);
      expect(annotations.openWorldHint, name).toBe(false);
      expect(annotations.readOnlyHint, name).toBe(operation.access === "read");
      expect(operation.annotationRationale.length, name).toBeGreaterThan(40);
      if (operation.access === "read") {
        expect(annotations.destructiveHint, name).toBe(false);
        expect(annotations.idempotentHint, name).toBe(true);
      }
    }
    const destructive = operations.filter(([, operation]) => operation.annotations.destructiveHint).map(([name]) => name);
    expect(destructive).toEqual(["set_occurrence_status", "update_occurrence_note", "update_behavior", "archive_behavior", "restore_behavior"]);
    expect(INTEGRATION_OPERATIONS.create_behavior.annotations.idempotentHint).toBe(false);
  });

  it("writes descriptions that describe the tool without instructing the model", () => {
    const instructionPatterns = [
      /\byou (must|should|need to)\b/i,
      /\bignore (all|any|previous)\b/i,
      /\bsystem prompt\b/i,
      /\balways (call|use|ask)\b/i,
      /\bbefore (responding|answering)\b/i,
      /\b(claude|chatgpt|assistant|the model)\b/i,
      /\bimportant:/i,
      /[<>]/,
    ];
    for (const [name, operation] of operations) {
      expect(operation.description.length, name).toBeGreaterThan(40);
      expect(operation.description.length, name).toBeLessThanOrEqual(600);
      for (const pattern of instructionPatterns) expect(operation.description, `${name} ${pattern}`).not.toMatch(pattern);
      expect(operation.description, name).not.toMatch(/\bmissed\b/i);
    }
    for (const name of ["list_behaviors", "create_behavior", "set_occurrence_status", "search"] as const) {
      expect(INTEGRATION_OPERATIONS[name].description, name).toMatch(/habit/);
      expect(INTEGRATION_OPERATIONS[name].description, name).toMatch(/routine/);
    }
  });

  it("lists every operation error from the catalog and includes the common codes", () => {
    for (const [name, operation] of operations) {
      for (const code of operation.errors) expect(INTEGRATION_ERROR_CODES, name).toContain(code);
      expect(new Set(operation.errors).size, name).toBe(operation.errors.length);
      for (const code of ["invalid_input", "authentication_required", "rate_limited", "service_unavailable", "internal_error"]) {
        expect(operation.errors, name).toContain(code);
      }
      expect(operation.errors.includes("insufficient_scope"), name).toBe(operation.access === "write");
    }
  });

  it("exposes MCP tool descriptors straight from the registry", () => {
    const descriptors = listIntegrationToolDescriptors();
    expect(descriptors.map((descriptor) => descriptor.name)).toEqual(INTEGRATION_OPERATION_NAMES);
    for (const descriptor of descriptors) {
      const operation = INTEGRATION_OPERATIONS[descriptor.name] as IntegrationOperation;
      expect(descriptor.inputSchema).toBe(operation.input.schema);
      expect(descriptor.outputSchema).toBe(operation.output.schema);
      expect(descriptor.annotations).toEqual(operation.annotations);
    }
  });
});

describe("integration schemas", () => {
  for (const [name, operation] of operations) {
    for (const [kind, schema] of [["input", operation.input.schema], ["output", operation.output.schema]] as const) {
      it(`${name} ${kind} schema is a strict JSON Schema 2020-12 object`, () => {
        expect(schema.$schema).toBe(JSON_SCHEMA_DIALECT);
        expect(schema.type).toBe("object");
        expect(() => assertSupportedSchema(schema)).not.toThrow();
        expect(() => reference.compile(schema as object)).not.toThrow();
        walkSchemas(schema, (child, at) => {
          if (child.type === "object" || (Array.isArray(child.type) && child.type.includes("object"))) {
            expect(child.additionalProperties, `${name} ${kind} ${at}`).toBe(false);
          }
        });
      });
    }

    it(`${name} output never names an excluded data class`, () => {
      walkSchemas(operation.output.schema, (child, at) => {
        for (const key of Object.keys((child.properties ?? {}) as object)) {
          for (const fragment of INTEGRATION_FORBIDDEN_OUTPUT_FIELD_FRAGMENTS) {
            expect(key.includes(fragment), `${name} ${at}.${key} contains ${fragment}`).toBe(false);
          }
        }
      });
    });
  }

  it("never offers missed as a status value", () => {
    for (const [name, operation] of operations) {
      expect(JSON.stringify(operation.input.schema), name).not.toMatch(/"missed"/);
      expect(JSON.stringify(operation.output.schema), name).not.toMatch(/"missed"/);
    }
  });

  it("returns account identity only as a pairwise reference", () => {
    const output = INTEGRATION_OPERATIONS.get_account_context.output.schema;
    expect(Object.keys(output.properties as object)).toContain("account_ref");
    expect(JSON.stringify(output)).not.toMatch(/"(user_id|email|account_id)"/);
  });

  it("gives every write optional retry and concurrency fields", () => {
    for (const [name, operation] of operations) {
      if (operation.access !== "write") continue;
      const properties = operation.input.schema.properties as Record<string, unknown>;
      const required = operation.input.schema.required as string[];
      expect(properties.idempotency_key, name).toBeDefined();
      expect(required, name).not.toContain("idempotency_key");
      if (name !== "create_behavior") expect(properties.expected_status ?? properties.expected_revision, name).toBeDefined();
    }
    expect(INTEGRATION_OPERATIONS.update_behavior.input.schema.required).toContain("expected_revision");
    expect(Object.keys(INTEGRATION_OPERATIONS.create_behavior.input.schema.properties as object)).toContain("external_ref");
    for (const name of ["list_behaviors", "list_occurrences", "list_categories"] as const) {
      expect(Object.keys(INTEGRATION_OPERATIONS[name].input.schema.properties as object), name).toContain("updated_since");
    }
  });
});

describe("integration fixtures", () => {
  it("has one fixture file per operation", () => {
    expect(fixtures.map((fixture) => fixture.operation).sort()).toEqual([...INTEGRATION_OPERATION_NAMES].sort());
    for (const fixture of fixtures) {
      expect(fixture.valid_inputs.length, fixture.operation).toBeGreaterThan(0);
      expect(fixture.invalid_inputs.length, fixture.operation).toBeGreaterThan(0);
      expect(fixture.valid_outputs.length, fixture.operation).toBeGreaterThan(0);
      expect(fixture.invalid_outputs.length, fixture.operation).toBeGreaterThan(0);
    }
  });

  for (const fixture of fixtures) {
    const name = fixture.operation as IntegrationOperationName;
    const operation = INTEGRATION_OPERATIONS[name] as IntegrationOperation;

    describe(name, () => {
      for (const testCase of fixture.valid_inputs) {
        it(`accepts input: ${testCase.name}`, () => {
          const result = validateOperationInput(name, testCase.value);
          expect(result.ok ? [] : result.issues).toEqual([]);
          expect(referenceValidate(operation.input.schema, testCase.value)).toBe(true);
        });
      }
      for (const testCase of fixture.invalid_inputs) {
        it(`rejects input with ${testCase.code}: ${testCase.name}`, () => {
          const result = validateOperationInput(name, testCase.value);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe(testCase.code);
          expect(result.issues.map((issue) => issue.path)).toContain(testCase.path);
          expect(validateAgainstSchema(integrationErrorSchema.schema, result.error).ok).toBe(true);
          expect(referenceValidate(operation.input.schema, testCase.value)).toBe(Boolean(testCase.semantic));
        });
      }
      for (const testCase of fixture.valid_outputs) {
        it(`accepts output: ${testCase.name}`, () => {
          const result = validateOperationOutput(name, testCase.value);
          expect(result.ok ? [] : result.issues).toEqual([]);
          expect(referenceValidate(operation.output.schema, testCase.value)).toBe(true);
        });
      }
      for (const testCase of fixture.invalid_outputs) {
        it(`rejects output: ${testCase.name}`, () => {
          const result = validateOperationOutput(name, testCase.value);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe(testCase.code);
          expect(result.issues.map((issue) => issue.path)).toContain(testCase.path);
          expect(referenceValidate(operation.output.schema, testCase.value)).toBe(false);
        });
      }
    });
  }
});

describe("integration errors", () => {
  const errorFixtures = JSON.parse(fs.readFileSync(path.join(fixtureDir, "errors.json"), "utf8")) as {
    valid: FixtureCase[];
    invalid: FixtureCase[];
  };

  it("keeps codes unique with consistent retry meaning", () => {
    expect(new Set(INTEGRATION_ERROR_CODES).size).toBe(INTEGRATION_ERROR_CODES.length);
    for (const definition of INTEGRATION_ERRORS) {
      expect(definition.retryable).toBe(definition.retry !== "never");
      expect(definition.httpStatus).toBeGreaterThanOrEqual(400);
    }
    expect(INTEGRATION_ERRORS.find((definition) => definition.code === "conflict")?.retry).toBe("after_refresh");
    expect(INTEGRATION_ERRORS.find((definition) => definition.code === "insufficient_scope")?.httpStatus).toBe(403);
  });

  it("validates error envelopes", () => {
    for (const testCase of errorFixtures.valid) {
      expect(validateAgainstSchema(integrationErrorSchema.schema, testCase.value).ok, testCase.name).toBe(true);
      expect(referenceValidate(integrationErrorSchema.schema, testCase.value), testCase.name).toBe(true);
    }
    for (const testCase of errorFixtures.invalid) {
      expect(validateAgainstSchema(integrationErrorSchema.schema, testCase.value).ok, testCase.name).toBe(false);
      expect(referenceValidate(integrationErrorSchema.schema, testCase.value), testCase.name).toBe(false);
    }
  });

  it("builds every catalog error as a valid envelope", () => {
    for (const code of INTEGRATION_ERROR_CODES) {
      const error = createIntegrationError(code, `Example ${code}.`, { retryAfterSeconds: code === "rate_limited" ? 30 : undefined });
      expect(validateAgainstSchema(integrationErrorSchema.schema, error).ok, code).toBe(true);
      expect(error.contract_version).toBe("1.0.0");
    }
  });

  it("returns insufficient_scope with the required scope for writes", () => {
    expect(checkOperationScope("get_timeline", ["cadence.read"])).toBeNull();
    const error = checkOperationScope("set_occurrence_status", ["cadence.read", "cadence.behaviors.write"]);
    expect(error?.code).toBe("insufficient_scope");
    expect(error?.required_scopes).toEqual(["cadence.occurrences.write"]);
    expect(checkOperationScope("create_behavior", ["cadence.read", "cadence.behaviors.write"])).toBeNull();
  });

  it("rejects unknown tool names with a stable code", () => {
    expect(resolveOperationName("delete_behavior")).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(resolveOperationName("__proto__")).toMatchObject({ ok: false });
    expect(resolveOperationName("fetch")).toEqual({ ok: true, value: "fetch" });
  });

  it("rejects results over the response-size budget with limit_exceeded", () => {
    const valid = fixtures.find((fixture) => fixture.operation === "list_occurrences")!.valid_outputs[0].value as {
      occurrences: { note: string | null }[];
    };
    const big = { ...valid, occurrences: Array.from({ length: 80 }, () => ({ ...valid.occurrences[0], note: "x".repeat(2000) })) };
    const result = validateOperationOutput("list_occurrences", big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("limit_exceeded");
    expect(INTEGRATION_LIMITS.maxResponseBytes).toBe(100_000);
  });
});

describe("integration types", () => {
  it("infers input and output types from the schemas", () => {
    expectTypeOf<IntegrationOperationInput<"set_occurrence_status">["status"]>().toEqualTypeOf<
      "unresolved" | "completed" | "not_completed"
    >();
    expectTypeOf<IntegrationOperationInput<"update_behavior">["expected_revision"]>().toEqualTypeOf<string>();
    expectTypeOf<IntegrationOperationInput<"update_behavior">["description"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<IntegrationOperationOutput<"get_behavior">["behavior"]["state"]>().toEqualTypeOf<"active" | "archived">();
    expectTypeOf<IntegrationOperationOutput<"get_timeline">["needs_decision"]>().toMatchTypeOf<object | null>();
    const input: IntegrationOperationInput<"create_behavior"> = {
      title: "Walk",
      schedules: [{ recurrence: { frequency: "weekly", interval: 2, days_of_week: ["monday"] }, time_entries: [{ kind: "range", preset: "morning" }] }],
    };
    expect(validateOperationInput("create_behavior", input).ok).toBe(true);
  });
});

describe("docs/MCP_CONTRACT.md", () => {
  it("matches the generated contract reference (set UPDATE_MCP_CONTRACT_DOC=1 to regenerate)", () => {
    const generated = renderIntegrationContractReference();
    const doc = fs.readFileSync(docPath, "utf8");
    const start = doc.indexOf(CONTRACT_DOC_BEGIN_MARKER);
    const end = doc.indexOf(CONTRACT_DOC_END_MARKER);
    expect(start, "begin marker").toBeGreaterThanOrEqual(0);
    expect(end, "end marker").toBeGreaterThan(start);
    const current = doc.slice(start, end + CONTRACT_DOC_END_MARKER.length);
    if (process.env.UPDATE_MCP_CONTRACT_DOC === "1" && current !== generated) {
      fs.writeFileSync(docPath, doc.replace(current, generated));
      return;
    }
    expect(current).toBe(generated);
  });

  it("names every tool, scope, and error code", () => {
    const doc = fs.readFileSync(docPath, "utf8");
    for (const name of INTEGRATION_OPERATION_NAMES) expect(doc).toContain(`\`${name}\``);
    for (const scope of INTEGRATION_SCOPE_LIST) expect(doc).toContain(`\`${scope}\``);
    for (const code of INTEGRATION_ERROR_CODES) expect(doc).toContain(`\`${code}\``);
  });
});
