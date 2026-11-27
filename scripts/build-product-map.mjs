#!/usr/bin/env node
// Builds Cadence's product map: one graph that joins the repository's registries.
// Deterministic: no model, no network, no timestamps. Same inputs give the same output.
//
//   node scripts/build-product-map.mjs check          build in memory, fail on errors
//   node scripts/build-product-map.mjs build          also write product-map.json, docs/PRODUCT_MAP.md and docs/NOTICES.md
//   node scripts/build-product-map.mjs show <id|text> print one item and its links
//
// check and build also apply the warning ratchet in scripts/product-map-warning-baseline.json:
// a ratcheted category fails when it has more warnings than the baseline. build (or
// check --lower-baseline) lowers the baseline; --baseline <path> reads another file.
//
// Every link names the registry entry it came from by a stable id (never an array
// position). "asserted" links are written in a registry by a person; "derived" links
// come from scanning source code. See docs/PRODUCT_MAP_GUIDE.md.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = 1;

/** Kinds whose items must carry a meaning sentence. */
const MEANING_REQUIRED = new Set(["journey", "feature", "interaction", "component", "family", "term", "mcp-tool", "notice", "avatar"]);
/** Token meanings are required only in the canonical token file; other token files warn. */
const CANONICAL_TOKEN_FILE = "packages/ui/tokens.css";

const SCAN_ROOTS = ["app", "components", "lib", "apps/desktop/src", "packages/core/src", "packages/ui", "packages/mcp-views/src"];
const SCAN_EXCLUDE = [/(^|\/)node_modules\//, /\.test\.tsx?$/, /\.d\.ts$/, /(^|\/)__fixtures__\//, /^apps\/desktop\/src-tauri\//];

const read = path => readFileSync(join(root, path), "utf8");
const readJson = path => JSON.parse(read(path));
const exists = path => existsSync(join(root, path));
const isFile = path => exists(path) && statSync(join(root, path)).isFile();

// ---------------------------------------------------------------------------
// Graph

const nodes = new Map();
const links = new Map();
const errors = [];
const warnings = new Map(); // category -> messages
const sources = new Set();

function warn(category, message) {
  if (!warnings.has(category)) warnings.set(category, []);
  warnings.get(category).push(message);
}

function addNode(id, kind, fields, source) {
  if (nodes.has(id)) {
    errors.push(`Duplicate id ${id} (${source}; first from ${nodes.get(id).source})`);
    return nodes.get(id);
  }
  const node = { id, kind, ...fields, source };
  nodes.set(id, node);
  return node;
}

function addLink(from, type, to, grade, source) {
  const key = `${from}\u0000${type}\u0000${to}`;
  if (!links.has(key)) links.set(key, { from, type, to, grade, source });
}

function stripAnchor(reference) {
  const index = reference.indexOf("#");
  return index === -1 ? reference : reference.slice(0, index);
}

function fileKind(path) {
  if (/^tests\//.test(path) || /\.test\.tsx?$/.test(path)) return "test";
  if (/^app\/api\/.+\/route\.tsx?$/.test(path)) return "api";
  if (/^lib\/services\//.test(path) || /^packages\/core\/src\/services\//.test(path)) return "service";
  if (/^lib\/db\//.test(path)) return "repository";
  return "file";
}

function apiPath(path) {
  return "/" + path.replace(/^app\//, "").replace(/\/route\.tsx?$/, "");
}

/** Returns the node id for a repository file, creating the node on first use. */
function fileNode(path) {
  const kind = fileKind(path);
  const id = kind === "api" ? `api:${apiPath(path)}` : `${kind}:${path}`;
  if (!nodes.has(id)) addNode(id, kind, { name: kind === "api" ? apiPath(path) : path, path }, "repository file");
  return id;
}

/** Links to a referenced path when it exists; returns the node id or null. */
function referencedFile(reference, category, context) {
  const path = stripAnchor(reference);
  if (!path || /\s/.test(path)) return null;
  if (!isFile(path)) {
    warn(category, `${context}: ${reference} is not a file`);
    return null;
  }
  return fileNode(path);
}

// ---------------------------------------------------------------------------
// Journeys: the table in docs/UX_JOURNEY_INVENTORY.md

function addJourneys() {
  const path = "docs/UX_JOURNEY_INVENTORY.md";
  sources.add(path);
  const text = read(path);
  const headings = new Map([...text.matchAll(/^### (J\d{2}) (.+)$/gm)].map(match => [match[1], match[2]]));
  const rows = [...text.matchAll(/^\| (J\d{2}) \| ([^|]+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/gm)];
  const fileId = fileNode(path);
  for (const [, id, name, personas, entry, success] of rows) {
    addNode(`journey:${id}`, "journey", {
      name: name.trim(),
      meaning: success.trim(),
      personas: personas.split(",").map(persona => persona.trim()),
      entry: entry.trim(),
    }, `${path}#journey-map/${id}`);
    addLink(`journey:${id}`, "defined-in", fileId, "asserted", `${path}#journey-map/${id}`);
    if (!headings.has(id)) errors.push(`${path}: journey ${id} is in the table but has no "### ${id}" section`);
  }
  for (const id of headings.keys()) {
    if (!rows.some(row => row[1] === id)) errors.push(`${path}: "### ${id}" has no row in the journey map table`);
  }
}

// ---------------------------------------------------------------------------
// Features, surfaces, routes and interactions: interaction-registry.json

function addRegistry() {
  const path = "interaction-registry.json";
  sources.add(path);
  const registry = readJson(path);

  for (const surface of registry.surfaces) {
    addNode(`surface:${surface.id}`, "surface", { name: surface.label, surfaceKind: surface.kind }, `${path}#surfaces/${surface.id}`);
    for (const route of surface.routes) {
      routeNode(route);
      addLink(`surface:${surface.id}`, "contains", `route:${route}`, "asserted", `${path}#surfaces/${surface.id}/routes/${route}`);
    }
  }

  for (const feature of registry.features) {
    addNode(`feature:${feature.id}`, "feature", { name: feature.name, meaning: feature.meaning, spec: feature.spec },
      `${path}#features/${feature.id}`);
    const spec = referencedFile(feature.spec, "missing references", `feature ${feature.id} spec`);
    if (spec) addLink(`feature:${feature.id}`, "defined-in", spec, "asserted", `${path}#features/${feature.id}/spec`);
  }

  for (const interaction of registry.interactions) {
    const id = `interaction:${interaction.id}`;
    const at = `${path}#${interaction.id}`;
    addNode(id, "interaction", {
      name: interaction.name,
      meaning: interaction.intent,
      status: interaction.status,
      risk: interaction.risk,
    }, at);
    linkTo(`feature:${interaction.feature}`, "contains", id, `${at}/feature`);
    for (const journey of interaction.journeys) linkTo(`journey:${journey}`, "contains", id, `${at}/journeys/${journey}`);
    for (const surface of interaction.surfaces) linkTo(id, "on", `surface:${surface}`, `${at}/surfaces/${surface}`);
    for (const route of interaction.routes) {
      routeNode(route);
      addLink(id, "on", `route:${route}`, "asserted", `${at}/routes/${route}`);
    }
    for (const reference of interaction.implementation) {
      const file = referencedFile(reference, "missing references", interaction.id);
      if (file) addLink(id, "implemented-in", file, "asserted", `${at}/implementation/${reference}`);
    }
    for (const [platform, entry] of Object.entries(interaction.platforms)) {
      for (const reference of entry.implementation ?? []) {
        const file = referencedFile(reference, "missing references", `${interaction.id} ${platform}`);
        if (file) addLink(id, "implemented-in", file, "asserted", `${at}/platforms/${platform}/implementation/${reference}`);
      }
      for (const reference of entry.evidence ?? []) {
        if (fileKind(stripAnchor(reference)) !== "test") continue;
        const file = referencedFile(reference, "missing references", `${interaction.id} ${platform} evidence`);
        if (file) addLink(id, "tested-by", file, "asserted", `${at}/platforms/${platform}/evidence/${reference}`);
      }
    }
    for (const reference of interaction.test_coverage.references) {
      if (fileKind(stripAnchor(reference)) !== "test") continue;
      const file = referencedFile(reference, "missing references", `${interaction.id} test`);
      if (file) addLink(id, "tested-by", file, "asserted", `${at}/test_coverage/references/${reference}`);
    }
    for (const reference of interaction.user_guidance.references) {
      const file = referencedFile(reference, "missing references", `${interaction.id} guidance`);
      if (file) addLink(id, "explained-in", file, "asserted", `${at}/user_guidance/references/${reference}`);
    }
  }
}

function routeNode(route) {
  const id = `route:${route}`;
  if (!nodes.has(id)) addNode(id, "route", { name: route }, "interaction-registry.json");
}

/** An asserted link whose two ends must both exist once every registry has loaded. */
const pendingLinks = [];
function linkTo(from, type, to, source) {
  pendingLinks.push({ from, type, to, source });
}

// ---------------------------------------------------------------------------
// Design system: components, families, tokens

function addDesignSystem() {
  const manifestPath = "design-system.manifest.json";
  const surfacesPath = "design-system.surfaces.json";
  sources.add(manifestPath);
  sources.add(surfacesPath);
  const manifest = readJson(manifestPath);
  for (const component of manifest.components) {
    const id = `component:${component.id}`;
    addNode(id, "component", {
      name: component.name,
      meaning: component.notes,
      componentKind: component.kind,
      status: component.status,
      usageNames: component.usageNames,
      bench: component.benchAnchor ?? null,
    }, `${manifestPath}#${component.id}`);
    if (!isFile(component.source)) errors.push(`${manifestPath}#${component.id}: source ${component.source} is not a file`);
    else addLink(id, "defined-in", fileNode(component.source), "asserted", `${manifestPath}#${component.id}/source`);
  }

  const catalog = readJson(surfacesPath);
  for (const family of catalog.componentFamilies) {
    const id = `family:${family.id}`;
    addNode(id, "family", { name: family.name, meaning: family.definition, tier: family.tier }, `${surfacesPath}#${family.id}`);
    for (const implementation of family.surfaceImplementations) {
      const at = `${surfacesPath}#${family.id}/${implementation.surfaceId}`;
      for (const componentId of implementation.implementationIds) {
        linkTo(`component:${componentId}`, "belongs-to", id, `${at}/implementationIds/${componentId}`);
      }
      for (const reference of implementation.sources ?? []) {
        const file = referencedFile(reference, "missing references", `${family.id} ${implementation.surfaceId}`);
        if (file) addLink(id, "implemented-in", file, "asserted", `${at}/sources/${reference}`);
      }
    }
  }
}

/** Parses CSS custom properties. A comment applies to the declarations directly under it, up to a blank line. */
function parseTokens(path) {
  const tokens = [];
  let comment = null;
  let commentLines = [];
  let inComment = false;
  let block = null;
  for (const line of read(path).split("\n")) {
    const trimmed = line.trim();
    if (inComment) {
      commentLines.push(trimmed.replace(/\*\/.*$/, "").replace(/^\*\s?/, ""));
      if (trimmed.includes("*/")) {
        inComment = false;
        comment = commentLines.join(" ").trim();
      }
      continue;
    }
    if (trimmed.startsWith("/*")) {
      commentLines = [trimmed.replace(/^\/\*\s?/, "").replace(/\*\/.*$/, "")];
      if (trimmed.includes("*/")) comment = commentLines.join(" ").trim();
      else inComment = true;
      continue;
    }
    if (trimmed === "") {
      comment = null;
      continue;
    }
    const blockMatch = trimmed.match(/^(.+?)\s*\{$/);
    if (blockMatch) {
      block = blockMatch[1];
      continue;
    }
    if (trimmed === "}") {
      comment = null;
      continue;
    }
    const declaration = trimmed.match(/^(--[a-zA-Z0-9-]+)\s*:\s*(.+?);?\s*(?:\/\*\s*(.+?)\s*\*\/)?$/);
    if (declaration) {
      tokens.push({ name: declaration[1], value: declaration[2].replace(/;$/, "").trim(), meaning: declaration[3] ?? comment, block });
    }
  }
  return tokens;
}

const colorUtilities = new Map(); // tailwind color name -> token id
const knownTokens = new Set();

function addTokens() {
  const configPath = "design-system.config.json";
  sources.add(configPath);
  const config = readJson(configPath);
  const aliases = [];
  for (const path of config.tokens.sources) {
    sources.add(path);
    const fileId = fileNode(path);
    for (const token of parseTokens(path)) {
      const id = `token:${token.name}`;
      knownTokens.add(token.name);
      const alias = token.value.match(/^var\((--[a-zA-Z0-9-]+)\)$/);
      const color = token.block === "@theme inline" ? token.name.match(/^--color-(.+)$/) : null;
      if (color) colorUtilities.set(color[1], id);
      // A Tailwind color adapter's meaning follows from its own name and value.
      const meaning = token.meaning
        ?? (color && alias ? `Tailwind adapter: the ${color[1]} color utilities (bg-${color[1]}, text-${color[1]} and so on), same as ${alias[1]}.` : null);
      if (!nodes.has(id)) {
        addNode(id, "token", { name: token.name, value: token.value, meaning: meaning ?? undefined }, `${path}#${token.name}`);
        if (!meaning) {
          const message = `${path}: ${token.name} has no description comment`;
          if (path === CANONICAL_TOKEN_FILE) errors.push(message);
          else warn("token descriptions", message);
        }
      }
      addLink(id, "defined-in", fileId, "asserted", `${path}#${token.name}${token.block && token.block !== ":root" ? `@${token.block}` : ""}`);
      if (alias) aliases.push({ from: id, to: `token:${alias[1]}`, source: `${path}#${token.name}/value` });
    }
  }
  for (const alias of aliases) {
    if (alias.from === alias.to) continue;
    if (nodes.has(alias.to)) addLink(alias.from, "aliases", alias.to, "asserted", alias.source);
    else warn("token aliases", `${alias.source}: ${alias.to} is not defined in a token source`);
  }
}

// ---------------------------------------------------------------------------
// Ontology terms: docs/ontology/*.json

function addTerms() {
  const directory = "docs/ontology";
  if (!exists(directory)) return;
  for (const name of readdirSync(join(root, directory)).filter(file => file.endsWith(".json")).sort()) {
    const path = `${directory}/${name}`;
    sources.add(path);
    const ontology = readJson(path);
    for (const term of ontology.terms) {
      addNode(`term:${term.id}`, "term", { name: term.label, meaning: term.definition, category: term.category, scope: ontology.scope },
        `${path}#${term.id}`);
      for (const contract of term.contracts) {
        const file = referencedFile(contract.path, "missing references", `term ${term.id}`);
        if (file) addLink(`term:${term.id}`, "defined-in", file, "asserted", `${path}#${term.id}/contracts/${contract.path}#${contract.symbol}`);
      }
      for (const related of term.relatedIds) linkTo(`term:${term.id}`, "relates-to", `term:${related}`, `${path}#${term.id}/relatedIds/${related}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Architecture: database tables, MCP tools

function addTables() {
  const directory = "supabase/migrations";
  const tables = new Map();
  for (const name of readdirSync(join(root, directory)).filter(file => file.endsWith(".sql")).sort()) {
    const path = `${directory}/${name}`;
    const sql = read(path).replace(/--.*$/gm, "");
    for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) {
      const table = match[1].toLowerCase();
      if (!tables.has(table)) tables.set(table, path);
    }
    for (const match of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
      const from = match[1].toLowerCase();
      if (tables.has(from)) {
        tables.delete(from);
        tables.set(match[2].toLowerCase(), path);
      }
    }
    for (const match of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
      tables.delete(match[1].toLowerCase());
    }
  }
  sources.add(`${directory}/*.sql`);
  for (const [table, path] of [...tables].sort()) {
    addNode(`table:${table}`, "table", { name: table }, `${path}#${table}`);
    addLink(`table:${table}`, "defined-in", fileNode(path), "asserted", `${path}#create-table/${table}`);
  }
}

function stringValue(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = stringValue(node.left);
    const right = stringValue(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  if (ts.isParenthesizedExpression(node)) return stringValue(node.expression);
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map(span => `{${span.expression.getText()}}${span.literal.text}`).join("");
  }
  return null;
}

function addMcpTools() {
  const path = "packages/core/src/integration/operations.ts";
  if (!exists(path)) return;
  sources.add(path);
  const file = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const handlerFiles = ["lib/integrations/operations/read/index.ts", "lib/integrations/operations/write/index.ts"].filter(exists);
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^(read|write)Operation$/.test(node.expression.text)) {
      const literal = node.arguments[0];
      if (literal && ts.isObjectLiteralExpression(literal)) {
        const property = name => literal.properties.find(candidate =>
          ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === name);
        const name = stringValue(property("name")?.initializer);
        if (name) {
          const id = `mcp-tool:${name}`;
          addNode(id, "mcp-tool", {
            name,
            title: stringValue(property("title")?.initializer) ?? undefined,
            meaning: stringValue(property("description")?.initializer) ?? undefined,
            access: node.expression.text.startsWith("read") ? "read" : "write",
          }, `${path}#${name}`);
          addLink(id, "defined-in", fileNode(path), "asserted", `${path}#${name}`);
          for (const handlerFile of handlerFiles) {
            if (new RegExp(`^\\s+${name}:`, "m").test(read(handlerFile))) {
              addLink(id, "implemented-in", fileNode(handlerFile), "derived", `scan:${handlerFile}#${name}`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

// ---------------------------------------------------------------------------
// Source scan: imports, component renders, API calls, table reads, token uses

function listSourceFiles() {
  const files = [];
  const walk = directory => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = posix.join(directory, entry.name);
      if (SCAN_EXCLUDE.some(pattern => pattern.test(path))) continue;
      if (entry.isDirectory()) walk(path);
      else if (/\.(tsx?|mts)$/.test(entry.name)) files.push(path);
    }
  };
  for (const directory of SCAN_ROOTS) if (exists(directory)) walk(directory);
  return files;
}

const corePackage = exists("packages/core/package.json") ? readJson("packages/core/package.json") : null;
const uiPackage = exists("packages/ui/package.json") ? readJson("packages/ui/package.json") : null;

function resolveCandidates(base) {
  const stripped = base.replace(/\.(m?js)$/, "");
  for (const candidate of [base, `${stripped}.ts`, `${stripped}.tsx`, `${stripped}/index.ts`, `${stripped}/index.tsx`]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function packageExport(pkg, directory, subpath) {
  if (!pkg?.exports) return null;
  for (const [key, target] of Object.entries(pkg.exports)) {
    const value = typeof target === "string" ? target : target?.default ?? target?.import;
    if (typeof value !== "string") continue;
    if (key === `./${subpath}`) return posix.join(directory, value);
    if (key.endsWith("/*") && `./${subpath}`.startsWith(key.slice(0, -1))) {
      const rest = `./${subpath}`.slice(key.length - 1);
      return posix.join(directory, value.replaceAll("*", rest));
    }
  }
  return null;
}

function resolveImport(fromFile, specifier) {
  if (specifier.startsWith("@/")) return resolveCandidates(specifier.slice(2));
  if (specifier.startsWith(".")) return resolveCandidates(posix.normalize(posix.join(posix.dirname(fromFile), specifier)));
  if (specifier.startsWith("@cadence/core/")) {
    const target = packageExport(corePackage, "packages/core", specifier.slice("@cadence/core/".length));
    return target ? resolveCandidates(target) : null;
  }
  if (specifier.startsWith("@cadence/ui/")) {
    const target = packageExport(uiPackage, "packages/ui", specifier.slice("@cadence/ui/".length));
    return target ? resolveCandidates(target) : null;
  }
  return null;
}

function apiRoutes() {
  const routes = [];
  const walk = directory => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = posix.join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^route\.tsx?$/.test(entry.name)) routes.push({ path, segments: apiPath(path).split("/").filter(Boolean) });
    }
  };
  if (exists("app/api")) walk("app/api");
  return routes;
}

const DYNAMIC = "\u0000";

function matchApiRoute(routes, url) {
  const clean = url.split(/[?#]/)[0].replace(/\/$/, "");
  const segments = clean.split("/").filter(Boolean);
  for (const route of routes) {
    const catchAll = route.segments.findIndex(segment => /^\[\.\.\..+\]$/.test(segment));
    if (catchAll === -1 && route.segments.length !== segments.length) continue;
    if (catchAll !== -1 && segments.length < catchAll + 1) continue;
    const limit = catchAll === -1 ? segments.length : catchAll;
    let ok = true;
    for (let index = 0; index < limit; index += 1) {
      const routeSegment = route.segments[index];
      const segment = segments[index];
      if (/^\[.+\]$/.test(routeSegment)) continue;
      if (segment.includes(DYNAMIC) || segment !== routeSegment) {
        ok = false;
        break;
      }
    }
    if (ok) return route.path;
  }
  return null;
}

function urlLiteral(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(span => DYNAMIC + span.literal.text).join("");
  return null;
}

const tokenUtilityPattern = /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border(?:-[trblxy])?|ring|ring-offset|fill|stroke|outline|decoration|divide|placeholder|caret|accent|from|via|to|shadow)-([a-z][a-z0-9-]*?)(?:\/\d+)?(?![\w-])/g;
const fontSizeUtilities = new Set(["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"]);

function scanSources() {
  const files = listSourceFiles();
  const routes = apiRoutes();
  const componentsBySource = new Map();
  for (const node of nodes.values()) {
    if (node.kind !== "component") continue;
    const sourceLink = [...links.values()].find(link => link.from === node.id && link.type === "defined-in");
    if (!sourceLink) continue;
    const path = nodes.get(sourceLink.to).path;
    if (!componentsBySource.has(path)) componentsBySource.set(path, []);
    componentsBySource.get(path).push(node);
  }

  const imports = new Map(); // file -> resolved files
  const apiCalls = new Map(); // file -> api route files
  const renders = [];
  const tableReads = new Map();
  for (const path of files) {
    const text = read(path);
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const resolved = new Set();
    const localNames = new Map(); // local identifier -> { file, imported }
    const calls = new Set();
    const tables = new Set();
    const shownNotices = new Set();
    const visit = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveImport(path, node.moduleSpecifier.text);
        if (target) {
          resolved.add(target);
          const clause = ts.isImportDeclaration(node) ? node.importClause : null;
          if (clause?.name) localNames.set(clause.name.text, { file: target, imported: "default" });
          const bindings = clause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              localNames.set(element.name.text, { file: target, imported: (element.propertyName ?? element.name).text });
            }
          }
        }
      } else if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === "import" || node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const argument = node.arguments[0];
          if (argument && ts.isStringLiteral(argument)) {
            const target = resolveImport(path, argument.text);
            if (target) resolved.add(target);
          }
        }
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "from") {
          const table = node.arguments[0] && stringValue(node.arguments[0]);
          if (table && nodes.has(`table:${table}`)) tables.add(table);
        }
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
        const url = urlLiteral(node);
        if (url && url.startsWith("/api/")) {
          const route = matchApiRoute(routes, url);
          if (route && route !== path) calls.add(route);
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (ts.isIdentifier(node.tagName)) {
          const tag = node.tagName.text;
          const local = localNames.get(tag);
          if (local && componentsBySource.has(local.file)) {
            for (const component of componentsBySource.get(local.file)) {
              if (component.usageNames.includes(local.imported) || component.usageNames.includes(tag)) {
                renders.push({ file: path, component: component.id, tag });
              }
            }
          }
        }
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && noticeCatalog.has(node.text)) shownNotices.add(node.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const noticeId of [...shownNotices].sort()) addLink(fileNode(path), "shows", `notice:${noticeId}`, "derived", `scan:${path}#${noticeId}`);
    imports.set(path, resolved);
    apiCalls.set(path, calls);
    if (tables.size) tableReads.set(path, tables);
  }

  const configPath = "design-system.config.json";
  for (const mapping of readJson(configPath).manualMappings ?? []) {
    if (!nodes.has(`component:${mapping.componentId}`)) errors.push(`${configPath}#manualMappings/${mapping.componentId}: unknown component`);
    else if (!isFile(mapping.file)) errors.push(`${configPath}#manualMappings/${mapping.componentId}: ${mapping.file} is not a file`);
    else {
      addLink(fileNode(mapping.file), "renders", `component:${mapping.componentId}`, "asserted", `${configPath}#manualMappings/${mapping.componentId}@${mapping.file}`);
      renders.push({ file: mapping.file, component: `component:${mapping.componentId}`, tag: mapping.componentId, manual: true });
    }
  }
  for (const { file, component, tag, manual } of renders) {
    if (manual) continue;
    addLink(fileNode(file), "renders", component, "derived", `scan:${file}#${tag}`);
  }

  // Architecture reach: services and API routes a file uses directly, or through up to
  // two local helper files that are not themselves services or routes.
  const isArchitecture = path => ["service", "api", "repository"].includes(fileKind(path));
  const reach = (path, depth, seen) => {
    const found = new Set();
    for (const target of imports.get(path) ?? []) {
      if (seen.has(target)) continue;
      seen.add(target);
      if (isArchitecture(target)) found.add(target);
      else if (depth > 0 && !componentsBySource.has(target)) for (const inner of reach(target, depth - 1, seen)) found.add(inner);
    }
    for (const route of apiCalls.get(path) ?? []) found.add(route);
    return found;
  };
  const implementationFiles = new Set([...links.values()].filter(link => link.type === "implemented-in").map(link => nodes.get(link.to)?.path).filter(Boolean));
  for (const path of files) {
    if (!implementationFiles.has(path) && !isArchitecture(path)) continue;
    for (const target of reach(path, 2, new Set([path]))) {
      if (target === path) continue;
      const type = fileKind(target) === "api" && !(imports.get(path) ?? new Set()).has(target) ? "calls" : "uses";
      addLink(fileNode(path), type, fileNode(target), "derived", `scan:${path}#${type === "calls" ? apiPath(target) : target}`);
    }
  }
  for (const [path, tables] of tableReads) {
    for (const table of [...tables].sort()) addLink(fileNode(path), "uses", `table:${table}`, "derived", `scan:${path}#from(${table})`);
  }

  // Tokens used by each component's source file.
  for (const [path, components] of componentsBySource) {
    const text = read(path);
    const used = new Set();
    for (const match of text.matchAll(tokenUtilityPattern)) {
      const name = match[1];
      if (colorUtilities.has(name)) used.add(colorUtilities.get(name));
      else if (match[0].includes("text-") && fontSizeUtilities.has(name) && knownTokens.has(`--text-${name}`)) used.add(`token:--text-${name}`);
    }
    for (const match of text.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)) if (knownTokens.has(match[1])) used.add(`token:${match[1]}`);
    for (const component of components) {
      for (const token of [...used].sort()) addLink(component.id, "styled-by", token, "derived", `scan:${path}`);
    }
    for (const match of text.matchAll(/(?:\[|["'`])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?:\]|["'`])/g)) {
      warn("hard-coded colors", `${path}: ${match[0]} (use a token)`);
    }
  }

  linkMcpHandlers();
  compareUsageFile(renders);
  return files.length;
}

/** Links each MCP tool to the services or repositories its handler entry calls. */
function linkMcpHandlers() {
  for (const path of ["lib/integrations/operations/read/index.ts", "lib/integrations/operations/write/index.ts"]) {
    if (!exists(path)) continue;
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imported = new Map();
    const localCalls = new Map();
    const calledIn = node => {
      const names = new Set();
      const visit = child => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) names.add(child.expression.text);
        if (ts.isCallExpression(child)) for (const argument of child.arguments) if (ts.isIdentifier(argument)) names.add(argument.text);
        ts.forEachChild(child, visit);
      };
      visit(node);
      return names;
    };
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const target = resolveImport(path, statement.moduleSpecifier.text);
        const bindings = statement.importClause?.namedBindings;
        if (target && bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) imported.set(element.name.text, target);
      } else if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
        localCalls.set(statement.name.text, calledIn(statement.body));
      }
    }
    const visit = node => {
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && nodes.has(`mcp-tool:${node.name.text}`) && ts.isCallExpression(node.initializer)) {
        const tool = `mcp-tool:${node.name.text}`;
        const names = calledIn(node.initializer);
        for (const name of [...names]) for (const inner of localCalls.get(name) ?? []) names.add(inner);
        for (const name of [...names].sort()) {
          const target = imported.get(name);
          if (target && ["service", "repository"].includes(fileKind(target))) {
            addLink(tool, "implemented-in", fileNode(target), "derived", `scan:${path}#${node.name.text}/${name}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
}

function compareUsageFile(renders) {
  const path = "design-system.usage.json";
  if (!exists(path)) return;
  // The bench page and tests are outside the comparison: usage.json records tests, the scan skips them.
  const compared = file => !file.startsWith("app/design-system/") && fileKind(file) !== "test";
  const recorded = new Set(readJson(path).usages.filter(usage => usage.usageKind === "render" && compared(usage.file)).map(usage => `${usage.componentId}\u0000${usage.file}`));
  const scanned = new Set(renders.filter(render => compared(render.file)).map(render => `${render.component.replace(/^component:/, "")}\u0000${render.file}`));
  for (const key of [...scanned].sort()) if (!recorded.has(key)) warn("design-system.usage.json differences", `found in code, missing from ${path}: ${key.replace("\u0000", " in ")}`);
  for (const key of [...recorded].sort()) if (!scanned.has(key)) warn("design-system.usage.json differences", `in ${path}, not found in code: ${key.replace("\u0000", " in ")}`);
}

// ---------------------------------------------------------------------------
// Notices: packages/core/src/notices/catalog/*.json (docs/NOTICES.md)

const NOTICE_DIRECTORY = "packages/core/src/notices/catalog";
const NOTICES_DOC = "docs/NOTICES.md";
const NOTICE_STYLES = new Set(["outcome", "error", "note", "question"]);
const NOTICE_CHANNELS = new Set(["in-app", "reminder", "email"]);
const NOTICE_STATUSES = new Set(["active", "planned", "retired"]);
const NOTICE_PLATFORMS = ["web", "mac"];
const NOTICE_ALERTS = new Set(["model_failed", "data_stale", "budget_reached", "write_refused"]);
/** The token each style is drawn in (DESIGN.md text styles; components/feedback/Notice.tsx). */
const NOTICE_STYLE_TOKENS = { outcome: "--foreground", error: "--alert-signal", note: "--muted-readable", question: "--foreground" };

/** Checks a notice template's braces and that every select or plural has "other". */
function noticeTemplateProblem(template) {
  let depth = 0;
  for (const char of template) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return "has an unmatched }";
  }
  if (depth !== 0) return "has an unmatched {";
  for (const match of template.matchAll(/\{\s*([A-Za-z][A-Za-z0-9_]*)\s*,\s*(\w+)\s*,/g)) {
    if (match[2] !== "select" && match[2] !== "plural") return `uses unsupported type ${match[2]}`;
    let index = match.index + match[0].length;
    let level = 1;
    let branchStart = index;
    let hasOther = false;
    for (; index < template.length && level > 0; index += 1) {
      if (template[index] === "{") {
        if (level === 1 && template.slice(branchStart, index).trim() === "other") hasOther = true;
        level += 1;
      } else if (template[index] === "}") {
        level -= 1;
        if (level === 1) branchStart = index + 1;
      }
    }
    if (!hasOther) return `needs an "other" branch for ${match[1]}`;
  }
  return null;
}

const noticeCatalog = new Map(); // notice id -> { path, entry, feature }

function addNotices() {
  if (!exists(NOTICE_DIRECTORY)) return;
  for (const name of readdirSync(join(root, NOTICE_DIRECTORY)).filter(file => file.endsWith(".json")).sort()) {
    const path = `${NOTICE_DIRECTORY}/${name}`;
    sources.add(path);
    const catalog = readJson(path);
    if (typeof catalog.feature !== "string") errors.push(`${path}: the catalog needs a feature`);
    for (const [noticeId, notice] of Object.entries(catalog.notices ?? {})) {
      const id = `notice:${noticeId}`;
      const at = `${path}#${noticeId}`;
      const feature = notice.feature ?? catalog.feature;
      const style = notice.style;
      const status = notice.status ?? "active";
      const platforms = notice.platforms ?? NOTICE_PLATFORMS;
      if (noticeCatalog.has(noticeId)) errors.push(`${at}: duplicate notice id (also in ${noticeCatalog.get(noticeId).path})`);
      noticeCatalog.set(noticeId, { path, entry: notice, feature });
      if (!/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(noticeId)) errors.push(`${at}: notice ids are lowercase words joined by dots and hyphens`);
      if (!NOTICE_STYLES.has(style)) errors.push(`${at}: style must be outcome, error, note or question`);
      if (!NOTICE_CHANNELS.has(notice.channel ?? "in-app")) errors.push(`${at}: channel must be in-app, reminder or email`);
      if (!NOTICE_STATUSES.has(status)) errors.push(`${at}: status must be active, planned or retired`);
      if (!platforms.length || platforms.some(platform => !NOTICE_PLATFORMS.includes(platform))) errors.push(`${at}: platforms must be web and/or mac`);
      if ((notice.alert || notice.label) && style !== "error") errors.push(`${at}: only an error has an alert kind or a label`);
      if (notice.alert && !NOTICE_ALERTS.has(notice.alert)) errors.push(`${at}: unknown alert kind ${notice.alert}`);
      if (typeof notice.text !== "string" || !notice.text.trim()) errors.push(`${at}: the notice has no text`);
      else {
        const problem = noticeTemplateProblem(notice.text);
        if (problem) errors.push(`${at}: text ${problem}`);
      }
      for (const [index, revision] of (notice.previous ?? []).entries()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(revision.until ?? "") || !revision.change || !(revision.text || revision.look)) {
          errors.push(`${at}/previous/${revision.until ?? index}: a change record needs until (YYYY-MM-DD), change, and the earlier text or look`);
        }
      }
      if (!Array.isArray(notice.interactions)) errors.push(`${at}: interactions must be a list (empty for a planned notice)`);
      else if (!notice.interactions.length && status === "active") errors.push(`${at}: an active notice names the interactions that show it`);
      addNode(id, "notice", {
        name: noticeId,
        meaning: notice.meaning,
        text: notice.text,
        style,
        channel: notice.channel ?? "in-app",
        status,
        platforms,
        ...(notice.label ? { label: notice.label } : {}),
        ...(notice.previous?.length ? { previous: notice.previous } : {}),
      }, at);
      linkTo(id, "belongs-to", `feature:${feature}`, `${at}/feature`);
      for (const interaction of notice.interactions ?? []) linkTo(id, "shown-by", `interaction:${interaction}`, `${at}/interactions/${interaction}`);
      if (NOTICE_STYLE_TOKENS[style]) pendingStyleTokens.push({ id, token: `token:${NOTICE_STYLE_TOKENS[style]}`, source: `${at}/style/${style}` });
    }
  }
}
const pendingStyleTokens = [];

// ---------------------------------------------------------------------------
// Advisor avatar: packages/core/src/advisor-avatar/catalog.json (states, gestures, experiments)

const AVATAR_CATALOG = "packages/core/src/advisor-avatar/catalog.json";
const AVATAR_STATUSES = new Set(["planned", "undecided", "active", "retired"]);

function addAvatar() {
  if (!exists(AVATAR_CATALOG)) return;
  sources.add(AVATAR_CATALOG);
  const catalog = readJson(AVATAR_CATALOG);
  if (typeof catalog.feature !== "string") errors.push(`${AVATAR_CATALOG}: the catalog needs a feature`);
  const art = catalog.art ?? {};
  for (const file of [art.master, ...(art.renditions ?? []).map(rendition => rendition.file)]) {
    if (!file || !isFile(file)) errors.push(`${AVATAR_CATALOG}#art: missing file ${file}`);
  }
  const priorities = new Map();
  for (const [group, type] of [["states", "state"], ["gestures", "gesture"]]) {
    for (const [avatarId, entry] of Object.entries(catalog[group] ?? {})) {
      const id = `avatar:${avatarId}`;
      const at = `${AVATAR_CATALOG}#${avatarId}`;
      if (!new RegExp(`^${type}\\.[a-z][a-z0-9-]*$`).test(avatarId)) errors.push(`${at}: ids in ${group} read ${type}.<word>`);
      if (!AVATAR_STATUSES.has(entry.status)) errors.push(`${at}: status must be planned, undecided, active or retired`);
      for (const field of ["when", "motion", "still"]) {
        if (typeof entry[field] !== "string" || !entry[field].trim()) errors.push(`${at}: ${field} is required`);
      }
      if (type === "state") {
        if (!Number.isInteger(entry.priority)) errors.push(`${at}: a state needs a whole-number priority (lowest wins)`);
        else if (priorities.has(entry.priority)) errors.push(`${at}: priority ${entry.priority} is also used by ${priorities.get(entry.priority)}`);
        else priorities.set(entry.priority, avatarId);
      }
      if (!Array.isArray(entry.interactions)) errors.push(`${at}: interactions must be a list`);
      addNode(id, "avatar", {
        name: avatarId,
        type,
        meaning: entry.meaning,
        when: entry.when,
        motion: entry.motion,
        still: entry.still,
        status: entry.status,
        ...(type === "state" ? { priority: entry.priority } : {}),
        ...(entry.fromTrial ? { fromTrial: entry.fromTrial } : {}),
      }, at);
      linkTo(id, "belongs-to", `feature:${catalog.feature}`, `${at}/feature`);
      for (const interaction of entry.interactions ?? []) linkTo(id, "follows", `interaction:${interaction}`, `${at}/interactions/${interaction}`);
    }
  }
  const known = new Set([...Object.keys(catalog.states ?? {}), ...Object.keys(catalog.gestures ?? {})]);
  const resolverPath = "packages/core/src/resolvers/advisor-avatar.resolver.ts";
  const resolverText = exists(resolverPath) ? read(resolverPath) : "";
  for (const avatarId of known) {
    const entry = catalog.states?.[avatarId] ?? catalog.gestures?.[avatarId];
    if (entry.status === "active" && !resolverText.includes(`"${avatarId}"`)) errors.push(`${AVATAR_CATALOG}#${avatarId}: an active item must be returned by ${resolverPath}`);
  }
  for (const [experimentId, experiment] of Object.entries(catalog.experiments ?? {})) {
    const at = `${AVATAR_CATALOG}#experiments/${experimentId}`;
    if (!known.has(experiment.subject)) errors.push(`${at}: subject must be a state or gesture id`);
    const variants = Object.keys(experiment.variants ?? {});
    if (variants.length < 2 || !variants.includes("still")) errors.push(`${at}: an experiment needs at least two variants, one of them "still"`);
  }
}

// ---------------------------------------------------------------------------
// Build and validate

function build() {
  addJourneys();
  addRegistry();
  addDesignSystem();
  addTokens();
  addTerms();
  addTables();
  addMcpTools();
  addNotices();
  addAvatar();
  for (const link of pendingLinks) {
    if (!nodes.has(link.from)) errors.push(`${link.source}: unknown ${link.from}`);
    else if (!nodes.has(link.to)) errors.push(`${link.source}: unknown ${link.to}`);
    else addLink(link.from, link.type, link.to, "asserted", link.source);
  }
  for (const { id, token, source } of pendingStyleTokens) {
    if (!nodes.has(token)) errors.push(`${source}: unknown ${token}`);
    else addLink(id, "styled-by", token, "derived", source);
  }
  const scanned = scanSources();
  for (const [noticeId, { path, entry }] of noticeCatalog) {
    const shown = [...links.values()].some(link => link.type === "shows" && link.to === `notice:${noticeId}`);
    const status = entry.status ?? "active";
    if (status === "active" && !shown) errors.push(`${path}#${noticeId}: no source file shows this active notice (mark it planned or retired)`);
    if (status === "retired" && shown) errors.push(`${path}#${noticeId}: a retired notice is still shown in code`);
  }
  for (const node of nodes.values()) {
    if (MEANING_REQUIRED.has(node.kind) && !(typeof node.meaning === "string" && node.meaning.trim())) {
      errors.push(`${node.source}: ${node.id} has no meaning`);
    }
  }
  for (const link of links.values()) {
    if (!nodes.has(link.from) || !nodes.has(link.to)) errors.push(`${link.source}: link ${link.from} ${link.type} ${link.to} has a missing end`);
  }
  for (const node of nodes.values()) {
    if (node.kind === "feature" && ![...links.values()].some(link => link.from === node.id && link.type === "contains")) {
      errors.push(`${node.source}: ${node.id} contains no interactions`);
    }
  }
  const sortedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedLinks = [...links.values()].sort((a, b) =>
    a.from.localeCompare(b.from) || a.type.localeCompare(b.type) || a.to.localeCompare(b.to));
  const counts = {};
  for (const node of sortedNodes) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  const linkCounts = {};
  for (const link of sortedLinks) linkCounts[`${link.type} (${link.grade})`] = (linkCounts[`${link.type} (${link.grade})`] ?? 0) + 1;
  return {
    map: {
      schemaVersion: SCHEMA_VERSION,
      sources: [...sources].sort(),
      counts: { nodes: counts, links: Object.fromEntries(Object.entries(linkCounts).sort()) },
      nodes: sortedNodes,
      links: sortedLinks,
      warnings: Object.fromEntries([...warnings].sort().map(([category, messages]) => [category, [...messages].sort()])),
    },
    scanned,
  };
}

// ---------------------------------------------------------------------------
// Output

function index(map) {
  const out = new Map();
  const into = new Map();
  for (const link of map.links) {
    if (!out.has(link.from)) out.set(link.from, []);
    out.get(link.from).push(link);
    if (!into.has(link.to)) into.set(link.to, []);
    into.get(link.to).push(link);
  }
  return { out, into, node: new Map(map.nodes.map(node => [node.id, node])) };
}

/** A file that implements this many features or more is a shared screen, not one feature's code. */
const SHARED_FILE_FEATURES = 4;

function fileFeatureCounts(graph) {
  if (graph.fileFeatures) return graph.fileFeatures;
  const counts = new Map();
  for (const [from, list] of graph.out) {
    if (!from.startsWith("feature:")) continue;
    const files = new Set();
    for (const link of list) {
      if (link.type !== "contains") continue;
      for (const implementation of graph.out.get(link.to) ?? []) if (implementation.type === "implemented-in") files.add(implementation.to);
    }
    for (const file of files) counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  graph.fileFeatures = counts;
  return counts;
}

function featureArchitecture(map, graph, featureId) {
  const interactions = (graph.out.get(featureId) ?? []).filter(link => link.type === "contains").map(link => link.to);
  const files = new Set();
  const tests = new Set();
  const journeys = new Set();
  const surfaces = new Set();
  for (const interaction of interactions) {
    for (const link of graph.out.get(interaction) ?? []) {
      if (link.type === "implemented-in") files.add(link.to);
      if (link.type === "tested-by") tests.add(link.to);
      if (link.type === "on" && link.to.startsWith("surface:")) surfaces.add(link.to);
    }
    for (const link of graph.into.get(interaction) ?? []) if (link.type === "contains" && link.to && link.from.startsWith("journey:")) journeys.add(link.from);
  }
  const counts = fileFeatureCounts(graph);
  const shared = new Set([...files].filter(file => (counts.get(file) ?? 0) >= SHARED_FILE_FEATURES));
  const own = [...files].filter(file => !shared.has(file));
  const followed = own.length ? own : [...files];
  const components = new Set();
  const services = new Set();
  const apis = new Set();
  const repositories = new Set();
  const collect = link => {
    if (link.to.startsWith("service:")) services.add(link.to);
    if (link.to.startsWith("api:")) apis.add(link.to);
    if (link.to.startsWith("repository:")) repositories.add(link.to);
  };
  for (const file of followed) {
    for (const link of graph.out.get(file) ?? []) {
      if (link.type === "renders") components.add(link.to);
      collect(link);
    }
    for (const link of graph.into.get(file) ?? []) if (link.type === "defined-in" && link.from.startsWith("component:")) components.add(link.from);
  }
  // One more hop: API routes to their services and repositories, services to repositories.
  for (const api of [...apis]) for (const link of graph.out.get(api) ?? []) if (!link.to.startsWith("api:")) collect(link);
  for (const service of [...services]) for (const link of graph.out.get(service) ?? []) if (link.to.startsWith("repository:")) collect(link);
  const tables = new Set();
  for (const holder of [...services, ...apis, ...repositories, ...followed]) for (const link of graph.out.get(holder) ?? []) if (link.to.startsWith("table:")) tables.add(link.to);
  const tools = new Set();
  for (const node of map.nodes) {
    if (node.kind !== "mcp-tool") continue;
    for (const link of graph.out.get(node.id) ?? []) if (link.type === "implemented-in" && (services.has(link.to) || repositories.has(link.to))) tools.add(node.id);
  }
  const sorted = set => [...set].sort();
  return { interactions: sorted(interactions), journeys: sorted(journeys), surfaces: sorted(surfaces),
    files: sorted(own.length ? own : files), sharedScreens: sorted(own.length ? shared : []),
    components: sorted(components), services: sorted(services), repositories: sorted(repositories), apis: sorted(apis), tables: sorted(tables), tools: sorted(tools), tests: sorted(tests) };
}

function markdown(map) {
  const graph = index(map);
  const name = id => graph.node.get(id)?.name ?? id;
  const code = id => `\`${id.replace(/^[a-z-]+:/, "")}\``;
  const lines = [
    "# Cadence product map",
    "",
    "Generated by `npm run map:build` from the repository's registries. Do not edit by hand; edit the registry named in each item's source.",
    "",
    "| Kind | Items |",
    "| --- | ---: |",
    ...Object.entries(map.counts.nodes).map(([kind, count]) => `| ${kind} | ${count} |`),
    "",
    "## Features",
    "",
  ];
  for (const feature of map.nodes.filter(node => node.kind === "feature")) {
    const a = featureArchitecture(map, graph, feature.id);
    lines.push(`### ${feature.name}`, "", `\`${feature.id}\`. ${feature.meaning}`, "", `Spec: [${feature.spec}](${posix.relative("docs", stripAnchor(feature.spec))}${feature.spec.includes("#") ? feature.spec.slice(feature.spec.indexOf("#")) : ""})`, "");
    lines.push(`- Journeys: ${a.journeys.map(id => `${id.slice(8)} ${name(id)}`).join("; ") || "none"}`);
    lines.push(`- Surfaces: ${a.surfaces.map(name).join(", ") || "none"}`);
    lines.push(`- Interactions (${a.interactions.length}): ${a.interactions.map(id => `${id.slice(12)} ${name(id)}`).join("; ")}`);
    if (a.sharedScreens.length) lines.push(`- Shared screens, not followed (${a.sharedScreens.length}): ${a.sharedScreens.map(code).join(", ")}`);
    lines.push(`- Components (${a.components.length}): ${a.components.map(name).join(", ") || "none"}`);
    lines.push(`- Services (${a.services.length}): ${a.services.map(code).join(", ") || "none"}`);
    lines.push(`- Repositories (${a.repositories.length}): ${a.repositories.map(code).join(", ") || "none"}`);
    lines.push(`- API routes (${a.apis.length}): ${a.apis.map(code).join(", ") || "none"}`);
    lines.push(`- Database tables (${a.tables.length}): ${a.tables.map(code).join(", ") || "none"}`);
    if (a.tools.length) lines.push(`- MCP tools on its services (${a.tools.length}): ${a.tools.map(code).join(", ")}`);
    lines.push(`- Tests: ${a.tests.length}`, "");
  }
  lines.push("## Journeys", "");
  for (const journey of map.nodes.filter(node => node.kind === "journey")) {
    const features = new Set();
    for (const link of graph.out.get(journey.id) ?? []) {
      for (const owner of graph.into.get(link.to) ?? []) if (owner.from.startsWith("feature:")) features.add(owner.from);
    }
    const count = (graph.out.get(journey.id) ?? []).filter(link => link.type === "contains").length;
    lines.push(`- **${journey.id.slice(8)} ${journey.name}** (${count} interactions): ${journey.meaning} Features: ${[...features].sort().map(name).join(", ")}.`);
  }
  lines.push("", "## MCP tools", "");
  for (const tool of map.nodes.filter(node => node.kind === "mcp-tool")) {
    const services = (graph.out.get(tool.id) ?? []).filter(link => link.type === "implemented-in" && !link.to.startsWith("file:")).map(link => code(link.to));
    lines.push(`- **${tool.name}** (${tool.access}): ${tool.meaning} Services: ${services.join(", ") || "none"}.`);
  }
  lines.push("", "## Component families", "");
  for (const family of map.nodes.filter(node => node.kind === "family")) {
    const members = (graph.into.get(family.id) ?? []).filter(link => link.type === "belongs-to").map(link => name(link.from)).sort();
    lines.push(`- **${family.name}**: ${family.meaning} Components: ${members.join(", ") || "none"}.`);
  }
  if (Object.keys(map.warnings).length) {
    lines.push("", "## Warnings", "");
    for (const [category, messages] of Object.entries(map.warnings)) lines.push(`- ${category}: ${messages.length}`);
  }
  return `${lines.join("\n")}\n`;
}

const STYLE_WORDS = { outcome: "Outcome (Ink italic)", error: "Error (one Rust Signal line)", note: "Note (Readable Ash)", question: "Question (Ink)" };
const cell = text => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");

/** docs/NOTICES.md: every notice by feature, then the record of every change. Committed. */
function noticesMarkdown(map) {
  const graph = index(map);
  const notices = map.nodes.filter(node => node.kind === "notice");
  const featureOf = notice => (graph.out.get(notice.id) ?? []).find(link => link.type === "belongs-to")?.to;
  const files = notice => (graph.into.get(notice.id) ?? []).filter(link => link.type === "shows").map(link => `\`${link.from.replace(/^[a-z-]+:/, "")}\``);
  const interactions = notice => (graph.out.get(notice.id) ?? []).filter(link => link.type === "shown-by").map(link => link.to.slice(12));
  const lines = [
    "# Notices",
    "",
    "Every sentence Cadence shows about what just happened or the state something is in. Generated by `npm run map:build` from `packages/core/src/notices/catalog/*.json`; edit the catalog, never this file. `npm run map:check` fails when this file is out of date.",
    "",
    "Styles: **outcome** is Ink italic (what an action did; links beside it stay upright). **error** is one Rust Signal line, through the Alert notice. **note** is Readable Ash, the only grey. **question** is Ink and asks the person to choose. Values in braces are filled in when the notice shows; see `packages/core/src/notices/format.ts` for `select` and `plural`.",
    "",
    "Show a notice with `<Notice id=\"…\" />` (`components/feedback/Notice.tsx`) or its words with `noticeText(\"…\")` (`@cadence/core/notices`). Guide: [PRODUCT_MAP_GUIDE.md](PRODUCT_MAP_GUIDE.md#notices).",
    "",
    "| Style | Notices |",
    "| --- | ---: |",
    ...Object.keys(STYLE_WORDS).map(style => `| ${style} | ${notices.filter(notice => notice.style === style).length} |`),
    "",
  ];
  const features = [...new Set(notices.map(featureOf))].sort((a, b) => (graph.node.get(a)?.name ?? a).localeCompare(graph.node.get(b)?.name ?? b));
  for (const feature of features) {
    lines.push(`## ${graph.node.get(feature)?.name ?? feature}`, "", "| Notice | Style | Words | Where | Shown in |", "| --- | --- | --- | --- | --- |");
    for (const notice of notices.filter(candidate => featureOf(candidate) === feature)) {
      const words = `${notice.label ? `${notice.label}. ` : ""}${notice.text}`;
      const where = [notice.platforms.length === 2 ? "web, Mac" : notice.platforms.map(platform => platform === "mac" ? "Mac" : platform).join(", "),
        notice.channel === "in-app" ? null : notice.channel, notice.status === "active" ? null : notice.status].filter(Boolean).join("; ");
      lines.push(`| \`${notice.name}\` ${cell(notice.meaning)} | ${notice.style} | ${cell(words)} | ${where} | ${[...interactions(notice), ...files(notice)].join(", ") || "none"} |`);
    }
    lines.push("");
  }
  const changes = notices.flatMap(notice => (notice.previous ?? []).map(revision => ({ notice, revision })))
    .sort((a, b) => b.revision.until.localeCompare(a.revision.until) || a.notice.name.localeCompare(b.notice.name));
  lines.push("## Changes", "", "Each row is one change to one notice, newest first. To revert one, copy its Before back into the catalog entry and remove the row's `previous` record.", "");
  if (!changes.length) lines.push("No changes yet.", "");
  else {
    lines.push("| Notice | Last shown | Before | After | Change |", "| --- | --- | --- | --- | --- |");
    for (const { notice, revision } of changes) {
      const before = [revision.text ? `“${revision.text}”` : null, revision.look ?? null].filter(Boolean).join("; ");
      const after = [revision.text ? `“${notice.text}”` : null, revision.look ? STYLE_WORDS[notice.style] : null].filter(Boolean).join("; ");
      lines.push(`| \`${notice.name}\` | ${revision.until} | ${cell(before)} | ${cell(after)} | ${cell(revision.change)} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}`;
}

function show(map, query) {
  const graph = index(map);
  const node = graph.node.get(query);
  if (!node) {
    const matches = map.nodes.filter(candidate => candidate.id.toLowerCase().includes(query.toLowerCase())
      || candidate.name?.toLowerCase().includes(query.toLowerCase()));
    if (!matches.length) {
      console.log(`No item matches "${query}".`);
      return 1;
    }
    console.log(`${matches.length} items match "${query}":`);
    for (const match of matches.slice(0, 50)) console.log(`  ${match.id}  ${match.name ?? ""}`);
    return 0;
  }
  console.log(JSON.stringify(node, null, 2));
  const print = (title, list, end) => {
    if (!list?.length) return;
    console.log(`\n${title}`);
    for (const link of list) console.log(`  ${link.type} ${link[end]}  (${link.grade}; ${link.source})`);
  };
  print("Links out", graph.out.get(query), "to");
  print("Links in", graph.into.get(query), "from");
  if (node.kind === "feature") {
    console.log("\nArchitecture");
    for (const [key, values] of Object.entries(featureArchitecture(map, graph, node.id))) console.log(`  ${key}: ${values.length ? values.join(", ") : "none"}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Warning ratchet: a committed baseline of warnings per category. A ratcheted
// category fails check when it has more warnings than its baseline; fewer is a
// pass with a note, and build (or check --lower-baseline) writes the lower
// baseline. Raising a baseline is a hand edit of the JSON file, seen in review.

const DEFAULT_WARNING_BASELINE = "scripts/product-map-warning-baseline.json";

function readWarningBaseline(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return { error: `${path} is missing. Restore it from git; it records the accepted warnings per category.` };
  try {
    const baseline = JSON.parse(readFileSync(absolute, "utf8"));
    if (!baseline || typeof baseline.ratcheted !== "object" || typeof baseline.unratcheted !== "object") {
      return { error: `${path} needs "ratcheted" (category -> accepted messages) and "unratcheted" (category -> reason) objects.` };
    }
    for (const [category, messages] of Object.entries(baseline.ratcheted)) {
      if (!Array.isArray(messages) || messages.some(message => typeof message !== "string")) {
        return { error: `${path}: ratcheted category "${category}" must be an array of warning messages.` };
      }
    }
    return { baseline };
  } catch (error) {
    return { error: `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Messages in `current` beyond those in `accepted`, counting duplicates. */
function newMessages(current, accepted) {
  const remaining = new Map();
  for (const message of accepted) remaining.set(message, (remaining.get(message) ?? 0) + 1);
  const added = [];
  for (const message of current) {
    const left = remaining.get(message) ?? 0;
    if (left > 0) remaining.set(message, left - 1);
    else added.push(message);
  }
  return added;
}

function ratchetWarnings(currentWarnings, baseline, baselinePath) {
  const failures = [];
  const lowerable = [];
  for (const category of Object.keys(currentWarnings).sort()) {
    if (category in baseline.ratcheted || category in baseline.unratcheted) continue;
    failures.push(`Warning category "${category}" is not in ${baselinePath}. Add it under "ratcheted" with its accepted messages, or under "unratcheted" with a reason.`);
  }
  for (const category of Object.keys(baseline.ratcheted).sort()) {
    const accepted = baseline.ratcheted[category];
    const current = currentWarnings[category] ?? [];
    if (current.length > accepted.length) {
      const added = newMessages(current, accepted);
      failures.push([
        `Warning category "${category}" grew: ${current.length} now, baseline ${accepted.length} in ${baselinePath}. Fix the new warning(s):`,
        ...added.map(message => `    + ${message}`),
      ].join("\n"));
    } else if (current.length < accepted.length) {
      lowerable.push(`"${category}": ${current.length} now, baseline ${accepted.length}`);
    }
  }
  return { failures, lowerable };
}

/** Lowers each ratcheted category whose count did not grow to its current messages. Never raises. */
function lowerWarningBaseline(currentWarnings, baseline) {
  const ratcheted = {};
  for (const category of Object.keys(baseline.ratcheted).sort()) {
    const accepted = baseline.ratcheted[category];
    const current = [...(currentWarnings[category] ?? [])].sort();
    ratcheted[category] = current.length <= accepted.length ? current : accepted;
  }
  return { ...baseline, ratcheted };
}

const [mode = "check", ...rest] = process.argv.slice(2);
const verbose = rest.includes("--verbose");
const lowerBaseline = rest.includes("--lower-baseline");
const baselineArgument = rest.indexOf("--baseline");
const warningBaselinePath = baselineArgument === -1 ? DEFAULT_WARNING_BASELINE : rest[baselineArgument + 1];
const { map, scanned } = build();

if (mode === "show") {
  process.exitCode = show(map, rest.filter(arg => arg !== "--verbose").join(" "));
} else if (mode === "check" || mode === "build") {
  const summary = Object.entries(map.counts.nodes).map(([kind, count]) => `${count} ${kind}`).join(", ");
  if (errors.length) {
    console.error(`map:${mode} failed with ${errors.length} error(s):`);
    for (const error of errors.sort()) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`map:${mode} passed: ${summary}; ${map.links.length} links; ${scanned} source files scanned.`);
  }
  for (const [category, messages] of Object.entries(map.warnings)) {
    console.log(`warning: ${category}: ${messages.length}`);
    for (const message of verbose ? messages : messages.slice(0, 3)) console.log(`  - ${message}`);
    if (!verbose && messages.length > 3) console.log(`  … ${messages.length - 3} more (run with --verbose)`);
  }
  const { baseline, error: baselineError } = warningBaselinePath
    ? readWarningBaseline(warningBaselinePath)
    : { error: "--baseline needs a path." };
  if (baselineError) {
    console.error(baselineError);
    process.exitCode = 1;
  } else {
    const ratchet = ratchetWarnings(map.warnings, baseline, warningBaselinePath);
    if (ratchet.failures.length) {
      console.error(`map:${mode} warning ratchet failed:`);
      for (const failure of ratchet.failures) console.error(`- ${failure}`);
      console.error(`Raising a baseline is a deliberate edit of ${warningBaselinePath}; explain it in the pull request.`);
      process.exitCode = 1;
    }
    if (mode === "build" || lowerBaseline) {
      const lowered = `${JSON.stringify(lowerWarningBaseline(map.warnings, baseline), null, 2)}\n`;
      if (lowered !== readFileSync(resolve(root, warningBaselinePath), "utf8")) {
        writeFileSync(resolve(root, warningBaselinePath), lowered);
        console.log(`Updated the warning baseline in ${warningBaselinePath}${ratchet.lowerable.length ? ` (${ratchet.lowerable.join("; ")})` : ""}. Commit it.`);
      }
    } else if (ratchet.lowerable.length) {
      console.log(`Warning baseline can be lowered: ${ratchet.lowerable.join("; ")}. Run npm run map:build (or node scripts/build-product-map.mjs check --lower-baseline) and commit ${warningBaselinePath}.`);
    }
  }
  const noticesDoc = noticesMarkdown(map);
  const noticesCurrent = exists(NOTICES_DOC) && read(NOTICES_DOC) === noticesDoc;
  if (mode === "build" && !errors.length) {
    writeFileSync(join(root, "product-map.json"), `${JSON.stringify(map, null, 2)}\n`);
    writeFileSync(join(root, "docs/PRODUCT_MAP.md"), markdown(map));
    writeFileSync(join(root, NOTICES_DOC), noticesDoc);
    console.log(`Wrote ${relative(root, join(root, "product-map.json"))}, docs/PRODUCT_MAP.md and ${NOTICES_DOC}.`);
  } else if (mode === "check" && !noticesCurrent) {
    console.error(`${NOTICES_DOC} is out of date with the notices catalog. Run npm run map:build and commit it.`);
    process.exitCode = 1;
  }
} else {
  console.error(`Unknown mode ${mode}. Use check, build or show <id>.`);
  process.exitCode = 2;
}
