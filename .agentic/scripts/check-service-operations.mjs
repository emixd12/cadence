#!/usr/bin/env node

import {
  accessSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const registryRelativePath = join("contracts", "registry", "provider_services.json");
const operationCatalogRelativePath = join(".agentic", "service-operations.json");
const operationEvidenceRelativePath = join(".agentic", "runtime", "service-operation-evidence.json");
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100000;
const MAX_JSON_COLLECTION_ITEMS = 10000;
const MAX_JSON_STRING_UNITS = 256 * 1024;
const MAX_JSON_TOTAL_STRING_UNITS = 1024 * 1024;
const MAX_JSON_NUMBER_CHARS = 64;
const MAX_JSON_INTEGER_DIGITS = 16;
const CLOCK_SKEW_MS = 5000;
// Bump whenever the operation-evidence contract changes.
export const TOOL_VERSION = "1.1.0";
const OPERATION_EFFECTS = new Set(["none", "repo_write", "external_read", "external_write"]);
const OPERATION_FIELDS = new Set([
  "id", "effect", "minimum_tier", "target_selectors", "dependencies", "preflight", "readback", "approval",
  "revoke", "rollback", "ttl_seconds", "retry",
]);
const PORTABLE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const SELECTOR_ID = /^[a-z][a-z0-9_]{0,63}$/;
const SECRET_LIKE = /(?:^|_)(?:api_?)?(?:key|secret|token|password|credential|cookie|session)(?:_|$)/i;
const INLINE_SECRET = /(?:sk_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

const manifestError = (label, message) => {
  throw new Error(`${label} ${message}.`);
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
};

const definitionDigest = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");

export const operationEvidenceBinding = (catalog, operation) => ({
  catalog_digest: definitionDigest(catalog),
  operation_definition_digest: definitionDigest(operation),
  tool_version: TOOL_VERSION,
});

const requireObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) manifestError(label, "must be an object");
  return value;
};

const rejectUnknownFields = (value, allowed, label) => {
  requireObject(value, label);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) manifestError(`${label}.${field}`, "is not allowed");
  }
};

const requireString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) manifestError(label, "must be a non-empty string");
  return value;
};

const requireInteger = (value, label, minimum, maximum) => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    manifestError(label, `must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
};

const requireArray = (value, label, minimum = 0, maximum = 100) => {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    manifestError(label, `must contain ${minimum} through ${maximum} items`);
  }
  return value;
};

const requireStringArray = (value, label, minimum = 0, maximum = 100) => {
  const items = requireArray(value, label, minimum, maximum);
  for (let index = 0; index < items.length; index += 1) requireString(items[index], `${label}[${index}]`);
  return items;
};

const requirePortableId = (value, label) => {
  const identifier = requireString(value, label);
  if (!PORTABLE_ID.test(identifier)) manifestError(label, "must be a portable ID");
  return identifier;
};

const requireSafeRelativePath = (value, label) => {
  const path = requireString(value, label);
  const parts = path.split("/");
  if (
    path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path) || path.includes("\\") ||
    parts.some((part) => !part || part === "." || part === "..") || /[\u0000-\u001f\u007f<>:"|?*\[\]]/.test(path)
  ) manifestError(label, "must be a safe repository-relative path");
  return path;
};

const canonicalRoot = (root) => {
  try {
    const canonical = realpathSync(root);
    if (!lstatSync(canonical).isDirectory()) throw new Error();
    return canonical;
  } catch {
    throw new Error("project root must be an existing directory.");
  }
};

const containedPath = (root, path, label) => {
  const target = resolve(path);
  const rel = relative(root, target);
  if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    if (!rel) return target;
    throw new Error(`${label} escapes the project root.`);
  }
  return target;
};

const lstatContained = (root, path, label, optional = false) => {
  const target = containedPath(root, path, label);
  const rel = relative(root, target);
  let current = root;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (current !== target && !stat.isDirectory()) throw new Error(`${label} has an unsafe parent.`);
      if (stat.isSymbolicLink()) throw new Error(`${label} cannot be a symbolic link.`);
      if (current === target) return stat;
    } catch (error) {
      if (error?.code === "ENOENT" && optional) return null;
      if (error?.message?.startsWith(label)) throw error;
      throw new Error(`${label} cannot be inspected safely.`);
    }
  }
  return lstatSync(root);
};

const safeReadFlags = () => {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW) || fsConstants.O_NOFOLLOW === 0 ||
      !Number.isInteger(fsConstants.O_NONBLOCK) || fsConstants.O_NONBLOCK === 0) {
    throw new Error("Safe no-follow file inspection is unavailable.");
  }
  return fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW;
};

const safeReadBuffer = (root, path, label, { optional = false, maxBytes = MAX_JSON_BYTES } = {}) => {
  const target = containedPath(root, path, label);
  const before = lstatContained(root, target, label, optional);
  if (!before) return null;
  if (!before.isFile()) throw new Error(`${label} must be a regular file.`);
  let fd;
  try {
    fd = openSync(target, safeReadFlags());
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`${label} changed during inspection.`);
    }
    if (opened.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
    const content = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < content.length) {
      const count = readSync(fd, content, offset, content.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(fd, extra, 0, 1, null) !== 0) throw new Error(`${label} exceeds ${maxBytes} bytes.`);
    return content.subarray(0, offset);
  } catch (error) {
    if (error?.message?.startsWith(label)) throw error;
    throw new Error(`${label} cannot be read safely.`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
};

const safeReadText = (root, path, label, options) => {
  const content = safeReadBuffer(root, path, label, options);
  if (content === null) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new Error(`${label} is not valid UTF-8.`);
  }
};

export const parseStrictJsonText = (text, label) => {
  const fail = () => {
    throw new Error(`${label} is not valid JSON.`);
  };
  try {
    if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) fail();
    let index = 0;
    let nodes = 0;
    let collectionItems = 0;
    let totalStringUnits = 0;

    const bumpNode = () => {
      nodes += 1;
      if (nodes > MAX_JSON_NODES) fail();
    };
    const bumpCollection = (count) => {
      if (count > MAX_JSON_COLLECTION_ITEMS) fail();
      collectionItems += 1;
      if (collectionItems > MAX_JSON_NODES) fail();
    };
    const skipWhitespace = () => {
      while (index < text.length && /[\x20\x09\x0a\x0d]/.test(text[index])) index += 1;
    };
    const parseString = () => {
      if (text[index] !== '"') fail();
      index += 1;
      let value = "";
      let units = 0;
      const add = (part) => {
        value += part;
        units += part.length;
        totalStringUnits += part.length;
        if (units > MAX_JSON_STRING_UNITS || totalStringUnits > MAX_JSON_TOTAL_STRING_UNITS) fail();
      };
      while (index < text.length) {
        const character = text[index++];
        if (character === '"') return value;
        if (character === "\\") {
          const escape = text[index++];
          const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (Object.prototype.hasOwnProperty.call(simple, escape)) {
            add(simple[escape]);
            continue;
          }
          if (escape !== "u") fail();
          const digits = text.slice(index, index + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) fail();
          index += 4;
          const code = Number.parseInt(digits, 16);
          if (code >= 0xd800 && code <= 0xdbff) {
            if (text.slice(index, index + 2) !== "\\u") fail();
            const lowDigits = text.slice(index + 2, index + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(lowDigits)) fail();
            const low = Number.parseInt(lowDigits, 16);
            if (low < 0xdc00 || low > 0xdfff) fail();
            index += 6;
            add(String.fromCodePoint(0x10000 + ((code - 0xd800) << 10) + low - 0xdc00));
          } else {
            if (code >= 0xdc00 && code <= 0xdfff) fail();
            add(String.fromCharCode(code));
          }
          continue;
        }
        const code = character.charCodeAt(0);
        if (code <= 0x1f) fail();
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = text.charCodeAt(index);
          if (low < 0xdc00 || low > 0xdfff) fail();
          add(character + text[index++]);
        } else {
          if (code >= 0xdc00 && code <= 0xdfff) fail();
          add(character);
        }
      }
      fail();
    };
    const parseNumber = () => {
      const start = index;
      if (text[index] === "-") index += 1;
      const integerStart = index;
      if (text[index] === "0") index += 1;
      else {
        if (!/[1-9]/.test(text[index] || "")) fail();
        while (/[0-9]/.test(text[index] || "")) index += 1;
      }
      const integerDigits = index - integerStart;
      let syntacticInteger = true;
      if (text[index] === ".") {
        syntacticInteger = false;
        index += 1;
        if (!/[0-9]/.test(text[index] || "")) fail();
        while (/[0-9]/.test(text[index] || "")) index += 1;
      }
      if (text[index] === "e" || text[index] === "E") {
        syntacticInteger = false;
        index += 1;
        if (text[index] === "+" || text[index] === "-") index += 1;
        if (!/[0-9]/.test(text[index] || "")) fail();
        while (/[0-9]/.test(text[index] || "")) index += 1;
      }
      const token = text.slice(start, index);
      const number = Number(token);
      if (
        token.length > MAX_JSON_NUMBER_CHARS || !Number.isFinite(number) ||
        (syntacticInteger && (integerDigits > MAX_JSON_INTEGER_DIGITS || !Number.isSafeInteger(number)))
      ) fail();
    };
    const parseValue = (depth) => {
      if (depth > MAX_JSON_DEPTH) fail();
      skipWhitespace();
      bumpNode();
      const character = text[index];
      if (character === '"') {
        parseString();
        return;
      }
      if (character === "{") {
        index += 1;
        skipWhitespace();
        const keys = new Set();
        let count = 0;
        if (text[index] === "}") {
          index += 1;
          return;
        }
        while (index < text.length) {
          skipWhitespace();
          const key = parseString();
          if (keys.has(key)) fail();
          keys.add(key);
          count += 1;
          bumpCollection(count);
          skipWhitespace();
          if (text[index++] !== ":") fail();
          parseValue(depth + 1);
          skipWhitespace();
          if (text[index] === "}") {
            index += 1;
            return;
          }
          if (text[index++] !== ",") fail();
        }
        fail();
      }
      if (character === "[") {
        index += 1;
        skipWhitespace();
        let count = 0;
        if (text[index] === "]") {
          index += 1;
          return;
        }
        while (index < text.length) {
          count += 1;
          bumpCollection(count);
          parseValue(depth + 1);
          skipWhitespace();
          if (text[index] === "]") {
            index += 1;
            return;
          }
          if (text[index++] !== ",") fail();
        }
        fail();
      }
      if (character === "-" || /[0-9]/.test(character || "")) {
        parseNumber();
        return;
      }
      for (const literal of ["true", "false", "null"]) {
        if (text.startsWith(literal, index)) {
          index += literal.length;
          return;
        }
      }
      fail();
    };

    skipWhitespace();
    parseValue(0);
    skipWhitespace();
    if (index !== text.length) fail();
    return JSON.parse(text);
  } catch {
    fail();
  }
};

export const parseStrictJsonBuffer = (content, label) => {
  try {
    if (!Buffer.isBuffer(content) || content.length > MAX_JSON_BYTES) throw new Error();
    return parseStrictJsonText(new TextDecoder("utf-8", { fatal: true }).decode(content), label);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
};

const safeReadJson = (root, path, label, options) => {
  const text = safeReadText(root, path, label, options);
  return text === null ? null : parseStrictJsonText(text, label);
};

const validateCommand = (value, label) => {
  rejectUnknownFields(value, new Set(["kind", "argv", "authority"]), label);
  if (value.kind !== "command") manifestError(`${label}.kind`, "must be command");
  const argv = requireStringArray(value.argv, `${label}.argv`, 1, 64);
  if (argv.some((part) => INLINE_SECRET.test(part))) manifestError(`${label}.argv`, "cannot contain an inline credential value");
  if (value.authority !== "none") manifestError(`${label}.authority`, "must be none");
};

export const validateDependencyDeclaration = (dependency, provider, index) => {
  const label = `${provider.name}.dependencies[${index}]`;
  rejectUnknownFields(dependency, new Set(["id", "executable", "package", "version", "lock_evidence", "provisioning"]), label);
  requirePortableId(dependency.id, `${label}.id`);
  const executable = requireString(dependency.executable, `${label}.executable`);
  if (executable.includes("/")) requireSafeRelativePath(executable, `${label}.executable`);
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(executable)) manifestError(`${label}.executable`, "must be a binary name or safe path");

  rejectUnknownFields(dependency.package, new Set(["manager", "name"]), `${label}.package`);
  if (!["npm", "manual", "bundled"].includes(dependency.package.manager)) manifestError(`${label}.package.manager`, "is unknown");
  requireString(dependency.package.name, `${label}.package.name`);
  if (dependency.package.manager === "bundled") requireSafeRelativePath(dependency.package.name, `${label}.package.name`);

  rejectUnknownFields(dependency.version, new Set(["requirement"]), `${label}.version`);
  if (!["project_locked", "host_locked", "file_hash"].includes(dependency.version.requirement)) {
    manifestError(`${label}.version.requirement`, "is unknown");
  }

  rejectUnknownFields(dependency.lock_evidence, new Set(["kind", "paths", "key"]), `${label}.lock_evidence`);
  if (!["package_lock", "host_lock", "file_hash"].includes(dependency.lock_evidence.kind)) {
    manifestError(`${label}.lock_evidence.kind`, "is unknown");
  }
  const paths = requireStringArray(dependency.lock_evidence.paths, `${label}.lock_evidence.paths`, 1, 8);
  paths.forEach((path, pathIndex) => requireSafeRelativePath(path, `${label}.lock_evidence.paths[${pathIndex}]`));
  requirePortableId(dependency.lock_evidence.key, `${label}.lock_evidence.key`);

  rejectUnknownFields(dependency.provisioning, new Set(["mode", "argv"]), `${label}.provisioning`);
  if (!["package_manager", "manual", "installer"].includes(dependency.provisioning.mode)) {
    manifestError(`${label}.provisioning.mode`, "is unknown");
  }
  if (dependency.provisioning.mode === "package_manager") {
    const argv = requireStringArray(dependency.provisioning.argv, `${label}.provisioning.argv`, 1, 32);
    if (argv.some((part) => INLINE_SECRET.test(part))) manifestError(`${label}.provisioning.argv`, "cannot contain an inline credential value");
  } else if (dependency.provisioning.argv !== null) {
    manifestError(`${label}.provisioning.argv`, "must be null for manual or installer provisioning");
  }

  const tuples = {
    npm: ["project_locked", "package_lock", "package_manager"],
    manual: ["host_locked", "host_lock", "manual"],
    bundled: ["file_hash", "file_hash", "installer"],
  };
  const expected = tuples[dependency.package.manager];
  if (
    dependency.version.requirement !== expected[0] || dependency.lock_evidence.kind !== expected[1] ||
    dependency.provisioning.mode !== expected[2]
  ) manifestError(label, "has an incompatible dependency tuple");
  if (dependency.package.manager === "npm") {
    if (!dependency.executable.startsWith("node_modules/.bin/")) manifestError(`${label}.executable`, "must be project-local for npm");
    const argv = dependency.provisioning.argv;
    const packages = argv.slice(2).filter((item) => !item.startsWith("-"));
    if (argv[0] !== "npm" || argv[1] !== "install" || packages.length !== 1 || packages[0] !== dependency.package.name) {
      manifestError(`${label}.provisioning.argv`, "must install the declared npm package");
    }
  }
  if (dependency.package.manager === "manual" && dependency.executable.includes("/")) {
    manifestError(`${label}.executable`, "must be a host executable for manual provisioning");
  }
  if (dependency.package.manager === "bundled") {
    if (dependency.executable !== dependency.package.name || paths.length !== 1 || paths[0] !== dependency.package.name) {
      manifestError(`${label}.lock_evidence.paths`, "must match the bundled executable path");
    }
    if (!provider.payload_paths.includes(dependency.package.name)) {
      manifestError(`${label}.package.name`, "must reference a provider-owned payload target");
    }
  }
};

const validateOperation = (operation, provider, index, dependencyIds) => {
  const label = `${provider.name}.operations[${index}]`;
  rejectUnknownFields(operation, OPERATION_FIELDS, label);
  for (const field of OPERATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(operation, field)) manifestError(`${label}.${field}`, "is required");
  }
  if (!requirePortableId(operation.id, `${label}.id`).startsWith(`service-connections.${provider.name}.`)) {
    manifestError(`${label}.id`, "must use the provider prefix");
  }
  if (!OPERATION_EFFECTS.has(operation.effect)) manifestError(`${label}.effect`, "is unknown");
  if (!provider.tiers.includes(operation.minimum_tier)) manifestError(`${label}.minimum_tier`, "references an unknown tier");
  const selectors = requireArray(operation.target_selectors, `${label}.target_selectors`, 1, 16);
  const selectorNames = new Set();
  selectors.forEach((selector, selectorIndex) => {
    const selectorLabel = `${label}.target_selectors[${selectorIndex}]`;
    rejectUnknownFields(selector, new Set(["name", "source", "required"]), selectorLabel);
    const name = requireString(selector.name, `${selectorLabel}.name`);
    if (!SELECTOR_ID.test(name) || SECRET_LIKE.test(name) || selectorNames.has(name)) manifestError(`${selectorLabel}.name`, "is invalid");
    selectorNames.add(name);
    if (selector.required !== true) manifestError(`${selectorLabel}.required`, "must be true");
    rejectUnknownFields(selector.source, new Set(["kind", "key"]), `${selectorLabel}.source`);
    if (selector.source.kind !== "argument" || selector.source.key !== name) manifestError(`${selectorLabel}.source`, "must use the matching argument");
  });
  requireStringArray(operation.dependencies, `${label}.dependencies`, 1, 16).forEach((dependency) => {
    if (!dependencyIds.has(dependency)) manifestError(`${label}.dependencies`, "references an unknown dependency");
  });
  validateCommand(operation.preflight, `${label}.preflight`);
  validateCommand(operation.readback, `${label}.readback`);
  rejectUnknownFields(operation.approval, new Set(["mode", "scope", "ttl_seconds"]), `${label}.approval`);
  const expectedMode = operation.effect === "external_write" ? "explicit" : operation.effect === "repo_write" ? "local_patch" : "not_required";
  if (operation.approval.mode !== expectedMode) manifestError(`${label}.approval.mode`, "contradicts the effect");
  const approvalTtl = requireInteger(operation.approval.ttl_seconds, `${label}.approval.ttl_seconds`, 0, 86400);
  const ttl = requireInteger(operation.ttl_seconds, `${label}.ttl_seconds`, 1, 86400);
  if (approvalTtl > ttl) manifestError(`${label}.approval.ttl_seconds`, "cannot exceed operation TTL");
  for (const field of ["revoke", "rollback"]) {
    rejectUnknownFields(operation[field], new Set(["kind", "steps"]), `${label}.${field}`);
    if (!["command", "manual", "none"].includes(operation[field].kind)) manifestError(`${label}.${field}.kind`, "is unknown");
    requireStringArray(operation[field].steps, `${label}.${field}.steps`, 1, 16);
  }
  rejectUnknownFields(operation.retry, new Set(["classifier", "transient", "permanent"]), `${label}.retry`);
  if (operation.retry.classifier !== "exit_code") manifestError(`${label}.retry.classifier`, "must be exit_code");
  rejectUnknownFields(operation.retry.transient, new Set(["max_attempts", "backoff_seconds", "exit_codes"]), `${label}.retry.transient`);
  requireInteger(operation.retry.transient.max_attempts, `${label}.retry.transient.max_attempts`, 1, 5);
  requireInteger(operation.retry.transient.backoff_seconds, `${label}.retry.transient.backoff_seconds`, 0, 300);
  requireArray(operation.retry.transient.exit_codes, `${label}.retry.transient.exit_codes`, 0, 32).forEach((code, codeIndex) =>
    requireInteger(code, `${label}.retry.transient.exit_codes[${codeIndex}]`, 0, 255));
  rejectUnknownFields(operation.retry.permanent, new Set(["max_attempts"]), `${label}.retry.permanent`);
  requireInteger(operation.retry.permanent.max_attempts, `${label}.retry.permanent.max_attempts`, 1, 1);
};

const validateOperationCatalog = (catalog) => {
  const label = operationCatalogRelativePath;
  rejectUnknownFields(catalog, new Set(["schema_version", "source_skill", "unknown_command_effect", "external_writer_limit", "evidence", "providers"]), label);
  if (catalog.schema_version !== "1.0" || catalog.source_skill !== "service-connections-bootstrap") manifestError(label, "has an unknown schema");
  if (catalog.unknown_command_effect !== "external_write" || catalog.external_writer_limit !== 1) manifestError(label, "has unsafe policy defaults");
  rejectUnknownFields(catalog.evidence, new Set(["path", "scope", "tracked"]), `${label}.evidence`);
  if (
    catalog.evidence.path !== operationEvidenceRelativePath.split("\\").join("/") ||
    catalog.evidence.scope !== "host_local" || catalog.evidence.tracked !== false
  ) manifestError(`${label}.evidence`, "must use untracked host-local evidence");
  const providers = requireArray(catalog.providers, `${label}.providers`, 1, 100);
  const providerNames = new Set();
  const operationIds = new Set();
  providers.forEach((provider, providerIndex) => {
    const providerLabel = `${label}.providers[${providerIndex}]`;
    rejectUnknownFields(provider, new Set(["name", "active_tier", "tiers", "payload_paths", "dependencies", "operations"]), providerLabel);
    requirePortableId(provider.name, `${providerLabel}.name`);
    if (providerNames.has(provider.name)) manifestError(`${label}.providers`, "contains a duplicate provider");
    providerNames.add(provider.name);
    const tiers = requireStringArray(provider.tiers, `${providerLabel}.tiers`, 1, 16);
    if (new Set(tiers).size !== tiers.length || !tiers.includes(provider.active_tier)) manifestError(`${providerLabel}.tiers`, "is invalid");
    const payloadPaths = requireStringArray(provider.payload_paths, `${providerLabel}.payload_paths`, 0, 64);
    payloadPaths.forEach((path, pathIndex) => requireSafeRelativePath(path, `${providerLabel}.payload_paths[${pathIndex}]`));
    if (new Set(payloadPaths).size !== payloadPaths.length) manifestError(`${providerLabel}.payload_paths`, "contains a duplicate path");
    const dependencies = requireArray(provider.dependencies, `${providerLabel}.dependencies`, 1, 32);
    const dependencyIds = new Set();
    dependencies.forEach((dependency, dependencyIndex) => {
      validateDependencyDeclaration(dependency, provider, dependencyIndex);
      if (dependencyIds.has(dependency.id)) manifestError(`${providerLabel}.dependencies`, "contains a duplicate ID");
      dependencyIds.add(dependency.id);
    });
    requireArray(provider.operations, `${providerLabel}.operations`, 1, 64).forEach((operation, operationIndex) => {
      validateOperation(operation, provider, operationIndex, dependencyIds);
      if (operationIds.has(operation.id)) manifestError(`${label}.providers`, "contains a duplicate operation ID");
      operationIds.add(operation.id);
    });
  });
  return catalog;
};

const normalizedRegistryField = (field) => field
  .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const rejectRegistryEvidence = (value) => {
  if (Array.isArray(value)) return value.forEach(rejectRegistryEvidence);
  if (!value || typeof value !== "object") return;
  for (const [field, nested] of Object.entries(value)) {
    const normalized = normalizedRegistryField(field);
    const tokens = normalized.split("_");
    if (
      ["approval", "approvals", "authorization", "authorizations", "authorized", "authority", "evidence"].some((word) => tokens.includes(word)) ||
      ["approved_at", "dependency_hash", "expires_at", "observed_at", "preflight", "readback", "target_hash", "ttl", "ttl_seconds"].includes(normalized)
    ) manifestError(registryRelativePath, "cannot contain operation evidence or authorization");
    rejectRegistryEvidence(nested);
  }
};

const loadRegistry = (projectRoot) => {
  const registry = safeReadJson(projectRoot, join(projectRoot, registryRelativePath), registryRelativePath, { optional: true });
  if (!registry) return { services: [] };
  requireObject(registry, registryRelativePath);
  rejectRegistryEvidence(registry);
  if (!Array.isArray(registry.services)) manifestError(`${registryRelativePath}.services`, "must be an array");
  return registry;
};

const registryTier = (registry, provider) => {
  const matches = registry.services.filter((service) =>
    service && typeof service === "object" && !Array.isArray(service) &&
    String(service.name || "").toLowerCase() === provider.name.toLowerCase());
  if (matches.length === 0) return { valid: false, status: "missing", entry: null, activeTier: null };
  if (matches.length !== 1) return { valid: false, status: "duplicate", entry: null, activeTier: null };
  const entry = matches[0];
  if (typeof entry.scope_tier !== "string" || !provider.tiers.includes(entry.scope_tier)) {
    return { valid: false, status: "malformed", entry, activeTier: null };
  }
  if (entry.scope_tier !== provider.active_tier) {
    return { valid: false, status: "catalog_tier_mismatch", entry, activeTier: entry.scope_tier };
  }
  return { valid: true, status: "valid", entry, activeTier: entry.scope_tier };
};

const fixedGitExecutable = () => {
  const candidates = process.platform === "win32"
    ? ["C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files (x86)\\Git\\cmd\\git.exe"]
    : ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Fixed local locations only.
    }
  }
  return null;
};

const runLocalGitInspection = (git, projectRoot, args) => spawnSync(git, [
  "--no-pager", "-c", `core.excludesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
  "-c", "core.fsmonitor=false", "-c", "maintenance.auto=false", ...args,
], {
  cwd: projectRoot,
  encoding: "utf8",
  env: {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  },
  maxBuffer: 1024,
  timeout: 2000,
  windowsHide: true,
});

const gitignorePatternRegex = (pattern) => {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "[" || character === "\\") return null;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else source += ".*";
      } else source += "[^/]*";
    } else if (character === "?") source += "[^/]";
    else source += character.replace(/[.+^${}()|]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
};

const gitignoreRuleMatchesEvidence = (rawRule, relativeEvidencePath) => {
  let rule = rawRule.trim();
  if (!rule || rule.startsWith("#")) return { relevant: false, negated: false, ambiguous: false };
  const negated = rule.startsWith("!");
  if (negated) rule = rule.slice(1);
  if (rule.startsWith("/")) rule = rule.slice(1);
  const directoryRule = rule.endsWith("/");
  if (directoryRule) rule = rule.slice(0, -1);
  const regex = gitignorePatternRegex(rule);
  if (!regex) {
    const hint = rule.includes("agentic") || rule.includes("runtime") || rule.includes("service-operation-evidence") || rule.includes("*");
    return { relevant: hint, negated, ambiguous: hint };
  }
  const candidates = directoryRule
    ? relativeEvidencePath.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"))
    : [relativeEvidencePath];
  const relevant = rule.includes("/")
    ? candidates.some((candidate) => regex.test(candidate))
    : candidates.some((candidate) => candidate.split("/").some((part) => regex.test(part)));
  return { relevant, negated, ambiguous: false };
};

const nonGitEvidenceStorage = (projectRoot, evidencePath, rootGitignore = null) => {
  const ignoreFiles = [
    { path: join(projectRoot, ".gitignore"), prefix: "", label: ".gitignore" },
    { path: join(projectRoot, ".agentic", ".gitignore"), prefix: ".agentic/", label: ".agentic/.gitignore" },
    { path: join(projectRoot, ".agentic", "runtime", ".gitignore"), prefix: ".agentic/runtime/", label: ".agentic/runtime/.gitignore" },
  ];
  let ignored = false;
  for (const ignoreFile of ignoreFiles) {
    if (!evidencePath.startsWith(ignoreFile.prefix)) continue;
    const text = ignoreFile.label === ".gitignore" && rootGitignore !== null
      ? rootGitignore
      : safeReadText(projectRoot, ignoreFile.path, ignoreFile.label, { optional: true });
    if (text === null) continue;
    const scopedPath = evidencePath.slice(ignoreFile.prefix.length);
    for (const rule of text.split(/\r?\n/)) {
      const result = gitignoreRuleMatchesEvidence(rule, scopedPath);
      if (!result.relevant) continue;
      if (result.ambiguous) return {
        ready: false,
        status: "ambiguous_ignore_rules",
        repository: "non_git",
        ignored: false,
        tracked: null,
        ignore_file: ignoreFile.label,
        rule,
        evidence_path: evidencePath,
        remediation: "Replace the ambiguous rule with an exact ignore rule for the evidence path, then rerun the check.",
      };
      ignored = !result.negated;
    }
  }
  return { ready: ignored, status: ignored ? "ignored_untracked" : "not_ignored", repository: "non_git", ignored, tracked: null };
};

const evidenceStorageReport = (projectRoot, evidencePath) => {
  for (const [path, label] of [
    [join(projectRoot, ".gitignore"), ".gitignore"],
    [join(projectRoot, ".agentic", ".gitignore"), ".agentic/.gitignore"],
    [join(projectRoot, ".agentic", "runtime", ".gitignore"), ".agentic/runtime/.gitignore"],
  ]) safeReadText(projectRoot, path, label, { optional: true });
  const git = fixedGitExecutable();
  if (!git) return { ready: false, status: "inspection_unavailable", repository: "unknown", ignored: false, tracked: null };
  const ignored = runLocalGitInspection(git, projectRoot, ["check-ignore", "-q", "--no-index", "--", evidencePath]);
  const tracked = runLocalGitInspection(git, projectRoot, ["ls-files", "--error-unmatch", "--", evidencePath]);
  if (ignored.status === 128 && tracked.status === 128) return nonGitEvidenceStorage(projectRoot, evidencePath);
  if (![0, 1].includes(ignored.status) || ![0, 1].includes(tracked.status)) {
    return { ready: false, status: "inspection_failed", repository: "git", ignored: false, tracked: null };
  }
  if (tracked.status === 0) return { ready: false, status: "tracked", repository: "git", ignored: ignored.status === 0, tracked: true };
  if (ignored.status !== 0) return { ready: false, status: "not_ignored", repository: "git", ignored: false, tracked: false };
  return { ready: true, status: "ignored_untracked", repository: "git", ignored: true, tracked: false };
};

export const inspectEvidenceStorage = (projectRoot) => evidenceStorageReport(
  canonicalRoot(projectRoot),
  operationEvidenceRelativePath.split("\\").join("/")
);

export const inspectProjectedEvidenceStorage = (projectRoot, rootGitignore) => {
  const canonical = canonicalRoot(projectRoot);
  if (typeof rootGitignore !== "string" || Buffer.byteLength(rootGitignore, "utf8") > MAX_JSON_BYTES) {
    return { ready: false, status: "inspection_failed", repository: "unknown", ignored: false, tracked: null };
  }
  for (const [path, label] of [
    [join(canonical, ".agentic", ".gitignore"), ".agentic/.gitignore"],
    [join(canonical, ".agentic", "runtime", ".gitignore"), ".agentic/runtime/.gitignore"],
  ]) safeReadText(canonical, path, label, { optional: true });
  const git = fixedGitExecutable();
  if (!git) return { ready: false, status: "inspection_unavailable", repository: "unknown", ignored: false, tracked: null };
  const tracked = runLocalGitInspection(git, canonical, ["ls-files", "--error-unmatch", "--", operationEvidenceRelativePath]);
  if (tracked.status === 0) return { ready: false, status: "tracked", repository: "git", ignored: true, tracked: true };
  if (tracked.status === 128) return nonGitEvidenceStorage(canonical, operationEvidenceRelativePath, rootGitignore);
  if (tracked.status !== 1) return { ready: false, status: "inspection_failed", repository: "git", ignored: false, tracked: null };
  const projected = nonGitEvidenceStorage(canonical, operationEvidenceRelativePath, rootGitignore);
  return { ...projected, repository: "git", tracked: false };
};

const executablePath = (projectRoot, executable) => {
  const pathDirectories = String(process.env.PATH || "").split(delimiter).filter(Boolean);
  let candidates;
  if (executable.includes("/")) candidates = [join(projectRoot, executable)];
  else if (executable === "node") candidates = [process.execPath];
  else {
    const extensions = String(process.env.PATHEXT || "").split(";").filter(Boolean);
    candidates = pathDirectories.flatMap((directory) => {
      const names = [executable];
      if (extensions.length && !extensions.some((extension) => executable.toLowerCase().endsWith(extension.toLowerCase()))) {
        try {
          const entries = readdirSync(directory);
          for (const extension of extensions) {
            const expected = `${executable}${extension}`.toLowerCase();
            const found = entries.find((entry) => entry.toLowerCase() === expected);
            if (found) names.push(found);
          }
        } catch {
          extensions.forEach((extension) => names.push(`${executable}${extension}`));
        }
      }
      return names.map((name) => join(directory, name));
    });
  }
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Discovery never executes the candidate.
    }
  }
  return null;
};

const packageDeclaration = (projectRoot, dependency) => {
  if (dependency.package.manager !== "npm") return "not_applicable";
  const pkg = safeReadJson(projectRoot, join(projectRoot, "package.json"), "package.json", { optional: true });
  if (!pkg) return null;
  return pkg.dependencies?.[dependency.package.name] ?? pkg.devDependencies?.[dependency.package.name] ?? null;
};

const packageLockEntry = (lock, packageName) => {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) return null;
  if (lock.lockfileVersion === 1) return lock.dependencies?.[packageName];
  if (lock.lockfileVersion === 2 || lock.lockfileVersion === 3) return lock.packages?.[`node_modules/${packageName}`];
  return null;
};

const dependencyReport = (projectRoot, dependencies, evidenceRecords = []) => {
  const hash = createHash("sha256");
  const missing = [];
  for (const dependency of [...dependencies].sort((left, right) => left.id.localeCompare(right.id))) {
    const packageVersion = packageDeclaration(projectRoot, dependency);
    const packageReady = dependency.package.manager !== "npm" ||
      (typeof packageVersion === "string" && packageVersion.trim().length > 0);
    const bundled = dependency.package.manager === "bundled"
      ? safeReadBuffer(projectRoot, join(projectRoot, dependency.executable), dependency.executable, { optional: true })
      : null;
    const executable = dependency.package.manager === "bundled"
      ? (bundled === null ? null : dependency.executable)
      : executablePath(projectRoot, dependency.executable);
    const lockPaths = [];
    for (const path of dependency.lock_evidence.paths) {
      if (dependency.lock_evidence.kind === "package_lock" && !["package-lock.json", "npm-shrinkwrap.json"].includes(path.split("/").pop())) continue;
      const content = safeReadBuffer(projectRoot, join(projectRoot, path), path, { optional: true });
      if (content !== null) lockPaths.push({ path, content });
    }
    const packageLockReady = dependency.lock_evidence.kind !== "package_lock" || lockPaths.some((item) => {
      const lock = parseStrictJsonBuffer(item.content, item.path);
      const entry = packageLockEntry(lock, dependency.package.name);
      return entry && typeof entry === "object" && typeof entry.version === "string" && entry.version.trim();
    });
    const hostLockReady = dependency.lock_evidence.kind !== "host_lock" || lockPaths.some((item) => {
      const lock = parseStrictJsonBuffer(item.content, item.path);
      const value = lock[dependency.lock_evidence.key] ?? lock.dependencies?.[dependency.lock_evidence.key];
      return typeof value === "string" && value.trim();
    });
    const bundledReady = dependency.package.manager !== "bundled" || bundled !== null;
    if (!executable || !packageReady || !bundledReady || lockPaths.length === 0 || !packageLockReady || !hostLockReady) missing.push(dependency.id);
    hash.update(`${dependency.id}\0${executable || "missing"}\0${packageVersion || "missing"}\0${bundledReady}\0${packageLockReady}\0${hostLockReady}\0`);
    if (bundled !== null) hash.update(bundled);
    hash.update("\0");
    for (const item of lockPaths.sort((left, right) => left.path.localeCompare(right.path))) {
      hash.update(`${item.path}\0`);
      hash.update(item.content);
      hash.update("\0");
    }
  }
  const fingerprint = hash.digest("hex");
  return {
    ready: missing.length === 0,
    missing,
    fingerprint,
    version_changed: evidenceRecords.some((record) => record.dependency_hash !== fingerprint),
  };
};

const requireTimestamp = (value, label) => {
  const timestamp = requireString(value, label);
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/);
  const parsed = Date.parse(timestamp);
  const year = match ? Number(match[1]) : 0;
  const month = match ? Number(match[2]) : 0;
  const day = match ? Number(match[3]) : 0;
  const hour = match ? Number(match[4]) : 0;
  const minute = match ? Number(match[5]) : 0;
  const second = match ? Number(match[6]) : 0;
  const offsetHour = match && match[7] ? Number(match[7]) : 0;
  const offsetMinute = match && match[8] ? Number(match[8]) : 0;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [0, 31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    !match || !Number.isFinite(parsed) || year < 1 || month < 1 || month > 12 ||
    day < 1 || day > daysInMonth[month] || hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) manifestError(label, "must be an RFC3339 timestamp");
  return timestamp;
};

export const validateOperationEvidenceRecord = (record, label = "operation evidence") => {
  rejectUnknownFields(record, new Set([
    "operation_id", "target_hash", "tier", "dependency_hash", "catalog_digest",
    "operation_definition_digest", "tool_version", "preflight", "readback", "expires_at",
  ]), label);
  requirePortableId(record.operation_id, `${label}.operation_id`);
  requireString(record.tier, `${label}.tier`);
  for (const field of ["target_hash", "dependency_hash", "catalog_digest", "operation_definition_digest"]) {
    if (!/^[a-f0-9]{64}$/.test(record[field] || "")) manifestError(`${label}.${field}`, "must be a SHA-256 digest");
  }
  if (!/^\d+\.\d+\.\d+$/.test(record.tool_version || "")) manifestError(`${label}.tool_version`, "must be a semantic version");
  for (const field of ["preflight", "readback"]) {
    rejectUnknownFields(record[field], new Set(["status", "observed_at"]), `${label}.${field}`);
    if (!["passed", "failed"].includes(record[field].status)) manifestError(`${label}.${field}.status`, "is unknown");
    requireTimestamp(record[field].observed_at, `${label}.${field}.observed_at`);
  }
  requireTimestamp(record.expires_at, `${label}.expires_at`);
  return record;
};

const validateOperationEvidence = (value, catalog) => {
  const label = operationEvidenceRelativePath;
  rejectUnknownFields(value, new Set(["schema_version", "evidence", "approvals"]), label);
  if (value.schema_version !== "1.0") manifestError(`${label}.schema_version`, "must be 1.0");
  const operations = new Map(catalog.providers.flatMap((provider) => provider.operations.map((operation) => [operation.id, { provider, operation }])));
  requireArray(value.evidence, `${label}.evidence`, 0, 1000).forEach((record, index) => {
    const recordLabel = `${label}.evidence[${index}]`;
    validateOperationEvidenceRecord(record, recordLabel);
    const found = operations.get(record.operation_id);
    if (!found) manifestError(`${recordLabel}.operation_id`, "references an unknown operation");
    if (!found.provider.tiers.includes(record.tier)) manifestError(`${recordLabel}.tier`, "references an unknown tier");
  });
  requireArray(value.approvals, `${label}.approvals`, 0, 1000).forEach((approval, index) => {
    const approvalLabel = `${label}.approvals[${index}]`;
    rejectUnknownFields(approval, new Set(["operation_id", "target_hash", "approved_at", "expires_at"]), approvalLabel);
    const found = operations.get(requirePortableId(approval.operation_id, `${approvalLabel}.operation_id`));
    if (!found || found.operation.approval.mode !== "explicit") manifestError(`${approvalLabel}.operation_id`, "does not accept approval");
    if (!/^[a-f0-9]{64}$/.test(approval.target_hash || "")) manifestError(`${approvalLabel}.target_hash`, "must be a SHA-256 digest");
    requireTimestamp(approval.approved_at, `${approvalLabel}.approved_at`);
    requireTimestamp(approval.expires_at, `${approvalLabel}.expires_at`);
  });
  return value;
};

const readOperationEvidence = (projectRoot, catalog) => {
  const value = safeReadJson(projectRoot, join(projectRoot, catalog.evidence.path), catalog.evidence.path, { optional: true });
  return value ? validateOperationEvidence(value, catalog) : { schema_version: "1.0", evidence: [], approvals: [] };
};

const operationCliOptions = (argv) => {
  const options = { command: argv[0], projectRoot: process.cwd(), operation: null, targets: new Map(), json: false };
  if (!["plan", "check", "status"].includes(options.command)) manifestError("operation command", "must be plan, check, or status");
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--project-root") {
      if (!argv[++index]) manifestError("--project-root", "requires a path");
      options.projectRoot = argv[index];
    } else if (arg === "--operation") {
      if (!argv[++index]) manifestError("--operation", "requires an operation ID");
      options.operation = argv[index];
    } else if (arg === "--target") {
      if (!argv[++index]) manifestError("--target", "requires selector=value");
      const separator = argv[index].indexOf("=");
      const name = separator > 0 ? argv[index].slice(0, separator) : "";
      const value = separator > 0 ? argv[index].slice(separator + 1) : "";
      if (!SELECTOR_ID.test(name) || SECRET_LIKE.test(name)) manifestError("--target selector", "must be a non-secret selector ID");
      if (!value || value.length > 512) manifestError(`--target ${name}`, "requires a bounded non-empty value");
      if (INLINE_SECRET.test(value)) manifestError(`--target ${name}`, "cannot contain a credential value");
      if (options.targets.has(name)) manifestError(`--target ${name}`, "was provided more than once");
      options.targets.set(name, value);
    } else manifestError("operation arguments", "contain an unknown option");
  }
  options.projectRoot = canonicalRoot(resolve(options.projectRoot));
  if (options.command === "plan" && !options.operation) manifestError("plan", "requires --operation");
  if (options.command === "status" && options.operation) manifestError("status", "does not accept --operation");
  if (!options.operation && options.targets.size) manifestError("--target", "requires --operation");
  return options;
};

const targetReport = (operation, targets) => {
  const expected = operation.target_selectors.map((selector) => selector.name).sort();
  const unexpected = Array.from(targets.keys()).filter((name) => !expected.includes(name)).sort();
  if (unexpected.length) manifestError(`--target ${unexpected[0]}`, "is not declared for this operation");
  const missing = expected.filter((name) => !targets.has(name));
  const canonical = expected.filter((name) => targets.has(name)).map((name) => [name, targets.get(name)]);
  return { complete: missing.length === 0, missing, selector_names: expected, hash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
};

const chronologyStatus = ({ timestamp, expiresAt, ttlSeconds, now }) => {
  const observed = Date.parse(timestamp);
  const expires = Date.parse(expiresAt);
  const ttl = ttlSeconds * 1000;
  if (observed > expires) return { status: "reversed" };
  if (observed > now + CLOCK_SKEW_MS) return { status: "future" };
  if (now - observed > ttl) return { status: "stale" };
  if (expires - observed > ttl) return { status: "ttl_exceeded" };
  return { status: "fresh", observed_at: timestamp };
};

const evidenceStatus = ({ records, catalog, operation, targetHash, activeTier, dependencyHash, now }) => {
  const forOperation = records.filter((record) => record.operation_id === operation.id);
  if (!forOperation.length) return { status: "missing" };
  const forTarget = forOperation.filter((record) => record.target_hash === targetHash);
  if (!forTarget.length) return { status: "target_mismatch" };
  const forTier = forTarget.filter((record) => record.tier === activeTier);
  if (!forTier.length) return { status: "tier_mismatch" };
  const record = forTier[forTier.length - 1];
  const binding = operationEvidenceBinding(catalog, operation);
  if (record.catalog_digest !== binding.catalog_digest) return { status: "catalog_changed" };
  if (record.operation_definition_digest !== binding.operation_definition_digest) return { status: "definition_changed" };
  if (record.tool_version !== binding.tool_version) return { status: "tool_changed" };
  if (Date.parse(record.expires_at) <= now) return { status: "expired" };
  if (record.dependency_hash !== dependencyHash) return { status: "dependency_changed" };
  if (record.preflight.status !== "passed" || record.readback.status !== "passed") return { status: "incomplete" };
  const preflight = chronologyStatus({ timestamp: record.preflight.observed_at, expiresAt: record.expires_at, ttlSeconds: operation.ttl_seconds, now });
  const readback = chronologyStatus({ timestamp: record.readback.observed_at, expiresAt: record.expires_at, ttlSeconds: operation.ttl_seconds, now });
  if (preflight.status !== "fresh") return { status: `preflight_${preflight.status}`, preflight, readback };
  if (readback.status !== "fresh") return { status: `readback_${readback.status}`, preflight, readback };
  if (Date.parse(record.readback.observed_at) < Date.parse(record.preflight.observed_at)) {
    return { status: "readback_before_preflight", preflight, readback: { status: "before_preflight" } };
  }
  return { status: "fresh", preflight, readback, expires_at: record.expires_at };
};

const approvalStatus = ({ approvals, operation, targetHash, now }) => {
  if (operation.approval.mode !== "explicit") return { required: false, status: operation.approval.mode };
  const forOperation = approvals.filter((approval) => approval.operation_id === operation.id);
  if (!forOperation.length) return { required: true, status: "missing" };
  const forTarget = forOperation.filter((approval) => approval.target_hash === targetHash);
  if (!forTarget.length) return { required: true, status: "target_mismatch" };
  const approval = forTarget[forTarget.length - 1];
  if (Date.parse(approval.expires_at) <= now) return { required: true, status: "expired" };
  const chronology = chronologyStatus({ timestamp: approval.approved_at, expiresAt: approval.expires_at, ttlSeconds: operation.approval.ttl_seconds, now });
  return chronology.status === "fresh"
    ? { required: true, status: "recorded_untrusted", expires_at: approval.expires_at }
    : { required: true, status: chronology.status };
};

const operationPlan = ({ projectRoot, catalog, registry, evidence, evidenceStorage, operationId, targets }) => {
  const provider = catalog.providers.find((item) => item.operations.some((operation) => operation.id === operationId));
  if (!provider) manifestError("--operation", "references an unknown operation ID");
  const operation = provider.operations.find((item) => item.id === operationId);
  const registryReport = registryTier(registry, provider);
  const activeTier = registryReport.activeTier;
  const requiredIndex = provider.tiers.indexOf(operation.minimum_tier);
  const activeIndex = activeTier === null ? -1 : provider.tiers.indexOf(activeTier);
  const tier = {
    active: registryReport.valid && activeIndex >= requiredIndex,
    active_tier: activeTier,
    catalog_tier: provider.active_tier,
    minimum_tier: operation.minimum_tier,
    registry_status: registryReport.status,
  };
  const target = targetReport(operation, targets);
  const matchingEvidence = evidence.evidence.filter((record) =>
    record.operation_id === operation.id && record.target_hash === target.hash && record.tier === activeTier);
  const dependencies = dependencyReport(projectRoot, provider.dependencies.filter((dependency) => operation.dependencies.includes(dependency.id)), matchingEvidence);
  const now = Date.now();
  const evidenceReport = evidenceStatus({ records: evidence.evidence, catalog, operation, targetHash: target.hash, activeTier, dependencyHash: dependencies.fingerprint, now });
  const approval = approvalStatus({ approvals: evidence.approvals, operation, targetHash: target.hash, now });
  const authorized = registryReport.valid && evidenceStorage.ready && tier.active && target.complete && dependencies.ready &&
    evidenceReport.status === "fresh" && !approval.required;
  return {
    schema_version: "1.0",
    mode: "read_only",
    provider_contact: false,
    command_execution: false,
    operation_id: operation.id,
    provider: provider.name,
    effect: operation.effect,
    unknown_command_effect: catalog.unknown_command_effect,
    registry_state_summary: registryReport.entry?.state || null,
    tier,
    target,
    dependencies,
    declarations: {
      preflight: { declared: true, kind: operation.preflight.kind, authority: operation.preflight.authority },
      readback: { declared: true, kind: operation.readback.kind, authority: operation.readback.authority },
      revoke: { declared: true, kind: operation.revoke.kind },
      rollback: { declared: true, kind: operation.rollback.kind },
    },
    evidence_storage: evidenceStorage,
    evidence: evidenceReport,
    evidence_binding: operationEvidenceBinding(catalog, operation),
    approval,
    retry: operation.retry,
    authorized,
  };
};

const operationStatus = ({ projectRoot, catalog, registry, evidenceStorage }) => {
  const providers = catalog.providers.map((provider) => {
    const registryReport = registryTier(registry, provider);
    const dependencies = dependencyReport(projectRoot, provider.dependencies);
    return {
      provider: provider.name,
      active_tier: registryReport.activeTier,
      catalog_tier: provider.active_tier,
      registry_state_summary: registryReport.entry?.state || null,
      registry_status: registryReport.status,
      operations: provider.operations.length,
      dependencies,
      healthy: registryReport.valid && dependencies.ready && provider.operations.length > 0,
    };
  });
  return {
    schema_version: "1.0",
    mode: "read_only",
    provider_contact: false,
    command_execution: false,
    unknown_command_effect: catalog.unknown_command_effect,
    external_writer_limit: catalog.external_writer_limit,
    evidence_storage: evidenceStorage,
    providers,
    healthy: evidenceStorage.ready && providers.every((provider) => provider.healthy),
  };
};

export const runOperationCli = (argv) => {
  const options = operationCliOptions(argv);
  const catalog = validateOperationCatalog(safeReadJson(
    options.projectRoot,
    join(options.projectRoot, operationCatalogRelativePath),
    operationCatalogRelativePath
  ));
  const registry = loadRegistry(options.projectRoot);
  const evidenceStorage = evidenceStorageReport(options.projectRoot, catalog.evidence.path);
  const evidence = evidenceStorage.ready
    ? readOperationEvidence(options.projectRoot, catalog)
    : { schema_version: "1.0", evidence: [], approvals: [] };
  if (!options.operation) {
    const report = operationStatus({ projectRoot: options.projectRoot, catalog, registry, evidenceStorage });
    console.log(options.json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
    return options.command !== "check" || report.healthy;
  }
  const report = operationPlan({
    projectRoot: options.projectRoot,
    catalog,
    registry,
    evidence,
    evidenceStorage,
    operationId: options.operation,
    targets: options.targets,
  });
  console.log(options.json ? JSON.stringify(report) : JSON.stringify(report, null, 2));
  return options.command !== "check" || report.authorized;
};

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(scriptPath)) {
  try {
    if (!runOperationCli(process.argv.slice(2))) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
