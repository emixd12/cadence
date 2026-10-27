import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { PINNED_GHCR_IMAGES } from "./supabase-docker-proxy.mjs";

export const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const REGISTRIES = ["ghcr.io", "public.ecr.aws"];
const HTTP_STATUSES = [400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504];
const SIGNAL_PRIORITY = [
  "migration_or_seed", "registry_rate_limit", "registry_auth", "image_manifest",
  "image_pull", "service_health", "timeout", "docker_transport", "proxy_rejection",
];

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
    for (const code of codes) statuses.add(code);
    const pullError = /failed to pull|pull access denied|manifest (?:unknown|not found)|no matching manifest|failed to resolve (?:reference|source metadata)|failed to fetch (?:oauth|anonymous) token/i.test(line)
      || (/error|failed/i.test(line) && REGISTRIES.some((registry) => line.includes(registry)));
    const pullContext = phase === "pull" || pullError;
    if (/\bSQLSTATE\b|failed to apply migration|failed to seed|error seeding/i.test(line)) signals.add("migration_or_seed");
    if (pullContext && (/\btoomanyrequests\b/i.test(line) || codes.includes(429))) signals.add("registry_rate_limit");
    if (pullContext && (/\bunauthorized\b|authentication required|pull access denied|\bdenied\b/i.test(line) || codes.some((code) => code === 401 || code === 403))) signals.add("registry_auth");
    if (pullContext && /manifest (?:unknown|not found)|no matching manifest/i.test(line)) signals.add("image_manifest");
    if (pullError) signals.add("image_pull");
    if (/\bis not ready\b|\bunhealthy\b/i.test(line)) signals.add("service_health");
    if (/deadline exceeded|timed out|i\/o timeout/i.test(line)) signals.add("timeout");
    if (/Local Docker request failed\.|unexpected EOF|connection reset by peer/i.test(line)) signals.add("docker_transport");
    if (/Cadence Docker request rejected\./.test(line)) signals.add("proxy_rejection");
  }
  const observed = SIGNAL_PRIORITY.filter((signal) => signals.has(signal));
  return {
    category: exitCode === 124 ? "time_limit" : observed[0] ?? "unclassified",
    signals: observed,
    registries: REGISTRIES.filter((registry) => text.includes(registry)),
    images: PINNED_GHCR_IMAGES.filter((image) => text.includes(image)),
    http_statuses: HTTP_STATUSES.filter((code) => statuses.has(code)),
    tail_truncated: truncated || bytes.length > MAX_DIAGNOSTIC_BYTES,
  };
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, path, exitCode, phase] = process.argv.slice(2);
  if (command === "images" && process.argv.length === 3) {
    console.info(PINNED_GHCR_IMAGES.join("\n"));
  } else {
    try {
      if (command !== "inspect" || process.argv.length !== 6) throw new Error("Invalid diagnostic command.");
      console.info(JSON.stringify(await readRehearsalDiagnostics(path, Number(exitCode), phase)));
    } catch {
      // Even an I/O or parser failure must not print a private path or exception.
      console.info('{"category":"diagnostics_unavailable"}');
    }
  }
}
