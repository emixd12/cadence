import { open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { PINNED_IMAGES } from "./supabase-docker-proxy.mjs";

export const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
export const REHEARSAL_REGISTRY = "public.ecr.aws";
export const REHEARSAL_IMAGES = Object.freeze(PINNED_IMAGES.filter((image) => image.startsWith(`${REHEARSAL_REGISTRY}/`)));
const REGISTRIES = ["ghcr.io", "public.ecr.aws"];
const HTTP_STATUSES = [400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504];
const SIGNAL_PRIORITY = [
  "migration_or_seed", "registry_auth", "image_manifest", "nonretryable_pull", "registry_rate_limit",
  "image_pull", "service_health", "network_interruption", "timeout", "docker_transport", "proxy_rejection",
];
const PULL_RETRY_DELAYS = [10, 20, 40];

// Return only fixed vocabulary and public image pins, never matched text. The
// signals are observations, not proof that the first one caused the failure.
export function classifyRehearsalOutput(output, exitCode, phase, truncated = false) {
  if (!["pull", "start"].includes(phase) || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new Error("Invalid diagnostic input.");
  const bytes = Buffer.from(output);
  const text = stripVTControlCharacters(bytes.subarray(-MAX_DIAGNOSTIC_BYTES).toString("utf8"));
  const signals = new Set();
  const statuses = new Set();
  for (const line of text.split(/[\r\n]+/)) {
    const codes = HTTP_STATUSES.filter((code) => new RegExp(`\\b(?:http(?:/\\d(?:\\.\\d)?)?(?: status)?|status(?: code)?)\\s*[:=]?\\s*${code}\\b`, "i").test(line));
    if (/:\s*429\s+Too Many Requests\b/i.test(line)) codes.push(429);
    if (/:\s*403\s+Forbidden\b/i.test(line)) codes.push(403);
    if (/:\s*404\s+Not Found\b/i.test(line)) codes.push(404);
    for (const code of codes) statuses.add(code);
    const pullError = /failed to pull|pull access denied|manifest (?:unknown|not found)|no matching manifest|failed to resolve (?:reference|source metadata)|failed to fetch (?:oauth|anonymous) token/i.test(line)
      || (/error|failed/i.test(line) && REGISTRIES.some((registry) => line.includes(registry)));
    const pullContext = phase === "pull" || pullError;
    if (/\bSQLSTATE\b|failed to apply migration|failed to seed|error seeding/i.test(line)) signals.add("migration_or_seed");
    if (pullContext && (/\btoomanyrequests\b/i.test(line) || codes.includes(429))) signals.add("registry_rate_limit");
    if (pullContext && (/\bunauthorized\b|authentication required|pull access denied|\bdenied\b/i.test(line) || codes.some((code) => code === 401 || code === 403))) signals.add("registry_auth");
    if (pullContext && /manifest (?:unknown|not found)|no matching manifest/i.test(line)) signals.add("image_manifest");
    if (pullContext && /no space left on device|read-only file system|unsupported media type|digest mismatch|filesystem layer verification failed|x509:|certificate verification failed|no such host|invalid reference format/i.test(line)) signals.add("nonretryable_pull");
    if (pullError) signals.add("image_pull");
    if (/\bis not ready\b|\bunhealthy\b/i.test(line)) signals.add("service_health");
    if (/deadline exceeded|timed out|i\/o timeout/i.test(line)) signals.add("timeout");
    if (/unexpected EOF|connection reset by peer|i\/o timeout|TLS handshake timeout/i.test(line)) signals.add("network_interruption");
    if (/Local Docker request failed\.|unexpected EOF|connection reset by peer/i.test(line)) signals.add("docker_transport");
    if (/Cadence Docker request rejected\./.test(line)) signals.add("proxy_rejection");
  }
  const observed = SIGNAL_PRIORITY.filter((signal) => signals.has(signal));
  return {
    category: exitCode === 124 ? "time_limit" : observed[0] ?? "unclassified",
    signals: observed,
    registries: REGISTRIES.filter((registry) => text.includes(registry)),
    images: PINNED_IMAGES.filter((image) => text.includes(image)),
    http_statuses: HTTP_STATUSES.filter((code) => statuses.has(code)),
    tail_truncated: truncated || bytes.length > MAX_DIAGNOSTIC_BYTES,
  };
}

// Retry only observed throttling or specific interrupted/timed-out connections.
// Auth, manifest, policy, disk/TLS configuration and unknown failures stop. The
// Docker daemon has its own layer retries; this bounds the outer pull attempts.
export function pullRetryDelay(diagnostics, exitCode, attempt, remainingSeconds) {
  if (exitCode !== 1 || diagnostics.tail_truncated || !Number.isInteger(attempt)
    || attempt < 1 || attempt > PULL_RETRY_DELAYS.length || !Number.isInteger(remainingSeconds)) return 0;
  const delay = PULL_RETRY_DELAYS[attempt - 1];
  if (remainingSeconds <= delay || diagnostics.http_statuses.some((code) => code !== 429)) return 0;
  const signals = diagnostics.signals;
  if (signals.some((signal) => ["migration_or_seed", "registry_auth", "image_manifest", "nonretryable_pull", "service_health", "proxy_rejection"].includes(signal))) return 0;
  return signals.includes("registry_rate_limit") || signals.includes("network_interruption") ? delay : 0;
}

export async function readRehearsalDiagnostics(path, exitCode, phase) {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("Invalid diagnostic file.");
    const length = Math.min(stat.size, MAX_DIAGNOSTIC_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, stat.size - length);
    return classifyRehearsalOutput(buffer.subarray(0, bytesRead), exitCode, phase, stat.size > length);
  } finally {
    await file.close();
  }
}

// Database-backed tests the rehearsal runs (scripts/supabase-rehearsal-integration-tests.json).
export const INTEGRATION_TESTS_PATH = fileURLToPath(new URL("./supabase-rehearsal-integration-tests.json", import.meta.url));
const INTEGRATION_FILE = /^tests\/[a-z0-9-]+\.local-integration\.test\.(?:ts|mjs)$/;
const INTEGRATION_NEEDS = new Set(["url-keys", "signing-key", "database"]);

/** Validate the allowlist shape. Every listed path appears once, in run or excluded. */
export function parseIntegrationAllowlist(value) {
  const fail = (message) => { throw new Error(`${message} Fix scripts/supabase-rehearsal-integration-tests.json.`); };
  if (!value || typeof value !== "object" || !Array.isArray(value.run) || value.run.length === 0) fail("The allowlist needs a non-empty run array.");
  if (!value.excluded || typeof value.excluded !== "object" || Array.isArray(value.excluded)) fail("The allowlist needs an excluded object.");
  const seen = new Set();
  const run = value.run.map((entry) => {
    const file = entry?.file;
    if (typeof file !== "string" || !INTEGRATION_FILE.test(file)) fail(`Run entry ${JSON.stringify(file)} is not a tests/*.local-integration.test.* path.`);
    const needs = typeof entry.needs === "string" ? entry.needs.split(",") : [];
    if (needs.length === 0 || !needs.every((need) => INTEGRATION_NEEDS.has(need))) fail(`Run entry ${file} needs one or more of ${[...INTEGRATION_NEEDS].join(", ")}.`);
    if (seen.has(file)) fail(`${file} is listed twice.`);
    seen.add(file);
    return file;
  });
  for (const [file, reason] of Object.entries(value.excluded)) {
    if (!INTEGRATION_FILE.test(file)) fail(`Excluded entry ${JSON.stringify(file)} is not a tests/*.local-integration.test.* path.`);
    if (typeof reason !== "string" || reason.trim().length < 10) fail(`Excluded entry ${file} needs a reason.`);
    if (seen.has(file)) fail(`${file} is listed twice.`);
    seen.add(file);
  }
  return { run, excluded: Object.keys(value.excluded) };
}

/**
 * Check a vitest JSON report. Each allowlisted file must have run at least one
 * test, skipped none and failed none: a file whose environment check silently
 * skipped would otherwise pass. Messages carry file names and counts only.
 */
export function checkIntegrationReport(report, files, root) {
  const results = new Map((Array.isArray(report?.testResults) ? report.testResults : []).map((result) => [result?.name, result]));
  const problems = [];
  const summary = [];
  for (const file of files) {
    const result = results.get(resolve(root, file));
    if (!result) { problems.push(`${file}: missing from the vitest report; check that the file exists and loads.`); continue; }
    const counts = { passed: 0, failed: 0, skipped: 0 };
    for (const assertion of Array.isArray(result.assertionResults) ? result.assertionResults : []) {
      const status = assertion?.status;
      if (status === "passed") counts.passed += 1;
      else if (status === "failed") counts.failed += 1;
      else counts.skipped += 1;
    }
    summary.push(`${file}: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`);
    if (counts.failed > 0 || result.status === "failed") problems.push(`${file}: ${counts.failed} failed test(s); read the vitest output above.`);
    if (counts.passed === 0) problems.push(`${file}: ran zero tests; its environment check probably skipped. Export the variables it reads or move it to excluded with a reason.`);
    if (counts.skipped > 0) problems.push(`${file}: skipped ${counts.skipped} test(s); a skipped test proves nothing. Export the variables it reads or move it to excluded with a reason.`);
  }
  return { problems, summary };
}

const loopbackUrl = (value, protocols) => {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && url.hostname === "127.0.0.1" && /^\d+$/.test(url.port) ? url : null;
  } catch { return null; }
};

/**
 * Map `supabase status -o env` output and the generated signing key file to the
 * variables the allowlisted tests read. Errors name variables, never values.
 */
export function integrationEnvironment(statusText, signingKeysText) {
  const values = {};
  for (const line of String(statusText).split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let raw = match[2].trim();
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { raw = JSON.parse(raw); } catch { raw = raw.slice(1, -1); }
    }
    values[match[1]] = raw;
  }
  for (const name of ["API_URL", "DB_URL", "PUBLISHABLE_KEY", "SERVICE_ROLE_KEY"]) {
    if (!values[name]) throw new Error(`Local Supabase status omitted ${name}.`);
  }
  if (!loopbackUrl(values.API_URL, ["http:"])) throw new Error("Local Supabase status API_URL is not a 127.0.0.1 HTTP URL.");
  const database = loopbackUrl(values.DB_URL, ["postgresql:", "postgres:"]);
  if (!database) throw new Error("Local Supabase status DB_URL is not a 127.0.0.1 Postgres URL.");
  let keys;
  try { keys = JSON.parse(signingKeysText); } catch { throw new Error("The rehearsal signing key file is not JSON."); }
  const key = Array.isArray(keys) && keys.length === 1 ? keys[0] : null;
  if (!key || key.kty !== "EC" || key.crv !== "P-256" || key.alg !== "ES256" || typeof key.d !== "string" || typeof key.kid !== "string") {
    throw new Error("The rehearsal signing key file must hold exactly one private ES256 JWK.");
  }
  const environment = {
    CADENCE_LOCAL_SUPABASE_URL: values.API_URL,
    CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY,
    CADENCE_LOCAL_SUPABASE_SERVICE_KEY: values.SERVICE_ROLE_KEY,
    CADENCE_LOCAL_SUPABASE_DB_URL: values.DB_URL,
    CADENCE_LOCAL_SUPABASE_DB_PORT: database.port,
    CADENCE_LOCAL_INTEGRATION_SIGNING_KEY: JSON.stringify(keys),
  };
  for (const [name, value] of Object.entries(environment)) {
    if (/['\r\n\0]/.test(value)) throw new Error(`${name} contains a character the rehearsal cannot export.`);
  }
  return environment;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, path, exitCode, phaseOrAttempt, remainingSeconds] = process.argv.slice(2);
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const allowlist = async () => parseIntegrationAllowlist(JSON.parse(await readFile(INTEGRATION_TESTS_PATH, "utf8")));
  if (command === "integration-tests" && process.argv.length === 3) {
    console.info((await allowlist()).run.join("\n"));
  } else if (command === "integration-env" && process.argv.length === 6) {
    // Writes a private file for `source`; nothing secret reaches stdout or stderr.
    try {
      const environment = integrationEnvironment(await readFile(path, "utf8"), await readFile(exitCode, "utf8"));
      const lines = Object.entries(environment).map(([name, value]) => `export ${name}='${value}'\n`).join("");
      await writeFile(phaseOrAttempt, lines, { mode: 0o600, flag: "wx" });
      console.info(`Exported ${Object.keys(environment).join(", ")}.`);
    } catch (error) {
      console.error(error instanceof Error && /^(Local Supabase status|The rehearsal signing key|CADENCE_)/.test(error.message) ? error.message : "Could not prepare the integration test environment.");
      process.exitCode = 1;
    }
  } else if (command === "integration-report" && process.argv.length === 4) {
    let report = null;
    try { report = JSON.parse(await readFile(path, "utf8")); } catch { console.error("::error::The vitest JSON report is missing or unreadable; vitest stopped before writing it."); }
    const { problems, summary } = checkIntegrationReport(report, (await allowlist()).run, projectRoot);
    for (const line of summary) console.info(line);
    for (const problem of problems) console.error(`::error::${problem}`);
    if (problems.length > 0) process.exitCode = 1;
  } else if (command === "images" && process.argv.length === 3) {
    console.info(REHEARSAL_IMAGES.join("\n"));
  } else if (command === "registry" && process.argv.length === 3) {
    console.info(REHEARSAL_REGISTRY);
  } else {
    try {
      if (command === "inspect-pull" && process.argv.length === 7) {
        const diagnostics = await readRehearsalDiagnostics(path, Number(exitCode), "pull");
        console.info(JSON.stringify({ ...diagnostics,
          retry_delay_seconds: pullRetryDelay(diagnostics, Number(exitCode), Number(phaseOrAttempt), Number(remainingSeconds)),
        }));
      } else {
        if (command !== "inspect" || process.argv.length !== 6) throw new Error("Invalid diagnostic command.");
        console.info(JSON.stringify(await readRehearsalDiagnostics(path, Number(exitCode), phaseOrAttempt)));
      }
    } catch {
      // Even an I/O or parser failure must not print a private path or exception.
      console.info('{"category":"diagnostics_unavailable"}');
    }
  }
}
