/**
 * Minimal JSON Schema 2020-12 builder for the integration contract.
 *
 * Each builder returns the published JSON Schema object plus a phantom
 * TypeScript type, so the schema is the single source for both the wire
 * contract and the static types. No schema is maintained twice.
 */

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

export type JsonSchemaValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonSchemaValue[]
  | { readonly [key: string]: JsonSchemaValue };

export type JsonSchemaObject = { readonly [key: string]: JsonSchemaValue };

export type SchemaNode<T> = {
  readonly kind: "schema";
  readonly schema: JsonSchemaObject;
  /** Phantom field that carries the inferred type. Never set at runtime. */
  readonly __type?: T;
};

export type OptionalNode<T> = {
  readonly kind: "optional";
  readonly node: SchemaNode<T>;
};

export type Infer<N> = N extends SchemaNode<infer T> ? T : never;

type Shape = { readonly [key: string]: SchemaNode<unknown> | OptionalNode<unknown> };

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type RequiredKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends OptionalNode<unknown> ? never : K;
}[keyof S];

type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends OptionalNode<unknown> ? K : never;
}[keyof S];

type InferMember<M> = M extends OptionalNode<infer T>
  ? T
  : M extends SchemaNode<infer T>
    ? T
    : never;

export type InferShape<S extends Shape> = Simplify<
  { [K in RequiredKeys<S>]: InferMember<S[K]> } & {
    [K in OptionalKeys<S>]?: InferMember<S[K]>;
  }
>;

type Annotations = { description?: string; title?: string };

function node<T>(schema: JsonSchemaObject): SchemaNode<T> {
  return Object.freeze({ kind: "schema", schema: deepFreeze(schema) }) as SchemaNode<T>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function annotations(options: Annotations | undefined): JsonSchemaObject {
  const result: Record<string, JsonSchemaValue> = {};
  if (options?.title !== undefined) result.title = options.title;
  if (options?.description !== undefined) result.description = options.description;
  return result;
}

export type StringOptions = Annotations & {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: "date" | "date-time" | "uuid" | "uri";
  examples?: readonly string[];
};

export function string(options: StringOptions = {}): SchemaNode<string> {
  const schema: Record<string, JsonSchemaValue> = { type: "string", ...annotations(options) };
  if (options.format !== undefined) schema.format = options.format;
  if (options.minLength !== undefined) schema.minLength = options.minLength;
  if (options.maxLength !== undefined) schema.maxLength = options.maxLength;
  if (options.pattern !== undefined) schema.pattern = options.pattern;
  if (options.examples !== undefined) schema.examples = [...options.examples];
  return node(schema);
}

export function literal<const V extends string | number | boolean>(
  value: V,
  options: Annotations = {},
): SchemaNode<V> {
  const type = typeof value === "string" ? "string" : typeof value === "boolean" ? "boolean" : "integer";
  return node({ type, const: value, ...annotations(options) });
}

export function enumOf<const V extends readonly string[]>(
  values: V,
  options: Annotations & { default?: V[number] } = {},
): SchemaNode<V[number]> {
  const schema: Record<string, JsonSchemaValue> = {
    type: "string",
    enum: [...values],
    ...annotations(options),
  };
  if (options.default !== undefined) schema.default = options.default;
  return node(schema);
}

export function integerEnum<const V extends readonly number[]>(
  values: V,
  options: Annotations & { default?: V[number] } = {},
): SchemaNode<V[number]> {
  const schema: Record<string, JsonSchemaValue> = {
    type: "integer",
    enum: [...values],
    ...annotations(options),
  };
  if (options.default !== undefined) schema.default = options.default;
  return node(schema);
}

export function integer(
  options: Annotations & { minimum?: number; maximum?: number; default?: number } = {},
): SchemaNode<number> {
  const schema: Record<string, JsonSchemaValue> = { type: "integer", ...annotations(options) };
  if (options.minimum !== undefined) schema.minimum = options.minimum;
  if (options.maximum !== undefined) schema.maximum = options.maximum;
  if (options.default !== undefined) schema.default = options.default;
  return node(schema);
}

export function number(
  options: Annotations & { minimum?: number; maximum?: number } = {},
): SchemaNode<number> {
  const schema: Record<string, JsonSchemaValue> = { type: "number", ...annotations(options) };
  if (options.minimum !== undefined) schema.minimum = options.minimum;
  if (options.maximum !== undefined) schema.maximum = options.maximum;
  return node(schema);
}

export function boolean(options: Annotations & { default?: boolean } = {}): SchemaNode<boolean> {
  const schema: Record<string, JsonSchemaValue> = { type: "boolean", ...annotations(options) };
  if (options.default !== undefined) schema.default = options.default;
  return node(schema);
}

/** Allows `null` in addition to the wrapped schema. */
export function nullable<T>(inner: SchemaNode<T>, options: Annotations = {}): SchemaNode<T | null> {
  const { description, title, ...rest } = inner.schema;
  const outer: Record<string, JsonSchemaValue> = {};
  const outerTitle = options.title ?? title;
  const outerDescription = options.description ?? description;
  if (outerTitle !== undefined) outer.title = outerTitle;
  if (outerDescription !== undefined) outer.description = outerDescription;
  const type = rest.type;
  if (typeof type === "string" && rest.const === undefined && type !== "object" && type !== "array") {
    const schema: Record<string, JsonSchemaValue> = { ...rest, type: [type, "null"], ...outer };
    if (Array.isArray(rest.enum)) schema.enum = [...(rest.enum as JsonSchemaValue[]), null];
    return node(schema);
  }
  return node({ ...outer, anyOf: [rest, { type: "null" }] });
}

export function array<T>(
  items: SchemaNode<T>,
  options: Annotations & { minItems?: number; maxItems?: number; uniqueItems?: boolean } = {},
): SchemaNode<T[]> {
  const schema: Record<string, JsonSchemaValue> = {
    type: "array",
    ...annotations(options),
    items: items.schema,
  };
  if (options.minItems !== undefined) schema.minItems = options.minItems;
  if (options.maxItems !== undefined) schema.maxItems = options.maxItems;
  if (options.uniqueItems) schema.uniqueItems = true;
  return node(schema);
}

export function optional<T>(inner: SchemaNode<T>): OptionalNode<T> {
  return Object.freeze({ kind: "optional", node: inner });
}

export type ObjectOptions = Annotations & {
  /**
   * At least one of these property names must be present. Emitted as
   * `anyOf` with `required` branches.
   */
  requireOneOf?: readonly string[];
};

export function object<const S extends Shape>(
  shape: S,
  options: ObjectOptions = {},
): SchemaNode<InferShape<S>> {
  const properties: Record<string, JsonSchemaValue> = {};
  const required: string[] = [];
  for (const [key, member] of Object.entries(shape)) {
    if (member.kind === "optional") {
      properties[key] = member.node.schema;
    } else {
      properties[key] = member.schema;
      required.push(key);
    }
  }
  const schema: Record<string, JsonSchemaValue> = {
    type: "object",
    ...annotations(options),
    properties,
    required,
    additionalProperties: false,
  };
  if (options.requireOneOf?.length) {
    schema.anyOf = options.requireOneOf.map((key) => ({ required: [key] }));
  }
  return node(schema);
}

type UnionOf<N extends readonly SchemaNode<unknown>[]> = N[number] extends SchemaNode<infer T>
  ? T
  : never;

/** Exactly one branch must match. Branches should be distinguishable by `const` or required keys. */
export function oneOf<const N extends readonly SchemaNode<unknown>[]>(
  branches: N,
  options: Annotations = {},
): SchemaNode<UnionOf<N>> {
  return node({ ...annotations(options), oneOf: branches.map((branch) => branch.schema) });
}

/** Adds the 2020-12 dialect marker to a root schema. */
export function root<T>(inner: SchemaNode<T>): SchemaNode<T> {
  return node({ $schema: JSON_SCHEMA_DIALECT, ...inner.schema });
}
