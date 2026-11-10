#!/usr/bin/env node
// Test-access preflight engine.
//
// Generic over a project manifest (default `.agentic/test-access.json`). The engine
// selects requirements for the requested suites, orders them by dependency, probes
// them through project commands, runs agent renewals, and prints one numbered owner
// list. It never reads or prints a secret value: probes and renewals report through a
// fixed exit-code contract, and any text they print is redacted before use.
//
// Schema and contract: references/test-access-preflight.md.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_VERSION = "1.0.0";
export const EXIT = Object.freeze({ READY: 0, USAGE: 2, OWNER_STEPS: 10, CHECK_ERRORS: 11 });
export const PROBE_EXIT = Object.freeze({ PRESENT: 0, EXPIRED: 20, MISSING: 21 });
export const RENEW_EXIT = Object.freeze({ RENEWED: 0, NEEDS_OWNER: 30 });
export const KINDS = Object.freeze([
  "secret-store-item",
  "vault-item",
  "stored-session",
  "oauth-grant",
  "oauth-client",
  "browser-session",
  "browser-permission",
  "linked-account",
  "app-session",
  "provider-cli-session",
  "signing-identity",
  "host-permission",
  "device-reachability",
  "local-config",
  "provider-config",
  "owner-approval",
]);
// Kinds whose acquisition is never an agent action.
const OWNER_ONLY_KINDS = new Set(["owner-approval"]);

export const DEFAULT_MANIFEST = ".agentic/test-access.json";
export const DEFAULT_EVIDENCE = ".agentic/runtime/test-access-evidence.json";
export const RUN_RECORD_NAME = "test-access-preflight.json";
const DEFAULT_PROBE_TIMEOUT = 60;
const DEFAULT_RENEW_TIMEOUT = 600;
const DEFAULT_FRESHNESS = 900;
const CLOCK_SKEW_MS = 5000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_DETAIL = 160;
const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Redaction

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/g,
  /\bya29\.[A-Za-z0-9._-]{8,}/g,
  /\b1\/\/[A-Za-z0-9._-]{16,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bGOCSPX-[A-Za-z0-9_-]{8,}/g,
  /\bops_[A-Za-z0-9_-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]*)?/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]+@/gi,
];
const SECRET_ASSIGNMENT =
  /\b((?:[A-Za-z0-9]+[_-])*(?:password|passwd|passphrase|secret|token|api[_-]?key|apikey|cookie|credential|session[_-]?id)(?:[_-][A-Za-z0-9]+)*)(\s*[:=]\s*["']?)([^\s"',;&]{4,})/gi;
const SECRET_QUERY = /([?&](?:token|key|code|secret|signature|sig|password|access_token|refresh_token|id_token)=)[^&\s#]+/gi;
const OPAQUE_RUN = /[A-Za-z0-9+_=-]{20,}/g;
const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const LOWERCASE_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const HASH_LABEL = /(?:sha1|sha256|sha384|sha512|digest):$/i;

// A run of 20+ token characters with both letters and digits is treated as a secret,
// except env var names (UPPER_SNAKE), lowercase ids whose parts are all 12 characters
// or shorter (kebab ids, dated ids, UUIDs), and hashes labelled "sha256:" and similar.
const looksOpaque = (run) => {
  if (!/[0-9]/.test(run) || !/[A-Za-z]/.test(run)) return false;
  if (ENV_NAME.test(run)) return false;
  if (LOWERCASE_ID.test(run) && run.split(/[-_]/).every((part) => part.length <= 12)) return false;
  return true;
};

const redactOpaque = (text) =>
  text.replace(OPAQUE_RUN, (run, offset, whole) =>
    (looksOpaque(run) && !HASH_LABEL.test(whole.slice(Math.max(0, offset - 8), offset)) ? "[redacted]" : run));

export const redact = (value) => {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");
  text = text.replace(SECRET_ASSIGNMENT, (_match, name, separator) => `${name}${separator}[redacted]`);
  text = text.replace(SECRET_QUERY, (_match, prefix) => `${prefix}[redacted]`);
  return redactOpaque(text);
};

export const containsSecretShape = (value) => redact(value) !== String(value ?? "");

// Manifest check. After a secret-named key ("password=", "API_KEY=", "token:"), only a
// reference is allowed: op://…, keychain:…, or an UPPER_CASE env var name. Prose such as
// "token: ask the owner" is not an assignment because whitespace follows the colon.
const MANIFEST_ASSIGNMENT =
  /\b((?:[A-Za-z0-9]+[_-])*(?:password|passwd|passphrase|secret|token|api[_-]?key|apikey|cookie|credential|session[_-]?id)(?:[_-][A-Za-z0-9]+)*)(\s*=\s*["']?|:(?!\s))([^\s"',;&]+)/gi;
export const manifestSecretShape = (value) => {
  let text = String(value ?? "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");
  text = text.replace(SECRET_QUERY, (_match, prefix) => `${prefix}[redacted]`);
  text = redactOpaque(text);
  text = text.replace(MANIFEST_ASSIGNMENT, (match, name, separator, assigned) =>
    (SAFE_REFERENCE.test(assigned.replace(/[.)\]]+$/, "")) ? match : `${name}${separator}[redacted]`));
  return text !== String(value ?? "");
};

const oneLine = (value) => {
  const text = redact(String(value ?? "")).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
};

// ---------------------------------------------------------------------------
// Manifest validation

const fail = (path, message) => {
  throw new UsageError(`manifest ${path}: ${message}`);
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const requireObject = (value, path) => {
  if (!isObject(value)) fail(path, "must be an object");
  return value;
};

const rejectUnknown = (value, allowed, path) => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(path, `has an unknown field "${oneLine(key)}"`);
  }
};

const requireString = (value, path, { max = 400, optional = false } = {}) => {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !value.trim()) fail(path, "must be a non-empty string");
  if (value.length > max) fail(path, `must be at most ${max} characters`);
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) fail(path, "contains control characters");
  return value;
};

const requireId = (value, path) => {
  if (typeof value !== "string" || !ID.test(value)) fail(path, "must be a lowercase id (a-z, 0-9, '.', '_', '-')");
  return value;
};

const requireInteger = (value, path, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(path, `must be an integer from ${min} to ${max}`);
  return value;
};

const requireArray = (value, path, min, max) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    fail(path, `must be an array of ${min} to ${max} items`);
  }
  return value;
};

const SECRET_FLAG = /^--?(?:[a-z0-9]+-)*(?:password|passwd|passphrase|secret|token|api-?key|cookie|credential)(?:-[a-z0-9]+)*$/i;
const SECRET_FLAG_WITH_VALUE = /^--?(?:[a-z0-9]+-)*(?:password|passwd|passphrase|secret|token|api-?key|cookie|credential)(?:-[a-z0-9]+)*=(.+)$/i;
const SAFE_REFERENCE = /^(?:op:\/\/\S+|[A-Z][A-Z0-9_]{1,63}|keychain:\S+)$/;

const validateCommand = (value, path, defaultTimeout) => {
  requireObject(value, path);
  rejectUnknown(value, new Set(["argv", "timeout_seconds"]), path);
  const argv = requireArray(value.argv, `${path}.argv`, 1, 64);
  argv.forEach((part, index) => requireString(part, `${path}.argv[${index}]`, { max: 1024 }));
  argv.forEach((part, index) => {
    const withValue = part.match(SECRET_FLAG_WITH_VALUE);
    if (withValue && !SAFE_REFERENCE.test(withValue[1])) {
      fail(`${path}.argv[${index}]`, "passes a secret-named option inline; pass a reference (op://…, an env var name) instead");
    }
    if (SECRET_FLAG.test(part) && index + 1 < argv.length && !SAFE_REFERENCE.test(argv[index + 1])) {
      fail(`${path}.argv[${index + 1}]`, "follows a secret-named option; pass a reference (op://…, an env var name) instead");
    }
  });
  const timeout = value.timeout_seconds === undefined
    ? defaultTimeout
    : requireInteger(value.timeout_seconds, `${path}.timeout_seconds`, 1, 3600);
  return { argv: [...argv], timeout_seconds: timeout };
};

const scanForSecrets = (value, path) => {
  if (typeof value === "string") {
    if (manifestSecretShape(value)) fail(path, "holds a value that looks like a secret; manifests may name secrets but never contain them");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForSecrets(item, `${path}[${index}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (manifestSecretShape(key)) fail(path, "has a field name that looks like a secret");
      scanForSecrets(item, `${path}.${key}`);
    }
  }
};

const REQUIREMENT_FIELDS = new Set([
  "id", "kind", "summary", "identity", "suites", "depends_on", "probe", "probe_requires_dependencies", "renew",
  "owner_step", "owner_stops", "freshness_seconds", "expiry",
]);

export const validateManifest = (manifest) => {
  requireObject(manifest, "root");
  scanForSecrets(manifest, "root");
  rejectUnknown(manifest, new Set([
    "$schema", "schema_version", "project", "evidence_path", "defaults", "identities", "suites", "requirements",
  ]), "root");
  if (manifest.$schema !== undefined) requireString(manifest.$schema, "$schema");
  if (manifest.schema_version !== "1.0") fail("schema_version", 'must be "1.0"');
  const project = requireId(manifest.project, "project");

  let evidencePath = DEFAULT_EVIDENCE;
  if (manifest.evidence_path !== undefined) {
    evidencePath = requireString(manifest.evidence_path, "evidence_path", { max: 256 });
    if (isAbsolute(evidencePath) || evidencePath.split(/[\\/]/).includes("..")) {
      fail("evidence_path", "must be a relative path inside the project");
    }
  }

  const defaults = { probe_timeout_seconds: DEFAULT_PROBE_TIMEOUT, renew_timeout_seconds: DEFAULT_RENEW_TIMEOUT, freshness_seconds: DEFAULT_FRESHNESS };
  if (manifest.defaults !== undefined) {
    requireObject(manifest.defaults, "defaults");
    rejectUnknown(manifest.defaults, new Set(Object.keys(defaults)), "defaults");
    if (manifest.defaults.probe_timeout_seconds !== undefined) {
      defaults.probe_timeout_seconds = requireInteger(manifest.defaults.probe_timeout_seconds, "defaults.probe_timeout_seconds", 1, 3600);
    }
    if (manifest.defaults.renew_timeout_seconds !== undefined) {
      defaults.renew_timeout_seconds = requireInteger(manifest.defaults.renew_timeout_seconds, "defaults.renew_timeout_seconds", 1, 3600);
    }
    if (manifest.defaults.freshness_seconds !== undefined) {
      defaults.freshness_seconds = requireInteger(manifest.defaults.freshness_seconds, "defaults.freshness_seconds", 0, 30 * 86400);
    }
  }

  const identities = new Map();
  requireArray(manifest.identities ?? [], "identities", 0, 64).forEach((item, index) => {
    const path = `identities[${index}]`;
    requireObject(item, path);
    rejectUnknown(item, new Set(["id", "label"]), path);
    const id = requireId(item.id, `${path}.id`);
    if (identities.has(id)) fail(`${path}.id`, "is a duplicate");
    identities.set(id, requireString(item.label, `${path}.label`, { max: 80 }));
  });

  const suites = new Map();
  requireArray(manifest.suites, "suites", 1, 128).forEach((item, index) => {
    const path = `suites[${index}]`;
    requireObject(item, path);
    rejectUnknown(item, new Set(["id", "summary"]), path);
    const id = requireId(item.id, `${path}.id`);
    if (id === "all") fail(`${path}.id`, 'must not be "all"');
    if (suites.has(id)) fail(`${path}.id`, "is a duplicate");
    suites.set(id, requireString(item.summary, `${path}.summary`, { max: 200 }));
  });

  const requirements = [];
  const byId = new Map();
  requireArray(manifest.requirements, "requirements", 1, 512).forEach((item, index) => {
    const path = `requirements[${index}]`;
    requireObject(item, path);
    rejectUnknown(item, REQUIREMENT_FIELDS, path);
    const id = requireId(item.id, `${path}.id`);
    if (byId.has(id)) fail(`${path}.id`, "is a duplicate");
    if (!KINDS.includes(item.kind)) fail(`${path}.kind`, `must be one of: ${KINDS.join(", ")}`);
    const identity = item.identity === undefined ? null : requireId(item.identity, `${path}.identity`);
    if (identity && !identities.has(identity)) fail(`${path}.identity`, "names an undeclared identity");
    const requirementSuites = requireArray(item.suites, `${path}.suites`, 1, 128).map((suite, suiteIndex) => {
      if (suite === "*") return suite;
      requireId(suite, `${path}.suites[${suiteIndex}]`);
      if (!suites.has(suite)) fail(`${path}.suites[${suiteIndex}]`, "names an undeclared suite");
      return suite;
    });
    const dependsOn = requireArray(item.depends_on ?? [], `${path}.depends_on`, 0, 32).map((dep, depIndex) =>
      requireId(dep, `${path}.depends_on[${depIndex}]`));
    if (new Set(dependsOn).size !== dependsOn.length) fail(`${path}.depends_on`, "has duplicates");
    if (dependsOn.includes(id)) fail(`${path}.depends_on`, "names the requirement itself");
    const probe = validateCommand(item.probe, `${path}.probe`, defaults.probe_timeout_seconds);
    const renew = item.renew === undefined ? null : validateCommand(item.renew, `${path}.renew`, defaults.renew_timeout_seconds);
    if (renew && OWNER_ONLY_KINDS.has(item.kind)) fail(`${path}.renew`, `is not allowed for kind ${item.kind}; only the owner acquires it`);
    const ownerStep = item.owner_step === undefined ? null : requireString(item.owner_step, `${path}.owner_step`, { max: 400 });
    if (!renew && !ownerStep) fail(path, "needs a renew command, an owner_step, or both");
    const ownerStops = new Map();
    if (item.owner_stops !== undefined) {
      if (!renew) fail(`${path}.owner_stops`, "applies only to requirements with a renew command");
      requireObject(item.owner_stops, `${path}.owner_stops`);
      for (const [stop, text] of Object.entries(item.owner_stops)) {
        requireId(stop, `${path}.owner_stops`);
        ownerStops.set(stop, requireString(text, `${path}.owner_stops.${stop}`, { max: 400 }));
      }
    }
    if (item.probe_requires_dependencies !== undefined && typeof item.probe_requires_dependencies !== "boolean") {
      fail(`${path}.probe_requires_dependencies`, "must be a boolean");
    }
    const freshness = item.freshness_seconds === undefined
      ? defaults.freshness_seconds
      : requireInteger(item.freshness_seconds, `${path}.freshness_seconds`, 0, 30 * 86400);
    const expiry = item.expiry === undefined ? null : requireString(item.expiry, `${path}.expiry`, { max: 200 });
    const requirement = {
      index,
      id,
      kind: item.kind,
      summary: requireString(item.summary, `${path}.summary`, { max: 200 }),
      identity,
      suites: requirementSuites,
      depends_on: dependsOn,
      probe,
      probe_requires_dependencies: item.probe_requires_dependencies === true,
      renew,
      owner_step: ownerStep,
      owner_stops: ownerStops,
      freshness_seconds: freshness,
      expiry,
    };
    requirement.digest = definitionDigest(requirement);
    requirements.push(requirement);
    byId.set(id, requirement);
  });
  for (const requirement of requirements) {
    for (const dep of requirement.depends_on) {
      if (!byId.has(dep)) fail(`requirements[${requirement.index}].depends_on`, `names an unknown requirement "${dep}"`);
    }
  }
  orderRequirements(requirements, byId);
  return { project, evidencePath, identities, suites, requirements, byId };
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const definitionDigest = (requirement) =>
  `sha256:${createHash("sha256").update(canonicalJson({
    kind: requirement.kind,
    identity: requirement.identity,
    probe: requirement.probe.argv,
    depends_on: requirement.probe_requires_dependencies ? requirement.depends_on : [],
  })).digest("hex")}`;

// Topological order with manifest order as the tie-break. Throws on cycles.
export const orderRequirements = (requirements, byId) => {
  const ordered = [];
  const state = new Map();
  const visit = (requirement, trail) => {
    const mark = state.get(requirement.id);
    if (mark === "done") return;
    if (mark === "active") {
      throw new UsageError(`manifest requirements: dependency cycle ${[...trail, requirement.id].join(" -> ")}`);
    }
    state.set(requirement.id, "active");
    for (const dep of requirement.depends_on) visit(byId.get(dep), [...trail, requirement.id]);
    state.set(requirement.id, "done");
    ordered.push(requirement);
  };
  for (const requirement of [...requirements].sort((a, b) => a.index - b.index)) visit(requirement, []);
  return ordered;
};

export const selectRequirements = (model, suiteArg) => {
  const requested = suiteArg === "all"
    ? [...model.suites.keys()]
    : suiteArg.split(",").map((suite) => suite.trim()).filter(Boolean);
  if (requested.length === 0) throw new UsageError("--suite needs at least one suite id or \"all\"");
  for (const suite of requested) {
    if (!model.suites.has(suite)) {
      throw new UsageError(`unknown suite "${oneLine(suite)}"; declared suites: ${[...model.suites.keys()].join(", ")}`);
    }
  }
  const wanted = new Set();
  const add = (requirement) => {
    if (wanted.has(requirement.id)) return;
    wanted.add(requirement.id);
    for (const dep of requirement.depends_on) add(model.byId.get(dep));
  };
  for (const requirement of model.requirements) {
    if (requirement.suites.includes("*") || requirement.suites.some((suite) => requested.includes(suite))) add(requirement);
  }
  const ordered = orderRequirements(model.requirements, model.byId).filter((requirement) => wanted.has(requirement.id));
  return { suites: requested, ordered };
};

// ---------------------------------------------------------------------------
// Evidence (host-local, untracked)

const parseTime = (value) => {
  if (typeof value !== "string" || !RFC3339.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
};

const loadEvidence = (path, project) => {
  if (!existsSync(path)) return { entries: {}, warning: null };
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) return { entries: {}, warning: "evidence path is not a regular file; ignoring it" };
    if (stat.size > MAX_MANIFEST_BYTES) return { entries: {}, warning: "evidence file is too large; ignoring it" };
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(data) || data.schema_version !== "1.0" || data.project !== project || !isObject(data.requirements)) {
      return { entries: {}, warning: "evidence file has another schema or project; ignoring it" };
    }
    return { entries: data.requirements, warning: null };
  } catch {
    return { entries: {}, warning: "evidence file is unreadable; ignoring it" };
  }
};

const reusable = (entry, requirement, now) => {
  if (!isObject(entry) || entry.observed !== "present" || entry.definition_digest !== requirement.digest) return false;
  if (requirement.freshness_seconds === 0) return false;
  const checked = parseTime(entry.checked_at);
  if (checked === null || checked > now + CLOCK_SKEW_MS) return false;
  if (checked + requirement.freshness_seconds * 1000 <= now) return false;
  if (entry.expires_at !== null && entry.expires_at !== undefined) {
    const expires = parseTime(entry.expires_at);
    if (expires === null || expires <= now) return false;
  }
  return true;
};

const git = (root, args) => spawnSync("git", ["-C", root, ...args], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  timeout: 10000,
  env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
});

// Returns null when storage is safe, else a plain-language problem.
export const evidenceStorageProblem = (root, relativePath) => {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== "true") return null;
  const ignored = git(root, ["check-ignore", "-q", "--no-index", "--", relativePath]);
  if (ignored.status !== 0) {
    return `${relativePath} is not git-ignored; add its directory (for example ".agentic/runtime/") to .gitignore`;
  }
  const tracked = git(root, ["ls-files", "--error-unmatch", "--", relativePath]);
  if (tracked.status === 0) return `${relativePath} is tracked by git; untrack it with "git rm --cached"`;
  return null;
};

const atomicWriteJson = (path, data) => {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && !lstatSync(path).isFile()) throw new UsageError(`${path} is not a regular file`);
  const temp = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* already gone */ }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Probes and renewals

const parseReport = (stdout) => {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last || !last.startsWith("{")) return {};
  try {
    const data = JSON.parse(last);
    if (!isObject(data)) return {};
    const report = {};
    if (typeof data.detail === "string") report.detail = oneLine(data.detail);
    if (typeof data.expires_at === "string" && parseTime(data.expires_at) !== null) report.expires_at = data.expires_at;
    if (typeof data.stop === "string" && ID.test(data.stop)) report.stop = data.stop;
    return report;
  } catch {
    return {};
  }
};

const lastLine = (text) => {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? oneLine(lines[lines.length - 1]) : "";
};

const runCommand = (command, { root, mode, requirement, runDir }) => {
  const result = spawnSync(command.argv[0], command.argv.slice(1), {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: command.timeout_seconds * 1000,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT_BYTES,
    env: {
      ...process.env,
      TEST_ACCESS_MODE: mode,
      TEST_ACCESS_REQUIREMENT: requirement.id,
      TEST_ACCESS_KIND: requirement.kind,
      TEST_ACCESS_IDENTITY: requirement.identity || "",
      TEST_ACCESS_RUN_DIR: runDir || "",
    },
  });
  const report = parseReport(result.stdout || "");
  if (result.error) {
    const reason = result.error.code === "ETIMEDOUT"
      ? `timed out after ${command.timeout_seconds}s`
      : `could not run (${oneLine(result.error.code || "spawn error")})`;
    return { code: null, report, failure: reason };
  }
  if (result.status === null) return { code: null, report, failure: `stopped by ${result.signal}` };
  return { code: result.status, report, stderr: lastLine(result.stderr) };
};

const probe = (requirement, context) => {
  const result = runCommand(requirement.probe, { ...context, mode: "probe", requirement });
  const checkedAt = new Date(context.now).toISOString();
  if (result.failure) return { observed: "error", detail: `probe ${result.failure}`, checked_at: checkedAt, expires_at: null };
  let observed;
  if (result.code === PROBE_EXIT.PRESENT) observed = "present";
  else if (result.code === PROBE_EXIT.EXPIRED) observed = "expired";
  else if (result.code === PROBE_EXIT.MISSING) observed = "missing";
  else {
    const tail = result.report.detail || result.stderr;
    return { observed: "error", detail: `probe exited ${result.code}${tail ? `: ${tail}` : ""}`, checked_at: checkedAt, expires_at: null };
  }
  const expiresAt = result.report.expires_at || null;
  if (observed === "present" && expiresAt && parseTime(expiresAt) <= context.now) observed = "expired";
  return { observed, detail: result.report.detail || "", checked_at: checkedAt, expires_at: expiresAt };
};

// ---------------------------------------------------------------------------
// Evaluation

const READY = "ready";
const NEEDS_OWNER = "needs_owner";
const WAITING = "waiting";
const ERROR = "error";

export const evaluate = ({ model, selection, root, runDir, now, recheckAll, evidence, dryRun }) => {
  const results = new Map();
  for (const requirement of selection.ordered) {
    const result = {
      id: requirement.id,
      kind: requirement.kind,
      identity: requirement.identity,
      state: null,
      observed: "not_checked",
      source: null,
      checked_at: null,
      expires_at: null,
      detail: "",
      waiting_on: [],
      owner_step: null,
      after_steps: [],
      renewal: requirement.renew ? "agent" : "none",
    };
    results.set(requirement.id, result);
    const notReady = requirement.depends_on.filter((dep) => results.get(dep).state !== READY);
    result.waiting_on = notReady;

    const entry = evidence[requirement.id];
    if (!recheckAll && reusable(entry, requirement, now)) {
      Object.assign(result, {
        state: READY,
        observed: "present",
        source: "reused",
        checked_at: entry.checked_at,
        expires_at: entry.expires_at ?? null,
        waiting_on: [],
      });
      continue;
    }
    if (dryRun) {
      result.state = "unchecked";
      result.source = "would_probe";
      continue;
    }

    const context = { root, runDir, now };
    if (!(requirement.probe_requires_dependencies && notReady.length)) {
      Object.assign(result, probe(requirement, context), { source: "probed" });
    }
    if (result.observed === "present") {
      result.state = READY;
      result.waiting_on = [];
      continue;
    }
    if (result.observed === "error") {
      result.state = ERROR;
      continue;
    }
    if (notReady.length) {
      if (requirement.renew) {
        result.state = WAITING;
      } else {
        result.state = NEEDS_OWNER;
        result.owner_step = requirement.owner_step;
      }
      continue;
    }
    if (!requirement.renew) {
      result.state = NEEDS_OWNER;
      result.owner_step = requirement.owner_step;
      continue;
    }

    const renewal = runCommand(requirement.renew, { ...context, mode: "renew", requirement });
    if (renewal.failure || (renewal.code !== RENEW_EXIT.RENEWED && renewal.code !== RENEW_EXIT.NEEDS_OWNER)) {
      const tail = renewal.report.detail || renewal.stderr;
      result.state = ERROR;
      result.detail = renewal.failure
        ? `renewal ${renewal.failure}`
        : `renewal exited ${renewal.code}${tail ? `: ${tail}` : ""}`;
      continue;
    }
    if (renewal.code === RENEW_EXIT.NEEDS_OWNER) {
      const stop = renewal.report.stop;
      const text = (stop && requirement.owner_stops.get(stop)) || requirement.owner_step;
      if (!text) {
        result.state = ERROR;
        result.detail = `renewal stopped${stop ? ` (${stop})` : ""} and the manifest names no owner step`;
        continue;
      }
      result.state = NEEDS_OWNER;
      result.owner_step = text;
      result.detail = stop ? `renewal stopped: ${stop}` : renewal.report.detail || "renewal needs the owner";
      continue;
    }
    const recheck = probe(requirement, context);
    Object.assign(result, recheck);
    if (recheck.observed === "present") {
      result.state = READY;
      result.source = "renewed";
      result.waiting_on = [];
      continue;
    }
    if (recheck.observed === "error") {
      result.state = ERROR;
      continue;
    }
    if (requirement.owner_step) {
      result.state = NEEDS_OWNER;
      result.owner_step = requirement.owner_step;
      result.detail = `renewal finished but the probe still reports ${recheck.observed}`;
    } else {
      result.state = ERROR;
      result.detail = `renewal finished but the probe still reports ${recheck.observed}`;
    }
  }
  return results;
};

// Number owner steps in dependency order and link each blocked item to the steps it waits on.
export const buildOwnerList = ({ model, selection, results }) => {
  const steps = [];
  const numberOf = new Map();
  const blockers = new Map();
  for (const requirement of selection.ordered) {
    const result = results.get(requirement.id);
    const before = new Set();
    for (const dep of result.waiting_on) {
      if (numberOf.has(dep)) before.add(numberOf.get(dep));
      for (const step of blockers.get(dep) || []) before.add(step);
    }
    const sorted = [...before].sort((a, b) => a - b);
    blockers.set(requirement.id, sorted);
    result.after_steps = sorted;
    if (result.state === NEEDS_OWNER) {
      const number = steps.length + 1;
      numberOf.set(requirement.id, number);
      steps.push({
        number,
        requirement: requirement.id,
        identity: requirement.identity,
        identity_label: requirement.identity ? model.identities.get(requirement.identity) : null,
        text: result.owner_step,
        after: sorted,
      });
    }
  }
  return steps;
};

const outcomeFor = (results) => {
  const states = [...results.values()].map((result) => result.state);
  if (states.includes(ERROR)) return { outcome: "check_errors", exitCode: EXIT.CHECK_ERRORS };
  if (states.includes(NEEDS_OWNER) || states.includes(WAITING)) return { outcome: "owner_steps_needed", exitCode: EXIT.OWNER_STEPS };
  return { outcome: "ready", exitCode: EXIT.READY };
};

// ---------------------------------------------------------------------------
// Output

const ownerLine = (step) => {
  const who = step.identity_label ? ` (${step.identity_label})` : "";
  const after = step.after.length ? ` Do this after step${step.after.length > 1 ? "s" : ""} ${step.after.join(", ")}.` : "";
  return `${step.number}. ${step.text}${who}${after}`;
};

const describeResult = (result) => {
  const parts = [];
  if (result.source === "reused") parts.push(`reused result from ${result.checked_at}`);
  else if (result.source === "renewed") parts.push("renewed by agent");
  else if (result.observed !== "not_checked") parts.push(result.observed);
  if (result.state === WAITING) parts.push(`agent renews it on rerun after ${result.waiting_on.join(", ")}`);
  if (result.state === NEEDS_OWNER && result.waiting_on.length && result.observed === "not_checked") {
    parts.push(`not checked until ${result.waiting_on.join(", ")} is ready`);
  }
  if (result.detail) parts.push(result.detail);
  return parts.join("; ");
};

const renderText = (record) => {
  const lines = [];
  const counts = record.counts;
  lines.push(`Test access preflight: ${record.project}, suite${record.suites.length > 1 ? "s" : ""} ${record.suites.join(", ")}`);
  if (record.mode === "dry_run") {
    lines.push("Dry run: no probe or renewal ran and nothing was written.");
    lines.push("");
    record.requirements.forEach((result, index) => {
      const plan = result.source === "reused" ? "reuse fresh result" : "probe";
      const renew = result.renewal === "agent" ? "agent renewal" : "no agent renewal";
      const deps = result.depends_on.length ? `; after ${result.depends_on.join(", ")}` : "";
      lines.push(`${index + 1}. ${result.id} [${result.kind}${result.identity ? `, ${result.identity}` : ""}]: ${plan}; ${renew}${deps}`);
    });
    lines.push("");
    if (record.possible_owner_steps.length) {
      lines.push("Owner steps this run could ask for, if probes and renewals cannot finish:");
      for (const step of record.possible_owner_steps) {
        lines.push(ownerLine(step));
        for (const alternative of step.alternatives) lines.push(`   If renewal stops for another reason: ${alternative}`);
      }
    } else {
      lines.push("No owner step is possible for this selection.");
    }
    return lines.join("\n");
  }
  lines.push(`Ready ${counts.ready}, renewed by agent ${counts.renewed}, owner steps ${record.owner_steps.length}, waiting ${counts.waiting}, errors ${counts.error}.`);
  lines.push("");
  for (const result of record.requirements) {
    const label = { ready: "ready  ", needs_owner: "owner  ", waiting: "waiting", error: "ERROR  " }[result.state] || result.state;
    const description = describeResult(result);
    lines.push(`  ${label} ${result.id}${description ? `: ${description}` : ""}`);
  }
  for (const warning of record.warnings) lines.push(`  note: ${warning}`);
  lines.push("");
  if (record.outcome === "ready") {
    lines.push("All test access is ready.");
  } else {
    if (record.owner_steps.length) {
      lines.push("Owner steps. Please do these, then tell the agent to rerun the preflight:");
      for (const step of record.owner_steps) lines.push(ownerLine(step));
      lines.push("");
    }
    if (record.outcome === "check_errors") {
      lines.push("Some checks failed to run. An agent must fix the listed errors; they are not owner steps.");
    }
    lines.push(`Rerun: ${record.rerun_command}`);
  }
  return lines.join("\n");
};

const summarize = (results) => {
  const counts = { ready: 0, renewed: 0, needs_owner: 0, waiting: 0, error: 0 };
  for (const result of results.values()) {
    if (result.state in counts) counts[result.state] += 1;
    if (result.source === "renewed") counts.renewed += 1;
  }
  return counts;
};

const publicResult = (result, requirement) => ({
  id: result.id,
  kind: result.kind,
  identity: result.identity,
  depends_on: requirement.depends_on,
  state: result.state,
  observed: result.observed,
  source: result.source,
  renewal: result.renewal,
  checked_at: result.checked_at,
  expires_at: result.expires_at,
  waiting_on: result.waiting_on,
  after_steps: result.after_steps,
  detail: oneLine(result.detail),
});

// ---------------------------------------------------------------------------
// CLI

const usage = `Usage:
  node test-access-preflight.mjs --suite <id[,id…]|all> [options]

Options:
  --manifest <path>    Manifest path, relative to the project root (default ${DEFAULT_MANIFEST}).
  --project-root <dir> Project root (default: current directory).
  --run-dir <dir>      Write a status-only record (${RUN_RECORD_NAME}) to this run folder.
  --dry-run            Validate and print the ordered plan and possible owner steps. Runs nothing.
  --recheck-all        Probe every requirement, ignoring reusable host-local results.
  --if-present         Exit 0 with "not_configured" when the default manifest is absent.
  --json               Print the record as JSON instead of text.
  --now <RFC3339>      Evaluate as of this time (tests only).

Exit codes: 0 ready; 10 owner steps needed; 11 a probe or renewal failed to run; 2 usage or manifest error.
Probe exit codes: 0 present; 20 expired; 21 missing; anything else is an error.
Renew exit codes: 0 renewed (the engine probes again); 30 needs the owner; anything else is an error.`;

export const parseArgs = (argv) => {
  const options = { manifest: null, projectRoot: process.cwd(), runDir: null, suite: null, dryRun: false, recheckAll: false, ifPresent: false, json: false, now: null, help: false };
  const takeValue = (index, flag) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--recheck-all") options.recheckAll = true;
    else if (arg === "--if-present") options.ifPresent = true;
    else if (arg === "--json") options.json = true;
    else if (["--suite", "--manifest", "--project-root", "--run-dir", "--now"].includes(arg)) {
      const value = takeValue(index, arg);
      index += 1;
      if (arg === "--suite") options.suite = value;
      if (arg === "--manifest") options.manifest = value;
      if (arg === "--project-root") options.projectRoot = value;
      if (arg === "--run-dir") options.runDir = value;
      if (arg === "--now") {
        if (parseTime(value) === null) throw new UsageError("--now must be an RFC3339 time");
        options.now = value;
      }
    } else {
      throw new UsageError(`unknown argument "${oneLine(arg)}"`);
    }
  }
  if (!options.help && !options.suite) throw new UsageError("--suite is required (a suite id, a comma list, or \"all\")");
  return options;
};

const shellQuote = (value) => (/^[A-Za-z0-9_./:=@,+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`);

const rerunCommand = (options, root) => {
  const script = process.argv[1] ? resolve(process.argv[1]) : "test-access-preflight.mjs";
  const rel = relative(root, script);
  const shown = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : script;
  const parts = ["node", shown, "--suite", options.suite];
  if (options.manifest) parts.push("--manifest", options.manifest);
  if (options.runDir) parts.push("--run-dir", options.runDir);
  return parts.map(shellQuote).join(" ");
};

const loadManifest = (path) => {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile()) throw new UsageError("manifest path is not a regular file");
  if (stat.size > MAX_MANIFEST_BYTES) throw new UsageError("manifest is larger than 1 MiB");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new UsageError("manifest is not valid JSON");
  }
};

export const run = (argv, { stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text) } = {}) => {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    stderr(`test-access-preflight: ${redact(error.message)}\n${usage}\n`);
    return EXIT.USAGE;
  }
  if (options.help) {
    stdout(`${usage}\n`);
    return EXIT.READY;
  }
  try {
    const root = resolve(options.projectRoot);
    const manifestRel = options.manifest || DEFAULT_MANIFEST;
    const manifestPath = isAbsolute(manifestRel) ? manifestRel : join(root, manifestRel);
    const raw = loadManifest(manifestPath);
    if (raw === null) {
      if (options.ifPresent && !options.manifest) {
        const record = { schema_version: "1.0", tool_version: TOOL_VERSION, outcome: "not_configured", exit_code: EXIT.READY };
        stdout(options.json ? `${JSON.stringify(record, null, 2)}\n` : `No test-access manifest at ${DEFAULT_MANIFEST}; nothing to check.\n`);
        return EXIT.READY;
      }
      throw new UsageError(`no manifest at ${manifestRel}`);
    }
    const model = validateManifest(raw);
    const selection = selectRequirements(model, options.suite);
    const now = options.now ? parseTime(options.now) : Date.now();
    const evidencePath = join(root, model.evidencePath);
    const warnings = [];
    const evidence = loadEvidence(evidencePath, model.project);
    if (evidence.warning) warnings.push(evidence.warning);
    const storageProblem = evidenceStorageProblem(root, model.evidencePath);
    if (storageProblem && !options.dryRun) throw new UsageError(`evidence storage: ${storageProblem}`);
    if (storageProblem) warnings.push(storageProblem);
    const runDir = options.runDir ? resolve(root, options.runDir) : null;

    const results = evaluate({
      model,
      selection,
      root,
      runDir,
      now,
      recheckAll: options.recheckAll,
      evidence: evidence.entries,
      dryRun: options.dryRun,
    });

    const base = {
      schema_version: "1.0",
      tool_version: TOOL_VERSION,
      project: model.project,
      suites: selection.suites,
      generated_at: new Date(now).toISOString(),
    };

    if (options.dryRun) {
      const possible = [];
      const numberOf = new Map();
      const before = new Map();
      for (const requirement of selection.ordered) {
        const result = results.get(requirement.id);
        const after = new Set();
        for (const dep of requirement.depends_on) {
          if (numberOf.has(dep)) after.add(numberOf.get(dep));
          for (const step of before.get(dep) || []) after.add(step);
        }
        before.set(requirement.id, [...after].sort((a, b) => a - b));
        if (result.source === "reused") continue;
        const stops = [...requirement.owner_stops.values()];
        const text = requirement.owner_step || stops[0];
        if (!text) continue;
        numberOf.set(requirement.id, possible.length + 1);
        possible.push({
          number: possible.length + 1,
          requirement: requirement.id,
          identity: requirement.identity,
          identity_label: requirement.identity ? model.identities.get(requirement.identity) : null,
          text,
          alternatives: stops.filter((stop) => stop !== text),
          after: before.get(requirement.id),
        });
      }
      const record = {
        ...base,
        mode: "dry_run",
        outcome: "dry_run",
        exit_code: EXIT.READY,
        requirements: selection.ordered.map((requirement) => publicResult(results.get(requirement.id), requirement)),
        possible_owner_steps: possible,
        warnings: warnings.map(oneLine),
      };
      stdout(options.json ? `${JSON.stringify(record, null, 2)}\n` : `${renderText(record)}\n`);
      return EXIT.READY;
    }

    const ownerSteps = buildOwnerList({ model, selection, results });
    const { outcome, exitCode } = outcomeFor(results);
    const record = {
      ...base,
      mode: "run",
      outcome,
      exit_code: exitCode,
      counts: summarize(results),
      requirements: selection.ordered.map((requirement) => publicResult(results.get(requirement.id), requirement)),
      owner_steps: ownerSteps,
      rerun_command: rerunCommand(options, root),
      warnings: warnings.map(oneLine),
    };

    const nextEvidence = { ...evidence.entries };
    for (const requirement of model.requirements) {
      if (!nextEvidence[requirement.id]) continue;
      if (nextEvidence[requirement.id].definition_digest !== requirement.digest) delete nextEvidence[requirement.id];
    }
    for (const requirement of selection.ordered) {
      const result = results.get(requirement.id);
      if (result.source === "reused" || result.observed === "not_checked") continue;
      nextEvidence[requirement.id] = {
        observed: result.observed,
        checked_at: result.checked_at,
        expires_at: result.expires_at,
        definition_digest: requirement.digest,
      };
    }
    for (const id of Object.keys(nextEvidence)) if (!model.byId.has(id)) delete nextEvidence[id];
    atomicWriteJson(evidencePath, {
      schema_version: "1.0",
      tool_version: TOOL_VERSION,
      project: model.project,
      updated_at: new Date(now).toISOString(),
      requirements: nextEvidence,
    });
    if (runDir) atomicWriteJson(join(runDir, RUN_RECORD_NAME), record);

    stdout(options.json ? `${JSON.stringify(record, null, 2)}\n` : `${renderText(record)}\n`);
    return exitCode;
  } catch (error) {
    const message = error instanceof UsageError ? error.message : `engine error: ${error && error.message}`;
    stderr(`test-access-preflight: ${redact(message)}\n`);
    return EXIT.USAGE;
  }
};

const invokedDirectly = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedDirectly) process.exitCode = run(process.argv.slice(2));
