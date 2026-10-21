import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { stagePublicTrustSite, validatePublicTrustDetails } from "../scripts/publish-public-trust-evidence.mjs";
// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { downloadPublicTrustHistory } from "../scripts/download-public-trust-history.mjs";
// @ts-expect-error Operational JavaScript module intentionally has no declarations.
import { buildSnapshot } from "../scripts/collect-public-trust-evidence.mjs";

async function validSubject(failed = false) {
  const input = JSON.parse(await readFile("tests/fixtures/public-trust-collector/input.json", "utf8"));
  input.details_filename = `${input.snapshot_id}.details.json`;
  input.facts = Object.fromEntries([
    "source_to_deployment_provenance", "production_dependency_vulnerabilities", "code_scanning", "secret_scanning", "public_artifact_integrity", "application_live_route_comparison", "marketing_live_route_comparison", "hosted_migration_boundary", "cross_account_rls_isolation",
  ].map((id, index) => [id, { status: failed && index === 0 ? "failed" : "passed", scope: "A bounded deterministic fixture check.", tool: { name: "fixture", version: "1" }, summary: failed && index === 0 ? "The deterministic fixture check failed." : "The deterministic fixture check passed." }]));
  return { input, snapshot: buildSnapshot(input) };
}

describe("public Trust publication", () => {
  it("retains canonical legacy URLs and exact bytes through two renamed-site publications", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-rename-"));
    const origin = "https://emixd12.github.io/cadence/";
    const { input, snapshot: legacy } = await validSubject();
    const details = { schema: "cadence.public-trust-details", source_commit: input.source_commit, application_deployment_id: input.application_deployment.id, marketing_deployment_id: input.marketing_deployment.id };
    Object.assign(details, { routes: { marketing: { observed: [{ path: "/developers/tools/update_occurrence_note", ok: true, reason: "" }] } } });
    const legacyBytes = JSON.stringify(legacy, null, "\t");
    const detailBytes = JSON.stringify(details);
    let published = path.join(root, "seed");
    await mkdir(path.join(published, "trust"), { recursive: true });
    await writeFile(path.join(published, "trust/snapshots.json"), JSON.stringify([legacy.snapshot_url]));
    const relative = (url: string) => new URL(url).pathname.split("/trust/")[1];
    const fetcher = async (url: URL) => {
      if (url.href === legacy.snapshot_url) return new Response(legacyBytes);
      if (url.href === legacy.checks[0].evidence_url) return new Response(detailBytes);
      try { return new Response(await readFile(path.join(published, "trust", relative(url.href)), "utf8")); }
      catch { return new Response("missing", { status: 404 }); }
    };
    const expected = [legacy.snapshot_url];
    for (let run = 1; run <= 2; run++) {
      const history = path.join(root, `history-${run}`);
      expect(await downloadPublicTrustHistory({ origin, outputDirectory: history, fetcher })).toBe(run);
      expect(await readFile(path.join(history, "trust", relative(legacy.snapshot_url)), "utf8")).toBe(legacyBytes);
      expect(await readFile(path.join(history, "trust", relative(legacy.checks[0].evidence_url)), "utf8")).toBe(detailBytes);
      const id = `20261007T00000${run}Z-${input.source_commit.slice(0, 12)}`;
      const snapshot = buildSnapshot({ ...input, pages_origin: origin, snapshot_id: id, details_filename: `${id}.details.json` });
      const output = path.join(root, `publication-${run}`);
      await stagePublicTrustSite({ snapshot, details, outputDirectory: output, previousDirectory: history });
      expected.push(snapshot.snapshot_url);
      expect(JSON.parse(await readFile(path.join(output, "trust/snapshots.json"), "utf8"))).toEqual([...expected].sort());
      await expect(stagePublicTrustSite({ snapshot, details, outputDirectory: output })).rejects.toThrow(/already exists/);
      published = output;
    }
  });

  it.each([
    ["https://emixd12.github.io/cadence/", "https://foreign.example/trust/a.json"],
    ["https://emixd12.github.io/cadence/", "https://emixd12.github.io/other/trust/a.json"],
    ["https://emixd12.github.io/cadence/", "https://emixd12.github.io/cadence/trust/%2e%2e/a.json"],
    ["https://emixd12.github.io/cadence/", "https://emixd12.github.io/cadence/trust/a%2fb.json"],
    ["https://emixd12.github.io/cadence/", "https://emixd12.github.io/cadence/trust/a.json?x=1"],
    ["https://emixd12.github.io/other/", "https://emixd12.github.io/habit-tracking-app/trust/a.json"],
  ])("rejects history outside the exact archive boundary (%s, %s)", async (origin, value) => {
    const outputDirectory = path.join(await mkdtemp(path.join(os.tmpdir(), "cadence-trust-")), "history");
    let requests = 0;
    const fetcher = async () => { requests++; return new Response(JSON.stringify([value])); };
    await expect(downloadPublicTrustHistory({ origin, outputDirectory, fetcher })).rejects.toThrow(/escaped/);
    expect(requests).toBe(1);
    await expect(stat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects old/new URLs that collide in the archive directory before downloading them", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-"));
    const fetcher = async () => new Response(JSON.stringify([
      "https://emixd12.github.io/cadence/trust/same.json",
      "https://emixd12.github.io/habit-tracking-app/trust/same.json",
    ]));
    await expect(downloadPublicTrustHistory({ origin: "https://emixd12.github.io/cadence/", outputDirectory, fetcher })).rejects.toThrow(/duplicate/);
  });

  it.each(["missing snapshot", "redirect", "identity mismatch", "missing details"])("refuses incomplete history: %s", async (failure) => {
    const { snapshot } = await validSubject();
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-"));
    const fetcher = async (url: URL) => {
      if (url.pathname.endsWith("snapshots.json")) return new Response(JSON.stringify([snapshot.snapshot_url]));
      if (url.href === snapshot.snapshot_url) {
        if (failure === "missing snapshot") return new Response("missing", { status: 404 });
        if (failure === "redirect") return new Response(null, { status: 302, headers: { location: "https://emixd12.github.io/other/" } });
        return new Response(JSON.stringify(failure === "identity mismatch" ? { ...snapshot, snapshot_url: snapshot.snapshot_url.replace("habit-tracking-app", "cadence") } : snapshot));
      }
      return new Response("missing", { status: 404 });
    };
    await expect(downloadPublicTrustHistory({ origin: "https://emixd12.github.io/cadence/", outputDirectory, fetcher })).rejects.toThrow();
    await expect(readFile(path.join(outputDirectory, "trust/snapshots.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates an empty history directory for the first Pages publication", async () => {
    const output = path.join(await mkdtemp(path.join(os.tmpdir(), "cadence-trust-")), "history");
    const fetcher = async () => new Response("missing", { status: 404 });
    await expect(downloadPublicTrustHistory({ origin: "https://pages.example/project", outputDirectory: output, fetcher })).rejects.toThrow(/not authorized/);
    expect(await downloadPublicTrustHistory({ origin: "https://pages.example/project", outputDirectory: output, fetcher, allowEmpty: true })).toBe(0);
    await expect(stat(output)).resolves.toMatchObject({});
  });

  it("does not replace latest after schema or sanitization failure", async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-"));
    await mkdir(path.join(output, "trust"));
    await writeFile(path.join(output, "trust/latest.json"), "previous\n");
    await expect(stagePublicTrustSite({ snapshot: { secret: "canary" }, details: {}, outputDirectory: output })).rejects.toThrow();
    await expect(readFile(path.join(output, "trust/latest.json"), "utf8")).resolves.toBe("previous\n");
  });

  it.each(["/developers/tools/update_occurrence_note", "/developers/tools/update_occurrence_note.md"])("allows a declared public tool path in observed routes and failure prefixes: %s", async (route) => {
    const { input, snapshot } = await validSubject();
    const details = {
      schema: "cadence.public-trust-details", source_commit: input.source_commit,
      application_deployment_id: input.application_deployment.id, marketing_deployment_id: input.marketing_deployment.id,
      routes: { marketing: { observed: [{ path: route, ok: false, reason: "stable page marker missing" }], failures: [`${route}: stable page marker missing`] } },
    };
    const original = JSON.stringify(details);
    expect(() => validatePublicTrustDetails(details, snapshot)).not.toThrow();
    expect(JSON.stringify(details)).toBe(original);
  });

  it("accepts collector route details through the workflow validation command", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-cli-"));
    const { input, snapshot } = await validSubject();
    const details = { schema: "cadence.public-trust-details", source_commit: input.source_commit,
      application_deployment_id: input.application_deployment.id, marketing_deployment_id: input.marketing_deployment.id,
      routes: { marketing: { observed: [{ path: "/developers/tools/update_occurrence_note", ok: true, reason: "" }], failures: [] } } };
    await writeFile(path.join(directory, "snapshot.json"), JSON.stringify(snapshot));
    await writeFile(path.join(directory, "details.json"), JSON.stringify(details));
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/validate-public-trust-snapshot.mjs", path.join(directory, "snapshot.json"), path.join(directory, "details.json")], { encoding: "utf8" });
    expect(result.stderr).not.toContain("Error:");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("schema and sanitization passed");
  });

  it.each([
    { routes: { application: { observed: [{ path: "/developers/tools/update_occurrence_note" }] } } },
    { path: "/developers/tools/update_occurrence_note" },
    { routes: { marketing: { observed: [{ path: "/developers/tools/update_occurrence_note?token=canary" }] } } },
    { routes: { marketing: { observed: [{ path: "/developers/tools/update_occurrence_note#canary" }] } } },
    { routes: { marketing: { observed: [{ path: "/developers/tools/../update_occurrence_note" }] } } },
    { routes: { marketing: { observed: [{ path: "/developers/tools/update_occurrence_note/extra" }] } } },
    { routes: { marketing: { observed: [{ path: "https://evil.example/developers/tools/update_occurrence_note" }] } } },
    { routes: { marketing: { observed: [{ path: "/developers/tools/unknown_note" }] } } },
    { routes: { marketing: { observed: [{ path: "/developers/tools/update_occurrence_note", reason: "note text canary" }] } } },
    { routes: { marketing: { observed: [{ path: "/developers/tools/update_occurrence_note", authorization: "canary" }] } } },
    { routes: { marketing: { failures: ["/developers/tools/update_occurrence_note: token canary"] } } },
    { routes: { marketing: { failures: ["/developers/tools/update_occurrence_note: note text canary"] } } },
    { routes: { marketing: { failures: ["/developers/tools/update_occurrence_noteX"] } } },
    { routes: { marketing: { failures: ["/developers/tools/update_occurrence_note: /developers/tools/update_occurrence_note"] } } },
    { routes: { marketing: { failures: ["/developers/tools/update_occurrence_note: https://127.0.0.1/path"] } } },
    { routes: { marketing: { failures: ["/developers/tools/update_occurrence_note: user@example.com"] } } },
    { routes: { marketing: { observed: [{ path: { note: "canary" } }] } } },
    { notes: "private text" }, { token: "canary" }, { cookie: "canary" }, { headers: {} },
    { summary: "Bearer canary" }, { summary: "provider_payload canary" },
  ])("rejects sensitive content or paths outside the exact public field boundary: %j", async (payload) => {
    const { input, snapshot } = await validSubject();
    const details = { schema: "cadence.public-trust-details", source_commit: input.source_commit,
      application_deployment_id: input.application_deployment.id, marketing_deployment_id: input.marketing_deployment.id, ...payload };
    expect(() => validatePublicTrustDetails(details, snapshot)).toThrow(/prohibited|private/);
  });

  it("rejects a synthetic secret canary before writing latest", async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-"));
    const { input, snapshot } = await validSubject();
    await expect(stagePublicTrustSite({ snapshot, details: { schema: "cadence.public-trust-details", source_commit: input.source_commit, application_deployment_id: input.application_deployment.id, marketing_deployment_id: input.marketing_deployment.id, authorization: "synthetic-canary" }, outputDirectory: output })).rejects.toThrow(/prohibited/);
    await expect(readFile(path.join(output, "trust/latest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects private-host detail canaries before writing latest", async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-"));
    const { input, snapshot } = await validSubject();
    const details = { schema: "cadence.public-trust-details", source_commit: input.source_commit, application_deployment_id: input.application_deployment.id, marketing_deployment_id: input.marketing_deployment.id, final_url: "https://10.0.0.1/private" };
    await expect(stagePublicTrustSite({ snapshot, details, outputDirectory: output })).rejects.toThrow(/private/);
    await expect(readFile(path.join(output, "trust/latest.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stages a valid Failed snapshot for publication before the workflow gate fails", async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), "cadence-trust-"));
    const { input, snapshot } = await validSubject(true);
    const details = { schema: "cadence.public-trust-details", source_commit: input.source_commit, application_deployment_id: input.application_deployment.id, marketing_deployment_id: input.marketing_deployment.id };
    await stagePublicTrustSite({ snapshot, details, outputDirectory: output });
    const latest = JSON.parse(await readFile(path.join(output, "trust/latest.json"), "utf8"));
    expect(latest.checks[0].status).toBe("failed");
  });
});
