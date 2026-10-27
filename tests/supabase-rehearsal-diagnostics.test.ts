import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const modulePath = "../scripts/supabase-rehearsal-diagnostics.mjs";
const { classifyRehearsalOutput, readRehearsalDiagnostics, MAX_DIAGNOSTIC_BYTES } = await import(modulePath);
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("private Supabase startup diagnostics", () => {
  it("does not mistake rate-limit migration text for a registry failure", () => {
    const result = classifyRehearsalOutput("Applying rate limit migration\nERROR: private SQL text (SQLSTATE 42883)\nCadence Docker request rejected.\n", 1, "start");
    expect(result.category).toBe("migration_or_seed");
    expect(result.signals).toEqual(["migration_or_seed", "proxy_rejection"]);
    expect(classifyRehearsalOutput("NOTICE: rate limit table already exists", 1, "start").category).toBe("unclassified");
  });

  it("reports an explicit registry 429 with public names only", () => {
    const result = classifyRehearsalOutput('Error response from daemon: failed to pull ghcr.io/supabase/postgres:17.6.1.132: Head "https://ghcr.io/v2/private?token=private-query": 429 Too Many Requests\nAuthorization: Bearer private-jwt\n', 1, "pull");
    expect(result).toEqual({
      category: "registry_rate_limit", signals: ["registry_rate_limit", "image_pull"],
      registries: ["ghcr.io"], images: ["ghcr.io/supabase/postgres:17.6.1.132"],
      http_statuses: [429], tail_truncated: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/private|https:|token|Authorization|Bearer/);
  });

  it.each([
    ["failed to pull image: toomanyrequests", "registry_rate_limit"],
    ["Error response from daemon: unauthorized: authentication required; HTTP status: 401", "registry_auth"],
    ["Error response from daemon: manifest unknown", "image_manifest"],
    ["failed to pull image: private detail", "image_pull"],
    ["supabase_db_habit-tracking-app is not ready", "service_health"],
    ["context deadline exceeded", "timeout"],
    ["Local Docker request failed.", "docker_transport"],
    ["unexpected EOF", "docker_transport"],
    ["Cadence Docker request rejected.", "proxy_rejection"],
  ])("classifies a fixed failure marker without copying its text: %s", (output, category) => {
    expect(classifyRehearsalOutput(output, 1, "pull").category).toBe(category);
  });

  it("preserves the process time limit and emits no arbitrary failure text", () => {
    const output = "::error::private-secret\nhttps://unknown.example/?key=private-value\nPRIVATE=eyJ.private-jwt.signature\n";
    expect(classifyRehearsalOutput(output, 124, "start")).toEqual({
      category: "time_limit", signals: [], registries: [], images: [], http_statuses: [], tail_truncated: false,
    });
    expect(JSON.stringify(classifyRehearsalOutput(output, 1, "start"))).not.toMatch(/private|unknown\.example|eyJ|error::/);
  });

  it("reads only the bounded tail, including when earlier output contains another failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cadence-rehearsal-diagnostics-"));
    directories.push(directory);
    const path = join(directory, "private-start.out");
    await writeFile(path, `ERROR: private earlier text (SQLSTATE 42883)\n${"x".repeat(MAX_DIAGNOSTIC_BYTES)}\nservice is not ready\n`, { mode: 0o600 });
    const result = await readRehearsalDiagnostics(path, 1, "start");
    expect(result.category).toBe("service_health");
    expect(result.signals).toEqual(["service_health"]);
    expect(result.tail_truncated).toBe(true);
  });

  it("reports a fixed diagnostic error without exposing the private path", () => {
    const output = execFileSync(process.execPath, ["scripts/supabase-rehearsal-diagnostics.mjs", "inspect", "/missing/private-path", "1", "start"], { encoding: "utf8" });
    expect(output).toBe('{"category":"diagnostics_unavailable"}\n');
  });
});
