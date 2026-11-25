import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const modulePath = "../scripts/supabase-rehearsal-diagnostics.mjs";
const {
  classifyRehearsalOutput, readRehearsalDiagnostics, pullRetryDelay, REHEARSAL_IMAGES, REHEARSAL_REGISTRY, MAX_DIAGNOSTIC_BYTES,
  parseIntegrationAllowlist, checkIntegrationReport, integrationEnvironment,
} = await import(modulePath);
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
    ["unexpected EOF", "network_interruption"],
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

describe("database-backed local integration tests in the rehearsal", () => {
  const allowlistPath = "scripts/supabase-rehearsal-integration-tests.json";
  const readAllowlist = async () => JSON.parse(await readFile(allowlistPath, "utf8"));
  const root = "/repo";
  const report = (entries: [string, string[]][]) => ({
    testResults: entries.map(([file, statuses]) => ({
      name: `${root}/${file}`, status: statuses.includes("failed") ? "failed" : "passed",
      assertionResults: statuses.map((status) => ({ status })),
    })),
  });
  const statusEnv = [
    'API_URL="http://127.0.0.1:55321"', 'DB_URL="postgresql://postgres:postgres@127.0.0.1:55322/postgres"',
    'PUBLISHABLE_KEY="sb_publishable_fixture"', 'SERVICE_ROLE_KEY="eyJ.fixture.service"', 'SECRET_KEY="sb_secret_fixture"',
  ].join("\n");
  const signingKeys = JSON.stringify([{ kty: "EC", crv: "P-256", alg: "ES256", kid: "fixture-kid", d: "private-d", x: "x", y: "y" }]);

  it("classifies every local integration test file exactly once, and every run entry exists", async () => {
    const { run, excluded } = parseIntegrationAllowlist(await readAllowlist());
    const files = (await readdir("tests")).filter((name) => /\.local-integration\.test\.(?:ts|mjs)$/.test(name)).map((name) => `tests/${name}`).sort();
    expect([...run, ...excluded].sort()).toEqual(files);
    // The d13b715e regression (a PostgREST query that failed on every call) must stay covered.
    expect(run).toContain("tests/coach-signals.local-integration.test.ts");
  });

  it("rejects an allowlist with a duplicate, an unknown need, a non-test path or a missing reason", async () => {
    const valid = await readAllowlist();
    const first = valid.run[0].file;
    expect(() => parseIntegrationAllowlist({ ...valid, run: [...valid.run, valid.run[0]] })).toThrow(/listed twice/);
    expect(() => parseIntegrationAllowlist({ ...valid, excluded: { ...valid.excluded, [first]: "Needs an app server to run." } })).toThrow(/listed twice/);
    expect(() => parseIntegrationAllowlist({ ...valid, run: [{ file: first, needs: "app-server" }] })).toThrow(/needs one or more/);
    expect(() => parseIntegrationAllowlist({ ...valid, run: [{ file: "tests/*.local-integration.test.ts", needs: "database" }] })).toThrow(/not a tests/);
    expect(() => parseIntegrationAllowlist({ ...valid, excluded: { "tests/x.local-integration.test.ts": "" } })).toThrow(/needs a reason/);
    expect(() => parseIntegrationAllowlist({ ...valid, run: [] })).toThrow(/non-empty run/);
  });

  it("accepts a report where every listed file passed all of its tests", () => {
    const files = ["tests/a.local-integration.test.ts", "tests/b.local-integration.test.mjs"];
    const result = checkIntegrationReport(report([[files[0], ["passed", "passed"]], [files[1], ["passed"]]]), files, root);
    expect(result.problems).toEqual([]);
    expect(result.summary).toEqual([`${files[0]}: 2 passed, 0 failed, 0 skipped`, `${files[1]}: 1 passed, 0 failed, 0 skipped`]);
  });

  it("fails a listed file that skipped, ran nothing, failed or is missing from the report", () => {
    const files = ["tests/skip.local-integration.test.ts", "tests/partial.local-integration.test.ts", "tests/fail.local-integration.test.ts", "tests/missing.local-integration.test.ts"];
    const { problems } = checkIntegrationReport(report([
      [files[0], ["skipped", "skipped"]],
      // Like tests/integration-idempotency: pure tests pass while the database tests skip.
      [files[1], ["passed", "skipped", "todo"]],
      [files[2], ["passed", "failed"]],
    ]), files, root);
    expect(problems).toEqual([
      `${files[0]}: ran zero tests; its environment check probably skipped. Export the variables it reads or move it to excluded with a reason.`,
      `${files[0]}: skipped 2 test(s); a skipped test proves nothing. Export the variables it reads or move it to excluded with a reason.`,
      `${files[1]}: skipped 2 test(s); a skipped test proves nothing. Export the variables it reads or move it to excluded with a reason.`,
      `${files[2]}: 1 failed test(s); read the vitest output above.`,
      `${files[3]}: missing from the vitest report; check that the file exists and loads.`,
    ]);
    expect(checkIntegrationReport(null, [files[0]], root).problems).toHaveLength(1);
  });

  it("maps supabase status output and the generated key to the variables the tests read", () => {
    expect(integrationEnvironment(statusEnv, signingKeys)).toEqual({
      CADENCE_LOCAL_SUPABASE_URL: "http://127.0.0.1:55321",
      CADENCE_LOCAL_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
      CADENCE_LOCAL_SUPABASE_SERVICE_KEY: "eyJ.fixture.service",
      CADENCE_LOCAL_SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres",
      CADENCE_LOCAL_SUPABASE_DB_PORT: "55322",
      CADENCE_LOCAL_INTEGRATION_SIGNING_KEY: signingKeys,
    });
  });

  it.each([
    ["a missing service key", statusEnv.replace(/^SERVICE_ROLE_KEY=.*$/m, ""), signingKeys, /omitted SERVICE_ROLE_KEY/],
    ["a non-loopback API URL", statusEnv.replace("127.0.0.1:55321", "db.example.supabase.co"), signingKeys, /API_URL is not/],
    ["a non-loopback database", statusEnv.replace("127.0.0.1:55322", "10.0.0.5:5432"), signingKeys, /DB_URL is not/],
    ["a random string instead of a JWK", statusEnv, "c2VjcmV0LWtleQ", /not JSON/],
    ["a public key without d", statusEnv, JSON.stringify([{ kty: "EC", crv: "P-256", alg: "ES256", kid: "k", x: "x", y: "y" }]), /exactly one private ES256 JWK/],
    ["two keys", statusEnv, JSON.stringify([JSON.parse(signingKeys)[0], JSON.parse(signingKeys)[0]]), /exactly one private ES256 JWK/],
  ])("refuses %s without echoing any value", (_label, status, keys, message) => {
    let error: unknown;
    try { integrationEnvironment(status, keys); } catch (caught) { error = caught; }
    expect(String(error)).toMatch(message);
    expect(String(error)).not.toMatch(/fixture|private-d|c2VjcmV0/);
  });

  it("writes the environment only to a new private file and prints variable names only", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cadence-rehearsal-integration-"));
    directories.push(directory);
    await writeFile(join(directory, "status.env"), statusEnv, { mode: 0o600 });
    await writeFile(join(directory, "keys.json"), signingKeys, { mode: 0o600 });
    const out = join(directory, "integration.env");
    const run = () => spawnSync(process.execPath, ["scripts/supabase-rehearsal-diagnostics.mjs", "integration-env", join(directory, "status.env"), join(directory, "keys.json"), out], { encoding: "utf8" });
    const first = run();
    expect(first.status).toBe(0);
    expect(first.stdout + first.stderr).not.toMatch(/fixture|private-d/);
    expect((await stat(out)).mode & 0o777).toBe(0o600);
    const exported = execFileSync("bash", ["-c", 'source "$1" && printf "%s|%s" "$CADENCE_LOCAL_SUPABASE_DB_PORT" "$CADENCE_LOCAL_INTEGRATION_SIGNING_KEY"', "bash", out], { encoding: "utf8" });
    expect(exported).toBe(`55322|${signingKeys}`);
    // An existing file is never overwritten.
    expect(run().status).toBe(1);
  });

  it("prints the allowlist and fails the report command on a skipped file", async () => {
    const listed = execFileSync(process.execPath, ["scripts/supabase-rehearsal-diagnostics.mjs", "integration-tests"], { encoding: "utf8" }).trim().split("\n");
    expect(listed).toEqual(parseIntegrationAllowlist(await readAllowlist()).run);
    const directory = await mkdtemp(join(tmpdir(), "cadence-rehearsal-report-"));
    directories.push(directory);
    const path = join(directory, "report.json");
    const absolute = (file: string) => join(process.cwd(), file);
    await writeFile(path, JSON.stringify({ testResults: listed.map((file, index) => ({
      name: absolute(file), status: "passed", assertionResults: [{ status: index === 0 ? "skipped" : "passed" }],
    })) }));
    const failing = spawnSync(process.execPath, ["scripts/supabase-rehearsal-diagnostics.mjs", "integration-report", path], { encoding: "utf8" });
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain(`::error::${listed[0]}: ran zero tests`);
    await writeFile(path, JSON.stringify({ testResults: listed.map((file) => ({ name: absolute(file), status: "passed", assertionResults: [{ status: "passed" }] })) }));
    expect(spawnSync(process.execPath, ["scripts/supabase-rehearsal-diagnostics.mjs", "integration-report", path], { encoding: "utf8" }).status).toBe(0);
    const missing = spawnSync(process.execPath, ["scripts/supabase-rehearsal-diagnostics.mjs", "integration-report", join(directory, "absent.json")], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("The vitest JSON report is missing or unreadable");
  });
});

describe("bounded retries for the existing ECR image pins", () => {
  const diagnose = (output: string) => classifyRehearsalOutput(output, 1, "pull");

  it("selects all seven existing pins from the CLI's official default registry", () => {
    expect(REHEARSAL_REGISTRY).toBe("public.ecr.aws");
    expect(REHEARSAL_IMAGES).toHaveLength(7);
    expect(new Set(REHEARSAL_IMAGES).size).toBe(7);
    expect(Object.isFrozen(REHEARSAL_IMAGES)).toBe(true);
    expect(REHEARSAL_IMAGES.every((image: string) => image.startsWith("public.ecr.aws/supabase/"))).toBe(true);
    const output = execFileSync(process.execPath, ["scripts/supabase-rehearsal-diagnostics.mjs", "images"], { encoding: "utf8" });
    expect(output.trim().split("\n")).toEqual(REHEARSAL_IMAGES);
  });

  it("backs off only three times and never spends the remaining budget on a delay", () => {
    const diagnostics = diagnose("toomanyrequests: request throttled");
    expect([1, 2, 3, 4].map((attempt) => pullRetryDelay(diagnostics, 1, attempt, 480))).toEqual([10, 20, 40, 0]);
    expect(pullRetryDelay(diagnostics, 1, 1, 10)).toBe(0);
    expect(pullRetryDelay(diagnostics, 1, 2, 20)).toBe(0);
    expect(pullRetryDelay(diagnostics, 1, 3, 40)).toBe(0);
    expect(pullRetryDelay(diagnostics, 1, 1, -1)).toBe(0);
  });

  it.each([
    "unexpected EOF", "connection reset by peer", "i/o timeout", "TLS handshake timeout",
  ])("permits bounded retry of a specific interrupted network request: %s", (output) => {
    expect(pullRetryDelay(diagnose(output), 1, 1, 480)).toBe(10);
  });

  it.each([
    "rate limit",
    "failed to pull image: unknown error",
    "context deadline exceeded",
    "Local Docker request failed.",
    "HTTP status: 503",
    "toomanyrequests\nHTTP status: 401",
    "toomanyrequests\nunexpected status: 403 Forbidden",
    "toomanyrequests\nunexpected status: 404 Not Found",
    "toomanyrequests\nmanifest unknown",
    "toomanyrequests\nCadence Docker request rejected.",
    "toomanyrequests\nx509: certificate signed by unknown authority",
    "unexpected EOF\nno space left on device",
    "unexpected EOF\nunsupported media type",
    "unexpected EOF\ndigest mismatch",
    "unexpected EOF\nno such host",
  ])("does not retry an unknown or nontransient failure: %s", (output) => {
    expect(pullRetryDelay(diagnose(output), 1, 1, 480)).toBe(0);
  });

  it("never retries process timeouts, cancellation, success, or incomplete diagnostic evidence", () => {
    const diagnostics = diagnose("toomanyrequests");
    for (const exitCode of [0, 124, 130, 137, 143]) expect(pullRetryDelay(diagnostics, exitCode, 1, 480)).toBe(0);
    expect(pullRetryDelay({ ...diagnostics, tail_truncated: true }, 1, 1, 480)).toBe(0);
    expect(pullRetryDelay(diagnostics, 1, 0, 480)).toBe(0);
    expect(pullRetryDelay(diagnostics, 1, Number.NaN, 480)).toBe(0);
    expect(pullRetryDelay(diagnostics, 1, 1, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("emits only the fixed retry delay and safe diagnostic fields through the pull CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cadence-rehearsal-retry-"));
    directories.push(directory);
    const path = join(directory, "private-pull.out");
    await writeFile(path, 'Error response from daemon: failed to pull public.ecr.aws/supabase/storage-api:v1.60.4: toomanyrequests\nhttps://private.example/?token=private-query\n', { mode: 0o600 });
    const output = execFileSync(process.execPath, ["scripts/supabase-rehearsal-diagnostics.mjs", "inspect-pull", path, "1", "2", "100"], { encoding: "utf8" });
    expect(JSON.parse(output)).toEqual({
      category: "registry_rate_limit", signals: ["registry_rate_limit", "image_pull"],
      registries: ["public.ecr.aws"], images: ["public.ecr.aws/supabase/storage-api:v1.60.4"],
      http_statuses: [], tail_truncated: false, retry_delay_seconds: 20,
    });
    expect(output).not.toMatch(/private|https:|token/);
  });
});
