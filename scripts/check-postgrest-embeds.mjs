// Static check for ambiguous PostgREST embeds (error PGRST201).
//
// A Supabase select such as `.from("reminder_deliveries").select("id, occurrences!inner(local_date)")`
// fails at run time when the two tables are linked by more than one foreign key and the
// embed does not name one (`occurrences!<fk_name>!inner(...)`). Commit d13b715e fixed such
// a query in lib/db/coach-signals.repo.ts. This check reads every foreign key from the
// generated lib/db/database.types.ts and every statically resolvable select string under
// the scanned folders, and fails on an embed whose table pair is ambiguous.
//
// Usage:
//   node scripts/check-postgrest-embeds.mjs            scan the repository (run by resolvers:check)
//   node scripts/check-postgrest-embeds.mjs --list     print table pairs with more than one foreign key
//   node scripts/check-postgrest-embeds.mjs --verbose  also list every select call that was not analysed
//   node scripts/check-postgrest-embeds.mjs <file>...  check only these files (no fixture assertion)
//
// Limits: many-to-many embeds through a junction table and computed relationships are not
// modelled. An embed whose pair has no direct foreign key is counted as "not analysed".
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export const TYPES_FILE = "lib/db/database.types.ts";
export const SCAN_DIRS = ["lib/db", "lib/services", "lib/integrations", "lib/mcp", "app"];
export const NEGATIVE_FIXTURE = "tests/fixtures/governance/postgrest-embed-ambiguous.ts.txt";

// Known ambiguous embeds on main that are not fixed yet. Each entry needs a comment with
// the reason and the follow-up. Keys: "<file>|<parent table>|<embedded table>".
export const ALLOWLIST = new Map([]);

const MODIFIERS = new Set(["inner", "left"]);
const AGGREGATES = new Set(["count", "sum", "avg", "min", "max"]);

// ---------------------------------------------------------------------------
// Relationship graph from the generated Database type.
// ---------------------------------------------------------------------------

function literalText(typeNode) {
  if (typeNode && ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) return typeNode.literal.text;
  return null;
}

function literalList(typeNode) {
  if (!typeNode || !ts.isTupleTypeNode(typeNode)) return null;
  const values = typeNode.elements.map(literalText);
  return values.every((value) => value !== null) ? values : null;
}

function members(typeNode) {
  const result = new Map();
  if (!typeNode || !ts.isTypeLiteralNode(typeNode)) return result;
  for (const member of typeNode.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : null;
    if (name) result.set(name, member.type);
  }
  return result;
}

/**
 * Reads `Database["public"]` Tables and Views and their `Relationships` arrays.
 * Returns the relation names (with kind) and one record per foreign key.
 */
export function parseRelationships(typesSource, schema = "public") {
  const source = ts.createSourceFile("database.types.ts", typesSource, ts.ScriptTarget.Latest, true);
  let databaseType = null;
  for (const statement of source.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === "Database") databaseType = statement.type;
  }
  if (!databaseType) throw new Error("database.types.ts has no `Database` type alias.");
  const schemaType = members(databaseType).get(schema);
  if (!schemaType) throw new Error(`database.types.ts has no "${schema}" schema.`);
  const relations = new Map();
  const foreignKeys = [];
  for (const kind of ["Tables", "Views"]) {
    for (const [relation, relationType] of members(members(schemaType).get(kind))) {
      relations.set(relation, kind === "Tables" ? "table" : "view");
      const relationships = members(relationType).get("Relationships");
      if (!relationships || !ts.isTupleTypeNode(relationships)) continue;
      for (const element of relationships.elements) {
        const fields = members(element);
        const foreignKeyName = literalText(fields.get("foreignKeyName"));
        const referencedRelation = literalText(fields.get("referencedRelation"));
        const columns = literalList(fields.get("columns"));
        const referencedColumns = literalList(fields.get("referencedColumns"));
        if (!foreignKeyName || !referencedRelation || !columns || !referencedColumns) {
          throw new Error(`database.types.ts: unreadable relationship on ${relation}.`);
        }
        foreignKeys.push({ relation, foreignKeyName, columns, referencedRelation, referencedColumns });
      }
    }
  }
  return { relations, foreignKeys };
}

function pairKey(a, b) {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * Undirected map from a pair of relations to the foreign keys between them, in either
 * direction. `candidates(parent, child)` lists the relationships PostgREST considers when
 * `child` is embedded under `parent`: a self-referencing key counts once per direction.
 */
export function buildRelationshipGraph({ relations, foreignKeys }) {
  const pairs = new Map();
  for (const foreignKey of foreignKeys) {
    const key = pairKey(foreignKey.relation, foreignKey.referencedRelation);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(foreignKey);
  }
  function candidates(parent, child) {
    const list = [];
    for (const foreignKey of pairs.get(pairKey(parent, child)) ?? []) {
      if (foreignKey.relation === parent && foreignKey.referencedRelation === child) {
        list.push({ ...foreignKey, direction: "many-to-one" });
      }
      if (foreignKey.relation === child && foreignKey.referencedRelation === parent) {
        list.push({ ...foreignKey, direction: "one-to-many" });
      }
    }
    return list;
  }
  function ambiguousPairs() {
    const result = [];
    for (const list of pairs.values()) {
      const [a, b] = [list[0].relation, list[0].referencedRelation].sort();
      const count = candidates(a, b).length;
      if (count > 1) result.push({ a, b, foreignKeys: list });
    }
    return result.sort((x, y) => `${x.a} ${x.b}`.localeCompare(`${y.a} ${y.b}`));
  }
  return { relations, candidates, ambiguousPairs, hasRelation: (name) => relations.has(name) };
}

// ---------------------------------------------------------------------------
// PostgREST select grammar.
// ---------------------------------------------------------------------------

export class SelectParseError extends Error {}

function splitAlias(head) {
  for (let index = 0; index < head.length; index += 1) {
    if (head[index] !== ":") continue;
    if (head[index + 1] === ":") return { alias: null, rest: head };
    return { alias: head.slice(0, index), rest: head.slice(index + 1) };
  }
  return { alias: null, rest: head };
}

function unquote(name) {
  return name.length >= 2 && name.startsWith("\"") && name.endsWith("\"") ? name.slice(1, -1) : name;
}

/**
 * Parses a PostgREST `select` string into items:
 *   { kind: "star" }
 *   { kind: "field", alias, name, cast, json }
 *   { kind: "aggregate", alias, name, cast }
 *   { kind: "embed", alias, name, spread, hint, hints, modifiers, children, start, end, head }
 * `start`/`end` are offsets of the whole embed in the input; `head` is its text before "(".
 */
export function parseSelect(text) {
  let position = 0;

  function readHead() {
    const begin = position;
    let quoted = false;
    while (position < text.length) {
      const char = text[position];
      if (char === "\"") quoted = !quoted;
      else if (!quoted && (char === "," || char === "(" || char === ")")) break;
      position += 1;
    }
    if (quoted) throw new SelectParseError(`unclosed quote at offset ${begin}`);
    return { raw: text.slice(begin, position), begin };
  }

  function stripWhitespace(value) {
    let result = "";
    let quoted = false;
    for (const char of value) {
      if (char === "\"") quoted = !quoted;
      if (quoted || !/\s/.test(char)) result += char;
    }
    return result;
  }

  function readCast() {
    const match = /^\s*::\s*([A-Za-z_][\w ]*?)\s*(?=[,)]|$)/.exec(text.slice(position));
    if (!match) return null;
    position += match[0].length;
    return match[1];
  }

  function parseList(nested) {
    const items = [];
    for (;;) {
      const item = parseItem();
      if (item) items.push(item);
      // Whitespace may follow an item, for example a newline after the last embed.
      while (position < text.length && /\s/.test(text[position])) position += 1;
      if (position >= text.length) {
        if (nested) throw new SelectParseError("missing closing parenthesis");
        return items;
      }
      const char = text[position];
      if (char === ",") {
        position += 1;
        continue;
      }
      if (char === ")") {
        if (!nested) throw new SelectParseError(`unexpected ")" at offset ${position}`);
        return items;
      }
      throw new SelectParseError(`unexpected "${char}" at offset ${position}`);
    }
  }

  function parseItem() {
    const { raw, begin } = readHead();
    const head = stripWhitespace(raw);
    const leading = raw.length - raw.trimStart().length;
    if (text[position] === "(") {
      position += 1;
      const children = parseList(true);
      position += 1; // ")"
      const end = position;
      const cast = readCast();
      const spread = head.startsWith("...");
      const { alias, rest } = splitAlias(spread ? head.slice(3) : head);
      const [rawName, ...bangs] = rest.split("!");
      const name = unquote(rawName);
      if (!name) throw new SelectParseError(`embed without a name at offset ${begin}`);
      const dot = name.lastIndexOf(".");
      const aggregateName = dot >= 0 ? name.slice(dot + 1) : name;
      if (children.length === 0 && bangs.length === 0 && !spread && AGGREGATES.has(aggregateName) && (dot >= 0 || name === "count")) {
        return { kind: "aggregate", alias, name, cast };
      }
      const modifiers = bangs.filter((bang) => MODIFIERS.has(bang));
      const hints = bangs.filter((bang) => !MODIFIERS.has(bang)).map(unquote);
      if (hints.some((hint) => hint === "")) throw new SelectParseError(`empty "!" hint at offset ${begin}`);
      return {
        kind: "embed", alias, name, spread, hint: hints[0] ?? null, hints, modifiers, children,
        start: begin + leading, end, head: raw.trim(), raw: text.slice(begin + leading, end), cast,
      };
    }
    if (head === "") {
      if (text[position] === "," || position >= text.length && begin > 0) {
        throw new SelectParseError(`empty item at offset ${begin}`);
      }
      return null;
    }
    if (head === "*") return { kind: "star" };
    const { alias, rest } = splitAlias(head);
    const castIndex = rest.indexOf("::");
    const withoutCast = castIndex >= 0 ? rest.slice(0, castIndex) : rest;
    const cast = castIndex >= 0 ? rest.slice(castIndex + 2) : null;
    const arrow = withoutCast.indexOf("->");
    const name = unquote(arrow >= 0 ? withoutCast.slice(0, arrow) : withoutCast);
    const json = arrow >= 0 ? withoutCast.slice(arrow) : null;
    if (!name) throw new SelectParseError(`field without a name at offset ${begin}`);
    return { kind: "field", alias, name, cast, json };
  }

  const items = parseList(false);
  if (items.length === 0 && text.trim() !== "") throw new SelectParseError("no items");
  return items;
}

/** Every embed in a parsed select, depth first, with the embed it sits in. */
export function listEmbeds(items, parent = null, out = []) {
  for (const item of items) {
    if (item.kind !== "embed") continue;
    out.push({ embed: item, parent });
    listEmbeds(item.children, item, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Embed rule.
// ---------------------------------------------------------------------------

function correctedHead(embed, foreignKeyName) {
  const prefix = `${embed.spread ? "..." : ""}${embed.alias ? `${embed.alias}:` : ""}${embed.name}`;
  return `${prefix}!${foreignKeyName}${embed.modifiers.map((modifier) => `!${modifier}`).join("")}`;
}

/**
 * Checks each embed of a parsed select against the relationship graph.
 * Returns { issues, skipped, checked } where each issue names the parent, the embedded
 * table, the candidate keys and corrected heads.
 */
export function checkSelect(items, rootTable, graph) {
  const issues = [];
  const skipped = [];
  let checked = 0;
  function visit(list, parentTable) {
    for (const item of list) {
      if (item.kind !== "embed") continue;
      if (parentTable === null) {
        skipped.push({ embed: item, reason: "embedded under a relation the check could not identify" });
        visit(item.children, null);
        continue;
      }
      if (!graph.hasRelation(item.name)) {
        skipped.push({ embed: item, reason: `"${item.name}" is not a table or view in ${TYPES_FILE}` });
        visit(item.children, null);
        continue;
      }
      const candidates = graph.candidates(parentTable, item.name);
      if (candidates.length === 0) {
        skipped.push({ embed: item, reason: "no direct foreign key (many-to-many or computed relationship)" });
        visit(item.children, item.name);
        continue;
      }
      checked += 1;
      const names = [...new Set(candidates.map((candidate) => candidate.foreignKeyName))];
      const base = { embed: item, parent: parentTable, child: item.name, candidates: names };
      if (item.hints.length > 1) {
        issues.push({ ...base, problem: `has more than one "!" hint (${item.hints.join(", ")})` });
      } else if (item.hint !== null) {
        const matched = new Set(candidates
          .filter((candidate) => candidate.foreignKeyName === item.hint || candidate.columns.includes(item.hint))
          .map((candidate) => candidate.foreignKeyName));
        if (matched.size === 0) {
          issues.push({ ...base, problem: `hint "!${item.hint}" matches no foreign key between ${parentTable} and ${item.name}` });
        } else if (matched.size > 1) {
          issues.push({ ...base, candidates: [...matched], problem: `hint "!${item.hint}" matches more than one foreign key` });
        }
      } else if (candidates.length > 1) {
        issues.push({ ...base, problem: `has no foreign key hint and ${parentTable} and ${item.name} are linked by ${candidates.length} relationships` });
      }
      visit(item.children, item.name);
    }
  }
  visit(items, rootTable);
  for (const issue of issues) {
    const { embed } = issue;
    issue.corrections = issue.candidates.map((name) => correctedHead(embed, name) + embed.raw.slice(embed.head.length));
  }
  return { issues, skipped, checked };
}

// ---------------------------------------------------------------------------
// Finding `.from("<table>")…select(<arg>)` chains with the TypeScript compiler API.
// ---------------------------------------------------------------------------

const NOT_FOUND = Symbol("not found");

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isAwaitExpression(node)
    || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node)))) {
    node = node.expression;
  }
  return node;
}

function findDeclarationInStatements(statements, name) {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return { kind: "variable", declaration };
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return { kind: "function", declaration: statement };
    } else if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings
      && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (element.name.text === name) {
          return {
            kind: "import",
            specifier: statement.moduleSpecifier.text,
            importedName: (element.propertyName ?? element.name).text,
          };
        }
      }
    }
  }
  return null;
}

function functionDeclaresName(node, name) {
  if (!ts.isFunctionLike(node)) return false;
  return node.parameters.some((parameter) => {
    const found = [];
    (function collect(binding) {
      if (ts.isIdentifier(binding)) found.push(binding.text);
      else for (const element of binding.elements ?? []) if (!ts.isOmittedExpression(element)) collect(element.name);
    })(parameter.name);
    return found.includes(name);
  });
}

class Resolver {
  constructor(root, readSource) {
    this.root = root;
    this.readSource = readSource;
    this.cache = new Map();
  }

  sourceFile(file) {
    if (!this.cache.has(file)) {
      const text = this.readSource(file);
      this.cache.set(file, text === null ? null : ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
    }
    return this.cache.get(file);
  }

  resolveModule(fromFile, specifier) {
    let base;
    if (specifier.startsWith("@/")) base = path.join(this.root, specifier.slice(2));
    else if (specifier.startsWith(".")) base = path.resolve(path.dirname(fromFile), specifier);
    else return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (/\.tsx?$/.test(candidate) && this.sourceFile(candidate)) return candidate;
    }
    return null;
  }

  /** The declaration an identifier refers to, searching enclosing scopes then imports. */
  lookup(identifier, depth) {
    const name = identifier.text;
    for (let node = identifier.parent; node; node = node.parent) {
      if (functionDeclaresName(node, name)) return { kind: "parameter" };
      const statements = ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node) || ts.isCaseClause(node)
        || ts.isDefaultClause(node) ? node.statements : null;
      if (!statements) continue;
      const found = findDeclarationInStatements(statements, name);
      if (!found) continue;
      if (found.kind !== "import") return { ...found, file: node.getSourceFile().fileName };
      const target = this.resolveModule(node.getSourceFile().fileName, found.specifier);
      if (!target || depth > 8) return { kind: "external" };
      const targetSource = this.sourceFile(target);
      const exported = findDeclarationInStatements(targetSource.statements, found.importedName);
      if (!exported || exported.kind === "import") return { kind: "external" };
      return { ...exported, file: target };
    }
    return null;
  }

  /** Static string value of an expression, or NOT_FOUND. Records where an identifier came from. */
  evaluateString(node, depth = 0, origin = {}) {
    node = unwrap(node);
    if (!node || depth > 12) return NOT_FOUND;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.evaluateString(node.left, depth + 1, origin);
      const right = left === NOT_FOUND ? NOT_FOUND : this.evaluateString(node.right, depth + 1, origin);
      return right === NOT_FOUND ? NOT_FOUND : left + right;
    }
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        const value = this.evaluateString(span.expression, depth + 1, origin);
        if (value === NOT_FOUND) return NOT_FOUND;
        result += value + span.literal.text;
      }
      return result;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "join") {
      const array = unwrap(node.expression.expression);
      if (!ts.isArrayLiteralExpression(array)) return NOT_FOUND;
      const separator = node.arguments.length === 0 ? "," : this.evaluateString(node.arguments[0], depth + 1, origin);
      if (separator === NOT_FOUND) return NOT_FOUND;
      const parts = array.elements.map((element) => this.evaluateString(element, depth + 1, origin));
      return parts.includes(NOT_FOUND) ? NOT_FOUND : parts.join(separator);
    }
    if (ts.isIdentifier(node)) {
      const found = this.lookup(node, depth);
      if (found?.kind !== "variable" || !found.declaration.initializer) return NOT_FOUND;
      if (!origin.identifier) {
        origin.identifier = node.text;
        origin.file = found.file;
        origin.line = lineOf(found.declaration);
      }
      return this.evaluateString(found.declaration.initializer, depth + 1, origin);
    }
    return NOT_FOUND;
  }

  /** The relation a query builder reads from: { table } | { rpc } | { unknown: reason }. */
  resolveTarget(node, depth = 0) {
    node = unwrap(node);
    if (!node || depth > 24) return { unknown: "query chain too deep or empty" };
    if (ts.isConditionalExpression(node)) {
      const whenTrue = this.resolveTarget(node.whenTrue, depth + 1);
      const whenFalse = this.resolveTarget(node.whenFalse, depth + 1);
      if (whenTrue.table && whenTrue.table === whenFalse.table) return whenTrue;
      return whenTrue.unknown ? whenTrue : whenFalse.unknown ? whenFalse : { unknown: "conditional query with different tables" };
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        if (method === "from") {
          const table = node.arguments[0] ? this.evaluateString(node.arguments[0]) : NOT_FOUND;
          if (table === NOT_FOUND) return { unknown: ".from() table name is not static" };
          const schema = this.schemaOf(callee.expression, depth + 1);
          if (schema && schema !== "public") return { unknown: `schema "${schema}" is not in ${TYPES_FILE}` };
          return { table };
        }
        if (method === "rpc") return { rpc: true };
        return this.resolveTarget(callee.expression, depth + 1);
      }
      if (ts.isIdentifier(callee)) {
        const found = this.lookup(callee, depth);
        const body = functionBodyExpression(found);
        if (body) return this.resolveTarget(body, depth + 1);
        return { unknown: `query comes from ${callee.text}(), which the check cannot follow` };
      }
      return { unknown: "query comes from a call the check cannot follow" };
    }
    if (ts.isIdentifier(node)) {
      const found = this.lookup(node, depth);
      if (found?.kind === "variable" && found.declaration.initializer) {
        return this.resolveTarget(found.declaration.initializer, depth + 1);
      }
      if (found?.kind === "parameter") return { unknown: `query builder is the parameter ${node.text}` };
      return { unknown: `query builder ${node.text} is not a local variable` };
    }
    return { unknown: "query receiver is not a call chain" };
  }

  schemaOf(node, depth) {
    node = unwrap(node);
    while (node && ts.isCallExpression(node) && depth < 24) {
      const callee = unwrap(node.expression);
      if (!ts.isPropertyAccessExpression(callee)) return null;
      if (callee.name.text === "schema") {
        const value = node.arguments[0] ? this.evaluateString(node.arguments[0]) : NOT_FOUND;
        return value === NOT_FOUND ? "<unknown>" : value;
      }
      node = unwrap(callee.expression);
      depth += 1;
    }
    return null;
  }
}

function functionBodyExpression(found) {
  if (!found) return null;
  let fn = null;
  if (found.kind === "function") fn = found.declaration;
  else if (found.kind === "variable") {
    const initializer = unwrap(found.declaration.initializer);
    if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) fn = initializer;
  }
  if (!fn?.body) return null;
  if (!ts.isBlock(fn.body)) return fn.body;
  const returns = fn.body.statements.filter(ts.isReturnStatement);
  return returns.length === 1 && fn.body.statements.length === 1 ? returns[0].expression : null;
}

function lineOf(node) {
  const source = node.getSourceFile();
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * Analyses one source file. Returns one record per `.select(...)` call:
 *   { line, status: "ok" | "issue" | "not_analysed", reason?, table?, issues?, embeds }
 */
export function analyseFile(file, resolver, graph) {
  const source = resolver.sourceFile(file);
  const calls = [];
  if (!source) return calls;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "select") {
      calls.push(analyseCall(node, resolver, graph));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return calls;
}

function analyseCall(node, resolver, graph) {
  const line = lineOf(node.expression.name);
  const origin = {};
  const text = node.arguments.length === 0 ? "*" : resolver.evaluateString(node.arguments[0], 0, origin);
  if (text === NOT_FOUND) return { line, status: "not_analysed", reason: "select text is not a static string" };
  let items;
  try {
    items = parseSelect(text);
  } catch (error) {
    if (!(error instanceof SelectParseError)) throw error;
    return { line, status: "issue", text, origin, parseError: error.message, issues: [] };
  }
  const embeds = listEmbeds(items).length;
  if (embeds === 0) return { line, status: "ok", text, embeds };
  const target = resolver.resolveTarget(node.expression.expression);
  if (target.rpc) return { line, status: "not_analysed", reason: "embed on an .rpc() result", embeds };
  if (!target.table) return { line, status: "not_analysed", reason: target.unknown, embeds };
  if (!graph.hasRelation(target.table)) {
    return { line, status: "not_analysed", reason: `"${target.table}" is not a table or view in ${TYPES_FILE}`, embeds };
  }
  const result = checkSelect(items, target.table, graph);
  return {
    line, text, origin, table: target.table, embeds, checked: result.checked, skipped: result.skipped,
    status: result.issues.length > 0 ? "issue" : "ok", issues: result.issues,
  };
}

// ---------------------------------------------------------------------------
// Repository run.
// ---------------------------------------------------------------------------

function walkSources(root, relativeDir) {
  const start = path.join(root, relativeDir);
  if (!fs.existsSync(start)) return [];
  const results = [];
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") stack.push(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        results.push(full);
      }
    }
  }
  return results.sort();
}

export function createResolver(root) {
  return new Resolver(root, (file) => (fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file, "utf8") : null));
}

export function loadGraph(root) {
  return buildRelationshipGraph(parseRelationships(fs.readFileSync(path.join(root, TYPES_FILE), "utf8")));
}

function formatIssue(root, relativeFile, call, issue) {
  const where = call.origin?.identifier
    ? ` (select text from ${call.origin.identifier}, ${path.relative(root, call.origin.file)}:${call.origin.line})`
    : "";
  if (call.parseError) {
    return `${relativeFile}:${call.line}${where}: cannot parse select text "${call.text}": ${call.parseError}. Fix the select string, or fix the parser in scripts/check-postgrest-embeds.mjs if the text is valid PostgREST.`;
  }
  return [
    `${relativeFile}:${call.line}${where}: embed of ${issue.child} under ${issue.parent} ${issue.problem} (PGRST201 at run time).`,
    `    found:   ${issue.embed.raw}`,
    `    foreign keys: ${issue.candidates.join(", ")}`,
    `    fix: name the foreign key, for example ${issue.corrections.join("  or  ")}`,
  ].join("\n");
}

export function checkFiles(root, files, { graph = loadGraph(root), resolver = createResolver(root) } = {}) {
  const failures = [];
  const allowed = [];
  const notAnalysed = new Map();
  const notAnalysedCalls = [];
  let analysed = 0;
  let withEmbeds = 0;
  let embedsChecked = 0;
  let embedsSkipped = 0;
  for (const file of files) {
    const relativeFile = path.relative(root, file);
    for (const call of analyseFile(file, resolver, graph)) {
      if (call.status === "not_analysed") {
        notAnalysed.set(call.reason, (notAnalysed.get(call.reason) ?? 0) + 1);
        notAnalysedCalls.push(`${relativeFile}:${call.line}: ${call.reason}`);
        continue;
      }
      analysed += 1;
      if (call.embeds) withEmbeds += 1;
      embedsChecked += call.checked ?? 0;
      for (const skipped of call.skipped ?? []) {
        embedsSkipped += 1;
        notAnalysedCalls.push(`${relativeFile}:${call.line}: embed ${skipped.embed.head} not analysed: ${skipped.reason}`);
      }
      if (call.parseError) failures.push(formatIssue(root, relativeFile, call, null));
      for (const issue of call.issues ?? []) {
        const key = `${relativeFile}|${issue.parent}|${issue.child}`;
        if (ALLOWLIST.has(key)) allowed.push(`${relativeFile}:${call.line}: ${key} (${ALLOWLIST.get(key)})`);
        else failures.push(formatIssue(root, relativeFile, call, issue));
      }
    }
  }
  return { failures, allowed, notAnalysed, notAnalysedCalls, analysed, withEmbeds, embedsChecked, embedsSkipped };
}

function main(argv) {
  const started = performance.now();
  const root = process.cwd();
  const listMode = argv.includes("--list");
  const verbose = argv.includes("--verbose");
  const explicitFiles = argv.filter((arg) => !arg.startsWith("--")).map((file) => path.resolve(root, file));
  const graph = loadGraph(root);

  if (listMode) {
    console.log(`Table pairs in ${TYPES_FILE} with more than one relationship (an embed between them needs a "!<foreign key>" hint):`);
    for (const pair of graph.ambiguousPairs()) {
      const label = pair.a === pair.b ? " (self-referencing: each key links both directions)" : "";
      console.log(`- ${pair.a} <-> ${pair.b}${label}`);
      for (const foreignKey of pair.foreignKeys) {
        console.log(`    ${foreignKey.foreignKeyName}: ${foreignKey.relation}(${foreignKey.columns.join(", ")}) -> ${foreignKey.referencedRelation}(${foreignKey.referencedColumns.join(", ")})`);
      }
    }
    return 0;
  }

  const resolver = createResolver(root);
  const files = explicitFiles.length > 0 ? explicitFiles : SCAN_DIRS.flatMap((dir) => walkSources(root, dir));
  const result = checkFiles(root, files, { graph, resolver });

  if (explicitFiles.length === 0) {
    const fixture = path.join(root, NEGATIVE_FIXTURE);
    const fixtureResult = fs.existsSync(fixture) ? checkFiles(root, [fixture], { graph, resolver }) : null;
    const expected = fixtureResult?.failures.length === 1
      && fixtureResult.failures[0].includes("embed of occurrences under reminder_deliveries");
    if (!expected) {
      result.failures.push(`${NEGATIVE_FIXTURE} must remain a negative fixture: the check must report its ambiguous occurrences embed. If the fixture changed, restore it; if the check changed, fix it.`);
    }
  }

  const elapsed = Math.round(performance.now() - started);
  const reasons = [...result.notAnalysed].map(([reason, count]) => `${count} ${reason}`).join("; ");
  const total = result.analysed + [...result.notAnalysed.values()].reduce((sum, count) => sum + count, 0);
  const summary = `postgrest-embeds: ${total} select calls in ${files.length} files; ${result.analysed} analysed`
    + ` (${result.withEmbeds} with embeds, ${result.embedsChecked} embeds checked, ${result.embedsSkipped} embeds skipped);`
    + ` ${total - result.analysed} not analysed${reasons ? ` (${reasons})` : ""}; ${elapsed} ms.`;

  if (verbose) for (const line of result.notAnalysedCalls) console.log(`not analysed: ${line}`);
  for (const line of result.allowed) console.log(`allowlisted: ${line}`);
  if (result.failures.length > 0) {
    console.error(`check-postgrest-embeds failed with ${result.failures.length} issue(s):`);
    for (const failure of result.failures) console.error(`- ${failure}`);
    console.error(summary);
    console.error(`Run \`node scripts/check-postgrest-embeds.mjs --list\` to see every ambiguous table pair.`);
    return 1;
  }
  console.log(summary);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
