/**
 * Validator for the JSON Schema 2020-12 subset the integration contract uses.
 *
 * It reads the published schema objects directly, so the wire schema and the
 * runtime checks cannot diverge. `assertSupportedSchema` rejects any keyword
 * outside the subset, which keeps the validator honest as schemas grow.
 */
import type { JsonSchemaObject, JsonSchemaValue } from "./schema";

export type ValidationIssue = {
  /** JSONPath-like location, for example `$.schedules[0].recurrence.interval`. */
  path: string;
  keyword: string;
  message: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

export const SUPPORTED_SCHEMA_KEYWORDS: readonly string[] = Object.freeze([
  "$schema", "title", "description", "examples", "default",
  "type", "enum", "const",
  "properties", "required", "additionalProperties",
  "items", "minItems", "maxItems", "uniqueItems",
  "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum",
  "oneOf", "anyOf",
]);

const SUPPORTED_FORMATS = new Set(["date", "date-time", "uuid", "uri"]);
const MAX_ISSUES = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;
const URI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/;

export function isValidLocalDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

export function isValidDateTime(value: string): boolean {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match || !isValidLocalDate(match[1])) return false;
  const [hour, minute, second] = [Number(match[2]), Number(match[3]), Number(match[4])];
  if (hour > 23 || minute > 59 || second > 60) return false;
  if (match[5] && (Number(match[6]) > 23 || Number(match[7]) > 59)) return false;
  return true;
}

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function checkFormat(format: string, value: string): boolean {
  switch (format) {
    case "date": return isValidLocalDate(value);
    case "date-time": return isValidDateTime(value);
    case "uuid": return isValidUuid(value);
    case "uri": return URI_PATTERN.test(value);
    default: return false;
  }
}

/** Counts Unicode code points, as JSON Schema requires for string lengths. */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(expected: string, value: unknown): boolean {
  const actual = jsonType(value);
  if (expected === "number") return actual === "number" || actual === "integer";
  return actual === expected;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (typeof left === "object") {
    if (Array.isArray(right)) return false;
    const leftKeys = Object.keys(left as object);
    const rightKeys = Object.keys(right as object);
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
  }
  return false;
}

function describe(value: JsonSchemaValue): string {
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

const regexCache = new Map<string, RegExp>();
function regex(pattern: string): RegExp {
  let compiled = regexCache.get(pattern);
  if (!compiled) {
    compiled = new RegExp(pattern, "u");
    regexCache.set(pattern, compiled);
  }
  return compiled;
}

function asSchema(value: JsonSchemaValue | undefined): JsonSchemaObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonSchemaObject) : undefined;
}

function visit(schema: JsonSchemaObject, value: unknown, path: string, issues: ValidationIssue[]): void {
  if (issues.length >= MAX_ISSUES) return;
  const push = (keyword: string, message: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ path, keyword, message });
  };

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((type) => typeMatches(type, value))) {
      push("type", `must be ${types.join(" or ")}`);
      return;
    }
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    push("const", `must equal ${describe(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(option, value))) {
    push("enum", `must be one of ${schema.enum.map((option) => describe(option)).join(", ")}`);
    return;
  }

  if (typeof value === "string") {
    const length = codePointLength(value);
    if (typeof schema.minLength === "number" && length < schema.minLength) {
      push("minLength", schema.minLength === 1 ? "must not be empty" : `must have at least ${schema.minLength} characters`);
    }
    if (typeof schema.maxLength === "number" && length > schema.maxLength) {
      push("maxLength", `must have at most ${schema.maxLength} characters`);
    }
    if (typeof schema.pattern === "string" && !regex(schema.pattern).test(value)) {
      push("pattern", "has an invalid format");
    }
    if (typeof schema.format === "string" && !checkFormat(schema.format, value)) {
      push("format", `must be a valid ${schema.format}`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) push("minimum", `must be at least ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) push("maximum", `must be at most ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      push("minItems", `must contain at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      push("maxItems", `must contain at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems === true) {
      for (let index = 1; index < value.length; index += 1) {
        if (value.slice(0, index).some((earlier) => deepEqual(earlier, value[index]))) {
          push("uniqueItems", "must not contain duplicate items");
          break;
        }
      }
    }
    const items = asSchema(schema.items);
    if (items) value.forEach((item, index) => visit(items, item, `${path}[${index}]`, issues));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const properties = asSchema(schema.properties) ?? {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
          if (issues.length < MAX_ISSUES) issues.push({ path: childPath(path, key), keyword: "required", message: "is required" });
        }
      }
    }
    for (const [key, child] of Object.entries(record)) {
      const propertySchema = Object.prototype.hasOwnProperty.call(properties, key) ? asSchema(properties[key]) : undefined;
      if (propertySchema) {
        visit(propertySchema, child, childPath(path, key), issues);
      } else if (schema.additionalProperties === false) {
        if (issues.length < MAX_ISSUES) issues.push({ path: childPath(path, key), keyword: "additionalProperties", message: "is not an allowed field" });
      } else {
        const additional = asSchema(schema.additionalProperties);
        if (additional) visit(additional, child, childPath(path, key), issues);
      }
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map(asSchema).filter((branch): branch is JsonSchemaObject => !!branch);
    const results = branches.map((branch) => collect(branch, value, path));
    if (!results.some((result) => result.length === 0)) {
      const requiredOnly = branches.every((branch) => Object.keys(branch).length === 1 && Array.isArray(branch.required));
      if (requiredOnly) {
        const keys = branches.flatMap((branch) => branch.required as string[]);
        push("anyOf", `must include at least one of ${keys.join(", ")}`);
      } else {
        appendBest(results, issues, () => push("anyOf", "does not match any allowed shape"));
      }
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf.map(asSchema).filter((branch): branch is JsonSchemaObject => !!branch);
    const results = branches.map((branch) => collect(branch, value, path));
    const matches = results.filter((result) => result.length === 0).length;
    if (matches > 1) push("oneOf", "matches more than one allowed shape");
    if (matches === 0) {
      const discriminated = discriminatedBranch(branches, results, value);
      if (discriminated) {
        for (const issue of discriminated) if (issues.length < MAX_ISSUES) issues.push(issue);
      } else {
        appendBest(results, issues, () => push("oneOf", "does not match any allowed shape"));
      }
    }
  }
}

function collect(schema: JsonSchemaObject, value: unknown, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  visit(schema, value, path, issues);
  return issues;
}

/**
 * When branches carry `const` discriminators (for example `frequency` or
 * `kind`) and the value names one, report that branch's issues. When several
 * branches share the same discriminator value, report the closest one.
 */
function discriminatedBranch(
  branches: JsonSchemaObject[],
  results: ValidationIssue[][],
  value: unknown,
): ValidationIssue[] | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidates: ValidationIssue[][] = [];
  let sawDiscriminator = false;
  branches.forEach((branch, index) => {
    const properties = asSchema(branch.properties);
    if (!properties) return;
    const discriminators = Object.entries(properties).filter(([, child]) => asSchema(child)?.const !== undefined);
    if (!discriminators.length) return;
    sawDiscriminator = true;
    if (discriminators.every(([key, child]) => deepEqual(asSchema(child)?.const, record[key]))) {
      candidates.push(results[index]);
    }
  });
  if (!sawDiscriminator || !candidates.length) return null;
  return candidates.reduce((best, current) => (current.length < best.length ? current : best));
}

function appendBest(results: ValidationIssue[][], issues: ValidationIssue[], fallback: () => void): void {
  if (results.length === 1) {
    for (const issue of results[0]) if (issues.length < MAX_ISSUES) issues.push(issue);
    return;
  }
  fallback();
}

export function validateAgainstSchema<T>(schema: JsonSchemaObject, value: unknown): ValidationResult<T> {
  const issues = collect(schema, value, "$");
  return issues.length ? { ok: false, issues } : { ok: true, value: value as T };
}

/** Throws when a schema uses a keyword or format outside the supported subset. */
export function assertSupportedSchema(schema: JsonSchemaObject, path = "$"): void {
  for (const [key, child] of Object.entries(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.includes(key)) {
      throw new Error(`${path}: unsupported JSON Schema keyword "${key}"`);
    }
    if (key === "format" && (typeof child !== "string" || !SUPPORTED_FORMATS.has(child))) {
      throw new Error(`${path}: unsupported format ${JSON.stringify(child)}`);
    }
    if (key === "pattern" && typeof child === "string") regex(child);
  }
  const properties = asSchema(schema.properties);
  if (properties) {
    for (const [key, child] of Object.entries(properties)) {
      const childSchema = asSchema(child);
      if (!childSchema) throw new Error(`${path}.properties.${key}: must be a schema object`);
      assertSupportedSchema(childSchema, `${path}.properties.${key}`);
    }
  }
  const items = asSchema(schema.items);
  if (items) assertSupportedSchema(items, `${path}.items`);
  const additional = asSchema(schema.additionalProperties);
  if (additional) assertSupportedSchema(additional, `${path}.additionalProperties`);
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const branches = schema[keyword];
    if (Array.isArray(branches)) {
      branches.forEach((branch, index) => {
        const branchSchema = asSchema(branch);
        if (!branchSchema) throw new Error(`${path}.${keyword}[${index}]: must be a schema object`);
        assertSupportedSchema(branchSchema, `${path}.${keyword}[${index}]`);
      });
    }
  }
}
